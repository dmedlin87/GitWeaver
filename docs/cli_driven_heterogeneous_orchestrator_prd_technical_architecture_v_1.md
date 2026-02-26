# CLI-Driven Heterogeneous Orchestrator — PRD & Technical Architecture (v1.2)

## 1) Summary

A local, Node.js + TypeScript “CLI-of-CLIs” orchestrator that runs concurrent coding tasks by routing work to *native* AI terminal tools (Codex CLI / Claude Code / Gemini CLI). The orchestrator’s core value is **safe parallelism** for human-first CLIs through **transactional Git integration**, **fail-closed scope enforcement**, **deterministic interface forwarding**, **PTY-wrapped subprocess control**, and a **compile/test verification + bounded repair loop**.

The system is designed to:

- Plan work as a typed DAG.
- Execute tasks in isolated Git worktrees.
- Integrate results using commit-based cherry-picks.
- Prove correctness via deterministic verifiers + build gates.
- Recover from crashes via Git-truth reconciliation.

---

## 2) Goals

### 2.1 Functional Goals

1. **Plan**: Generate a strictly typed task DAG (with constraints) from a single user prompt.
2. **Execute**: Run tasks concurrently in isolated worktrees using provider CLIs.
3. **Enforce scope**: Reject unauthorized file changes (fail-closed) and auto-reprompt.
4. **Integrate transactionally**: Integrate via commit-based cherry-pick (stable identifiers).
5. **Verify**: Run post-merge compilation/test gates after each integration.
6. **Repair**: On verification failure, enqueue a bounded repair task with narrowed scope.
7. **Resume**: Resume runs safely by reconciling SQLite state with Git history.

### 2.2 Non-Functional Goals

- **Determinism-first**: Deterministic checks (AST/commands) over model summaries.
- **Fail-closed defaults**: If uncertain, stop and surface to the user.
- **Observability**: Every step produces structured artifacts and provenance.
- **Portability**: Works on macOS/Linux; Windows supported with explicit process-tree kill implementation.

---

## 3) Non-Goals

- No remote orchestration service (local-only).
- No guarantee of perfect security against exfiltration without OS-level sandboxing (network/filesystem). We provide hygiene + best-effort isolation.
- No attempt to “perfectly” predict semantic conflicts pre-merge; we detect and repair via verification gates + dependency invalidation.

---

## 4) User Experience (CLI)

### 4.1 Primary Commands

- `orchestrator run "<prompt>" [--concurrency N] [--dry-run] [--config path]`
- `orchestrator resume <run-id>`
- `orchestrator status <run-id>`
- `orchestrator inspect <run-id> [--task <id>]`

### 4.2 Operational Promises

- If authentication is missing for a provider CLI, the run halts immediately with the exact login command.
- If the repo baseline fails verification, the run aborts or offers a baseline repair flow.
- If any task violates scope or verification gates, the system auto-reprompts within bounded budgets; otherwise it escalates to the user.

---

## 5) System Model

## 5.1 Providers & Roles

- **Planner/Manager (Codex CLI)**: DAG generation + self-audit.
- **Executor (Claude Code)**: TypeScript-heavy coding/refactor/testing.
- **Frontend/Multimodal (Gemini CLI)**: UI/DOM work, multimodal tasks (optional in M1).

## 5.2 State Machine

**Ingest → Baseline → Plan → PlanAudit → Dispatch → Execute → ScopeValidate → Integrate → Verify → (Repair → Verify)* → Complete**

Each task node transitions through:
`PENDING → READY → RUNNING → (SCOPE_VIOLATION | EXEC_FAILED | NEEDS_REPAIR | VERIFIED) → MERGED`.

---

## 6) Safety Invariants (Hard Rules)

1. **Clean working tree required** at run start.
2. **Integration is commit-based** (cherry-pick or merge), not raw patches.
3. **Scope is fail-closed**: any out-of-allowlist file touch aborts merge + triggers bounded reprompt.
4. **Exit code is not success**: require independent evidence (commit exists + verifiers pass + gates pass).
5. **Post-merge gates are mandatory** after every integration.
6. **Repair is bounded** (attempt limits + narrow scope).
7. **Git is source of truth** for what actually merged.

---

## 7) Data Models

### 7.1 Run

- `runId: string`
- `baselineCommit: string`
- `createdAt: ISO8601`
- `configHash: string`
- `providerProfiles: ProviderProfile[]`
- `dag: DagSpec`
- `state: RunState`

### 7.2 ProviderProfile

- `provider: 'codex' | 'claude' | 'gemini'`
- `version: string`
- `capabilities: { supportsPTY: boolean; supportsNonInteractiveFlag: boolean; supportsJsonMode?: boolean; completionMarkerRequired: boolean; }`
- `authStatus: 'OK' | 'MISSING' | 'UNKNOWN'`

### 7.3 DagSpec

- `nodes: TaskNode[]`
- `edges: { from: TaskId; to: TaskId }[]`

### 7.4 TaskNode (Schema v1.2)

**Key principle:** TaskNodes encode not just “what to do,” but the **constraints** that make safe automation possible.

- `id: string`
- `title: string`
- `provider: 'claude' | 'gemini'` *(planner is always codex)*
- `type: 'code' | 'refactor' | 'test' | 'docs' | 'deps' | 'repair'`
- `priority: 'high' | 'normal' | 'low'`
- `dependencies: string[]`

#### Scope & Ownership

- `scope: {
    allowlist: string[];   // globs or normalized paths
    denylist: string[];    // globs or normalized paths
    readScope?: string[];  // extra files allowed to read for context (budget pack always included)
    ownership: 'exclusive' | 'shared-serial' | 'shared-append';
    sharedKey?: string;    // e.g., 'lockfile', 'barrel:src/index.ts'
  }`

#### Command Policy

- `commandPolicy: {
    allow: string[];       // regex-like strings or exact commands
    deny: string[];        // includes installs by default
    network: 'deny' | 'allow'; // advisory unless OS sandboxing enabled
  }`

#### Expected Outputs (Deterministically Verifiable)

- `expected: {
    files?: string[];      // expected created/modified files
    exports?: { file: string; name: string; kind: 'function'|'class'|'type'|'interface'|'const' }[];
    tests?: { file: string; contains?: string }[];
  }`

#### Verification Gates

- `verify: {
    gateCommand?: string;  // optional per-node gate
    gateTimeoutSec?: number;
    outputVerificationRequired: boolean;
  }`

#### Repair Policy

- `repairPolicy?: {
    maxAttempts: number;           // e.g., 2
    scopeNarrowing: 'strict'|'moderate';
    allowedExtraFilesFromErrors: boolean;
  }`

#### Artifacts

- `artifacts: {
    produces?: string[];   // symbolic keys in Artifact Registry (computed too)
    consumes?: string[];
  }`

### 7.5 Artifact Registry

Stored in-memory and persisted to SQLite per run.

- Tracks exported symbols + signatures + file paths.
- Maintains signature hashes per symbol to detect API drift.

---

## 8) Planning Pipeline

### 8.1 Ingest & Baseline

1. Validate provider auth + capability profiles.
2. Abort if git working tree dirty.
3. Record `baselineCommit`.

### 8.2 Baseline Health Check (Required)

Run global `baselineGateCommand` (e.g., `pnpm -s tsc -p .`).

- If baseline fails: abort OR offer a `baseline repair` run mode (optional).

### 8.3 Plan (Codex)

- Codex produces `DagSpec` in strict JSON.
- Zod validates. On failure: feed back schema errors.
- Retries: max 2, then abort with saved raw outputs.

### 8.4 Plan Self-Audit (Codex)

- Ask for:
  - Top risk edges
  - Shared files list
  - Tasks requiring serial execution

### 8.5 Independent Audit (Recommended)

A deterministic heuristic audit (and optionally a second-model audit) that flags:

- lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`)
- barrel/index files (`index.ts`, export registries)
- schema registries
- config files (`tsconfig`, eslint, prettier)

If audit disagrees with planner ownership/scopes, fail-closed or force `shared-serial`.

---

## 9) Dispatch & Concurrency

### 9.1 Scheduler

- Global concurrency cap (e.g., 4).
- Provider token buckets:
  - `codex: 1` (planning/repair coordination)
  - `claude: 2`
  - `gemini: 2`
- Adaptive backoff on provider errors.

### 9.2 Ownership Gating

- `exclusive`: only one running/merging task may hold it.
- `shared-serial`: tasks may run concurrently but must integrate strictly serially; optionally run serially too.
- `shared-append`: allowed only when a *structured merge strategy exists* (JSON/AST merge). Otherwise demote to `shared-serial`.

---

## 10) Sandbox Model

### 10.1 Worktrees

- Create worktree per task at short path: `${os.tmpdir()}/orc/<run>/<task>`.
- Create branch `orch/<run>/<task>`.

### 10.2 Context Budget Pack

Always present in sandbox for context:

- `package.json`, lockfile(s), tsconfig(s)
- path aliases config
- public API barrels / entrypoints (configurable)

### 10.3 Pruning

Use `.claudeignore` / `.geminiignore` to *reduce* scanning, not to block required dependency reads.

- Task `readScope` can widen access without allowing writes.

### 10.4 Dependency Policy

Default: **no installs during tasks**.

- Enforced via `commandPolicy.deny`.
- If installs required, planner must generate a dedicated `deps` task:
  - `ownership: exclusive` with `sharedKey: lockfile`
  - runs serially

---

## 11) Subprocess Management (PTY + Contract)

### 11.1 PtySubprocessManager

- Use `node-pty` for CLIs that require TTY.
- Normalize output:
  - strip ANSI
  - collapse spinners
  - timestamp lines

### 11.2 Watchdog

- Heartbeat: if no output for N seconds:
  1) `interrupt()` (SIGINT)
  2) `terminate()` (SIGTERM)
  3) `kill()` (SIGKILL / process-tree kill)

### 11.3 Cross-Platform Kill Tree

- POSIX: process group kill where possible
- Windows: `taskkill /T /F`

### 11.4 Completion Marker (Necessary, Not Sufficient)

Workers must emit:
`__ORCH_DONE__: {"status":"success"|"fail","files_changed":[...],"summary":"..."}`

Orchestrator then independently verifies:

- commit exists
- diff matches allowlist
- output verifiers pass

---

## 12) Scope Enforcement & Integration

### 12.1 Commit Required

Worker changes must be committed in the sandbox branch.

- Orchestrator may perform the commit if worker fails to.

### 12.2 CommitAnalyzer (Fail-Closed)

- Compute changed files from the commit diff.
- If any file is outside allowlist OR matches denylist → **scope violation**.
- Action:
  - do not merge
  - re-prompt within bounded attempts with:
    - the violating file list
    - reminder of allowlist/denylist

### 12.3 Transactional Integration

- Integrate using `git cherry-pick <commit>` onto main.
- Add commit footer:
  - `ORCH_RUN_ID=<run>`
  - `ORCH_TASK_ID=<task>`
  - `ORCH_PROMPT_HASH=<hash>`

If cherry-pick conflicts:

- rebase sandbox branch on updated main
- attempt bounded retries
- if still conflicts, escalate to user with conflict details

---

## 13) Verification & Deterministic Output Validation

### 13.1 OutputVerifier (Deterministic)

If `expected.outputVerificationRequired`:

- Verify expected files exist.
- Verify exports using ts-morph:
  - symbol exists in expected file
  - symbol kind matches
  - optionally signature shape/hints

If mismatch → fail-closed and re-prompt.

### 13.2 Post-Merge Gate (Required)

After every successful integration:

- Run global gate command (or per-node gate if specified).
- Examples:
  - `pnpm -s tsc -p .`
  - `pnpm -s test --filter auth`

### 13.3 Dependency Invalidation

When Artifact Registry detects a public API signature change:

- Mark dependent nodes as **stale**.
- Policy options:
  - re-prompt dependents with new interfaces
  - or re-run dependents if already executed but not yet merged

---

## 14) Repair Loop (Bounded + Narrow)

### 14.1 Trigger

If post-merge gate fails:

- enqueue `repair` node at high priority.

### 14.2 Repair Scope Narrowing

Default repair allowlist:

- files changed by the last merged task
- files referenced by compiler/test errors
- optionally direct import parents

### 14.3 Budgets

- `maxAttempts` per failing merge (default 2)
- if exceeded: stop and surface to user with:
  - failing output
  - last N commits
  - candidate manual steps

---

## 15) Resilience & Resumability

### 15.1 Persistence

- SQLite stores:
  - DAG
  - task states
  - attempts
  - provider errors
  - artifact registry snapshots (or deltas)

### 15.2 Git Truth Reconciliation

On `resume`:

- scan main branch history for `ORCH_TASK_ID` footers
- reconcile task states vs SQLite
- if main branch drifted from baseline unexpectedly:
  - warn and require explicit `--accept-drift` or abort

### 15.3 Cleanup

- on startup: `git worktree prune`
- remove orphaned `.../orc/<run>/<task>` directories
- SIGINT/SIGTERM handlers to cleanup active sandboxes

---

## 16) Security & Hygiene (Best Effort)

### 16.1 Environment Allowlist

Only pass safe vars (e.g., `PATH`, `NODE_ENV`, `CI=1`).

### 16.2 Auth Bundle Strategy (Avoid HOME Contradiction)

Because CLIs typically store auth in user config paths:

- Detect required auth/config files per provider.
- Copy minimal auth bundle into sandbox HOME.
- Set strict perms (0600).

### 16.3 Network Policy

- `commandPolicy.network` is advisory unless an OS sandbox is enabled.
- Optional future: add container/firejail/sandbox-exec integration.

---

## 17) Observability & Provenance

### 17.1 Run Manifest

Write to `.orchestrator/runs/<run-id>/manifest.json`:

- provider versions + capability profiles
- prompt template hashes
- DAG JSON
- baseline commit

### 17.2 Task Logs

Per task:

- prompt hash
- provider
- start/end times
- stdout/stderr normalized log
- commit hash
- changed files
- verification results
- gate outputs

---

## 18) Milestone 1 (M1) — Definition of Done

**M1 DoD:**

- Runs 2 parallel tasks in separate worktrees.
- Integrates sequentially via cherry-pick.
- Enforces fail-closed allowlist/denylist (auto-reprompt, no silent merges).
- Runs `tsc` (or configured gate) after every merge.
- Auto-enqueues bounded repair tasks on gate failure.
- Resume recovers after forced SIGKILL by reconciling Git footers.

---

## 19) Implementation Plan

### Phase 1 — Foundation & PTY Subprocess Manager

- Initialize Node project: `typescript`, `zod`, `commander`, `node-pty`, `ts-morph`, `sqlite`.
- Build `PtySubprocessManager`:
  - ANSI normalization
  - heartbeat watchdog
  - completion marker capture
  - cross-platform kill-tree abstraction
- Implement provider `CapabilityProfile` discovery + auth checks.

### Phase 2 — Planning (DAG) + Validation + Audits

- Zod schemas for `TaskNode`, `DagSpec`.
- Codex planner wrapper (strict JSON).
- Plan self-audit step.
- Deterministic heuristic audit that can override risky ownership categories.

### Phase 3 — Worktrees + Scope Enforcement + Transactional Integration

- `SandboxManager` using `os.tmpdir()` short paths.
- `CommitAnalyzer` for allowlist/denylist enforcement.
- Cherry-pick integration with commit footers.

### Phase 4 — OutputVerifier + Artifact Registry + Dependency Invalidation

- `OutputVerifier` using ts-morph.
- `ArtifactRegistry` (export extraction + signature hashing).
- Dependent task staleness rules.

### Phase 5 — Verify Gate + Repair Loop + Resumability

- Post-merge gate runner (global + per-node).
- Repair task generation:
  - bounded attempts
  - narrowed scope derived from errors
- SQLite persistence + resume reconciliation via Git history scan.

---

## 20) Test Plan (Hardened Scenarios)

1. **Scope Violation**: task touches unauthorized file → merge rejected → auto-reprompt → passes.
2. **Textual Conflict**: cherry-pick conflict → bounded retries → escalates if unresolved.
3. **Semantic Conflict**: no textual conflict, but `tsc` fails post-merge → repair task fixes → gate passes.
4. **Provider Rate Limit**: simulated 429 → scheduler backs off and reduces concurrency.
5. **Hang / Silent Stall**: no output → watchdog interrupts/terminates/kill-tree → cleanup succeeds.
6. **Crash Recovery**: `kill -9` orchestrator mid-run → resume reconciles via commit footers and continues.
7. **HOME/Auth Bundle**: sandbox HOME set, auth copied → provider runs non-interactively.

---

## 21) Open Questions (Decisions Needed)

1. **Structured merge support**: which file types qualify for `shared-append`? (Recommendation: JSON/YAML registries only, with dedicated merge logic.)
2. **Baseline failure policy**: abort always vs optional baseline repair mode.
3. **OS sandbox**: do we want an optional secure mode (container/firejail) for network/filesystem restriction?
4. **Per-node gates**: how much flexibility vs simplicity in M1?

---

## 22) Default Config (Suggested)

- Global gate: `pnpm -s tsc -p .`
- Concurrency: `4`
- Token buckets: `codex=1`, `claude=2`, `gemini=2`
- Heartbeat timeout: `60s`
- Terminate grace: `10s`
- Repair attempts per failure: `2`
- Default deny commands: installs, `git push`, `curl`, `wget`, `rm -rf`, etc.
