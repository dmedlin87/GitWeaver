# Recovery Reconciliation Audit: 2026-03-07

## Failure Modes Tested
1. **Partial DB Write (Missing Git Commit) for `MERGE_QUEUED` State:**
   - Evaluated the scenario where the local DB state logs `MERGE_QUEUED` but the respective `git` commit does not exist (indicating the system crashed during `git` merging).
2. **Partial Event Log Write (Missing Git Commit) for `MERGE_QUEUED` State:**
   - Evaluated the scenario where the event logs register a `TASK_MERGE_QUEUED` event but no `git` commit corresponds to the task's action.

## Determinism Guarantees Confirmed
- Correctly and deterministically emits the `RESUME_MERGE_IN_FLIGHT` reason code for any occurrence of a partial merge state (`MERGE_QUEUED` state recorded without corresponding `git` commits) instead of masking the error under the `RESUME_CRASH_RECOVERY` default.

## Code/Test Changes
- Modified `resolveResumeEvidence` in `src/persistence/resume-reconcile.ts` to assert whether an event state or DB task state equals `MERGE_QUEUED` before concluding `RESUME_CRASH_RECOVERY`.
- Updated unit test mock of `buildPromptEnvelope` in `tests/unit/orchestrator-policy.test.ts` and `tests/integration/watchdog-hang-recovery.test.ts` to supply an empty array to `mutableSections` to avoid test failures.
- Created `RESUME_MERGE_IN_FLIGHT` related integration tests inside `tests/integration/resume-reconcile.test.ts` to enforce deterministic test checks.
- Altered `tests/integration/resume-reconcile-failures.test.ts` to correctly expect `RESUME_MERGE_IN_FLIGHT` rather than `RESUME_CRASH_RECOVERY`.
