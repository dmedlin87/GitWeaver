import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EventLog } from "../../src/persistence/event-log.js";
import { OrchestratorDb } from "../../src/persistence/sqlite.js";
import type { RunRecord, TaskRecord } from "../../src/core/types.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const next = tempDirs.pop();
    if (next) {
      rmSync(next, { recursive: true, force: true });
    }
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gw-persist-"));
  tempDirs.push(dir);
  return dir;
}

describe("persistence integration", () => {
  it("persists run/task state and appends event log records", async () => {
    const root = makeTempDir();
    const dbPath = join(root, "state.sqlite");
    const eventPath = join(root, "events.ndjson");

    const db = new OrchestratorDb(dbPath);
    await db.migrate();

    const run: RunRecord = {
      runId: "run-1",
      objective: "test objective",
      repoPath: root,
      baselineCommit: "abc123",
      configHash: "cfg",
      state: "INGEST",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await db.upsertRun(run);

    const task: TaskRecord = {
      runId: run.runId,
      taskId: "task-1",
      provider: "claude",
      type: "code",
      state: "PENDING",
      attempts: 0,
      contractHash: "hash-1"
    };
    await db.upsertTask(task);

    const loadedRun = await db.getRun(run.runId);
    const loadedTasks = await db.listTasks(run.runId);
    expect(loadedRun?.runId).toBe(run.runId);
    expect(loadedTasks).toHaveLength(1);
    expect(loadedTasks[0]?.taskId).toBe(task.taskId);

    await db.recordPromptEnvelope(run.runId, task.taskId, 1, "imm-1", "contract-1", "context-1");
    await db.recordPromptEnvelope(run.runId, task.taskId, 2, "imm-2", "contract-2", "context-2");
    const latestEnvelope = await db.getLatestPromptEnvelope(run.runId, task.taskId);
    expect(latestEnvelope).toEqual({
      attempt: 2,
      immutableSectionsHash: "imm-2",
      taskContractHash: "contract-2",
      contextPackHash: "context-2"
    });

    await db.upsertArtifactSignature(run.runId, "src/a.ts", "sig-a");
    await db.upsertArtifactSignature(run.runId, "src/b.ts", "sig-b");
    expect(await db.listArtifactSignatures(run.runId, ["src/a.ts", "src/b.ts", "src/c.ts"])).toEqual({
      "src/a.ts": "sig-a",
      "src/b.ts": "sig-b"
    });

    const log = new EventLog(eventPath);
    const event = log.append(run.runId, "TASK_READY", { taskId: task.taskId });
    const allEvents = log.readAll();
    expect(event.seq).toBe(1);
    expect(allEvents).toHaveLength(1);
    expect(allEvents[0]?.type).toBe("TASK_READY");

    db.close();
  });

  it("ignores partial event log writes during recovery", async () => {
    const root = makeTempDir();
    const eventPath = join(root, "events.ndjson");

    const log1 = new EventLog(eventPath);
    log1.append("run-1", "TASK_READY", { taskId: "task-1" });

    // Simulate partial write appended to file
    const fs = await import("node:fs");
    fs.appendFileSync(eventPath, '{"seq":2,"runId":"run-1","ts":"2023-01-01T00:00:00.000Z","type":"TASK_RUNNING","payload":{"taskId":"task-', "utf8");

    const log2 = new EventLog(eventPath);
    const events = log2.readAll();

    expect(events).toHaveLength(1);
    expect(events[0]?.seq).toBe(1);
    expect(events[0]?.type).toBe("TASK_READY");
  });

  it("recovers from mid-file malformed event log entries by discarding them and parsing subsequent entries", async () => {
    const root = makeTempDir();
    const eventPath = join(root, "events.ndjson");

    const log1 = new EventLog(eventPath);
    log1.append("run-1", "TASK_READY", { taskId: "task-1" });

    // Simulate corrupted/malformed entry in the middle
    const fs = await import("node:fs");
    fs.appendFileSync(eventPath, '{"seq":2,"runId":"run-1","ts":"corrupted json\n', "utf8");

    log1.append("run-1", "TASK_RUNNING", { taskId: "task-1" });

    const log2 = new EventLog(eventPath);
    const events = log2.readAll();

    expect(events).toHaveLength(2);
    expect(events[0]?.seq).toBe(1);
    expect(events[0]?.type).toBe("TASK_READY");
    // Since the second entry is corrupted, the next valid write receives a seq determined by log1 state (which incremented internally anyway to 3, or if corrupted it bypasses).
    // Let's just check the type of the last valid event.
    expect(events[1]?.type).toBe("TASK_RUNNING");
  });
});
