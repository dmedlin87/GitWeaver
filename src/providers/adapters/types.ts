import type { ProviderId } from "../../core/types.js";

export interface ProviderExecutionRequest {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  outputSchemaPath?: string;
  env?: NodeJS.ProcessEnv;
  executionMode?: "host" | "container";
  containerRuntime?: "docker" | "podman";
  containerImage?: string;
  networkPolicy?: "allow" | "deny";
}

export interface ProviderExecutionResult {
  provider: ProviderId;
  exitCode: number;
  stdout: string;
  stderr: string;
  rawOutput?: string;
}

export interface ProviderAdapter {
  provider: ProviderId;
  execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult>;
}
