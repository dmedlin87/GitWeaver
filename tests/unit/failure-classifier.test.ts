import { describe, expect, it } from "vitest";
import { REASON_CODES } from "../../src/core/reason-codes.js";
import { classifyFailure, isNonRepairableExecutionFailure } from "../../src/repair/failure-classifier.js";

describe("failure classifier", () => {
  it("flags CLI usage failures as non-repairable execution errors", () => {
    const text = "Unknown arguments: files,, hard,, n\nUsage: gemini [options]";
    expect(isNonRepairableExecutionFailure(text, REASON_CODES.EXEC_FAILED)).toBe(true);
    expect(classifyFailure(text, REASON_CODES.EXEC_FAILED)).toBe("NON_REPAIRABLE_EXEC");
  });

  it("flags auth missing as non-repairable", () => {
    expect(isNonRepairableExecutionFailure("missing auth", REASON_CODES.AUTH_MISSING)).toBe(true);
  });

  it("keeps test failures repairable", () => {
    const text = "Assertion failed in test suite";
    expect(isNonRepairableExecutionFailure(text, REASON_CODES.VERIFY_FAIL_TEST)).toBe(false);
    expect(classifyFailure(text, REASON_CODES.VERIFY_FAIL_TEST)).toBe("VERIFY_FAIL_TEST");
  });

  it("keeps compile failures as default repairable class", () => {
    expect(classifyFailure("TypeScript compile error: cannot find name", REASON_CODES.VERIFY_FAIL_COMPILE)).toBe("VERIFY_FAIL_COMPILE");
  });
});
