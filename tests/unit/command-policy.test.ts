import { describe, expect, it } from "vitest";
<<<<<<< ours
=======
import { DEFAULT_CONFIG } from "../../src/core/config.js";
import { validateDag } from "../../src/planning/dag-schema.js";
>>>>>>> theirs
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
<<<<<<< ours
    expect(result.reason).toContain("allowlist is empty");
=======
    expect(result.reason).toContain("matches task denylist pattern '--force'");
  });

  it("rejects commands when allow list is empty", () => {
<<<<<<< ours
      const emptyPolicy = {
          allow: [],
          deny: [],
          network: "deny" as const
      };

      let result = validateCommand("ls -la", emptyPolicy, config);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("no allowed commands configured");
=======
    const emptyPolicy = {
      allow: [],
      deny: [],
      network: "deny" as const
    };

    let result = validateCommand("ls -la", emptyPolicy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no allowed commands configured");

    result = validateCommand("rm -rf /", emptyPolicy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("matches denylist pattern 'rm -rf'");
  });
>>>>>>> theirs

  it("rejects gate commands when DAG omits commandPolicy.allow", () => {
    const dag = validateDag({
      nodes: [
        {
          taskId: "task-1",
          title: "Task",
          provider: "codex",
          type: "code",
          writeScope: {
            allow: ["src/**/*.ts"],
            ownership: "exclusive"
          },
          commandPolicy: {
            deny: []
          },
          expected: {},
          verify: {
            gateCommand: "pnpm test"
          },
          artifactIO: {}
        }
      ]
    });

    const result = validateCommand(dag.nodes[0].verify.gateCommand ?? "", dag.nodes[0].commandPolicy, config);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("no allowed commands configured");
  });

  it("handles empty command", () => {
    const result = validateCommand("", policy, config);
    expect(result.allowed).toBe(true);
>>>>>>> theirs
  });
});
