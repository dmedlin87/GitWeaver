# Getting Started

## Prerequisites

- **Node.js >= 24.0.0** &mdash; Required for the native `node:sqlite` module (`DatabaseSync`)
- **pnpm 10** &mdash; Package manager
- **Git** &mdash; Repository must be a git repo with a clean working tree
- At least one AI provider CLI installed (Codex, Claude, or Gemini)

## Installation

```bash
git clone https://github.com/dmedlin87/GitWeaver.git
cd GitWeaver
pnpm install
pnpm build
```

After building, the `orchestrator` binary is available at `dist/cli/main.js` and can be invoked directly or via `pnpm dev` (which uses `tsx` for live TypeScript execution without building).

## Development Mode

For development, use `tsx` to skip the build step:

```bash
pnpm dev run "your prompt here"
pnpm dev providers check
pnpm dev status <runId>
```

## Build & Test Commands

| Command | Purpose |
|---------|---------|
| `pnpm install` | Install dependencies (use `--frozen-lockfile` in CI) |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm typecheck` | Type-check only (`tsc --noEmit`) |
| `pnpm test` | Run all tests (unit + integration + e2e) via Vitest |
| `pnpm dev run "prompt"` | Run CLI in dev mode via tsx |
| `pnpm clean` | Remove `dist/` and `.orchestrator/` |

CI runs `pnpm typecheck && pnpm build && pnpm test` &mdash; all three must pass.

## Setting Up Providers

Before running an orchestration, at least one provider must be installed and authenticated. Check provider status:

```bash
pnpm dev providers check
```

Install missing providers:

```bash
pnpm dev providers install --yes
```

Fix authentication:

```bash
pnpm dev providers auth --fix
```

See [[Provider Setup]] for detailed instructions per provider.

## Your First Run

Navigate to any git repository with a clean working tree:

```bash
cd /path/to/your/project
orchestrator run "Add error handling to all API endpoints"
```

Or in dev mode from the GitWeaver directory:

```bash
pnpm dev run "Add error handling to all API endpoints" --repo /path/to/your/project
```

Planner selection defaults to automatic Codex/Claude routing. To force a specific planner:

```bash
orchestrator run "Add error handling to all API endpoints" --planner-provider codex
```

## One-Command New Repo Bootstrap

If you want to start from a brand-new folder, `run` can bootstrap the repo first:

```bash
orchestrator run "Build a Snake game in TypeScript with tests" \
  --repo C:\Users\you\Projects\snake-game \
  --bootstrap \
  --bootstrap-template web-game-ts
```

What bootstrap does:

- Creates the target folder (if it does not exist)
- Initializes a git repository (if needed)
- Scaffolds starter files from template (`blank` or `web-game-ts`)
- Creates an initial commit when the repo has no commits yet
- Continues with the normal orchestration run

Notes:

- `--bootstrap` requires `--repo <path>`
- Existing files are not overwritten during scaffolding

### Dry Run (Preview Only)

To see the generated plan without executing anything:

```bash
orchestrator run "Refactor authentication module" --dry-run --dry-run-report detailed
```

This outputs the full DAG with task assignments, provider routing, and scope analysis.

## Directory Structure After a Run

After orchestration, a `.orchestrator/` directory is created in the target repository:

```
.orchestrator/
  state.sqlite              # SQLite database
  runs/
    <runId>/
      manifest.json         # Run metadata, provider versions, DAG hash
      plan.raw.json         # Unaudited DAG from planner
      plan.audited.json     # Audited DAG with adjusted ownership
      plan.frozen.json      # Final frozen DAG
      events.ndjson         # Append-only event log
```

## Next Steps

- [[CLI Reference]] &mdash; All commands, arguments, and flags
- [[Configuration]] &mdash; Customize behavior with config files
- [[Provider Setup]] &mdash; Install and authenticate AI providers
- [[Workflow Lifecycle]] &mdash; Understand the full orchestration pipeline
