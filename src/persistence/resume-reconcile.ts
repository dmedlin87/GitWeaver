import { runCommand } from "../core/shell.js";
import { REASON_CODES } from "../core/reason-codes.js";
import type { EventRecord, RunRecord, TaskRecord } from "../core/types.js";
import type { TaskState } from "../core/state-machine.js";

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

interface EventTaskState {
  state: TaskState;
  seq: number;
}

function eventToTaskState(type: string): TaskState | undefined {
  switch (type) {
    case "TASK_READY":
    case "TASK_DISPATCHED":
      return "READY";
    case "TASK_ATTEMPT":
    case "TASK_PROMPT_ENVELOPE":
    case "TASK_PROVIDER_START":
    case "TASK_PROVIDER_HEARTBEAT":
    case "TASK_PROVIDER_FINISH":
      return "RUNNING";
    case "TASK_COMMIT_PRODUCED":
      return "COMMIT_PRODUCED";
    case "TASK_MERGE_QUEUED":
      return "MERGE_QUEUED";
    case "TASK_MERGED":
      return "MERGED";
    case "TASK_VERIFIED":
      return "VERIFIED";
    case "TASK_REPAIR_ENQUEUED":
      return "VERIFY_FAILED";
    case "TASK_ESCALATED":
      return "ESCALATED";
    default:
      return undefined;
  }
}

function buildEventTaskState(events: EventRecord[]): Map<string, EventTaskState> {
  const byTask = new Map<string, EventTaskState>();
  const ordered = [...events].sort((a, b) => a.seq - b.seq);
  for (const event of ordered) {
    const taskId = event.payload.taskId;
    if (typeof taskId !== "string" || taskId.length === 0) {
      continue;
    }
    const state = eventToTaskState(event.type);
    if (!state) {
      continue;
    }
    byTask.set(taskId, { state, seq: event.seq });
  }
  return byTask;
}

function isMergedLike(state: TaskState | undefined): boolean {
  return state === "MERGED" || state === "VERIFIED";
}

function isEscalated(state: TaskState | undefined): boolean {
  return state === "ESCALATED";
}

function isMergeQueued(state: TaskState | undefined): boolean {
  return state === "MERGE_QUEUED";
}

function resolveResumeEvidence(
  taskId: string,
  mergedSet: Set<string>,
  dbTask: TaskRecord | undefined,
  eventState: EventTaskState | undefined
): { action: "merged" | "requeue" | "escalate" | "ignore"; reasonCode?: string } {
  if (mergedSet.has(taskId)) {
    if (!isMergedLike(dbTask?.state) || !isMergedLike(eventState?.state)) {
      return { action: "merged", reasonCode: REASON_CODES.RESUME_DB_LAG };
    }
    return { action: "merged" };
  }

  // Event log precedence over SQLite when git has no merged proof.
  if (isEscalated(eventState?.state)) {
    return { action: "escalate", reasonCode: REASON_CODES.RESUME_ESCALATED_EVENT_LOG };
  }

  if (isMergedLike(eventState?.state)) {
    return { action: "escalate", reasonCode: REASON_CODES.RESUME_AMBIGUOUS_STATE };
  }

  if (isEscalated(dbTask?.state)) {
    return { action: "escalate", reasonCode: REASON_CODES.RESUME_ESCALATED_DB };
  }

  if (isMergedLike(dbTask?.state)) {
    return { action: "requeue", reasonCode: REASON_CODES.RESUME_MISSING_COMMIT };
  }

  if (eventState && !dbTask) {
    return { action: "requeue", reasonCode: REASON_CODES.RESUME_DB_LAG };
  }

  if (isMergeQueued(dbTask?.state) || isMergeQueued(eventState?.state)) {
    return { action: "requeue", reasonCode: REASON_CODES.RESUME_MERGE_IN_FLIGHT };
  }

  if (dbTask || eventState) {
    return { action: "requeue", reasonCode: REASON_CODES.RESUME_CRASH_RECOVERY };
  }

  return { action: "ignore" };
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
    const matches = chunk.matchAll(/ORCH_TASK_ID=([^\s]+)/g);
    for (const match of matches) {
      if (match[1]) {
        ids.add(match[1]);
      }
    }
  }
  return [...ids];
}

async function detectExternalDriftCommits(repoPath: string, baselineCommit: string, runId: string): Promise<string[]> {
  const logResult = await runCommand(
    "git",
    [
      "-C",
      repoPath,
      "log",
      "--pretty=format:%H%x00%B%x00",
      `${baselineCommit}..HEAD`
    ],
    { timeoutMs: 30_000 }
  );

  if (logResult.code !== 0) {
    return [];
  }

  const driftCommits: string[] = [];
  const chunks = logResult.stdout.split("\u0000");
  for (let index = 0; index + 1 < chunks.length; index += 2) {
    const hash = chunks[index]?.trim();
    const body = chunks[index + 1] ?? "";
    if (!hash) {
      continue;
    }
    if (!body.includes(`ORCH_RUN_ID=${runId}`)) {
      driftCommits.push(hash);
    }
  }

  return [...new Set(driftCommits)].sort();
}

export async function reconcileResume(input: ResumeInput): Promise<ResumeDecision> {
  const mergedFromGit = await mergedTasksFromGit(input.run.repoPath, input.run.runId);
  const mergedSet = new Set<string>(mergedFromGit);
  const eventTaskState = buildEventTaskState(input.events);
  const driftCommits = await detectExternalDriftCommits(input.run.repoPath, input.run.baselineCommit, input.run.runId);

  const requeueTaskIds: string[] = [];
  const escalatedTaskIds: string[] = [];
  const reasons: Record<string, string> = {};
  const mergedTaskIds = new Set<string>();
  const dbByTask = new Map(input.tasksFromDb.map((task) => [task.taskId, task]));

  const candidateTaskIds = new Set<string>([
    ...input.tasksFromDb.map((task) => task.taskId),
    ...eventTaskState.keys(),
    ...mergedSet
  ]);

  const orderedTaskIds = [...candidateTaskIds].sort();
  for (const taskId of orderedTaskIds) {
    const dbTask = dbByTask.get(taskId);
    const eventState = eventTaskState.get(taskId);
    const resolution = resolveResumeEvidence(taskId, mergedSet, dbTask, eventState);
    if (resolution.reasonCode) {
      reasons[taskId] = resolution.reasonCode;
    }
    if (resolution.action === "merged") {
      mergedTaskIds.add(taskId);
      continue;
    }
    if (resolution.action === "escalate") {
      escalatedTaskIds.push(taskId);
      continue;
    }
    if (resolution.action === "requeue") {
      requeueTaskIds.push(taskId);
    }
  }

  requeueTaskIds.sort();
  escalatedTaskIds.sort();

  const lastEvent = input.events[input.events.length - 1];
  const driftDetected = driftCommits.length > 0 || Boolean(lastEvent?.type === "DRIFT_DETECTED");

  return {
    mergedTaskIds: [...mergedTaskIds].sort(),
    requeueTaskIds,
    escalatedTaskIds,
    driftDetected,
    driftCommits,
    reasons
  };
}
