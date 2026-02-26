import { runCommand } from "../core/shell.js";

export interface CommitAnalysis {
  commitHash: string;
  changedFiles: string[];
  hasChanges: boolean;
}

export async function analyzeCommit(repoPath: string, commitHash: string): Promise<CommitAnalysis> {
  const filesResult = await runCommand("git", ["-C", repoPath, "show", "--name-only", "--pretty=format:", commitHash], {
    timeoutMs: 30_000
  });
  if (filesResult.code !== 0) {
    throw new Error(`Failed to inspect commit ${commitHash}: ${filesResult.stderr}`);
  }

  const changedFiles = filesResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    commitHash,
    changedFiles,
    hasChanges: changedFiles.length > 0
  };
}

export async function latestCommit(repoPath: string): Promise<string> {
  const result = await runCommand("git", ["-C", repoPath, "rev-parse", "HEAD"], { timeoutMs: 10_000 });
  if (result.code !== 0) {
    throw new Error(`Unable to read HEAD: ${result.stderr}`);
  }
  return result.stdout.trim();
}