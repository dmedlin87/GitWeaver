import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectArtifactSignatures, detectStaleness } from "../../src/verification/staleness.js";
import { latestCommit } from "../../src/verification/commit-analyzer.js";

vi.mock("../../src/verification/commit-analyzer.js", () => ({
  latestCommit: vi.fn()
}));

const tempDirs: string[] = [];
const mockLatestCommit = vi.mocked(latestCommit);

afterEach(() => {
  while (tempDirs.length > 0) {
    const next = tempDirs.pop();
    if (next) {
      rmSync(next, { recursive: true, force: true });
    }
  }
});

function makeRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "gw-stale-"));
  tempDirs.push(repo);
  return repo;
}

describe("staleness detection", () => {
  beforeEach(() => {
    mockLatestCommit.mockReset();
  });

  it("passes when base commit and signatures are unchanged", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "artifact.txt"), "v1\n", "utf8");
    mockLatestCommit.mockResolvedValue("head-a");

    const prior = collectArtifactSignatures(repo, ["artifact.txt"]);
    const latest = collectArtifactSignatures(repo, ["artifact.txt"]);
    const result = await detectStaleness(repo, "head-a", ["artifact.txt"], prior, latest);

    expect(result.stale).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("flags base commit drift even when signatures match", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "artifact.txt"), "v1\n", "utf8");
    mockLatestCommit.mockResolvedValue("head-b");
    const latest = collectArtifactSignatures(repo, ["artifact.txt"]);
    const result = await detectStaleness(repo, "head-a", ["artifact.txt"], latest, latest);

    expect(result.stale).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("base commit drift detected"))).toBe(true);
  });

  it("flags missing consumed artifacts in both snapshots", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "README.md"), "hello\n", "utf8");
    mockLatestCommit.mockResolvedValue("head-a");

    const result = await detectStaleness(repo, "head-a", ["missing.ts"], {}, {});

    expect(result.stale).toBe(true);
    expect(result.reasons).toContain("artifact signature missing in prior snapshot for missing.ts");
    expect(result.reasons).toContain("artifact signature missing in latest snapshot for missing.ts");
  });

  it("flags artifact signature drift", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "artifact.txt"), "v1\n", "utf8");
    mockLatestCommit.mockResolvedValue("head-a");

    const prior = collectArtifactSignatures(repo, ["artifact.txt"]);

    writeFileSync(join(repo, "artifact.txt"), "v2\n", "utf8");

    const latest = collectArtifactSignatures(repo, ["artifact.txt"]);
    const result = await detectStaleness(repo, "head-a", ["artifact.txt"], prior, latest);

    expect(result.stale).toBe(true);
    expect(result.reasons).toContain("artifact signature drift for artifact.txt");
  });
});

