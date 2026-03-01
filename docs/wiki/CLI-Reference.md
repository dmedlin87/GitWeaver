# CLI Reference

The GitWeaver CLI is invoked as `orchestrator` (after build) or `pnpm dev` (development mode).

```
orchestrator <command> [options]
```

---

## `run`

Start a new orchestration run.

```bash
orchestrator run "<prompt>" [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<prompt>` | Yes | The objective prompt describing what changes to make |

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--concurrency <n>` | integer | 4 | Maximum concurrent tasks |
| `--dry-run` | boolean | false | Plan and audit without execution |
| `--dry-run-report <mode>` | `basic` \| `detailed` | `detailed` | Dry-run output verbosity |
| `--config <path>` | string | none | Path to JSON config file |
| `--repo <path>` | string | cwd | Repository root override |
| `--bootstrap` | boolean | false | Create/init repository before running (requires `--repo`) |
| `--bootstrap-template <template>` | `blank` \| `web-game-ts` | `blank` | Bootstrap scaffold template |
| `--allow-baseline-repair` | boolean | false | Continue when baseline gate fails |
| `--accept-drift` | boolean | false | Accept baseline drift on resume/integration |
| `--execution-mode <mode>` | `host` \| `container` | `host` | Provider execution environment |
| `--container-runtime <rt>` | `docker` \| `podman` | `docker` | Container runtime |
| `--container-image <img>` | string | `ghcr.io/dmedlin87/gitweaver-runtime:latest` | Container image |
| `--install-missing <mode>` | `prompt` \| `never` \| `auto` | `prompt` | Auto-install missing providers |
| `--upgrade-providers <mode>` | `warn` \| `never` \| `prompt` \| `required` | `warn` | Provider upgrade behavior |
| `--non-interactive` | boolean | false | Disable interactive prompts |
| `--json` | boolean | false | Output result as JSON |

### Examples

```bash
# Basic run
orchestrator run "Add TypeScript strict mode to all files"

# With concurrency and config
orchestrator run "Refactor payment module" --concurrency 6 --config ./config.json

# Dry run with detailed report
orchestrator run "Migrate to ESM" --dry-run --dry-run-report detailed

# Bootstrap a new repository and run immediately
orchestrator run "Build a snake game in TypeScript with tests" --repo C:\Users\you\Projects\snake-game --bootstrap --bootstrap-template web-game-ts

# Container execution
orchestrator run "Security audit" --execution-mode container --container-runtime docker

# Non-interactive CI mode
orchestrator run "Fix lint errors" --non-interactive --json
```

---

## `resume`

Resume an existing run from its last known state.

```bash
orchestrator resume <runId> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<runId>` | Yes | UUID of the run to resume |

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--accept-drift` | boolean | false | Accept baseline drift and continue |
| `--json` | boolean | false | Output result as JSON |

### Examples

```bash
# Resume a crashed run
orchestrator resume 0eb29464-9a73-4479-b8c9-d7f583f76329

# Resume with drift acceptance
orchestrator resume 0eb29464-9a73-4479-b8c9-d7f583f76329 --accept-drift
```

---

## `status`

Check the current status of a run.

```bash
orchestrator status <runId> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<runId>` | Yes | UUID of the run |

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | false | Output as JSON |

### Example

```bash
orchestrator status 0eb29464-9a73-4479-b8c9-d7f583f76329 --json
```

---

## `inspect`

Inspect detailed run information including events and per-task state.

```bash
orchestrator inspect <runId> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<runId>` | Yes | UUID of the run |

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--task <taskId>` | string | none | Filter events by specific task ID |
| `--json` | boolean | false | Output as JSON |

### Examples

```bash
# Inspect full run
orchestrator inspect 0eb29464-9a73-4479-b8c9-d7f583f76329

# Inspect specific task
orchestrator inspect 0eb29464-9a73-4479-b8c9-d7f583f76329 --task task-1 --json
```

---

## `locks`

Inspect held and pending lock leases for a run.

```bash
orchestrator locks <runId> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `<runId>` | Yes | UUID of the run |

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | false | Output as JSON |

---

## `providers check`

Check provider installation status and authentication.

```bash
orchestrator providers check [options]
```

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--json` | boolean | false | Output as JSON |

### Output Fields

| Field | Description |
|-------|-------------|
| `installed` | Whether the CLI binary is found |
| `versionInstalled` | Currently installed version |
| `versionLatest` | Latest available version on npm |
| `authStatus` | `OK`, `MISSING`, or `UNKNOWN` |
| `healthStatus` | `HEALTHY`, `DEGRADED`, or `UNAVAILABLE` |
| `issues` | Array of diagnostic messages |

---

## `providers install`

Install missing or outdated providers.

```bash
orchestrator providers install [options]
```

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--providers <csv>` | string | all | Comma-separated list (e.g., `codex,claude,gemini`) |
| `--yes` | boolean | false | Auto-approve installation |
| `--json` | boolean | false | Output as JSON |

### Example

```bash
orchestrator providers install --providers claude,gemini --yes
```

---

## `providers auth`

Check authentication status and optionally run remediation.

```bash
orchestrator providers auth [options]
```

### Options

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--provider <name>` | `codex` \| `claude` \| `gemini` | all | Specific provider to check |
| `--fix` | boolean | false | Automatically run auth remediation command |
| `--json` | boolean | false | Output as JSON |

### Remediation Commands

| Provider | Fix Command |
|----------|-------------|
| Codex | `codex login` |
| Claude | `claude auth login` |
| Gemini | `gemini` (interactive) |

### Example

```bash
orchestrator providers auth --provider claude --fix
```
