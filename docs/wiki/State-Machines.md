# State Machines

GitWeaver uses two state machines: one for the overall **run** and one for each **task** within a run. Both enforce strict transition rules &mdash; invalid transitions throw errors.

## Run State Machine

```
                          +---> ABORTED_POLICY
                          |
 INGEST ------> BASELINE_OK ------> PLAN_FROZEN ------> DISPATCHING
   |                |                    |                    |
   +-> ABORTED_*    +-> ABORTED_*        +-> COMPLETED        |
                                         +-> ABORTED_POLICY   |
                                                              |
                   +------------------------------------------+
                   |
                   v
             INTEGRATING -----> VERIFYING -----> COMPLETED
                   |                |
                   +-> REPAIRING    +-> REPLANNING
                   |       |               |
                   |       +-> INTEGRATING  +-> PLAN_FROZEN
                   |
                   +-> COMPLETED
                   +-> ABORTED_*
```

### Run States

| State | Description |
|-------|-------------|
| `INGEST` | Initial state. Repository validation and setup. |
| `BASELINE_OK` | Baseline gate passed. Ready for planning. |
| `PLAN_FROZEN` | DAG generated, audited, and hashed. |
| `DISPATCHING` | Tasks being assigned to providers. |
| `INTEGRATING` | Task commits being merged into main. |
| `VERIFYING` | Post-merge gates running. |
| `REPLANNING` | Staleness triggered a re-plan cycle. |
| `REPAIRING` | Repair task in progress for a failed task. |
| `COMPLETED` | All tasks verified and merged. Terminal state. |
| `ABORTED_POLICY` | Terminated due to policy violation. Terminal state. |
| `ABORTED_BASELINE` | Terminated due to baseline gate failure. Terminal state. |
| `ABORTED_BUDGET` | Terminated because repair budget was exhausted. Terminal state. |
| `ABORTED_MANUAL` | Terminated by user. Terminal state. |

### Valid Run Transitions

| From | To |
|------|----|
| `INGEST` | `BASELINE_OK`, `ABORTED_POLICY`, `ABORTED_BASELINE` |
| `BASELINE_OK` | `PLAN_FROZEN`, `ABORTED_POLICY`, `ABORTED_BASELINE` |
| `PLAN_FROZEN` | `DISPATCHING`, `COMPLETED`, `ABORTED_POLICY` |
| `DISPATCHING` | `INTEGRATING`, `ABORTED_BUDGET`, `ABORTED_POLICY`, `ABORTED_MANUAL`, `COMPLETED` |
| `INTEGRATING` | `VERIFYING`, `REPAIRING`, `ABORTED_BUDGET`, `ABORTED_POLICY`, `COMPLETED` |
| `VERIFYING` | `INTEGRATING`, `REPAIRING`, `REPLANNING`, `COMPLETED`, `ABORTED_BUDGET` |
| `REPLANNING` | `PLAN_FROZEN`, `ABORTED_POLICY`, `ABORTED_BUDGET` |
| `REPAIRING` | `INTEGRATING`, `ABORTED_BUDGET`, `ABORTED_POLICY`, `ABORTED_MANUAL` |

---

## Task State Machine

```
 PENDING --> READY --> LEASE_ACQUIRED --> RUNNING --> COMMIT_PRODUCED
                                            |              |
                                            +-> EXEC_FAILED |
                                            +-> STALE       |
                                                            v
                                                     SCOPE_PASSED --> MERGE_QUEUED --> MERGED --> VERIFIED
                                                            |              |              |
                                                     SCOPE_FAILED    VERIFY_FAILED   VERIFY_FAILED
                                                                                      STALE

 (Any failed/stale state) --> READY (retry) or ESCALATED (give up)
```

### Task States

| State | Description |
|-------|-------------|
| `PENDING` | Task created but not yet ready for dispatch. |
| `READY` | Dependencies satisfied. Awaiting dispatch. |
| `LEASE_ACQUIRED` | Write locks obtained for task's resource scope. |
| `RUNNING` | Provider is actively executing. |
| `COMMIT_PRODUCED` | Provider created a commit with changes. |
| `SCOPE_PASSED` | Changed files passed scope policy validation. |
| `MERGE_QUEUED` | Waiting in the merge queue. |
| `MERGED` | Commit cherry-picked into main branch. |
| `VERIFIED` | Post-merge gates passed. Terminal success state. |
| `EXEC_FAILED` | Provider execution failed. |
| `SCOPE_FAILED` | File scope policy violation. |
| `VERIFY_FAILED` | Post-merge gate failed. |
| `STALE` | Invalidated by baseline drift. |
| `ESCALATED` | Unrecoverable failure. Terminal failure state. |

### Valid Task Transitions

| From | To |
|------|----|
| `PENDING` | `READY`, `ESCALATED` |
| `READY` | `LEASE_ACQUIRED`, `ESCALATED` |
| `LEASE_ACQUIRED` | `RUNNING`, `STALE`, `ESCALATED` |
| `RUNNING` | `COMMIT_PRODUCED`, `EXEC_FAILED`, `STALE`, `ESCALATED` |
| `COMMIT_PRODUCED` | `SCOPE_PASSED`, `SCOPE_FAILED`, `STALE` |
| `SCOPE_PASSED` | `MERGE_QUEUED`, `VERIFY_FAILED` |
| `MERGE_QUEUED` | `MERGED`, `VERIFY_FAILED`, `ESCALATED` |
| `MERGED` | `VERIFIED`, `VERIFY_FAILED`, `STALE` |
| `EXEC_FAILED` | `READY` (retry), `ESCALATED` |
| `SCOPE_FAILED` | `READY` (retry), `ESCALATED` |
| `VERIFY_FAILED` | `READY` (retry), `ESCALATED` |
| `STALE` | `READY` (retry), `ESCALATED` |

### Terminal States

- **`VERIFIED`** &mdash; Task completed successfully
- **`ESCALATED`** &mdash; Task failed irrecoverably (budget exhausted, non-repairable error, or ambiguous state)
