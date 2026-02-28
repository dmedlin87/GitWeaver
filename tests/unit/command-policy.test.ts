import { describe, expect, it } from "vitest";
import { validateCommand } from "../../src/verification/command-policy.js";
import { DEFAULT_CONFIG } from "../../src/core/config.js";

describe("validateCommand", () => {
  const config = DEFAULT_CONFIG;
  const policy = {
    allow: ["pnpm test", "npm test"],
    deny: ["--force"],
    network: "deny" as const
  };

  it("allows a safe command in allowlist", () => {
    const result = validateCommand("pnpm test", policy, config);
    expect(result.allowed).toBe(true);
  });

  it("allows a safe command starting with allowlist entry", () => {
    const result = validateCommand("pnpm test tests/foo.ts", policy, config);
    expect(result.allowed).toBe(true);
  });

  it("rejects command not in allowlist", () => {
    const result = validateCommand("ls -la", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not authorized by task command policy");
  });

  it("rejects command in global denylist", () => {
    // DEFAULT_CONFIG.defaultCommandDeny contains "rm -rf"
    const result = validateCommand("rm -rf /", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("matches denylist pattern 'rm -rf'");
  });

  it("rejects command with dangerous shell characters", () => {
    let result = validateCommand("pnpm test; ls", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("contains dangerous shell character ';'");

    result = validateCommand("pnpm test && ls", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("contains dangerous shell character '&'");

    result = validateCommand("pnpm test | grep foo", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("contains dangerous shell character '|'");

    result = validateCommand("pnpm test > out.txt", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("contains dangerous shell character '>'");

    result = validateCommand("pnpm test `ls` ", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("contains dangerous shell character '`'");

    result = validateCommand("pnpm test $(ls)", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("contains dangerous shell character '$'");

    result = validateCommand("pnpm test\nls", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("contains dangerous shell character '\n'");
  });

  it("rejects command in task denylist", () => {
    const result = validateCommand("pnpm test --force", policy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("matches task denylist pattern '--force'");
  });

  it("allows everything if allow list is empty (except malicious)", () => {
      const emptyPolicy = {
          allow: [],
          deny: [],
          network: "deny" as const
      };

      let result = validateCommand("ls -la", emptyPolicy, config);
      expect(result.allowed).toBe(true);

      result = validateCommand("rm -rf /", emptyPolicy, config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("matches denylist pattern 'rm -rf'");
  });

  it("handles empty command", () => {
    const result = validateCommand("", policy, config);
    expect(result.allowed).toBe(true);
  });
});
