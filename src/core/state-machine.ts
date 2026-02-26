import { REASON_CODES, type ReasonCode } from "./reason-codes.js";

export type RunState =
  | "INGEST"
  | "BASELINE_OK"
  | "PLAN_FROZEN"
  | "DISPATCHING"
  | "INTEGRATING"
  | "VERIFYING"
  | "REPAIRING"
  | "COMPLETED"
  | "ABORTED_POLICY"
  | "ABORTED_BASELINE"
  | "ABORTED_BUDGET"
  | "ABORTED_MANUAL";

export type TaskState =
  | "PENDING"
  | "READY"
  | "LEASE_ACQUIRED"
  | "RUNNING"
  | "COMMIT_PRODUCED"
  | "SCOPE_PASSED"
  | "MERGE_QUEUED"
  | "MERGED"
  | "VERIFIED"
  | "EXEC_FAILED"
  | "SCOPE_FAILED"
  | "VERIFY_FAILED"
  | "STALE"
  | "ESCALATED";

const RUN_ALLOWED: Record<RunState, RunState[]> = {
  INGEST: ["BASELINE_OK", "ABORTED_POLICY", "ABORTED_BASELINE"],
  BASELINE_OK: ["PLAN_FROZEN", "ABORTED_POLICY", "ABORTED_BASELINE"],
  PLAN_FROZEN: ["DISPATCHING", "COMPLETED", "ABORTED_POLICY"],
  DISPATCHING: ["INTEGRATING", "ABORTED_BUDGET", "ABORTED_POLICY", "ABORTED_MANUAL", "COMPLETED"],
  INTEGRATING: ["VERIFYING", "REPAIRING", "ABORTED_BUDGET", "ABORTED_POLICY", "COMPLETED"],
  VERIFYING: ["INTEGRATING", "REPAIRING", "COMPLETED", "ABORTED_BUDGET"],
  REPAIRING: ["INTEGRATING", "ABORTED_BUDGET", "ABORTED_POLICY", "ABORTED_MANUAL"],
  COMPLETED: [],
  ABORTED_POLICY: [],
  ABORTED_BASELINE: [],
  ABORTED_BUDGET: [],
  ABORTED_MANUAL: []
};

export function assertRunTransition(from: RunState, to: RunState): void {
  if (!RUN_ALLOWED[from].includes(to)) {
    throw new Error(`Invalid run transition ${from} -> ${to}`);
  }
}

const TASK_ALLOWED: Record<TaskState, TaskState[]> = {
  PENDING: ["READY", "ESCALATED"],
  READY: ["LEASE_ACQUIRED", "ESCALATED"],
  LEASE_ACQUIRED: ["RUNNING", "STALE", "ESCALATED"],
  RUNNING: ["COMMIT_PRODUCED", "EXEC_FAILED", "STALE", "ESCALATED"],
  COMMIT_PRODUCED: ["SCOPE_PASSED", "SCOPE_FAILED", "STALE"],
  SCOPE_PASSED: ["MERGE_QUEUED", "VERIFY_FAILED"],
  MERGE_QUEUED: ["MERGED", "VERIFY_FAILED", "ESCALATED"],
  MERGED: ["VERIFIED", "VERIFY_FAILED", "STALE"],
  VERIFIED: [],
  EXEC_FAILED: ["READY", "ESCALATED"],
  SCOPE_FAILED: ["READY", "ESCALATED"],
  VERIFY_FAILED: ["READY", "ESCALATED"],
  STALE: ["READY", "ESCALATED"],
  ESCALATED: []
};

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  if (!TASK_ALLOWED[from].includes(to)) {
    throw new Error(`Invalid task transition ${from} -> ${to}`);
  }
}

export function mapRunAbort(reason: ReasonCode): RunState {
  if (
    reason === REASON_CODES.BASELINE_GATE_FAILED ||
    reason === REASON_CODES.BASELINE_DIRTY_REPO ||
    reason === REASON_CODES.REPO_NOT_GIT
  ) {
    return "ABORTED_BASELINE";
  }
  if (reason === REASON_CODES.ABORTED_BUDGET) {
    return "ABORTED_BUDGET";
  }
  return "ABORTED_POLICY";
}
