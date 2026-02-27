import { describe, it, expect } from "vitest";
import { validateDag, type DagInput } from "../../src/planning/dag-schema.js";

describe("validateDag", () => {
  const validNode = {
    taskId: "task-1",
    title: "Test Task",
    provider: "codex" as const,
    type: "code" as const,
    writeScope: {
      allow: ["src/"],
      ownership: "exclusive" as const,
    },
    commandPolicy: {
      network: "deny" as const,
    },
    // Added required fields
    expected: {},
    verify: {
      outputVerificationRequired: true
    },
    artifactIO: {}
  };

  it("should validate a simple valid DAG", () => {
    const input = {
      nodes: [validNode],
    };

    const result = validateDag(input);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].taskId).toBe("task-1");
    expect(result.nodes[0].contractHash).toBeDefined();
    expect(result.dagHash).toBeDefined();
    expect(typeof result.dagHash).toBe("string");
  });

  it("should throw on invalid schema", () => {
    const input = {
      nodes: [
        {
          ...validNode,
          provider: "unknown-provider", // Invalid enum
        },
      ],
    };

    expect(() => validateDag(input)).toThrow();
  });

  it("should detect a self-cycle", () => {
    const input = {
      nodes: [
        {
          ...validNode,
          dependencies: ["task-1"],
        },
      ],
    };

    expect(() => validateDag(input)).toThrow(/Cycle detected at node task-1/);
  });

  it("should detect a multi-node cycle", () => {
    const input = {
      nodes: [
        {
          ...validNode,
          taskId: "A",
          dependencies: ["B"],
        },
        {
          ...validNode,
          taskId: "B",
          dependencies: ["A"],
        },
      ],
    };

    // The order of detection depends on the order of iteration
    expect(() => validateDag(input)).toThrow(/Cycle detected at node [AB]/);
  });

  it("should apply defaults for optional fields", () => {
    const input = {
      nodes: [validNode],
    };

    const result = validateDag(input);
    const node = result.nodes[0];

    expect(node.dependencies).toEqual([]);
    expect(node.commandPolicy.allow).toEqual([]);
    expect(node.commandPolicy.deny).toEqual([]);
    expect(node.verify.outputVerificationRequired).toBe(true);
  });
});
