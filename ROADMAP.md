# GitWeaver Roadmap (Doc-to-Code Delta)

Date: 2026-02-27
Compared against:
- `docs/cli_driven_heterogeneous_orchestrator_prd_technical_architecture_v_2_revised_final.md`
- `README.md`
- `src/**` and `tests/**`

## Current Status Summary

The core runtime exists and is functional: planning, routing, isolated worktrees, lock leasing with fencing, merge queue integration, scope checks, output verification, post-merge gate execution, repair budgeting, persistence, resume reconciliation, and provider preflight are implemented.

Major remaining work is not the basic pipeline, but PRD alignment hardening:
- stronger provenance/observability
- recovery precedence completeness
- scheduler resilience behavior under provider degradation
- watchdog/forensic execution guarantees
- hardened test matrix coverage

## Delivered In This PR Slice

- `ROADMAP.md` added with ordered PR slicing and target sizing.
- Merge lifecycle provenance strengthened:
  - explicit task states/events for `COMMIT_PRODUCED`, `MERGE_QUEUED`, and `MERGED`.
- Routing provenance strengthened:
  - route decisions are now persisted in `plan.routed.json` and emitted in `PLAN_FROZEN` event payload.
- Manifest provenance strengthened:
  - provider versions from preflight are now recorded in run manifest.

## Remaining Work (What Is Left)

| Priority | PRD Reference | Gap | Current Evidence |
|---|---|---|---|
| P0 | 16.2 Recovery Algorithm | Resume reconciliation does not fully apply precedence `git -> event log -> sqlite`; event log is only lightly consulted. | `src/persistence/resume-reconcile.ts` uses git + sqlite heavily, with minimal event-log influence. |
| P0 | 21. Hardened Test Matrix (7, 9) | No crash-mid-merge recovery test and no deterministic escalation payload test for bounded merge-conflict retries. | Missing integration/e2e coverage for those cases in `tests/**`. |
| P1 | 18.1 Run Manifest | Manifest still lacks provider capabilities and prompt template hash lineage. | Provider versions are now populated, but capability metadata/template lineage are still absent. |
| P1 | 10.1 Scheduler | No provider health backoff/score feedback loop under 429/timeout storm conditions. | Scheduler currently uses static token buckets and queue aging only. |
| P1 | 12.2 PtySubprocessManager | Raw-vs-normalized forensic log policy is not fully wired through runtime artifacts. | `PtyManager` can normalize output; runtime does not persist raw forensic streams. |
| P1 | 14.3 Staleness/Drift | Stale detection exists, but retry policy does not yet implement re-plan path when contract invalidation is detected. | `detectStaleness` + repair path present; no explicit re-plan branch. |
| P2 | 11.1 Context Assembler | Context pack does not yet include import-graph neighborhood/closure expansion beyond baseline + allowlist + consumed artifacts. | `src/planning/context-pack.ts` currently selects deterministic direct candidates only. |
| P2 | 21. Hardened Test Matrix (2, 3, 5, 6) | Missing stress/edge coverage for retry drift injection, symlink traversal, provider storm backoff, and hang watchdog retry behavior. | Existing tests cover pieces, but matrix is incomplete end-to-end. |

## Recommended PR Sequence (Ideal Size)

Ideal PR size target for this repo right now:
- 250-500 net LOC
- 5-10 files
- one operational theme per PR
- includes tests proving the behavior

### PR 1: Merge Lifecycle + Provenance Hardening
- Scope: add explicit merge lifecycle state/event provenance and route/manifest provenance improvements.
- Target size: 250-450 LOC, 6-9 files.
- Why first: low risk, high observability gain, unlocks later recovery and audit improvements.

### PR 2: Resume Precedence Completion
- Scope: fully apply `git -> event log -> sqlite` precedence, classify ambiguities deterministically, improve resume decision output.
- Target size: 300-500 LOC, 5-8 files.
- Why second: highest correctness risk reducer for crash recovery.

### PR 3: Scheduler Resilience Loop
- Scope: provider health scoring + temporary backoff + token adjustment behavior for repeated provider failures/timeouts.
- Target size: 300-550 LOC, 6-10 files.
- Why third: addresses reliability degradation under real load.

### PR 4: Watchdog and Forensic Logging
- Scope: explicit watchdog escalation path and optional raw forensic log persistence plumbing.
- Target size: 250-450 LOC, 5-8 files.
- Why fourth: improves operability without destabilizing orchestration semantics.

### PR 5: Staleness Re-plan Path
- Scope: when stale invalidates contract assumptions, trigger deterministic re-plan path instead of only narrow repair.
- Target size: 300-500 LOC, 6-9 files.
- Why fifth: closes stale-drift correctness loop.

### PR 6: Hardened Matrix Completion
- Scope: add missing matrix scenarios as integration/e2e tests.
- Target size: 250-450 LOC, 4-7 files.
- Why sixth: verification closure after behavior changes land.

## Execution Notes

- Keep each PR independently releasable.
- Avoid mixing large refactors with behavior changes.
- Each PR should add its own evidence in `docs/ops/daily/` once merged.
