# Execution Trace Report: "make snake game"

**Date:** 2026-03-02
**Context:** User prompted the execution flow inquiry for the input `make snake game`
**Component:** GitWeaver Orchestrator
**Auditor:** Antigravity (AI Audit)

---

## 1. CLI Invocation (`src/cli/main.ts` -> `src/cli/commands/run.ts`)

When the user types `orchestrator run "make snake game"` (or `pnpm dev run "make snake game"`):

- The **Commander.js** CLI parses the `run` command and its arguments.
- It parses options such as `--concurrency`, `--dry-run`, `--execution-mode`, and `--planner-provider`.
- Optional Bootstrapping: If `--bootstrap` is passed, `maybeBootstrapRepo()` prepares a brand new repository.
- Finally, it instantiates the `Orchestrator` class and executes `orchestrator.run({ prompt: "make snake game", ... })`.

## 2. Orchestrator Initialization & Baseline Check (`src/core/orchestrator.ts`)

- **Run Record Creation:** A unique `runId` (UUID) is generated. The Orchestrator captures the `baselineCommit` (current git HEAD) and records the initial `RunRecord` with state `INGEST`.
- **Baseline Gate (`checkBaseline`):** Before making any changes, the orchestrator triggers any configured baseline tests (e.g., `pnpm test`) via `runGate()`. This ensures the existing codebase is in a clean, passing state. If it fails (and `--allow-baseline-repair` is not set), the run aborts immediately.

## 3. Persistence & State Preparation

- **Filesystem Setup:** A dedicated run directory is created at `.orchestrator/runs/<runId>/`.
- **SQLite State Database (`OrchestratorDb`):** A persistent database at `.orchestrator/state.sqlite` tracks all states, attempting to operate robustly with `isSqliteBusyError` retry mechanisms.
- **Event Logging (`EventLog`):** An NDJSON append-only append log begins recording state transitions in `events.ndjson`.
- **Health Management:** `ProviderHealthManager` initializes rate-limiting and health budgets for Codex, Claude, and Gemini.
- **Preflight Checks:** `preflightStageA` and `preflightStageB` ensure providers and sandboxing dependencies (like Docker/Podman) are available.

## 4. Planning & DAG Generation (`src/planning/*`)

- The Orchestrator calls `this.plan()`, invoking the planning AI (e.g., `generateDagWithCodex`).
- **Input:** The objective `"make snake game"` along with repo context.
- **Output:** A Directed Acyclic Graph (DAG) of `TaskContract`s. For "make snake game," the plan might look like:
  1. Setup HTML Canvas dependencies.
  2. Implement snake logic state machine.
  3. Wire keyboard inputs.
  4. Implement game loop & rendering.
- **Audit & Freeze:** The plan is vetted by `auditPlan()` and frozen (`freezePlan()`). A Manifest (`writeManifest`) of intended tasks is persisted entirely to SQLite.

## 5. DAG Execution Engine

The orchestrator dispatches scheduled tasks using multiple underlying systems:

- **Scheduler:** Queues tasks and respects `--concurrency` limits while polling `ProviderHealthManager` to safely route attempts without throttling endpoints. Wait lists tasks with unsatisfied dependencies.
- **LockManager & LeaseHeartbeat:** Uses "fencing tokens" and file locks to guarantee that no two concurrently executing tasks write to the exact same file resources simultaneously.
- **WorktreeManager:** Spins out an isolated git `worktree` branching off the `baselineCommit` for each dispatched task, so it executes securely and cleanly without dirtying the main working tree.
- **RepairBudget:** Limits the number of AI retry attempts per class of failure.

## 6. Task Execution Lifecycle (`executeTask`)

For each task in the DAG (e.g., "Implement snake logic state machine"):

1. **Context Assembly (`buildContextPack`):** Extracts code elements from the repo needed for this specific module.
2. **Prompt Envelope (`buildPromptEnvelope`):** Embeds the context, constraints, command policies, and previous failure evidence (if this is a retry/repair) into the prompt string.
3. **Sandbox Setup (`createSandboxHome`, `buildSandboxEnv`):** Prepares a secure file & variable environment via `SecureExecutor`, enforcing variables and network policies.
4. **Agent Generation:** A provider adapter (`adapters/codex.ts` | `claude.ts` | `gemini.ts`) is invoked. It streams back completions.
5. **Completion Parsing:** The output is digested by `parseCompletionMarker`, separating code changes from agent reasoning.
6. **Task Commit (`analyzeCommit`):** The isolated worktree generates a commit encompassing the task outputs.

## 7. Verification & Gating (`src/verification/*`)

After the code is written in the local worktree, GitWeaver verifies the output:

- **Scope Verification (`evaluateScope`):** Validates that no protected or out-of-bound files were mutated.
- **Staleness Tracking:** Uses the `collectArtifactSignatures` hashes to verify that dependent files didn't drift during the agent execution time.
- **Automated Testing (`verifyTaskOutput`):** If tests are associated, the sandbox execution runs them against the isolated worktree.
- **Repair Cycle:** If verification fails, `classifyFailure` analyzes the error (e.g., typing error, failing test). If budgets allow, `buildRepairTask` feeds the error back to the provider logic queue for a hot-fix. If budgets are exhausted, task state becomes `ESCALATED`.

## 8. Merge and Re-Plan

- **Queueing (`MergeQueue`):** If verified cleanly, tasks achieve `COMMITTED` status and are dispatched for final merge into the main branch.
- **Dynamic Replanning:** If the orchestrator executing a task hits a wall and triggers `REASON_CODES.REPLAN_REQUESTED`, execution pauses. It generates a delta DAG evaluating completed progress against new context, canceling stale tasks, spinning up new paths, and resuming dispatch.

## 9. Conclusion

- The final state is reached when all queues are drained, hitting `COMPLETED` (success) or `ABORTED_POLICY` (escalated failure).
- Results are reported locally (`runId`, `state`, `summary`) visually to the user.
- If it exits successfully, the user sees the output "make snake game" checked directly into their repo, completely tested and audited.

---
*Generated by Antigravity Automation*
