import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LockManager } from "../../src/scheduler/lock-manager.js";
import { MergeQueue } from "../../src/scheduler/merge-queue.js";
import { LeaseHeartbeat } from "../../src/scheduler/lease-heartbeat.js";
import type { LockLease } from "../../src/core/types.js";

describe("LockManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it("handles duplicate resource keys properly", () => {
    const manager = new LockManager(1000);
    const leases = manager.tryAcquireWrite(["file:a.ts", "file:a.ts"], "task-1");
    expect(leases).not.toBeNull();
    expect(leases?.length).toBe(1);
  });

  it("normalizes acquisition order for overlapping resource sets", () => {
    const manager = new LockManager(1000);
    const leases = manager.tryAcquireWrite(["file:z.ts", "file:a.ts", "file:m.ts"], "task-1");
    expect(leases).not.toBeNull();
    expect(leases?.map((lease) => lease.resourceKey)).toEqual(["file:a.ts", "file:m.ts", "file:z.ts"]);
  });

  it("rejects concurrent writers on same resource", () => {
    const manager = new LockManager(1000);
    const first = manager.tryAcquireWrite(["file:a.ts"], "task-1");
    expect(first).not.toBeNull();

    const second = manager.tryAcquireWrite(["file:a.ts"], "task-2");
    expect(second).toBeNull();
  });

  it("stale lease attempting merge throws an error in MergeQueue", async () => {
    const queue = new MergeQueue();
    let executed = false;

    // validate returns false to simulate stale lease
    const resultPromise = queue.enqueue(
      async () => {
        executed = true;
      },
      () => false
    );

    await expect(resultPromise).rejects.toThrow("Stale lease: validation failed before queueing");
    expect(executed).toBe(false);
  });

  it("timeout + reacquire + stale token reject stops renewals", () => {
    const manager = new LockManager(100);
    const heartbeat = new LeaseHeartbeat(manager, 50);

    const firstLease = manager.tryAcquireWrite(["file:a.ts"], "task-1");
    expect(firstLease).not.toBeNull();
    const token1 = firstLease![0].fencingToken;

    const renewSpy = vi.spyOn(manager, "renew");

    heartbeat.start("task-1", firstLease!);

    // Move forward enough to cause a renewal
    vi.advanceTimersByTime(50);
    expect(renewSpy).toHaveBeenCalledWith("file:a.ts", "task-1", token1);
    renewSpy.mockClear();

    // Because the renewal happened at t=50ms, the next heartbeat is at t=100ms.
    // If we advance to t=90ms, we haven't renewed again yet.
    vi.advanceTimersByTime(40);

    // So the lock expires at t=50ms + 100ms = 150ms.
    // Let's stop the owner so it doesn't renew anymore (simulating a crash or stall).
    heartbeat.stopOwner("task-1");

    // Advance past expiration (150ms)
    vi.advanceTimersByTime(70);
    // total time = 50 + 40 + 70 = 160ms. Lock is now expired!

    // task-2 steals the lock
    const secondLease = manager.tryAcquireWrite(["file:a.ts"], "task-2");
    expect(secondLease).not.toBeNull();
    const token2 = secondLease![0].fencingToken;
    expect(token2).toBeGreaterThan(token1);

    // Wait, the previous steps stopped task-1's heartbeat. Let's start it back up,
    // as if it was merely blocked on the event loop and now tries to renew again.
    heartbeat.start("task-1", firstLease!);

    // Next renewal for task-1 should happen and FAIL, clearing the timer
    vi.advanceTimersByTime(50);
    expect(renewSpy).toHaveBeenCalledWith("file:a.ts", "task-1", token1);
    renewSpy.mockClear();

    // The timer should now be cleared because `renew` returned false,
    // so advancing time shouldn't call renew again
    vi.advanceTimersByTime(100);
    expect(renewSpy).not.toHaveBeenCalled();

    // We don't need to call stopOwner again if it cleared correctly.
    manager.releaseOwner("task-2");
  });

  it("clears existing heartbeat timer when starting a new one for the same resource", () => {
    const manager = new LockManager(100);
    const heartbeat = new LeaseHeartbeat(manager, 50);

    // Initial acquisition
    const firstLease = manager.tryAcquireWrite(["file:b.ts"], "task-1");
    expect(firstLease).not.toBeNull();
    heartbeat.start("task-1", firstLease!);
    const token1 = firstLease![0].fencingToken;

    // Simulate re-acquiring without stopping the previous heartbeat
    const secondLease = manager.tryAcquireWrite(["file:b.ts"], "task-1");
    expect(secondLease).not.toBeNull();
    const token2 = secondLease![0].fencingToken;
    expect(token2).toBeGreaterThan(token1);

    // The previous implementation would ignore the new start() call because
    // the timer key already existed, causing it to renew with token1 instead of token2.
    // The fixed implementation clears the old timer and uses the new token.
    heartbeat.start("task-1", secondLease!);

    const renewSpy = vi.spyOn(manager, "renew");

    // Advance time to trigger a renewal
    vi.advanceTimersByTime(50);

    // It should have renewed with the NEW fencing token (token2)
    expect(renewSpy).toHaveBeenCalledWith("file:b.ts", "task-1", token2);
    expect(renewSpy).not.toHaveBeenCalledWith("file:b.ts", "task-1", token1);
  });
});
