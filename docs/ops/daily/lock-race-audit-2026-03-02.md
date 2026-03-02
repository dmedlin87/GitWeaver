# Daily Lock Lease and Merge Race Audit

## Race scenarios tested
1. **Stale lease attempting merge:** Simulated a delay during processing that exceeds lease duration, ensuring that lock validation rejects invalid locks immediately before execution.
2. **Concurrent writers to same resource:** Tested that multiple tasks trying to lock the same resource properly block each other, and only allow the lock after expiry.
3. **Timeout + reacquire + stale token reject:** Verified that when a heartbeat is temporarily stopped and the lease is stolen, re-acquiring the lock updates the leasing state and tokens without leaving old heartbeat timers running. Also confirmed monotonic token generation.
4. **LeaseHeartbeat re-acquisition race:** Tested that if a task re-acquires a lock before the old one expires, the Heartbeat clears the existing timer to ensure we use the new fencing token to prevent stale renewals.

## Failures found
1. **MergeQueue asynchronous validation race:** `MergeQueue.enqueue` validated its `validate` callback asynchronously (inside the async wrapper). If enqueued jobs were chained, a stale lease could be validated later rather than synchronously at enqueue time, introducing a window for stale locks to falsely pass early checks or delay failing.
2. **LeaseHeartbeat duplicate timers:** Re-acquiring a lock by the same `ownerTaskId` did not replace the existing heartbeat timer because it checked `if (this.timers.has(key)) { continue; }`. Thus, the heartbeat kept sending the *old* fencing token for renewal, which was rejected by `LockManager.renew()`.

## Fixes and risk level
1. **MergeQueue sync validate:** (Risk: LOW) - Refactored `MergeQueue.enqueue` to evaluate the validation synchronously as part of a regular function returning a promise, preventing race conditions before a Promise chain. Memory rule complied: "validation must occur synchronously outside the async wrapper".
2. **LeaseHeartbeat timer replacement:** (Risk: LOW) - Modified `LeaseHeartbeat.start` to explicitly clear existing timers if present before creating a new one, ensuring the newest `fencingToken` is always used for renewals.

All regression tests implemented and passing.
