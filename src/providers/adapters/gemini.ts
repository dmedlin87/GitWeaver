import { runCommand } from "../../core/shell.js";
import type { ProviderAdapter, ProviderExecutionRequest, ProviderExecutionResult } from "./types.js";

export class GeminiAdapter implements ProviderAdapter {
  public readonly provider = "gemini" as const;

  public async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    const args = ["--prompt", "orchestrator_input", "--output-format", "json", "--approval-mode", "auto_edit"];
    const result = await runCommand("gemini", args, {
      cwd: request.cwd,
      env: request.env,
      timeoutMs: request.timeoutMs,
      stdin: request.prompt
    });

    return {
      provider: this.provider,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr
    };
  }
}
