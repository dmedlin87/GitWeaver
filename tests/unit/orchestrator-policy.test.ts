import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";
import { DEFAULT_CONTAINER_IMAGE } from "../../src/core/config.js";
import * as postMergeGate from "../../src/verification/post-merge-gate.js";
import * as shell from "../../src/core/shell.js";
import * as staleness from "../../src/verification/staleness.js";

// Mock dependencies
import { LockManager } from "../../src/scheduler/lock-manager.js";
import { LeaseHeartbeat } from "../../src/scheduler/lease-heartbeat.js";
import { MergeQueue } from "../../src/scheduler/merge-queue.js";
import { WorktreeManager } from "../../src/execution/worktree-manager.js";

let mockAdapterExecution: {
  exitCode: number;
  stdout: string;
  stderr: string;
  rawOutput?: string;
} = {
  exitCode: 0,
  stdout: "",
  stderr: "",
};
const tempDirs: string[] = [];
const mockAdapterExecute = vi.fn(async () => mockAdapterExecution);

vi.mock("../../src/scheduler/lock-manager.js", () => ({
  LockManager: class {
    constructor() {}
    tryAcquireWrite() {
      return [{ resourceKey: "file:test.ts", fencingToken: 1 }];
    }
    validateFencing() {
      return true;
    }
    releaseOwner() {}
  },
}));

vi.mock("../../src/scheduler/lease-heartbeat.js", () => ({
  LeaseHeartbeat: class {
    constructor() {}
    start() {}
    stopOwner() {}
  },
}));

vi.mock("../../src/scheduler/merge-queue.js", () => ({
  MergeQueue: class {
    constructor() {}
    enqueue(fn: () => Promise<void>) {
      return fn();
    }
  },
}));

vi.mock("../../src/execution/worktree-manager.js", () => ({
  WorktreeManager: class {
    constructor() {}
    create() {
      return { path: "/tmp/worktree", branch: "orch/run/task" };
    }
    remove() {
      return Promise.resolve();
    }
  },
}));

vi.mock("../../src/providers/adapters/index.js", () => ({
  getProviderAdapter: () => ({
    execute: mockAdapterExecute,
  }),
}));

vi.mock("../../src/verification/post-merge-gate.js", () => ({
  runGate: async () => ({
    ok: true,
    exitCode: 0,
    stdout: "",
    stderr: "",
    command: "gate",
  }),
}));

vi.mock("../../src/verification/commit-analyzer.js", () => ({
  latestCommit: async () => "hash123",
  analyzeCommit: async () => ({ changedFiles: ["src/test.ts"] }),
}));

vi.mock("../../src/verification/scope-policy.js", () => ({
  evaluateScope: () => ({ allowed: true, violations: [] }),
}));

vi.mock("../../src/verification/output-verifier.js", () => ({
  verifyTaskOutput: () => ({ ok: true }),
}));

vi.mock("../../src/verification/staleness.js", () => ({
  collectArtifactSignatures: vi.fn(() => ({})),
  detectStaleness: vi.fn(async () => ({ stale: false, reasons: [] })),
  artifactKey: () => "key",
}));

vi.mock("../../src/execution/sandbox-env.js", () => ({
  createSandboxHome: async () => "/tmp/sandbox-home",
  buildSandboxEnv: (env: NodeJS.ProcessEnv) => env,
}));

vi.mock("../../src/core/shell.js", () => ({
  runCommand: async () => ({ code: 0, stdout: "commit message", stderr: "" }),
}));

vi.mock("../../src/planning/context-pack.js", () => ({
  buildContextPack: () => ({ contextPackHash: "ctx-hash" }),
}));

vi.mock("../../src/planning/prompt-envelope.js", () => ({
  buildPromptEnvelope: () => ({
    immutableSectionsHash: "imm-hash",
    taskContractHash: "contract-hash",
    contextPackHash: "ctx-hash",
  }),
  assertPromptDrift: () => {},
}));

describe("Orchestrator Policy Enforcement", () => {
  let orchestrator: any;
  let ctx: any;

  beforeEach(() => {
    mockAdapterExecution = {
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
    mockAdapterExecute.mockClear();
    orchestrator = new Orchestrator();
    ctx = {
      run: {
        runId: "run-1",
        repoPath: "/repo",
        state: "VERIFYING", // State allows transition to INTEGRATING and REPLANNING
      },
      config: {
        baselineGateCommand: "pnpm test",
        defaultNetworkPolicy: "deny",
        executionMode: "host",
        containerRuntime: "docker",
        containerImage: DEFAULT_CONTAINER_IMAGE,
        forensicRawLogs: false,
        leaseDurationSec: 60,
        leaseRenewSec: 30,
        lockContentionRetryMax: 1,
        lockContentionBackoffMs: 1,
        heartbeatTimeoutSec: 60,
        providerExecutionTimeoutSec: 600,
        maxRepairAttemptsPerClass: 0,
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
        listRepairEvents: () => [],
        upsertRun: () => {}, // Added mock for upsertRun called by persistRun
        upsertProviderHealth: () => {},
        upsertResumeCheckpoint: () => {},
        listAxioms: () => [],
        listRecentVerifiedTasks: () => [],
      },
      events: {
        append: () => ({ seq: 1 }),
      },
      secureExecutor: {
        prepareEnvironment: (env: NodeJS.ProcessEnv) => env,
        networkAllowed: () => true,
        modeName: () => "host",
      },
      providerHealth: {
        onSuccess: (provider: string) => ({
          provider,
          score: 100,
          lastErrors: [],
          tokenBucket: 1,
        }),
        onFailure: (provider: string) => ({
          provider,
          score: 0,
          lastErrors: [],
          tokenBucket: 1,
        }),
      },
      runDir: "/tmp/run",
      onProgress: () => {},
    };
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("rejects entering MERGE_QUEUED if lease token expires", async () => {
    const task = {
      taskId: "task-lease-expire",
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: { allow: ["src/test.ts"], deny: [] },
      commandPolicy: {
        allow: ["pnpm test"],
        deny: [],
        network: "deny",
      },
      verify: {
        gateCommand: "pnpm test",
        outputVerificationRequired: false,
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash",
    };

    const record: { attempts: number; state: string; reasonCode?: string } = {
      attempts: 0,
      state: "PENDING",
    };

    // Create a LockManager where validateFencing explicitly returns false
    const failingLockManager = new LockManager(1000);
    vi.spyOn(failingLockManager, "validateFencing").mockReturnValue(false);

    await expect(
      orchestrator.executeTask(
        ctx,
        task,
        record,
        failingLockManager,
        new LeaseHeartbeat(failingLockManager, 1000),
        new MergeQueue(),
        new WorktreeManager(),
        { increment: () => 1, allowed: () => false },
        new Map(),
        new Map(),
        new Map(),
      ),
    ).rejects.toMatchObject({
      reasonCode: REASON_CODES.LOCK_TIMEOUT,
    });
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
        network: "deny",
      },
      verify: {
        gateCommand: "rm -rf /",
        outputVerificationRequired: false,
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash",
    };

    const record: { attempts: number; state: string; reasonCode?: string } = {
      attempts: 0,
      state: "PENDING",
    };

    await expect(
      orchestrator.executeTask(
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
        new Map(),
      ),
    ).rejects.toMatchObject({
      reasonCode: REASON_CODES.ABORTED_POLICY,
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
        network: "deny",
      },
      verify: {
        gateCommand: "pnpm run fail",
        outputVerificationRequired: false,
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash",
    };

    const record = { attempts: 0, state: "PENDING" };

    await expect(
      orchestrator.executeTask(
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
        new Map(),
      ),
    ).rejects.toMatchObject({
      reasonCode: REASON_CODES.ABORTED_POLICY,
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
        network: "deny",
      },
      verify: {
        gateCommand: "pnpm test",
        outputVerificationRequired: false,
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash",
    };

    const record = { attempts: 0, state: "PENDING" };

    // Gate will fail
    vi.spyOn(postMergeGate, "runGate").mockResolvedValueOnce({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "failed",
      command: "pnpm test",
    });
    const runCommandSpy = vi.spyOn(shell, "runCommand");

    await expect(
      orchestrator.executeTask(
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
        new Map(),
      ),
    ).rejects.toMatchObject({
      reasonCode: REASON_CODES.MERGE_GATE_FAILED,
    });

    const revertCallIndex = runCommandSpy.mock.calls.findIndex(
      (call) => call[1] && call[1].includes("revert"),
    );
    expect(revertCallIndex).toBeGreaterThan(-1);
    const revertArgs = runCommandSpy.mock.calls[revertCallIndex][1];
    expect(revertArgs).toEqual([
      "-C",
      "/repo",
      "revert",
      "--no-commit",
      "hash123",
    ]);

    const subsequentCommitCall = runCommandSpy.mock.calls
      .slice(revertCallIndex + 1)
      .find((call) => call[1] && call[1].includes("commit"));
    expect(subsequentCommitCall).toBeDefined();
  });

  it("requeues stale task through replanning path instead of creating repair task", async () => {
    vi.mocked(staleness.detectStaleness).mockResolvedValueOnce({
      stale: true,
      reasons: ["base commit drift detected"],
    });

    const task = {
      taskId: "task-stale",
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: { allow: ["src/test.ts"], deny: [] },
      commandPolicy: {
        allow: ["pnpm test"],
        deny: [],
        network: "deny",
      },
      verify: {
        gateCommand: "pnpm test",
        outputVerificationRequired: false,
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash",
    };

    const record: { attempts: number; state: string; reasonCode?: string } = {
      attempts: 0,
      state: "PENDING",
    };
    const taskById = new Map<string, unknown>();

    await orchestrator.executeTask(
      ctx,
      task,
      record,
      new LockManager(1000),
      new LeaseHeartbeat(new LockManager(1000), 1000),
      new MergeQueue(),
      new WorktreeManager(),
      { increment: () => 1, allowed: () => true },
      new Map(),
      taskById,
      new Map(),
    );

    expect(record.state).toBe("PENDING");
    expect(record.reasonCode).toBe(REASON_CODES.STALE_REPLAN_TRIGGERED);
    expect(taskById.size).toBe(0);
  });

  it("persists checkpoint before integrate to support crash-mid-merge recovery", async () => {
    const checkpointSpy = vi.fn();
    ctx.db.upsertResumeCheckpoint = checkpointSpy;
    vi.spyOn(orchestrator, "integrateCommit").mockRejectedValueOnce(
      Object.assign(new Error("crash mid merge"), {
        reasonCode: REASON_CODES.MERGE_CONFLICT,
      }),
    );

    const task = {
      taskId: "task-merge-crash",
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: { allow: ["src/test.ts"], deny: [] },
      commandPolicy: {
        allow: ["pnpm test"],
        deny: [],
        network: "deny",
      },
      verify: {
        gateCommand: "pnpm test",
        outputVerificationRequired: false,
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash",
    };

    const record = { attempts: 0, state: "PENDING" };

    await orchestrator.executeTask(
      ctx,
      task,
      record,
      new LockManager(1000),
      new LeaseHeartbeat(new LockManager(1000), 1000),
      new MergeQueue(),
      new WorktreeManager(),
      { increment: () => 1, allowed: () => true },
      new Map(),
      new Map(),
      new Map(),
    );

    expect(checkpointSpy).toHaveBeenCalledWith(
      "run-1",
      "task-merge-crash",
      "MERGE_QUEUED",
      1,
      "hash123",
    );
  });

  it("captures raw forensic logs only when forensic policy is enabled", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "gw-orch-policy-forensics-"));
    tempDirs.push(runDir);
    ctx.runDir = runDir;
    ctx.config.forensicRawLogs = true;
    const appendSpy = vi.fn((..._args: unknown[]) => ({ seq: 1 }));
    ctx.events.append = appendSpy;
    mockAdapterExecution = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      rawOutput: "provider raw output",
    };

    const task = {
      taskId: "task-forensics",
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: { allow: ["src/test.ts"], deny: [] },
      commandPolicy: {
        allow: ["pnpm test"],
        deny: [],
        network: "deny",
      },
      verify: {
        gateCommand: "pnpm test",
        outputVerificationRequired: false,
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash",
    };

    const record = { attempts: 0, state: "PENDING" };

    await orchestrator.executeTask(
      ctx,
      task,
      record,
      new LockManager(1000),
      new LeaseHeartbeat(new LockManager(1000), 1000),
      new MergeQueue(),
      new WorktreeManager(),
      { increment: () => 1, allowed: () => true },
      new Map(),
      new Map(),
      new Map(),
    );

    const forensicEvent = appendSpy.mock.calls.find(
      (call) => call[1] === "TASK_FORENSIC_RAW_CAPTURED",
    );
    expect(forensicEvent).toBeDefined();
    const payload = forensicEvent?.[2] as { path: string };
    expect(existsSync(payload.path)).toBe(true);
    expect(readFileSync(payload.path, "utf8")).toContain("provider raw output");
  });
  it("uses providerExecutionTimeoutSec for adapter timeout instead of heartbeatTimeoutSec", async () => {
    ctx.config.heartbeatTimeoutSec = 5;
    ctx.config.providerExecutionTimeoutSec = 123;

    const task = {
      taskId: "task-provider-timeout",
      provider: "claude",
      type: "code",
      dependencies: [],
      writeScope: { allow: ["src/test.ts"], deny: [] },
      commandPolicy: {
        allow: ["pnpm test"],
        deny: [],
        network: "deny",
      },
      verify: {
        gateCommand: "pnpm test",
        outputVerificationRequired: false,
      },
      artifactIO: {},
      expected: {},
      contractHash: "hash",
    };

    const record = { attempts: 0, state: "PENDING" };

    await orchestrator.executeTask(
      ctx,
      task,
      record,
      new LockManager(1000),
      new LeaseHeartbeat(new LockManager(1000), 1000),
      new MergeQueue(),
      new WorktreeManager(),
      { increment: () => 1, allowed: () => true },
      new Map(),
      new Map(),
      new Map(),
    );

    expect(mockAdapterExecute).toHaveBeenCalledTimes(1);
    const call = mockAdapterExecute.mock.calls[0];
    expect(call?.[0]?.timeoutMs).toBe(123_000);
  });

});
