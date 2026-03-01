# Reason Codes

Every failure, abort, and exceptional condition in GitWeaver is tagged with a reason code. These codes appear in run/task state, event logs, and CLI output.

## Abort Codes

These codes cause the run to terminate.

| Code | Description |
|------|-------------|
| `ABORTED_BASELINE` | Baseline gate failed or repository validation failed |
| `ABORTED_BUDGET` | Repair budget exhausted for one or more failure classes |
| `ABORTED_MANUAL` | Run was manually aborted by the user |
| `ABORTED_POLICY` | A policy violation occurred (scope, command, or security) |

## Baseline Codes

Issues detected during repository validation and baseline gate.

| Code | Description |
|------|-------------|
| `BASELINE_DIRTY_REPO` | Git working tree has uncommitted changes |
| `BASELINE_GATE_FAILED` | The baseline gate command exited with a non-zero code |
| `REPO_NOT_GIT` | The target directory is not a git repository |

## Provider Codes

Issues with AI provider availability and health.

| Code | Description |
|------|-------------|
| `AUTH_MISSING` | Provider authentication is not configured |
| `INSTALL_FAILED` | Automatic provider installation failed |
| `PROVIDER_MISSING` | Provider CLI binary not found on PATH |
| `PROVIDER_OUTDATED` | Provider version is behind the latest available |
| `PROVIDER_COOLDOWN_ACTIVE` | Provider is in backoff cooldown after failures |

## Planning Codes

Issues during DAG generation and validation.

| Code | Description |
|------|-------------|
| `PLAN_SCHEMA_INVALID` | The planner returned a DAG that failed Zod schema validation |
| `PLAN_PROVIDER_FAILED` | The planner provider (Codex) failed to generate a plan |
| `CONTEXT_BUDGET_EXCEEDED` | The context pack exceeded the byte budget for the prompt envelope |

## Execution Codes

Issues during provider task execution.

| Code | Description |
|------|-------------|
| `EXEC_FAILED` | Provider execution failed (non-zero exit, timeout, crash) |
| `NO_COMMIT_PRODUCED` | Provider completed but did not produce a git commit |
| `PROMPT_DRIFT` | The prompt envelope hash changed between plan and execution |

## Verification Codes

Issues during scope validation and post-merge gates.

| Code | Description |
|------|-------------|
| `SCOPE_DENY` | A changed file matched a deny pattern in the write scope |
| `VERIFY_FAIL_COMPILE` | Post-merge compilation/type-checking failed |
| `VERIFY_FAIL_TEST` | Post-merge test suite failed |
| `VERIFY_FAIL_OUTPUT` | Output contract verification failed (missing exports/tests) |
| `MERGE_GATE_FAILED` | Post-merge gate command exited with non-zero code |
| `STALE_TASK` | Task invalidated by baseline drift after merge |

## Concurrency Codes

Issues with lock leasing and scheduling.

| Code | Description |
|------|-------------|
| `LOCK_TIMEOUT` | Write lease acquisition timed out (resource held by another task) |
| `MERGE_CONFLICT` | Git merge conflict during cherry-pick integration |

## Persistence Codes

Issues with SQLite and data persistence.

| Code | Description |
|------|-------------|
| `SQLITE_BUSY_EXHAUSTED` | SQLite busy timeout and retries exhausted |

## Resume Codes

Issues detected during run resume and state reconciliation.

| Code | Description |
|------|-------------|
| `RESUME_AMBIGUOUS_STATE` | Conflicting evidence between persistence layers |
| `RESUME_CRASH_RECOVERY` | Task was running when the system crashed and has been requeued |
| `RESUME_DB_LAG` | SQLite state lagged behind the event log |
| `RESUME_DRIFT_REQUIRES_ACCEPT` | Baseline has drifted; `--accept-drift` required to continue |
| `RESUME_ESCALATED_DB` | Task was already escalated in the database |
| `RESUME_ESCALATED_EVENT_LOG` | Task was already escalated in the event log |
| `RESUME_MERGE_IN_FLIGHT` | A merge was in progress when the run crashed |
| `RESUME_MISSING_COMMIT` | Database records a merge but the commit is not in git history |

## Repair Codes

Issues related to failure repair.

| Code | Description |
|------|-------------|
| `STALE_REPLAN_TRIGGERED` | Staleness detection triggered a re-plan cycle |

## Using Reason Codes

### In CLI Output

Reason codes appear in status and inspect output:

```bash
orchestrator status <runId> --json
```

```json
{
  "state": "ABORTED_BUDGET",
  "reasonCode": "ABORTED_BUDGET"
}
```

### In Event Log

Events include reason codes in their payload:

```json
{
  "type": "TASK_ESCALATED",
  "payload": {
    "taskId": "task-1",
    "reasonCode": "VERIFY_FAIL_COMPILE",
    "details": "Budget exhausted for VERIFY_FAIL_COMPILE (2/2 attempts)"
  }
}
```

### Filtering by Reason Code

```bash
# Find all events with a specific reason code
cat .orchestrator/runs/<runId>/events.ndjson | jq 'select(.payload.reasonCode == "MERGE_CONFLICT")'
```
