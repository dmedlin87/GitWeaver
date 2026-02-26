import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCommand } from "../core/shell.js";

export interface WorktreeHandle {
  path: string;
  branch: string;
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export class WorktreeManager {
  public async create(repoPath: string, runId: string, taskId: string, baseCommit: string): Promise<WorktreeHandle> {
    const branch = `orch/${sanitize(runId)}/${sanitize(taskId)}`;
    const root = join(tmpdir(), "orc", sanitize(runId));
    await mkdir(root, { recursive: true });
    const worktreePath = join(root, sanitize(taskId));

    await rm(worktreePath, { recursive: true, force: true });

    await runCommand("git", ["-C", repoPath, "worktree", "add", "-B", branch, worktreePath, baseCommit], {
      timeoutMs: 60_000
    });

    return {
      path: worktreePath,
      branch
    };
  }

  public async prune(repoPath: string): Promise<void> {
    await runCommand("git", ["-C", repoPath, "worktree", "prune"], { timeoutMs: 30_000 });
  }

  public async remove(repoPath: string, worktreePath: string): Promise<void> {
    await runCommand("git", ["-C", repoPath, "worktree", "remove", "--force", worktreePath], { timeoutMs: 30_000 });
  }
}
