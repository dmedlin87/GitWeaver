# Daily Recovery Reconciliation Audit

**Date:** 2026-02-28
**Agent:** Daily Resume and Recovery Reconciliation Agent

## Failure Modes Tested
Audited the reconciliation algorithm for divergence cases. The following real-world failure cases have been added to the test suite:
- `dbTask` is `ESCALATED`, Event is `ESCALATED`, but there is no git proof (escalate with reason `RESUME_ESCALATED_EVENT_LOG`).
- `dbTask` is `RUNNING`, Event is `RUNNING`, but there is no git proof (requeue with reason `RESUME_CRASH_RECOVERY`).
- `dbTask` is `ESCALATED`, but there is no git proof and no event log available (escalate with reason `RESUME_ESCALATED_DB`).

## Determinism Guarantees Confirmed
Confirmed that `git log` and event logs remain the ultimate sources of truth and take precedence over partial SQLite state. Tasks falling into undefined partial states are explicitly assigned deterministic reason codes instead of silently auto-healing, enforcing predictability in crash recovery logic. Re-queued or escalated actions explicitly map to machine-readable reason codes.

## Code and Test Changes
- **src/core/reason-codes.ts**: Added `RESUME_CRASH_RECOVERY`, `RESUME_ESCALATED_DB`, and `RESUME_ESCALATED_EVENT_LOG` reason codes.
- **src/persistence/resume-reconcile.ts**: Updated the fallback and escalator paths in `resolveResumeEvidence` to surface exact reason codes rather than silently auto-healing or escalating.
- **tests/integration/resume-reconcile-failures.test.ts**: Added 3 explicit tests covering cases where events or DB suggest `ESCALATED` or `RUNNING` alongside no git log presence.
