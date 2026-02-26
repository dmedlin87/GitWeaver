import { describe, expect, it } from "vitest";
import { evaluateScope } from "../../src/verification/scope-policy.js";

describe("evaluateScope", () => {
  it("allows files inside allowlist", () => {
    const result = evaluateScope(process.cwd(), ["src/a.ts"], ["src/**/*.ts"], []);
    expect(result.allowed).toBe(true);
  });

  it("blocks files outside allowlist", () => {
    const result = evaluateScope(process.cwd(), ["README.md"], ["src/**/*.ts"], []);
    expect(result.allowed).toBe(false);
    expect(result.violations[0]).toContain("not in allowlist");
  });
});