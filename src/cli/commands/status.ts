import type { Command } from "commander";
import { Orchestrator, printJson } from "../../core/orchestrator.js";

interface StatusOptions {
  json?: boolean;
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status")
    .argument("<runId>", "run identifier")
    .option("--json", "print JSON output")
    .action(async (runId: string, opts: StatusOptions) => {
      const orchestrator = new Orchestrator();
      const status = await orchestrator.status(runId);
      if (opts.json) {
        printJson(status);
        return;
      }
      process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    });
}