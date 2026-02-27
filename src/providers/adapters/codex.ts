import { PtyManager } from "../../execution/pty-manager.js";
import { runInContainer } from "../../execution/container-runner.js";
import type { ProviderAdapter, ProviderExecutionRequest, ProviderExecutionResult } from "./types.js";

export class CodexAdapter implements ProviderAdapter {
  public readonly provider = "codex" as const;
  private readonly pty = new PtyManager();

  public async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    const args = ["exec", "--json", "--cd", request.cwd, request.prompt];
    if (request.outputSchemaPath) {
      args.splice(2, 0, "--output-schema", request.outputSchemaPath);
    }

    if (request.executionMode === "container") {
      const result = await runInContainer({
        runtime: request.containerRuntime ?? "docker",
        image: request.containerImage ?? "ghcr.io/dmedlin87/gitweaver-runtime:latest",
        workspacePath: request.cwd,
        env: request.env,
        command: "codex",
        args,
        timeoutMs: request.timeoutMs,
        network: request.networkPolicy ?? "allow"
      });
      return {
        provider: this.provider,
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        rawOutput: `${result.stdout}${result.stderr}`
      };
    }

    const result = await this.pty.run("codex", args, {
      cwd: request.cwd,
      env: request.env,
      timeoutMs: request.timeoutMs,
      heartbeatMs: Math.max(10_000, Math.floor(request.timeoutMs / 3))
    });

    return {
      provider: this.provider,
      exitCode: result.code,
      stdout: result.normalizedOutput,
      stderr: "",
      rawOutput: result.rawOutput
    };
  }
}
