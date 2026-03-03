import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  stdin?: string;
}

export function runCommand(command: string, args: string[], options: ExecOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const spawnSpec = buildSpawnSpec(command, args);
    const child = spawn(spawnSpec.command, spawnSpec.args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: "pipe"
    });

    let stdout = "";
    let stderr = "";
    let timeout: NodeJS.Timeout | undefined;
    let forceKill: NodeJS.Timeout | undefined;
    let timedOut = false;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        forceKill = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // process already terminated
          }
        }, 5_000);
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKill) {
        clearTimeout(forceKill);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKill) {
        clearTimeout(forceKill);
      }
      if (timedOut) {
        stderr = `${stderr}\nCommand timed out after ${options.timeoutMs}ms`.trim();
      }
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr
      });
    });

    if (options.stdin) {
      child.stdin.write(options.stdin);
    }
    child.stdin.end();
  });
}

export function runShellLine(line: string, options: ExecOptions = {}): Promise<CommandResult> {
  if (process.platform === "win32") {
    return runCommand("powershell", ["-NoProfile", "-Command", line], options);
  }
  return runCommand("sh", ["-lc", line], options);
}

function buildSpawnSpec(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") {
    return { command, args };
  }

  const commandLine = [quoteWindowsArg(command), ...args.map((arg) => quoteWindowsArg(arg))].join(" ");
  return {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", commandLine]
  };
}

function quoteWindowsArg(value: string): string {
  if (value.length === 0) {
    return "\"\"";
  }
  if (!/[ \t"&|<>^()]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}
