# Lock Race Audit Report - 2025-02-12

## Objectives
- Eliminate race conditions around lock leasing, fencing, and merge queue ordering.
- Harden `LockManager` and `Orchestrator` against stale leases and "ABA" problems (masked by monotonic fencing tokens).

## Findings
1. **Stale Lease Renewal**: The `LockManager.renew` method did not explicitly check if the lease had already expired before renewing it. This could allow a task to "resurrect" a lock that should have been considered free, potentially conflicting with a new owner who acquired it in the interim (though `ownerTaskId` check mitigates this, the token check is crucial).
2. **Expired Lease Acquisition**: `tryAcquireWrite` did not explicitly check if an existing lease was expired before rejecting a new request. It relied on the caller or garbage collection. We hardened this to allow "stealing" expired locks immediately.
3. **Orchestrator Merge Gap**: There was a potential gap between the last `validateFencing` check and the actual `git cherry-pick` / `commit --amend` operation in `Orchestrator.integrateCommit`. If the lease expired *during* that gap (however small), the commit would proceed with an invalid fencing token in the footer.

## Fixes Implemented

### 1. `src/scheduler/lock-manager.ts`
- **`tryAcquireWrite`**: Now explicitly checks `expiresAt <= now`. If an existing lease is expired, it is treated as non-existent, allowing a new task to acquire the lock immediately.
- **`renew`**: Added a strict check `if (new Date(current.lease.expiresAt).getTime() <= now) return false;`. This prevents extending a lease that has already lapsed, forcing the task to fail rather than proceed with a potentially invalid state.

### 2. `src/core/orchestrator.ts`
- **`integrateCommit`**: Added a final `lockManager.validateFencing(...)` check *inside* the `integrateCommit` method, immediately before the git operations. This ensures that the fencing token is valid at the exact moment of integration.

## Tests
- **`tests/unit/lock-race.test.ts`**:
  - `REGRESSION: verifies stale lease attempting merge is rejected if checked`: Simulates a slow merge queue where the lease expires before execution.
  - `REGRESSION: ensures concurrent writers are rejected and new writers can acquire after expiry`: Verifies that a second task can acquire a lock after the first task's lease expires.
  - `REGRESSION: confirms fencing token monotonicity across re-acquisitions`: Ensures fencing tokens strictly increase.
  - `REGRESSION: rejects renewal of expired lease`: (New) Verifies that `renew()` returns `false` if the lease is already expired.

## Risk Assessment
- **Low Risk**: The changes strictly tighten the validation logic. Deterministic ordering is preserved. The "stealing" of expired locks improves liveness but relies on the assumption that the original owner will fail its fencing check (which we ensured it does).

## Verification
- Ran `pnpm test tests/unit/lock-race.test.ts` - All passed.
- Ran `pnpm typecheck` - Pending final run.
