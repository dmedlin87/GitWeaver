# Architecture Drift Guardian Report - 2026-03-01

## Invariants Checked
- "No task may enter `MERGE_QUEUED` without a valid active lease token."

## Gaps Found
- The codebase in `src/core/orchestrator.ts` verified the lock only *after* enqueuing the merge, but did not perform a revalidation check before updating the `record.state` to `MERGE_QUEUED`. A race condition could theoretically allow a task whose lock has expired to enter the `MERGE_QUEUED` state, violating the PRD's explicit invariant.

## Fixes Applied
- Added a synchronous validation loop using `lockManager.validateFencing` immediately prior to assigning `record.state = "MERGE_QUEUED";` in `src/core/orchestrator.ts`. If the lock has expired, it now directly throws `REASON_CODES.LOCK_TIMEOUT`.
- Added a corresponding test in `tests/unit/orchestrator-policy.test.ts` to simulate and assert this specific transition path (`rejects entering MERGE_QUEUED if lease token expires`).

## Remaining Risks
- Relying on Javascript's single threaded nature, there's no atomic way to read lock validity, update local state, queue async merge, then merge to the system without other things occurring in between if delays happen elsewhere. Though the locks remain validated again within `mergeQueue.enqueue`, other tasks could potentially re-acquire an expired lock before this queue executes.
