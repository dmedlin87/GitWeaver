
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";
import { makeTaskContract } from "../helpers/runtime-context-fixture.js";

// Mock dependencies
vi.mock("../../src/core/shell.js", () => ({
  runCommand: vi.fn().mockImplementation(async (cmd, args) => {
    if (args.includes("status") && args.includes("--porcelain")) {
      return { code: 0, stdout: "", stderr: "" };
    }
    if (args.includes("rev-parse")) {
      return { code: 0, stdout: "commit-0", stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  }),
  runShellLine: vi.fn()
}));

vi.mock("../../src/planning/planner-codex.js", () => ({
  generateDagWithCodex: vi.fn()
}));

vi.mock("../../src/providers/adapters/index.js", () => ({
  getProviderAdapter: vi.fn()
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn().mockImplementation((path) => {
      if (path.includes("package.json")) return '{"name":"test"}';
      return "{}";
    }),
    existsSync: vi.fn().mockReturnValue(true),
    readdirSync: vi.fn().mockReturnValue([]),
    statSync: vi.fn().mockReturnValue({ isDirectory: () => false, isFile: () => true, size: 0, mtime: new Date() })
  };
});

vi.mock("../../src/persistence/sqlite.js", () => {
  function OrchestratorDb() {
    return {
      migrate: vi.fn(),
      close: vi.fn(),
      upsertRun: vi.fn(),
      upsertTask: vi.fn(),
      recordTaskAttempt: vi.fn(),
      listProviderHealth: vi.fn().mockReturnValue([]),
      upsertProviderHealth: vi.fn(),
      listRecentVerifiedTasks: vi.fn().mockReturnValue([]),
      listRepairEvents: vi.fn().mockReturnValue([]),
      listAxioms: vi.fn().mockReturnValue([]),
      getLatestPromptEnvelope: vi.fn().mockReturnValue(null),
      recordPromptEnvelope: vi.fn(),
      upsertAxiom: vi.fn(),
      listArtifactSignatures: vi.fn().mockReturnValue({}),
      upsertArtifactSignature: vi.fn(),
      removeLeasesByTask: vi.fn(),
      upsertLease: vi.fn(),
      recordGateResult: vi.fn(),
      upsertResumeCheckpoint: vi.fn(),
      recordRepairEvent: vi.fn(),
      transaction: vi.fn((cb) => cb())
    };
  }
  return {
    OrchestratorDb,
    isSqliteBusyError: vi.fn().mockReturnValue(false)
  };
});

vi.mock("../../src/persistence/event-log.js", () => {
  function EventLog() {
    return {
      append: vi.fn().mockReturnValue({ seq: 1 })
    };
  }
  return { EventLog };
});

vi.mock("../../src/execution/worktree-manager.js", () => {
  function WorktreeManager() {
    return {
      create: vi.fn().mockResolvedValue({ path: "/tmp/worktree" }),
      remove: vi.fn().mockResolvedValue(undefined)
    };
  }
  return { WorktreeManager };
});

vi.mock("../../src/verification/commit-analyzer.js", () => ({
  analyzeCommit: vi.fn().mockResolvedValue({ changedFiles: ["src/a.ts"] }),
  latestCommit: vi.fn().mockResolvedValue("commit-1")
}));

vi.mock("../../src/verification/scope-policy.js", () => ({
  evaluateScope: vi.fn().mockReturnValue({ allowed: true, violations: [] })
}));

vi.mock("../../src/verification/output-verifier.js", () => ({
  verifyTaskOutput: vi.fn().mockReturnValue({ ok: true, errors: [] })
}));

vi.mock("../../src/verification/post-merge-gate.js", () => ({
  runGate: vi.fn().mockResolvedValue({ ok: true, exitCode: 0, command: "test", stdout: "", stderr: "" })
}));

vi.mock("../../src/verification/staleness.js", () => ({
  detectStaleness: vi.fn().mockResolvedValue({ stale: false, reasons: [] }),
  collectArtifactSignatures: vi.fn().mockReturnValue({}),
  artifactKey: vi.fn().mockReturnValue("key")
}));

describe("Replan State Leak Vulnerability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reproduces the hang/leak when a task requests a replan", async () => {
    const { generateDagWithCodex } = await import("../../src/planning/planner-codex.js");
    const { getProviderAdapter } = await import("../../src/providers/adapters/index.js");

    const task1 = makeTaskContract({ 
      taskId: "task-1", 
      provider: "claude",
      commandPolicy: {
        allow: ["pnpm -s tsc -p .", "npm test"],
        deny: [],
        network: "deny"
      }
    });
    
    // 1. Initial planning returns task-1
    (generateDagWithCodex as any).mockResolvedValueOnce({
      dag: { nodes: [task1], edges: [] }
    });

    // 2. Claude adapter returns a replan marker on first call
    const mockAdapter = {
      execute: vi.fn()
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '__ORCH_DONE__: {"status":"replan","summary":"need more info","research":"investigated foo"}',
          stderr: ""
        })
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: '__ORCH_DONE__: {"status":"success","summary":"fixed it","research":"done"}',
          stderr: ""
        })
    };
    (getProviderAdapter as any).mockReturnValue(mockAdapter);

    // 3. Replan call (second call to planner) returns task-1 again
    (generateDagWithCodex as any).mockResolvedValueOnce({
      dag: { nodes: [task1], edges: [] }
    });

    const orch = new Orchestrator();
    
    // Run the orchestrator. 
    // We expect it to finish successfully if the bug is fixed.
    // If the bug is present, it will either hang (if we don't have the timeout/abort logic)
    // or task-1 will be ESCALATED because it's stuck in RUNNING state.
    const result = await orch.run({
      prompt: "test replan",
      repo: "/repo",
      plannerProvider: "claude"
    });

    // If the bug is present, task-1 remains in state RUNNING in the orchestrator's internal stateByTask,
    // and since it's not terminal, and no more tasks are pending, the orchestrator escalates all unresolved tasks.
    
    expect(result.state).toBe("COMPLETED");
    const taskRecord = (result.summary.tasks as any[]).find(t => t.taskId === "task-1");
    expect(taskRecord.state).toBe("VERIFIED");
  }, 10000); // 10s timeout
});
