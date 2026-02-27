import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface RunManifest {
  runId: string;
  baselineCommit: string;
  configHash: string;
  dagHash: string;
  plannerRawPath: string;
  providerVersions: Record<string, string | undefined>;
  providerHealth?: Record<string, unknown>;
  executionMode?: "host" | "container";
  createdAt: string;
}

export function writeRunManifest(path: string, manifest: RunManifest): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 2), "utf8");
}
