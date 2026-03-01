# Daily Lock Lease and Merge Race Audit
Date: 2025-03-01

## Race Scenarios Tested
1. **Stale lease attempting merge:** Enforced that operations waiting in the merge queue correctly re-validate their tokens before execution.
2. **Concurrent writers to same resource:** Asserts that overlapping key acquisitions fail early. Added a check handling accidental duplicate keys during acquisition.
3. **Timeout + reacquire + stale token reject:** Tests proper lease expiry, monotonic fencing token assignment, and validates token validation bounds when a heartbeat thread attempts a renewal using an expired token.

## Failures Found
1. **Duplicate Key Bug in `LockManager.tryAcquireWrite`:** Failed to deduplicate resource keys, leading to duplicate tracking of a single resource token.
2. **Delay Rejection in `MergeQueue.enqueue`:** The merge queue threw a generic error during execution instead of rejecting the Promise early.

## Fixes Applied
1. Changed `LockManager.tryAcquireWrite` to use `[...new Set(resourceKeys)]` to filter duplicate entries upon lock acquisition. Risk level: Low.
2. Updated `MergeQueue.enqueue` `run` execution wrapper to securely reject the task via `Promise.reject(new Error("Stale lease..."))` instead of an unchecked `throw`, ensuring cleaner async abort paths. Risk level: Low.

## Verification
- Both fixes included unit regression coverage.
- Full test suite passed deterministically without hanging processes.
