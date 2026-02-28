# GitWeaver Roadmap (Doc-to-Code Delta)

Date: 2026-02-28
Compared against:

- `docs/cli_driven_heterogeneous_orchestrator_prd_technical_architecture_v_2_revised_final.md`
- `README.md`
- `src/**` and `tests/**`

## Current Status Summary

Core runtime capabilities are implemented and test-backed across planning, routing, isolated worktrees, lock leasing with fencing, merge queue integration, scope checks, output verification, post-merge gates, repair budgeting, persistence, and resume reconciliation.

Several items previously listed as "remaining" are now implemented in code/tests and have been removed from the active gap list (provider degradation handling, secure executor/container mode wiring, container hardening flags, merge-in-flight checkpoint handling, lock-ordering/backoff behavior, staleness-triggered replanning, governance/docs/security automation baseline).

## Active Canonical Gaps

No open gaps remain. All previously identified items are now implemented and test-backed.

## Completed Since Prior Revision

The following roadmap items are implemented and should no longer be tracked as open gaps:

- Provider health feedback, cooldown, and degradation rerouting under 429/timeout storms.
- Secure executor wiring + optional host/container execution mode.
- Container isolation controls in `runInContainer` (memory/cpu/user/cap-drop/read-only-rootfs).
- Resume merge-in-flight checkpoint persistence and checkpoint-aware resume handling.
- Deterministic lock-key ordering and bounded lock contention backoff.
- Staleness-triggered replan path.
- Governance and collaboration baseline files (`LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, templates, CODEOWNERS).
- Security automation baseline (Dependabot + CodeQL workflow).
- Release hygiene/trust signals (`CHANGELOG.md`, release checklist/workflow, README policy links/badges).
- SQLite contention hardening: WAL + busy timeout + bounded retry on Linux and Windows CI runners; deterministic lock/contention stress tests in `tests/unit/sqlite.test.ts`.
- Stage-level latency telemetry: provider/merge/gate timing written to run manifest/summary in `src/core/orchestrator.ts` and asserted in `tests/unit/orchestrator-provenance.test.ts`.
- Watchdog-hang recovery + forensic raw-log policy gating: integration scenarios in `tests/integration/watchdog-hang-recovery.test.ts` prove hung provider termination path (EXEC_FAILED propagation, TASK_PROVIDER_HEARTBEAT emission during stall, heartbeat interval teardown) and policy-gated forensic capture (`forensicRawLogs=true/false`). Config-acceptance smoke tests added to `tests/e2e/cli-extended.e2e.test.ts`.

## Recommended PR Sequence (Rebased)

All previously queued PRs have landed. No pending PR work remains.

## Execution Notes

- Keep each PR independently releasable.
- Avoid mixing large refactors with behavior changes.
- Prefer direct evidence (tests + artifacts) over inferred completion claims.