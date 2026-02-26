import { runCommand } from "../core/shell.js";
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

export async function reconcileResume(input: ResumeInput): Promise<ResumeDecision> {
  const mergedFromGit = await mergedTasksFromGit(input.run.repoPath, input.run.runId);
  const mergedSet = new Set<string>(mergedFromGit);

  const requeueTaskIds: string[] = [];
  const escalatedTaskIds: string[] = [];

  for (const task of input.tasksFromDb) {
    if (mergedSet.has(task.taskId)) {
      continue;
    }

    if (["VERIFIED", "MERGED"].includes(task.state)) {
      requeueTaskIds.push(task.taskId);
      continue;
    }

    if (["ESCALATED"].includes(task.state)) {
      escalatedTaskIds.push(task.taskId);
      continue;
    }

    requeueTaskIds.push(task.taskId);
  }

  const lastEvent = input.events[input.events.length - 1];
  const driftDetected = Boolean(lastEvent?.type === "DRIFT_DETECTED");

  return {
    mergedTaskIds: [...mergedSet],
    requeueTaskIds,
    escalatedTaskIds,
    driftDetected
  };
}