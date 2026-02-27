import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { collectArtifactSignatures, detectStaleness } from "../../src/verification/staleness.js";

const tempDirs: string[] = [];

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
  runGit(repo, ["init"]);
  runGit(repo, ["config", "user.email", "ci@example.com"]);
  runGit(repo, ["config", "user.name", "CI"]);
  return repo;
}

function runGit(repoPath: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: repoPath, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

describe("staleness detection", () => {
  it("passes when base commit and signatures are unchanged", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "artifact.txt"), "v1\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);
    const head = runGit(repo, ["rev-parse", "HEAD"]);

    const prior = collectArtifactSignatures(repo, ["artifact.txt"]);
    const latest = collectArtifactSignatures(repo, ["artifact.txt"]);
    const result = await detectStaleness(repo, head, ["artifact.txt"], prior, latest);

    expect(result.stale).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  it("flags base commit drift even when signatures match", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "artifact.txt"), "v1\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);
    const base = runGit(repo, ["rev-parse", "HEAD"]);

    runGit(repo, ["commit", "--allow-empty", "-m", "outside change"]);
    const latest = collectArtifactSignatures(repo, ["artifact.txt"]);
    const result = await detectStaleness(repo, base, ["artifact.txt"], latest, latest);

    expect(result.stale).toBe(true);
    expect(result.reasons.some((reason) => reason.includes("base commit drift detected"))).toBe(true);
  });

  it("flags missing consumed artifacts in both snapshots", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "README.md"), "hello\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);
    const head = runGit(repo, ["rev-parse", "HEAD"]);

    const result = await detectStaleness(repo, head, ["missing.ts"], {}, {});

    expect(result.stale).toBe(true);
    expect(result.reasons).toContain("artifact signature missing in prior snapshot for missing.ts");
    expect(result.reasons).toContain("artifact signature missing in latest snapshot for missing.ts");
  });

  it("flags artifact signature drift", async () => {
    const repo = makeRepo();
    writeFileSync(join(repo, "artifact.txt"), "v1\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    const prior = collectArtifactSignatures(repo, ["artifact.txt"]);

    writeFileSync(join(repo, "artifact.txt"), "v2\n", "utf8");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "updated artifact"]);
    const head = runGit(repo, ["rev-parse", "HEAD"]);

    const latest = collectArtifactSignatures(repo, ["artifact.txt"]);
    const result = await detectStaleness(repo, head, ["artifact.txt"], prior, latest);

    expect(result.stale).toBe(true);
    expect(result.reasons).toContain("artifact signature drift for artifact.txt");
  });
});

