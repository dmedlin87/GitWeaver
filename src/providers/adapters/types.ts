import type { ProviderId } from "../../core/types.js";

export interface ProviderExecutionRequest {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  outputSchemaPath?: string;
}

export interface ProviderExecutionResult {
  provider: ProviderId;
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProviderAdapter {
  provider: ProviderId;
  execute(request: ProviderExecutionRequest): Promise<ProviderExecutionResult>;
}