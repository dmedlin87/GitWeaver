import { describe, expect, it } from "vitest";
import { LockManager } from "../../src/scheduler/lock-manager.js";

describe("LockManager", () => {
  it("issues monotonic fencing tokens", () => {
    const manager = new LockManager(1000);

    const first = manager.tryAcquireWrite(["file:a.ts"], "task-1");
    expect(first).not.toBeNull();
    expect(first?.[0].fencingToken).toBe(1);

    manager.releaseOwner("task-1");

    const second = manager.tryAcquireWrite(["file:a.ts"], "task-2");
    expect(second).not.toBeNull();
    expect(second?.[0].fencingToken).toBe(2);
  });

  it("rejects concurrent writers on same resource", () => {
    const manager = new LockManager(1000);
    const first = manager.tryAcquireWrite(["file:a.ts"], "task-1");
    expect(first).not.toBeNull();

    const second = manager.tryAcquireWrite(["file:a.ts"], "task-2");
    expect(second).toBeNull();
  });
});