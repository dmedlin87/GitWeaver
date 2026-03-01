# GitWeaver Orchestrator

**GitWeaver Orchestrator** is a local Node.js + TypeScript CLI that orchestrates multi-model AI workflows across **Codex**, **Claude**, and **Gemini**. It reads a repository, plans architectural changes as a DAG of tasks, executes them in isolated git worktrees using specialized AI agents, and validates every change against the existing test suite before merging.

---

## Table of Contents

- [[Getting Started]]
- [[CLI Reference]]
- [[Configuration]]
- [[Provider Setup]]
- [[Provider CLI Comparison]]
- [[Gemini CLI Reference]]
- [[Codex CLI Reference]]
- [[Claude Code CLI Reference]]
- [[Workflow Lifecycle]]
- [[State Machines]]
- [[Persistence and Resume]]
- [[Security]]
- [[Scheduler and Concurrency]]
- [[Repair System]]
- [[Observability]]
- [[Troubleshooting]]
- [[Reason Codes]]
- [[Architecture Reference]]

---

## Quick Start

```bash
# Prerequisites
node --version   # >= 24.0.0
pnpm --version   # 10.x

# Install
git clone https://github.com/dmedlin87/GitWeaver.git
cd GitWeaver
pnpm install
pnpm build

# Verify providers are available
pnpm dev providers check

# Run your first orchestration
pnpm dev run "Add TypeScript strict mode to all source files"
```

---

## How It Works

1. **Ingest** &mdash; Validates the repository, captures a baseline commit, and runs a gate command to confirm the project builds cleanly.
2. **Plan** &mdash; Sends the user prompt to a planner (Codex) which returns a DAG of tasks, each with file scopes, command policies, and provider assignments.
3. **Audit & Freeze** &mdash; The DAG is audited for hot-resource conflicts (lockfiles, barrel exports, schemas), ownership is adjusted, and the plan is frozen with cryptographic hashes.
4. **Dispatch** &mdash; Tasks are enqueued in a priority scheduler, write leases are acquired via fencing tokens, and tasks are dispatched to providers concurrently within configured limits.
5. **Execute** &mdash; Each provider runs in an isolated worktree with a filtered environment. Output commits include orchestration metadata footers for traceability.
6. **Verify & Merge** &mdash; Changes pass scope policy checks, enter a serialized merge queue, and run post-merge gates. Failed tasks are classified and optionally repaired within a bounded budget.
7. **Resume** &mdash; On crash, state is reconciled using a three-layer precedence: **git history > event log > SQLite**.

---

## System Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | >= 24.0.0 |
| pnpm | 10.x |
| Git | Any modern version |
| OS | Linux, macOS, Windows 11 |

### Optional

| Requirement | For |
|-------------|-----|
| Docker or Podman | Container execution mode |

---

## Project Links

- [Repository](https://github.com/dmedlin87/GitWeaver)
- [Roadmap](https://github.com/dmedlin87/GitWeaver/blob/master/ROADMAP.md)
- [Architecture PRD](https://github.com/dmedlin87/GitWeaver/blob/master/docs/cli_driven_heterogeneous_orchestrator_prd_technical_architecture_v_2_revised_final.md)
