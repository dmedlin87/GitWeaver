import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { LeaseHeartbeat } from "../../src/scheduler/lease-heartbeat.js";
import { LockManager } from "../../src/scheduler/lock-manager.js";
import type { LockLease } from "../../src/core/types.js";

describe("LeaseHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts a timer to periodically renew leases", () => {
    const lockManager = new LockManager(1000);
    const renewSpy = vi.spyOn(lockManager, "renew").mockReturnValue(true);
    const heartbeat = new LeaseHeartbeat(lockManager, 500);

    const leases: LockLease[] = [
      {
        resourceKey: "file:a.ts",
        mode: "write",
        ownerTaskId: "task-1",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        fencingToken: 1,
      },
    ];

    heartbeat.start("task-1", leases);

    expect(renewSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(renewSpy).toHaveBeenCalledTimes(1);
    expect(renewSpy).toHaveBeenCalledWith("file:a.ts", "task-1", 1);

    vi.advanceTimersByTime(500);
    expect(renewSpy).toHaveBeenCalledTimes(2);

    heartbeat.stopOwner("task-1");
  });

  it("does not start a duplicate timer for the same task and resource", () => {
    const lockManager = new LockManager(1000);
    const renewSpy = vi.spyOn(lockManager, "renew").mockReturnValue(true);
    const heartbeat = new LeaseHeartbeat(lockManager, 500);

    const leases: LockLease[] = [
      {
        resourceKey: "file:a.ts",
        mode: "write",
        ownerTaskId: "task-1",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        fencingToken: 1,
      },
    ];

    heartbeat.start("task-1", leases);
    heartbeat.start("task-1", leases); // Second call should be ignored

    vi.advanceTimersByTime(500);
    // If a duplicate timer was created, we would see > 1 calls
    expect(renewSpy).toHaveBeenCalledTimes(1);

    heartbeat.stopOwner("task-1");
  });

  it("stops owner timers and does not renew after stopping", () => {
    const lockManager = new LockManager(1000);
    const renewSpy = vi.spyOn(lockManager, "renew").mockReturnValue(true);
    const heartbeat = new LeaseHeartbeat(lockManager, 500);

    const leasesTask1: LockLease[] = [
      {
        resourceKey: "file:a.ts",
        mode: "write",
        ownerTaskId: "task-1",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        fencingToken: 1,
      },
    ];

    const leasesTask2: LockLease[] = [
      {
        resourceKey: "file:b.ts",
        mode: "write",
        ownerTaskId: "task-2",
        acquiredAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 1000).toISOString(),
        fencingToken: 2,
      },
    ];

    heartbeat.start("task-1", leasesTask1);
    heartbeat.start("task-2", leasesTask2);

    vi.advanceTimersByTime(500);
    expect(renewSpy).toHaveBeenCalledTimes(2); // One for task-1, one for task-2
    renewSpy.mockClear();

    heartbeat.stopOwner("task-1");

    vi.advanceTimersByTime(500);
    // Timer for task-1 was stopped, so only task-2 timer should fire
    expect(renewSpy).toHaveBeenCalledTimes(1);
    expect(renewSpy).toHaveBeenCalledWith("file:b.ts", "task-2", 2);

    heartbeat.stopOwner("task-2");
    renewSpy.mockClear();

    vi.advanceTimersByTime(500);
    expect(renewSpy).not.toHaveBeenCalled(); // All timers stopped
  });
});
