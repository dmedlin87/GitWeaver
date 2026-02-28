/**
 * Unit tests for CLI command registrations.
 * Mocks the Orchestrator to test argument parsing, JSON/non-JSON output
 * paths, and exit code behavior without spawning real processes.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";

// --- Orchestrator mock setup via vi.hoisted so factory can reference it ---
const { orchestratorMock, printJsonMock } = vi.hoisted(() => {
  const mock = {
    run: vi.fn(),
    resume: vi.fn(),
    status: vi.fn(),
    inspect: vi.fn(),
    locks: vi.fn()
  };
  return { orchestratorMock: mock, printJsonMock: vi.fn() };
});

vi.mock("../../src/core/orchestrator.js", () => ({
  // Regular function (not arrow) to work as a constructor
  Orchestrator: function Orchestrator() { return orchestratorMock; },
  printJson: printJsonMock,
  formatJson: (v: unknown) => JSON.stringify(v)
}));

import { registerRunCommand } from "../../src/cli/commands/run.js";
import { registerResumeCommand } from "../../src/cli/commands/resume.js";
import { registerStatusCommand } from "../../src/cli/commands/status.js";
import { registerInspectCommand } from "../../src/cli/commands/inspect.js";
import { registerLocksCommand } from "../../src/cli/commands/locks.js";

const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

afterAll(() => {
  consoleSpy.mockRestore();
  stderrSpy.mockRestore();
});

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent process.exit in tests
  return program;
}

async function parseAsync(program: Command, argv: string[]): Promise<void> {
  await program.parseAsync(["node", "cli", ...argv]);
}

describe("run command", () => {
  beforeEach(() => {
    orchestratorMock.run.mockReset();
    printJsonMock.mockClear();
    consoleSpy.mockClear();
    stderrSpy.mockClear();
  });

  it("calls orchestrator.run with prompt", async () => {
    orchestratorMock.run.mockResolvedValue({
      runId: "r1",
      state: "COMPLETED",
      summary: {}
    });

    const program = makeProgram();
    registerRunCommand(program);
    await parseAsync(program, ["run", "build the thing"]);

    expect(orchestratorMock.run).toHaveBeenCalledTimes(1);
    const opts = orchestratorMock.run.mock.calls[0]![0];
    expect(opts.prompt).toBe("build the thing");
  });

  it("sets process.exitCode=1 when state is not COMPLETED", async () => {
    const original = process.exitCode;
    orchestratorMock.run.mockResolvedValue({
      runId: "r1",
      state: "ABORTED_POLICY",
      reasonCode: "SCOPE_DENY",
      summary: {}
    });

    const program = makeProgram();
    registerRunCommand(program);
    await parseAsync(program, ["run", "do something"]);

    expect(process.exitCode).toBe(1);
    process.exitCode = original;
  });

  it("does not set process.exitCode when state is COMPLETED", async () => {
    const original = process.exitCode;
    process.exitCode = undefined;
    orchestratorMock.run.mockResolvedValue({
      runId: "r1",
      state: "COMPLETED",
      summary: {}
    });

    const program = makeProgram();
    registerRunCommand(program);
    await parseAsync(program, ["run", "build it"]);

    expect(process.exitCode).not.toBe(1);
    process.exitCode = original;
  });

  it("passes --dry-run option", async () => {
    orchestratorMock.run.mockResolvedValue({ runId: "r1", state: "COMPLETED", summary: {} });

    const program = makeProgram();
    registerRunCommand(program);
    await parseAsync(program, ["run", "test", "--dry-run"]);

    expect(orchestratorMock.run.mock.calls[0]![0].dryRun).toBe(true);
  });

  it("parses --concurrency as integer", async () => {
    orchestratorMock.run.mockResolvedValue({ runId: "r1", state: "COMPLETED", summary: {} });

    const program = makeProgram();
    registerRunCommand(program);
    await parseAsync(program, ["run", "test", "--concurrency", "4"]);

    expect(orchestratorMock.run.mock.calls[0]![0].concurrency).toBe(4);
  });

  it("throws when --concurrency is not a valid integer", async () => {
    const program = makeProgram();
    registerRunCommand(program);
    await expect(parseAsync(program, ["run", "test", "--concurrency", "abc"])).rejects.toThrow();
  });

  it("prints JSON output when --json flag is set", async () => {
    const outcome = { runId: "r1", state: "COMPLETED", summary: {} };
    orchestratorMock.run.mockResolvedValue(outcome);

    const program = makeProgram();
    registerRunCommand(program);
    await parseAsync(program, ["run", "test", "--json"]);

    // printJson should be called; no stderr progress updates
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("writes progress to stderr when NOT --json", async () => {
    orchestratorMock.run.mockImplementation(async (opts: { onProgress?: (update: unknown) => void }) => {
      opts.onProgress?.({
        ts: "2026-01-01T00:00:00Z",
        runId: "r1",
        stage: "PLANNING",
        message: "planning",
        taskId: undefined,
        provider: undefined
      });
      return { runId: "r1", state: "COMPLETED", summary: {} };
    });

    const program = makeProgram();
    registerRunCommand(program);
    await parseAsync(program, ["run", "test"]);

    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.flat().join("");
    expect(written).toContain("PLANNING");
  });
});

describe("resume command", () => {
  beforeEach(() => {
    orchestratorMock.resume.mockReset();
    printJsonMock.mockClear();
    consoleSpy.mockClear();
  });

  it("calls orchestrator.resume with runId", async () => {
    orchestratorMock.resume.mockResolvedValue({ runId: "run-xyz", state: "COMPLETED", summary: {} });

    const program = makeProgram();
    registerResumeCommand(program);
    await parseAsync(program, ["resume", "run-xyz"]);

    expect(orchestratorMock.resume).toHaveBeenCalledWith("run-xyz", false);
  });

  it("passes --accept-drift=true to orchestrator.resume", async () => {
    orchestratorMock.resume.mockResolvedValue({ runId: "run-xyz", state: "COMPLETED", summary: {} });

    const program = makeProgram();
    registerResumeCommand(program);
    await parseAsync(program, ["resume", "run-xyz", "--accept-drift"]);

    expect(orchestratorMock.resume).toHaveBeenCalledWith("run-xyz", true);
  });

  it("prints JSON when --json flag is set", async () => {
    const outcome = { runId: "r1", state: "COMPLETED", summary: {} };
    orchestratorMock.resume.mockResolvedValue(outcome);

    const program = makeProgram();
    registerResumeCommand(program);
    await parseAsync(program, ["resume", "r1", "--json"]);

    expect(printJsonMock).toHaveBeenCalled();
  });

  it("prints non-JSON output when --json not set", async () => {
    orchestratorMock.resume.mockResolvedValue({ runId: "r1", state: "COMPLETED", summary: {} });

    const program = makeProgram();
    registerResumeCommand(program);
    await parseAsync(program, ["resume", "r1"]);

    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("status command", () => {
  beforeEach(() => {
    orchestratorMock.status.mockReset();
    printJsonMock.mockClear();
    consoleSpy.mockClear();
  });

  it("calls orchestrator.status with runId", async () => {
    orchestratorMock.status.mockResolvedValue({ run: null, tasks: [] });

    const program = makeProgram();
    registerStatusCommand(program);
    await parseAsync(program, ["status", "run-abc"]);

    expect(orchestratorMock.status).toHaveBeenCalledWith("run-abc");
  });

  it("prints JSON when --json flag set", async () => {
    orchestratorMock.status.mockResolvedValue({ run: { state: "COMPLETED" }, tasks: [] });

    const program = makeProgram();
    registerStatusCommand(program);
    await parseAsync(program, ["status", "run-abc", "--json"]);

    const { printJson } = await import("../../src/core/orchestrator.js");
    expect(printJson).toHaveBeenCalled();
  });

  it("prints non-JSON output without --json", async () => {
    orchestratorMock.status.mockResolvedValue({ run: { state: "COMPLETED" }, tasks: [] });

    const program = makeProgram();
    registerStatusCommand(program);
    await parseAsync(program, ["status", "run-abc"]);

    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("inspect command", () => {
  beforeEach(() => {
    orchestratorMock.inspect.mockReset();
    printJsonMock.mockClear();
    consoleSpy.mockClear();
  });

  it("calls orchestrator.inspect with runId", async () => {
    orchestratorMock.inspect.mockResolvedValue({ events: [] });

    const program = makeProgram();
    registerInspectCommand(program);
    await parseAsync(program, ["inspect", "run-abc"]);

    expect(orchestratorMock.inspect).toHaveBeenCalledWith("run-abc", undefined);
  });

  it("passes --task filter to orchestrator.inspect", async () => {
    orchestratorMock.inspect.mockResolvedValue({ events: [] });

    const program = makeProgram();
    registerInspectCommand(program);
    await parseAsync(program, ["inspect", "run-abc", "--task", "task-1"]);

    expect(orchestratorMock.inspect).toHaveBeenCalledWith("run-abc", "task-1");
  });

  it("prints JSON when --json flag set", async () => {
    orchestratorMock.inspect.mockResolvedValue({ events: [] });

    const program = makeProgram();
    registerInspectCommand(program);
    await parseAsync(program, ["inspect", "run-abc", "--json"]);

    const { printJson } = await import("../../src/core/orchestrator.js");
    expect(printJson).toHaveBeenCalled();
  });
});

describe("locks command", () => {
  beforeEach(() => {
    orchestratorMock.locks.mockReset();
    printJsonMock.mockClear();
    consoleSpy.mockClear();
  });

  it("calls orchestrator.locks with runId", async () => {
    orchestratorMock.locks.mockResolvedValue({ locks: [] });

    const program = makeProgram();
    registerLocksCommand(program);
    await parseAsync(program, ["locks", "run-abc"]);

    expect(orchestratorMock.locks).toHaveBeenCalledWith("run-abc");
  });

  it("prints JSON when --json flag set", async () => {
    orchestratorMock.locks.mockResolvedValue({ locks: [] });

    const program = makeProgram();
    registerLocksCommand(program);
    await parseAsync(program, ["locks", "run-abc", "--json"]);

    const { printJson } = await import("../../src/core/orchestrator.js");
    expect(printJson).toHaveBeenCalled();
  });

  it("prints non-JSON output without --json", async () => {
    orchestratorMock.locks.mockResolvedValue({ locks: [] });

    const program = makeProgram();
    registerLocksCommand(program);
    await parseAsync(program, ["locks", "run-abc"]);

    expect(consoleSpy).toHaveBeenCalled();
  });
});
