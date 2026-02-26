# GitWeaver Orchestrator

`orchestrator` is a local Node.js + TypeScript CLI-of-CLIs runtime for Codex, Claude, and Gemini.

## Setup

```bash
pnpm install
pnpm build
```

Run in dev mode:

```bash
pnpm dev run "your objective"
```

## Commands

- `orchestrator run "<prompt>" [--concurrency N] [--dry-run] [--config path] [--repo path] [--allow-baseline-repair] [--accept-drift]`
- `orchestrator resume <run-id> [--accept-drift]`
- `orchestrator status <run-id> [--json]`
- `orchestrator inspect <run-id> [--task <id>] [--json]`
- `orchestrator locks <run-id> [--json]`
- `orchestrator providers check [--json]`
- `orchestrator providers install [--providers codex,claude,gemini] [--yes] [--json]`
- `orchestrator providers auth [--provider codex|claude|gemini] [--fix] [--json]`

## Provider Install Defaults

- Codex: `npm install -g @openai/codex@latest`
- Claude: `npm install -g @anthropic-ai/claude-code@latest`
- Gemini: `npm install -g @google/gemini-cli@latest`

## Notes

- Runs require a clean git repository baseline unless explicitly overridden.
- Merge integration is commit-based and guarded by scope + verification gates.
- Event log path: `.orchestrator/runs/<run-id>/events.ndjson`.