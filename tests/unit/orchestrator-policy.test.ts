import { describe, expect, it, vi, beforeEach } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";
import * as postMergeGate from "../../src/verification/post-merge-gate.js";
import * as shell from "../../src/core/shell.js";

// Mock dependencies
import { LockManager } from "../../src/scheduler/lock-manager.js";
import { LeaseHeartbeat } from "../../src/scheduler/lease-heartbeat.js";
import { MergeQueue } from "../../src/scheduler/merge-queue.js";
import { WorktreeManager } from "../../src/execution/worktree-manager.js";

vi.mock("../../src/scheduler/lock-manager.js", () => ({
  LockManager: class {
    constructor() {}
    tryAcquireWrite() { return [{ resourceKey: "file:test.ts", fencingToken: 1 }]; }
    validateFencing() { return true; }
    releaseOwner() {}
  }
}));

vi.mock("../../src/scheduler/lease-heartbeat.js", () => ({
  LeaseHeartbeat: class {
    constructor() {}
    start() {}
    stopOwner() {}
  }
}));

vi.mock("../../src/scheduler/merge-queue.js", () => ({
  MergeQueue: class {
    constructor() {}
    enqueue(fn: () => Promise<void>) { return fn(); }
  }
}));

vi.mock("../../src/execution/worktree-manager.js", () => ({
  WorktreeManager: class {
    constructor() {}
    create() { return { path: "/tmp/worktree", branch: "orch/run/task" }; }
    remove() { return Promise.resolve(); }
  }
}));

vi.mock("../../src/providers/adapters/index.js", () => ({
  getProviderAdapter: () => ({
    execute: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  })
}));

vi.mock("../../src/verification/post-merge-gate.js", () => ({
  runGate: async () => ({ ok: true, exitCode: 0, stdout: "", stderr: "", command: "gate" })
}));

vi.mock("../../src/verification/commit-analyzer.js", () => ({
  latestCommit: async () => "hash123",
  analyzeCommit: async () => ({ changedFiles: ["src/test.ts"] })
}));

vi.mock("../../src/verification/scope-policy.js", () => ({
  evaluateScope: () => ({ allowed: true, violations: [] })
}));

vi.mock("../../src/verification/output-verifier.js", () => ({
  verifyTaskOutput: () => ({ ok: true })
}));

vi.mock("../../src/verification/staleness.js", () => ({
  collectArtifactSignatures: () => ({}),
  detectStaleness: async () => ({ stale: false, reasons: [] }),
  artifactKey: () => "key"
}));

vi.mock("../../src/core/shell.js", () => ({
  runCommand: async () => ({ code: 0, stdout: "commit message", stderr: "" })
}));

vi.mock("../../src/planning/context-pack.js", () => ({
  buildContextPack: () => ({ contextPackHash: "ctx-hash" })
}));

vi.mock("../../src/planning/prompt-envelope.js", () => ({
  buildPromptEnvelope: () => ({ immutableSectionsHash: "imm-hash", taskContractHash: "contract-hash", contextPackHash: "ctx-hash" }),
  assertPromptDrift: () => {}
}));

describe("Orchestrator Policy Enforcement", () => {
  let orchestrator: any;
  let ctx: any;

  beforeEach(() => {
    orchestrator = new Orchestrator();
    ctx = {
      run: {
        runId: "run-1",
        repoPath: "/repo",
        state: "DISPATCHING" // Fix: Must be in a state that allows transition to INTEGRATING
      },
      config: {
        baselineGateCommand: "pnpm test",
        defaultNetworkPolicy: "deny",
        executionMode: "host",
        containerRuntime: "docker",
        containerImage: "ghcr.io/dmedlin87/gitweaver-runtime:latest",
        forensicRawLogs: false,
        leaseDurationSec: 60,
        leaseRenewSec: 30,
        heartbeatTimeoutSec: 60,
        maxRepairAttemptsPerClass: 0
      },
      db: {
        recordTaskAttempt: () => {},
        upsertTask: () => {},
        upsertLease: () => {},
        listArtifactSignatures: () => ({}),
        getLatestPromptEnvelope: () => null,
        recordPromptEnvelope: () => {},
        recordGateResult: () => {},
        upsertArtifactSignature: () => {},
        removeLeasesByTask: () => {},
        transaction: (fn: any) => fn(),
        recordRepairEvent: () => {},
        upsertRun: () => {}, // Added mock for upsertRun called by persistRun
        upsertProviderHealth: () => {},
        upsertResumeCheckpoint: () => {}
      },
      events: {
        append: () => ({ seq: 1 })
      },
      secureExecutor: {
        prepareEnvironment: (env: NodeJS.ProcessEnv) => env,
        networkAllowed: () => true,
        modeName: () => "host"
      },
      providerHealth: {
        onSuccess: (provider: string) => ({ provider, score: 100, lastErrors: [], tokenBucket: 1 }),
        onFailure: (provider: string) => ({ provider, score: 0, lastErrors: [], tokenBucket: 1 })
      },
      runDir: "/tmp/run",
      onProgress: () => {}
    };
  });

  it("rejects gate command not in allowlist", async () => {
    const task = {
      taskId: "task-bad-gate",
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: { allow: ["src/test.ts"], deny: [] },
      commandPolicy: {
        allow: ["pnpm test"],
        deny: ["rm -rf"],
        network: "deny"
      },
      verify: {
        gateCommand: "rm -rf /",
        outputVerificationRequired: false
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash"
    };

    const record = { attempts: 0, state: "PENDING" };

    await expect(orchestrator.executeTask(
      ctx,
      task,
      record,
      new LockManager(1000),
      new LeaseHeartbeat(new LockManager(1000), 1000),
      new MergeQueue(),
      new WorktreeManager(),
      { increment: () => 1, allowed: () => false },
      new Map(),
      new Map(),
      new Map()
    )).rejects.toMatchObject({
      reasonCode: REASON_CODES.ABORTED_POLICY
    });
  });

  it("rejects gate command matching deny pattern", async () => {
    const task = {
      taskId: "task-deny-gate",
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: { allow: ["src/test.ts"], deny: [] },
      commandPolicy: {
        allow: ["pnpm"],
        deny: ["fail"],
        network: "deny"
      },
      verify: {
        gateCommand: "pnpm run fail",
        outputVerificationRequired: false
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash"
    };

    const record = { attempts: 0, state: "PENDING" };

    await expect(orchestrator.executeTask(
      ctx,
      task,
      record,
      new LockManager(1000),
      new LeaseHeartbeat(new LockManager(1000), 1000),
      new MergeQueue(),
      new WorktreeManager(),
      { increment: () => 1, allowed: () => false },
      new Map(),
      new Map(),
      new Map()
    )).rejects.toMatchObject({
      reasonCode: REASON_CODES.ABORTED_POLICY
    });
  });

  it("reverts on gate failure", async () => {
    const task = {
      taskId: "task-gate-fail",
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: { allow: ["src/test.ts"], deny: [] },
      commandPolicy: {
        allow: ["pnpm test"],
        deny: [],
        network: "deny"
      },
      verify: {
        gateCommand: "pnpm test",
        outputVerificationRequired: false
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash"
    };

    const record = { attempts: 0, state: "PENDING" };

    // Gate will fail
    vi.spyOn(postMergeGate, 'runGate').mockResolvedValueOnce({ ok: false, exitCode: 1, stdout: "", stderr: "failed", command: "pnpm test" });
    const runCommandSpy = vi.spyOn(shell, 'runCommand');

    await expect(orchestrator.executeTask(
      ctx,
      task,
      record,
      new LockManager(1000),
      new LeaseHeartbeat(new LockManager(1000), 1000),
      new MergeQueue(),
      new WorktreeManager(),
      { increment: () => 1, allowed: () => false },
      new Map(),
      new Map(),
      new Map()
    )).rejects.toMatchObject({
      reasonCode: REASON_CODES.MERGE_GATE_FAILED
    });

    const revertCallIndex = runCommandSpy.mock.calls.findIndex(
      call => call[1] && call[1].includes("revert")
    );
    expect(revertCallIndex).toBeGreaterThan(-1);
    const revertArgs = runCommandSpy.mock.calls[revertCallIndex][1];
    expect(revertArgs).toEqual(["-C", "/repo", "revert", "--no-commit", "hash123"]);

    const subsequentCommitCall = runCommandSpy.mock.calls
      .slice(revertCallIndex + 1)
      .find(call => call[1] && call[1].includes("commit"));
    expect(subsequentCommitCall).toBeDefined();
  });
});
