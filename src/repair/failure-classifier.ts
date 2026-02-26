import { REASON_CODES } from "../core/reason-codes.js";

export type FailureClass = "VERIFY_FAIL_COMPILE" | "VERIFY_FAIL_TEST" | "SCOPE_FAIL" | "MERGE_CONFLICT";

export function classifyFailure(text: string, reasonCode?: string): FailureClass {
  const source = `${reasonCode ?? ""}\n${text}`.toLowerCase();

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