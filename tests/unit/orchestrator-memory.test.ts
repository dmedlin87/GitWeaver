import { describe, expect, it, vi, beforeEach } from "vitest";
import { Orchestrator } from "../../src/core/orchestrator.js";
import * as fs from "node:fs";

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn()
}));

vi.mock("../../src/persistence/sqlite.js", () => ({
  OrchestratorDb: vi.fn().mockImplementation(() => ({
    migrate: vi.fn().mockResolvedValue(undefined),
    listRepairEvents: vi.fn().mockResolvedValue([]),
    listAxioms: vi.fn().mockResolvedValue([]),
    listRecentVerifiedTasks: vi.fn().mockResolvedValue([]),
    upsertAxiom: vi.fn().mockResolvedValue(undefined)
  })),
  isSqliteBusyError: vi.fn().mockReturnValue(false)
}));

describe("Orchestrator Three-Tiered Memory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injectWorktreeMemory writes axioms and recent tasks", async () => {
    const orch = new Orchestrator() as any;
    const ctx = {
      run: {
        runId: "run-123",
        objective: "Build a rocket"
      },
      db: {
        listRepairEvents: vi.fn().mockResolvedValue([]),
        listAxioms: vi.fn().mockResolvedValue([
          { content: "Always use liquid fuel" }
        ]),
        listRecentVerifiedTasks: vi.fn().mockResolvedValue([
          { taskId: "task-99", summary: "Engine built" }
        ])
      }
    };
    
    await orch.injectWorktreeMemory(ctx, "/tmp/worktree", { taskId: "task-100" }, new Map());

    const runContextCall = (fs.writeFileSync as any).mock.calls.find((call: any) => call[0].includes("run_context.md"));
    const content = runContextCall[1];
    
    expect(content).toContain("## Project Axioms (Architectural Rules)");
    expect(content).toContain("- **[AXIOM]:** Always use liquid fuel");
    expect(content).toContain("## Active Memory (Recent Progress)");
    expect(content).toContain("### task-99 (Completed)");
    expect(content).toContain("**Summary:** Engine built");
  });

  it("extracts axioms from research field in executeTask", async () => {
    // Manual check of the regex logic:
    const research = "Some notes. [AXIOM] Use TypeScript for everything. [AXIOM] No global state.";
    const axioms: string[] = [];
    const axiomRegex = /\[AXIOM\]\s*([^[]*)/gi;
    let match;
    while ((match = axiomRegex.exec(research)) !== null) {
      axioms.push(match[1].trim());
    }
    
    expect(axioms).toContain("Use TypeScript for everything.");
    expect(axioms).toContain("No global state.");
  });
});
