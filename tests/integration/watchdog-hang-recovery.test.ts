/**
 * Integration tests: watchdog-hang recovery + forensic raw-log policy gating.
 *
 * Coverage gaps addressed:
 *  - Hung provider process termination: verifies that a stalled adapter (simulating a
 *    watchdog-killed process) propagates EXEC_FAILED with the correct event sequence.
 *  - Orchestrator provider-heartbeat emission: verifies TASK_PROVIDER_HEARTBEAT events
 *    fire on the 15 s interval during an extended provider stall.
 *  - Forensic raw-log policy gating: verifies TASK_FORENSIC_RAW_CAPTURED is emitted +
 *    file written only when forensicRawLogs=true, and is absent when false.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { LockManager } from "../../src/scheduler/lock-manager.js";
import { LeaseHeartbeat } from "../../src/scheduler/lease-heartbeat.js";
import { MergeQueue } from "../../src/scheduler/merge-queue.js";
import { WorktreeManager } from "../../src/execution/worktree-manager.js";

// ── Controllable adapter state ────────────────────────────────────────────────
let mockAdapterExecution: {
  exitCode: number;
  stdout: string;
  stderr: string;
  rawOutput?: string;
} = { exitCode: 0, stdout: "", stderr: "" };

/** Set > 0 to make the adapter delay that many ms (fake-timer controlled). */
let adapterHangMs = 0;

const tempDirs: string[] = [];

// ── Module mocks (mirrors orchestrator-policy.test.ts) ────────────────────────
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
    execute: async () => {
      if (adapterHangMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, adapterHangMs));
      }
      return mockAdapterExecution;
    }
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
  collectArtifactSignatures: vi.fn(() => ({})),
  detectStaleness: vi.fn(async () => ({ stale: false, reasons: [] })),
  artifactKey: () => "key"
}));

vi.mock("../../src/execution/sandbox-env.js", () => ({
  createSandboxHome: async () => "/tmp/sandbox-home",
  buildSandboxEnv: (env: NodeJS.ProcessEnv) => env
}));

vi.mock("../../src/core/shell.js", () => ({
  runCommand: async () => ({ code: 0, stdout: "commit message", stderr: "" })
}));

vi.mock("../../src/planning/context-pack.js", () => ({
  buildContextPack: () => ({ contextPackHash: "ctx-hash" })
}));

vi.mock("../../src/planning/prompt-envelope.js", () => ({
  buildPromptEnvelope: () => ({
    immutableSectionsHash: "imm-hash",
    taskContractHash: "contract-hash",
    contextPackHash: "ctx-hash"
  }),
  assertPromptDrift: () => {}
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeTask(taskId: string) {
  return {
    taskId,
    provider: "claude",
    type: "code",
    dependencies: [],
    writeScope: { allow: ["src/test.ts"], deny: [] },
    commandPolicy: { allow: ["pnpm test"], deny: [], network: "deny" },
    verify: { gateCommand: "pnpm test", outputVerificationRequired: false },
    artifactIO: {},
    expected: {},
    contractHash: "hash"
  };
}

/** repairBudget that allows repair (default for success-path tests). */
const BUDGET_ALLOW = { increment: () => 1, allowed: () => true };
/** repairBudget that exhausts immediately, causing executeTask to throw on failure. */
const BUDGET_EXHAUSTED = { increment: () => 1, allowed: () => false };

function callExecuteTask(
  orchestrator: Orchestrator,
  ctx: unknown,
  task: unknown,
  record: unknown,
  budget: { increment: () => number; allowed: () => boolean } = BUDGET_ALLOW
) {
  return (orchestrator as any).executeTask(
    ctx, task, record,
    new LockManager(1000),
    new LeaseHeartbeat(new LockManager(1000), 1000),
    new MergeQueue(),
    new WorktreeManager(),
    budget,
    new Map(),
    new Map(),
    new Map()
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────
describe("watchdog-hang recovery + forensic raw-log policy", () => {
  let orchestrator: Orchestrator;
  let ctx: any;

  beforeEach(() => {
    adapterHangMs = 0;
    mockAdapterExecution = { exitCode: 0, stdout: "", stderr: "" };

    orchestrator = new Orchestrator();
    ctx = {
      run: { runId: "run-watchdog", repoPath: "/repo", state: "DISPATCHING" },
      config: {
        baselineGateCommand: "pnpm test",
        defaultNetworkPolicy: "deny",
        executionMode: "host",
        containerRuntime: "docker",
        containerImage: "ghcr.io/test/image:latest",
        forensicRawLogs: false,
        leaseDurationSec: 60,
        leaseRenewSec: 30,
        lockContentionRetryMax: 1,
        lockContentionBackoffMs: 1,
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
        upsertRun: () => {},
        upsertProviderHealth: () => {},
        upsertResumeCheckpoint: () => {}
      },
      events: { append: vi.fn(() => ({ seq: 1 })) },
      secureExecutor: {
        prepareEnvironment: (env: NodeJS.ProcessEnv) => env,
        networkAllowed: () => true,
        modeName: () => "host"
      },
      providerHealth: {
        onSuccess: (p: string) => ({ provider: p, score: 100, lastErrors: [], tokenBucket: 1 }),
        onFailure: (p: string) => ({ provider: p, score: 0, lastErrors: [], tokenBucket: 1 })
      },
      runDir: "/tmp/run-watchdog",
      onProgress: () => {}
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  // ── Watchdog-hang failure path ─────────────────────────────────────────────

  it("rejects with EXEC_FAILED when hung provider process returns non-zero exit code", async () => {
    // Simulates a watchdog-killed process: PtyManager resolves with the kill signal exit code.
    // Repair budget is exhausted so executeTask escalates and throws.
    mockAdapterExecution = { exitCode: 130, stdout: "", stderr: "process killed by signal" };

    const task = makeTask("task-hang-execfail");
    const record = { attempts: 0, state: "PENDING" };

    await expect(
      callExecuteTask(orchestrator, ctx, task, record, BUDGET_EXHAUSTED)
    ).rejects.toMatchObject({
      message: expect.stringContaining("task-hang-execfail")
    });
  });

  it("emits TASK_PROVIDER_FINISH with the kill exit code before propagating failure", async () => {
    mockAdapterExecution = { exitCode: 137, stdout: "", stderr: "SIGKILL" };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-hang-finish-event");
    const record = { attempts: 0, state: "PENDING" };

    await expect(
      callExecuteTask(orchestrator, ctx, task, record, BUDGET_EXHAUSTED)
    ).rejects.toBeDefined();

    const finishCall = appendSpy.mock.calls.find((c) => c[1] === "TASK_PROVIDER_FINISH");
    expect(finishCall).toBeDefined();
    expect((finishCall?.[2] as { exitCode: number }).exitCode).toBe(137);
  });

  it("emits TASK_PROVIDER_START before TASK_PROVIDER_FINISH on hung execution", async () => {
    mockAdapterExecution = { exitCode: 130, stdout: "", stderr: "" };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-hang-event-order");
    const record = { attempts: 0, state: "PENDING" };

    await expect(
      callExecuteTask(orchestrator, ctx, task, record, BUDGET_EXHAUSTED)
    ).rejects.toBeDefined();

    const eventTypes = appendSpy.mock.calls.map((c) => c[1] as string);
    const startIdx = eventTypes.indexOf("TASK_PROVIDER_START");
    const finishIdx = eventTypes.indexOf("TASK_PROVIDER_FINISH");

    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(finishIdx).toBeGreaterThan(startIdx);
  });

  // ── Orchestrator heartbeat emission during stall ───────────────────────────

  it("emits TASK_PROVIDER_HEARTBEAT events during an extended provider stall", async () => {
    vi.useFakeTimers();

    // Adapter simulates a 40 s stall; orchestrator heartbeat fires every 15 s.
    adapterHangMs = 40_000;
    mockAdapterExecution = { exitCode: 0, stdout: "", stderr: "" };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-heartbeat-stall");
    const record = { attempts: 0, state: "PENDING" };

    const execPromise = callExecuteTask(orchestrator, ctx, task, record);

    // Advance past two heartbeat ticks (15 s and 30 s)
    await vi.advanceTimersByTimeAsync(32_000);
    // Advance past the adapter hang so it resolves
    await vi.advanceTimersByTimeAsync(10_000);
    await execPromise;

    const heartbeatCalls = appendSpy.mock.calls.filter(
      (c) => c[1] === "TASK_PROVIDER_HEARTBEAT"
    );
    expect(heartbeatCalls.length).toBeGreaterThanOrEqual(2);
  });

  it("emits TASK_PROVIDER_START before any TASK_PROVIDER_HEARTBEAT events", async () => {
    vi.useFakeTimers();

    adapterHangMs = 20_000;
    mockAdapterExecution = { exitCode: 0, stdout: "", stderr: "" };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-start-before-heartbeat");
    const record = { attempts: 0, state: "PENDING" };

    const execPromise = callExecuteTask(orchestrator, ctx, task, record);
    await vi.advanceTimersByTimeAsync(22_000);
    await execPromise;

    const eventTypes = appendSpy.mock.calls.map((c) => c[1] as string);
    const startIdx = eventTypes.indexOf("TASK_PROVIDER_START");
    const heartbeatIdx = eventTypes.indexOf("TASK_PROVIDER_HEARTBEAT");

    expect(startIdx).toBeGreaterThanOrEqual(0);
    if (heartbeatIdx >= 0) {
      expect(startIdx).toBeLessThan(heartbeatIdx);
    }
  });

  it("heartbeat interval is cleared after provider resolves", async () => {
    vi.useFakeTimers();

    adapterHangMs = 5_000;
    mockAdapterExecution = { exitCode: 0, stdout: "", stderr: "" };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-heartbeat-cleared");
    const record = { attempts: 0, state: "PENDING" };

    const execPromise = callExecuteTask(orchestrator, ctx, task, record);
    await vi.advanceTimersByTimeAsync(6_000);
    await execPromise;

    const countAfterResolve = appendSpy.mock.calls.filter(
      (c) => c[1] === "TASK_PROVIDER_HEARTBEAT"
    ).length;

    // Advance an additional 30 s after the adapter resolved — no more heartbeats
    await vi.advanceTimersByTimeAsync(30_000);

    const countLater = appendSpy.mock.calls.filter(
      (c) => c[1] === "TASK_PROVIDER_HEARTBEAT"
    ).length;

    expect(countLater).toBe(countAfterResolve);
  });

  // ── Forensic raw-log policy gating ────────────────────────────────────────

  it("does not emit TASK_FORENSIC_RAW_CAPTURED when forensicRawLogs is false", async () => {
    ctx.config.forensicRawLogs = false;
    mockAdapterExecution = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      rawOutput: "sensitive provider output"
    };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-forensic-off");
    const record = { attempts: 0, state: "PENDING" };

    await callExecuteTask(orchestrator, ctx, task, record);

    const forensicCall = appendSpy.mock.calls.find(
      (c) => c[1] === "TASK_FORENSIC_RAW_CAPTURED"
    );
    expect(forensicCall).toBeUndefined();
  });

  it("emits TASK_FORENSIC_RAW_CAPTURED and writes file artifact when forensicRawLogs is true", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "gw-watchdog-forensic-"));
    tempDirs.push(runDir);
    ctx.runDir = runDir;
    ctx.config.forensicRawLogs = true;
    mockAdapterExecution = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      rawOutput: "watchdog raw capture data"
    };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-forensic-on");
    const record = { attempts: 0, state: "PENDING" };

    await callExecuteTask(orchestrator, ctx, task, record);

    const forensicCall = appendSpy.mock.calls.find(
      (c) => c[1] === "TASK_FORENSIC_RAW_CAPTURED"
    );
    expect(forensicCall).toBeDefined();

    const payload = forensicCall?.[2] as { path: string; taskId: string; attempt: number };
    expect(payload.taskId).toBe("task-forensic-on");
    expect(existsSync(payload.path)).toBe(true);
    expect(readFileSync(payload.path, "utf8")).toContain("watchdog raw capture data");
  });

  it("forensic file path encodes taskId and attempt number", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "gw-watchdog-forensic-path-"));
    tempDirs.push(runDir);
    ctx.runDir = runDir;
    ctx.config.forensicRawLogs = true;
    mockAdapterExecution = { exitCode: 0, stdout: "", stderr: "", rawOutput: "output" };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-forensic-path");
    // attempts starts at 1; executeTask increments to 2, so file path uses attempt-2
    const record = { attempts: 1, state: "PENDING" };

    await callExecuteTask(orchestrator, ctx, task, record);

    const forensicCall = appendSpy.mock.calls.find(
      (c) => c[1] === "TASK_FORENSIC_RAW_CAPTURED"
    );
    const path = (forensicCall?.[2] as { path: string }).path;
    expect(path).toContain("task-forensic-path");
    expect(path).toContain("attempt-2");
    expect(path).toContain(".raw.log");
  });

  it("forensic file is not written when rawOutput is absent even if forensicRawLogs is true", async () => {
    const runDir = mkdtempSync(join(tmpdir(), "gw-watchdog-forensic-empty-"));
    tempDirs.push(runDir);
    ctx.runDir = runDir;
    ctx.config.forensicRawLogs = true;
    // rawOutput explicitly absent
    mockAdapterExecution = { exitCode: 0, stdout: "no raw", stderr: "" };

    const appendSpy = vi.fn(() => ({ seq: 1 }));
    ctx.events.append = appendSpy;

    const task = makeTask("task-forensic-no-raw");
    const record = { attempts: 0, state: "PENDING" };

    await callExecuteTask(orchestrator, ctx, task, record);

    const forensicCall = appendSpy.mock.calls.find(
      (c) => c[1] === "TASK_FORENSIC_RAW_CAPTURED"
    );
    expect(forensicCall).toBeUndefined();
  });
});
