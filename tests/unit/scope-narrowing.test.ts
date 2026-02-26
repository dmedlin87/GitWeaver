import { describe, it, expect } from "vitest";
import { extractFilesFromError } from "../../src/verification/error-extractor.js";
import { classifyFailure, type FailureClass } from "../../src/repair/failure-classifier.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";

describe("Scope Narrowing Logic", () => {
  describe("extractFilesFromError", () => {
    it("should extract files matching allow patterns", () => {
      const errorText = `
        Error: failed to compile src/core/foo.ts
        Also verify tests/unit/bar.test.ts failed.
        Ignored path: external/lib/baz.ts
      `;
      const allowPatterns = ["src/**/*.ts", "tests/**/*.ts"];
      const files = extractFilesFromError(errorText, allowPatterns);
      expect(files).toContain("src/core/foo.ts");
      expect(files).toContain("tests/unit/bar.test.ts");
      expect(files).not.toContain("external/lib/baz.ts");
    });

    it("should handle duplicates", () => {
      const errorText = "src/foo.ts failed. src/foo.ts error.";
      const allowPatterns = ["src/**/*.ts"];
      const files = extractFilesFromError(errorText, allowPatterns);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe("src/foo.ts");
    });

    it("should return empty array if no matches", () => {
      const errorText = "Something went wrong.";
      const allowPatterns = ["src/**/*.ts"];
      const files = extractFilesFromError(errorText, allowPatterns);
      expect(files).toEqual([]);
    });

    it("should handle windows paths", () => {
        const errorText = "src\\core\\foo.ts failed";
        const allowPatterns = ["src/**/*.ts"];
        // On non-windows, extractFilesFromError logic still normalizes backslashes to forward slashes before match
        const files = extractFilesFromError(errorText, allowPatterns);
        expect(files).toContain("src/core/foo.ts");
    });
  });

  describe("Failure Classification", () => {
    it("should classify LOCK_TIMEOUT correctly", () => {
      const result = classifyFailure("Some lock error", REASON_CODES.LOCK_TIMEOUT);
      expect(result).toBe("LOCK_TIMEOUT");
    });

    it("should classify STALE_TASK correctly", () => {
      const result = classifyFailure("Task is stale", REASON_CODES.STALE_TASK);
      expect(result).toBe("STALE_TASK");
    });

    it("should classify regular compilation failure", () => {
      const result = classifyFailure("TypeScript error TS1234", REASON_CODES.VERIFY_FAIL_COMPILE);
      expect(result).toBe("VERIFY_FAIL_COMPILE");
    });

    it("should classify test failure", () => {
        const result = classifyFailure("Test failed", REASON_CODES.VERIFY_FAIL_TEST);
        expect(result).toBe("VERIFY_FAIL_TEST");
    });

    it("should classify scope failure", () => {
        const result = classifyFailure("Scope violation", REASON_CODES.SCOPE_DENY);
        expect(result).toBe("SCOPE_FAIL");
    });
  });
});
