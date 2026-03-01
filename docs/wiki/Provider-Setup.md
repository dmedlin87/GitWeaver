# Provider Setup

GitWeaver orchestrates tasks across three AI provider CLIs. At least one must be installed and authenticated for orchestration to work.

For a quick side-by-side behavior map used by agents and adapters, see [Provider CLI Comparison](./Provider-CLI-Comparison.md).

## Supported Providers

| Provider | npm Package | CLI Binary | Purpose |
|----------|-------------|------------|---------|
| **Codex** | `@openai/codex` | `codex` | Default planner; code generation |
| **Claude** | `@anthropic-ai/claude-code` | `claude` | Code generation, refactoring |
| **Gemini** | `@google/gemini-cli` | `gemini` | Code generation, analysis |

## Checking Provider Status

```bash
orchestrator providers check
```

Sample output:

```
codex:  installed=true  version=0.5.0  auth=OK       health=HEALTHY
claude: installed=true  version=1.0.0  auth=MISSING   health=UNAVAILABLE
gemini: installed=false                                health=UNAVAILABLE
  - Provider binary 'gemini' not found. Install: npm install -g @google/gemini-cli
```

Use `--json` for machine-readable output.

## Installing Providers

### Automatic Installation

```bash
orchestrator providers install --yes
```

This installs all missing providers via `npm install -g`. To install specific providers:

```bash
orchestrator providers install --providers claude,gemini --yes
```

### Manual Installation

#### Codex

```bash
npm install -g @openai/codex
```

#### Claude

```bash
npm install -g @anthropic-ai/claude-code
```

#### Gemini

```bash
npm install -g @google/gemini-cli
```

## Authentication

### Checking Auth Status

```bash
orchestrator providers auth
```

### Fixing Missing Auth

```bash
# Fix all providers
orchestrator providers auth --fix

# Fix specific provider
orchestrator providers auth --provider claude --fix
```

### Manual Auth Commands

| Provider | Auth Command | What It Does |
|----------|-------------|--------------|
| Codex | `codex login` | Authenticate with OpenAI |
| Claude | `claude auth login` | Authenticate with Anthropic |
| Gemini | `gemini` | Interactive authentication with Google |

### Auth Verification Commands

These are what the orchestrator runs internally to check auth:

| Provider | Verification Command |
|----------|---------------------|
| Codex | `codex login status` |
| Claude | `claude auth status` |
| Gemini | `gemini --prompt "OK" --output-format json --approval-mode plan` |

## Provider Health System

Each provider tracks a health score from 0 to 100 that affects task routing.

### Health Degradation

- On failure: score decreases by 20
- Consecutive failures trigger exponential backoff: `backoff = baseSec * 2^(failures - 1)`
- A cooldown timer blocks dispatch until backoff expires
- The last 5 errors are retained for diagnostics

### Health Recovery

- On success: score increases by `providerHealthRecoverPerSuccess` (default: 10)
- Consecutive failure counter resets to 0
- Backoff timer clears

### Dispatch Eligibility

A provider must have:
- Health score >= 50
- No active cooldown timer

If the primary provider is unhealthy, the router checks a fallback chain:

| Primary | Fallback 1 | Fallback 2 |
|---------|------------|------------|
| Codex | Claude | Gemini |
| Claude | Codex | Gemini |
| Gemini | Claude | Codex |

## Provider Execution

### How Providers Are Invoked

Each provider adapter translates the orchestrator's request into provider-specific CLI arguments:

**Codex:**
```bash
codex exec --json --cd <worktree-path> "<prompt>"
```

**Claude:**
```bash
claude --print --output-format json "<prompt>"
```

**Gemini:**
```bash
# Prompt passed via stdin
echo "<prompt>" | gemini --prompt "..." --output-format json --approval-mode auto_edit
```

### Execution Modes

| Mode | Description |
|------|-------------|
| **Host** (default) | Provider runs as a child process with PTY on the host system |
| **Container** | Provider runs inside Docker/Podman with isolated filesystem and network |

In container mode, the orchestrator:
- Mounts the worktree directory into the container
- Applies network policy (`--net=none` for deny, `--net=host` for allow)
- Copies provider config directories into a sandbox home

### Environment Isolation

Regardless of execution mode, provider processes receive a filtered environment:
- Only safe variables pass through (`PATH`, `LANG`, `TZ`, `TERM`, `ORCH_*`)
- A temporary sandbox `HOME` directory is created per task
- Provider config directories (`.codex`, `.claude`, `.gemini`) are copied into the sandbox home

## Install Behavior Modes

The `--install-missing` flag controls what happens when a required provider is not found:

| Mode | Behavior |
|------|----------|
| `prompt` (default) | Ask the user interactively whether to install |
| `auto` | Install automatically without asking |
| `never` | Fail with an error if not installed |

## Upgrade Behavior Modes

The `--upgrade-providers` flag controls what happens when a provider is outdated:

| Mode | Behavior |
|------|----------|
| `warn` (default) | Log a warning and continue |
| `prompt` | Ask the user interactively whether to upgrade |
| `required` | Fail with an error if outdated |
| `never` | Silently continue with the current version |
