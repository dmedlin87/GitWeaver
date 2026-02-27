import { describe, expect, it } from "vitest";
import { validateCommand } from "../../src/verification/command-policy.js";

describe("validateCommand", () => {
  it("allows commands starting with allowed prefix", () => {
    const policy = { allow: ["pnpm test"], deny: [] };
    const result = validateCommand("pnpm test --filter foo", policy);
    expect(result.allowed).toBe(true);
  });

  it("denies commands not in allowlist", () => {
    const policy = { allow: ["pnpm test"], deny: [] };
    const result = validateCommand("rm -rf .", policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("does not start with any allowed prefix");
  });

  it("denies commands matching deny pattern", () => {
    const policy = { allow: ["pnpm"], deny: ["rm -rf"] };
    const result = validateCommand("pnpm run script && rm -rf .", policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Command contains denied pattern: 'rm -rf'");
  });

  it("denies everything if allowlist is empty", () => {
    const policy = { allow: [], deny: [] };
    const result = validateCommand("ls", policy);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("allowlist is empty");
  });
});
