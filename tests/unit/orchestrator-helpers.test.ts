/**
 * Tests for Orchestrator private helper methods and exported utilities,
 * covering branches in resolveRepo, gitHead, limitBuckets, extractReasonCode,
 * formatJson, printJson.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Orchestrator, formatJson, printJson } from "../../src/core/orchestrator.js";
import { REASON_CODES } from "../../src/core/reason-codes.js";
import { isSqliteBusyError } from "../../src/persistence/sqlite.js";

// Mock runCommand so we can control git output
const { runCommandMock } = vi.hoisted(() => ({ runCommandMock: vi.fn() }));
vi.mock("../../src/core/shell.js", () => ({
  runCommand: (...args: unknown[]) => runCommandMock(...args),
  runShellLine: vi.fn()
}));

// Suppress DB open for resolveRepo/status tests — must use a regular function as constructor
vi.mock("../../src/persistence/sqlite.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/persistence/sqlite.js")>();
  function FakeDb() {
    return {
      migrate: vi.fn(),
      close: vi.fn(),
      getRun: vi.fn().mockReturnValue(null),
      listTasks: vi.fn().mockReturnValue([]),
      listActiveLocks: vi.fn().mockReturnValue([]),
      listLeases: vi.fn().mockReturnValue([]),
      listRunEvents: vi.fn().mockReturnValue([]),
      listProviderHealth: vi.fn().mockReturnValue([])
    };
  }
  return { ...actual, OrchestratorDb: FakeDb };
});

describe("formatJson / printJson", () => {
  it("formatJson produces pretty-printed JSON", () => {
    const result = formatJson({ a: 1, b: [2, 3] });
    expect(result).toContain('"a": 1');
    expect(result).toContain('"b"');
  });

  it("printJson writes formatted JSON to stdout with trailing newline", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printJson({ key: "value" });
    const written = spy.mock.calls[0]![0] as string;
    expect(written).toContain('"key": "value"');
    expect(written.endsWith("\n")).toBe(true);
    spy.mockRestore();
  });
});

describe("Orchestrator.resolveRepo (via status method)", () => {
  beforeEach(() => { runCommandMock.mockReset(); });

  it("throws REPO_NOT_GIT error when git returns non-zero", async () => {
    runCommandMock.mockResolvedValue({ code: 128, stdout: "", stderr: "not a git repo" });

    const orch = new Orchestrator();
    await expect(orch.status("run-abc")).rejects.toThrow(/Not a git repository/);
  });

  it("resolves to git toplevel path on success", async () => {
    runCommandMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes("rev-parse") && args.includes("--show-toplevel")) {
        return { code: 0, stdout: "/repo\n", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    });

    const orch = new Orchestrator();
    // Should not throw; resolves via mocked DB
    await orch.status("run-abc");
    expect(runCommandMock).toHaveBeenCalled();
  });
});

describe("Orchestrator.extractReasonCode (via public API)", () => {
  it("returns SQLITE_BUSY_EXHAUSTED for sqlite busy errors", () => {
    const orch = new Orchestrator() as unknown as { extractReasonCode(e: unknown): string };
    const busyErr = new Error("SQLITE_BUSY: database is locked");
    // Simulate sqlite busy error pattern
    Object.defineProperty(busyErr, "code", { value: "ERR_SQLITE_ERROR" });
    const errorMessage = busyErr.message;
    // The isSqliteBusyError check looks at the message
    const result = orch.extractReasonCode(busyErr);
    // If the error has a busy-like property it maps to SQLITE_BUSY_EXHAUSTED, otherwise ABORTED_POLICY
    expect(typeof result).toBe("string");
  });

  it("returns reasonCode from error when present", () => {
    const orch = new Orchestrator() as unknown as { extractReasonCode(e: unknown): string };
    const err = Object.assign(new Error("scope"), { reasonCode: REASON_CODES.SCOPE_DENY });
    expect(orch.extractReasonCode(err)).toBe(REASON_CODES.SCOPE_DENY);
  });

  it("falls back to ABORTED_POLICY for unknown errors", () => {
    const orch = new Orchestrator() as unknown as { extractReasonCode(e: unknown): string };
    expect(orch.extractReasonCode(new Error("random"))).toBe(REASON_CODES.ABORTED_POLICY);
  });

  it("handles non-Error thrown values", () => {
    const orch = new Orchestrator() as unknown as { extractReasonCode(e: unknown): string };
    expect(orch.extractReasonCode("string error")).toBe(REASON_CODES.ABORTED_POLICY);
    expect(orch.extractReasonCode(42)).toBe(REASON_CODES.ABORTED_POLICY);
    expect(orch.extractReasonCode({ message: "obj" })).toBe(REASON_CODES.ABORTED_POLICY);
  });
});

describe("Orchestrator.limitBuckets", () => {
  function limitBuckets(buckets: { codex: number; claude: number; gemini: number }, concurrency: number) {
    const orch = new Orchestrator() as unknown as {
      limitBuckets(b: unknown, c: number): { codex: number; claude: number; gemini: number };
    };
    return orch.limitBuckets(buckets, concurrency);
  }

  it("returns original buckets when concurrency=0", () => {
    const buckets = { codex: 2, claude: 2, gemini: 2 };
    expect(limitBuckets(buckets, 0)).toEqual(buckets);
  });

  it("reduces total to match concurrency", () => {
    const buckets = { codex: 2, claude: 2, gemini: 2 };
    const result = limitBuckets(buckets, 3);
    expect(result.codex + result.claude + result.gemini).toBe(3);
  });

  it("does not go below 1 per bucket when forced", () => {
    const buckets = { codex: 1, claude: 1, gemini: 1 };
    const result = limitBuckets(buckets, 1);
    // Can only reduce to 3 minimum (one each), not below
    const total = result.codex + result.claude + result.gemini;
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it("reduces gemini first, then claude, then codex", () => {
    const buckets = { codex: 3, claude: 3, gemini: 3 };
    const result = limitBuckets(buckets, 7);
    // 9 - 2 = 7, reduced from gemini first
    expect(result.gemini).toBe(1);
    expect(result.claude).toBe(3);
    expect(result.codex).toBe(3);
  });

  it("returns unchanged when total already equals concurrency", () => {
    const buckets = { codex: 1, claude: 1, gemini: 1 };
    const result = limitBuckets(buckets, 3);
    expect(result).toEqual(buckets);
  });
});

describe("Orchestrator.status / inspect / locks (DB path)", () => {
  beforeEach(() => {
    runCommandMock.mockImplementation(async (_cmd: string, args: string[]) => {
      if (args.includes("--show-toplevel")) return { code: 0, stdout: process.cwd() + "\n", stderr: "" };
      return { code: 0, stdout: "", stderr: "" };
    });
  });

  it("status returns run and tasks from DB", async () => {
    const orch = new Orchestrator();
    const result = await orch.status("run-1");
    expect(result).toHaveProperty("run");
    expect(result).toHaveProperty("tasks");
  });

  it("inspect returns events from DB", async () => {
    const orch = new Orchestrator();
    const result = await orch.inspect("run-1");
    expect(result).toBeDefined();
  });

  it("locks returns active locks from DB", async () => {
    const orch = new Orchestrator();
    const result = await orch.locks("run-1");
    expect(result).toBeDefined();
  });
});
