# GitWeaver Roadmap (Doc-to-Code Delta)

Date: 2026-02-28
Compared against:

- `docs/cli_driven_heterogeneous_orchestrator_prd_technical_architecture_v_2_revised_final.md`
- `README.md`
- `src/**` and `tests/**`
- `C:\Users\dmedl\Downloads\deep-research-report.md` (legacy/other GitWeaver lineage; only transferable recommendations applied)
- `C:\Users\dmedl\Documents\deep-research-report.md` (repo-specific audit; recommendations triaged against current implementation)

## Current Status Summary

The core runtime exists and is functional: planning, routing, isolated worktrees, lock leasing with fencing, merge queue integration, scope checks, output verification, post-merge gate execution, repair budgeting, persistence, resume reconciliation, and provider preflight are implemented.

Major remaining work is not the basic pipeline, but PRD alignment hardening:

- SQLite contention/durability hardening
- scheduler resilience behavior under provider degradation
- security boundary enforcement (host filtering + optional container mode)
- watchdog/forensic execution guarantees
- stale re-plan flow and hardened matrix coverage

## Delivered In This PR Slice

- `ROADMAP.md` added with ordered PR slicing and target sizing.
- Merge lifecycle provenance strengthened:
  - explicit task states/events for `COMMIT_PRODUCED`, `MERGE_QUEUED`, and `MERGED`.
- Routing provenance strengthened:
  - route decisions are now persisted in `plan.routed.json` and emitted in `PLAN_FROZEN` event payload.
- Manifest provenance strengthened:
  - provider versions from preflight are now recorded in run manifest.
- Resume precedence core implemented:
  - deterministic per-task reconciliation now applies `git -> event log -> sqlite` precedence.
  - ambiguous event-vs-git merged claims now escalate with `RESUME_AMBIGUOUS_STATE`.
  - event-only tasks are recovered into deterministic resume requeue output.
- Recovery precedence coverage expanded:
  - integration tests now cover event-log precedence, event-only recovery, ambiguous escalation, and git-over-event conflict resolution.

## Validated Gaps (Canonical)

Completed and explicitly removed from “remaining work”:

- Dry-run mode is already implemented (`src/cli/commands/run.ts`).
- AST-backed output checks are already implemented (`src/verification/output-verifier.ts` with `ts-morph`).
- Resume precedence `git -> event log -> sqlite` is already implemented and integration-tested (`tests/integration/resume-reconcile*.test.ts`).

Canonical remaining gaps (owner + acceptance criteria):

| Priority | Owner | Gap | Acceptance Criteria |
| --- | --- | --- | --- |
| P0 | Runtime/Persistence | SQLite contention and deterministic retry handling under `SQLITE_BUSY`. | WAL + busy timeout configured, bounded retry telemetry emitted, stress tests green on Windows/Linux. |
| P0 | Runtime/Scheduler | Provider health feedback and cooldown circuit breaker under 429/timeout storms. | Backoff/cooldown routing tests pass; provider recovery path proven; no retry storm loops. |
| P1 | Runtime/Security | Secure executor path wiring and optional container execution mode for policy enforcement. | Env filtering active for provider/gate calls; container mode enforces network policy; host mode remains backward-compatible. |
| P1 | Runtime/Security | Container isolation hardening controls are not yet enforced in `runInContainer`. | Container args include configurable memory/CPU limits, non-root user, capability drop, and optional read-only rootfs; docker/podman arg-composition tests pass. |
| P1 | Runtime/Execution | Watchdog + forensic raw log capture complete and policy-gated. | Raw logs only persisted when enabled; normalized redacted output remains default artifact. |
| P1 | Runtime/Recovery | Explicit merge-in-flight checkpoint handling in resume path. | Deterministic resume decision includes checkpoint-aware requeue behavior. |
| P1 | Runtime/Scheduler | Deterministic lock-key ordering and bounded contention backoff are not explicit. | Resource keys are normalized/sorted before lock acquisition; overlapping-scope contention tests prove no starvation regressions. |
| P2 | Runtime/Repair | Staleness-triggered re-plan branch (beyond narrow repair). | Tests prove stale-drift path chooses re-plan branch deterministically. |
| P2 | Observability | Stage-level latency telemetry is underutilized despite metric primitives. | Provider, merge, and gate timers emit labeled histograms and appear in run artifacts for regressions/debugging. |
| P2 | Verification | Hardened matrix completion (crash-mid-merge, provider storm, watchdog hang, drift injection). | Missing matrix scenarios covered by integration/e2e tests, including host/container execution matrix and `--dry-run` smoke path. |

## Legacy External Report Crosswalk (Transferable Upgrades)

The deep-research report at `C:\Users\dmedl\Downloads\deep-research-report.md` targets an archived Dreamweaver extension, not this Node.js/TypeScript orchestrator. Runtime architecture findings from that report are not directly applicable here. The following upgrades are still transferable and currently missing in this repo.

| Priority | Owner | Gap | Acceptance Criteria |
| --- | --- | --- | --- |
| P0 | Maintainers/Governance | Repository governance baseline is incomplete (`LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` missing). | Governance files added at repo root; README links to each; policies are concise and project-specific. |
| P1 | Maintainers/Collaboration | Contribution intake scaffolding is missing (`.github/ISSUE_TEMPLATE/*`, PR template, `CODEOWNERS`). | Bug/feature templates + PR template live under `.github`; CODEOWNERS assigns at least one default owner per top-level area. |
| P1 | Maintainers/Security | Dependency/security automation is missing (`.github/dependabot.yml`, CodeQL workflow). | Dependabot enabled for npm + GitHub Actions ecosystem; CodeQL workflow runs on PR/push; failures visible in checks. |
| P2 | Maintainers/Release | Release hygiene is incomplete (no `CHANGELOG.md`, no release checklist/workflow). | Changelog policy documented and seeded; release checklist documented; optional release workflow publishes tagged artifacts. |
| P2 | Maintainers/Docs | README lacks operational trust signals (badges + explicit support/policy links). | README includes CI badge(s), Node/pnpm support matrix, and direct links to governance/security docs. |

## Repo-Specific Report Crosswalk (C:\Users\dmedl\Documents\deep-research-report.md)

The repo-specific audit aligns with most canonical runtime gaps already listed above (provider degradation handling, stale re-plan behavior, and matrix hardening). Net-new roadmap deltas from that report are:

| Priority | Owner | Gap | Acceptance Criteria |
| --- | --- | --- | --- |
| P1 | Runtime/Security | Container runner lacks explicit isolation controls beyond network policy. | `runInContainer` supports and enforces resource/isolation flags via config; unit tests assert final runtime arguments. |
| P1 | Runtime/Scheduler | Lock acquisition ordering/backoff behavior should be deterministic under overlapping scopes. | Sorted lock-key acquisition and bounded contention retry strategy implemented; overlap contention tests are stable across platforms. |
| P2 | Observability | Metrics timers exist but are not fully wired through orchestration stages. | Stage timing histograms are emitted with run/task labels and surfaced in summary/manifest output. |
| P2 | Verification/CI | CI does not yet validate both execution modes and dry-run path as first-class matrix targets. | Workflow executes host + container mode test paths and a dry-run smoke scenario on pull requests. |

## Recommended PR Sequence (Ideal Size)

Ideal PR size target for this repo right now:

- 250-500 net LOC
- 5-10 files
- one operational theme per PR
- includes tests proving the behavior

### PR 1: SQLite Contention Hardening

- Scope: WAL/synchronous/busy-timeout configuration and bounded busy retry telemetry.
- Target size: 250-450 LOC, 5-8 files.
- Why first: highest immediate stability win under concurrent orchestration writes.

### PR 2: Scheduler Resilience Loop

- Scope: provider health scoring + temporary backoff + token adjustment behavior for repeated provider failures/timeouts.
- Target size: 300-550 LOC, 6-10 files.
- Why second: addresses reliability degradation under real load.

### PR 3: Security Boundary Enforcement + Optional Container Mode

- Scope: wire secure executor in provider/gate paths, add optional container execution mode, and enforce container runtime hardening flags (memory/cpu, user, caps, optional read-only rootfs).
- Target size: 350-650 LOC, 7-12 files.
- Why third: security hardening without forcing a breaking runtime default.

### PR 4: Watchdog and Forensic Logging

- Scope: explicit watchdog escalation path and optional raw forensic log persistence plumbing.
- Target size: 250-450 LOC, 5-8 files.
- Why fourth: improves operability without destabilizing orchestration semantics.

### PR 5: Resume Merge-In-Flight Checkpoints

- Scope: persist integration checkpoints and use them during resume reconciliation.
- Target size: 250-450 LOC, 5-8 files.
- Why fifth: closes crash-window ambiguity around merge queue/integration handoff.

### PR 6: Staleness Re-plan Path

- Scope: when stale invalidates contract assumptions, trigger deterministic re-plan path instead of only narrow repair.
- Target size: 300-500 LOC, 6-9 files.
- Why sixth: closes stale-drift correctness loop.

### PR 7: Hardened Matrix Completion

- Scope: add missing matrix scenarios as integration/e2e tests.
- Target size: 250-450 LOC, 4-7 files.
- Why seventh: verification closure after behavior changes land.

### PR 8: Governance Baseline

- Scope: add `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`; link all from README.
- Target size: 180-350 LOC, 4-7 files.
- Why eighth: low-risk legal/community clarity with immediate contributor impact.

### PR 9: Collaboration Templates + CODEOWNERS

- Scope: add issue templates, PR template, and `CODEOWNERS` with clear ownership defaults.
- Target size: 150-300 LOC, 4-8 files.
- Why ninth: improves issue quality and review routing with minimal runtime risk.

### PR 10: Security/Dependency Automation

- Scope: add `.github/dependabot.yml` and CodeQL workflow; verify both appear as checks.
- Target size: 120-260 LOC, 2-4 files.
- Why tenth: closes a current automation gap for dependency and static security scanning.

### PR 11: Release Hygiene

- Scope: add `CHANGELOG.md`, release checklist in docs, and optional release workflow draft.
- Target size: 180-320 LOC, 3-6 files.
- Why eleventh: establishes repeatable release provenance before broader adoption.

### PR 12: README Trust Signals

- Scope: add CI/status badges, support matrix, and governance/security links.
- Target size: 80-180 LOC, 1-2 files.
- Why twelfth: improves onboarding and maintenance clarity at low cost.

### PR 13: Lock Ordering + Contention Backoff

- Scope: normalize/sort resource keys pre-lock, add bounded contention backoff semantics, and add overlap contention tests.
- Target size: 220-420 LOC, 4-8 files.
- Why thirteenth: closes a deterministic concurrency-risk gap that can appear under heavier parallel load.

### PR 14: Stage Telemetry + CI Mode Matrix

- Scope: wire stage timers/histograms into orchestrator lifecycle and extend CI with host/container mode plus `--dry-run` smoke coverage.
- Target size: 260-480 LOC, 5-9 files.
- Why fourteenth: improves operational diagnosability and catches execution-mode regressions earlier.

## Execution Notes

- Keep each PR independently releasable.
- Avoid mixing large refactors with behavior changes.
- Each PR should add its own evidence in `docs/ops/daily/` once merged.
