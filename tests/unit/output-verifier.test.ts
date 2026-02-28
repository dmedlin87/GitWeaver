import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TaskContract } from "../../src/core/types.js";
import { verifyTaskOutput } from "../../src/verification/output-verifier.js";

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
  const repo = mkdtempSync(join(tmpdir(), "gw-output-"));
  tempDirs.push(repo);
  return repo;
}

function makeTask(expected: TaskContract["expected"]): TaskContract {
  return {
    taskId: "task-output",
    title: "verify output",
    provider: "codex",
    type: "code",
    dependencies: [],
    writeScope: {
      allow: ["src/**/*.ts", "tests/**/*.ts"],
      deny: [],
      ownership: "exclusive"
    },
    commandPolicy: {
      allow: ["pnpm test"],
      deny: [],
      network: "deny"
    },
    expected,
    verify: {
      outputVerificationRequired: true
    },
    artifactIO: {},
    contractHash: "hash"
  };
}

function writeRepoFile(repo: string, relativePath: string, content: string): void {
  const absolute = join(repo, relativePath);
  const dir = dirname(absolute);
  mkdirSync(dir, { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

describe("verifyTaskOutput", () => {
  it("passes when expected files, test snippet, and export kind match", () => {
    const repo = makeRepo();
    writeRepoFile(repo, "src/service.ts", "export function run() { return 1; }\n");
    writeRepoFile(repo, "tests/service.test.ts", "it('runs', () => expect(1).toBe(1));\n");

    const task = makeTask({
      files: ["src/service.ts"],
      tests: [{ file: "tests/service.test.ts", contains: "expect(1).toBe(1)" }],
      exports: [{ file: "src/service.ts", name: "run", kind: "function" }]
    });

    const result = verifyTaskOutput(repo, task);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("reports missing expected files", () => {
    const repo = makeRepo();
    const task = makeTask({ files: ["src/missing.ts"] });

    const result = verifyTaskOutput(repo, task);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Expected file missing: src/missing.ts");
  });

  it("reports missing test file without snippet check noise", () => {
    const repo = makeRepo();
    const task = makeTask({
      tests: [{ file: "tests/missing.test.ts", contains: "needle" }]
    });

    const result = verifyTaskOutput(repo, task);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Expected test file missing: tests/missing.test.ts");
    expect(result.errors.some((error) => error.includes("Expected snippet not found"))).toBe(false);
  });

  it("reports missing snippet in existing test file", () => {
    const repo = makeRepo();
    writeRepoFile(repo, "tests/a.test.ts", "describe('x', () => {});\n");
    const task = makeTask({
      tests: [{ file: "tests/a.test.ts", contains: "expect(true)" }]
    });

    const result = verifyTaskOutput(repo, task);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Expected snippet not found in test file tests/a.test.ts");
  });

  it("reports missing export file", () => {
    const repo = makeRepo();
    const task = makeTask({
      exports: [{ file: "src/nope.ts", name: "run", kind: "function" }]
    });

    const result = verifyTaskOutput(repo, task);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Expected export file missing: src/nope.ts");
  });

  it("reports missing export symbol in existing file", () => {
    const repo = makeRepo();
    writeRepoFile(repo, "src/service.ts", "export const value = 1;\n");
    const task = makeTask({
      exports: [{ file: "src/service.ts", name: "run", kind: "function" }]
    });

    const result = verifyTaskOutput(repo, task);

    expect(result.ok).toBe(false);
    expect(result.errors).toContain("Expected export not found: src/service.ts#run");
  });

  it("reports export kind mismatch", () => {
    const repo = makeRepo();
    writeRepoFile(repo, "src/service.ts", "export const run = () => 1;\n");
    const task = makeTask({
      exports: [{ file: "src/service.ts", name: "run", kind: "function" }]
    });

    const result = verifyTaskOutput(repo, task);

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("Export kind mismatch for src/service.ts#run");
  });
});
