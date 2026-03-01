import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunRecord, TaskRecord } from "../../src/core/types.js";
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
  const dir = mkdtempSync(join(tmpdir(), "gw-resume-"));
  tempDirs.push(dir);
  return dir;
}

describe("resume reconciliation integration", () => {
  it("uses git merged truth ahead of db task state", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);

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

  it("emits RESUME_DB_LAG when git is merged but event log and DB lag", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);

    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    writeFileSync(join(repo, "file.txt"), "hello lag\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "merge task\n\nORCH_RUN_ID=run-lag\nORCH_TASK_ID=task-lag"]);

    const run: RunRecord = {
      runId: "run-lag",
      objective: "lag check",
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
        taskId: "task-lag",
        provider: "claude",
        type: "code",
        state: "RUNNING",
        attempts: 1,
        contractHash: "hash-lag"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb,
      events: []
    });

    expect(decision.mergedTaskIds).toContain("task-lag");
    expect(decision.reasons["task-lag"]).toBe("RESUME_DB_LAG");
  });

  it("does not flag drift when commits after baseline belong to the same run", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);

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
