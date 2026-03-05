# Recovery Reconciliation Audit - 2026-03-05

## Failure Modes Tested
1. **In-Flight Merges (DB state `MERGE_QUEUED` with Missing Commit):**
   - *Scenario:* A task's state in SQLite (`MERGE_QUEUED`) indicates it was attempting to merge, but no corresponding commit exists in the Git baseline.
   - *Impact:* Before the fix, this scenario either resulted in a generic `RESUME_CRASH_RECOVERY` requeue or lacked explicitly defined escalation behavior, creating ambiguity about the state of the Git index and worktree.
   - *Result:* Correctly emits `RESUME_MERGE_IN_FLIGHT` reason code, allowing the orchestrator to unambiguously know a merge crashed mid-flight.

2. **In-Flight Merges (Event Log state `TASK_MERGE_QUEUED` with Missing Commit):**
   - *Scenario:* A task's state in the NDJSON Event Log (`TASK_MERGE_QUEUED`) indicates it was attempting to merge, but no corresponding commit exists in the Git baseline.
   - *Impact:* Before the fix, this scenario could also result in ambiguous or generic crash recovery codes.
   - *Result:* The logic consistently uses the `RESUME_MERGE_IN_FLIGHT` reason code whenever the event log reveals that a merge attempt was interrupted.

## Determinism Guarantees Confirmed/Broken
- **Confirmed:** The Git history remains the ultimate source of truth. If a commit is missing, the system will never implicitly assume the merge succeeded.
- **Confirmed:** Reason codes are emitted deterministically for every reconciliation edge case. We do not rely on implicit fallbacks or auto-healing.
- **Confirmed:** Event Log precedence logic remains intact for determining the intent of crashed operations.
- **Broken:** None observed during this iteration.

## Code/Test Changes
- **`src/persistence/resume-reconcile.ts`**:
  - Updated `resolveResumeEvidence` to explicitly check if `eventState?.state === "MERGE_QUEUED" || dbTask?.state === "MERGE_QUEUED"`.
  - Added emission of the `RESUME_MERGE_IN_FLIGHT` reason code for this specific edge case when no Git commit is found.
- **`tests/integration/resume-reconcile.test.ts`**:
  - Added a new integration test `"requeues with RESUME_MERGE_IN_FLIGHT when db or event log shows merge queued but git is missing commit"`.
  - The test generates divergent DB state and Event Log state for two separate tasks without corresponding Git commits and asserts that both tasks return `{ action: 'requeue' }` with `RESUME_MERGE_IN_FLIGHT`.
