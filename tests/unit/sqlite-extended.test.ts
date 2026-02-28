/**
 * Extended SQLite tests covering branches not in sqlite.test.ts:
 * - isSqliteBusyError permutations
 * - listArtifactSignatures with empty key list
 * - transaction rejection/rollback
 * - missing row return branches
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OrchestratorDb, isSqliteBusyError } from "../../src/persistence/sqlite.js";

function makeDb(): { db: OrchestratorDb; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "gw-sqlite-ext-"));
  const db = new OrchestratorDb(join(dir, "state.sqlite"));
  db.migrate();
  return { db, dir };
}

describe("isSqliteBusyError", () => {
  it("returns false for null", () => {
    expect(isSqliteBusyError(null)).toBe(false);
  });

  it("returns false for non-objects", () => {
    expect(isSqliteBusyError("string")).toBe(false);
    expect(isSqliteBusyError(42)).toBe(false);
    expect(isSqliteBusyError(undefined)).toBe(false);
  });

  it("returns true when errcode matches SQLITE_BUSY (5)", () => {
    expect(isSqliteBusyError({ errcode: 5 })).toBe(true);
  });

  it("returns true when code string contains SQLITE_BUSY", () => {
    expect(isSqliteBusyError({ code: "SQLITE_BUSY" })).toBe(true);
    expect(isSqliteBusyError({ code: "ERR_SQLITE_BUSY_TIMEOUT" })).toBe(true);
  });

  it("returns true when errstr contains 'database is locked'", () => {
    expect(isSqliteBusyError({ errstr: "database is locked" })).toBe(true);
  });

  it("returns true when message contains 'database table is locked'", () => {
    expect(isSqliteBusyError({ message: "database table is locked" })).toBe(true);
  });

  it("returns true when message contains 'sqlite_busy' (case insensitive)", () => {
    expect(isSqliteBusyError({ message: "SQLITE_BUSY: cannot read" })).toBe(true);
  });

  it("returns false for generic errors without busy indicators", () => {
    expect(isSqliteBusyError({ message: "some random db error", code: "ERR_OTHER" })).toBe(false);
  });

  it("returns false for plain object with no relevant fields", () => {
    expect(isSqliteBusyError({ x: 1, y: 2 })).toBe(false);
  });
});

describe("OrchestratorDb – additional branches", () => {
  let db: OrchestratorDb;
  let dir: string;

  beforeEach(() => {
    const made = makeDb();
    db = made.db;
    dir = made.dir;
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("listArtifactSignatures returns empty object for empty key list", () => {
    const result = db.listArtifactSignatures("run-1", []);
    expect(result).toEqual({});
  });

  it("listArtifactSignatures returns {} when run has no artifacts", () => {
    const result = db.listArtifactSignatures("run-1", ["src/a.ts"]);
    expect(result).toEqual({});
  });

  it("listArtifactSignatures returns matching signatures after upsert", () => {
    const now = new Date().toISOString();
    db.upsertRun({
      runId: "run-art",
      objective: "test",
      repoPath: "/tmp",
      baselineCommit: "abc",
      configHash: "ch",
      state: "INGEST",
      createdAt: now,
      updatedAt: now
    });

    db.upsertArtifactSignature("run-art", "src/foo.ts", "sha-abc", "src/foo.ts");
    db.upsertArtifactSignature("run-art", "src/bar.ts", "sha-xyz", "src/bar.ts");

    const result = db.listArtifactSignatures("run-art", ["src/foo.ts", "src/bar.ts"]);
    expect(result["src/foo.ts"]).toBe("sha-abc");
    expect(result["src/bar.ts"]).toBe("sha-xyz");
  });

  it("transaction rolls back on exception", () => {
    expect(() => {
      db.transaction(() => {
        const now = new Date().toISOString();
        db.upsertRun({
          runId: "txn-fail",
          objective: "test",
          repoPath: "/tmp",
          baselineCommit: "abc",
          configHash: "ch",
          state: "INGEST",
          createdAt: now,
          updatedAt: now
        });
        throw new Error("force rollback");
      });
    }).toThrow("force rollback");

    expect(db.getRun("txn-fail")).toBeUndefined();
  });

  it("getRun returns undefined for missing run", () => {
    expect(db.getRun("nonexistent-run")).toBeUndefined();
  });

  it("getResumeCheckpoint returns undefined for missing run", () => {
    expect(db.getResumeCheckpoint("nonexistent-run")).toBeUndefined();
  });

  it("listTasks returns empty array for unknown run", () => {
    expect(db.listTasks("nonexistent-run")).toEqual([]);
  });

  it("upsertRun then getRun round-trips correctly", () => {
    const now = new Date().toISOString();
    db.upsertRun({
      runId: "run-rt",
      objective: "Round trip",
      repoPath: "/repo",
      baselineCommit: "abc123",
      configHash: "cfg-hash",
      state: "INGEST",
      createdAt: now,
      updatedAt: now
    });
    const run = db.getRun("run-rt");
    expect(run).toBeDefined();
    expect(run!.objective).toBe("Round trip");
    expect(run!.state).toBe("INGEST");
  });

  it("listLeases returns empty when no leases exist for run", () => {
    expect(db.listLeases("no-such-run")).toEqual([]);
  });
});
