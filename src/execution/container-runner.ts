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
  memoryMb?: number;
  cpuLimit?: number;
  user?: string;
  dropCapabilities?: boolean;
  readOnlyRootfs?: boolean;
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
    ...(options.memoryMb && options.memoryMb > 0 ? ["--memory", `${options.memoryMb}m`] : []),
    ...(options.cpuLimit && options.cpuLimit > 0 ? ["--cpus", String(options.cpuLimit)] : []),
    ...(options.user ? ["--user", options.user] : []),
    ...(options.dropCapabilities ? ["--cap-drop", "ALL"] : []),
    ...(options.readOnlyRootfs ? ["--read-only"] : []),
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
