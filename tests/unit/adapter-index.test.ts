import { describe, expect, it } from "vitest";
import { getProviderAdapter } from "../../src/providers/adapters/index.js";
import { CodexAdapter } from "../../src/providers/adapters/codex.js";
import { ClaudeAdapter } from "../../src/providers/adapters/claude.js";
import { GeminiAdapter } from "../../src/providers/adapters/gemini.js";

describe("getProviderAdapter", () => {
  it("returns a CodexAdapter for codex", () => {
    const adapter = getProviderAdapter("codex");
    expect(adapter).toBeInstanceOf(CodexAdapter);
    expect(adapter.provider).toBe("codex");
  });

  it("returns a ClaudeAdapter for claude", () => {
    const adapter = getProviderAdapter("claude");
    expect(adapter).toBeInstanceOf(ClaudeAdapter);
    expect(adapter.provider).toBe("claude");
  });

  it("returns a GeminiAdapter for gemini", () => {
    const adapter = getProviderAdapter("gemini");
    expect(adapter).toBeInstanceOf(GeminiAdapter);
    expect(adapter.provider).toBe("gemini");
  });

  it("returns the same singleton instance on repeated calls", () => {
    expect(getProviderAdapter("codex")).toBe(getProviderAdapter("codex"));
    expect(getProviderAdapter("claude")).toBe(getProviderAdapter("claude"));
    expect(getProviderAdapter("gemini")).toBe(getProviderAdapter("gemini"));
  });
});
