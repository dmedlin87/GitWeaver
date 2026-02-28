# GitWeaver Chat — PRD & Technical Architecture v1.0

## 0) Context

GitWeaver Orchestrator is a production-ready CLI that plans, executes, and validates multi-model AI workflows against git repositories. It currently has zero open roadmap gaps, 494 passing tests, and a clean build.

This document specifies **GitWeaver Chat** — a separate application that provides a conversational interface on top of the orchestrator. It serves two purposes:

1. Make the orchestrator accessible to users who don't want to memorize CLI flags.
2. Dogfood the orchestrator itself: this project will be built using GitWeaver Orchestrator as the first real-world greenfield test.

---

## 1) Summary

GitWeaver Chat is a local-first web application that wraps the GitWeaver Orchestrator CLI in a real-time conversational UI. Users describe what they want done to a repository in natural language. The chat interface translates that into orchestrator invocations, streams progress, and surfaces results — all without requiring the user to touch a terminal.

---

## 2) Goals

### 2.1 Functional Goals

1. **Chat-driven orchestration** — User types a natural language objective. The app translates it into an `orchestrator run` invocation with appropriate flags.
2. **Real-time progress streaming** — DAG planning, task assignment, provider routing, verification gates, and merge outcomes stream into the chat as they happen.
3. **Run history and inspection** — Past runs are listed with status. Users can drill into any run to see tasks, events, and logs (wrapping `orchestrator status`, `inspect`, `locks`).
4. **Repository selection** — User picks a local repo path (or recent repo) before starting a run. The app validates it's a git repo.
5. **Configuration presets** — Expose key orchestrator options (concurrency, execution mode, dry-run, provider routing) as UI controls rather than CLI flags.
6. **Run control** — Ability to view active runs, see live progress, and resume failed runs.

### 2.2 Non-Functional Goals

- **Local-first** — No cloud dependency. Runs entirely on the user's machine.
- **Low latency** — Progress updates appear within 1 second of orchestrator emission.
- **Minimal footprint** — Single `pnpm dev` to start. No database beyond what the orchestrator already manages.
- **Clean separation** — The chat app never imports orchestrator internals. It interacts exclusively through CLI invocation and stdout/stderr parsing.

### 2.3 Non-Goals (v1)

- Multi-user / multi-tenant access.
- Remote repository support (SSH/HTTPS cloning).
- Built-in code editor or diff viewer (link out to VS Code / GitHub instead).
- Provider API key management (the orchestrator handles this via environment variables).
- Mobile-responsive design (desktop-first).

---

## 3) Architecture

### 3.1 High-Level Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | React 19 + TypeScript | Component model, ecosystem, types |
| Styling | Tailwind CSS 4 | Utility-first, fast iteration, no CSS-in-JS runtime |
| Build tool | Vite 7 | Fast HMR, ESM-native, minimal config |
| Backend | Node.js + Fastify | Lightweight, schema-validated routes, WebSocket support |
| Real-time | WebSocket (via `@fastify/websocket`) | Bidirectional streaming for run progress |
| Orchestrator integration | Child process (`node:child_process`) | Spawn `orchestrator` CLI commands, pipe stdout/stderr |
| State | In-memory server state + orchestrator's own SQLite | No additional database |
| Package manager | pnpm 10 | Consistent with orchestrator repo |
| Test framework | Vitest 4 | Consistent with orchestrator repo |

### 3.2 Module Boundaries

```
gitweaver-chat/
  packages/
    server/           Fastify backend — orchestrator bridge
      src/
        routes/       REST endpoints (runs, status, config)
        ws/           WebSocket handlers (progress streaming)
        bridge/       Orchestrator CLI spawner and output parser
        config/       Server config, repo validation
      tests/
    web/              React frontend
      src/
        components/   UI components
        hooks/        React hooks (useWebSocket, useRuns, etc.)
        pages/        Route-level page components
        stores/       Client state (Zustand or React context)
        types/        Shared TypeScript types
      tests/
    shared/           Shared types between server and web
      src/
        types/        Run, Task, Progress, Config types
```

### 3.3 Orchestrator Bridge

The server **never** imports from `gitweaver-orchestrator` source code. Instead:

1. **CLI spawning** — The bridge spawns `orchestrator run|status|inspect|locks|resume` as child processes using `node:child_process.spawn`.
2. **Output parsing** — Progress lines from stderr (format: `[timestamp] runId | stage | ...: message`) are parsed into structured `ProgressEvent` objects and forwarded over WebSocket.
3. **JSON mode** — All orchestrator commands are invoked with `--json` where available, so results are machine-parseable.
4. **Orchestrator location** — Configurable via `ORCHESTRATOR_BIN` env var. Defaults to looking for `orchestrator` on `$PATH`, falling back to a sibling directory convention (`../GitWeaver/dist/cli/main.js`).

### 3.4 Data Flow

```
User types message
  → Frontend sends POST /api/runs { prompt, repo, options }
  → Server validates repo path (git rev-parse)
  → Server spawns: orchestrator run "<prompt>" --repo <path> --json [flags]
  → Server parses stderr progress lines → WebSocket push to client
  → Server captures stdout JSON result → stores in memory → REST-queryable
  → Frontend renders progress events in chat thread
  → On completion: final result card with status, summary, task breakdown
```

### 3.5 API Surface

#### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/runs` | Start a new orchestrator run |
| `GET` | `/api/runs` | List all runs (from orchestrator status) |
| `GET` | `/api/runs/:runId` | Get run detail (orchestrator inspect) |
| `GET` | `/api/runs/:runId/events` | Get run event log |
| `GET` | `/api/runs/:runId/locks` | Get run lock state |
| `POST` | `/api/runs/:runId/resume` | Resume a failed run |
| `GET` | `/api/repos/validate` | Validate a path is a git repo |
| `GET` | `/api/config` | Get current default orchestrator config |

#### WebSocket

| Channel | Direction | Payload |
|---------|-----------|---------|
| `run:progress` | Server → Client | `{ runId, stage, taskId?, provider?, message, ts }` |
| `run:complete` | Server → Client | `{ runId, state, summary }` |
| `run:error` | Server → Client | `{ runId, reasonCode, message }` |

---

## 4) Frontend Design

### 4.1 Layout

Three-panel layout:

- **Left sidebar** — Run history list, repo selector, settings.
- **Main panel** — Chat thread. Messages alternate between user prompts and system responses (progress stream + final results).
- **Right panel (expandable)** — Run detail inspector. Task DAG visualization, individual task status, event timeline. Hidden by default, opens on click.

### 4.2 Key Components

| Component | Purpose |
|-----------|---------|
| `ChatThread` | Scrollable message list with user/system message bubbles |
| `ProgressStream` | Live-updating list of progress events during a run |
| `RunResultCard` | Final status card showing pass/fail, task summary, timing |
| `DagViewer` | Simple DAG visualization of task dependencies (SVG/Canvas) |
| `RepoSelector` | Path input with validation indicator, recent repos dropdown |
| `ConfigPanel` | Collapsible panel for concurrency, execution mode, dry-run toggle |
| `RunHistoryList` | Sidebar list of past runs with status badges |
| `ProviderSettings` | Provider priority order, health dashboard, concurrency slots (see §4.4) |

### 4.3 Chat UX Flow

1. User selects a repository (or it remembers the last-used repo).
2. User types: "Add input validation to all API endpoints"
3. System shows: "Starting run..." with a spinner.
4. Progress events stream in as indented, timestamped lines below the spinner.
5. On completion, a result card replaces the spinner showing:
   - Run status (COMPLETED / FAILED)
   - Number of tasks planned / executed / merged
   - Total duration
   - Expandable task-by-task breakdown
6. User can ask follow-up questions or start a new run.

### 4.4 Provider Settings Panel

A dedicated settings page (accessible from the sidebar) for configuring provider routing behavior. This is the primary interface for controlling how the orchestrator distributes work across Codex, Claude Code, and Gemini CLI.

#### Priority Order

A drag-to-reorder list of the three providers. The order determines which provider gets the first attempt at any task, regardless of task type. When the top-priority provider hits its quota or goes into cooldown (detected automatically from CLI output), the orchestrator falls back to the next in line.

Default order: **Codex → Claude Code → Gemini CLI**

This overrides the orchestrator's built-in task-type routing (which otherwise assigns providers based on task category). With a priority order set, all tasks go to Codex first; the type-based logic only applies as a tiebreaker when two providers are equally healthy.

#### Real-Time Health Dashboard

Live health state for each provider, polled every 5 seconds from `/api/providers/health`:

| Field | Display |
|-------|---------|
| Health score (0–100) | Color-coded bar: green ≥ 80, yellow ≥ 50, red < 50 |
| Status | AVAILABLE / COOLDOWN / DEGRADED |
| Cooldown remaining | Countdown timer if in cooldown |
| Consecutive failures | Badge count |
| Last error | Truncated error text, expandable |

When a provider is in cooldown (quota hit), the UI makes this visually clear so the user understands why tasks are being routed elsewhere.

#### Concurrency Slots

Number spinners for each provider controlling how many tasks can run simultaneously. These map directly to `providerBuckets` in the orchestrator config.

Recommended defaults for subscription plans (no API keys):
- **Codex**: 2
- **Claude Code**: 2
- **Gemini CLI**: 1

#### Quota Fallback Behavior

Toggle: `On quota/rate-limit, automatically fall back to next provider` (default: on)

When enabled, 429 / "quota exceeded" responses from any provider CLI trigger immediate rerouting to the next provider in the priority order. The degraded provider enters cooldown with exponential backoff. It automatically recovers after successful completions.

#### Reasoning Level & Model Selection

Every provider exposes controls for how hard it thinks per task. Running simple tasks at lower reasoning/smaller models dramatically extends effective daily quota across all three $20 subscriptions.

**Note:** This feature requires additions to the orchestrator core — `TaskContract.complexity`, `ProviderExecutionRequest.reasoningLevel/model`, and CLI flag injection in each adapter. Tracked as Gap 2 in `docs/gitweaver-system-flowcharts.md`.

##### Codex — Reasoning Effort

| Level | Best for | Relative quota cost |
|-------|---------|-------------------|
| `low` | Boilerplate, docs, fixtures, simple renames | ~20% |
| `medium` | Standard code, tests, typical bug fixes | ~40% (default) |
| `high` | Complex refactors, multi-file changes | ~65% |
| `extra-high` | Architecture, deep planning, critical repairs | ~100% |

##### Claude Code — Model Tier

| Model | Best for | Relative quota cost |
|-------|---------|-------------------|
| `haiku-4-5` | Boilerplate, formatting, simple docs, trivial repairs | ~15% |
| `sonnet-4-6` | Standard code, refactor, tests, bug fixes | ~50% (default) |
| `opus-4-6` | Complex architecture, large multi-file redesigns, deep planning | ~100% |

##### Gemini — Model Tier

| Model | Best for | Relative quota cost |
|-------|---------|-------------------|
| `flash` | Low-complexity tasks, docs, formatting | Lower |
| `pro` | Standard and complex tasks | Higher (default) |

##### UI: Complexity → Model Matrix

A 3×3 grid in the Provider Settings panel. Rows = complexity tiers (low / medium / high). Columns = providers (Codex / Claude / Gemini). Each cell is a dropdown. Changes persist to `gitweaver-chat.config.json` immediately.

Default matrix:

|  | Codex | Claude | Gemini |
|--|-------|--------|--------|
| **High** | extra-high | opus-4-6 | pro |
| **Medium** | medium | sonnet-4-6 | pro |
| **Low** | low | sonnet-4-6 | flash |

Haiku is available in the Low/Claude dropdown but off by default. Enable it for maximum quota extension on simple tasks.

#### API Surface Addition

```
GET  /api/providers/health     → current health snapshot for all three providers
POST /api/providers/settings   → update priority order, concurrency slots, complexity model matrix
```

---

## 5) Configuration

### 5.1 Server Configuration

```jsonc
// gitweaver-chat.config.json (optional, all fields have defaults)
{
  "port": 3847,
  "host": "127.0.0.1",
  "orchestratorBin": "orchestrator",     // or absolute path to orchestrator binary
  "defaultRepo": null,                    // remembered from last session
  "maxConcurrentRuns": 2,
  "logLevel": "info",
  "providerPriority": ["codex", "claude", "gemini"],  // global fallback order
  "providerBuckets": {                    // concurrency slots per provider
    "codex": 2,
    "claude": 2,
    "gemini": 1
  }
}
```

`providerPriority` sets the global preference order, overriding the orchestrator's built-in task-type routing. The first provider in the list gets first attempt on all tasks. When it hits quota or goes into cooldown, tasks automatically fall back to the second, then the third.

`providerBuckets` controls concurrency — how many tasks a provider can handle simultaneously. Lower values reduce the rate at which you consume quota on that provider.

### 5.2 Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ORCHESTRATOR_BIN` | Path to orchestrator binary | `orchestrator` |
| `PORT` | Server port | `3847` |
| `HOST` | Server bind address | `127.0.0.1` |

---

## 6) Testing Strategy

| Layer | Approach |
|-------|----------|
| Bridge unit tests | Mock `child_process.spawn`, verify progress parsing, JSON result extraction |
| API integration tests | Supertest against Fastify, mock bridge responses |
| WebSocket tests | `ws` client against test server, verify event streaming |
| Frontend component tests | Vitest + React Testing Library |
| E2E | Playwright — full flow from chat input to progress display to result card |

---

## 7) Security Considerations

- **Local-only binding** — Server binds to `127.0.0.1` by default. No external access.
- **No secrets in the chat app** — Providers authenticate via their own CLIs (Claude Code, Codex, Gemini CLI) using subscription auth. No API keys are stored anywhere in the chat app or the orchestrator config.
- **Input sanitization** — User prompts are passed as CLI arguments; shell injection is prevented by using `spawn` with argument arrays (no shell interpolation).
- **No auth (v1)** — Local-only means no authentication needed. Multi-user would require this.
- **Repo path validation** — The server validates repo paths exist and are git repositories before passing to the orchestrator.

---

## 8) Future Considerations (v2+)

- Conversational memory — multi-turn context where follow-up prompts reference prior run results.
- Diff viewer — inline code diffs for each merged task.
- Provider dashboard — real-time health/latency display for Codex/Claude/Gemini.
- Notification system — desktop notifications on run completion.
- Plugin/extension model — custom pre/post-run hooks configurable from the UI.
- Remote repo support — clone and operate on remote repositories.
