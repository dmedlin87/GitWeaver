# Architecture Reference

This page describes the internal module structure and key source files for contributors and advanced users.

## Module Map

```
src/
  cli/              CLI entry point and subcommands
  core/             Orchestrator state machine, types, config, shell, hashing
  planning/         DAG generation, context assembly, prompt envelopes, plan audit
  providers/        Adapter pattern for Claude/Codex/Gemini + health + routing
  execution/        Sandbox env filtering, PTY management, worktree lifecycle
  scheduler/        Lock leasing, merge queue, priority queue, rate limiting
  verification/     Scope policy, command policy, output verification, staleness
  persistence/      SQLite layer, NDJSON event log, run manifest, resume
  repair/           Failure classification, repair planning, budget tracking
  secure/           Advisory + secure execution wrappers
  observability/    Structured logging, metrics, redaction, event taxonomy
```

## Key Entry Points

| Purpose | File |
|---------|------|
| CLI commands | `src/cli/main.ts` |
| Main orchestrator loop | `src/core/orchestrator.ts` |
| Type definitions | `src/core/types.ts` |
| State machine | `src/core/state-machine.ts` |
| Configuration | `src/core/config.ts` |
| Reason codes | `src/core/reason-codes.ts` |
| DB schema | `src/persistence/migrations/001_init.sql` |

## Module Details

### `src/cli/`

Commander.js-based CLI with subcommands: `run`, `resume`, `status`, `inspect`, `locks`, and `providers` (with `check`, `install`, `auth`).

| File | Purpose |
|------|---------|
| `main.ts` | CLI entry point, command definitions, option parsing |

### `src/core/`

The heart of the orchestrator: types, config, state machine, and the main loop.

| File | Purpose |
|------|---------|
| `orchestrator.ts` | Main orchestration loop (ingest through completion) |
| `types.ts` | All TypeScript interfaces (`TaskContract`, `DagSpec`, `RunRecord`, etc.) |
| `state-machine.ts` | Run and task state transitions with validation |
| `config.ts` | Configuration schema, defaults, and loading logic |
| `reason-codes.ts` | Enumeration of all failure/abort reason codes |
| `shell.ts` | Shell command execution utilities |
| `hash.ts` | SHA-256 hashing for contracts, configs, and DAGs |

### `src/planning/`

Plan generation, auditing, and freezing.

| File | Purpose |
|------|---------|
| `planner-codex.ts` | Sends prompt to Codex planner, parses DAG response |
| `dag-schema.ts` | Zod schema for DAG validation |
| `plan-audit.ts` | Hot resource detection and ownership adjustment |
| `plan-freeze.ts` | Hash computation and plan immutability |
| `context-pack.ts` | Codebase context assembly for prompt envelopes |
| `prompt-envelope.ts` | Immutable + mutable prompt construction |

### `src/providers/`

Provider abstraction layer with health management and routing.

| File | Purpose |
|------|---------|
| `registry.ts` | Provider metadata (binaries, install commands, auth commands) |
| `router.ts` | Route tasks to providers with fallback logic |
| `health-manager.ts` | Health scoring, backoff, cooldown, recovery |
| `preflight.ts` | Pre-run provider availability and auth checks |
| `adapters/claude.ts` | Claude CLI adapter |
| `adapters/codex.ts` | Codex CLI adapter |
| `adapters/gemini.ts` | Gemini CLI adapter |

### `src/execution/`

Task execution environment: worktrees, PTY, containers, sandbox.

| File | Purpose |
|------|---------|
| `worktree-manager.ts` | Git worktree create/cleanup lifecycle |
| `pty-manager.ts` | PTY-based process management for provider execution |
| `container-runner.ts` | Docker/Podman container execution |
| `sandbox-env.ts` | Environment variable filtering and sandbox home setup |
| `watchdog.ts` | Heartbeat monitoring and timeout detection |
| `completion-parser.ts` | Parse provider output for commit detection |

### `src/scheduler/`

Concurrency control: scheduling, locking, merging.

| File | Purpose |
|------|---------|
| `scheduler.ts` | Main scheduler with dispatch loop |
| `priority-queue.ts` | Priority queue with aging |
| `token-buckets.ts` | Per-provider concurrency limits |
| `lock-manager.ts` | Write lease management with fencing tokens |
| `lease-heartbeat.ts` | Periodic lease renewal |
| `merge-queue.ts` | Serialized merge operations |

### `src/verification/`

Post-execution validation gates.

| File | Purpose |
|------|---------|
| `scope-policy.ts` | File allowlist/denylist enforcement |
| `command-policy.ts` | Command allowlist/denylist enforcement |
| `output-verifier.ts` | Output contract verification (exports, test files) |
| `post-merge-gate.ts` | Post-merge command execution |
| `staleness.ts` | Baseline drift detection |
| `commit-analyzer.ts` | Commit diff analysis |
| `error-extractor.ts` | Parse error output for file references |

### `src/persistence/`

Data storage and crash recovery.

| File | Purpose |
|------|---------|
| `sqlite.ts` | SQLite driver with busy handling |
| `event-log.ts` | Append-only NDJSON event recording |
| `manifest.ts` | Run manifest read/write |
| `resume-reconcile.ts` | Three-layer state reconciliation algorithm |
| `migrations/001_init.sql` | Database schema |

### `src/repair/`

Failure handling and bounded repair.

| File | Purpose |
|------|---------|
| `failure-classifier.ts` | Classify failures into repairable categories |
| `repair-budget.ts` | Per-class attempt tracking |
| `repair-planner.ts` | Build narrowed repair tasks |

### `src/secure/`

Execution wrappers with security policies.

| File | Purpose |
|------|---------|
| `secure-executor.ts` | Interface for secure execution |
| `host-executor.ts` | Host-mode execution with env filtering |
| `container-executor.ts` | Container-mode execution with network isolation |
| `factory.ts` | Factory to create the appropriate executor |

### `src/observability/`

Logging, metrics, and output management.

| File | Purpose |
|------|---------|
| `logger.ts` | Structured JSON logging |
| `metrics.ts` | Counter and timer metrics |
| `redaction.ts` | Secret pattern detection and replacement |
| `taxonomy.ts` | Event type definitions |

## Test Structure

```
tests/
  unit/          26 test files — module-level behavior and edge cases
  integration/   4 test files  — resume reconciliation, persistence workflows
  e2e/           1 test file   — full CLI workflows
  benchmark/     2 test files  — worktree creation perf, DB loop perf
```

Tests follow the naming convention `<module>.test.ts` and are colocated under the appropriate test directory.

## Design Patterns

### Adapter Pattern (Providers)

Each provider implements a common `ProviderAdapter` interface, allowing the orchestrator to treat all providers uniformly while each adapter handles CLI-specific invocation details.

### State Machine Pattern

Both runs and tasks use explicit state machines with validated transitions. Invalid transitions throw errors rather than silently proceeding.

### Event Sourcing

The NDJSON event log serves as an event source. On crash recovery, the event log can reconstruct task states independently of SQLite.

### Fencing Token Pattern

Write leases use monotonically increasing fencing tokens to prevent stale writes, a pattern from distributed systems literature for safe lock-based coordination.

### Token Bucket Pattern

Per-provider rate limiting uses a fixed-capacity token bucket. Tokens are acquired before dispatch and released on completion.

## Data Flow

```
User Prompt
  → Planner (Codex) → DagSpec (JSON)
  → Plan Audit → adjusted DagSpec
  → Plan Freeze → hashed DagSpec
  → Scheduler → Priority Queue
  → Lock Manager → Write Leases
  → Provider Adapter → Worktree + PTY/Container
  → Commit → Scope Policy
  → Merge Queue → Cherry-pick
  → Post-Merge Gate → Verification
  → Event Log + SQLite (persistence)
```

## Configuration Hierarchy

```
DEFAULT_CONFIG (built-in)
  ← Config File (--config path, deep merge)
    ← CLI Flags (--execution-mode, etc., override)
```

## Persistence Hierarchy (Resume)

```
Git History (highest trust)
  > Event Log (NDJSON)
    > SQLite (derived state)
```
