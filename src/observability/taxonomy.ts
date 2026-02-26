import { REASON_CODES } from "../core/reason-codes.js";

export const FAILURE_TAXONOMY: Record<string, { severity: "low" | "medium" | "high"; class: string }> = {
  [REASON_CODES.SCOPE_DENY]: { severity: "high", class: "policy" },
  [REASON_CODES.PROMPT_DRIFT]: { severity: "high", class: "contract" },
  [REASON_CODES.VERIFY_FAIL_COMPILE]: { severity: "high", class: "verification" },
  [REASON_CODES.VERIFY_FAIL_TEST]: { severity: "high", class: "verification" },
  [REASON_CODES.MERGE_CONFLICT]: { severity: "medium", class: "merge" },
  [REASON_CODES.LOCK_TIMEOUT]: { severity: "medium", class: "concurrency" },
  [REASON_CODES.PROVIDER_OUTDATED]: { severity: "low", class: "provider" },
  [REASON_CODES.PROVIDER_MISSING]: { severity: "high", class: "provider" }
};