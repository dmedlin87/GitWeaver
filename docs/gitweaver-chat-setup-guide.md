# GitWeaver Chat — Setup & Dogfooding Guide

This guide walks through creating the GitWeaver Chat repository from scratch, then using the GitWeaver Orchestrator to build it. The goal is to dogfood the orchestrator on a real greenfield project.

---

## Prerequisites

Before starting, confirm:

- [ ] Node.js >= 24.0.0 installed (`node -v`)
- [ ] pnpm 10 installed (`pnpm -v`)
- [ ] GitWeaver Orchestrator builds and passes tests:
  ```bash
  cd ~/Projects/GitWeaver
  pnpm typecheck && pnpm build && pnpm test
  ```
- [ ] Provider CLIs are installed and already authenticated via your subscriptions:
  - **Claude Code CLI** (`claude --version`) — logged in via your Anthropic subscription
  - **Codex CLI** (`codex --version`) — logged in via your OpenAI subscription
  - **Gemini CLI** (`gemini --version`) — logged in via your Google account

  The orchestrator spawns these CLIs directly using PTY — it inherits whatever auth they already have. No API keys required or used.

  Verify all three are ready:
  ```bash
  orchestrator providers check
  ```
- [ ] The orchestrator is accessible via `pnpm dev` or built to `dist/`:
  ```bash
  # Option A: use tsx (no build needed)
  cd ~/Projects/GitWeaver && pnpm dev run --help

  # Option B: build and link globally
  cd ~/Projects/GitWeaver && pnpm build && pnpm link --global
  orchestrator --help
  ```

---

## Step 1: Create the Chat Repository

```bash
mkdir ~/Projects/GitWeaverChat
cd ~/Projects/GitWeaverChat
git init
```

## Step 2: Scaffold the Monorepo Structure

Create the minimal skeleton that the orchestrator needs as a starting point. The orchestrator works best when there's enough structure to run verification gates against.

```bash
# Root config files
pnpm init

# Create workspace structure
mkdir -p packages/server/src packages/server/tests
mkdir -p packages/web/src packages/web/tests
mkdir -p packages/shared/src
```

### 2a: Root `package.json`

Edit the generated `package.json`:

```json
{
  "name": "gitweaver-chat",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24.0.0"
  },
  "packageManager": "pnpm@10.12.1"
}
```

### 2b: `pnpm-workspace.yaml`

```yaml
packages:
  - "packages/*"
```

### 2c: `tsconfig.json` (root)

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "references": [
    { "path": "packages/shared" },
    { "path": "packages/server" },
    { "path": "packages/web" }
  ]
}
```

### 2d: Copy the PRD into the repo

```bash
cp ~/Projects/GitWeaver/docs/gitweaver-chat-prd.md ~/Projects/GitWeaverChat/PRD.md
```

## Step 3: Create a Minimal CLAUDE.md

The orchestrator (and any AI agent) benefits from project context. Create `CLAUDE.md` in the chat repo root:

```markdown
# CLAUDE.md — GitWeaver Chat

## Project Summary

GitWeaver Chat is a local-first web application that provides a conversational
interface for the GitWeaver Orchestrator CLI. Users describe repository changes
in natural language; the app translates that into orchestrator invocations and
streams results in real-time.

## Tech Stack

- **Runtime**: Node.js >= 24.0.0
- **Language**: TypeScript (strict mode, ES2023 target)
- **Module system**: ESM
- **Package manager**: pnpm 10 (workspace monorepo)
- **Frontend**: React 19, Tailwind CSS 4, Vite 7
- **Backend**: Fastify, @fastify/websocket
- **Test framework**: Vitest 4
- **E2E**: Playwright

## Source Layout

Monorepo with three packages:
- `packages/server/` — Fastify backend, orchestrator bridge
- `packages/web/` — React frontend
- `packages/shared/` — Shared TypeScript types

## Conventions

- File naming: kebab-case
- Test files: `<module>.test.ts` colocated under `tests/`
- The server NEVER imports orchestrator internals — CLI spawning only
- All orchestrator commands invoked with `--json` where available

## Build / Test

```bash
pnpm install
pnpm build
pnpm test
pnpm dev           # starts both server and web dev servers
```
```

## Step 4: Initial Commit

```bash
cd ~/Projects/GitWeaverChat
git add -A
git commit -m "Initial scaffold: monorepo structure, PRD, project config"
```

## Step 5: Install Base Dependencies

Before running the orchestrator, install enough dependencies that verification gates can function:

```bash
# Root dev deps
pnpm add -Dw typescript vitest @types/node

# Server package
cd packages/server
pnpm init
pnpm add fastify @fastify/websocket @fastify/cors
pnpm add -D @types/node typescript vitest
cd ../..

# Web package
cd packages/web
pnpm init
# Vite + React setup
pnpm add react react-dom
pnpm add -D vite @vitejs/plugin-react typescript @types/react @types/react-dom vitest
pnpm add -D tailwindcss @tailwindcss/vite
cd ../..

# Shared package
cd packages/shared
pnpm init
pnpm add -D typescript
cd ../..

# Install everything
pnpm install
```

Commit:
```bash
git add -A
git commit -m "Add base dependencies for server, web, and shared packages"
```

## Step 6: Add Minimal Build/Test Scripts

Each package needs at least a `build` and `test` script so the orchestrator's verification gates have something to run. Even placeholder scripts work:

**`packages/shared/package.json`** — add scripts:
```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "test": "vitest run"
}
```

**`packages/server/package.json`** — add scripts:
```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "test": "vitest run",
  "dev": "tsx src/index.ts"
}
```

**`packages/web/package.json`** — add scripts:
```json
"scripts": {
  "build": "vite build",
  "test": "vitest run",
  "dev": "vite"
}
```

Each package needs its own `tsconfig.json` with project references. Create minimal ones that extend the root.

Commit:
```bash
git add -A
git commit -m "Add build and test scripts to all packages"
```

## Step 7: Create a Baseline Gate

The orchestrator runs a baseline gate command before starting. You need the repo to be in a state where `pnpm build` (or your chosen gate) passes.

Create minimal entry files so builds succeed:

- `packages/shared/src/index.ts` — `export {};`
- `packages/server/src/index.ts` — `export {};`
- `packages/web/src/App.tsx` — minimal React component

Verify:
```bash
pnpm -r build  # should pass for all packages
```

Commit:
```bash
git add -A
git commit -m "Add minimal entry files for baseline gate"
```

## Step 8: Create an Orchestrator Config

Create a config file tuned for the chat project:

**`~/Projects/GitWeaverChat/orchestrator.config.json`**:
```json
{
  "baselineGateCommand": "pnpm -r build",
  "concurrencyCap": 3,
  "executionMode": "host",
  "smokeGateByType": {
    "code": "pnpm -r build && pnpm -r test",
    "refactor": "pnpm -r build && pnpm -r test"
  }
}
```

Commit:
```bash
git add orchestrator.config.json
git commit -m "Add orchestrator config for chat project"
```

---

## Step 9: Run the Orchestrator

Now the moment of truth. From the orchestrator repo, point it at the chat repo:

```bash
cd ~/Projects/GitWeaver

# Dry run first — see the plan without executing
pnpm dev run \
  "Build the GitWeaver Chat application as described in PRD.md. Start with the shared types package, then the server bridge and API routes, then the React frontend components. Each task should produce working, buildable code." \
  --repo ~/Projects/GitWeaverChat \
  --config ~/Projects/GitWeaverChat/orchestrator.config.json \
  --dry-run

# If the plan looks good, run it for real
pnpm dev run \
  "Build the GitWeaver Chat application as described in PRD.md. Start with the shared types package, then the server bridge and API routes, then the React frontend components. Each task should produce working, buildable code." \
  --repo ~/Projects/GitWeaverChat \
  --config ~/Projects/GitWeaverChat/orchestrator.config.json
```

### Tips for the First Run

- **Start with `--dry-run`** to inspect the DAG before committing to execution. Review the task breakdown and dependency ordering.
- **Use `--concurrency 1`** on the first attempt to make debugging easier. Increase once you trust the pipeline.
- **If a run fails**, use `orchestrator status --json` and `orchestrator inspect <runId> --json` from within the chat repo directory to diagnose.
- **Resume** failed runs with `orchestrator resume <runId>` from within the chat repo.

---

## Step 10: Iterate

After the first orchestrator run, you'll likely need refinement passes:

1. **Review what the orchestrator produced** — check the git log in the chat repo.
2. **Run the app manually** — `pnpm dev` in the chat repo. Does the server start? Does the frontend render?
3. **File targeted follow-up runs** — e.g., "Add WebSocket progress streaming to the server bridge" or "Create the ChatThread component with message bubbles".
4. **Write tests manually** for anything the orchestrator missed, then use the orchestrator for the next feature batch.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Not a git repository` | Ensure `git init` was run in the chat repo |
| Baseline gate fails before run starts | Run `pnpm -r build` manually in the chat repo, fix any errors |
| Orchestrator can't find provider CLI | Check `orchestrator providers check` — ensure API keys are set |
| Tasks fail with scope errors | The orchestrator may need broader file scope for a greenfield project — check the DAG's scope declarations |
| WebSocket connection refused | Check that port 3847 isn't in use; verify server starts with `pnpm dev` |

---

## What Success Looks Like

After one or two orchestrator runs + manual cleanup:

- `pnpm dev` starts a Fastify server on :3847 and a Vite dev server on :5173
- Opening `localhost:5173` shows the chat UI with repo selector
- Typing a prompt and submitting triggers an orchestrator run visible in real-time
- Run history persists in the sidebar across page reloads
- `pnpm -r build && pnpm -r test` passes cleanly
