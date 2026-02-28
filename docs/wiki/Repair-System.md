# Repair System

When a task fails, GitWeaver classifies the failure and attempts a bounded repair. The system prevents infinite retry loops through per-class budget tracking.

## Failure Classification

Every task failure is analyzed and assigned a failure class:

| Failure Class | Trigger | Repairable? |
|---------------|---------|-------------|
| `VERIFY_FAIL_COMPILE` | TypeScript/build compilation errors | Yes |
| `VERIFY_FAIL_TEST` | Test failures after merge | Yes |
| `SCOPE_FAIL` | File scope policy violation | Yes |
| `MERGE_CONFLICT` | Git merge conflict during integration | Yes |
| `LOCK_TIMEOUT` | Write lease acquisition timed out | Yes |
| `STALE_TASK` | Baseline drift invalidated the task | Yes |
| `NON_REPAIRABLE_EXEC` | Auth failure, unknown command, binary not found | **No** |

### Non-Repairable Detection

Certain error patterns indicate problems that a repair task cannot fix:

| Pattern | Example |
|---------|---------|
| Unknown arguments | `error: unknown option '--bad-flag'` |
| Usage/help text | `Usage: codex exec [options]` |
| Auth required | `Authentication required. Please run: claude auth login` |
| Not logged in | `Error: Not logged in` |
| Command not found | `codex: command not found` |
| ENOENT | `Error: ENOENT: no such file or directory` |
| Approval mode | `approval-mode unavailable` |

When a non-repairable pattern is detected, the task is immediately **escalated** &mdash; no repair attempt is made.

## Repair Budget

Each failure class has an independent attempt counter with a configurable maximum (default: 2).

```
maxRepairAttemptsPerClass: 2
```

### Budget Tracking

| Event | Effect |
|-------|--------|
| Task fails with class `VERIFY_FAIL_COMPILE` | Counter for `VERIFY_FAIL_COMPILE` increments |
| Same task fails again with `VERIFY_FAIL_COMPILE` | Counter reaches 2 &rarr; budget exhausted |
| Same task fails with `VERIFY_FAIL_TEST` | Different class; counter for `VERIFY_FAIL_TEST` starts at 1 |

### Budget Exhaustion

When the budget for any failure class is exhausted:
1. The task is **escalated** (terminal failure)
2. If no other tasks remain, the run transitions to `ABORTED_BUDGET`

## Repair Task Construction

When a repairable failure occurs and budget allows, a repair task is built:

### Input

```
failedTask:    The original task contract
changedFiles:  Files modified in the failed attempt's commit
errorFiles:    Files referenced in error output (extracted by error-extractor)
```

### Repair Task Properties

| Property | Value |
|----------|-------|
| `taskId` | `<original-taskId>-repair-<attempt>` |
| `type` | `"repair"` |
| `provider` | Same as original task |
| `dependencies` | `[originalTaskId]` |
| `writeScope.allow` | Union of `changedFiles` and `errorFiles` (narrowed scope) |
| `writeScope.deny` | Inherited from original |
| `writeScope.ownership` | Inherited from original |
| `commandPolicy` | Inherited from original |
| `outputVerificationRequired` | `true` |

### Why Narrowed Scope?

Repair tasks only need to fix the specific files that caused the failure. By narrowing the write scope:
- The repair provider focuses on the relevant code
- Scope policy prevents the repair from introducing new changes elsewhere
- The blast radius of the fix is minimized

## Repair Flow

```
Task VERIFY_FAILED
     |
     v
Classify failure -----> NON_REPAIRABLE? --yes--> ESCALATED
     |
     no
     |
     v
Check budget ---------> EXHAUSTED? ------yes--> ESCALATED --> ABORTED_BUDGET
     |
     no
     |
     v
Extract error files
     |
     v
Build repair task (narrowed scope)
     |
     v
Enqueue as PENDING
     |
     v
Normal dispatch loop (READY -> LEASE -> RUNNING -> ...)
     |
     v
Repair succeeds? --yes--> SCOPE_PASSED -> MERGED -> VERIFIED
     |
     no
     |
     v
Re-classify, check budget, repeat or escalate
```

## Error File Extraction

The error extractor parses failure output to identify relevant files:

- TypeScript errors: `src/foo.ts(10,5): error TS2339: ...` &rarr; `src/foo.ts`
- Test failures: `FAIL src/foo.test.ts` &rarr; `src/foo.test.ts`
- Build errors: Various patterns depending on build tool

Extracted files are included in the repair task's write scope alongside the originally changed files.

## Configuring Repair Behavior

### Increase Repair Budget

Allow more repair attempts per failure class:

```json
{
  "maxRepairAttemptsPerClass": 3
}
```

### Disable Repairs

Set budget to 0 to escalate all failures immediately:

```json
{
  "maxRepairAttemptsPerClass": 0
}
```

### Monitor Repair History

Use the `inspect` command to see repair events:

```bash
orchestrator inspect <runId> --task <taskId> --json
```

The output includes repair event history with failure classifications, attempt counts, and error details.
