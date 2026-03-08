import type { Command } from "commander";
import type { ProviderId } from "../../core/types.js";
import { printJson } from "../../core/orchestrator.js";
import { applyInstallPlan, buildInstallPlan, checkProviders } from "../../providers/preflight.js";
import { providerList, PROVIDER_SPECS } from "../../providers/registry.js";
import { runShellLine } from "../../core/shell.js";

interface ProvidersCheckOptions {
  json?: boolean;
  providers?: string;
}

interface ProvidersInstallOptions {
  providers?: string;
  yes?: boolean;
  json?: boolean;
}

interface ProvidersAuthOptions {
  provider?: ProviderId;
  fix?: boolean;
  json?: boolean;
}

export function registerProvidersCommand(program: Command): void {
  const providers = program.command("providers").description("provider readiness commands");

  providers
    .command("check")
    .option("--providers <csv>", "comma-separated provider list")
    .option("--json", "print JSON output")
    .action(async (opts: ProvidersCheckOptions) => {
      const target = parseProviders(opts.providers);
      const statuses = await checkProviders(target);
      if (opts.json) {
        printJson({ statuses });
        return;
      }
      for (const status of statuses) {
        console.log(`${status.provider}: installed=${status.installed} auth=${status.authStatus} installedVersion=${status.versionInstalled ?? "n/a"} latest=${status.versionLatest ?? "n/a"}`);
        for (const issue of status.issues) {
          console.log(`  - ${issue}`);
        }
      }
    });

  providers
    .command("install")
    .option("--providers <csv>", "comma-separated provider list")
    .option("--yes", "auto-approve install")
    .option("--json", "print JSON output")
    .action(async (opts: ProvidersInstallOptions) => {
      const target = parseProviders(opts.providers);
      const statuses = await checkProviders(target);
      const plan = buildInstallPlan(statuses, {
        installMissing: opts.yes ? "auto" : "prompt",
        upgradeProviders: "prompt",
        nonInteractive: !process.stdin.isTTY
      });

      const outcome = await applyInstallPlan(plan, {
        installMissing: opts.yes ? "auto" : "prompt",
        nonInteractive: !process.stdin.isTTY
      });

      const payload = {
        statuses,
        plan,
        outcome
      };

      if (opts.json) {
        printJson(payload);
        return;
      }
      console.log(JSON.stringify(payload, null, 2));
      if (!outcome.shouldContinue) {
        process.exitCode = 1;
      }
    });

  providers
    .command("auth")
    .option("--provider <provider>", "codex|claude|gemini")
    .option("--fix", "run auth remediation command for missing providers")
    .option("--json", "print JSON output")
    .action(async (opts: ProvidersAuthOptions) => {
      const target = opts.provider ? [opts.provider] : providerList();
      const statuses = await checkProviders(target);
      const missing = statuses.filter((status) => status.authStatus === "MISSING");

      const fixResults: Array<{ provider: ProviderId; command: string; code: number; stderr: string }> = [];
      if (opts.fix) {
        for (const status of missing) {
          const command = PROVIDER_SPECS[status.provider].authFixCommand;
          const result = await runShellLine(command);
          fixResults.push({
            provider: status.provider,
            command,
            code: result.code,
            stderr: result.stderr
          });
        }
      }

      const payload = {
        statuses,
        missing: missing.map((status) => ({ provider: status.provider, remediation: PROVIDER_SPECS[status.provider].authFixCommand })),
        fixResults
      };

      if (opts.json) {
        printJson(payload);
        return;
      }

      console.log(JSON.stringify(payload, null, 2));
      if (missing.length > 0 && !opts.fix) {
        process.exitCode = 1;
      }
    });
}

function parseProviders(input?: string): ProviderId[] {
  if (!input) {
    return providerList();
  }
  const candidates = input
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const valid = providerList();
  const parsed: ProviderId[] = [];

  for (const candidate of candidates) {
    if (!valid.includes(candidate as ProviderId)) {
      throw new Error(`Invalid provider: '${candidate}'. Allowed values are: ${valid.join(', ')}.`);
    }
    parsed.push(candidate as ProviderId);
  }

  return parsed;
}
