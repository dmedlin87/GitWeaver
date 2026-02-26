import { PtyManager } from "../../execution/pty-manager.js";
import type { ProviderAdapter, ProviderExecutionRequest, ProviderExecutionResult } from "./types.js";

export class GeminiAdapter implements ProviderAdapter {
  public readonly provider = "gemini" as const;
  private readonly pty = new PtyManager();

  public async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    const args = ["--prompt", request.prompt, "--output-format", "json", "--approval-mode", "plan"];
    const result = await this.pty.run("gemini", args, {
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