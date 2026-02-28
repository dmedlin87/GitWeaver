import { describe, expect, it } from "vitest";
import { FAILURE_TAXONOMY } from "../../src/observability/taxonomy.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";

describe("FAILURE_TAXONOMY", () => {
  it("has an entry for SCOPE_DENY", () => {
    expect(FAILURE_TAXONOMY[REASON_CODES.SCOPE_DENY]).toBeDefined();
    expect(FAILURE_TAXONOMY[REASON_CODES.SCOPE_DENY]!.severity).toBe("high");
    expect(FAILURE_TAXONOMY[REASON_CODES.SCOPE_DENY]!.class).toBe("policy");
  });

  it("has an entry for PROMPT_DRIFT", () => {
    expect(FAILURE_TAXONOMY[REASON_CODES.PROMPT_DRIFT]).toBeDefined();
    expect(FAILURE_TAXONOMY[REASON_CODES.PROMPT_DRIFT]!.severity).toBe("high");
    expect(FAILURE_TAXONOMY[REASON_CODES.PROMPT_DRIFT]!.class).toBe("contract");
  });

  it("has entries for verification failures", () => {
    expect(FAILURE_TAXONOMY[REASON_CODES.VERIFY_FAIL_COMPILE]!.class).toBe("verification");
    expect(FAILURE_TAXONOMY[REASON_CODES.VERIFY_FAIL_TEST]!.class).toBe("verification");
  });

  it("has medium severity for merge and concurrency issues", () => {
    expect(FAILURE_TAXONOMY[REASON_CODES.MERGE_CONFLICT]!.severity).toBe("medium");
    expect(FAILURE_TAXONOMY[REASON_CODES.LOCK_TIMEOUT]!.severity).toBe("medium");
  });

  it("has low severity for provider outdated", () => {
    expect(FAILURE_TAXONOMY[REASON_CODES.PROVIDER_OUTDATED]!.severity).toBe("low");
  });

  it("has high severity for provider missing", () => {
    expect(FAILURE_TAXONOMY[REASON_CODES.PROVIDER_MISSING]!.severity).toBe("high");
  });

  it("all entries have valid severity levels", () => {
    const validSeverities = ["low", "medium", "high"];
    for (const entry of Object.values(FAILURE_TAXONOMY)) {
      expect(validSeverities).toContain(entry.severity);
    }
  });

  it("all entries have a class string", () => {
    for (const entry of Object.values(FAILURE_TAXONOMY)) {
      expect(typeof entry.class).toBe("string");
      expect(entry.class.length).toBeGreaterThan(0);
    }
  });
});
