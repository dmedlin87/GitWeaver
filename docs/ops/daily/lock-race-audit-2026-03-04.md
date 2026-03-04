# Lock Race Audit

## Race Scenarios Tested
- Stale lease attempting merge.
- Concurrent writers to same resource.
- Timeout + reacquire + stale token reject stops renewals.

## Failures Found
- `LeaseHeartbeat.start` failed to clear existing interval timers when restarting heartbeats for re-acquired locks (due to stale `timers.has(key)` check), leading to the wrong `fencingToken` being used for renewals.

## Fixes and Risk Level
- Modified `LeaseHeartbeat.start` to clear the existing interval if the key is already in `this.timers`, before setting a new one. This ensures we use the updated `fencingToken` from the newly acquired lock.
- Risk Level: Medium (fixes a subtle race condition in lock renewals that could cause lock loss or invalid renewals).
