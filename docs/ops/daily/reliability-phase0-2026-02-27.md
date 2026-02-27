# Reliability Program Phase 0 - 2026-02-27

## Objective
Create a single source of truth for reliability-first work after validating the external architecture review against the current codebase.

## Corrections Applied

- Marked these as already shipped:
  - dry-run CLI mode
  - AST-backed output verification using `ts-morph`
  - resume precedence `git -> event log -> sqlite`
- Replaced stale roadmap deltas that still listed resume precedence as incomplete.

## Canonical Gap List

1. SQLite contention hardening (`WAL`, `busy_timeout`, bounded busy retry telemetry).
2. Provider health feedback + cooldown circuit breakers.
3. Security boundary enforcement in runtime path + optional container execution mode.
4. Watchdog/forensics completion with policy-gated raw output capture.
5. Merge-in-flight checkpoint awareness during resume.
6. Stale re-plan branch beyond narrow repair.
7. Hardened test matrix completion.

## Acceptance Discipline

- Each slice must remain independently releasable.
- Every behavior change must include tests in the same PR.
- CI gate remains `pnpm typecheck && pnpm build && pnpm test` with no relaxations.
