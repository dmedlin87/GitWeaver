import type { Command } from "commander";
import { Orchestrator, printJson } from "../../core/orchestrator.js";

interface RunOptions {
  concurrency?: number;
  dryRun?: boolean;
  config?: string;
  repo?: string;
  allowBaselineRepair?: boolean;
  acceptDrift?: boolean;
  installMissing?: "prompt" | "never" | "auto";
  upgradeProviders?: "warn" | "never" | "prompt" | "required";
  nonInteractive?: boolean;
  json?: boolean;
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .argument("<prompt>", "objective prompt")
    .option("--concurrency <n>", "maximum concurrent tasks", parseInteger)
    .option("--dry-run", "plan and audit without execution")
    .option("--config <path>", "config JSON path")
    .option("--repo <path>", "repository root override")
    .option("--allow-baseline-repair", "continue when baseline gate fails")
    .option("--accept-drift", "accept baseline drift on resume/integration")
    .option("--install-missing <mode>", "prompt|never|auto", "prompt")
    .option("--upgrade-providers <mode>", "warn|never|prompt|required", "warn")
    .option("--non-interactive", "disable interactive prompts")
    .option("--json", "print JSON outcome")
    .action(async (prompt: string, opts: RunOptions) => {
      const orchestrator = new Orchestrator();
      const result = await orchestrator.run({
        prompt,
        concurrency: opts.concurrency,
        dryRun: opts.dryRun,
        config: opts.config,
        repo: opts.repo,
        allowBaselineRepair: opts.allowBaselineRepair,
        acceptDrift: opts.acceptDrift,
        installMissing: opts.installMissing,
        upgradeProviders: opts.upgradeProviders,
        nonInteractive: opts.nonInteractive
      });

      if (opts.json) {
        printJson(result);
        return;
      }

      console.log(`runId: ${result.runId}`);
      console.log(`state: ${result.state}`);
      if (result.reasonCode) {
        console.log(`reasonCode: ${result.reasonCode}`);
      }
      console.log(JSON.stringify(result.summary, null, 2));
      if (result.state !== "COMPLETED") {
        process.exitCode = 1;
      }
    });
}

function parseInteger(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}