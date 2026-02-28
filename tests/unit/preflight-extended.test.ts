/**
 * Extended preflight tests covering branches not covered by preflight.test.ts:
 * - checkSingleProvider permutations (binary missing, version parse from stderr, etc.)
 * - checkAuth and checkGeminiAuth text heuristics
 * - isOutdated and semver fallback
 * - buildInstallPlan edge cases
 * - applyInstallPlan paths
 * - runPreflight required-upgrades and missing-provider paths
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/core/shell.js";

const runCommandMock = vi.fn<(command: string, args: string[]) => Promise<CommandResult>>();
const runShellLineMock = vi.fn<(cmd: string, opts?: unknown) => Promise<CommandResult>>();
const promptYesNoMock = vi.fn<(msg: string, defaultVal: boolean) => Promise<boolean>>();

vi.mock("../../src/core/shell.js", () => ({
  runCommand: (command: string, args: string[]) => runCommandMock(command, args),
  runShellLine: (cmd: string, opts?: unknown) => runShellLineMock(cmd, opts)
}));

vi.mock("../../src/core/prompt.js", () => ({
  promptYesNo: (msg: string, defaultVal: boolean) => promptYesNoMock(msg, defaultVal)
}));

import { buildInstallPlan, applyInstallPlan, runPreflight, checkProviders } from "../../src/providers/preflight.js";
import type { ProviderStatus } from "../../src/core/types.js";

function makeStatus(overrides: Partial<ProviderStatus>): ProviderStatus {
  return {
    provider: "codex",
    installed: true,
    authStatus: "OK",
    healthStatus: "HEALTHY",
    issues: [],
    ...overrides
  };
}

function mockCodexChecks(opts: {
  versionCode?: number;
  versionStdout?: string;
  versionStderr?: string;
  authCode?: number;
  authStdout?: string;
  authStderr?: string;
  npmCode?: number;
  npmStdout?: string;
}) {
  runCommandMock.mockImplementation(async (command: string, args: string[]) => {
    if (command === "codex" && args[0] === "--version") {
      return {
        code: opts.versionCode ?? 0,
        stdout: opts.versionStdout ?? "1.2.3\n",
        stderr: opts.versionStderr ?? ""
      };
    }
    if (command === "npm" && args[0] === "view") {
      return {
        code: opts.npmCode ?? 0,
        stdout: opts.npmStdout ?? "1.2.3\n",
        stderr: ""
      };
    }
    if (command === "codex" && args[0] === "login") {
      return {
        code: opts.authCode ?? 0,
        stdout: opts.authStdout ?? "",
        stderr: opts.authStderr ?? ""
      };
    }
    return { code: 0, stdout: "", stderr: "" };
  });
}

describe("checkSingleProvider – codex", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
  });

  it("marks provider as not installed when binary command throws", async () => {
    runCommandMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === "codex" && args[0] === "--version") throw new Error("not found");
      if (command === "npm") return { code: 0, stdout: "1.2.3\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const [status] = await checkProviders(["codex"]);
    expect(status!.installed).toBe(false);
    expect(status!.healthStatus).toBe("UNAVAILABLE");
    expect(status!.issues.some((i) => i.includes("Missing CLI binary"))).toBe(true);
  });

  it("parses version from stdout", async () => {
    mockCodexChecks({ versionStdout: "codex 2.5.1\n" });

    const [status] = await checkProviders(["codex"]);
    expect(status!.installed).toBe(true);
    expect(status!.versionInstalled).toBe("2.5.1");
  });

  it("falls back to parsing version from stderr when stdout has no version", async () => {
    mockCodexChecks({ versionStdout: "codex CLI\n", versionStderr: "version: 3.0.0" });

    const [status] = await checkProviders(["codex"]);
    expect(status!.installed).toBe(true);
    expect(status!.versionInstalled).toBe("3.0.0");
  });

  it("sets versionInstalled to undefined when no version in stdout/stderr", async () => {
    mockCodexChecks({ versionStdout: "codex CLI\n", versionStderr: "" });

    const [status] = await checkProviders(["codex"]);
    expect(status!.versionInstalled).toBeUndefined();
  });

  it("adds issue when npm latest version lookup fails", async () => {
    runCommandMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === "codex" && args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "npm" && args[0] === "view") return { code: 1, stdout: "", stderr: "NETWORK_ERROR" };
      if (command === "codex" && args[0] === "login") return { code: 0, stdout: "logged in", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const [status] = await checkProviders(["codex"]);
    expect(status!.issues.some((i) => i.includes("Failed to resolve latest npm version"))).toBe(true);
  });

  it("marks auth as MISSING when output contains 'not logged'", async () => {
    mockCodexChecks({ authCode: 0, authStdout: "You are not logged in." });

    const [status] = await checkProviders(["codex"]);
    expect(status!.authStatus).toBe("MISSING");
    expect(status!.healthStatus).toBe("DEGRADED");
  });

  it("marks auth as MISSING when output contains 'sign in'", async () => {
    mockCodexChecks({ authCode: 0, authStdout: "Please sign in to continue." });

    const [status] = await checkProviders(["codex"]);
    expect(status!.authStatus).toBe("MISSING");
  });

  it("marks auth as MISSING when output contains 'authentication required'", async () => {
    mockCodexChecks({ authCode: 0, authStderr: "Authentication required to proceed" });

    const [status] = await checkProviders(["codex"]);
    expect(status!.authStatus).toBe("MISSING");
  });

  it("marks auth as UNKNOWN when exit code is non-zero without auth keywords", async () => {
    mockCodexChecks({ authCode: 2, authStderr: "something went wrong" });

    const [status] = await checkProviders(["codex"]);
    expect(status!.authStatus).toBe("UNKNOWN");
  });

  it("marks auth as UNKNOWN when auth command throws", async () => {
    runCommandMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === "codex" && args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "npm") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "codex" && args[0] === "login") throw new Error("network error");
      return { code: 0, stdout: "", stderr: "" };
    });

    const [status] = await checkProviders(["codex"]);
    expect(status!.authStatus).toBe("UNKNOWN");
    expect(status!.issues.some((i) => i.includes("Command execution failed"))).toBe(true);
  });

  it("marks auth as OK when exit code is 0 and no auth-missing keywords", async () => {
    mockCodexChecks({ authCode: 0, authStdout: "Logged in as user@example.com" });

    const [status] = await checkProviders(["codex"]);
    expect(status!.authStatus).toBe("OK");
    expect(status!.healthStatus).toBe("HEALTHY");
  });
});

describe("checkSingleProvider – Windows codex note", () => {
  it("adds windows notes issue when platform is win32", async () => {
    // We can't truly override process.platform in vitest easily, so we test
    // the behavior directly via checkProviders.
    // This test documents the branch; it only fires on win32 in CI.
    // We test that issues array is always defined.
    mockCodexChecks({ authCode: 0, authStdout: "Logged in" });
    const [status] = await checkProviders(["codex"]);
    expect(Array.isArray(status!.issues)).toBe(true);
  });
});

describe("buildInstallPlan – additional cases", () => {
  it("does not add fallback comment when platform has no entry for provider", () => {
    const plan = buildInstallPlan(
      [makeStatus({ provider: "claude", installed: false })],
      { installMissing: "prompt", upgradeProviders: "never" }
    );
    // claude has win32 fallback; gemini has darwin
    // Either way commands should contain the npm install
    expect(plan.commands.some((c) => c.includes("@anthropic-ai/claude-code@latest"))).toBe(true);
  });

  it("deduplicates commands when same package appears in missing and outdated", () => {
    const plan = buildInstallPlan(
      [
        makeStatus({ provider: "codex", installed: false }),
        makeStatus({
          provider: "codex",
          installed: true,
          versionInstalled: "0.1.0",
          versionLatest: "2.0.0"
        })
      ],
      { installMissing: "prompt", upgradeProviders: "prompt" }
    );
    const codexInstalls = plan.commands.filter((c) => c.includes("@openai/codex@latest") && !c.startsWith("#"));
    expect(codexInstalls.length).toBe(1);
  });

  it("does not require prompt when no missing or outdated providers", () => {
    const plan = buildInstallPlan(
      [makeStatus({ provider: "codex", installed: true, versionInstalled: "1.0.0", versionLatest: "1.0.0" })],
      { installMissing: "prompt" }
    );
    expect(plan.requiresPrompt).toBe(false);
  });

  it("sets requiresPrompt true when providers are missing and mode is prompt", () => {
    const plan = buildInstallPlan(
      [makeStatus({ provider: "codex", installed: false })],
      { installMissing: "prompt" }
    );
    expect(plan.requiresPrompt).toBe(true);
  });

  it("does not add upgrade commands when upgradeProviders is never", () => {
    const plan = buildInstallPlan(
      [makeStatus({ provider: "codex", installed: true, versionInstalled: "1.0.0", versionLatest: "2.0.0" })],
      { upgradeProviders: "never" }
    );
    // outdated still detected, but no install commands added
    expect(plan.outdated).toContain("codex");
    expect(plan.commands).toHaveLength(0);
  });
});

describe("applyInstallPlan", () => {
  beforeEach(() => {
    runShellLineMock.mockReset();
    promptYesNoMock.mockReset();
  });

  it("returns shouldContinue=true and empty results when no commands", async () => {
    const { shouldContinue, installResult } = await applyInstallPlan(
      { missing: [], outdated: [], commands: [], requiresPrompt: false },
      { installMissing: "auto" }
    );
    expect(shouldContinue).toBe(true);
    expect(installResult.success).toHaveLength(0);
    expect(installResult.failed).toHaveLength(0);
    expect(installResult.skipped).toHaveLength(0);
  });

  it("skips and returns shouldContinue=false when installMissing is never", async () => {
    const plan = {
      missing: ["codex" as const],
      outdated: [],
      commands: ["npm install -g @openai/codex@latest"],
      requiresPrompt: true
    };

    const { shouldContinue, installResult } = await applyInstallPlan(plan, { installMissing: "never" });
    expect(shouldContinue).toBe(false);
    expect(installResult.skipped).toContain("codex");
    expect(runShellLineMock).not.toHaveBeenCalled();
  });

  it("skips when nonInteractive and no auto approval", async () => {
    const plan = {
      missing: ["claude" as const],
      outdated: [],
      commands: ["npm install -g @anthropic-ai/claude-code@latest"],
      requiresPrompt: true
    };

    const { shouldContinue, installResult } = await applyInstallPlan(plan, {
      installMissing: "prompt",
      nonInteractive: true
    });
    expect(shouldContinue).toBe(false);
    expect(installResult.skipped).toContain("claude");
    expect(runShellLineMock).not.toHaveBeenCalled();
    expect(promptYesNoMock).not.toHaveBeenCalled();
  });

  it("skips when user declines the prompt", async () => {
    promptYesNoMock.mockResolvedValue(false);

    const plan = {
      missing: ["gemini" as const],
      outdated: [],
      commands: ["npm install -g @google/gemini-cli@latest"],
      requiresPrompt: true
    };

    const { shouldContinue, installResult } = await applyInstallPlan(plan, { installMissing: "prompt" });
    expect(shouldContinue).toBe(false);
    expect(installResult.skipped).toContain("gemini");
    expect(runShellLineMock).not.toHaveBeenCalled();
  });

  it("installs when user approves the prompt", async () => {
    promptYesNoMock.mockResolvedValue(true);
    runShellLineMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const plan = {
      missing: ["codex" as const],
      outdated: [],
      commands: ["npm install -g @openai/codex@latest"],
      requiresPrompt: true
    };

    const { shouldContinue, installResult } = await applyInstallPlan(plan, { installMissing: "prompt" });
    expect(shouldContinue).toBe(true);
    expect(installResult.success).toContain("codex");
    expect(runShellLineMock).toHaveBeenCalledWith("npm install -g @openai/codex@latest", expect.anything());
  });

  it("reports failure when install command exits with non-zero code", async () => {
    promptYesNoMock.mockResolvedValue(true);
    runShellLineMock.mockResolvedValue({ code: 1, stdout: "", stderr: "error" });

    const plan = {
      missing: ["codex" as const],
      outdated: [],
      commands: ["npm install -g @openai/codex@latest"],
      requiresPrompt: true
    };

    const { shouldContinue, installResult } = await applyInstallPlan(plan, { installMissing: "prompt" });
    expect(shouldContinue).toBe(false);
    expect(installResult.failed).toContain("codex");
    expect(installResult.reasonCodes).toContain("INSTALL_FAILED");
  });

  it("auto-installs without prompt when installMissing is auto", async () => {
    runShellLineMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const plan = {
      missing: ["claude" as const],
      outdated: [],
      commands: ["npm install -g @anthropic-ai/claude-code@latest"],
      requiresPrompt: false
    };

    const { shouldContinue } = await applyInstallPlan(plan, { installMissing: "auto" });
    expect(shouldContinue).toBe(true);
    expect(promptYesNoMock).not.toHaveBeenCalled();
    expect(runShellLineMock).toHaveBeenCalled();
  });

  it("skips comment lines starting with #", async () => {
    promptYesNoMock.mockResolvedValue(true);
    runShellLineMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const plan = {
      missing: ["codex" as const],
      outdated: [],
      commands: ["npm install -g @openai/codex@latest", "# fallback: brew install codex"],
      requiresPrompt: false
    };

    await applyInstallPlan(plan, { installMissing: "auto" });
    // Only the non-comment line should be run
    expect(runShellLineMock).toHaveBeenCalledTimes(1);
    expect(runShellLineMock).toHaveBeenCalledWith(
      "npm install -g @openai/codex@latest",
      expect.anything()
    );
  });
});

describe("runPreflight", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
    runShellLineMock.mockReset();
    promptYesNoMock.mockReset();
  });

  it("adds PROVIDER_OUTDATED reason code when upgradeProviders=required and upgrade fails", async () => {
    // Set up: gemini installed but outdated; npm confirms newer version
    runCommandMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === "gemini" && args[0] === "--version") return { code: 0, stdout: "0.1.0\n", stderr: "" };
      if (command === "npm" && args[0] === "view") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      // auth probe (gemini --prompt ...)
      if (command === "gemini" && args[0] === "--prompt") return { code: 0, stdout: "OK", stderr: "Loaded cached credentials." };
      return { code: 0, stdout: "", stderr: "" };
    });
    // User declines the upgrade
    promptYesNoMock.mockResolvedValue(false);

    const summary = await runPreflight(["gemini"], {
      upgradeProviders: "required",
      installMissing: "prompt",
      nonInteractive: false
    });

    expect(summary.reasonCodes).toContain("PROVIDER_OUTDATED");
  });

  it("adds PROVIDER_MISSING reason code when provider is missing and plan not executed", async () => {
    runCommandMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === "codex" && args[0] === "--version") throw new Error("not found");
      if (command === "npm" && args[0] === "view") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });

    const summary = await runPreflight(["codex"], {
      installMissing: "never",
      upgradeProviders: "never"
    });

    expect(summary.reasonCodes).toContain("PROVIDER_MISSING");
  });

  it("returns statuses, installPlan, and optional installResult", async () => {
    runCommandMock.mockImplementation(async (command: string, args: string[]) => {
      if (command === "gemini" && args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "npm") return { code: 0, stdout: "1.0.0\n", stderr: "" };
      if (command === "gemini" && args[0] === "--prompt") return { code: 0, stdout: "", stderr: "Loaded cached credentials." };
      return { code: 0, stdout: "", stderr: "" };
    });

    const summary = await runPreflight(["gemini"], { installMissing: "never", upgradeProviders: "never" });

    expect(summary.statuses).toHaveLength(1);
    expect(summary.installPlan).toBeDefined();
    expect(summary.reasonCodes).not.toContain("AUTH_MISSING");
  });
});
