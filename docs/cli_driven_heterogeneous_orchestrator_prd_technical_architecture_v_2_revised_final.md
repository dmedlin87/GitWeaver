# CLI-Driven Heterogeneous Orchestrator - PRD & Technical Architecture (v2.0 Revised Final)

## 0) Critical Review of v1.2 (What Needed Correction)

This section is intentionally critical. v1.2 is a strong baseline, but it leaves several failure paths that will appear under real parallel load.

### 0.1 High-Severity Gaps and Fixes

| Gap in v1.2 | Why It Fails in Practice | v2.0 Fix |
|---|---|---|
| Ownership model lacks formal lock leasing and fencing. | Two tasks can both "believe" they own a shared resource after timeout/retry, causing racey merges and non-deterministic failures. | Add `LockManager` with write leases, TTL, and monotonic fencing tokens. Merge path validates fencing token before integrating. |
| Prompt retries are unconstrained. | "Reprompt" can silently mutate requirements between attempts (prompt drift), creating hidden scope creep. | Introduce immutable `TaskContract` + `PromptEnvelope` hashes and drift detection. Only error evidence and bounded hints are mutable. |
| Context passing is underspecified. | Executors miss required context or receive too much irrelevant context, causing hallucinated edits and noisy diffs. | Add deterministic `ContextPack` assembler with tiered budgets (`must`, `should`, `optional`) and hash-logged manifests. |
| Staleness checks are too shallow. | A task may be correct in its worktree but stale relative to updated main/dependency signatures at merge time. | Add pre-merge revalidation: base-commit drift, dependency signature drift, and stale-node invalidation. |
| Scope enforcement only references changed files, not path canonicalization edge cases. | Symlink/path traversal and case normalization mismatches can bypass naive allowlist checks. | Canonical path normalization + repo-root enforcement + symlink target resolution before policy evaluation. |
| Resume relies mainly on commit footers + SQLite state. | Squash/rebase/manual edits can desync database state from git truth. | Add append-only run event log and deterministic recovery algorithm (`reconcile(sqlite, git, eventlog)`). |
| Completion marker trust boundary is weak. | Worker can emit marker without producing a valid, policy-compliant commit. | Marker becomes advisory only; success requires commit, scope pass, verifier pass, and merge gate pass. |
| Repair loop can become noisy and broad. | Repeated broad repairs create churn and regressions. | Add root-cause classification + strict repair scopes + escalating stop reasons. |
| Security section is too general for secret handling. | Logs and artifacts can leak tokens/secrets during troubleshooting. | Add redaction pipeline, environment minimization, and secret-safe artifact policy. |

### 0.2 Medium-Severity Gaps and Fixes

| Gap in v1.2 | Risk | v2.0 Fix |
|---|---|---|
| Provider routing is static and under-specified. | Wrong model for task class reduces quality and increases repair rates. | Add deterministic routing policy + fallback matrix by task type and provider health. |
| Verification policy is mostly compile/test + exports. | Behavioral and contract regressions can pass if types still compile. | Add contract checks and optional deterministic smoke tests per task class. |
| Observability has logs but limited run-level diagnostics. | Hard to root-cause bottlenecks and repeated failures. | Add structured metrics, per-stage latency histograms, and failure taxonomy. |

---

## 1) Summary

`GitWeaver` is a local Node.js + TypeScript orchestration runtime for concurrent AI CLI execution across Codex, Claude, and Gemini with deterministic guardrails.

Core value of v2.0:

- Safe parallelism through lock leasing + transactional merge queue.
- Deterministic contracts through immutable task/prompt/context hashes.
- Resilience through event-sourced recovery reconciled against git truth.
- Bounded autonomy through strict scope control, verification gates, and narrow repairs.

---

## 2) Goals

### 2.1 Functional Goals

1. Generate a typed, auditable DAG from one user objective.
2. Execute independent tasks concurrently in isolated worktrees.
3. Enforce write scope fail-closed with canonical path checks.
4. Merge only through commit-based transactional integration.
5. Verify merged state after every integration before continuing.
6. Auto-repair within bounded attempts and constrained file scope.
7. Resume safely after crashes by reconciling DB, event log, and git history.

### 2.2 Non-Functional Goals

- Determinism over narration: machine-checked contracts over model summaries.
- Low blast radius defaults: deny-by-default writes/commands/network.
- Recoverability: every transition is replayable and reconcilable.
- Portability: macOS/Linux first, Windows explicit process-tree handling.
- Explainability: each stop/fail path emits exact machine reason codes.

---

## 3) Non-Goals

- No central hosted control plane in M1/M2 (local-only runtime).
- No claim of full sandbox security without OS/container isolation.
- No guarantee of semantic conflict prediction before integration; conflicts are managed via merge queue + verification + repair.

---

## 4) Model Routing Strategy (Heterogeneous by Design)

### 4.1 Default Roles

- `codex`: planning, architecture deltas, risk audits, repair planning.
- `claude`: TypeScript-heavy implementation/refactor/test execution.
- `gemini`: frontend/multimodal/UI tasks and artifact-aware reviews.

### 4.2 Deterministic Router

Routing is policy-based, not free-form:

- `type in {code, refactor, test, deps}` -> `claude` default.
- `type in {ui, multimodal, docs-with-assets}` -> `gemini` default.
- `type in {plan, audit, repair-plan}` -> `codex`.
- On provider health degradation: fallback to configured secondary provider.

Router emits `routingReason` and `fallbackReason` into task logs.

---

## 5) CLI UX

### 5.1 Commands

- `orchestrator run "<prompt>" [--concurrency N] [--dry-run] [--config path]`
- `orchestrator resume <run-id>`
- `orchestrator status <run-id> [--json]`
- `orchestrator inspect <run-id> [--task <id>]`
- `orchestrator locks <run-id>` (new: inspect held/pending lock leases)

### 5.2 Operational Promises

- Missing provider auth fails fast with exact remediation command.
- Dirty repo baseline fails fast unless explicit override mode is enabled.
- Scope, merge, and verification violations fail closed with machine-readable reasons.

---

## 6) State Machines

### 6.1 Run-Level State

`INGEST -> BASELINE_OK -> PLAN_FROZEN -> DISPATCHING -> INTEGRATING -> VERIFYING -> (REPAIRING)* -> COMPLETED`

Failure terminals:

- `ABORTED_POLICY`
- `ABORTED_BASELINE`
- `ABORTED_BUDGET`
- `ABORTED_MANUAL`

### 6.2 Task-Level State

`PENDING -> READY -> LEASE_ACQUIRED -> RUNNING -> COMMIT_PRODUCED -> SCOPE_PASSED -> MERGE_QUEUED -> MERGED -> VERIFIED`

Alternative states:

- `EXEC_FAILED`
- `SCOPE_FAILED`
- `VERIFY_FAILED`
- `STALE`
- `ESCALATED`

No task may enter `MERGE_QUEUED` without a valid active lease token.

---

## 7) Safety Invariants (Hard Rules)

1. Clean working tree at run start.
2. Integration is commit-based only (`cherry-pick`/merge queue), never raw patch apply.
3. Scope checks are canonical-path fail-closed.
4. Exit code is never sufficient for success.
5. Post-merge gate is mandatory after every integration.
6. Repair attempts are bounded and scope-narrowed.
7. Git history + event log are the system of record; SQLite is derived state.
8. Any lock lease timeout requires fencing-token revalidation before merge.

---

## 8) Core Data Contracts (v2)

### 8.1 TaskContract (Immutable)

```ts
interface TaskContract {
  taskId: string;
  title: string;
  provider: "claude" | "gemini" | "codex";
  type: "code" | "refactor" | "test" | "docs" | "deps" | "repair";
  dependencies: string[];
  writeScope: {
    allow: string[];
    deny: string[];
    ownership: "exclusive" | "shared-serial" | "shared-append";
    sharedKey?: string;
  };
  commandPolicy: {
    allow: string[];
    deny: string[];
    network: "deny" | "allow";
  };
  expected: {
    files?: string[];
    exports?: { file: string; name: string; kind: "function" | "class" | "type" | "interface" | "const" }[];
    tests?: { file: string; contains?: string }[];
  };
  verify: {
    gateCommand?: string;
    gateTimeoutSec?: number;
    outputVerificationRequired: boolean;
  };
  artifactIO: {
    consumes?: string[];
    produces?: string[];
  };
  contractHash: string;
}
```

### 8.2 PromptEnvelope (Drift-Controlled)

```ts
interface PromptEnvelope {
  runId: string;
  taskId: string;
  attempt: number;
  provider: "codex" | "claude" | "gemini";
  baselineCommit: string;
  taskContractHash: string;
  contextPackHash: string;
  immutableSectionsHash: string;
  mutableSections: {
    failureEvidence?: string[];
    boundedHints?: string[];
  };
}
```

Rules:

- `immutableSectionsHash` must remain identical across retries.
- Retry prompts may only change `mutableSections`.
- Drift violation aborts task and escalates.

### 8.3 ContextPack (Deterministic)

```ts
interface ContextPack {
  taskId: string;
  must: Array<{ path: string; sha256: string; reason: string }>;
  should: Array<{ path: string; sha256: string; reason: string }>;
  optional: Array<{ path: string; sha256: string; reason: string }>;
  byteBudget: number;
  selectedTotalBytes: number;
  contextPackHash: string;
}
```

### 8.4 LockLease (Race-Safe)

```ts
interface LockLease {
  resourceKey: string; // file:<path> | class:<lockfile|barrel|schema> | artifact:<key>
  mode: "read" | "write";
  ownerTaskId: string;
  acquiredAt: string;
  expiresAt: string;
  fencingToken: number; // monotonic per resource key
}
```

---

## 9) Planning and Audit Pipeline

### 9.1 Ingest

1. Validate provider availability/auth/version capabilities.
2. Enforce clean repo baseline.
3. Capture `baselineCommit`, config hash, and run metadata.

### 9.2 Baseline Gate (Required)

Run configured baseline gate (default `pnpm -s tsc -p .`).

- If failing: abort by default.
- Optional explicit mode: `--allow-baseline-repair`.

### 9.3 Plan Generation

Codex produces strict JSON DAG with full TaskContracts.

- Zod validation (hard fail).
- Max 2 retries with schema error feedback.
- Persist all raw planner responses for audit.

### 9.4 Independent Plan Audit (Required)

Deterministic audit computes hot resources:

- lockfiles
- barrel/index files
- schema registries
- monorepo graph roots (`tsconfig`, workspace manifests)

If planner and deterministic audit disagree, ownership is upgraded to stricter mode (`shared-serial` or `exclusive`).

### 9.5 Plan Freeze

After audit, run enters `PLAN_FROZEN`.

- TaskContract hashes become immutable.
- Any subsequent change requires explicit re-plan event.

---

## 10) Dispatch, Concurrency, and Lock Manager

### 10.1 Scheduler

- Global concurrency cap.
- Provider token buckets.
- Priority queue with fairness aging.
- Backoff and health scoring per provider.

### 10.2 Lock Acquisition

Before dispatch:

1. Compute `resourceKeys` from scope + ownership class.
2. Acquire write lease for exclusive/shared resources.
3. Store fencing tokens in task runtime context.

Dispatch denied if required locks unavailable.

### 10.3 Lease Heartbeat and Expiry

- Active workers heartbeat lease every `leaseRenewMs`.
- Missed renewals expire lease.
- Expired task output cannot merge unless lease is reacquired and fencing token still current.

### 10.4 Merge Queue

- Separate execution concurrency from integration seriality.
- Merge queue ordered by:
  1. dependency topological order
  2. lease eligibility
  3. FIFO tie-break

---

## 11) Context Passing and Prompt Drift Control

### 11.1 Context Assembler

Deterministic file selection:

1. Include mandatory baseline pack (`package.json`, lockfiles, tsconfig, entry barrels).
2. Include dependency closure for `artifactIO.consumes`.
3. Include local neighborhood around target files/import graph.
4. Truncate by byte/token budget using deterministic ranking.

Every selected file is hash-recorded in `ContextPack`.

### 11.2 Retry Prompt Policy

Allowed retry additions only:

- compiler/test error evidence
- exact list of scope violations
- strict reminder of unchanged contract

Any new objective/requirement in retry prompt triggers drift violation.

### 11.3 Evidence-First Prompting

Worker prompt embeds:

- immutable contract summary
- canonical command policy
- context manifest hashes
- deterministic completion schema

No free-form "do anything needed" language allowed.

---

## 12) Sandbox and Subprocess Execution

### 12.1 Worktree Model

- One worktree per task under short temp path.
- Branch naming: `orch/<run>/<task>`.
- Sandbox `HOME` per task with minimal auth bundle.

### 12.2 PtySubprocessManager

- `node-pty` wrapper with raw + normalized logs.
- ANSI stripping for normalized stream only (raw preserved for forensics).
- Stall watchdog: `SIGINT -> SIGTERM -> kill-tree`.

### 12.3 Cross-Platform Kill Tree

- POSIX: process group kill.
- Windows: `taskkill /T /F`.

### 12.4 Completion Contract

Worker emits marker:

`__ORCH_DONE__: {"status":"success|fail","files_changed":[...],"summary":"..."}`

Marker is advisory; orchestrator independently validates commit, scope, verifiers, and gate status.

---

## 13) Scope Enforcement and Transactional Integration

### 13.1 Canonical Path Policy

For each changed file:

1. Resolve absolute path.
2. Resolve symlinks.
3. Normalize case/path separators.
4. Ensure path is under repo root.
5. Evaluate against allow/deny policy.

Any ambiguity -> fail closed.

### 13.2 Commit Requirements

- Worker must produce at least one commit; orchestrator may commit staged changes if policy allows.
- Empty/no-op commits are rejected.
- Commit message footers required:
  - `ORCH_RUN_ID`
  - `ORCH_TASK_ID`
  - `ORCH_CONTRACT_HASH`
  - `ORCH_FENCING_TOKEN`

### 13.3 Integration Transaction (Saga)

1. Revalidate lease fencing token.
2. Rebase/replay task branch against latest main if needed.
3. Cherry-pick commit to integration branch.
4. Run post-merge gate.
5. On success, fast-forward main and emit `TASK_MERGED`.
6. On failure, rollback integration branch and emit deterministic failure event.

---

## 14) Verification Pipeline

### 14.1 OutputVerifier (Deterministic)

Checks:

- expected files exist
- expected exports/kinds exist
- optional signature hints match
- required tests include expected assertions/snippets

Failure is fail-closed.

### 14.2 Post-Merge Gate (Required)

Run global gate after each integration (and optional per-node gate).

Default:

- `pnpm -s tsc -p .`

Optional deterministic smoke command by task type.

### 14.3 Staleness and Dependency Drift

Before merge:

- compare task base commit vs current main
- compare consumed artifact signatures vs latest registry

If drift detected:

- mark task `STALE`
- regenerate context and retry boundedly, or re-plan if contract invalidated

---

## 15) Repair Loop (Bounded and Root-Cause Aware)

### 15.1 Trigger Classes

- `VERIFY_FAIL_COMPILE`
- `VERIFY_FAIL_TEST`
- `SCOPE_FAIL`
- `MERGE_CONFLICT`

### 15.2 Scope Narrowing Rules

Repair allowlist defaults to:

- files from failed merge/task
- files referenced in deterministic error output
- direct import parents (one hop unless explicitly widened)

No broad repo-wide edits in repair mode.

### 15.3 Budgets

- default max attempts per failure class: `2`
- escalation on budget exhaustion with machine summary:
  - failing command
  - error signatures
  - last related commits
  - exact stop reason code

---

## 16) Persistence, Event Log, and Resume

### 16.1 Storage Model

- SQLite for queryable state (task status, attempts, lock table, provider errors).
- Append-only event log in `.orchestrator/runs/<run-id>/events.ndjson`.

Every state transition must emit an event with monotonic `seq`.

### 16.2 Recovery Algorithm

On `resume`:

1. Load SQLite snapshot and event log.
2. Reconstruct expected task/merge states.
3. Scan git commits for orchestrator footers.
4. Reconcile conflicts with deterministic precedence:
   1. git merged truth
   2. event log
   3. sqlite snapshot
5. Requeue incomplete safe tasks; escalate ambiguous tasks.

### 16.3 Drift Policy

If main branch advanced unexpectedly after run start:

- require explicit `--accept-drift` to continue
- otherwise abort with drift report

---

## 17) Security and Secret Hygiene (Best Effort)

### 17.1 Environment Policy

- Pass minimal env allowlist by default.
- Explicit denylist for common secret variables.
- Per-provider auth paths copied minimally into task HOME.

### 17.2 Redaction

- Redact known secret patterns from normalized logs and manifests.
- Preserve raw logs locally with restricted permissions when forensic mode is enabled.

### 17.3 Network Policy

- Network disabled by policy unless task explicitly allows it.
- Without OS sandbox, treat as advisory and disclose limitation.
- Optional secure mode (future): containerized executor with egress controls.

---

## 18) Observability and Provenance

### 18.1 Run Manifest

Store:

- provider versions and capabilities
- prompt template and contract hashes
- baseline commit
- config hash
- DAG hash

### 18.2 Metrics

Track per run/task:

- planning latency
- queue wait vs execution time
- merge wait time
- gate pass/fail rates
- repair rate by failure class
- stale-task rate

### 18.3 Failure Taxonomy

Standard reason codes (`SCOPE_DENY`, `LOCK_TIMEOUT`, `PROMPT_DRIFT`, `VERIFY_FAIL_TEST`, etc.) are required for all non-success exits.

---

## 19) Milestones and Definition of Done

### 19.1 M1 (Safe Parallel Core)

Must demonstrate:

- 2+ concurrent tasks with lock leasing and fenced merges
- fail-closed canonical scope enforcement
- mandatory post-merge gate
- bounded repair loop
- crash recovery via event log + git reconciliation

### 19.2 M2 (Deterministic Context + Drift Control)

Must demonstrate:

- context pack generation with hash manifests
- prompt envelope drift detection
- stale dependency invalidation and retry policy
- richer metrics and failure taxonomy

---

## 20) Implementation Plan

### Phase 1 - Runtime Skeleton and Contracts

- Define Zod schemas for `TaskContract`, `PromptEnvelope`, `ContextPack`, `LockLease`.
- Build run/event persistence primitives.
- Implement deterministic reason code catalog.

### Phase 2 - Lock Manager and Scheduler

- Implement resource key extraction from scopes.
- Add lease acquire/renew/expire logic with fencing tokens.
- Add integration queue decoupled from execution queue.

### Phase 3 - Sandbox + PTY + Provider Adapters

- Build worktree lifecycle manager.
- Implement provider adapter contract and routing logic.
- Add PTY execution watchdog and structured completion parsing.

### Phase 4 - Scope + Merge + Verification

- Implement canonical path policy engine.
- Implement integration saga (revalidate -> cherry-pick -> gate -> commit state).
- Add output verifier + artifact registry + staleness detector.

### Phase 5 - Repair + Resume + Hardening

- Implement root-cause-based repair planner.
- Implement full recovery reconcile flow.
- Add metrics dashboards/log summaries and hardened failure tests.

---

## 21) Hardened Test Matrix

1. Dual-writer race on same lock key -> only newest fencing token merges.
2. Prompt drift introduced in retry -> task hard-fails with `PROMPT_DRIFT`.
3. Symlink/path traversal write attempt -> scope check blocks merge.
4. Stale dependency signature before merge -> task marked `STALE` and retried/replanned.
5. Provider 429/timeout storm -> scheduler backoff and token reduction.
6. Worker hangs with partial output -> watchdog kills tree and task retries safely.
7. Orchestrator SIGKILL mid-merge -> resume reconciles state without duplicate merges.
8. Secret-like token appears in stdout -> normalized logs redact value.
9. Merge conflict unresolved in bounded retries -> deterministic escalation payload.
10. Baseline drift from outside commits -> resume requires explicit drift acceptance.

---

## 22) Suggested Default Config (v2)

- Global gate: `pnpm -s tsc -p .`
- Concurrency cap: `4`
- Provider buckets: `codex=1`, `claude=2`, `gemini=2`
- Lease duration: `120s`
- Lease renew interval: `30s`
- Heartbeat timeout: `60s`
- Terminate grace: `10s`
- Repair attempts per failure class: `2`
- Default deny commands: installs, `git push`, `curl`, `wget`, destructive shell patterns
- Default network: `deny`

---

## 23) Decision Log Needed Before Build

1. Should `shared-append` be allowed only for JSON/YAML registries in M1?
2. Is baseline repair mode enabled by default or explicit-only?
3. Do we require OS-level secure mode for handling sensitive repos?
4. Should per-node smoke tests be mandatory for specific task types (e.g., API handlers)?
5. Do we store raw logs by default, or only normalized logs unless forensic mode is enabled?
