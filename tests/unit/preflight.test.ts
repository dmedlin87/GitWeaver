import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/core/shell.js";

const runCommandMock = vi.fn<(command: string, args: string[]) => Promise<CommandResult>>();

vi.mock("../../src/core/shell.js", () => ({
  runCommand: (command: string, args: string[]) => runCommandMock(command, args),
  runShellLine: vi.fn()
}));

vi.mock("../../src/core/prompt.js", () => ({
  promptYesNo: vi.fn(async () => false)
}));

import { buildInstallPlan, runPreflight } from "../../src/providers/preflight.js";

describe("buildInstallPlan", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
  });

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

  it("adds AUTH_MISSING when provider auth is missing", async () => {
    mockGeminiChecks({
      authCode: 0,
      authStderr: "Authentication required. Run: gemini"
    });

    const summary = await runPreflight(["gemini"], {
      installMissing: "never",
      upgradeProviders: "never",
      nonInteractive: true
    });

    expect(summary.statuses[0]?.authStatus).toBe("MISSING");
    expect(summary.reasonCodes).toContain("AUTH_MISSING");
  });

  it("does not add AUTH_MISSING for UNKNOWN auth", async () => {
    mockGeminiChecks({
      authCode: 1,
      authStderr: "probe timed out"
    });

    const summary = await runPreflight(["gemini"], {
      installMissing: "never",
      upgradeProviders: "never",
      nonInteractive: true
    });

    expect(summary.statuses[0]?.authStatus).toBe("UNKNOWN");
    expect(summary.reasonCodes).not.toContain("AUTH_MISSING");
  });

  it("treats cached credentials output as authenticated for gemini", async () => {
    mockGeminiChecks({
      authCode: 1,
      authStderr: "Loaded cached credentials."
    });

    const summary = await runPreflight(["gemini"], {
      installMissing: "never",
      upgradeProviders: "never",
      nonInteractive: true
    });

    expect(summary.statuses[0]?.authStatus).toBe("OK");
    expect(summary.reasonCodes).not.toContain("AUTH_MISSING");
  });
});

interface GeminiProbeOptions {
  authCode: number;
  authStdout?: string;
  authStderr?: string;
}

function mockGeminiChecks(options: GeminiProbeOptions): void {
  runCommandMock.mockImplementation(async (command: string, args: string[]) => {
    if (command === "gemini" && args.length === 1 && args[0] === "--version") {
      return {
        code: 0,
        stdout: "0.30.0\n",
        stderr: ""
      };
    }

    if (command === "npm" && args[0] === "view") {
      return {
        code: 0,
        stdout: "0.30.0\n",
        stderr: ""
      };
    }

    if (command === "gemini" && args[0] === "--prompt") {
      return {
        code: options.authCode,
        stdout: options.authStdout ?? "",
        stderr: options.authStderr ?? ""
      };
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });
}
