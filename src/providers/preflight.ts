import { runCommand, runShellLine } from "../core/shell.js";
import { promptYesNo } from "../core/prompt.js";
import type { InstallPlan, InstallResult, ProviderId, ProviderStatus } from "../core/types.js";
import { REASON_CODES, type ReasonCode } from "../core/reason-codes.js";
import { PROVIDER_SPECS } from "./registry.js";

export interface PreflightOptions {
  installMissing?: "prompt" | "never" | "auto";
  upgradeProviders?: "warn" | "never" | "prompt" | "required";
  nonInteractive?: boolean;
  attemptFixAuth?: boolean;
}

export interface PreflightSummary {
  statuses: ProviderStatus[];
  installPlan: InstallPlan;
  installResult?: InstallResult;
  reasonCodes: ReasonCode[];
}

export async function checkProviders(targetProviders: ProviderId[]): Promise<ProviderStatus[]> {
  const statuses: ProviderStatus[] = [];
  for (const provider of targetProviders) {
    statuses.push(await checkSingleProvider(provider));
  }
  return statuses;
}

async function checkSingleProvider(provider: ProviderId): Promise<ProviderStatus> {
  const spec = PROVIDER_SPECS[provider];
  const issues: string[] = [];

  let installed = false;
  let versionInstalled: string | undefined;

  try {
    const versionResult = await runCommand(spec.binary, spec.versionArgs, { timeoutMs: 20_000 });
    if (versionResult.code === 0) {
      installed = true;
      versionInstalled = parseVersion(versionResult.stdout) ?? parseVersion(versionResult.stderr) ?? undefined;
    }
  } catch {
    installed = false;
  }

  const versionLatest = await lookupLatestVersion(spec.npmPackage);
  if (!versionLatest) {
    issues.push(`Failed to resolve latest npm version for ${spec.npmPackage}`);
  }

  if (!installed) {
    issues.push(`Missing CLI binary: ${spec.binary}`);
    return {
      provider,
      installed,
      versionLatest,
      authStatus: "UNKNOWN",
      healthStatus: "UNAVAILABLE",
      issues
    };
  }

  const authResult = await checkAuth(provider);
  if (authResult.status === "MISSING") {
    issues.push(`Authentication required. Run: ${spec.authFixCommand}`);
    if (authResult.detail) {
      issues.push(`Details: ${authResult.detail}`);
    }
  } else if (authResult.status === "UNKNOWN") {
    issues.push(`Authentication status unknown: ${authResult.detail ?? "check timed out or failed"}`);
  }

  if (provider === "codex" && process.platform === "win32") {
    issues.push(spec.windowsNotes ?? "Codex may be less stable on native Windows.");
  }

  return {
    provider,
    installed,
    versionInstalled,
    versionLatest,
    authStatus: authResult.status,
    healthStatus: authResult.status === "OK" ? "HEALTHY" : "DEGRADED",
    issues
  };
}

async function lookupLatestVersion(npmPackage: string): Promise<string | undefined> {
  try {
    const result = await runCommand("npm", ["view", npmPackage, "version"], { timeoutMs: 20_000 });
    if (result.code !== 0) {
      return undefined;
    }
    const parsed = result.stdout.trim();
    return parsed || undefined;
  } catch {
    return undefined;
  }
}

interface AuthCheckResult {
  status: "OK" | "MISSING" | "UNKNOWN";
  detail?: string;
}

async function checkAuth(provider: ProviderId): Promise<AuthCheckResult> {
  if (provider === "gemini") {
    return checkGeminiAuth();
  }

  const command = PROVIDER_SPECS[provider].authCheckCommand;
  if (!command || command.length === 0) {
    return { status: "UNKNOWN", detail: "No auth check command defined" };
  }

  try {
    const result = await runCommand(PROVIDER_SPECS[provider].binary, command, { timeoutMs: 20_000 });
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (text.includes("not logged") || text.includes("sign in") || text.includes("authentication required")) {
      return { status: "MISSING", detail: result.stderr.trim() || result.stdout.trim() };
    }
    if (result.code !== 0) {
      return { status: "UNKNOWN", detail: `Exit code ${result.code}: ${result.stderr.trim()}` };
    }
    return { status: "OK" };
  } catch (err) {
    return { status: "UNKNOWN", detail: (err as Error).message };
  }
}

async function checkGeminiAuth(): Promise<AuthCheckResult> {
  try {
    const result = await runCommand(
      "gemini",
      ["--prompt", "Reply with OK.", "--output-format", "json", "--approval-mode", "plan"],
      { timeoutMs: 20_000 }
    );
    const text = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (isGeminiAuthMissingText(text)) {
      return { status: "MISSING", detail: result.stderr.trim() || result.stdout.trim() };
    }
    if (isGeminiAuthConfirmedText(text)) {
      return { status: "OK" };
    }
    return result.code === 0
      ? { status: "OK" }
      : { status: "UNKNOWN", detail: `Exit code ${result.code}: ${result.stderr.trim()}` };
  } catch (err) {
    return { status: "UNKNOWN", detail: (err as Error).message };
  }
}

function isGeminiAuthMissingText(text: string): boolean {
  return [
    "authentication required",
    "login required",
    "run: gemini",
    "not logged",
    "sign in",
    "api key",
    "no active credentials"
  ].some((token) => text.includes(token));
}

function isGeminiAuthConfirmedText(text: string): boolean {
  return [
    "loaded cached credentials",
    "logged in with google",
    "authentication succeeded"
  ].some((token) => text.includes(token));
}

function parseVersion(text: string): string | null {
  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/);
  return match?.[1] ?? null;
}

function isOutdated(status: ProviderStatus): boolean {
  return Boolean(status.installed && status.versionInstalled && status.versionLatest && status.versionInstalled !== status.versionLatest);
}

function sortUnique(commands: string[]): string[] {
  return [...new Set(commands)];
}

export function buildInstallPlan(statuses: ProviderStatus[], options: PreflightOptions = {}): InstallPlan {
  const missing = statuses.filter((status) => !status.installed).map((status) => status.provider);
  const outdated = statuses.filter((status) => isOutdated(status)).map((status) => status.provider);

  const commands: string[] = [];
  for (const provider of missing) {
    const spec = PROVIDER_SPECS[provider];
    commands.push(`npm install -g ${spec.npmPackage}@latest`);
    const fallback = spec.installFallbackByOs[process.platform as "win32" | "darwin" | "linux"];
    if (fallback) {
      commands.push(`# fallback: ${fallback}`);
    }
  }

  if (options.upgradeProviders && options.upgradeProviders !== "never") {
    for (const provider of outdated) {
      const spec = PROVIDER_SPECS[provider];
      commands.push(`npm install -g ${spec.npmPackage}@latest`);
    }
  }

  const requiresPrompt =
    (missing.length > 0 || outdated.length > 0) &&
    (options.installMissing ?? "prompt") === "prompt";

  return {
    missing,
    outdated,
    commands: sortUnique(commands),
    requiresPrompt
  };
}

async function performInstallCommands(commands: string[]): Promise<boolean> {
  for (const command of commands) {
    if (command.startsWith("#")) {
      continue;
    }
    const result = await runShellLine(command, { timeoutMs: 180_000 });
    if (result.code !== 0) {
      return false;
    }
  }
  return true;
}

export async function applyInstallPlan(
  plan: InstallPlan,
  options: PreflightOptions = {}
): Promise<{ installResult: InstallResult; shouldContinue: boolean }> {
  const installMode = options.installMissing ?? "prompt";

  if (plan.commands.length === 0) {
    return {
      installResult: {
        success: [],
        failed: [],
        skipped: [],
        reasonCodes: []
      },
      shouldContinue: true
    };
  }

  let approved = installMode === "auto";
  if (installMode === "never") {
    return {
      installResult: {
        success: [],
        failed: [],
        skipped: [...plan.missing, ...plan.outdated],
        reasonCodes: [REASON_CODES.PROVIDER_MISSING]
      },
      shouldContinue: false
    };
  }

  if (!approved) {
    if (options.nonInteractive) {
      return {
        installResult: {
          success: [],
          failed: [],
          skipped: [...plan.missing, ...plan.outdated],
          reasonCodes: [REASON_CODES.PROVIDER_MISSING]
        },
        shouldContinue: false
      };
    }
    const message = `Install/upgrade provider CLIs now?\n${plan.commands.join("\n")}`;
    approved = await promptYesNo(message, false);
  }

  if (!approved) {
    return {
      installResult: {
        success: [],
        failed: [],
        skipped: [...plan.missing, ...plan.outdated],
        reasonCodes: [REASON_CODES.PROVIDER_MISSING]
      },
      shouldContinue: false
    };
  }

  const ok = await performInstallCommands(plan.commands);

  return {
    installResult: {
      success: ok ? [...plan.missing, ...plan.outdated] : [],
      failed: ok ? [] : [...plan.missing, ...plan.outdated],
      skipped: [],
      reasonCodes: ok ? [] : [REASON_CODES.INSTALL_FAILED]
    },
    shouldContinue: ok
  };
}

export async function runPreflight(
  providers: ProviderId[],
  options: PreflightOptions = {}
): Promise<PreflightSummary> {
  const statuses = await checkProviders(providers);
  const plan = buildInstallPlan(statuses, options);
  const reasonCodes: ReasonCode[] = [];
  const missingAuthProviders = statuses.filter((status) => status.authStatus === "MISSING").map((status) => status.provider);
  if (missingAuthProviders.length > 0) {
    reasonCodes.push(REASON_CODES.AUTH_MISSING);
  }

  let installResult: InstallResult | undefined;
  if (plan.commands.length > 0) {
    if (options.upgradeProviders === "required" && plan.outdated.length > 0) {
      const installOutcome = await applyInstallPlan(plan, {
        ...options,
        installMissing: options.installMissing ?? "prompt"
      });
      installResult = installOutcome.installResult;
      if (!installOutcome.shouldContinue) {
        reasonCodes.push(REASON_CODES.PROVIDER_OUTDATED);
      }
    } else if (plan.missing.length > 0 || options.upgradeProviders === "prompt" || options.installMissing === "auto") {
      const installOutcome = await applyInstallPlan(plan, options);
      installResult = installOutcome.installResult;
      if (!installOutcome.shouldContinue) {
        reasonCodes.push(REASON_CODES.PROVIDER_MISSING);
      }
    }
  }

  return {
    statuses,
    installPlan: plan,
    installResult,
    reasonCodes
  };
}
