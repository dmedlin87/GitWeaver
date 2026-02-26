import { latestCommit } from "./commit-analyzer.js";

export interface ArtifactSignatureMap {
  [key: string]: string;
}

export interface StalenessResult {
  stale: boolean;
  reasons: string[];
}

export async function detectStaleness(
  repoPath: string,
  taskBaseCommit: string,
  consumed: string[] | undefined,
  priorSignatures: ArtifactSignatureMap,
  latestSignatures: ArtifactSignatureMap
): Promise<StalenessResult> {
  const reasons: string[] = [];

  const head = await latestCommit(repoPath);
  if (head !== taskBaseCommit) {
    reasons.push(`base commit drift detected: task=${taskBaseCommit}, current=${head}`);
  }

  for (const artifact of consumed ?? []) {
    const previous = priorSignatures[artifact];
    const latest = latestSignatures[artifact];
    if (previous && latest && previous !== latest) {
      reasons.push(`artifact signature drift for ${artifact}`);
    }
  }

  return {
    stale: reasons.length > 0,
    reasons
  };
}