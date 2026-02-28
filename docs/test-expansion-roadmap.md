# Massive Test Expansion Roadmap

Date: 2026-02-28  
Authoring basis: direct repository audit + executed test/coverage baseline  
Constraint honored: this document plans test additions only; no new tests were added in this slice.

## 1. Goal

Create an ordered, execution-ready roadmap to expand test coverage across GitWeaver so implementation can proceed phase-by-phase without replanning.

## 2. Baseline Snapshot (Measured)

Command executed:

```bash
pnpm test -- --coverage
```

Observed on **February 28, 2026**:

- Test files: `41`
- Tests: `228`
- Result: all passing
- Coverage provider: `v8` (Vitest)
- Global coverage:
  - Statements: `68.26%`
  - Branches: `58.06%`
  - Functions: `70.55%`
  - Lines: `68.46%`

Repository inventory used for this plan:

- `src/`: `66` files total (`65` TypeScript + `1` SQL migration)
- `tests/`: `41` test files
- Files with branch points: `48`
- Files with branch coverage `< 50%`: `13`
- Files with branch coverage `0%` (with branch points): `6`

## 3. Coverage Heatmap by Domain

| Domain | Src Files | Files in Coverage | Branch Hit/Total | Branch % | Direct Test Imports (test files) |
|---|---:|---:|---:|---:|---:|
| `cli` | 7 | 0 | 0/0 | n/a | 0 |
| `core` | 8 | 7 | 104/267 | 38.95% | 27 |
| `execution` | 6 | 6 | 33/57 | 57.89% | 8 |
| `observability` | 4 | 3 | 7/18 | 38.89% | 1 |
| `persistence` | 4 | 4 | 111/162 | 68.52% | 5 |
| `planning` | 6 | 6 | 65/98 | 66.33% | 5 |
| `providers` | 9 | 8 | 83/191 | 43.46% | 5 |
| `repair` | 3 | 3 | 31/37 | 83.78% | 2 |
| `scheduler` | 6 | 6 | 65/78 | 83.33% | 6 |
| `secure` | 5 | 4 | 7/14 | 50.00% | 1 |
| `verification` | 7 | 7 | 95/113 | 84.07% | 8 |

Primary risk concentration is in `core`, `providers`, `observability`, and uncovered `cli`.

## 4. Highest-Gap Files (Measured)

By uncovered branches:

| File | Branch Hit/Total | Branch % | Uncovered Branches |
|---|---:|---:|---:|
| `src/core/orchestrator.ts` | 52/205 | 25.36% | 153 |
| `src/providers/preflight.ts` | 43/114 | 37.71% | 71 |
| `src/persistence/sqlite.ts` | 67/94 | 71.27% | 27 |
| `src/persistence/resume-reconcile.ts` | 42/62 | 67.74% | 20 |
| `src/execution/pty-manager.ts` | 14/28 | 50.00% | 14 |
| `src/core/state-machine.ts` | 1/11 | 9.09% | 10 |
| `src/providers/adapters/codex.ts` | 0/10 | 0.00% | 10 |
| `src/planning/context-pack.ts` | 12/21 | 57.14% | 9 |
| `src/planning/planner-codex.ts` | 11/20 | 55.00% | 9 |
| `src/providers/adapters/claude.ts` | 0/8 | 0.00% | 8 |
| `src/providers/adapters/gemini.ts` | 1/8 | 12.50% | 7 |
| `src/execution/container-runner.ts` | 0/6 | 0.00% | 6 |
| `src/secure/host-executor.ts` | 0/6 | 0.00% | 6 |
| `src/observability/logger.ts` | 3/9 | 33.33% | 6 |
| `src/observability/metrics.ts` | 3/8 | 37.50% | 5 |

## 5. Files Missing From Coverage Entirely

These are highest-priority structural gaps because they currently do not appear in coverage output:

1. `src/cli/main.ts`
2. `src/cli/commands/run.ts`
3. `src/cli/commands/resume.ts`
4. `src/cli/commands/status.ts`
5. `src/cli/commands/inspect.ts`
6. `src/cli/commands/locks.ts`
7. `src/cli/commands/providers.ts`
8. `src/core/types.ts` (type-only, low runtime risk)
9. `src/observability/taxonomy.ts`
10. `src/providers/adapters/types.ts` (type-only, low runtime risk)
11. `src/secure/secure-executor.ts` (interface-only, low runtime risk)

## 6. Expansion Strategy

Execution policy for this roadmap:

1. Expand leaf-module tests first, then orchestration-level behavior.
2. Keep each PR to one test theme (`5-10` files, `~250-500` net LOC target).
3. Favor branch-closing tests over line-only expansion.
4. Gate each phase with:
   - `pnpm test`
   - `pnpm test -- --coverage`
   - no production behavior change unless explicitly intended.
5. Treat type-only/interface-only files as low priority unless runtime behavior is introduced.

## 7. Phase Plan (Strict Order)

Do not start a later phase until exit criteria of the current phase are met.

---

### Phase 0: Test Harness Foundation

Purpose: remove friction and duplication before large expansion.

Target outputs:

1. Shared helpers for temp repos, git command wrappers, and deterministic clocks.
2. Shared mock builders for `runCommand`, provider adapters, and DB context scaffolds.
3. Test naming normalization and fixture cleanup consistency.

Candidate files:

- `tests/helpers/git-fixture.ts` (new)
- `tests/helpers/runtime-context-fixture.ts` (new)
- `tests/helpers/mock-shell.ts` (new)
- Minimal touchups in existing tests to adopt helpers.

Exit criteria:

- No behavior changes.
- Existing suite still green.
- New helpers used by at least 3 existing test files.

---

### Phase 1: Provider Adapter + Container Execution Coverage

Purpose: close zero-coverage provider execution surfaces first.

Target files:

- `src/providers/adapters/codex.ts`
- `src/providers/adapters/claude.ts`
- `src/providers/adapters/gemini.ts` (expand current tests)
- `src/execution/container-runner.ts`
- `src/providers/adapters/index.ts`

Test work packages:

1. `codex` adapter host mode:
   - includes `--output-schema` insertion only when provided
   - heartbeat lower bound behavior (`>= 10_000`)
   - normalized output mapping
2. `codex` adapter container mode:
   - default runtime/image fallback
   - network policy pass-through
   - stdout/stderr/rawOutput mapping
3. `claude` adapter host and container parity checks.
4. `gemini` adapter container branch (currently under-covered).
5. `container-runner`:
   - env pass-through excludes undefined values
   - `--network none` only for deny mode
   - stdin and cwd propagation
6. `adapters/index`:
   - correct adapter returned for each provider id.

Exit criteria:

- Adapter files branch coverage >= `90%`.
- `container-runner.ts` branch coverage >= `90%`.

---

### Phase 2: Secure Executor Surface Completion

Purpose: validate currently uncovered active security implementation path.

Target files:

- `src/secure/host-executor.ts`
- `src/secure/container-executor.ts`
- `src/secure/factory.ts`

Test work packages:

1. Host allowlist behavior.
2. Host `ORCH_` env pass-through.
3. Host denylist precedence.
4. Host `networkAllowed` always true behavior.
5. Container executor `networkAllowed` honors task policy.
6. Factory returns correct executor by mode.

Exit criteria:

- `host-executor.ts` branch coverage >= `90%`.
- `factory.ts` branch coverage = `100%`.

---

### Phase 3: Preflight + Registry + Providers Command

Purpose: harden the provider readiness flow, one of the largest branch deficits.

Target files:

- `src/providers/preflight.ts`
- `src/providers/registry.ts`
- `src/cli/commands/providers.ts`

Test work packages:

1. `checkSingleProvider` permutations:
   - binary missing
   - version parse from stdout/stderr
   - npm latest lookup failure
   - auth `OK` / `MISSING` / `UNKNOWN`
   - Windows codex note branch
2. `checkAuth` and `checkGeminiAuth` text heuristics:
   - missing/authenticated/unknown phrase detection
   - non-zero exit handling branches
3. `isOutdated` and semver fallback edge cases.
4. `buildInstallPlan`:
   - prompt/never/auto modes
   - dedupe + fallback command comments
5. `applyInstallPlan`:
   - no commands short-circuit
   - non-interactive rejection
   - approved install success/failure
6. `runPreflight`:
   - `required` upgrades path
   - missing provider reason-code path
7. `providers` CLI command:
   - `parseProviders` valid/invalid handling
   - JSON vs non-JSON output branches
   - `--fix` path command execution behavior.

Exit criteria:

- `preflight.ts` branch coverage >= `80%`.
- `providers` CLI command unit coverage established.

---

### Phase 4: State + Primitive Utility Closure

Purpose: close small but critical branch gaps in control primitives.

Target files:

- `src/core/state-machine.ts`
- `src/repair/repair-budget.ts`
- `src/repair/repair-planner.ts`
- `src/scheduler/priority-queue.ts`
- `src/scheduler/token-buckets.ts`
- `src/observability/logger.ts`
- `src/observability/metrics.ts`
- `src/observability/taxonomy.ts`
- `src/persistence/event-log.ts`
- `src/persistence/manifest.ts`

Test work packages:

1. State-machine invalid transitions and abort mapping branches.
2. Repair budget off-by-one semantics on allowed attempts.
3. Repair planner narrowed allowlist fallback behavior.
4. Priority queue score ordering and age bias behavior.
5. Token bucket acquire/release saturation behavior.
6. Logger debug/warn/error sink routing and context/no-context payload branch.
7. Metrics timer missing/end branch and histogram naming behavior.
8. Taxonomy coverage sanity assertions for key reason codes.
9. Event log constructor existing-file branch and sequence continuation.
10. Manifest write path persistence contract.

Exit criteria:

- `state-machine.ts` branch coverage >= `90%`.
- `logger.ts` and `metrics.ts` branch coverage >= `90%`.

---

### Phase 5: CLI Command Coverage Expansion

Purpose: move `cli/` from uncovered to actively validated behavior.

Target files:

- `src/cli/main.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/resume.ts`
- `src/cli/commands/status.ts`
- `src/cli/commands/inspect.ts`
- `src/cli/commands/locks.ts`

Test work packages:

1. `main.ts` parse failure branch and exit-code behavior.
2. `run` command:
   - integer parse failure path
   - JSON output path
   - non-JSON output path
   - non-completed run sets `process.exitCode = 1`
3. `resume/status/inspect/locks`:
   - JSON and pretty output branches
   - argument pass-through to orchestrator.

Exit criteria:

- All `cli` files included in coverage report.
- New command tests stable on Windows + Linux (local + CI).

---

### Phase 6: Orchestrator Public Lifecycle (Run/Resume/Baseline/Plan)

Purpose: start controlled expansion of `orchestrator.ts` outside deepest execution path.

Target file:

- `src/core/orchestrator.ts` (public and planning-related branches)

Focus areas:

1. `run()` dry-run basic vs detailed report branches.
2. Stage-A / baseline / plan / stage-B failure combinations.
3. Resume:
   - run-not-found branch
   - checkpoint merge-in-flight requeue branch
   - drift-detected + no `--accept-drift` rejection
4. `status`, `inspect(task filter)`, `locks`.
5. Helper branches:
   - `limitBuckets`
   - `resolveRepo` non-git failure
   - `gitHead` failure
   - `extractReasonCode` busy error conversion.

Exit criteria:

- `orchestrator.ts` branch coverage reaches at least `45%` before moving deeper.

---

### Phase 7: Orchestrator DAG Scheduling + Dispatch Loop

Purpose: close uncovered scheduling and unresolved-progress branches.

Target file:

- `src/core/orchestrator.ts` (`executeDag` branch cluster)

Focus areas:

1. Dependencies unmet vs met transitions.
2. Scheduler reroute + provider degradation path.
3. Missing record/task defensive branches.
4. Deadlock-like unresolved state escalation path.
5. Pending-without-running wait loop.
6. Escalated-task run abort summary branch.

Exit criteria:

- `executeDag` branch clusters around lines `351-485` materially covered.

---

### Phase 8: Orchestrator Task Execution + Merge + Verification

Purpose: close largest high-value behavior surface in one controlled epic.

Target file:

- `src/core/orchestrator.ts` (`executeTask`, `integrateCommit`)

Focus areas:

1. Lock acquisition failure branch.
2. Prompt drift failure path.
3. Provider heartbeat lifecycle.
4. Forensic log capture enabled/disabled branch.
5. Execution non-zero exit branch.
6. No-commit branch.
7. Scope deny branch.
8. Fencing token invalid before/after stale check.
9. Staleness-triggered replan event branch.
10. Output verification fail branch.
11. Gate command rejected branch.
12. Gate failure rollback branch.
13. Artifact signature upsert loop branch.
14. Verification error rollback command sequence.
15. Non-repairable failure escalation branch.
16. Repair-budget-allowed branch enqueues repair task.
17. Repair-budget-exhausted branch escalates.
18. `finally` cleanup branch resilience.

Exit criteria:

- `orchestrator.ts` branch coverage >= `70%`.
- No flakiness introduced in integration/e2e.

---

### Phase 9: Persistence + Resume + SQLite Hard Cases

Purpose: increase confidence in operational recovery and DB edge behavior.

Target files:

- `src/persistence/sqlite.ts`
- `src/persistence/resume-reconcile.ts`

Focus areas:

1. `sqlite`:
   - Promise-in-transaction rejection branch
   - empty artifact key list branch
   - missing row return branches
   - expected schema-backfill error suppression vs throw
   - busy retry exhausted path telemetry assertions
2. `resume-reconcile`:
   - additional mixed event/db/git permutations
   - reason-code precedence and determinism invariants.

Exit criteria:

- `sqlite.ts` branch coverage >= `80%`.
- Resume reconciliation remains deterministic under all new cases.

---

### Phase 10: E2E Matrix Completion

Purpose: ensure the expanded unit coverage is anchored by realistic workflows.

Target files:

- `tests/e2e/cli.e2e.test.ts` (expand)
- new targeted e2e files for providers/auth/install paths

Work packages:

1. `orchestrator run --dry-run --json` success path in a git repo fixture.
2. `resume/status/inspect/locks --json` happy-path checks.
3. `providers check/install/auth` command flow checks with controlled mocks.
4. Failure-path stderr and exit code contract checks.

Exit criteria:

- At least 6-8 meaningful e2e scenarios (currently 2).
- CI runtime still within acceptable budget.

## 8. Ordered Master Queue (Implementation Checklist)

Use this list as the execution order; mark complete as each item lands.

1. Build shared test fixtures/helpers (Phase 0).
2. Add provider adapter + container-runner tests (Phase 1).
3. Add host/container secure executor tests (Phase 2).
4. Expand preflight and providers command coverage (Phase 3).
5. Add primitive/control module tests (`state-machine`, `repair`, `observability`, queue primitives, event-log/manifest) (Phase 4).
6. Add CLI command tests for run/resume/status/inspect/locks/main parse branches (Phase 5).
7. Expand orchestrator run/resume/planning/baseline helper branch tests (Phase 6).
8. Expand orchestrator DAG scheduling loop tests (Phase 7).
9. Expand orchestrator executeTask/integration/repair branching tests (Phase 8).
10. Expand sqlite/resume-reconcile hard branches (Phase 9).
11. Expand e2e command matrix (Phase 10).
12. Run full suite + coverage and re-rank remaining uncovered branches.

## 9. Suggested Coverage Milestones

Milestones are directional, not strict gates:

- After Phase 3: branch coverage `~65%`
- After Phase 6: branch coverage `~72%`
- After Phase 8: branch coverage `~82%`
- After Phase 10: branch coverage `~88%+`

## 10. Risks and Guardrails

Risks:

1. `orchestrator.ts` test setup complexity can cause brittle mocks.
2. Real git/sqlite integration tests can become slow and flaky if fixtures are not standardized.
3. CLI tests can become OS-sensitive if shell output assumptions are too strict.

Guardrails:

1. Prefer behavior assertions over implementation details.
2. Use deterministic time and process mocks for scheduler/heartbeat/provider tests.
3. Keep each phase isolated; avoid mixing new helper infra with deep orchestrator behavior in the same PR.
4. Track branch deltas per touched file each phase, not only global coverage.

## 11. Out-of-Scope For This Roadmap

1. Production refactors unrelated to testing.
2. New runtime features.
3. Threshold policy changes in CI (can be proposed after major branch-gap closure).

## 12. Status Note

Working tree had one untracked test file at planning time:

- `tests/unit/output-verifier.test.ts`

This roadmap assumes all future test additions are layered on top of the current branch state.

