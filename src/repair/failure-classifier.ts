import { REASON_CODES } from "../core/reason-codes.js";

export type FailureClass =
  | "VERIFY_FAIL_COMPILE"
  | "VERIFY_FAIL_TEST"
  | "SCOPE_FAIL"
  | "MERGE_CONFLICT"
  | "NON_REPAIRABLE_EXEC"
  | "LOCK_TIMEOUT"
  | "STALE_TASK";

const NON_REPAIRABLE_EXEC_PATTERNS = [
  "unknown arguments",
  "usage:",
  "approval mode is only available",
  "not recognized as an internal or external command",
  "command not found",
  "enoent"
];

const NON_REPAIRABLE_AUTH_PATTERNS = [
  /\bno active credentials\b/,
  /\bauthentication required\b/,
  /\blogin required\b/,
  /\bnot logged in\b/
];

const NON_REPAIRABLE_AUTH_CONTEXT_PATTERNS = [
  "api key",
  "sign in",
  "log in"
];

export function isNonRepairableExecutionFailure(text: string, reasonCode?: string): boolean {
  if (reasonCode === REASON_CODES.AUTH_MISSING || reasonCode === REASON_CODES.PROMPT_DRIFT) {
    return true;
  }

  if (reasonCode && reasonCode !== REASON_CODES.EXEC_FAILED) {
    return false;
  }

  const source = `${reasonCode ?? ""}\n${text}`.toLowerCase();
  if (NON_REPAIRABLE_EXEC_PATTERNS.some((pattern) => source.includes(pattern))) {
    return true;
  }

  if (NON_REPAIRABLE_AUTH_PATTERNS.some((pattern) => pattern.test(source))) {
    return true;
  }

  return NON_REPAIRABLE_AUTH_CONTEXT_PATTERNS.some((pattern) => source.includes(pattern));
}

export function classifyFailure(text: string, reasonCode?: string): FailureClass {
  const source = `${reasonCode ?? ""}\n${text}`.toLowerCase();

  if (isNonRepairableExecutionFailure(text, reasonCode)) {
    return "NON_REPAIRABLE_EXEC";
  }
  if (reasonCode === REASON_CODES.LOCK_TIMEOUT) {
    return "LOCK_TIMEOUT";
  }
  if (reasonCode === REASON_CODES.STALE_TASK) {
    return "STALE_TASK";
  }
  if (source.includes("scope") || reasonCode === REASON_CODES.SCOPE_DENY) {
    return "SCOPE_FAIL";
  }
  if (source.includes("conflict") || reasonCode === REASON_CODES.MERGE_CONFLICT) {
    return "MERGE_CONFLICT";
  }
  if (source.includes("test") || source.includes("assert") || reasonCode === REASON_CODES.VERIFY_FAIL_TEST) {
    return "VERIFY_FAIL_TEST";
  }
  return "VERIFY_FAIL_COMPILE";
}
