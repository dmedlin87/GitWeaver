import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const next = tempDirs.pop();
    if (next) {
      rmSync(next, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gw-e2e-"));
  tempDirs.push(dir);
  return dir;
}

function runCli(args: string[], cwd = process.cwd()): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ["--import", "tsx", "src/cli/main.ts", ...args], {
    cwd,
    encoding: "utf8"
  });
}

describe("cli e2e", () => {
  it("shows command help", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("orchestrator");
    expect(result.stdout).toContain("providers");
  });

  it("fails fast when target path is not a git repository", () => {
    const nonRepo = makeTempDir();
    const result = runCli([
      "run",
      "repo check",
      "--dry-run",
      "--repo",
      nonRepo,
      "--non-interactive",
      "--install-missing",
      "never",
      "--json"
    ]);
    expect(result.status).toBe(1);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toContain("Not a git repository");
  });
});
