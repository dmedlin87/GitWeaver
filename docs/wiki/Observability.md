# Observability

GitWeaver provides structured logging, metrics, event taxonomy, and secret redaction to help you monitor and debug orchestration runs.

## Structured Logging

All log output uses JSON format on stderr:

```json
{"level":"info","message":"Task dispatched","ts":"2026-02-27T10:15:30.123Z","context":{"runId":"0eb29...","taskId":"task-1","provider":"claude"}}
```

### Log Levels

| Level | Usage |
|-------|-------|
| `debug` | Verbose internal details (only shown with debug flag) |
| `info` | Standard operational messages |
| `warn` | Non-fatal issues (degraded provider, retries) |
| `error` | Errors that may affect run outcome |

### Context Fields

Log entries include structured context for filtering:

| Field | Description |
|-------|-------------|
| `runId` | The orchestration run ID |
| `taskId` | The specific task (when applicable) |
| `provider` | The AI provider (when applicable) |
| `attempt` | Attempt number (when applicable) |
| `operation` | The operation being performed |

## Progress Updates

During non-JSON runs, progress updates stream to stderr in a human-readable format:

```
[2026-02-27T10:15:30.123Z] 0eb29... | run_started: Run initialized
[2026-02-27T10:15:31.456Z] 0eb29... | preflight | codex: Provider check passed
[2026-02-27T10:15:45.789Z] 0eb29... | planning: Plan generation in progress
[2026-02-27T10:16:02.321Z] 0eb29... | task-1 | dispatched: Assigned to claude
[2026-02-27T10:16:45.654Z] 0eb29... | task-1 | merged: Commit abc123 integrated
[2026-02-27T10:17:01.987Z] 0eb29... | completed: All tasks verified
```

### Progress Structure

Each update contains:

| Field | Description |
|-------|-------------|
| `runId` | Run identifier |
| `ts` | ISO 8601 timestamp |
| `stage` | Current stage (e.g., `run_started`, `planning`, `dispatched`) |
| `message` | Human-readable description |
| `state` | Current run state (optional) |
| `taskId` | Task ID if task-related (optional) |
| `provider` | Provider if provider-related (optional) |
| `attempt` | Attempt number (optional) |
| `elapsedSec` | Elapsed time in seconds (optional) |

## Metrics

Internal metrics track system health and performance:

### Counter Metrics

| Metric | Description |
|--------|-------------|
| `sqlite.busy_retry` | Number of SQLite busy retries |
| `sqlite.busy_exhausted` | Number of exhausted SQLite busy timeouts |

### Timer Metrics

Stage-level timers measure how long each orchestration phase takes:

| Timer | Description |
|-------|-------------|
| `stage.ingest` | Time to validate and set up the run |
| `stage.baseline` | Time to run baseline gate |
| `stage.planning` | Time to generate the DAG |
| `stage.dispatching` | Total dispatch phase duration |
| `stage.verifying` | Total verification phase duration |

Access metrics programmatically:

```bash
orchestrator inspect <runId> --json
```

## Event Taxonomy

The event log uses a defined taxonomy of event types. See [[Persistence and Resume]] for the full NDJSON format.

### Run Events

| Event Type | Description |
|------------|-------------|
| `RUN_INGEST` | Run initialized |
| `RUN_BASELINE_PASSED` | Baseline gate passed |
| `PLAN_FROZEN` | DAG frozen with hashes |
| `PLAN_ROUTED` | Tasks routed to providers |
| `DISPATCHING` | Dispatch phase started |

### Task Events

| Event Type | Description |
|------------|-------------|
| `TASK_READY` | Task dependencies satisfied |
| `TASK_ATTEMPT` | New execution attempt started |
| `TASK_PROVIDER_START` | Provider began execution |
| `TASK_PROVIDER_HEARTBEAT` | Lease renewal heartbeat |
| `TASK_PROVIDER_FINISH` | Provider completed execution |
| `TASK_COMMIT_PRODUCED` | Provider created a commit |
| `TASK_SCOPE_PASSED` | Scope validation passed |
| `TASK_MERGE_QUEUED` | Task entered merge queue |
| `TASK_MERGED` | Commit merged into main |
| `TASK_VERIFIED` | Post-merge gate passed |
| `TASK_REPAIR_ENQUEUED` | Repair task created |
| `TASK_ESCALATED` | Task failed irrecoverably |

## Secret Redaction

All output is scanned for secret patterns before being written to logs, events, or the terminal.

### Detected Patterns

| Type | Pattern Example |
|------|----------------|
| OpenAI API keys | `sk-abc123def456...` |
| Token assignments | `api_token=xyz789...` |
| AWS Access Keys | `AKIA0123456789ABCDEF` |
| GitHub tokens | `ghp_abc123def456...` |

### Redaction Behavior

- Matches are replaced with `[REDACTED]`
- Applied to: event log payloads, error messages, gate command output, CLI progress
- Enabled by default

### Forensic Raw Logs

For debugging, you can enable unredacted log storage:

```json
{
  "forensicRawLogs": true
}
```

**Warning**: Forensic logs may contain sensitive data. Use only in secure environments for debugging purposes.

## Debugging a Run

### Check Run Status

```bash
orchestrator status <runId> --json
```

### Inspect Events

```bash
# All events for a run
orchestrator inspect <runId> --json

# Events for a specific task
orchestrator inspect <runId> --task task-1 --json
```

### Check Lock State

```bash
orchestrator locks <runId> --json
```

### Read Raw Event Log

The event log is plain NDJSON and can be processed with standard tools:

```bash
# Count events by type
cat .orchestrator/runs/<runId>/events.ndjson | jq -r '.type' | sort | uniq -c | sort -rn

# Find failed tasks
cat .orchestrator/runs/<runId>/events.ndjson | jq 'select(.type == "TASK_ESCALATED")'

# Trace a specific task
cat .orchestrator/runs/<runId>/events.ndjson | jq 'select(.payload.taskId == "task-1")'
```
