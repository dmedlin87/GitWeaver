# Recovery Reconciliation Audit - 2026-03-03

## Failure Modes Tested

1. **Mid-file Event Log Corruption (Partial Writes)**
   - *Scenario*: The `EventLog.readAll()` function encounters a corrupted JSON string in the middle of an NDJSON file (simulating a partial write or disk error).
   - *Outcome*: Verified that the parser safely catches the error and discards the malformed entry, but now correctly continues parsing subsequent valid entries rather than dropping all subsequent entries.

2. **Ambiguous Event Log vs Git History Divergence**
   - *Scenario*: The `EventLog` explicitly claims a task was `MERGED`, but the corresponding commit is missing from the Git branch.
   - *Outcome*: Verified that the reconciliation process does not silently auto-heal or arbitrarily select a source of truth. It explicitly escalates the task with the `RESUME_AMBIGUOUS_STATE` reason code.

3. **Database Ahead of Git Divergence**
   - *Scenario*: The SQLite database indicates a task is `MERGED`, but the git history lacks the commit.
   - *Outcome*: Verified that git truth prevails. The task is safely re-queued with the `RESUME_MISSING_COMMIT` reason code, preventing data loss or falsely successful states.

## Determinism Guarantees

- **Confirmed**: Git history remains the ultimate source of truth. Missing commits trigger safe requeuing or escalation.
- **Confirmed**: The system adheres to the strict rule: *Never silently auto-heal without emitting machine-readable reason codes*.
- **Confirmed (Fixed)**: Event log parsing is now deterministic and robust against mid-file malformation, successfully preventing arbitrary log truncation and the accompanying data loss.

## Code/Test Changes

- **Code (`src/persistence/event-log.ts`)**: Replaced `break;` with `continue;` in the mid-file line parsing `catch` block. This ensures malformed entries are discarded (per memory guidelines) but subsequent valid events are processed correctly.
- **Test (`tests/integration/persistence.test.ts`)**: Added `recovers from mid-file malformed event log entries by discarding them and parsing subsequent entries`.
- **Test (`tests/integration/resume-reconcile.test.ts`)**: Added `escalates RESUME_AMBIGUOUS_STATE when event log shows merged but git is missing commit`.
- **Test (`tests/integration/resume-reconcile.test.ts`)**: Added `requeues with RESUME_MISSING_COMMIT when db shows merged but git is missing commit`.
