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
  const dir = mkdtempSync(join(tmpdir(), "gw-resume-squash-"));
  tempDirs.push(dir);
  return dir;
}

describe("resume reconciliation squash and edge cases", () => {
  it("identifies multiple tasks in a single squash commit", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    // Squash merge commit message with multiple task IDs
    const commitMsg = `Squash merge of feature X

ORCH_RUN_ID=run-squash
ORCH_TASK_ID=task-A
ORCH_TASK_ID=task-B
`;
    writeFileSync(join(repo, "file.txt"), "hello squash\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", commitMsg]);

    const run: RunRecord = {
      runId: "run-squash",
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
        taskId: "task-A",
        provider: "claude",
        type: "code",
        state: "PENDING",
        attempts: 0,
        contractHash: "h"
      },
      {
        runId: run.runId,
        taskId: "task-B",
        provider: "claude",
        type: "code",
        state: "PENDING",
        attempts: 0,
        contractHash: "h"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb,
      events: []
    });

    // Both should be considered merged
    expect(decision.mergedTaskIds).toContain("task-A");
    expect(decision.mergedTaskIds).toContain("task-B");
    expect(decision.requeueTaskIds).toHaveLength(0);
  });

  it("requeues task if commit exists but lacks metadata (manual merge missing metadata)", async () => {
    const repo = makeTempDir();
    initGitRepo(repo);
    writeFileSync(join(repo, "file.txt"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    // Manual merge that forgot the metadata
    writeFileSync(join(repo, "file.txt"), "hello manual\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "Manual merge of task-C without metadata"]);

    const run: RunRecord = {
      runId: "run-manual",
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
        taskId: "task-C",
        provider: "claude",
        type: "code",
        state: "MERGED",
        attempts: 0,
        contractHash: "h"
      }
    ];

    const decision = await reconcileResume({
      run,
      tasksFromDb,
      events: []
    });

    // Since metadata is missing, it should be requeued (assuming missing commit)
    expect(decision.mergedTaskIds).not.toContain("task-C");
    expect(decision.requeueTaskIds).toContain("task-C");
    expect(decision.reasons["task-C"]).toBe("RESUME_MISSING_COMMIT"); // Or whatever the default is when DB says pending but git says nothing
  });
});
