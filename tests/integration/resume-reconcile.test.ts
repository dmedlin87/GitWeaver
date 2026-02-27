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
  const dir = mkdtempSync(join(tmpdir(), "gw-resume-"));
  tempDirs.push(dir);
  return dir;
}

function runGit(repoPath: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

describe("resume reconciliation integration", () => {
  it("uses git merged truth ahead of db task state", async () => {
    const repo = makeTempDir();
    runGit(repo, ["init"]);
    runGit(repo, ["config", "user.email", "ci@example.com"]);
    runGit(repo, ["config", "user.name", "CI"]);

    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    writeFileSync(join(repo, "file.txt"), "hello world\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "merge task\n\nORCH_RUN_ID=run-1\nORCH_TASK_ID=task-merged"]);

    const run: RunRecord = {
      runId: "run-1",
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
        taskId: "task-merged",
        provider: "claude",
        type: "code",
        state: "PENDING",
        attempts: 0,
        contractHash: "hash-1"
      },
      {
        runId: run.runId,
        taskId: "task-open",
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

    expect(decision.mergedTaskIds).toContain("task-merged");
    expect(decision.requeueTaskIds).toContain("task-open");
    expect(decision.driftDetected).toBe(false);
    expect(decision.driftCommits).toEqual([]);
  });

  it("does not flag drift when commits after baseline belong to the same run", async () => {
    const repo = makeTempDir();
    runGit(repo, ["init"]);
    runGit(repo, ["config", "user.email", "ci@example.com"]);
    runGit(repo, ["config", "user.name", "CI"]);

    writeFileSync(join(repo, "file.txt"), "baseline\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "baseline"]);
    const baseline = runGit(repo, ["rev-parse", "HEAD"]);

    writeFileSync(join(repo, "file.txt"), "orchestrated\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "merge task\n\nORCH_RUN_ID=run-clean\nORCH_TASK_ID=task-1"]);

    const run: RunRecord = {
      runId: "run-clean",
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

    expect(decision.driftDetected).toBe(false);
    expect(decision.driftCommits).toEqual([]);
  });
});
