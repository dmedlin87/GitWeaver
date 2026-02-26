# Daily Recovery Reconciliation Report - 2026-02-26

## Failure Modes Tested

We have introduced explicit testing for the following reconciliation failure modes:

1.  **Partial Write / Rollback (DB=MERGED, Git=Missing)**
    *   **Scenario**: The database has marked a task as `MERGED` or `VERIFIED`, but the corresponding commit is missing from the Git history (e.g., commit failed or was lost).
    *   **Resolution**: The system correctly identifies this as a missing commit and requeues the task for execution.
    *   **Reason Code**: `RESUME_MISSING_COMMIT` is now emitted in the resume summary.

2.  **DB Lag (DB=PENDING, Git=Present)**
    *   **Scenario**: The database shows a task as `PENDING` or `RUNNING`, but the commit is present in the Git history (e.g., DB update failed after successful commit).
    *   **Resolution**: The system correctly identifies the task as merged based on Git truth.
    *   **Reason Code**: `RESUME_DB_LAG` is recorded for these tasks to indicate the state correction.

## Determinism Guarantees

To ensure deterministic behavior across resume attempts, we have implemented sorting for all output lists in `reconcileResume`:

*   `mergedTaskIds`: Sorted lexicographically.
*   `requeueTaskIds`: Sorted lexicographically.
*   `escalatedTaskIds`: Sorted lexicographically.

This ensures that regardless of the order of tasks in the database or commits in the git log, the resulting decision structure is identical.

## Code and Test Changes

*   **Modified `src/core/reason-codes.ts`**: Added `RESUME_MISSING_COMMIT` and `RESUME_DB_LAG`.
*   **Modified `src/persistence/resume-reconcile.ts`**:
    *   Added `reasons` field to `ResumeDecision`.
    *   Implemented logic to populate reason codes for divergence cases.
    *   Added sorting to all task ID lists.
*   **Modified `src/core/orchestrator.ts`**: Included `reconcileReasons` in the resume command summary output.
*   **Added `tests/integration/resume-reconcile-failures.test.ts`**: New integration tests verifying failure mode handling and determinism (sorting).
