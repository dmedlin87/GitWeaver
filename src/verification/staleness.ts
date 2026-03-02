import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import { latestCommit } from "./commit-analyzer.js";

export interface ArtifactSignatureMap {
  [key: string]: string;
}

export interface StalenessResult {
  stale: boolean;
  reasons: string[];
}

function normalizeKey(input: string): string {
  const normalized = normalize(input).split("\\").join("/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function artifactKey(repoPath: string, artifactPath: string): string {
  const absolute = isAbsolute(artifactPath) ? normalize(artifactPath) : normalize(join(repoPath, artifactPath));
  const rel = relative(repoPath, absolute);

  if (!rel.startsWith("..") && !isAbsolute(rel)) {
    return normalizeKey(rel);
  }

  return normalizeKey(artifactPath);
}

export function collectArtifactSignatures(repoPath: string, artifacts: string[] | undefined): ArtifactSignatureMap {
  const signatures: ArtifactSignatureMap = {};
  const uniqueArtifacts = [...new Set(artifacts ?? [])];

  for (const artifact of uniqueArtifacts) {
    const key = artifactKey(repoPath, artifact);
    const absolute = isAbsolute(artifact) ? normalize(artifact) : normalize(join(repoPath, artifact));
    const rel = relative(repoPath, absolute);

    if (rel.startsWith("..") || isAbsolute(rel)) {
      continue;
    }
    if (!existsSync(absolute)) {
      continue;
    }

    const stat = lstatSync(absolute);
    if (!stat.isFile()) {
      continue;
    }

    const digest = createHash("sha256").update(readFileSync(absolute)).digest("hex");
    signatures[key] = digest;
  }

  return signatures;
}

export async function detectStaleness(
  repoPath: string,
  taskBaseCommit: string,
  consumed: string[] | undefined,
  priorSignatures: ArtifactSignatureMap,
  latestSignatures: ArtifactSignatureMap
): Promise<StalenessResult> {
  const reasons: string[] = [];

  for (const artifact of [...new Set(consumed ?? [])]) {
    const key = artifactKey(repoPath, artifact);
    const previous = priorSignatures[key];
    const latest = latestSignatures[key];

    if (!previous) {
      reasons.push(`artifact signature missing in prior snapshot for ${artifact}`);
    }
    if (!latest) {
      reasons.push(`artifact signature missing in latest snapshot for ${artifact}`);
    }
    if (previous && latest && previous !== latest) {
      reasons.push(`artifact signature drift for ${artifact}`);
    }
  }

  return {
    stale: reasons.length > 0,
    reasons
  };
}
