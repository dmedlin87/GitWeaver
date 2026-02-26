import { PtyManager } from "../../execution/pty-manager.js";
import type { ProviderAdapter, ProviderExecutionRequest, ProviderExecutionResult } from "./types.js";

export class CodexAdapter implements ProviderAdapter {
  public readonly provider = "codex" as const;
  private readonly pty = new PtyManager();

  public async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    const args = ["exec", "--json", "--cd", request.cwd, request.prompt];
    if (request.outputSchemaPath) {
      args.splice(2, 0, "--output-schema", request.outputSchemaPath);
    }

    const result = await this.pty.run("codex", args, {
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