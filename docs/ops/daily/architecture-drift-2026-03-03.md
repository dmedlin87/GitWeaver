# Daily Architecture Drift Report - 2026-03-03

## Invariants Checked
1. **Clean working tree at run start:** Enforced in `checkBaseline` via `isRepoClean`.
2. **Integration is commit-based only:** Enforced in `integrateCommit` using `git cherry-pick`.
3. **Scope checks are canonical-path fail-closed:** Enforced in `evaluateScope` via `canonicalize` logic.
4. **Exit code is never sufficient for success:** Enforced by parsing completion markers, verifying generated commits, testing output, and requiring a mandatory `runGate` execution.
5. **Post-merge gate is mandatory after every integration:** Enforced in `executeTask` where `runGate` is executed inside the merge queue logic.
6. **Repair attempts are bounded and scope-narrowed:** Enforced via `RepairBudget` limits and error extracting restricted to valid paths.
7. **Git history + event log are the system of record; SQLite is derived state:** Enforced via `reconcileResume`.
8. **Tasks must have a valid active lease token synchronously verified before entering the `MERGE_QUEUED` state:** Investigated and verified.

## Gaps Found
- The lock lease token wasn't synchronously re-validated exactly right before task integration through the `MergeQueue`.
- `MergeQueue.enqueue` accepted an optional `validate` function, but it executed the validation asynchronously inside the promise chain, which created a small race condition window for lease staling before execution.
- `src/core/orchestrator.ts` did not pass the synchronous validation check as the `validate` argument when queuing the task in `mergeQueue.enqueue`.

## Fixes Applied
1. Updated `MergeQueue.enqueue` in `src/scheduler/merge-queue.ts` to execute the `validate` function synchronously before creating the Promise chain, ensuring rapid failure for stale leases.
2. Updated `src/core/orchestrator.ts` to pass an anonymous function calling `lockManager.validateFencing` down to `mergeQueue.enqueue`, fully enforcing the active lease token invariant.
3. Updated the test `rejects entering MERGE_QUEUED if lease token expires` in `tests/unit/orchestrator-policy.test.ts` to mock validation returning false after the initial checks, correctly verifying the updated synchronous queue rejection path.
4. Updated test expectation in `tests/unit/lock-manager.test.ts` to catch the new error message format resulting from the synchronous `validate` refactor (`Stale lease: validation failed before queueing`).

## Remaining Risks
- The `node-pty` environment can fail under heavy load or Windows process-tree kills, dropping exit markers. The `watchdog` provides fallback but requires precise OS level configurations.
- `minimatch` compilation was optimized to prevent N*M loops, but file canonicalization (especially on symlink-heavy directories) remains O(N). If commits affect 10k+ files, memory parsing could still cause minor OOM exceptions.
