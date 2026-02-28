# Lock Race Audit - 2025-02-28

## Race Scenarios Tested
During today's concurrency hardening audit, we focused on evaluating the lock lease lifecycle, TTL expiry, fencing token monotonicity, and merge-time token validation. The following explicit scenarios were analyzed and tested:

1. **Stale Lease Attempting Merge:**
   - Examined the risk of a long-running operation (like staleness checks) exceeding its lock lease duration while in the `MergeQueue`.
   - Before the fix, the queue blindly executed closures without re-validating the underlying lock.
   - Tested by enqueuing a job with a validation function that forcefully returns false.

2. **Timeout + Reacquire + Stale Token Reject:**
   - Examined the behavior of `LeaseHeartbeat` renewing leases periodically.
   - If a lease expires and is stolen by a concurrent writer (or otherwise becomes un-renewable), `LockManager.renew()` starts returning `false`.
   - Before the fix, `LeaseHeartbeat` would continue attempting to renew the lease every `renewMs` indefinitely.
   - Tested by expiring a lease, allowing a second task to steal the lock, and observing the heartbeat renewal failures.

3. **Concurrent Writers and Token Monotonicity:**
   - Existing checks properly enforced monotonic token issuance for re-acquisition, rejecting overlapping writes during the same lock's valid TTL period.

## Failures Found
- `LeaseHeartbeat` infinite loop failure: The heartbeat interval was not correctly cleared upon `renew()` failure, resulting in an indefinite loop of renewal attempts for invalid locks.
- `MergeQueue` unverified executions: Closures executed after asynchronous delays (e.g. staleness detection) within `MergeQueue` did not validate if the lock owner still maintained the valid fencing token.

## Fixes and Risk Level
**Fix 1: Pre-Execution MergeQueue Validation**
- *Fix:* Modified `MergeQueue.enqueue()` to accept an optional `validate` function. This evaluates to `throw new Error("Stale lease: validation failed before execution")` if the provided validation function fails right before the task execution block.
- *Risk Level:* Low. Providing `validate` is optional and preserves existing API compatibility.

**Fix 2: Clearing Stale Lease Intervals**
- *Fix:* Updated `LeaseHeartbeat.ts` to capture the boolean output of `lockManager.renew(...)`. If the lease renewal yields `false`, `clearInterval(timer)` is executed immediately to stop attempting further renewals.
- *Risk Level:* Low. Prevents unnecessary load and guarantees stale tokens aren't continuously processed.
