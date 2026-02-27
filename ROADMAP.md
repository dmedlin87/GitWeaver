# GitWeaver Roadmap (Doc-to-Code Delta)

Date: 2026-02-27
Compared against:

- `docs/cli_driven_heterogeneous_orchestrator_prd_technical_architecture_v_2_revised_final.md`
- `README.md`
- `src/**` and `tests/**`

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
| P1 | Runtime/Execution | Watchdog + forensic raw log capture complete and policy-gated. | Raw logs only persisted when enabled; normalized redacted output remains default artifact. |
| P1 | Runtime/Recovery | Explicit merge-in-flight checkpoint handling in resume path. | Deterministic resume decision includes checkpoint-aware requeue behavior. |
| P2 | Runtime/Repair | Staleness-triggered re-plan branch (beyond narrow repair). | Tests prove stale-drift path chooses re-plan branch deterministically. |
| P2 | Verification | Hardened matrix completion (crash-mid-merge, provider storm, watchdog hang, drift injection). | Missing matrix scenarios covered by integration/e2e tests. |

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
- Why third: addresses reliability degradation under real load.

### PR 3: Security Boundary Enforcement + Optional Container Mode

- Scope: wire secure executor in provider/gate paths and add optional container execution mode.
- Target size: 300-550 LOC, 6-10 files.
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
- Why fifth: closes stale-drift correctness loop.

### PR 7: Hardened Matrix Completion

- Scope: add missing matrix scenarios as integration/e2e tests.
- Target size: 250-450 LOC, 4-7 files.
- Why sixth: verification closure after behavior changes land.

## Execution Notes

- Keep each PR independently releasable.
- Avoid mixing large refactors with behavior changes.
- Each PR should add its own evidence in `docs/ops/daily/` once merged.
