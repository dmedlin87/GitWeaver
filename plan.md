1. Audit the reconciliation algorithm in `src/persistence/resume-reconcile.ts` based on instructions: "In GitWeaver's crash recovery reconciliation (src/persistence/resume-reconcile.ts), if a task's database or event log state is MERGE_QUEUED but no corresponding git commit exists, the logic must explicitly emit the RESUME_MERGE_IN_FLIGHT reason code."
2. Write integration tests to trigger the divergence cases and verify that the exact reason code `RESUME_MERGE_IN_FLIGHT` is emitted for `MERGE_QUEUED` with missing commit.
3. Fix the algorithm to emit `RESUME_MERGE_IN_FLIGHT` instead of `RESUME_CRASH_RECOVERY` or missing code for `MERGE_QUEUED` missing commit case.
4. Also verify `RESUME_MISSING_COMMIT` if database/event log shows `MERGED` but no corresponding git commit exists.
5. Create docs/ops/daily/recovery-reconcile-<YYYY-MM-DD>.md with failure modes tested.
