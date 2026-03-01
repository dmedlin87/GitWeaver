# Daily Security and Provider Operations Guard Report - 2025-03-01

## Failure Modes Tested

1. **Partial Event Log Writes:**
   - **Scenario:** The Node.js process crashes in the middle of executing `fs.appendFileSync` while emitting an event to `events.ndjson`. This results in a corrupted, partial JSON string lacking a closing brace.
   - **Test:** Appended `{"seq":2,"runId":"run-1","ts":"2023-01-01T00:00:00.000Z","type":"TASK_RUNNING","payload":{"taskId":"task-` simulating a crash during a write.
   - **Verification:** `EventLog.readAll()` now completely ignores the malformed segment via safe parsing loop containing `try-catch`, keeping preceding valid state intact.

2. **Git Merged State with Lagging Event Log & Database:**
   - **Scenario:** The Git truth indicates a task as merged successfully (has commit with matching ID), but `tasksFromDb` or `events` are lacking corresponding proof and show `RUNNING`.
   - **Test:** Mocked a commit containing `ORCH_RUN_ID=run-lag` and `ORCH_TASK_ID=task-lag`, passed an empty `events` list and `tasksFromDb` in the `RUNNING` state.
   - **Verification:** Orchestrator recovers `mergedSet.has("task-lag")` from Git but instead of silently returning `{ action: "merged" }` like before, securely emits `{ action: "merged", reasonCode: "RESUME_DB_LAG" }` confirming drift safely.

## Determinism Guarantees Confirmed

- **Git Truth Wins Safely:** Git consistently overrides SQL and flat-file logging states when deterministically verifying a `MERGED` action without silently skipping or reverting.
- **Process Safe Recovery from File Corruption:** Using an optimal, zero-allocation memory lazy parsing iteration removes runtime bounds-checking panics preventing catastrophic loss on orchestrator crash restart loops.

## Code and Test Changes

- **Optimized Event Parsing:** Refactored `.split(/\r?\n/)` to a fast lazy substring parser with `start` and `indexOf("\n")` handling. Included a robust `try-catch` scope skipping broken tails on exceptions.
- **Strict DB Lag Reason Emissions:** `resolveResumeEvidence()` `if (mergedSet.has(taskId))` checks `(!isMergedLike(dbTask?.state) || !isMergedLike(eventState?.state))` so if *either* local record lacks merge state, the engine acknowledges the lag with `RESUME_DB_LAG`.
- **Expanded Testing:** Added tests for both partial-writes (`tests/integration/persistence.test.ts`) and db lag regressions (`tests/integration/resume-reconcile.test.ts`).
