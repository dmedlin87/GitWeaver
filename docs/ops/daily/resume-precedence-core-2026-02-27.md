# Resume Precedence Core - 2026-02-27

## Objective
Ship the first implementation slice for Roadmap PR 2 ("Resume Precedence Completion") by applying deterministic `git -> event log -> sqlite` ordering in resume reconciliation.

## Changes

- Updated `src/persistence/resume-reconcile.ts` to:
  - Reconstruct per-task state from event log (`TASK_*` events).
  - Reconcile each task using explicit precedence:
    1. git merged truth
    2. event-log task state
    3. sqlite task snapshot
  - Escalate ambiguous cases where event log claims merged/verified but git has no merge proof.
  - Include event-only tasks in resume outputs so sqlite lag does not drop recoverable work.
- Added reason code `RESUME_AMBIGUOUS_STATE` in `src/core/reason-codes.ts`.
- Expanded integration coverage in `tests/integration/resume-reconcile-failures.test.ts` for:
  - event-log precedence over sqlite
  - event-only task recovery
  - deterministic ambiguous-state escalation
  - git precedence over conflicting event data

## Verification

- `npm test -- tests/integration/resume-reconcile.test.ts tests/integration/resume-reconcile-failures.test.ts`
- `npm run typecheck`

Both commands passed.
