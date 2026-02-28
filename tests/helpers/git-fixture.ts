/**
 * Shared git fixture helpers for tests.
 * Creates isolated temporary git repositories with a deterministic structure.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export interface GitFixture {
  dir: string;
  headCommit(): string;
  writeFile(relativePath: string, content: string): void;
  commit(message: string): string;
  cleanup(): void;
}

/** Create a temporary bare-minimum git repo with an initial commit. */
export function createGitFixture(prefix = "gw-git-fixture-"): GitFixture {
  const dir = mkdtempSync(join(tmpdir(), prefix));

  const git = (cmd: string): string =>
    execSync(`git ${cmd}`, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

  git("init");
  git(`config user.email "test@test.com"`);
  git(`config user.name "Test"`);

  // Initial commit
  writeFileSync(join(dir, "README.md"), "# test\n");
  git("add .");
  git(`commit -m "initial"`);

  return {
    dir,

    headCommit(): string {
      return git("rev-parse HEAD");
    },

    writeFile(relativePath: string, content: string): void {
      const fullPath = join(dir, relativePath);
      mkdirSync(join(fullPath, ".."), { recursive: true });
      writeFileSync(fullPath, content);
    },

    commit(message: string): string {
      git("add -A");
      git(`commit -m "${message}"`);
      return git("rev-parse HEAD");
    },

    cleanup(): void {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

/** Create a temp directory (not a git repo). */
export function createTempDir(prefix = "gw-tmp-"): { dir: string; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir,
    cleanup(): void {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}
