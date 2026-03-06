# Daily Lock Race Audit Report - 2026-03-06

## Race Scenarios Tested
1. **Stale lease attempting merge**: Evaluated if `MergeQueue.enqueue()` correctly rejects execution if a lease turns stale before queueing or execution. (Covered correctly by existing code).
2. **Concurrent writers to same resource**: Evaluated `LockManager.tryAcquireWrite()`. Validated it rejects acquisition attempts appropriately when concurrent locks to identical resources are requested. (Covered correctly by existing code).
3. **Timeout + Reacquire + Stale Token Reject**: Verified that when a heartbeat starts renewing and times out (and fails to renew), its timer is successfully cleared preventing further incorrect renewals. (Covered correctly by existing code).
4. **Re-acquire lock without stopping heartbeat**: Tested scenario where a task already has a heartbeat timer for a lock and re-acquires it (gaining a new fencing token). (Discovered a bug).

## Failures Found
- **Lease Heartbeat Re-acquisition Bug**: In `LeaseHeartbeat.start()`, when a task requested a lock re-acquisition, the existing timer check `if (this.timers.has(key)) { continue; }` meant the old heartbeat was left running with an outdated fencing token. This would cause the renewal to fail when the next tick hits, resulting in silent timer deletion and unexpected lock expiry.

## Fixes and Risk Level
- **Fix**: Modified `LeaseHeartbeat.start()` to explicitly clear any existing timer `clearInterval(this.timers.get(key))` for that task/resource pair before proceeding to set up the new timer with the latest `fencingToken`.
- **Risk Level**: Low. The fix enforces correct heartbeat replacement, aligning the renewal intervals with the updated tokens explicitly to prevent race conditions without introducing optimistic concurrency dependencies. Allowed monotonic fencing tokens to correctly progress.
