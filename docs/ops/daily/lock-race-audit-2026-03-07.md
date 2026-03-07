# Concurrency Audit: Lock Leasing & Merge Queue
Date: 2026-03-07

## Overview
A concurrency hardening audit was conducted to eliminate race conditions around lock leasing, fencing, and merge queue ordering within GitWeaver's Orchestrator logic.

## Race Scenarios Tested
- **Stale Lease Attempting Merge:** Validation step before queuing a long-running operation appropriately returns a failed promise in the Merge Queue and protects against stale lock acquisition.
- **Concurrent Writers to Same Resource:** Prevents multiple tasks from acquiring a lease on the same underlying resource. Re-acquisition is allowed only once the lease time expires.
- **Timeout + Reacquire + Stale Token Reject:** Verified `fencingToken` monotonicity across re-acquisitions.
- **Reacquire Without Heartbeat Stop:** Ensuring re-acquisition clears the active interval gracefully before establishing a new lease token, preventing concurrent intervals tracking different token versions.

## Failures Found
- **BUG: Unbounded Heartbeat Timer Lifecycle:** In `LeaseHeartbeat.start`, if a task re-acquired a lock and `.start()` was executed without a prior explicit `stopOwner()`, the existing timer for that resource was allowed to continue via `continue;` while failing to utilize the newly minted `fencingToken`. Because renewals require strict token parity, subsequent renewals failed resulting in lock timeouts.
- **Testing Mocks Drift:** Both `orchestrator-policy.test.ts` and `watchdog-hang-recovery.test.ts` were found mocking `buildPromptEnvelope` with objects lacking the required `mutableSections` property, causing cascading `TypeError: Cannot read properties of undefined` failures when running downstream logic expecting mutable state arrays.

## Fixes and Risk Level
1. **Fix 1: Clearing Old Intervals** (Risk: Low)
   Updated `LeaseHeartbeat.start` in `src/scheduler/lease-heartbeat.ts` to execute `clearInterval(this.timers.get(key));` when an existing timer is detected instead of `continue;`. This binds the new `fencingToken` to the active heartbeat, resolving the renewal failure loop.

2. **Fix 2: Heartbeat Re-acquire Regression Test** (Risk: Low)
   Added explicit test coverage in `tests/unit/lock-manager.test.ts` capturing the above heartbeat race scenario, validating time advancement properly utilizes the latest monotonic token instead of prior obsolete instances.

3. **Fix 3: Mock Schema Drift Alignment** (Risk: Low)
   Updated `buildPromptEnvelope` mock stubs in specific test files to contain an empty `mutableSections: {}` object avoiding false-positive failure regressions during `pnpm test`.

## Validation
Ran `pnpm validate` containing `pnpm test` and `pnpm typecheck`. Verified all tasks complete nominally.