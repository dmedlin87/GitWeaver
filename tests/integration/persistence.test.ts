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
  it("persists run/task state and appends event log records", () => {
    const root = makeTempDir();
    const dbPath = join(root, "state.sqlite");
    const eventPath = join(root, "events.ndjson");

    const db = new OrchestratorDb(dbPath);
    db.migrate();

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
    db.upsertRun(run);

    const task: TaskRecord = {
      runId: run.runId,
      taskId: "task-1",
      provider: "claude",
      type: "code",
      state: "PENDING",
      attempts: 0,
      contractHash: "hash-1"
    };
    db.upsertTask(task);

    const loadedRun = db.getRun(run.runId);
    const loadedTasks = db.listTasks(run.runId);
    expect(loadedRun?.runId).toBe(run.runId);
    expect(loadedTasks).toHaveLength(1);
    expect(loadedTasks[0]?.taskId).toBe(task.taskId);

    db.recordPromptEnvelope(run.runId, task.taskId, 1, "imm-1", "contract-1", "context-1");
    db.recordPromptEnvelope(run.runId, task.taskId, 2, "imm-2", "contract-2", "context-2");
    const latestEnvelope = db.getLatestPromptEnvelope(run.runId, task.taskId);
    expect(latestEnvelope).toEqual({
      attempt: 2,
      immutableSectionsHash: "imm-2",
      taskContractHash: "contract-2",
      contextPackHash: "context-2"
    });

    db.upsertArtifactSignature(run.runId, "src/a.ts", "sig-a");
    db.upsertArtifactSignature(run.runId, "src/b.ts", "sig-b");
    expect(db.listArtifactSignatures(run.runId, ["src/a.ts", "src/b.ts", "src/c.ts"])).toEqual({
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
});
