/**
 * Extended e2e CLI tests.
 * Uses spawnSync to run the actual CLI binary against controlled fixtures.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const require = createRequire(import.meta.url);
const TSX_CLI_PATH = require.resolve("tsx/cli");
const CLI_ENTRY_PATH = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gw-e2e-ext-"));
  tempDirs.push(dir);
  return dir;
}

function makeGitRepo(): string {
  const dir = makeTempDir();
  execSync("git init", { cwd: dir });
  execSync(`git config user.email "test@test.com"`, { cwd: dir });
  execSync(`git config user.name "Test"`, { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# test\n");
  execSync("git add .", { cwd: dir });
  execSync(`git commit -m "initial"`, { cwd: dir });
  return dir;
}

function runCli(args: string[], cwd = process.cwd(), timeoutMs = 30_000): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [TSX_CLI_PATH, CLI_ENTRY_PATH, ...args], {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs
  });
}

function parseJsonStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Expected JSON on stdout, received empty output");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to incremental parsing to tolerate non-JSON lines around payloads.
  }

  const lines = trimmed.split(/\r?\n/);
  for (let start = 0; start < lines.length; start += 1) {
    const firstLine = lines[start]!.trim();
    if (!(firstLine.startsWith("{") || firstLine.startsWith("["))) continue;

    let candidate = "";
    for (let end = start; end < lines.length; end += 1) {
      candidate = candidate ? `${candidate}\n${lines[end]}` : lines[end]!;
      try {
        return JSON.parse(candidate);
      } catch {
        // Keep extending candidate until valid JSON is found.
      }
    }
  }

  throw new Error(`Expected JSON on stdout, received: ${trimmed.slice(0, 200)}`);
}

describe("cli e2e – run command", () => {
  it("--dry-run --json in a valid git repo exits 0 and outputs valid JSON", () => {
    const repo = makeGitRepo();
    const result = runCli([
      "run", "implement feature X",
      "--dry-run",
      "--repo", repo,
      "--non-interactive",
      "--install-missing", "never",
      "--json"
    ]);

    expect(result.status).toBe(0);
    const parsed = parseJsonStdout(result.stdout) as Record<string, unknown>;
    expect(parsed.runId).toEqual(expect.any(String));
    expect(parsed.state).toEqual(expect.any(String));
  });

  it("exits 1 when repo is not a git repository", () => {
    const nonRepo = makeTempDir();
    const result = runCli([
      "run", "test",
      "--dry-run",
      "--repo", nonRepo,
      "--non-interactive",
      "--install-missing", "never",
      "--json"
    ]);
    expect(result.status).toBe(1);
    const combined = `${result.stdout}\n${result.stderr}`;
    expect(combined).toContain("git");
  });
});

describe("cli e2e – status/inspect/locks commands", () => {
  it("status --json with unknown runId shows empty/null run", () => {
    const repo = makeGitRepo();
    const result = runCli(["status", "nonexistent-run-id", "--json"], repo);
    expect(result.status).toBe(0);
    const parsed = parseJsonStdout(result.stdout) as { tasks?: unknown };
    expect(Array.isArray(parsed.tasks)).toBe(true);
  });

  it("inspect --json with unknown runId exits cleanly", () => {
    const repo = makeGitRepo();
    const result = runCli(["inspect", "nonexistent-run-id", "--json"], repo);
    expect(result.status).toBe(0);
    const parsed = parseJsonStdout(result.stdout) as { runId?: unknown; events?: unknown };
    expect(parsed.runId).toBe("nonexistent-run-id");
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  it("locks --json with unknown runId exits cleanly", () => {
    const repo = makeGitRepo();
    const result = runCli(["locks", "nonexistent-run-id", "--json"], repo);
    expect(result.status).toBe(0);
    const parsed = parseJsonStdout(result.stdout) as { runId?: unknown; leases?: unknown };
    expect(parsed.runId).toBe("nonexistent-run-id");
    expect(Array.isArray(parsed.leases)).toBe(true);
  });

  it("inspect with --task filter passes through", () => {
    const repo = makeGitRepo();
    const result = runCli(["inspect", "nonexistent-run-id", "--task", "task-1", "--json"], repo);
    expect(result.status).toBe(0);
    const parsed = parseJsonStdout(result.stdout) as { runId?: unknown; events?: unknown };
    expect(parsed.runId).toBe("nonexistent-run-id");
    expect(Array.isArray(parsed.events)).toBe(true);
  });
});

describe("cli e2e – providers command", () => {
  it("providers check --json outputs JSON with statuses array", { timeout: 60_000 }, () => {
    const result = runCli(["providers", "check", "--providers", "codex", "--json"], process.cwd(), 55_000);
    expect(result.status).toBe(0);
    const parsed = parseJsonStdout(result.stdout) as { statuses?: unknown };
    expect(Array.isArray(parsed.statuses)).toBe(true);
    expect((parsed.statuses as unknown[]).length).toBeGreaterThan(0);
  });

  it("providers check (non-JSON) outputs text status lines", { timeout: 60_000 }, () => {
    const result = runCli(["providers", "check", "--providers", "codex"], process.cwd(), 55_000);
    expect(result.stdout.length + result.stderr.length).toBeGreaterThan(0);
  });
});

describe("cli e2e – stderr/exit code contracts", () => {
  it("unknown command outputs error and exits non-zero", () => {
    const result = runCli(["nonexistent-command"]);
    expect(result.status).not.toBe(0);
  });

  it("--concurrency with invalid value exits non-zero", () => {
    const repo = makeGitRepo();
    const result = runCli([
      "run", "test",
      "--concurrency", "not-a-number",
      "--dry-run",
      "--repo", repo
    ]);
    expect(result.status).not.toBe(0);
  });
});
