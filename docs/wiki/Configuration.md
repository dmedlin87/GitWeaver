# Configuration

GitWeaver uses a layered configuration system. Defaults are built in, and you can override them with a JSON config file and/or CLI flags.

## Loading Order

1. **Built-in defaults** &mdash; `DEFAULT_CONFIG` in `src/core/config.ts`
2. **Config file** &mdash; If `--config <path>` is provided, the JSON file is deep-merged with defaults
3. **CLI flags** &mdash; `--execution-mode`, `--container-runtime`, `--container-image`, `--concurrency` override the merged config

## Config File Format

Create a JSON file and pass it via `--config`:

```bash
orchestrator run "your prompt" --config ./orchestrator.config.json
```

### Full Example

```json
{
  "baselineGateCommand": "pnpm -s tsc -p .",
  "concurrencyCap": 4,
  "providerBuckets": {
    "codex": 1,
    "claude": 2,
    "gemini": 2
  },
  "sqliteJournalMode": "WAL",
  "sqliteSynchronous": "NORMAL",
  "sqliteBusyTimeoutMs": 5000,
  "sqliteBusyRetryMax": 2,
  "executionMode": "host",
  "containerRuntime": "docker",
  "containerImage": "ghcr.io/dmedlin87/gitweaver-runtime:latest",
  "providerBackoffBaseSec": 5,
  "providerBackoffMaxSec": 60,
  "providerHealthRecoverPerSuccess": 10,
  "leaseDurationSec": 120,
  "leaseRenewSec": 30,
  "heartbeatTimeoutSec": 60,
  "terminateGraceSec": 10,
  "maxRepairAttemptsPerClass": 2,
  "defaultCommandDeny": [
    "npm install", "pnpm install", "yarn install",
    "git push", "curl", "wget", "rm -rf"
  ],
  "defaultNetworkPolicy": "deny",
  "smokeGateByType": {
    "code": "pnpm -s test --runInBand",
    "refactor": "pnpm -s test --runInBand"
  },
  "sharedAppendExtensions": [".json", ".yaml", ".yml"],
  "forensicRawLogs": false
}
```

## Option Reference

### General

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `baselineGateCommand` | string | `"pnpm -s tsc -p ."` | Command run before orchestration starts. If it fails, the run aborts unless `--allow-baseline-repair` is set. |
| `concurrencyCap` | number | `4` | Maximum concurrent task executions across all providers. |

### Provider Buckets

Controls how many tasks each provider can execute simultaneously.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `providerBuckets.codex` | number | `1` | Token bucket capacity for Codex |
| `providerBuckets.claude` | number | `2` | Token bucket capacity for Claude |
| `providerBuckets.gemini` | number | `2` | Token bucket capacity for Gemini |

The sum of all provider buckets should not exceed `concurrencyCap`.

### Provider Health

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `providerBackoffBaseSec` | number | `5` | Initial backoff (seconds) on provider failure |
| `providerBackoffMaxSec` | number | `60` | Maximum backoff (seconds) on repeated failures |
| `providerHealthRecoverPerSuccess` | number | `10` | Health score increase per successful execution |

### SQLite

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sqliteJournalMode` | `"WAL"` \| `"DELETE"` | `"WAL"` | Journal mode. WAL enables concurrent reads during writes. |
| `sqliteSynchronous` | `"NORMAL"` \| `"FULL"` | `"NORMAL"` | Sync level. NORMAL is faster; FULL is safer against power loss. |
| `sqliteBusyTimeoutMs` | number | `5000` | Milliseconds to wait before failing on a locked database |
| `sqliteBusyRetryMax` | number | `2` | Maximum retry attempts for busy errors |

### Execution Mode

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `executionMode` | `"host"` \| `"container"` | `"host"` | Where providers run. Host = child process. Container = Docker/Podman. |
| `containerRuntime` | `"docker"` \| `"podman"` | `"docker"` | Container runtime (only used when `executionMode` is `"container"`) |
| `containerImage` | string | `"ghcr.io/dmedlin87/gitweaver-runtime:latest"` | Image to use for container execution |

### Scheduling & Leases

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `leaseDurationSec` | number | `120` | Duration (seconds) for write lock leases |
| `leaseRenewSec` | number | `30` | Interval (seconds) for lease renewal heartbeats |
| `heartbeatTimeoutSec` | number | `60` | Timeout (seconds) for provider execution heartbeat |
| `terminateGraceSec` | number | `10` | Grace period (seconds) before SIGKILL on termination |

### Repair

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRepairAttemptsPerClass` | number | `2` | Maximum repair attempts per failure classification before aborting |

### Security Policies

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `defaultCommandDeny` | string[] | See below | Default denied command patterns for all tasks |
| `defaultNetworkPolicy` | `"deny"` \| `"allow"` | `"deny"` | Default network access policy for task execution |

Default deny list:
```json
["npm install", "pnpm install", "yarn install", "git push", "curl", "wget", "rm -rf"]
```

### Verification Gates

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `smokeGateByType` | object | `{"code": "pnpm -s test --runInBand", "refactor": "pnpm -s test --runInBand"}` | Post-merge gate commands per task type |
| `sharedAppendExtensions` | string[] | `[".json", ".yaml", ".yml"]` | File extensions permitted in `shared-append` ownership mode |

### Logging

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `forensicRawLogs` | boolean | `false` | Store unredacted logs. When `false`, secrets are redacted from all output. |

## Environment Variables

### Allowed in Sandbox

These variables pass through to provider execution environments:

| Variable | Purpose |
|----------|---------|
| `PATH` | System path |
| `LANG`, `LC_ALL`, `LC_CTYPE` | Locale settings |
| `TZ` | Timezone |
| `TERM`, `COLORTERM` | Terminal type |
| `ORCH_*` | Any variable prefixed with `ORCH_` |

### Blocked in Sandbox

All other environment variables are filtered out for security. This includes `HOME`, `USERPROFILE`, `AWS_*`, `GCP_*`, API keys, and credentials. The sandbox receives a clean temporary `HOME` directory.

## Minimal Config Examples

### High-Concurrency Setup

```json
{
  "concurrencyCap": 8,
  "providerBuckets": {
    "codex": 2,
    "claude": 3,
    "gemini": 3
  }
}
```

### Container-Mode Setup

```json
{
  "executionMode": "container",
  "containerRuntime": "docker",
  "containerImage": "my-registry.io/gitweaver-runtime:latest"
}
```

### Conservative Repair Budget

```json
{
  "maxRepairAttemptsPerClass": 1
}
```

### Custom Baseline Gate

```json
{
  "baselineGateCommand": "npm run typecheck && npm run build && npm test"
}
```
