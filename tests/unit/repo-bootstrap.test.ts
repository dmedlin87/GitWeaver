import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../../src/core/shell.js";
import { maybeBootstrapRepo } from "../../src/cli/repo-bootstrap.js";

describe("maybeBootstrapRepo", () => {
  const originalAuthorName = process.env.GIT_AUTHOR_NAME;
  const originalAuthorEmail = process.env.GIT_AUTHOR_EMAIL;
  const originalCommitterName = process.env.GIT_COMMITTER_NAME;
  const originalCommitterEmail = process.env.GIT_COMMITTER_EMAIL;

  beforeEach(() => {
    process.env.GIT_AUTHOR_NAME = "Test User";
    process.env.GIT_AUTHOR_EMAIL = "test@example.com";
    process.env.GIT_COMMITTER_NAME = "Test User";
    process.env.GIT_COMMITTER_EMAIL = "test@example.com";
  });

  afterEach(() => {
    process.env.GIT_AUTHOR_NAME = originalAuthorName;
    process.env.GIT_AUTHOR_EMAIL = originalAuthorEmail;
    process.env.GIT_COMMITTER_NAME = originalCommitterName;
    process.env.GIT_COMMITTER_EMAIL = originalCommitterEmail;
  });

  it("returns undefined when bootstrap is disabled", async () => {
    const result = await maybeBootstrapRepo({
      repo: "C:\\tmp\\ignored",
      bootstrap: false
    });

    expect(result).toBeUndefined();
  });

  it("requires --repo when bootstrap is enabled", async () => {
    await expect(maybeBootstrapRepo({ bootstrap: true })).rejects.toThrow("--bootstrap requires --repo <path>");
  });

  it("initializes a blank repository and creates an initial commit", async () => {
    const root = mkdtempSync(join(tmpdir(), "gw-bootstrap-"));
    const repoPath = join(root, "snake-game");

    try {
      const result = await maybeBootstrapRepo({
        repo: repoPath,
        bootstrap: true
      });

      expect(result).toBeDefined();
      expect(result?.initializedGit).toBe(true);
      expect(result?.createdInitialCommit).toBe(true);
      expect(existsSync(join(repoPath, ".git"))).toBe(true);
      expect(existsSync(join(repoPath, "README.md"))).toBe(true);

      const head = await runCommand("git", ["-C", repoPath, "rev-parse", "--verify", "HEAD"]);
      expect(head.code).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("scaffolds web-game template files", async () => {
    const root = mkdtempSync(join(tmpdir(), "gw-bootstrap-"));
    const repoPath = join(root, "web-game");

    try {
      const result = await maybeBootstrapRepo({
        repo: repoPath,
        bootstrap: true,
        bootstrapTemplate: "web-game-ts"
      });

      expect(result).toBeDefined();
      expect(existsSync(join(repoPath, "index.html"))).toBe(true);
      expect(existsSync(join(repoPath, "src", "main.ts"))).toBe(true);
      expect(existsSync(join(repoPath, "tests", "smoke.test.ts"))).toBe(true);
      expect(existsSync(join(repoPath, "package.json"))).toBe(true);
      expect(existsSync(join(repoPath, "tsconfig.json"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
