import { PtyManager } from "../../execution/pty-manager.js";
import { runInContainer } from "../../execution/container-runner.js";
import { runCommand } from "../../core/shell.js";
import { DEFAULT_CONTAINER_IMAGE } from "../../core/config.js";
import type { ProviderAdapter, ProviderExecutionRequest, ProviderExecutionResult } from "./types.js";

export class ClaudeAdapter implements ProviderAdapter {
  public readonly provider = "claude" as const;
  private readonly pty = new PtyManager();

  public async execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult> {
    if (request.promptViaStdin && request.executionMode !== "container") {
      const result = await runCommand("claude", ["--print", "--output-format", "json"], {
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

    const args = ["--print", "--output-format", "json", request.prompt];
    if (request.executionMode === "container") {
      const result = await runInContainer({
        runtime: request.containerRuntime ?? "docker",
        image: request.containerImage ?? DEFAULT_CONTAINER_IMAGE,
        workspacePath: request.cwd,
        env: request.env,
        command: "claude",
        args,
        timeoutMs: request.timeoutMs,
        network: request.networkPolicy ?? "allow",
        ...(request.containerMemoryMb !== undefined ? { memoryMb: request.containerMemoryMb } : {}),
        ...(request.containerCpuLimit !== undefined ? { cpuLimit: request.containerCpuLimit } : {}),
        ...(request.containerRunAsUser !== undefined ? { user: request.containerRunAsUser } : {}),
        ...(request.containerDropCapabilities !== undefined ? { dropCapabilities: request.containerDropCapabilities } : {}),
        ...(request.containerReadOnlyRootfs !== undefined ? { readOnlyRootfs: request.containerReadOnlyRootfs } : {})
      });
      return {
        provider: this.provider,
        exitCode: result.code,
        stdout: result.stdout,
        stderr: result.stderr,
        rawOutput: `${result.stdout}${result.stderr}`
      };
    }

    const result = await this.pty.run("claude", args, {
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
