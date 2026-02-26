import { runCommand } from "../core/shell.js";

export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await runCommand("taskkill", ["/PID", String(pid), "/T", "/F"], { timeoutMs: 10_000 });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // best effort
    }
  }
}