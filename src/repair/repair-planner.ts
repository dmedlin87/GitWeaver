import type { TaskContract } from "../core/types.js";
import { sha256, stableStringify } from "../core/hash.js";

export interface RepairPlanInput {
  failedTask: TaskContract;
  changedFiles: string[];
  errorFiles: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildRepairTask(input: RepairPlanInput): TaskContract {
  const narrowedAllow = unique([...input.changedFiles, ...input.errorFiles]);
  const base: Omit<TaskContract, "contractHash"> = {
    taskId: `${input.failedTask.taskId}-repair`,
    title: `Repair for ${input.failedTask.title}`,
    provider: input.failedTask.provider,
    type: "repair",
    dependencies: [input.failedTask.taskId],
    writeScope: {
      allow: narrowedAllow.length > 0 ? narrowedAllow : input.failedTask.writeScope.allow,
      deny: input.failedTask.writeScope.deny,
      ownership: "exclusive",
      sharedKey: input.failedTask.writeScope.sharedKey
    },
    commandPolicy: input.failedTask.commandPolicy,
    expected: input.failedTask.expected,
    verify: {
      ...input.failedTask.verify,
      outputVerificationRequired: true
    },
    artifactIO: input.failedTask.artifactIO
  };

  return {
    ...base,
    contractHash: sha256(stableStringify(base))
  };
}