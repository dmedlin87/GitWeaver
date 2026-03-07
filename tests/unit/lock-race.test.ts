
import { describe, expect, it } from "vitest";
import { LockManager } from "../../src/scheduler/lock-manager.js";
import { MergeQueue } from "../../src/scheduler/merge-queue.js";

describe("Concurrency Audit: Lock Leasing & Merge Queue", () => {
  it("REGRESSION: verifies stale lease attempting merge is rejected if checked", async () => {
    // This test simulates the Orchestrator logic where a task enters the merge queue
    // but the lock expires during processing (e.g., during slow staleness checks).

    const lockManager = new LockManager(50); // Short 50ms lease
    const mergeQueue = new MergeQueue();
    const resource = "repo:main";

    // 1. Task A acquires lock
    const leases = lockManager.tryAcquireWrite([resource], "task-A");
    expect(leases).not.toBeNull();
    const tokenA = leases![0].fencingToken;

    // 2. Task A enqueues a slow merge operation
    let taskAExecuted = false;
    let taskAHasLockWhenRunning = false;

    const taskAPromise = mergeQueue.enqueue(async () => {
      // Simulate delay (e.g. detectStaleness) that exceeds lease duration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // CRITICAL CHECK: This is what we are enforcing in Orchestrator.
      // If we don't check here, we would proceed with an invalid lock.
      taskAHasLockWhenRunning = lockManager.validateFencing(resource, "task-A", tokenA);
      taskAExecuted = true;
    });

    // 3. Wait for Task A to finish
    await taskAPromise;

    expect(taskAExecuted).toBe(true);
    // The key assertion: The lock *must* be invalid by the time the critical section runs
    // if the delay exceeded the lease.
    expect(taskAHasLockWhenRunning).toBe(false);
  });

  it("REGRESSION: ensures concurrent writers are rejected and new writers can acquire after expiry", async () => {
    const lockManager = new LockManager(50);
    const resource = "file:data.json";

    // 1. Task A acquires lock
    const leasesA = lockManager.tryAcquireWrite([resource], "task-A");
    expect(leasesA).not.toBeNull();
    const tokenA = leasesA![0].fencingToken;

    // 2. Wait for lease to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 3. Task B acquires lock (should succeed because A expired)
    const leasesB = lockManager.tryAcquireWrite([resource], "task-B");
    expect(leasesB).not.toBeNull();
    const tokenB = leasesB![0].fencingToken;
    expect(tokenB).toBeGreaterThan(tokenA); // Monotonicity check

    // 4. Task A tries to validte (simulating a write attempt)
    const isValidA = lockManager.validateFencing(resource, "task-A", tokenA);
    expect(isValidA).toBe(false);

    // 5. Task B should be valid
    const isValidB = lockManager.validateFencing(resource, "task-B", tokenB);
    expect(isValidB).toBe(true);
  });

  it("REGRESSION: confirms fencing token monotonicity across re-acquisitions", () => {
    const lockManager = new LockManager(100);
    const resource = "db:row:1";

    const lease1 = lockManager.tryAcquireWrite([resource], "task-1");
    expect(lease1![0].fencingToken).toBe(1);
    lockManager.releaseOwner("task-1");

    const lease2 = lockManager.tryAcquireWrite([resource], "task-2");
    expect(lease2![0].fencingToken).toBe(2);
    lockManager.releaseOwner("task-2");

    // Re-acquire by task-1
    const lease3 = lockManager.tryAcquireWrite([resource], "task-1");
    expect(lease3![0].fencingToken).toBe(3);
  });

  it("REGRESSION: timeout + reacquire + stale token reject", async () => {
    const lockManager = new LockManager(50);
    const resource = "file:config.json";

    // 1. Task A acquires lock
    const lease1 = lockManager.tryAcquireWrite([resource], "task-A");
    expect(lease1).not.toBeNull();
    const token1 = lease1![0].fencingToken;

    // 2. Wait for lease to expire (timeout)
    await new Promise((resolve) => setTimeout(resolve, 60));

    // 3. Task A re-acquires lock (reacquire)
    const lease2 = lockManager.tryAcquireWrite([resource], "task-A");
    expect(lease2).not.toBeNull();
    const token2 = lease2![0].fencingToken;
    expect(token2).toBeGreaterThan(token1);

    // 4. Stale token reject (trying to renew with token1 should fail)
    const renewedOld = lockManager.renew(resource, "task-A", token1);
    expect(renewedOld).toBe(false);

    // 5. Valid token renew (trying to renew with token2 should succeed)
    const renewedNew = lockManager.renew(resource, "task-A", token2);
    expect(renewedNew).toBe(true);

    // Validate that validating fencing with old token is rejected
    const validOld = lockManager.validateFencing(resource, "task-A", token1);
    expect(validOld).toBe(false);

    const validNew = lockManager.validateFencing(resource, "task-A", token2);
    expect(validNew).toBe(true);
  });

  it("REGRESSION: rejects renewal of expired lease", async () => {
    const lockManager = new LockManager(50);
    const resource = "db:row:1";

    const lease = lockManager.tryAcquireWrite([resource], "task-1");
    expect(lease).not.toBeNull();
    const token = lease![0].fencingToken;

    // Wait for expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    // Try renew
    const renewed = lockManager.renew(resource, "task-1", token);
    expect(renewed).toBe(false);

    // Verify lock is actually gone/expired
    const valid = lockManager.validateFencing(resource, "task-1", token);
    expect(valid).toBe(false);
  });
});
