# Persistence and Resume

GitWeaver uses a three-layer persistence model to ensure crash-safe orchestration. On resume, state is reconciled using a strict precedence hierarchy.

## Persistence Layers

| Layer | Location | Purpose | Trust Level |
|-------|----------|---------|------------|
| **Git History** | Repository commits | Authoritative record of merged work | Highest |
| **Event Log** | `.orchestrator/runs/<runId>/events.ndjson` | Append-only record of all state transitions | High |
| **SQLite** | `.orchestrator/state.sqlite` | Derived state for fast queries | Medium (can lag) |

### Why Three Layers?

- **Git** is the ground truth &mdash; if a commit exists in history with orchestration footers, the work is done
- **Event logs** capture transitions that may not yet be in git (e.g., a task completed but hasn't merged)
- **SQLite** provides fast random access for the scheduler and UI, but may lag behind the other two on crash

## SQLite Database

Located at `.orchestrator/state.sqlite`, using WAL journal mode by default.

### Tables

| Table | Primary Key | Purpose |
|-------|-------------|---------|
| `runs` | `run_id` | Run metadata and current state |
| `tasks` | `run_id + task_id` | Per-task execution state |
| `task_attempts` | `run_id + task_id + attempt` | Per-attempt metadata |
| `leases` | `run_id + resource_key` | Active write lock leases |
| `lease_counters` | `run_id + resource_key` | Monotonic fencing token counters |
| `provider_health` | `run_id + provider` | Health scores and backoff state |
| `artifacts` | `run_id + artifact_key` | Artifact signatures |
| `prompt_envelopes` | `run_id + task_id + attempt` | Immutable prompt hashes |
| `gate_results` | `run_id + task_id` | Post-merge gate command outputs |
| `repair_events` | `run_id + task_id + failure_class + attempt` | Repair history |
| `resume_checkpoints` | `run_id` | Resume markers |

### Busy Handling

SQLite contention is handled with:
1. Configurable busy timeout (`sqliteBusyTimeoutMs`, default: 5000ms)
2. Bounded retries (`sqliteBusyRetryMax`, default: 2)
3. Telemetry: `sqlite.busy_retry` and `sqlite.busy_exhausted` metrics

If retries are exhausted, the operation fails with `SQLITE_BUSY_EXHAUSTED`.

## Event Log (NDJSON)

Located at `.orchestrator/runs/<runId>/events.ndjson`. Each line is a newline-delimited JSON record:

```json
{
  "seq": 1,
  "runId": "0eb29464-...",
  "ts": "2026-02-27T10:15:30.123Z",
  "type": "TASK_MERGED",
  "payload": { "taskId": "task-1", "commitHash": "abc123..." },
  "payloadHash": "sha256:..."
}
```

### Event Types

| Category | Events |
|----------|--------|
| **Run** | `RUN_INGEST`, `RUN_BASELINE_PASSED`, `PLAN_FROZEN`, `DISPATCHING`, `PLAN_ROUTED` |
| **Task Lifecycle** | `TASK_READY`, `TASK_ATTEMPT`, `TASK_PROVIDER_START`, `TASK_PROVIDER_HEARTBEAT`, `TASK_PROVIDER_FINISH` |
| **Task Outcomes** | `TASK_COMMIT_PRODUCED`, `TASK_SCOPE_PASSED`, `TASK_MERGE_QUEUED`, `TASK_MERGED`, `TASK_VERIFIED` |
| **Failure** | `TASK_REPAIR_ENQUEUED`, `TASK_ESCALATED` |

### Integrity

Each event includes a `payloadHash` (SHA-256 of the payload), providing a tamper-detection mechanism. The `seq` field is monotonically increasing per run.

## Run Manifest

Located at `.orchestrator/runs/<runId>/manifest.json`:

```json
{
  "runId": "0eb29464-...",
  "baselineCommit": "0dab142...",
  "configHash": "dac2e4d...",
  "dagHash": "ff0cad2...",
  "providerVersions": {
    "codex": "0.5.0",
    "claude": "1.0.0",
    "gemini": "0.2.1"
  },
  "createdAt": "2026-02-26T00:56:01.186Z"
}
```

## Commit Footers

Every commit produced by a provider includes metadata footers:

```
ORCH_RUN_ID=0eb29464-9a73-4479-b8c9-d7f583f76329
ORCH_TASK_ID=task-1
ORCH_PROVIDER=claude
ORCH_ATTEMPT=1
ORCH_CONTRACT_HASH=f666f20d...
```

These footers allow the resume algorithm to discover merged tasks directly from git history.

---

## Resume Algorithm

When `orchestrator resume <runId>` is invoked, the system reconstructs the run state from all three persistence layers.

### Step 1: Gather Evidence

Three sources of truth are queried:

1. **Git history**: `git log --grep "ORCH_RUN_ID=<runId>"` &rarr; set of task IDs with confirmed merges
2. **Event log**: Parse `events.ndjson` &rarr; last recorded state per task
3. **SQLite**: Query `tasks` table &rarr; database state per task

### Step 2: Per-Task Decision

For each task, apply the precedence rule **git > event log > SQLite**:

| Condition | Decision | Reason Code |
|-----------|----------|-------------|
| Git has merged commit | **MERGED** (skip) | Authoritative |
| Event log says ESCALATED | **ESCALATED** (skip) | Already gave up |
| Event log says MERGED but git disagrees | **ESCALATE** | `RESUME_AMBIGUOUS_STATE` |
| Database says MERGED but git disagrees | **REQUEUE** | `RESUME_MISSING_COMMIT` |
| Event log has state, database doesn't | **REQUEUE** | `RESUME_DB_LAG` |
| Database has state, event log doesn't | **REQUEUE** | &mdash; |
| No evidence of execution | **IGNORE** | Never ran |

### Step 3: Baseline Drift Detection

Compare the current HEAD against the stored `baselineCommit`:

- **No drift**: Continue normally
- **Drift detected + `--accept-drift`**: Continue, but revalidate all merged tasks
- **Drift detected (default)**: Abort with `RESUME_DRIFT_REQUIRES_ACCEPT`

### Step 4: Emit Resume Plan

The algorithm produces:

| Output | Description |
|--------|-------------|
| `mergedTaskIds` | Tasks confirmed in git history (skip) |
| `requeueTaskIds` | Tasks to re-execute |
| `escalatedTaskIds` | Tasks with unrecoverable issues |
| `driftDetected` | Whether baseline has changed |
| `driftCommits` | New commits between baseline and current HEAD |

### Step 5: Continue Orchestration

Requeued tasks are returned to `PENDING` state and enter the normal dispatch loop.

## Resuming After Common Scenarios

### Crash During Execution

Tasks that were `RUNNING` at crash time will not have commits in git. They are requeued for re-execution.

### Crash During Merge

If a task was mid-merge (`MERGE_QUEUED`):
- If the commit appears in git history: task is `MERGED`
- If the commit does not appear: task is requeued with `RESUME_MERGE_IN_FLIGHT`

### Power Loss

The event log (append-only NDJSON) and SQLite WAL mode both provide crash durability. On resume, the reconciliation algorithm resolves any inconsistencies.

### Baseline Drift

If someone pushes new commits while a run is paused:

```bash
# Check what happened
orchestrator status <runId>

# Resume with drift acceptance
orchestrator resume <runId> --accept-drift
```
