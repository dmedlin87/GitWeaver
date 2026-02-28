import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventLog } from "../../src/persistence/event-log.js";

describe("EventLog", () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "gw-event-log-test-"));
    logPath = join(tempDir, "events.ndjson");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("starts with sequence 0 for a new file", () => {
    const log = new EventLog(logPath);
    const record = log.append("run-1", "RUN_STARTED", { objective: "test" });
    expect(record.seq).toBe(1);
  });

  it("appends records and increments seq", () => {
    const log = new EventLog(logPath);
    const r1 = log.append("run-1", "EVENT_A", {});
    const r2 = log.append("run-1", "EVENT_B", {});
    expect(r1.seq).toBe(1);
    expect(r2.seq).toBe(2);
  });

  it("readAll returns empty array for nonexistent file", () => {
    const log = new EventLog(join(tempDir, "nonexistent.ndjson"));
    expect(log.readAll()).toEqual([]);
  });

  it("readAll returns all appended records", () => {
    const log = new EventLog(logPath);
    log.append("run-1", "TYPE_A", { x: 1 });
    log.append("run-1", "TYPE_B", { y: 2 });

    const records = log.readAll();
    expect(records).toHaveLength(2);
    expect(records[0]!.type).toBe("TYPE_A");
    expect(records[1]!.type).toBe("TYPE_B");
  });

  it("appended record contains runId, type, ts, payload, payloadHash", () => {
    const log = new EventLog(logPath);
    const record = log.append("run-abc", "TASK_DONE", { taskId: "t1" });

    expect(record.runId).toBe("run-abc");
    expect(record.type).toBe("TASK_DONE");
    expect(typeof record.ts).toBe("string");
    expect(record.payload).toEqual({ taskId: "t1" });
    expect(typeof record.payloadHash).toBe("string");
  });

  it("continues sequence from existing file when EventLog is reopened", () => {
    // First session
    const log1 = new EventLog(logPath);
    log1.append("run-1", "A", {});
    log1.append("run-1", "B", {});

    // Second session on same file
    const log2 = new EventLog(logPath);
    const record = log2.append("run-1", "C", {});
    expect(record.seq).toBe(3);
  });

  it("payloadHash is deterministic for same payload", () => {
    const log = new EventLog(logPath);
    const r1 = log.append("run-1", "EV", { key: "value" });

    const log2 = new EventLog(join(tempDir, "log2.ndjson"));
    const r2 = log2.append("run-1", "EV", { key: "value" });

    expect(r1.payloadHash).toBe(r2.payloadHash);
  });

  it("creates parent directories for nested path", () => {
    const nestedPath = join(tempDir, "sub", "dir", "events.ndjson");
    const log = new EventLog(nestedPath);
    log.append("run-1", "EV", {});
    expect(log.readAll()).toHaveLength(1);
  });
});
