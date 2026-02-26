import { describe, expect, it } from "vitest";
import { buildInstallPlan } from "../../src/providers/preflight.js";

describe("buildInstallPlan", () => {
  it("plans install for missing providers", () => {
    const plan = buildInstallPlan(
      [
        {
          provider: "codex",
          installed: false,
          authStatus: "UNKNOWN",
          healthStatus: "UNAVAILABLE",
          issues: ["missing"]
        }
      ],
      {
        installMissing: "prompt",
        upgradeProviders: "warn"
      }
    );

    expect(plan.missing).toEqual(["codex"]);
    expect(plan.commands[0]).toContain("@openai/codex@latest");
  });

  it("plans upgrades for outdated providers", () => {
    const plan = buildInstallPlan(
      [
        {
          provider: "claude",
          installed: true,
          versionInstalled: "1.0.0",
          versionLatest: "2.0.0",
          authStatus: "OK",
          healthStatus: "HEALTHY",
          issues: []
        }
      ],
      {
        installMissing: "prompt",
        upgradeProviders: "prompt"
      }
    );

    expect(plan.outdated).toEqual(["claude"]);
    expect(plan.commands.join("\n")).toContain("@anthropic-ai/claude-code@latest");
  });
});