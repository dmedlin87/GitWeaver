import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
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


  it("persists manifest before stage-B preflight can abort", async () => {
    const orchestrator = new Orchestrator() as any;
    const writes: string[] = [];

    const persistRunSpy = vi.spyOn(orchestrator, "persistRun").mockImplementation(() => undefined);
    const progressSpy = vi.spyOn(orchestrator, "progress").mockImplementation(() => undefined);
    const preflightASpy = vi.spyOn(orchestrator, "preflightStageA").mockImplementation(async (ctx: any) => {
      ctx.providerVersions.codex = "1.0.0";
    });
    const ensureBaselineSpy = vi.spyOn(orchestrator, "ensureBaseline").mockImplementation(async () => undefined);
    const planSpy = vi.spyOn(orchestrator, "plan").mockResolvedValue({
      nodes: [
        {
          taskId: "task-1",
          title: "title",
          provider: "claude",
          type: "code",
          dependencies: [],
          writeScope: { allow: [], deny: [], ownership: "exclusive" },
          commandPolicy: { allow: [], deny: [], network: "deny" },
          expected: {},
          verify: { outputVerificationRequired: false },
          artifactIO: {},
          contractHash: "h1"
        }
      ],
      edges: [],
      dagHash: "dag-hash"
    });
    const writeManifestSpy = vi.spyOn(orchestrator, "writeManifest").mockImplementation((ctx: any) => {
      writes.push(JSON.stringify(ctx.providerVersions));
    });
    const preflightBSpy = vi.spyOn(orchestrator, "preflightStageB").mockImplementation(async () => {
      throw new Error("stage-b failed");
    });
    const completeRunSpy = vi.spyOn(orchestrator, "completeRun").mockImplementation((ctx: any, state: string) => ({
      runId: ctx.run.runId,
      state,
      summary: {}
    }));
    const resolveRepoSpy = vi.spyOn(orchestrator, "resolveRepo").mockResolvedValue(process.cwd());
    const gitHeadSpy = vi.spyOn(orchestrator, "gitHead").mockResolvedValue("baseline-sha");

    const outcome = await orchestrator.run({
      prompt: "test",
      dryRun: true
    });

    expect(outcome.state).toBe("ABORTED_POLICY");
    expect(writes.length).toBe(1);
    const manifestCallOrder = writeManifestSpy.mock.invocationCallOrder[0];
    const preflightBCallOrder = preflightBSpy.mock.invocationCallOrder[0];
    expect(manifestCallOrder).toBeLessThan(preflightBCallOrder);

    persistRunSpy.mockRestore();
    progressSpy.mockRestore();
    preflightASpy.mockRestore();
    ensureBaselineSpy.mockRestore();
    planSpy.mockRestore();
    writeManifestSpy.mockRestore();
    preflightBSpy.mockRestore();
    completeRunSpy.mockRestore();
    resolveRepoSpy.mockRestore();
    gitHeadSpy.mockRestore();
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
