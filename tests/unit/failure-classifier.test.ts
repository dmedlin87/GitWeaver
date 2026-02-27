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

  it("classifies lock timeout correctly", () => {
    expect(classifyFailure("lock timeout", REASON_CODES.LOCK_TIMEOUT)).toBe("LOCK_TIMEOUT");
  });

  it("classifies stale task correctly", () => {
    expect(classifyFailure("stale task", REASON_CODES.STALE_TASK)).toBe("STALE_TASK");
  });

  it("classifies scope failure correctly", () => {
    expect(classifyFailure("scope denied", REASON_CODES.SCOPE_DENY)).toBe("SCOPE_FAIL");
    expect(classifyFailure("scope violation detected")).toBe("SCOPE_FAIL");
  });

  it("classifies merge conflict correctly", () => {
    expect(classifyFailure("merge conflict", REASON_CODES.MERGE_CONFLICT)).toBe("MERGE_CONFLICT");
    expect(classifyFailure("automatic merge failed; fix conflicts and then commit the result.")).toBe("MERGE_CONFLICT");
  });

  it("classifies verify fail test correctly via text content", () => {
    expect(classifyFailure("running tests...")).toBe("VERIFY_FAIL_TEST");
    expect(classifyFailure("assertion failed")).toBe("VERIFY_FAIL_TEST");
  });
});
