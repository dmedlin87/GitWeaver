import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { sha256, stableStringify } from "../core/hash.js";
import type { ContextPack, TaskContract } from "../core/types.js";

interface Candidate {
  path: string;
  reason: string;
  tier: "must" | "should" | "optional";
}

function baselineFiles(): string[] {
  return ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "tsconfig.json", "src/index.ts"];
}

function addIfExists(repoPath: string, rel: string, reason: string, tier: Candidate["tier"], out: Candidate[]): void {
  const absolute = join(repoPath, rel);
  if (existsSync(absolute) && statSync(absolute).isFile()) {
    out.push({ path: rel, reason, tier });
  }
}

function bytesOf(repoPath: string, rel: string): number {
  return statSync(join(repoPath, rel)).size;
}

function hashFile(repoPath: string, rel: string): string {
  return sha256(readFileSync(join(repoPath, rel), "utf8"));
}

export function buildContextPack(repoPath: string, task: TaskContract, byteBudget = 256_000): ContextPack {
  const candidates: Candidate[] = [];

  for (const file of baselineFiles()) {
    addIfExists(repoPath, file, "baseline context pack", "must", candidates);
  }

  for (const file of task.writeScope.allow) {
    addIfExists(repoPath, file, "task write scope", "should", candidates);
  }

  for (const artifact of task.artifactIO.consumes ?? []) {
    addIfExists(repoPath, artifact, "artifact consume", "optional", candidates);
  }

  const unique = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.path)) {
      unique.set(candidate.path, candidate);
    }
  }

  const ordered = [...unique.values()].sort((a, b) => {
    const tierDiff = tierOrder(a.tier) - tierOrder(b.tier);
    if (tierDiff !== 0) {
      return tierDiff;
    }
    return a.path.localeCompare(b.path);
  });

  const must: ContextPack["must"] = [];
  const should: ContextPack["should"] = [];
  const optional: ContextPack["optional"] = [];

  let selectedTotalBytes = 0;

  for (const candidate of ordered) {
    const size = bytesOf(repoPath, candidate.path);
    if (selectedTotalBytes + size > byteBudget && candidate.tier !== "must") {
      continue;
    }

    const record: ContextPack["must"][0] = {
      path: candidate.path,
      sha256: hashFile(repoPath, candidate.path),
      reason: candidate.reason
    };

    selectedTotalBytes += size;

    if (candidate.tier === "must") {
      try {
        if (size < 100_000) {
          record.content = readFileSync(join(repoPath, candidate.path), "utf8");
        } else {
          record.content = "<file too large to inline>";
        }
      } catch {
        record.content = "<error reading file>";
      }
      must.push(record);
      continue;
    }
    if (candidate.tier === "should") {
      should.push(record);
      continue;
    }
    optional.push(record);
  }

  const pack: ContextPack = {
    taskId: task.taskId,
    must,
    should,
    optional,
    byteBudget,
    selectedTotalBytes,
    contextPackHash: ""
  };

  pack.contextPackHash = sha256(stableStringify({ ...pack, contextPackHash: undefined }));
  return pack;
}

function tierOrder(tier: Candidate["tier"]): number {
  if (tier === "must") {
    return 0;
  }
  if (tier === "should") {
    return 1;
  }
  return 2;
}