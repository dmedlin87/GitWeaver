import { describe, expect, it, vi } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";
import type { LockLease } from "../../src/core/types.js";

describe("Orchestrator lock contention retry", () => {
  function makeContext() {
    return {
      config: {
        lockContentionRetryMax: 2,
        lockContentionBackoffMs: 1
      }
    };
  }

  it("retries contention and eventually acquires leases", async () => {
    const orchestrator = new Orchestrator();
    const waitSpy = vi.spyOn(orchestrator as any, "waitMs").mockResolvedValue(undefined);
    const expected: LockLease[] = [{
      resourceKey: "file:a.ts",
      mode: "write",
      ownerTaskId: "task-1",
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      fencingToken: 1
    }];

    const lockManager = {
      tryAcquireWrite: vi
        .fn()
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(null)
        .mockReturnValueOnce(expected)
    };

    const leases = await (orchestrator as any).acquireWriteLeasesWithRetry(
      makeContext(),
      lockManager,
      ["file:a.ts"],
      "task-1"
    );

    expect(leases).toBe(expected);
    expect(lockManager.tryAcquireWrite).toHaveBeenCalledTimes(3);
    expect(waitSpy).toHaveBeenCalledTimes(2);
  });

  it("throws LOCK_TIMEOUT when contention retries are exhausted", async () => {
    const orchestrator = new Orchestrator();
    vi.spyOn(orchestrator as any, "waitMs").mockResolvedValue(undefined);

    const lockManager = {
      tryAcquireWrite: vi.fn().mockReturnValue(null)
    };

    await expect(
      (orchestrator as any).acquireWriteLeasesWithRetry(
        makeContext(),
        lockManager,
        ["file:a.ts"],
        "task-1"
      )
    ).rejects.toMatchObject({ reasonCode: REASON_CODES.LOCK_TIMEOUT });
    expect(lockManager.tryAcquireWrite).toHaveBeenCalledTimes(3);
  });
});
