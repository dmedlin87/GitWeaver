# AGENTS.md — GitWeaver Orchestrator

> Universal agent instructions. All AI coding agents should read this file first.
> For architecture deep-dives, see `docs/`.

## Project Summary

GitWeaver Orchestrator is a local Node.js + TypeScript CLI that orchestrates
multi-model AI workflows across **Codex**, **Claude**, and **Gemini**. It reads a
repository, plans architectural changes as a DAG of tasks, executes them in
isolated git worktrees using specialized AI agents, and validates every change
against the existing test suite before merging.

## Tech Stack

- **Runtime**: Node.js >= 24.0.0
- **Language**: TypeScript 5.9 (strict mode, ES2023 target)
- **Module system**: ESM (`"type": "module"`)
- **Package manager**: pnpm 10
- **Test framework**: Vitest 4
- **Key deps**: Commander (CLI), Zod 4 (validation), node-pty (sandboxing),
  ts-morph (AST), minimatch (glob patterns), semver (version checks)
- **Persistence**: `node:sqlite` (built-in DatabaseSync) + NDJSON event logs
- **CI**: GitHub Actions (Node 24, pnpm 10, ubuntu-latest)

## Build / Test / Validate

```bash
pnpm install          # install deps (use --frozen-lockfile in CI)
pnpm build            # tsc -> dist/
pnpm typecheck        # tsc --noEmit (type-check only)
pnpm test             # vitest run (unit + integration + e2e)
pnpm dev run "prompt" # run CLI in dev mode via tsx (no build needed)
pnpm clean            # remove dist/ and .orchestrator/
```

CI runs: `pnpm typecheck && pnpm build && pnpm test`. All three must pass.

## Source Layout

```
src/
  cli/           CLI entry (Commander.js) and subcommands
  core/          Orchestrator state machine, types, config, shell, hashing
  planning/      DAG generation, context assembly, prompt envelopes, plan audit
  providers/     Adapter pattern for Claude/Codex/Gemini + health checks + routing
  execution/     Sandbox env filtering, PTY management, worktree lifecycle
  scheduler/     Lock leasing (fencing tokens), merge queue, priority queue, rate limiting
  verification/  Scope policy, command policy, output verification, staleness detection
  persistence/   SQLite layer, NDJSON event log, run manifest, resume reconciliation
  repair/        Failure classification, repair planning, budget tracking
  secure/        Advisory + secure execution wrappers
  observability/ Structured logging, metrics, redaction, event taxonomy

tests/
  unit/          32 test files — module-level behavior and edge cases
  integration/   5 test files — resume reconciliation, persistence workflows, provider storm
  e2e/           1 test file  — full CLI workflows
  benchmark/     1 test file  — worktree creation perf
```

### Key Entry Points

| What | File |
|------|------|
| Type system (TaskContract, DagSpec, RunRecord, etc.) | `src/core/types.ts` |
| CLI commands | `src/cli/main.ts` |
| Main orchestrator loop | `src/core/orchestrator.ts` |
| State machine transitions | `src/core/state-machine.ts` |
| Provider adapters | `src/providers/adapters/` |
| Database schema | `src/persistence/migrations/001_init.sql` |

## Conventions

### Code Style

- File naming: **kebab-case** (`sandbox-env.ts`, `lock-manager.ts`)
- Test naming: `<module>.test.ts` colocated under `tests/unit|integration|e2e/`
- No linter/formatter config — style is enforced through PR review
- Minimal code comments; architecture is conveyed via types and module boundaries
- Prefer small, focused modules over large files (exception: `orchestrator.ts`)

### State Machine

Runs flow through: `READY -> PLANNING -> ROUTED -> EXECUTING -> VERIFYING -> MERGED | FAILED`

Tasks flow through: `PENDING -> ASSIGNED -> EXECUTING -> VERIFYING -> COMMITTED -> MERGED | FAILED`

### Persistence Precedence

On resume, state is reconciled with this priority: **git > event log > SQLite**.

### Error Handling

- Reason codes classify failures (`src/core/reason-codes.ts`)
- Bounded repair budgets — no infinite retry loops
- Ambiguous resume states escalate rather than guess

### Scope and Security

- File scope enforcement via allowlist/blocklist glob patterns
- Command policy whitelisting
- Lock leasing with fencing tokens for concurrency safety
- Environment variable filtering in sandbox execution

## Git & PR Workflow

- Main branch: `master`
- Target PR size: 250–500 net LOC, 5–10 files, one operational theme
- Every PR must include tests proving the behavior
- CI gate: typecheck + build + test (all must pass)

## Current Development Focus

See `ROADMAP.md` for the canonical implementation delta and active priorities.
As of 2026-02-28, `ROADMAP.md` reports no open canonical gaps.

## Architecture Documentation

- `docs/cli_driven_heterogeneous_orchestrator_prd_technical_architecture_v_2_revised_final.md`
  is the canonical PRD/architecture spec.
- `ROADMAP.md` tracks the delta between the PRD and current implementation.
