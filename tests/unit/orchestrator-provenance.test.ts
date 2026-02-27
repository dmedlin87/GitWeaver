import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { DEFAULT_CONFIG } from "../../src/core/config.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gw-orch-provenance-"));
  tempDirs.push(dir);
  return dir;
}

function makeCtx(runDir: string): any {
  mkdirSync(runDir, { recursive: true });
  const now = new Date().toISOString();

  return {
    run: {
      runId: "run-test",
      objective: "objective",
      repoPath: process.cwd(),
      baselineCommit: "abc123",
      configHash: "cfg-hash",
      state: "BASELINE_OK",
      createdAt: now,
      updatedAt: now
    },
    config: DEFAULT_CONFIG,
    runDir,
    db: {
      upsertRun: () => undefined
    },
    events: {
      append: () => undefined
    },
    providerVersions: {},
    routeDecisions: []
  };
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("orchestrator provenance helpers", () => {
  it("records provider versions from preflight snapshots", () => {
    const orchestrator = new Orchestrator() as any;
    const ctx = makeCtx(makeTempDir());

    orchestrator.recordProviderVersions(ctx, [
      {
        provider: "codex",
        installed: true,
        versionInstalled: "1.2.3",
        versionLatest: "1.2.3",
        authStatus: "OK",
        healthStatus: "HEALTHY",
        issues: []
      },
      {
        provider: "gemini",
        installed: true,
        versionLatest: "9.9.9",
        authStatus: "UNKNOWN",
        healthStatus: "DEGRADED",
        issues: []
      }
    ]);

    expect(ctx.providerVersions.codex).toBe("1.2.3");
    expect(ctx.providerVersions.gemini).toBe("9.9.9");
  });

  it("writes routed plan metadata and manifest with provider versions", async () => {
    const orchestrator = new Orchestrator() as any;
    const runDir = makeTempDir();
    const ctx = makeCtx(runDir);
    ctx.providerVersions.codex = "1.2.3";

    const dag = await orchestrator.plan(ctx, {
      prompt: "Implement a small change",
      dryRun: true
    });

    expect(ctx.routeDecisions).toHaveLength(1);
    expect(ctx.routeDecisions[0]).toMatchObject({
      taskId: "task-1",
      taskType: "code",
      routedProvider: "claude"
    });

    const routed = readJson(join(runDir, "plan.routed.json"));
    expect(routed.routeDecisions).toHaveLength(1);
    expect(routed.routeDecisions[0].routingReason).toContain("task type prefers Claude");

    orchestrator.writeManifest(ctx, dag);
    const manifest = readJson(join(runDir, "manifest.json"));
    expect(manifest.providerVersions.codex).toBe("1.2.3");
    expect(manifest.dagHash).toBe(dag.dagHash);
  });
});
