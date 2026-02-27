import { runCommand, type CommandResult } from "../core/shell.js";

export interface ContainerRunOptions {
  runtime: "docker" | "podman";
  image: string;
  workspacePath: string;
  env?: NodeJS.ProcessEnv;
  command: string;
  args: string[];
  timeoutMs: number;
  stdin?: string;
  network: "allow" | "deny";
}

export async function runInContainer(options: ContainerRunOptions): Promise<CommandResult> {
  const envFlags: string[] = [];
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value !== undefined) {
      envFlags.push("-e", `${key}=${value}`);
    }
  }

  const args = [
    "run",
    "--rm",
    "-i",
    "-w",
    "/workspace",
    "-v",
    `${options.workspacePath}:/workspace`,
    ...(options.network === "deny" ? ["--network", "none"] : []),
    ...envFlags,
    options.image,
    options.command,
    ...options.args
  ];

  return runCommand(options.runtime, args, {
    cwd: options.workspacePath,
    timeoutMs: options.timeoutMs,
    stdin: options.stdin
  });
}
