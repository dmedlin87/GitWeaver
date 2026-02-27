import { describe, expect, it } from "vitest";
import { validateGateCommand } from "../../src/verification/command-policy.js";
import { DEFAULT_CONFIG } from "../../src/core/config.js";

describe("validateGateCommand", () => {
  const config = DEFAULT_CONFIG;
  const policy = {
    allow: ["pnpm test", "npm test"],
    deny: ["--force"],
    network: "deny" as const
  };

  it("allows a safe command in allowlist", () => {
    expect(() => validateGateCommand("pnpm test", policy, config)).not.toThrow();
  });

  it("allows a safe command starting with allowlist entry", () => {
    expect(() => validateGateCommand("pnpm test tests/foo.ts", policy, config)).not.toThrow();
  });

  it("rejects command not in allowlist", () => {
    expect(() => validateGateCommand("ls -la", policy, config)).toThrow("not authorized by task command policy");
  });

  it("rejects command in global denylist", () => {
    // DEFAULT_CONFIG.defaultCommandDeny contains "rm -rf"
    expect(() => validateGateCommand("rm -rf /", policy, config)).toThrow("matches denylist pattern 'rm -rf'");
  });

  it("rejects command with dangerous shell characters", () => {
    expect(() => validateGateCommand("pnpm test; ls", policy, config)).toThrow("contains dangerous shell character ';'");
    expect(() => validateGateCommand("pnpm test && ls", policy, config)).toThrow("contains dangerous shell character '&'");
    expect(() => validateGateCommand("pnpm test | grep foo", policy, config)).toThrow("contains dangerous shell character '|'");
    expect(() => validateGateCommand("pnpm test > out.txt", policy, config)).toThrow("contains dangerous shell character '>'");
    expect(() => validateGateCommand("pnpm test `ls` ", policy, config)).toThrow("contains dangerous shell character '`'");
    expect(() => validateGateCommand("pnpm test $(ls)", policy, config)).toThrow("contains dangerous shell character '$'");
    expect(() => validateGateCommand("pnpm test\nls", policy, config)).toThrow("contains dangerous shell character '\n'");
  });

  it("rejects command in task denylist", () => {
    expect(() => validateGateCommand("pnpm test --force", policy, config)).toThrow("matches task denylist pattern '--force'");
  });

  it("allows everything if allow list is empty (except malicious)", () => {
      const emptyPolicy = {
          allow: [],
          deny: [],
          network: "deny" as const
      };
      expect(() => validateGateCommand("ls -la", emptyPolicy, config)).not.toThrow();
      expect(() => validateGateCommand("rm -rf /", emptyPolicy, config)).toThrow("matches denylist pattern 'rm -rf'");
  });

  it("handles empty command", () => {
    expect(() => validateGateCommand("", policy, config)).not.toThrow();
  });
});
