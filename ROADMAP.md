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

Only items with remaining implementation or evidence gaps are listed below.

| Priority | Owner | Gap | Acceptance Criteria |
| --- | --- | --- | --- |
| P1 | Runtime/Execution | Watchdog/forensic guarantees need stronger end-to-end coverage. | Add integration/e2e scenarios proving hung provider process termination path and policy-gated raw forensic capture semantics. |
| P1 | Verification | Hardened failure matrix is still incomplete for watchdog-hang disruption path. | Add explicit integration/e2e scenario for watchdog-hang recovery behavior. (Crash-mid-merge and drift-injection are already covered in `tests/integration/resume-reconcile-failures.test.ts`.) |

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

## Recommended PR Sequence (Rebased)

Ideal PR size target:

- 250-500 net LOC
- 5-10 files
- one operational theme per PR
- includes tests proving behavior

### PR 1: Watchdog-Hang Integration/E2E Coverage

- Scope: Add integration/e2e scenario for watchdog-hang recovery (the remaining unverified failure path). Crash-mid-merge and drift-injection are already covered.
- Target size: 150-300 LOC, 3-5 files.
- Why first: closes the last high-risk unverified failure window.

### PR 2: Watchdog + Forensic E2E Hardening

- Scope: Validate hung process termination behavior and explicit forensic raw-log policy gating in end-to-end orchestration paths.
- Target size: 250-450 LOC, 5-8 files.
- Why second: converts current plumbing into operationally proven behavior.

## Execution Notes

- Keep each PR independently releasable.
- Avoid mixing large refactors with behavior changes.
- Prefer direct evidence (tests + artifacts) over inferred completion claims.