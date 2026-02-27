# Daily Recovery Reconciliation Report - 2026-02-27

## Audit Findings

A review of the reconciliation algorithm in `src/persistence/resume-reconcile.ts` revealed a bug in how merged tasks were identified from Git history. The logic relied on a regex `match` that only captured the first `ORCH_TASK_ID` in a commit message. This caused issues with squash merges or any commit containing multiple task IDs, as only the first one would be recognized as merged.

## Failure Modes Tested

1. **Squash Merge with Multiple Tasks**:
   - **Scenario**: A single commit contains multiple `ORCH_TASK_ID` entries (e.g., a squash merge of a feature branch).
   - **Previous Behavior**: Only the first task ID was identified as merged. Subsequent tasks were considered missing from Git and potentially requeued or flagged as DB lag.
   - **Fix**: Updated the regex logic to use `matchAll` with the global flag `g` to capture all occurrences of `ORCH_TASK_ID`.
   - **Result**: All tasks in a squash commit are now correctly identified as merged.

2. **Manual Merge Missing Metadata**:
   - **Scenario**: A commit exists in Git but lacks the `ORCH_RUN_ID` or `ORCH_TASK_ID` metadata, while the DB marks the task as `MERGED`.
   - **Behavior**: The task is correctly identified as missing from Git (due to missing metadata) and flagged with `RESUME_MISSING_COMMIT`. This ensures strict adherence to metadata requirements for provenance.

## Determinism Guarantees

- **Git as Source of Truth**: The system continues to prioritize Git history. If a task is not found in Git (due to missing commit or missing metadata), it is treated as not merged, regardless of DB state.
- **Sort Order**: Task processing order remains deterministic by sorting task IDs before reconciliation.
- **Fix Impact**: The fix improves determinism by ensuring that the *complete* set of merged tasks is derived from Git, removing ambiguity for squash merges.

## Code Changes

- **File**: `src/persistence/resume-reconcile.ts`
- **Change**: Replaced `chunk.match(...)` with `chunk.matchAll(...)` and iterated over results to populate the set of merged task IDs.

## Test Changes

- **File**: `tests/integration/resume-reconcile-squash.test.ts`
- **New Tests**: Added specific test cases for squash merges and missing metadata scenarios to prevent regression.
