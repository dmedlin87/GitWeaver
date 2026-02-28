import { describe, it, expect } from "vitest";
import { extractJsonPayload } from "../../src/planning/planner-codex.js";

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
});