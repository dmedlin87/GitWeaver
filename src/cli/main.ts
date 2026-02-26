import { Command } from "commander";
import { registerRunCommand } from "./commands/run.js";
import { registerResumeCommand } from "./commands/resume.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerLocksCommand } from "./commands/locks.js";
import { registerProvidersCommand } from "./commands/providers.js";

const program = new Command();
program
  .name("orchestrator")
  .description("CLI-driven heterogeneous orchestrator")
  .version("0.1.0");

registerRunCommand(program);
registerResumeCommand(program);
registerStatusCommand(program);
registerInspectCommand(program);
registerLocksCommand(program);
registerProvidersCommand(program);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});