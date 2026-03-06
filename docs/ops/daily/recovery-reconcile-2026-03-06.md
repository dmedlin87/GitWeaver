# Recovery Reconciliation Audit - 2026-03-06

## Failure Modes Tested
1. **Partial Write / Rollback (Missing Commit):** Requeue tasks when DB says `MERGED` but git has no commit. Reason code: `RESUME_MISSING_COMMIT`.
2. **DB Lag (Git ahead of DB):** Use git as source of truth when DB says `RUNNING` but git has commit. Reason code: `RESUME_DB_LAG`.
3. **Sort determinism:** Verified that task iteration and requeuing returns deterministic arrays based on natural sort order of task IDs, despite git chronological log outputs.
4. **Drift Detection:** Emits drift and reports manual external commits since baseline.
5. **Event-log Precedence over DB without Git:** Emits `RESUME_ESCALATED_EVENT_LOG` when DB is `RUNNING` and event log is `ESCALATED`.
6. **DB Lag (Event-log ahead of DB):** DB `PENDING`, Event log `TASK_COMMIT_PRODUCED`, missing git. Reason code `RESUME_DB_LAG`.
7. **Ambiguous states:** DB `PENDING`, Event log `MERGED`, missing git. Reason code `RESUME_AMBIGUOUS_STATE`.
8. **Git over conflicting Event:** DB `RUNNING`, Event log `ESCALATED`, but git has commit. Reason code `RESUME_DB_LAG` (merged).
9. **ESCALATED State propagation:** DB `ESCALATED`, Event missing, git missing. Reason code `RESUME_ESCALATED_DB`.
10. **Crash Recovery:** DB `RUNNING`, Event missing, git missing. Reason code `RESUME_CRASH_RECOVERY`.
11. **Merge In-Flight Recovery:** DB `MERGE_QUEUED`, git missing. Reason code `RESUME_MERGE_IN_FLIGHT`.
12. **Merge In-Flight (Event Precedence):** DB `RUNNING`, Event log `TASK_MERGE_QUEUED`, git missing. Reason code `RESUME_MERGE_IN_FLIGHT`.

## Determinism Guarantees
- Confirmed: Git merge logic has explicit determinism ordering on tasks.
- Confirmed: Crash recovery safely skips auto-healing unknown states and explicitly maps to deterministic reason codes.
- Broken/Fixed: `MERGE_QUEUED` logic without git truth previously fell back into the generic `RESUME_CRASH_RECOVERY`.

## Fixes Applied
- `src/persistence/resume-reconcile.ts`: Introduced an `isMergeQueued()` check inside `resolveResumeEvidence()` to correctly emit `RESUME_MERGE_IN_FLIGHT` when dbTask or eventState states match `MERGE_QUEUED` but no git merge evidence exists.
- `tests/integration/resume-reconcile-failures.test.ts`: Added missing integration checks for `RESUME_MERGE_IN_FLIGHT` using both DB and event log state mismatches.