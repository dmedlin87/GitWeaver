import { runCommand } from "../../core/shell.js";
import { runInContainer } from "../../execution/container-runner.js";
import type { ProviderAdapter, ProviderExecutionRequest, ProviderExecutionResult } from "./types.js";

export class GeminiAdapter implements ProviderAdapter {
  public readonly provider = "gemini" as const;

  public async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    // Prompt is delivered via stdin, not as a CLI arg.
    // Positional args break on Windows (cmd.exe splits on newlines) and cause
    // Gemini to hang waiting for TTY input on all platforms.
    const args = ["--output-format", "json"];
    const result = request.executionMode === "container"
      ? await runInContainer({
          runtime: request.containerRuntime ?? "docker",
          image: request.containerImage ?? "ghcr.io/dmedlin87/gitweaver-runtime:latest",
          workspacePath: request.cwd,
          env: request.env,
          command: "gemini",
          args,
          timeoutMs: request.timeoutMs,
          stdin: request.prompt,
          network: request.networkPolicy ?? "allow",
          ...(request.containerMemoryMb !== undefined ? { memoryMb: request.containerMemoryMb } : {}),
          ...(request.containerCpuLimit !== undefined ? { cpuLimit: request.containerCpuLimit } : {}),
          ...(request.containerRunAsUser !== undefined ? { user: request.containerRunAsUser } : {}),
          ...(request.containerDropCapabilities !== undefined ? { dropCapabilities: request.containerDropCapabilities } : {}),
          ...(request.containerReadOnlyRootfs !== undefined ? { readOnlyRootfs: request.containerReadOnlyRootfs } : {})
        })
      : await runCommand("gemini", args, {
          cwd: request.cwd,
          env: request.env,
          timeoutMs: request.timeoutMs,
          stdin: request.prompt
        });

    return {
      provider: this.provider,
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      rawOutput: `${result.stdout}${result.stderr}`
    };
  }
}
