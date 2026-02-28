import { describe, expect, it } from "vitest";
import { providerList, PROVIDER_SPECS } from "../../src/providers/registry.js";

describe("providerList", () => {
  it("returns all three providers", () => {
    expect(providerList()).toEqual(["codex", "claude", "gemini"]);
  });

  it("returns a new array each call", () => {
    const a = providerList();
    const b = providerList();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe("PROVIDER_SPECS", () => {
  it("has entries for all three providers", () => {
    expect(Object.keys(PROVIDER_SPECS)).toEqual(["codex", "claude", "gemini"]);
  });

  it("codex spec has correct npm package", () => {
    expect(PROVIDER_SPECS.codex.npmPackage).toBe("@openai/codex");
    expect(PROVIDER_SPECS.codex.binary).toBe("codex");
  });

  it("claude spec has correct npm package", () => {
    expect(PROVIDER_SPECS.claude.npmPackage).toBe("@anthropic-ai/claude-code");
    expect(PROVIDER_SPECS.claude.binary).toBe("claude");
  });

  it("gemini spec has correct npm package", () => {
    expect(PROVIDER_SPECS.gemini.npmPackage).toBe("@google/gemini-cli");
    expect(PROVIDER_SPECS.gemini.binary).toBe("gemini");
  });

  it("all specs have authFixCommand", () => {
    for (const spec of Object.values(PROVIDER_SPECS)) {
      expect(typeof spec.authFixCommand).toBe("string");
      expect(spec.authFixCommand.length).toBeGreaterThan(0);
    }
  });

  it("all specs have versionArgs array", () => {
    for (const spec of Object.values(PROVIDER_SPECS)) {
      expect(Array.isArray(spec.versionArgs)).toBe(true);
    }
  });
});
