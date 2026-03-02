import type { Command } from "commander";
import { Orchestrator, printJson } from "../../core/orchestrator.js";

interface InspectOptions {
  task?: string;
  json?: boolean;
}

export function registerInspectCommand(program: Command): void {
  program
    .command("inspect")
    .argument("<runId>", "run identifier")
    .option("--task <taskId>", "filter events by task id")
    .option("--json", "print JSON output")
    .action(async (runId: string, opts: InspectOptions) => {
      const orchestrator = new Orchestrator();
      const inspect = await orchestrator.inspect(runId, opts.task);
      if (opts.json) {
        printJson(inspect);
        return;
      }
      process.stdout.write(`${JSON.stringify(inspect, null, 2)}\n`);
    });
}