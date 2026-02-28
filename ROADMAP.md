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
| P1 | Runtime/Persistence | SQLite contention hardening is functionally present but still needs explicit cross-platform stress evidence. | WAL + busy timeout + bounded retry telemetry remain enabled; add deterministic lock/contention stress tests proving behavior on Linux and Windows runners. |
| P1 | Runtime/Execution | Watchdog/forensic guarantees need stronger end-to-end coverage. | Add integration/e2e scenarios proving hung provider process termination path and policy-gated raw forensic capture semantics. |
| P2 | Observability | Stage-level latency telemetry exists but artifact/report surfacing is limited. | Provider/merge/gate timing histograms are summarized in run artifacts (manifest/summary) and asserted in tests. |
| P1 | Verification | Hardened failure matrix is still incomplete for specific disruption paths. | Add explicit scenarios for crash-mid-merge, watchdog hang, and drift-injection recovery behavior. |

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

## Recommended PR Sequence (Rebased)

Ideal PR size target:

- 250-500 net LOC
- 5-10 files
- one operational theme per PR
- includes tests proving behavior

### PR 1: Failure Matrix Expansion

- Scope: Add integration/e2e scenarios for crash-mid-merge, watchdog hang, and drift injection.
- Target size: 250-450 LOC, 4-7 files.
- Why first: closes highest-risk unverified failure windows.

### PR 2: Watchdog + Forensic E2E Hardening

- Scope: Validate hung process termination behavior and explicit forensic raw-log policy gating in end-to-end orchestration paths.
- Target size: 250-450 LOC, 5-8 files.
- Why second: converts current plumbing into operationally proven behavior.

### PR 3: Telemetry Artifact Surfacing

- Scope: Surface provider/merge/gate duration summaries in run artifacts and add assertions.
- Target size: 200-380 LOC, 4-7 files.
- Why third: improves diagnosability and makes regressions visible.

### PR 4: SQLite Contention Stress Matrix

- Scope: Add deterministic contention stress harness/tests and wire CI evidence for Linux/Windows contention behavior.
- Target size: 280-500 LOC, 5-9 files.
- Why fourth: completes durability evidence for high-concurrency writes.

## Execution Notes

- Keep each PR independently releasable.
- Avoid mixing large refactors with behavior changes.
- Prefer direct evidence (tests + artifacts) over inferred completion claims.