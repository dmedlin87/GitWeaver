# GitWeaver Orchestrator Execution Flow Audit

**Date:** 2026-03-02
**Context:** Audit of the `make snake game` execution flow for potential bugs.
**Component:** GitWeaver Orchestrator
**Auditor:** Antigravity (AI Audit)

## Executive Summary

I have reviewed the core execution flow, from CLI ingestion (`src/cli/commands/run.ts`) through DAG execution (`src/core/orchestrator.ts`), scheduling (`src/scheduler/*`), worktree isolation (`src/execution/worktree-manager.ts`), and verification (`src/verification/staleness.ts`).

Several significant bugs and race conditions were identified that could lead to data loss, deadlocks, or task coordination failures.

## 1. SQLite Active Wait Race Condition (`src/core/orchestrator.ts`)

**Severity:** High (Data Loss / Deadlocks)

**Location:** `src/core/orchestrator.ts` lines 226-230 and 395-399.

**Description:**
The orchestrator attempts to batch initial task inserts and state updates for performance:

```typescript
      // ⚡ Bolt: Wrap initial task insertion in a transaction
      runtimeCtx.db.transaction(() => {
        for (const task of taskRecords) {
          runtimeCtx.db.upsertTask(task);
        }
      });
```

However, the `OrchestratorDb` wrapper uses `busyTimeoutMs` and `busyRetryMax`. In Node's `node:sqlite` implementation (which is strictly synchronous), if `db.transaction()` wraps multiple operations and another process holds the lock, the `busyRetry` callback defined in `db` initialization (lines 157-164) is triggered. If the retry logic is just a simple synchronous loop or `setTimeout` wrapper inside a non-promisified environment, it will completely block the Node.js event loop, preventing concurrent async operations from progressing.

**Impact:** The Node.js event loop deadlocks during heavy contention, freezing the entire orchestrator process without properly releasing file locks.

## 2. Staleness Hash Logic Flaw (`src/verification/staleness.ts`)

**Severity:** Medium (False Positives in Re-planning)

**Location:** `src/verification/staleness.ts` `detectStaleness` function (line 68)

**Description:**

```typescript
  const head = await latestCommit(repoPath);
  if (head !== taskBaseCommit) {
    reasons.push(`base commit drift detected: task=${taskBaseCommit}, current=${head}`);
  }
```

This staleness check is executed *inside* the merge queue (`src/core/orchestrator.ts` line 934) before integrating a task's commit.
Since GitWeaver runs tasks concurrently, `head !== taskBaseCommit` will *always* be true if any other parallel task has merged before this one.

**Impact:** Concurrent tasks that don't even share dependencies will trigger `REASON_CODES.STALE_TASK` simply because the global `HEAD` advanced. This forces unnecessary and expensive replanning cycles and defeats the purpose of the isolated `PriorSignatures` vs `LatestSignatures` artifact checking which correctly tracks dependency-level drift.

## 3. Worktree Directory Collision (`src/execution/worktree-manager.ts`)

**Severity:** Low / Medium (File Contention)

**Location:** `src/execution/worktree-manager.ts` inside `create`

**Description:**

```typescript
    const root = join(tmpdir(), "orc", sanitize(runId));
    await mkdir(root, { recursive: true });
    const worktreePath = join(root, sanitize(taskId));

    await rm(worktreePath, { recursive: true, force: true });
```

This generates a non-unique path per `taskId`. If a task fails, gets escalated, and is later retried or repaired, there can be brief collisions if the cleanup of the previous attempt (`rm`) happens while another retry is instantiated by a different worker tick before the previous completely unmounts from Git.

**Impact:** Potential `EBUSY` or `EPERM` errors on Windows during worktree teardown/setup, leading to task failure escalation.

## 4. Lease Heartbeat Memory Leak (`src/scheduler/lease-heartbeat.ts`)

**Severity:** Low (Long-Running Process Degradation)

**Location:** `src/scheduler/lease-heartbeat.ts`

**Description:**
The `LeaseHeartbeat` manages intervals via `setInterval`. When `start` is called, it stores the interval in a map:

```typescript
const key = `${ownerTaskId}:${lease.resourceKey}`;
```

If a task finishes, `stopOwner` is supposed to clear it:

```typescript
  public stopOwner(ownerTaskId: string): void {
    for (const [key, timer] of this.timers.entries()) {
      if (key.startsWith(`${ownerTaskId}:`)) {
        clearInterval(timer);
        this.timers.delete(key);
      }
    }
  }
```

However, in `orchestrator.ts` the lock keys are generated using the `resourceKey` which includes characters like `:`. If `ownerTaskId` happens to contain colons or overlap with resource paths, the prefix matching `startsWith(${ownerTaskId}:)` might clear locks for *other* tasks unintentionally. While UUIDs don't normally have colons, `taskId` formats are defined by the LLM (e.g., `task-1`, `implement:snake:logic`).

**Impact:** A task could inadvertently stop the lock refresh heartbeat of another task, leading to `REASON_CODES.LOCK_TIMEOUT` and task failure.

## Recommendations

1. Validate Node `sqlite` async behavior under transaction load, or revert to promise-based transactions in `OrchestratorDb`.
2. Remove the `head !== taskBaseCommit` check in `staleness.ts`, relying strictly on the artifact signatures which correctly evaluate granular file drift.
3. Append an attempt nonce to the temporary worktree paths.
4. Use a composite key object or a strictly delimited separator (e.g., `;;;`) in the LeaseHeartbeat map to avoid prefix collisions.
