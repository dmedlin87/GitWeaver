import { describe, expect, it } from "vitest";
import { rerouteOnDegradation, routeExecutionFallback, routeTask } from "../../src/providers/router.js";

describe("routeTask", () => {
  it("routes code tasks to claude by default", () => {
    const decision = routeTask("code", {});
    expect(decision.provider).toBe("claude");
  });

  it("routes refactor tasks to claude", () => {
    const decision = routeTask("refactor", {});
    expect(decision.provider).toBe("claude");
  });

  it("routes test tasks to claude", () => {
    const decision = routeTask("test", {});
    expect(decision.provider).toBe("claude");
  });

  it("routes deps tasks to claude", () => {
    const decision = routeTask("deps", {});
    expect(decision.provider).toBe("claude");
  });

  it("routes ui tasks to gemini", () => {
    const decision = routeTask("ui", {});
    expect(decision.provider).toBe("gemini");
  });

  it("routes multimodal tasks to gemini", () => {
    const decision = routeTask("multimodal", {});
    expect(decision.provider).toBe("gemini");
  });

  it("routes plan tasks to codex", () => {
    const decision = routeTask("plan", {});
    expect(decision.provider).toBe("codex");
  });

  it("routes audit tasks to codex", () => {
    const decision = routeTask("audit", {});
    expect(decision.provider).toBe("codex");
  });

  it("routes repair tasks to codex", () => {
    const decision = routeTask("repair", {});
    expect(decision.provider).toBe("codex");
  });

  it("falls back when provider is degraded", () => {
    const decision = routeTask("code", {
      claude: { provider: "claude", score: 10, lastErrors: ["429"], tokenBucket: 0 },
      codex: { provider: "codex", score: 90, lastErrors: [], tokenBucket: 1 }
    });
    expect(decision.provider).toBe("codex");
    expect(decision.fallbackReason).toContain("degraded");
  });

  it("falls back while preferred provider is in cooldown", () => {
    const decision = routeTask("code", {
      claude: {
        provider: "claude",
        score: 80,
        lastErrors: ["timeout"],
        tokenBucket: 1,
        cooldownUntil: new Date(Date.now() + 10_000).toISOString()
      },
      codex: { provider: "codex", score: 90, lastErrors: [], tokenBucket: 1 }
    });
    expect(decision.provider).toBe("codex");
    expect(decision.fallbackReason).toContain("degraded");
  });

  it("returns provider with highest fallback priority when multiple fallbacks are available", () => {
    const decision = routeTask("code", {
      claude: { provider: "claude", score: 10, lastErrors: ["429"], tokenBucket: 0 },
      codex: { provider: "codex", score: 90, lastErrors: [], tokenBucket: 1 },
      gemini: { provider: "gemini", score: 95, lastErrors: [], tokenBucket: 1 }
    });
    // FALLBACK_ORDER for claude is ["codex", "gemini"], so codex wins
    expect(decision.provider).toBe("codex");
  });

  it("returns primary provider when all fallbacks are also degraded", () => {
    const decision = routeTask("code", {
      claude: { provider: "claude", score: 10, lastErrors: ["429"], tokenBucket: 0 },
      codex: { provider: "codex", score: 10, lastErrors: ["429"], tokenBucket: 0 },
      gemini: { provider: "gemini", score: 10, lastErrors: ["429"], tokenBucket: 0 }
    });
    expect(decision.provider).toBe("claude");
    expect(decision.fallbackReason).toContain("No healthy fallback");
  });

  it("falls back from gemini when degraded for ui tasks", () => {
    const decision = routeTask("ui", {
      gemini: { provider: "gemini", score: 10, lastErrors: ["429"], tokenBucket: 0 },
      claude: { provider: "claude", score: 90, lastErrors: [], tokenBucket: 1 }
    });
    expect(decision.provider).toBe("claude");
    expect(decision.fallbackReason).toContain("degraded");
  });

  it("falls back from codex when degraded for plan tasks", () => {
    const decision = routeTask("plan", {
      codex: { provider: "codex", score: 10, lastErrors: ["429"], tokenBucket: 0 },
      claude: { provider: "claude", score: 90, lastErrors: [], tokenBucket: 1 }
    });
    expect(decision.provider).toBe("claude");
    expect(decision.fallbackReason).toContain("degraded");
  });
});

describe("rerouteOnDegradation", () => {
  it("returns null when current provider is healthy", () => {
    const result = rerouteOnDegradation(
      { type: "code", provider: "claude" },
      { claude: { provider: "claude", score: 90, lastErrors: [], tokenBucket: 2 } }
    );
    expect(result).toBeNull();
  });

  it("returns a routing decision to fallback when current provider is degraded by score", () => {
    const result = rerouteOnDegradation(
      { type: "code", provider: "claude" },
      {
        claude: { provider: "claude", score: 10, lastErrors: ["429"], tokenBucket: 0 },
        codex: { provider: "codex", score: 90, lastErrors: [], tokenBucket: 1 }
      }
    );
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
    expect(result!.fallbackReason).toContain("degraded");
  });

  it("returns a routing decision to fallback when current provider is in cooldown", () => {
    const result = rerouteOnDegradation(
      { type: "code", provider: "claude" },
      {
        claude: {
          provider: "claude",
          score: 80,
          lastErrors: [],
          tokenBucket: 1,
          cooldownUntil: new Date(Date.now() + 30_000).toISOString()
        },
        codex: { provider: "codex", score: 90, lastErrors: [], tokenBucket: 1 }
      }
    );
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("codex");
  });

  it("returns null for health map with no info about current provider (treat as healthy)", () => {
    const result = rerouteOnDegradation(
      { type: "code", provider: "claude" },
      {}
    );
    expect(result).toBeNull();
  });
});

describe("routeExecutionFallback", () => {
  it("returns claude as first fallback when gemini fails", () => {
    const decision = routeExecutionFallback("gemini", {
      claude: { provider: "claude", score: 90, lastErrors: [], tokenBucket: 1 },
      codex: { provider: "codex", score: 85, lastErrors: [], tokenBucket: 1 }
    }, "tool not found");
    expect(decision).not.toBeNull();
    expect(decision!.provider).toBe("claude");
    expect(decision!.fallbackProvider).toBe("gemini");
  });

  it("returns null when no healthy fallback exists", () => {
    const decision = routeExecutionFallback("gemini", {
      claude: { provider: "claude", score: 20, lastErrors: ["429"], tokenBucket: 0 },
      codex: { provider: "codex", score: 10, lastErrors: ["429"], tokenBucket: 0 }
    }, "tool not found");
    expect(decision).toBeNull();
  });
});
