import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LockManager } from "../../src/scheduler/lock-manager.js";
import { LeaseHeartbeat } from "../../src/scheduler/lease-heartbeat.js";

describe("LeaseHeartbeat reacquire", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should replace existing timer if re-acquiring the same lock", () => {
    const manager = new LockManager(100);
    const heartbeat = new LeaseHeartbeat(manager, 50);

    const firstLease = manager.tryAcquireWrite(["file:a.ts"], "task-1");
    heartbeat.start("task-1", firstLease!);

    // Task-1 re-acquires the lock before expiry
    const secondLease = manager.tryAcquireWrite(["file:a.ts"], "task-1");
    expect(secondLease![0].fencingToken).toBe(2);

    // Call start again with the new lease
    heartbeat.start("task-1", secondLease!);

    const renewSpy = vi.spyOn(manager, "renew");

    // Advance time to trigger heartbeat
    vi.advanceTimersByTime(50);

    // It should have called renew with token 2, not token 1
    expect(renewSpy).toHaveBeenCalledWith("file:a.ts", "task-1", 2);

    // And it should return true
    expect(renewSpy.mock.results[0].value).toBe(true);
  });
});
