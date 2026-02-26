import { PtyManager } from "../../execution/pty-manager.js";
import type { ProviderAdapter, ProviderExecutionRequest, ProviderExecutionResult } from "./types.js";

export class ClaudeAdapter implements ProviderAdapter {
  public readonly provider = "claude" as const;
  private readonly pty = new PtyManager();

  public async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    const args = ["--print", "--output-format", "json", request.prompt];
    const result = await this.pty.run("claude", args, {
      cwd: request.cwd,
      timeoutMs: request.timeoutMs,
      heartbeatMs: Math.max(10_000, Math.floor(request.timeoutMs / 3))
    });
    return {
      provider: this.provider,
      exitCode: result.code,
      stdout: result.normalizedOutput,
      stderr: ""
    };
  }
}