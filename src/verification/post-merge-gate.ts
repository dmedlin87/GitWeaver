import { runShellLine } from "../core/shell.js";
import { runInContainer } from "../execution/container-runner.js";

export interface GateResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GateExecutionOptions {
  env?: NodeJS.ProcessEnv;
  executionMode?: "host" | "container";
  containerRuntime?: "docker" | "podman";
  containerImage?: string;
  networkPolicy?: "allow" | "deny";
}

export async function runGate(
  command: string,
  cwd: string,
  timeoutMs = 120_000,
  options: GateExecutionOptions = {}
): Promise<GateResult> {
  const result = options.executionMode === "container"
    ? await runInContainer({
        runtime: options.containerRuntime ?? "docker",
        image: options.containerImage ?? "ghcr.io/dmedlin87/gitweaver-runtime:latest",
        workspacePath: cwd,
        env: options.env,
        command: "sh",
        args: ["-lc", command],
        timeoutMs,
        network: options.networkPolicy ?? "allow"
      })
    : await runShellLine(command, {
        cwd,
        timeoutMs,
        env: options.env
      });
  return {
    ok: result.code === 0,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code
  };
}
