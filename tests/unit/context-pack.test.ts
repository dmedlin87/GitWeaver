import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildContextPack } from "../../src/planning/context-pack.js";
import { sha256 } from "../../src/core/hash.js";
import type { TaskContract } from "../../src/core/types.js";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ContextPack", () => {
  let repoPath: string;

  beforeEach(() => {
    repoPath = join(tmpdir(), "context-pack-test-" + Math.random().toString(36).slice(2));
    mkdirSync(repoPath, { recursive: true });

    // Create baseline files
    writeFileSync(join(repoPath, "package.json"), '{"name": "test"}');
    writeFileSync(join(repoPath, "tsconfig.json"), '{"compilerOptions": {}}');

    mkdirSync(join(repoPath, "src"), { recursive: true });
    writeFileSync(join(repoPath, "src/index.ts"), 'export const a = 1;');

    // Create task specific files
    writeFileSync(join(repoPath, "file-a.ts"), 'const a = 1;');
    writeFileSync(join(repoPath, "file-b.ts"), 'const b = 2;');
    writeFileSync(join(repoPath, "file-c.ts"), 'const c = 3;');
  });

  afterEach(() => {
    rmSync(repoPath, { recursive: true, force: true });
  });

  it("is deterministic in file ordering", () => {
    const task1: TaskContract = {
      taskId: "task-1",
      title: "Task 1",
      description: "Test task",
      provider: "claude",
      writeScope: {
        allow: ["file-b.ts", "file-a.ts"],
        deny: []
      },
      commandPolicy: {
        allow: [],
        deny: []
      },
      artifactIO: {
        consumes: ["file-c.ts"]
      },
      dependencies: []
    };

    const task2: TaskContract = {
      taskId: "task-1", // same task ID for testing hash equivalence
      title: "Task 1",
      description: "Test task",
      provider: "claude",
      writeScope: {
        allow: ["file-a.ts", "file-b.ts"], // different order
        deny: []
      },
      commandPolicy: {
        allow: [],
        deny: []
      },
      artifactIO: {
        consumes: ["file-c.ts"]
      },
      dependencies: []
    };

    const pack1 = buildContextPack(repoPath, task1);
    const pack2 = buildContextPack(repoPath, task2);

    expect(pack1.should.map(f => f.path)).toEqual(["file-a.ts", "file-b.ts"]);
    expect(pack2.should.map(f => f.path)).toEqual(["file-a.ts", "file-b.ts"]);
    expect(pack1.contextPackHash).toBe(pack2.contextPackHash);
  });

  it("produces deterministic hash repeatedly", () => {
    const task: TaskContract = {
      taskId: "task-2",
      title: "Task 2",
      description: "Test task",
      provider: "claude",
      writeScope: {
        allow: ["file-a.ts"],
        deny: []
      },
      commandPolicy: {
        allow: [],
        deny: []
      },
      artifactIO: {
        consumes: []
      },
      dependencies: []
    };

    const pack1 = buildContextPack(repoPath, task);
    const pack2 = buildContextPack(repoPath, task);

    expect(pack1.contextPackHash).toBe(pack2.contextPackHash);
  });

  it("respects byte budget by truncating optional/should tiers", () => {
    const task: TaskContract = {
      taskId: "task-3",
      title: "Task 3",
      description: "Test task",
      provider: "claude",
      writeScope: {
        allow: ["file-a.ts", "file-b.ts"],
        deny: []
      },
      commandPolicy: {
        allow: [],
        deny: []
      },
      artifactIO: {
        consumes: ["file-c.ts"]
      },
      dependencies: []
    };

    // Calculate budget such that package.json + tsconfig.json + file-a.ts fit, but file-b.ts does not
    const baseSizeBytes = Buffer.byteLength('{"name": "test"}') +
                          Buffer.byteLength('{"compilerOptions": {}}') +
                          Buffer.byteLength('export const a = 1;');

    // Add file-a.ts
    const budget = baseSizeBytes + Buffer.byteLength('const a = 1;') + 1; // plus a byte just in case

    const pack = buildContextPack(repoPath, task, budget);

    // must tier always fits regardless of budget in logic, but wait, the logic checks:
    // if (selectedTotalBytes + size > byteBudget && candidate.tier !== "must") { continue; }
    // must files are at index 0, 1, 2
    // then 'file-a.ts', 'file-b.ts'

    expect(pack.must.length).toBe(3); // package.json, tsconfig.json, src/index.ts

    // file-a.ts fits, file-b.ts does not
    expect(pack.should.length).toBe(1);
    expect(pack.should[0].path).toBe("file-a.ts");

    // file-c.ts definitely does not fit
    expect(pack.optional.length).toBe(0);
  });

  it("handles duplicate paths correctly", () => {
    const task: TaskContract = {
      taskId: "task-4",
      title: "Task 4",
      description: "Test task",
      provider: "claude",
      writeScope: {
        allow: ["src/index.ts", "file-a.ts"], // src/index.ts is already in must tier
        deny: []
      },
      commandPolicy: {
        allow: [],
        deny: []
      },
      artifactIO: {
        consumes: ["file-a.ts"] // already in should tier
      },
      dependencies: []
    };

    const pack = buildContextPack(repoPath, task);

    // duplicate src/index.ts should only appear in must
    expect(pack.must.map(f => f.path)).toContain("src/index.ts");
    expect(pack.should.map(f => f.path)).not.toContain("src/index.ts");

    // duplicate file-a.ts should appear in should, not optional
    expect(pack.should.map(f => f.path)).toContain("file-a.ts");
    expect(pack.optional.map(f => f.path)).not.toContain("file-a.ts");
  });
});
