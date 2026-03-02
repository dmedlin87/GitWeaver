import type { Command } from "commander";
import { Orchestrator, printJson } from "../../core/orchestrator.js";

interface LocksOptions {
  json?: boolean;
}

export function registerLocksCommand(program: Command): void {
  program
    .command("locks")
    .argument("<runId>", "run identifier")
    .option("--json", "print JSON output")
    .action(async (runId: string, opts: LocksOptions) => {
      const orchestrator = new Orchestrator();
      const payload = await orchestrator.locks(runId);
      if (opts.json) {
        printJson(payload);
        return;
      }
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    });
}