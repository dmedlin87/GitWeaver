import { redactSensitive } from "../observability/redaction.js";
import { runCommand } from "../core/shell.js";

export interface PtyRunOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  heartbeatMs: number;
}

export interface PtyRunResult {
  code: number;
  signal: number;
  rawOutput: string;
  normalizedOutput: string;
}

type NodePtyModule = typeof import("node-pty");

export class PtyManager {
  private ptyModulePromise: Promise<NodePtyModule | null> | null = null;

  public async run(command: string, args: string[], options: PtyRunOptions): Promise<PtyRunResult> {
    const ptyModule = await this.loadPtyModule();
    if (!ptyModule) {
      const fallback = await runCommand(command, args, {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs
      });
      const rawOutput = `${fallback.stdout}${fallback.stderr}`;
      return {
        code: fallback.code,
        signal: 0,
        rawOutput,
        normalizedOutput: normalizeOutput(rawOutput)
      };
    }

    return new Promise((resolve) => {
      const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
      const shellArgs = process.platform === "win32"
        ? ["-NoProfile", "-Command", `${command} ${args.map((arg) => escapeArg(arg)).join(" ")}`]
        : ["-lc", `${command} ${args.map((arg) => escapeArg(arg)).join(" ")}`];

      const proc = ptyModule.spawn(shell, shellArgs, {
        name: "xterm-color",
        cols: 120,
        rows: 40,
        cwd: options.cwd,
        env: {
          ...process.env,
          ...options.env
        }
      });

      let rawOutput = "";
      let lastOutput = Date.now();

      const timeout = setTimeout(() => {
        this.killTree(ptyModule, proc.pid);
      }, options.timeoutMs);

      const heartbeat = setInterval(() => {
        if (Date.now() - lastOutput > options.heartbeatMs) {
          this.killTree(ptyModule, proc.pid);
        }
      }, Math.max(1000, Math.floor(options.heartbeatMs / 2)));

      proc.onData((chunk) => {
        rawOutput += chunk;
        lastOutput = Date.now();
      });

      proc.onExit(({ exitCode, signal }) => {
        clearTimeout(timeout);
        clearInterval(heartbeat);
        resolve({
          code: exitCode,
          signal: signal ?? 0,
          rawOutput,
          normalizedOutput: normalizeOutput(rawOutput)
        });
      });
    });
  }

  private async loadPtyModule(): Promise<NodePtyModule | null> {
    if (!this.ptyModulePromise) {
      this.ptyModulePromise = import("node-pty").catch(() => null);
    }
    return this.ptyModulePromise;
  }

  private killTree(ptyModule: NodePtyModule, pid: number): void {
    if (process.platform === "win32") {
      ptyModule.spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        name: "xterm-color",
        cols: 80,
        rows: 20,
        cwd: process.cwd(),
        env: process.env as NodeJS.ProcessEnv
      });
      return;
    }

    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // no-op
      }
    }
  }
}

function normalizeOutput(output: string): string {
  const ansiStripped = output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  return redactSensitive(ansiStripped);
}

function escapeArg(arg: string): string {
  if (process.platform === "win32") {
    return `'${arg.replace(/'/g, "''")}'`;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}