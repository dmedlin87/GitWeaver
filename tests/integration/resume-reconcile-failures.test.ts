import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EventRecord, RunRecord, TaskRecord } from "../../src/core/types.js";
import { reconcileResume } from "../../src/persistence/resume-reconcile.js";
import { runGit, initGitRepo } from "../helpers/git-fixture.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const next = tempDirs.pop();
    if (next) {
      rmSync(next, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gw-resume-fail-"));
  tempDirs.push(dir);
  return dir;
}

describe("resume reconciliation failure modes", () => {
  it("detects DB says MERGED but Git commit missing (Partial Write / Rollback)", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    const run: RunRecord = {
      runId: "run-fail-1",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // Task claims to be merged, but git doesn't have the commit
    const tasksFromDb: TaskRecord[] = [
      {
        runId: run.runId,
        taskId: "task-ghost",
        provider: "claude",
        type: "code",
        state: "MERGED",
        attempts: 1,
        contractHash: "hash-1"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb,
      events: []
    });

    // Currently it blindly requeues.
    // We want to verify this behavior but also assert that we (eventually) get a reason code.
    expect(decision.requeueTaskIds).toContain("task-ghost");
    expect(decision.mergedTaskIds).not.toContain("task-ghost");

    expect(decision.reasons["task-ghost"]).toBe("RESUME_MISSING_COMMIT");
  });

  it("detects DB says PENDING but Git has commit (DB Lag)", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    // Git has the task
    writeFileSync(join(repo, "file.txt"), "hello world\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "merged task\n\nORCH_RUN_ID=run-fail-2\nORCH_TASK_ID=task-ninja"]);

    const run: RunRecord = {
      runId: "run-fail-2",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    // DB thinks it's still running
    const tasksFromDb: TaskRecord[] = [
      {
        runId: run.runId,
        taskId: "task-ninja",
        provider: "claude",
        type: "code",
        state: "RUNNING",
        attempts: 1,
        contractHash: "hash-2"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb,
      events: []
    });

    expect(decision.mergedTaskIds).toContain("task-ninja");
    expect(decision.requeueTaskIds).not.toContain("task-ninja");

    expect(decision.reasons["task-ninja"]).toBe("RESUME_DB_LAG");
  });

  it("sorts task IDs for determinism", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    // Create multiple commits out of order? git log order is chronological.
    // To test sorting, we need IDs that would be unsorted by default.
    // If git log returns [B, A], we expect [A, B].

    writeFileSync(join(repo, "a.txt"), "A\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "task B\n\nORCH_RUN_ID=run-sort\nORCH_TASK_ID=B"]);

    writeFileSync(join(repo, "b.txt"), "B\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "task A\n\nORCH_RUN_ID=run-sort\nORCH_TASK_ID=A"]);

    const run: RunRecord = {
      runId: "run-sort",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const tasksFromDb: TaskRecord[] = [
      { runId: run.runId, taskId: "Z", provider: "claude", type: "code", state: "PENDING", attempts: 0, contractHash: "h" },
      { runId: run.runId, taskId: "Y", provider: "claude", type: "code", state: "PENDING", attempts: 0, contractHash: "h" }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb,
      events: []
    });

    // Merged: A, B found in git. Should be sorted.
    expect(decision.mergedTaskIds).toEqual(["A", "B"]);

    // Requeue: Z, Y pending in DB. Should be sorted.
    expect(decision.requeueTaskIds).toEqual(["Y", "Z"]);
  });

  it("detects external drift commits since baseline", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);

    writeFileSync(join(repo, "file.txt"), "baseline\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "baseline"]);
    const baseline = runGit(repo, ["rev-parse", "HEAD"]);

    writeFileSync(join(repo, "file.txt"), "from-orchestrator\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "run commit\n\nORCH_RUN_ID=run-drift\nORCH_TASK_ID=task-1"]);

    writeFileSync(join(repo, "file.txt"), "external\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "manual hotfix"]);
    const externalCommit = runGit(repo, ["rev-parse", "HEAD"]);

    const run: RunRecord = {
      runId: "run-drift",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: baseline,
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const decision = await reconcileResume({
      run,
      tasksFromDb: [],
      events: []
    });

    expect(decision.driftDetected).toBe(true);
    expect(decision.driftCommits).toContain(externalCommit);
  });

  it("uses event-log precedence over sqlite when git has no merge proof", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    const run: RunRecord = {
      runId: "run-event-precedence",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const tasksFromDb: TaskRecord[] = [
      {
        runId: run.runId,
        taskId: "task-escalated",
        provider: "claude",
        type: "code",
        state: "RUNNING",
        attempts: 1,
        contractHash: "hash-1"
      }
    ];

    const events: EventRecord[] = [
      {
        seq: 1,
        runId: run.runId,
        ts: new Date().toISOString(),
        type: "TASK_ESCALATED",
        payload: { taskId: "task-escalated", reasonCode: "MERGE_CONFLICT" },
        payloadHash: "hash"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb,
      events
    });

    expect(decision.escalatedTaskIds).toContain("task-escalated");
    expect(decision.requeueTaskIds).not.toContain("task-escalated");
  });

  it("requeues event-only tasks and marks sqlite lag", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    const run: RunRecord = {
      runId: "run-event-only",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const events: EventRecord[] = [
      {
        seq: 1,
        runId: run.runId,
        ts: new Date().toISOString(),
        type: "TASK_COMMIT_PRODUCED",
        payload: { taskId: "task-from-events", commitHash: "abc123" },
        payloadHash: "hash"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb: [],
      events
    });

    expect(decision.requeueTaskIds).toContain("task-from-events");
    expect(decision.reasons["task-from-events"]).toBe("RESUME_DB_LAG");
  });

  it("escalates ambiguous event-vs-git mismatch deterministically", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    const run: RunRecord = {
      runId: "run-ambiguous",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const events: EventRecord[] = [
      {
        seq: 1,
        runId: run.runId,
        ts: new Date().toISOString(),
        type: "TASK_MERGED",
        payload: { taskId: "task-ambiguous", commitHash: "abc123" },
        payloadHash: "hash"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb: [],
      events
    });

    expect(decision.escalatedTaskIds).toContain("task-ambiguous");
    expect(decision.reasons["task-ambiguous"]).toBe("RESUME_AMBIGUOUS_STATE");
  });

  it("keeps git as highest precedence over conflicting event state", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    writeFileSync(join(repo, "file.txt"), "hello world\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "merge task\n\nORCH_RUN_ID=run-git-wins\nORCH_TASK_ID=task-git-wins"]);

    const run: RunRecord = {
      runId: "run-git-wins",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const tasksFromDb: TaskRecord[] = [
      {
        runId: run.runId,
        taskId: "task-git-wins",
        provider: "claude",
        type: "code",
        state: "RUNNING",
        attempts: 1,
        contractHash: "hash-1"
      }
    ];

    const events: EventRecord[] = [
      {
        seq: 1,
        runId: run.runId,
        ts: new Date().toISOString(),
        type: "TASK_ESCALATED",
        payload: { taskId: "task-git-wins", reasonCode: "MERGE_CONFLICT" },
        payloadHash: "hash"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb,
      events
    });

    expect(decision.mergedTaskIds).toContain("task-git-wins");
    expect(decision.escalatedTaskIds).not.toContain("task-git-wins");
    expect(decision.reasons["task-git-wins"]).toBe("RESUME_DB_LAG");
  });

  it("escalates when event log is ESCALATED and no git proof", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);

    const run: RunRecord = {
      runId: "run-esc-event",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const tasksFromDb: TaskRecord[] = [
      { runId: run.runId, taskId: "task-1", provider: "claude", type: "code", state: "PENDING", attempts: 0, contractHash: "h" }
    ];

    const events: EventRecord[] = [
      { seq: 1, runId: run.runId, ts: new Date().toISOString(), type: "TASK_ESCALATED", payload: { taskId: "task-1" }, payloadHash: "hash" }
    ];

    const decision = await reconcileResume({ run, tasksFromDb, events });
    expect(decision.escalatedTaskIds).toContain("task-1");
    expect(decision.reasons["task-1"]).toBe("RESUME_ESCALATED_EVENT_LOG");
  });

  it("escalates when dbTask is ESCALATED and no git proof", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);

    const run: RunRecord = {
      runId: "run-esc-db",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const tasksFromDb: TaskRecord[] = [
      { runId: run.runId, taskId: "task-2", provider: "claude", type: "code", state: "ESCALATED", attempts: 1, contractHash: "h" }
    ];

    const decision = await reconcileResume({ run, tasksFromDb, events: [] });
    expect(decision.escalatedTaskIds).toContain("task-2");
    expect(decision.reasons["task-2"]).toBe("RESUME_ESCALATED_DB");
  });

  it("requeues with crash recovery reason when dbTask or eventState is RUNNING with no git proof", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);

    const run: RunRecord = {
      runId: "run-crash-rec",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const tasksFromDb: TaskRecord[] = [
      { runId: run.runId, taskId: "task-3", provider: "claude", type: "code", state: "RUNNING", attempts: 1, contractHash: "h" }
    ];

    const decision = await reconcileResume({ run, tasksFromDb, events: [] });
    expect(decision.requeueTaskIds).toContain("task-3");
    expect(decision.reasons["task-3"]).toBe("RESUME_CRASH_RECOVERY");
  });

  it("requeues merge-in-flight tasks when MERGE_QUEUED has no git proof", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);

    const run: RunRecord = {
      runId: "run-merge-in-flight",
      objective: "resume check",
      repoPath: repo,
      baselineCommit: "base",
      configHash: "cfg",
      state: "DISPATCHING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const tasksFromDb: TaskRecord[] = [
      { runId: run.runId, taskId: "task-merge", provider: "claude", type: "code", state: "MERGE_QUEUED", attempts: 1, contractHash: "h" }
    ];

    const decision = await reconcileResume({ run, tasksFromDb, events: [] });
    expect(decision.requeueTaskIds).toContain("task-merge");
    expect(decision.reasons["task-merge"]).toBe("RESUME_CRASH_RECOVERY");
  });
});
