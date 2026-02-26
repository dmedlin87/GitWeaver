import { runShellLine } from "../core/shell.js";

export interface GateResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runGate(command: string, cwd: string, timeoutMs = 120_000): Promise<GateResult> {
  const result = await runShellLine(command, {
    cwd,
    timeoutMs
  });
  return {
    ok: result.code === 0,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.code
  };
}