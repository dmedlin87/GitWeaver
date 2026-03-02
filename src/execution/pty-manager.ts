import { redactSensitive } from "../observability/redaction.js";
import { runCommand } from "../core/shell.js";
import { killProcessTree } from "./watchdog.js";

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

const DENYLIST = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN"
];

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

    return new Promise((resolve, reject) => {
      const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
      const shellArgs = process.platform === "win32"
        ? ["-NoProfile", "-Command", `${command} ${args.map((arg) => escapeArg(arg)).join(" ")}`]
        : ["-lc", `${command} ${args.map((arg) => escapeArg(arg)).join(" ")}`];

      const baseEnv = { ...process.env };
      for (const key of DENYLIST) {
        delete baseEnv[key];
      }

      const env = options.env ? { ...baseEnv, ...options.env } : baseEnv;
      if (!env.TERM && process.env.TERM) {
        env.TERM = process.env.TERM;
      }
      if (!env.COLORTERM && process.env.COLORTERM) {
        env.COLORTERM = process.env.COLORTERM;
      }

      let proc: ReturnType<NodePtyModule["spawn"]>;
      try {
        proc = ptyModule.spawn(shell, shellArgs, {
          name: "xterm-color",
          cols: 120,
          rows: 40,
          cwd: options.cwd,
          env: env as Record<string, string>
        });
      } catch (spawnError) {
        reject(spawnError);
        return;
      }

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
      void killProcessTree(pid).catch(() => undefined);
      return;
    }

    void killProcessTree(pid).catch(() => undefined);
  }
}

function normalizeOutput(output: string): string {
  // Strip ANSI CSI sequences (e.g. colour codes)
  let stripped = output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  // Strip OSC sequences: ESC ] ... ST  (ST = BEL \x07 or ESC \)
  stripped = stripped.replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, "");
  return redactSensitive(stripped);
}

function escapeArg(arg: string): string {
  if (process.platform === "win32") {
    return `'${arg.replace(/'/g, "''")}'`;
  }
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
