# Architecture Drift Report - 2026-02-26

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
| 6. Repair attempts are bounded and scope-narrowed | **Gap Found & Fixed** | Scope narrowing was naive (reusing full allow list). Fix applied. |
| 7. Git history + event log are system of record | **Enforced** | `reconcileResume` logic prioritizes git/events over sqlite. |
| 8. Lock lease timeout fencing | **Enforced** | Fencing token validation in merge queue. |

## Gaps Found

### 1. Repair Scope Narrowing
The implementation of `buildRepairTask` in `orchestrator.ts` was passing the original task's full `writeScope.allow` list as both `changedFiles` and `errorFiles`. This resulted in repair tasks having the same broad scope as the original task, violating the invariant "Repair attempts are ... scope-narrowed".

### 2. Failure Classification
`LOCK_TIMEOUT` and `STALE_TASK` errors were falling through to the default `VERIFY_FAIL_COMPILE` classification because they were not explicitly handled in `classifyFailure`. This could lead to incorrect budgeting or reporting.

## Fixes Applied

### 1. Implement Scope Narrowing
- Added `extractFilesFromError` helper in `src/verification/error-extractor.ts` to scan error logs for relevant file paths.
- Updated `Orchestrator.executeTask` to:
  - Extract `changedFiles` from the failed task's commit (if any).
  - Extract `errorFiles` from the error message using the helper.
  - Calculate `narrowedFiles` as the union of changed and error files.
  - Pass the narrowed list to `buildRepairTask`.

### 2. Enhance Failure Classification
- Updated `src/repair/failure-classifier.ts` to explicitly recognize `LOCK_TIMEOUT` and `STALE_TASK` reason codes.
- Added `tests/unit/scope-narrowing.test.ts` to verify the new logic.

## Remaining Risks / Observations

- **Prompt Drift**: The PRD requirement for "Prompt Drift" check (asserting immutable section hash remains constant) is currently **enforced by design** because the system does not perform in-place retries of the same task ID (except for creating new "Repair Tasks" which have new IDs). If in-place retry logic is added in the future, explicit drift checks must be integrated.
- **Integration Testing**: The fixes were verified via unit tests for the extraction and classification logic. End-to-end behavior of the repair loop with actual git commits depends on existing integration tests passing.

## Verification
Ran `pnpm test` successfully. New unit tests pass.
