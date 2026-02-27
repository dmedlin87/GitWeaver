import { runCommand } from "../core/shell.js";
import { REASON_CODES } from "../core/reason-codes.js";
import type { EventRecord, RunRecord, TaskRecord } from "../core/types.js";

export interface ResumeInput {
  run: RunRecord;
  tasksFromDb: TaskRecord[];
  events: EventRecord[];
}

export interface ResumeDecision {
  mergedTaskIds: string[];
  requeueTaskIds: string[];
  escalatedTaskIds: string[];
  driftDetected: boolean;
  driftCommits: string[];
  reasons: Record<string, string>;
}

async function mergedTasksFromGit(repoPath: string, runId: string): Promise<string[]> {
  const result = await runCommand(
    "git",
    [
      "-C",
      repoPath,
      "log",
      "--pretty=format:%B%x00",
      "--grep",
      `ORCH_RUN_ID=${runId}`
    ],
    { timeoutMs: 30_000 }
  );

  if (result.code !== 0) {
    return [];
  }

  const chunks = result.stdout.split("\u0000");
  const ids = new Set<string>();
  for (const chunk of chunks) {
    const match = chunk.match(/ORCH_TASK_ID=([^\s]+)/);
    if (match?.[1]) {
      ids.add(match[1]);
    }
  }
  return [...ids];
}

async function detectExternalDriftCommits(repoPath: string, baselineCommit: string, runId: string): Promise<string[]> {
  const hashResult = await runCommand(
    "git",
    [
      "-C",
      repoPath,
      "rev-list",
      `${baselineCommit}..HEAD`
    ],
    { timeoutMs: 30_000 }
  );

  if (hashResult.code !== 0) {
    return [];
  }

  const driftCommits: string[] = [];
  const hashes = hashResult.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const hash of hashes) {
    const bodyResult = await runCommand(
      "git",
      ["-C", repoPath, "cat-file", "-p", hash],
      { timeoutMs: 10_000 }
    );

    if (bodyResult.code !== 0) {
      continue;
    }

    const body = bodyResult.stdout.split(/\r?\n\r?\n/).slice(1).join("\n\n");
    if (!body.includes(`ORCH_RUN_ID=${runId}`)) {
      driftCommits.push(hash);
    }
  }

  return [...new Set(driftCommits)].sort();
}

export async function reconcileResume(input: ResumeInput): Promise<ResumeDecision> {
  const mergedFromGit = await mergedTasksFromGit(input.run.repoPath, input.run.runId);
  const mergedSet = new Set<string>(mergedFromGit);
  const mergedTaskIds = [...mergedSet].sort();
  const driftCommits = await detectExternalDriftCommits(input.run.repoPath, input.run.baselineCommit, input.run.runId);

  const requeueTaskIds: string[] = [];
  const escalatedTaskIds: string[] = [];
  const reasons: Record<string, string> = {};

  for (const task of input.tasksFromDb) {
    if (mergedSet.has(task.taskId)) {
      if (!["VERIFIED", "MERGED"].includes(task.state)) {
        reasons[task.taskId] = REASON_CODES.RESUME_DB_LAG;
      }
      continue;
    }

    if (["VERIFIED", "MERGED"].includes(task.state)) {
      requeueTaskIds.push(task.taskId);
      reasons[task.taskId] = REASON_CODES.RESUME_MISSING_COMMIT;
      continue;
    }

    if (["ESCALATED"].includes(task.state)) {
      escalatedTaskIds.push(task.taskId);
      continue;
    }

    requeueTaskIds.push(task.taskId);
  }

  requeueTaskIds.sort();
  escalatedTaskIds.sort();

  const lastEvent = input.events[input.events.length - 1];
  const driftDetected = driftCommits.length > 0 || Boolean(lastEvent?.type === "DRIFT_DETECTED");

  return {
    mergedTaskIds,
    requeueTaskIds,
    escalatedTaskIds,
    driftDetected,
    driftCommits,
    reasons
  };
}
