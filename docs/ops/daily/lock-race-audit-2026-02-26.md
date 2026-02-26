# Daily Lock Race Audit: 2026-02-26

## Objective
Eliminate race conditions around lock leasing, fencing, and merge queue ordering in GitWeaver Orchestrator.

## Audit Scope
- `src/scheduler/lock-manager.ts`
- `src/scheduler/lease-heartbeat.ts`
- `src/scheduler/merge-queue.ts`
- `src/core/orchestrator.ts` (Integration point)
- `tests/unit/lock-manager.test.ts`
- `tests/unit/lock-race.test.ts` (New regression suite)

## Race Scenarios Tested

### 1. Stale Lease Attempting Merge
**Scenario:** A task acquires a lock, enters the `MergeQueue`, but a long-running operation (e.g., `detectStaleness` or system load) causes the lease to expire before the critical commit integration step.
**Finding:** The `MergeQueue` callback in `Orchestrator` checked `validateFencing` only at the *start* of the callback. The `detectStaleness` function is async and involves file I/O. If this step took longer than the remaining lease time (or if the heartbeat failed/stalled), the subsequent `integrateCommit` would execute with an invalid/expired lock.
**Fix:** Added a second mandatory `validateFencing` check immediately before `integrateCommit` in `src/core/orchestrator.ts`.
**Verification:** Validated via `tests/unit/lock-race.test.ts` which simulates a delay exceeding lease duration and asserts that validation fails.

### 2. Concurrent Writers to Same Resource
**Scenario:** Two tasks attempt to acquire a write lock on the same resource.
**Finding:** `LockManager.tryAcquireWrite` correctly implements mutual exclusion. If a valid lease exists, subsequent requests are rejected.
**Status:** Valid (No fix needed). Confirmed by `tests/unit/lock-manager.test.ts` and `tests/unit/lock-race.test.ts`.

### 3. Timeout + Reacquire + Stale Token Reject
**Scenario:** Task A acquires lock, freezes/crashes. Lease expires. Task B acquires lock. Task A wakes up and attempts to use its old token.
**Finding:** `LockManager` correctly implements monotonic fencing tokens. Task B gets a higher token. Task A's token is rejected by `validateFencing`.
**Status:** Valid (No fix needed). Confirmed by `tests/unit/lock-race.test.ts`.

## Implementation Details

### Changes
- **`src/core/orchestrator.ts`**: Inserted a guard clause inside the `MergeQueue` execution block.
  ```typescript
  for (const lease of leases) {
    if (!lockManager.validateFencing(lease.resourceKey, task.taskId, lease.fencingToken)) {
      throw this.errorWithCode(`Fencing token expired before merge for ${task.taskId}`, REASON_CODES.LOCK_TIMEOUT);
    }
  }
  ```
- **`tests/unit/lock-race.test.ts`**: Added regression test suite.

### Risk Level
- **Low**: The fix is a strict tightening of constraints. It prevents invalid writes. The only risk is if `LockManager` has clock skew issues (unlikely in single-process) or if the lease duration is too short for `detectStaleness` under normal load (which would rightfully fail the task rather than corrupt data).

## Conclusion
The critical race condition where a task could integrate a commit after losing its lock has been patched. The system now enforces fencing token validity immediately before the irreversible git operation.
