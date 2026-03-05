# Daily Lock Race Audit Report

## Race Scenarios Tested
1. **Stale lease attempting merge**: Verified that the merge queue validates the fencing token before queuing and running operations.
2. **Concurrent writers to same resource**: Checked that only one writer can acquire a lease for a resource at a given time and a new writer can only acquire it once the lease expires.
3. **Fencing token monotonicity**: Verified that fencing tokens increase monotonically upon re-acquisition.
4. **Timeout + reacquire + stale token reject**: Confirmed that `LeaseHeartbeat` clears the timer and stops renewal when an expired or invalid token is rejected by `LockManager.renew`.
5. **Duplicate resource keys**: Examined that duplicate resource keys in `tryAcquireWrite` are handled without issue by deduplicating inputs.

## Failures Found
No concurrency failures or broken invariants were found in `LockManager`, `LeaseHeartbeat`, and `MergeQueue`. Previous bugs appear to have been fixed and covered by existing tests.

## Fixes and Risk Level
No specific concurrency logic fixes were required, as tests already verify the desired properties (`lock-race.test.ts`, `lock-manager.test.ts`, `lease-heartbeat.test.ts`).

Added `mutableSections: {}` to mock responses for `buildPromptEnvelope` in `tests/unit/orchestrator-policy.test.ts` and `tests/integration/watchdog-hang-recovery.test.ts` to fix unrelated errors from property access on undefined.

**Risk Level:** Low.
