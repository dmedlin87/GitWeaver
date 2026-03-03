import { runCommand } from "../../core/shell.js";
import { runInContainer } from "../../execution/container-runner.js";
import { DEFAULT_CONTAINER_IMAGE } from "../../core/config.js";
import type { ProviderAdapter, ProviderExecutionRequest, ProviderExecutionResult } from "./types.js";

export class GeminiAdapter implements ProviderAdapter {
  public readonly provider = "gemini" as const;

  public async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    // Force headless mode; stdin content is appended by Gemini to the prompt.
    // Without --prompt, Gemini may enter interactive mode and wait indefinitely.
    const args = ["--model", "flash", "--prompt", "orchestrator_input", "--output-format", "json", "--approval-mode", "auto_edit"];
    const result = request.executionMode === "container"
      ? await runInContainer({
          runtime: request.containerRuntime ?? "docker",
          image: request.containerImage ?? DEFAULT_CONTAINER_IMAGE,
          workspacePath: request.cwd,
          env: request.env,
          command: "gemini",
          args,
          timeoutMs: request.timeoutMs,
          stdin: request.prompt,
          network: request.networkPolicy ?? "deny",
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
