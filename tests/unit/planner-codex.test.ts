import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractJsonPayload, generateDagWithCodex } from "../../src/planning/planner-codex.js";
import { getProviderAdapter } from "../../src/providers/adapters/index.js";
import { readFileSync } from "node:fs";

vi.mock("../../src/providers/adapters/index.js", () => ({
  getProviderAdapter: vi.fn(),
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

describe("extractJsonPayload", () => {
  it("should extract JSON payload from direct JSON string", () => {
    const raw = `{"nodes": [], "edges": []}`;
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should extract JSON payload from item.completed event", () => {
    const raw = `{"type": "item.completed", "item": {"type": "agent_message", "text": "{\\"nodes\\": [], \\"edges\\": []}"}}`;
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should extract JSON payload when valid event is surrounded by other JSON", () => {
    const raw = `
{"type": "other.event"}
{"type": "item.completed", "item": {"type": "agent_message", "text": "{\\"nodes\\": [], \\"edges\\": []}"}}
{"type": "other.event"}
`;
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should extract JSON payload when valid event text is invalid JSON but a later one is valid", () => {
    const raw = `
{"type": "item.completed", "item": {"type": "agent_message", "text": "invalid json"}}
{"type": "item.completed", "item": {"type": "agent_message", "text": "{\\"nodes\\": [], \\"edges\\": []}"}}
`;
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should fallback to last line valid JSON when no item.completed event matches", () => {
    const raw = `
{"some": "data"}
invalid json
{"nodes": [], "edges": []}
`;
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should fallback to full raw parsing when no lines have valid JSON or last line fallback fails", () => {
    // raw block with new lines inside strings, meaning line by line parsing will fail for the whole block
    const raw = `{
  "nodes": [],
  "edges": []
}`;
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should throw an error if no valid JSON is found anywhere", () => {
    const raw = `
just some random
text that is not json
`;
    expect(() => extractJsonPayload(raw)).toThrow("Planner returned non-JSON output");
  });

  it("should extract JSON from markdown code blocks", () => {
    const raw = "Here is the plan:\n```json\n{\"nodes\": [], \"edges\": []}\n```\nHope it helps!";
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should extract JSON from markdown code blocks without language tag", () => {
    const raw = "```\n{\"nodes\": [], \"edges\": []}\n```";
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should extract JSON using aggressive brace matching", () => {
    const raw = "The plan is { \"nodes\": [], \"edges\": [] } which is good.";
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should unwrap nested response field", () => {
    const raw = JSON.stringify({ response: JSON.stringify({ nodes: [], edges: [] }) });
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should unwrap nested response field inside markdown", () => {
    const inner = JSON.stringify({ response: JSON.stringify({ nodes: [], edges: [] }) });
    const raw = "```json\n" + inner + "\n```";
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should handle multiple markdown blocks and pick the first valid one", () => {
    const raw = "```\ninvalid\n```\n```json\n{\"nodes\": [], \"edges\": []}\n```";
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should return value if item.completed text is not JSON in unwrapEventPayload", () => {
    const raw = `{"type": "item.completed", "item": {"type": "agent_message", "text": "not json"}}`;
    expect(extractJsonPayload(raw)).toEqual({ type: "item.completed", item: { type: "agent_message", text: "not json" } });
  });

  it("should handle markdown containing an event payload with invalid JSON text", () => {
    const event = { type: "item.completed", item: { type: "agent_message", text: "not json" } };
    const raw = "```json\n" + JSON.stringify(event) + "\n```";
    expect(extractJsonPayload(raw)).toEqual(event);
  });

  it("should handle aggressive brace matching with an event payload", () => {
    const event = { type: "item.completed", item: { type: "agent_message", text: "{\"nodes\": [], \"edges\": []}" } };
    const raw = "The plan is " + JSON.stringify(event) + " ok?";
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should handle empty lines in line-by-line parsing", () => {
    const raw = "\n\n{\"nodes\": [], \"edges\": []}\n\n";
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should handle nested response in line-by-line parsing", () => {
    const raw = "Line 1\n" + JSON.stringify({ response: JSON.stringify({ nodes: [], edges: [] }) });
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should handle nested response in line-by-line when aggressive brace matching fails", () => {
    const raw = '{"nodes": []} \n {"response": "{\\"nodes\\": [], \\"edges\\": []}"}';
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should handle valid JSON in item.completed but invalid JSON later in scanning", () => {
    const raw = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "{\"nodes\": [], \"edges\": []}" } }) + "\nInvalid";
    expect(extractJsonPayload(raw)).toEqual({ nodes: [], edges: [] });
  });

  it("should return the last valid JSON atom if multi-line and not matched by other means", () => {
    const raw = "[\n  1,\n  2\n]";
    // Index 3 is ']', Index 2 is '2' (Success), returns 2.
    expect(extractJsonPayload(raw)).toEqual(2);
  });
});

describe("generateDagWithCodex", () => {
  const objective = "Test objective";
  const cwd = "/test/cwd";
  const mockTask = {
    taskId: "task-1",
    title: "Task 1",
    provider: "codex",
    type: "code",
    dependencies: [],
    writeScope: { allow: ["src/"], deny: [], ownership: "exclusive", sharedKey: null },
    commandPolicy: { allow: ["npm test"], deny: [], network: "deny" },
    expected: { files: ["src/index.ts"], exports: [], tests: [] },
    verify: { gateCommand: null, gateTimeoutSec: null, outputVerificationRequired: true },
    artifactIO: { consumes: [], produces: [] }
  };
  const mockDag = {
    nodes: [mockTask],
    edges: []
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should return valid DAG on first attempt", async () => {
    const mockAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(mockDag),
        stderr: ""
      })
    };
    vi.mocked(getProviderAdapter).mockReturnValue(mockAdapter as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: "test-pkg" }));

    const result = await generateDagWithCodex(objective, cwd);

    expect(result.dag.nodes).toHaveLength(1);
    expect(result.dag.nodes[0]!.taskId).toBe("task-1");
    expect(result.retries).toBe(0);
    expect(result.plannerProvider).toBe("gemini"); // Default first provider
  });

  it("should retry with next provider if first fails with non-zero exit code", async () => {
    const firstAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "Error occurred"
      })
    };
    const secondAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(mockDag),
        stderr: ""
      })
    };

    vi.mocked(getProviderAdapter)
      .mockReturnValueOnce(firstAdapter as any)
      .mockReturnValueOnce(secondAdapter as any);

    const result = await generateDagWithCodex(objective, cwd);

    expect(result.retries).toBe(1);
    expect(result.plannerProvider).toBe("claude"); // Default second provider
    expect(result.dag.nodes).toHaveLength(1);
  });

  it("should retry if first provider returns invalid JSON", async () => {
    const firstAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: "Not JSON",
        stderr: ""
      })
    };
    const secondAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(mockDag),
        stderr: ""
      })
    };

    vi.mocked(getProviderAdapter)
      .mockReturnValueOnce(firstAdapter as any)
      .mockReturnValueOnce(secondAdapter as any);

    const result = await generateDagWithCodex(objective, cwd);

    expect(result.retries).toBe(1);
    expect(result.dag.nodes).toHaveLength(1);
  });

  it("should throw error if all providers fail", async () => {
    const failedAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "Total failure"
      })
    };

    vi.mocked(getProviderAdapter).mockReturnValue(failedAdapter as any);

    await expect(generateDagWithCodex(objective, cwd)).rejects.toThrow(/Planner failed after trying providers/);
  });

  it("should use specified plannerProvider from options", async () => {
    const mockAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(mockDag),
        stderr: ""
      })
    };
    vi.mocked(getProviderAdapter).mockReturnValue(mockAdapter as any);

    const result = await generateDagWithCodex(objective, cwd, [], { plannerProvider: "codex" });

    expect(result.plannerProvider).toBe("codex");
    expect(getProviderAdapter).toHaveBeenCalledWith("codex");
  });

  it("should include package.json content in repo context if available", async () => {
    const mockAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(mockDag),
        stderr: ""
      })
    };
    vi.mocked(getProviderAdapter).mockReturnValue(mockAdapter as any);
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: "my-app", version: "1.0.0" }));

    await generateDagWithCodex(objective, cwd);

    const callArgs = mockAdapter.execute.mock.calls[0]![0] as any;
    expect(callArgs.prompt).toContain("package.json:");
    expect(callArgs.prompt).toContain("my-app");
  });

  it("should include pending tasks in prompt if provided", async () => {
    const mockAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(mockDag),
        stderr: ""
      })
    };
    vi.mocked(getProviderAdapter).mockReturnValue(mockAdapter as any);
    const pendingTasks = [{ taskId: "pending-1" } as any];

    await generateDagWithCodex(objective, cwd, pendingTasks);

    const callArgs = mockAdapter.execute.mock.calls[0]![0] as any;
    expect(callArgs.prompt).toContain("Previously Planned & Pending Tasks");
    expect(callArgs.prompt).toContain("pending-1");
  });

  it("should retry if adapter.execute throws an error", async () => {
    const firstAdapter = {
      execute: vi.fn().mockRejectedValue(new Error("Execution failed"))
    };
    const secondAdapter = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify(mockDag),
        stderr: ""
      })
    };

    vi.mocked(getProviderAdapter)
      .mockReturnValueOnce(firstAdapter as any)
      .mockReturnValueOnce(secondAdapter as any);

    const result = await generateDagWithCodex(objective, cwd);

    expect(result.retries).toBe(1);
    expect(result.dag.nodes).toHaveLength(1);
  });
});