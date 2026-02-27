import { describe, expect, it, vi, beforeEach } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";

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
        upsertRun: () => {} // Added mock for upsertRun called by persistRun
      },
      events: {
        append: () => {}
      },
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
        deny: ["rm -rf"]
      },
      verify: {
        gateCommand: "rm -rf /",
        outputVerificationRequired: false
      },
      artifactIO: {}
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
        deny: ["fail"]
      },
      verify: {
        gateCommand: "pnpm run fail",
        outputVerificationRequired: false
      },
      artifactIO: {}
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
});
