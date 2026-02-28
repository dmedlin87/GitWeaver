# Architecture Drift Report - 2026-02-28

## Objective
Detect and fix drift between implementation and v2 architecture PRD (`docs/cli_driven_heterogeneous_orchestrator_prd_technical_architecture_v_2_revised_final.md`).

## Invariants Checked

| Invariant | Status | Verification Method |
|---|---|---|
| 1. Clean working tree at run start | **Enforced** | `isRepoClean` check in `orchestrator.ts`. |
| 2. Integration is commit-based only | **Enforced** | Uses `git cherry-pick`, no patch apply. |
| 3. Scope checks are canonical-path fail-closed | **Enforced** | `evaluateScope` uses canonical paths and strict allow/deny logic. |
| 4. Exit code is never sufficient for success | **Enforced** | Checks commit existence, scope, output verification, and post-merge gate. |
| 5. Post-merge gate is mandatory after every integration | **Enforced** | `runGate` called in merge queue after integration. |
| 6. Repair attempts are bounded and scope-narrowed | **Enforced** | Scope narrowing isolates repair changes effectively. |
| 7. Git history + event log are system of record | **Enforced** | `reconcileResume` logic prioritizes git/events over sqlite. |
| 8. Lock lease timeout fencing | **Enforced** | Fencing token validation in merge queue. |
| 9. On failure, rollback integration branch | **Gap Found & Fixed** | Missing rollback on gate/verification failure. Fix applied. |

## Gaps Found

### 1. Missing Integration Rollback on Gate/Verification Failure
In `src/core/orchestrator.ts`, the post-merge process integrates a task's commit into the main branch *before* running output verifications and post-merge gates. If the output verification or post-merge gate failed, the orchestrator threw an error, but left the integrated commit on the main branch. This violated invariant #6 in section `13.3 Integration Transaction (Saga)` which states: "On failure, rollback integration branch and emit deterministic failure event."

## Fixes Applied

### 1. Implement Safe Integration Rollback
- Modified `src/core/orchestrator.ts` in the `mergeQueue.enqueue` block.
- Wrapped `verifyTaskOutput` and `runGate` logic in a `try...catch` block.
- On caught `verificationError`, executes `git revert --no-commit <commitHash>` followed by `git commit -m "Revert \"<commitHash>\" due to verification failure"` and re-throws the error.
- Appends `TASK_INTEGRATION_ROLLBACK` event.
- This safely rolls back the integrated commit using non-destructive git commands, adhering to the project's strict constraints against destructive git operations.
- Added test coverage in `tests/unit/orchestrator-policy.test.ts`.

## Remaining Risks / Observations
- Rollback mechanisms using `git revert` leave commit artifacts in git history. This preserves system record auditability but may clutter the main branch if gate failures are frequent.
- Ensure that the execution environment provides sufficient timeout allocations for revert commands to complete cleanly under concurrent load.

## Verification
Ran `pnpm typecheck`, `pnpm build`, and `pnpm test` successfully. New unit tests verifying the revert sequence pass.
