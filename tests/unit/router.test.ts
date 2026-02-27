import { describe, expect, it } from "vitest";
import { routeTask } from "../../src/providers/router.js";

describe("routeTask", () => {
  it("routes code tasks to claude by default", () => {
    const decision = routeTask("code", {});
    expect(decision.provider).toBe("claude");
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
});
