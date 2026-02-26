import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { RunRecord, TaskRecord } from "../../src/core/types.js";
import { reconcileResume } from "../../src/persistence/resume-reconcile.js";

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

function runGit(repoPath: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
}

describe("resume reconciliation failure modes", () => {
  it("detects DB says MERGED but Git commit missing (Partial Write / Rollback)", async () => {
    const repo = makeTempDir();
    runGit(repo, ["init"]);
    runGit(repo, ["config", "user.email", "ci@example.com"]);
    runGit(repo, ["config", "user.name", "CI"]);
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
    runGit(repo, ["init"]);
    runGit(repo, ["config", "user.email", "ci@example.com"]);
    runGit(repo, ["config", "user.name", "CI"]);
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
    runGit(repo, ["init"]);
    runGit(repo, ["config", "user.email", "ci@example.com"]);
    runGit(repo, ["config", "user.name", "CI"]);
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
});
