import type { Command } from "commander";
import { Orchestrator, printJson } from "../../core/orchestrator.js";

interface ResumeOptions {
  acceptDrift?: boolean;
  json?: boolean;
}

export function registerResumeCommand(program: Command): void {
  program
    .command("resume")
    .argument("<runId>", "run identifier")
    .option("--accept-drift", "accept baseline drift and continue")
    .option("--json", "print JSON outcome")
    .action(async (runId: string, opts: ResumeOptions) => {
      const orchestrator = new Orchestrator();
      const result = await orchestrator.resume(runId, Boolean(opts.acceptDrift));
      if (opts.json) {
        printJson(result);
        return;
      }
      console.log(JSON.stringify(result, null, 2));
    });
}