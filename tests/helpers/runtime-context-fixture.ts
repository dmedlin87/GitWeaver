/**
 * Shared runtime-context fixture helpers.
 * Provides mock builders for TaskContract, ProviderStatus, RunRecord, etc.
 */
import type { TaskContract, ProviderStatus } from "../../src/core/types.js";
import { sha256, stableStringify } from "../../src/core/hash.js";

/** Build a minimal valid TaskContract. Override any field as needed. */
export function makeTaskContract(overrides: Partial<TaskContract> = {}): TaskContract {
  const base: Omit<TaskContract, "contractHash"> = {
    taskId: overrides.taskId ?? "task-1",
    title: overrides.title ?? "Test task",
    provider: overrides.provider ?? "codex",
    type: overrides.type ?? "code",
    dependencies: overrides.dependencies ?? [],
    writeScope: overrides.writeScope ?? {
      allow: ["src/**"],
      deny: [],
      ownership: "exclusive"
    },
    commandPolicy: overrides.commandPolicy ?? {
      allow: ["npm test"],
      deny: [],
      network: "deny"
    },
    expected: overrides.expected ?? {},
    verify: overrides.verify ?? { outputVerificationRequired: false },
    artifactIO: overrides.artifactIO ?? {}
  };

  return {
    ...base,
    contractHash: overrides.contractHash ?? sha256(stableStringify(base))
  };
}

/** Build a minimal ProviderStatus. */
export function makeProviderStatus(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider: "codex",
    installed: true,
    authStatus: "OK",
    healthStatus: "HEALTHY",
    issues: [],
    ...overrides
  };
}
