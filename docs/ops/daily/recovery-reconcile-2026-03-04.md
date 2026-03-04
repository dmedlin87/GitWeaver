# Daily Recovery Reconciliation Audit - 2026-03-04

## Failure Modes Tested
1. **Merge In Flight (Missing Commit):** Tested scenario where a task reaches the `MERGE_QUEUED` state in the database or event log, but the orchestrator crashes before the git commit is successfully produced. Verified that the reconciliation logic explicitly emits `RESUME_MERGE_IN_FLIGHT` rather than falling back to the generic `RESUME_CRASH_RECOVERY`.
2. **Reordered Events in Event Log:** Tested scenario where events for a task are written out-of-order physically within the `events.ndjson` file. Verified that the system correctly parses events according to their monotonically increasing `.seq` property to reconstruct the correct `MERGE_QUEUED` state rather than relying purely on append order.
3. **Partial Writes (Malformed JSON):** Confirmed existing test coverage for incomplete/malformed JSON writes where `readAll` correctly skips the malformed entries using a `try-catch` with `continue`, allowing subsequent valid entries to still be parsed.

## Determinism Guarantees
- **Confirmed:** Reconciliation logic deterministically evaluates git state, database state, and event log state to detect specific crash types (like `RESUME_MERGE_IN_FLIGHT`).
- **Confirmed:** `EventLog.readAll()` maintains (N)$ safe parsing against partial or malformed writes, gracefully skipping the malformed entry without terminating the `while` loop early via `break`.
- **Confirmed:** Missing commits from tasks that reached `MERGE_QUEUED` are now distinctively categorized, adhering to the requirement never to silently auto-heal or arbitrarily pick states.

## Code and Test Changes
- **src/persistence/resume-reconcile.ts:** Added explicit handling for `MERGE_QUEUED` state to return `RESUME_MERGE_IN_FLIGHT` instead of dropping through to `RESUME_CRASH_RECOVERY`.
- **tests/integration/resume-reconcile.test.ts:** Added test cases for missing commit with `MERGE_QUEUED` state and out-of-order event serialization logic.
