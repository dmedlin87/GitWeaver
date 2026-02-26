import { sha256, stableStringify } from "../core/hash.js";
import type { PromptEnvelope, TaskContract } from "../core/types.js";

export function buildPromptEnvelope(input: {
  runId: string;
  task: TaskContract;
  attempt: number;
  baselineCommit: string;
  contextPackHash: string;
  immutableSections: Record<string, unknown>;
  failureEvidence?: string[];
  boundedHints?: string[];
}): PromptEnvelope {
  const immutableSectionsHash = sha256(stableStringify(input.immutableSections));
  return {
    runId: input.runId,
    taskId: input.task.taskId,
    attempt: input.attempt,
    provider: input.task.provider,
    baselineCommit: input.baselineCommit,
    taskContractHash: input.task.contractHash,
    contextPackHash: input.contextPackHash,
    immutableSectionsHash,
    mutableSections: {
      failureEvidence: input.failureEvidence,
      boundedHints: input.boundedHints
    }
  };
}

export function assertPromptDrift(previous: PromptEnvelope, next: PromptEnvelope): void {
  if (previous.immutableSectionsHash !== next.immutableSectionsHash) {
    throw new Error("Prompt immutable section drift detected");
  }
  if (previous.taskContractHash !== next.taskContractHash) {
    throw new Error("Prompt contract hash drift detected");
  }
  if (previous.contextPackHash !== next.contextPackHash) {
    throw new Error("Prompt context hash drift detected");
  }
}