import type { Command } from "commander";
import { Orchestrator, printJson, type ProgressUpdate } from "../../core/orchestrator.js";
import { maybeBootstrapRepo, type BootstrapTemplate } from "../repo-bootstrap.js";
import type { ProviderId } from "../../core/types.js";

interface RunOptions {
  concurrency?: number;
  dryRun?: boolean;
  dryRunReport?: "basic" | "detailed";
  config?: string;
  repo?: string;
  allowBaselineRepair?: boolean;
  acceptDrift?: boolean;
  executionMode?: "host" | "container";
  containerRuntime?: "docker" | "podman";
  containerImage?: string;
  plannerProvider?: ProviderId;
  forceModel?: ProviderId;
  devMode?: boolean;
  installMissing?: "prompt" | "never" | "auto";
  upgradeProviders?: "warn" | "never" | "prompt" | "required";
  nonInteractive?: boolean;
  json?: boolean;
  bootstrap?: boolean;
  bootstrapTemplate?: BootstrapTemplate;
}

export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .argument("<prompt>", "objective prompt")
    .option("--concurrency <n>", "maximum concurrent tasks", parseInteger)
    .option("--dry-run", "plan and audit without execution")
    .option("--dry-run-report <mode>", "basic|detailed", "detailed")
    .option("--config <path>", "config JSON path")
    .option("--repo <path>", "repository root override")
    .option("--allow-baseline-repair", "continue when baseline gate fails")
    .option("--accept-drift", "accept baseline drift on resume/integration")
    .option("--execution-mode <mode>", "host|container")
    .option("--container-runtime <runtime>", "docker|podman")
    .option("--container-image <image>", "container image for provider/gate execution")
    .option("--planner-provider <provider>", "codex|claude|gemini", parsePlannerProvider)
    .option("--force-model <provider>", "codex|claude|gemini — override routing for all tasks", parseForceModel)
    .option("--dev-mode", "force all task routing to gemini (preserves high-tier quota during development)")
    .option("--install-missing <mode>", "prompt|never|auto", "prompt")
    .option("--upgrade-providers <mode>", "warn|never|prompt|required", "warn")
    .option("--non-interactive", "disable interactive prompts")
    .option("--bootstrap", "create/init repository before running")
    .option("--bootstrap-template <template>", "blank|web-game-ts", parseBootstrapTemplate, "blank")
    .option("--json", "print JSON outcome")
    .action(async (prompt: string, opts: RunOptions) => {
      const bootstrapResult = opts.bootstrap
        ? await maybeBootstrapRepo({
            repo: opts.repo,
            bootstrap: opts.bootstrap,
            bootstrapTemplate: opts.bootstrapTemplate
          })
        : undefined;

      if (bootstrapResult && !opts.json) {
        const createdCount = bootstrapResult.createdFiles.length;
        process.stderr.write(
          `Bootstrap ready: repo=${bootstrapResult.repoPath}, gitInit=${bootstrapResult.initializedGit}, filesCreated=${createdCount}, initialCommit=${bootstrapResult.createdInitialCommit}\n`
        );
      }

      const orchestrator = new Orchestrator();
      const onProgress = opts.json ? undefined : (update: ProgressUpdate) => {
        const tags = [update.stage];
        if (update.taskId) {
          tags.push(update.taskId);
        }
        if (update.provider) {
          tags.push(update.provider);
        }
        process.stderr.write(`[${update.ts}] ${update.runId} | ${tags.join(" | ")}: ${update.message}\n`);
      };
      const result = await orchestrator.run({
        prompt,
        concurrency: opts.concurrency,
        dryRun: opts.dryRun,
        config: opts.config,
        repo: opts.repo,
        allowBaselineRepair: opts.allowBaselineRepair,
        acceptDrift: opts.acceptDrift,
        executionMode: opts.executionMode,
        containerRuntime: opts.containerRuntime,
        containerImage: opts.containerImage,
        plannerProvider: opts.plannerProvider,
        forceModel: opts.devMode ? "gemini" : opts.forceModel,
        dryRunReport: opts.dryRunReport,
        installMissing: opts.installMissing,
        upgradeProviders: opts.upgradeProviders,
        nonInteractive: opts.nonInteractive,
        onProgress
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
    throw new Error(`Invalid integer value: '${value}'. Must be a positive number.`);
  }
  return parsed;
}

function parseBootstrapTemplate(value: string): BootstrapTemplate {
  if (value === "blank" || value === "web-game-ts") {
    return value;
  }
  throw new Error(`Invalid bootstrap template: '${value}'. Allowed values are: blank, web-game-ts.`);
}

function parsePlannerProvider(value: string): ProviderId {
  if (value === "codex" || value === "claude" || value === "gemini") {
    return value;
  }
  throw new Error(`Invalid planner provider: '${value}'. Allowed values are: codex, claude, gemini.`);
}

function parseForceModel(value: string): ProviderId {
  if (value === "codex" || value === "claude" || value === "gemini") {
    return value;
  }
  throw new Error(`Invalid force-model provider: '${value}'. Allowed values are: codex, claude, gemini.`);
}
