
import { describe, it, expect, afterEach } from "vitest";
import { OrchestratorDb } from "../../src/persistence/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("OrchestratorDb", () => {
    let tempDir: string;
    let dbPath: string;
    let db: OrchestratorDb;

    afterEach(() => {
        if (db) db.close();
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });

    it("executes operations in a transaction", () => {
        tempDir = mkdtempSync(join(tmpdir(), "gw-sqlite-test-"));
        dbPath = join(tempDir, "state.sqlite");
        db = new OrchestratorDb(dbPath);
        db.migrate();

        db.transaction(() => {
            db.upsertRun({
                runId: "run-txn",
                objective: "objective",
                repoPath: "/tmp",
                baselineCommit: "sha",
                configHash: "hash",
                state: "INGEST",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
        });

        const run = db.getRun("run-txn");
        expect(run).toBeDefined();
        expect(run?.runId).toBe("run-txn");
    });

    it("rolls back transaction on error", () => {
        tempDir = mkdtempSync(join(tmpdir(), "gw-sqlite-test-rollback-"));
        dbPath = join(tempDir, "state.sqlite");
        db = new OrchestratorDb(dbPath);
        db.migrate();

        try {
            db.transaction(() => {
                db.upsertRun({
                    runId: "run-rollback",
                    objective: "objective",
                    repoPath: "/tmp",
                    baselineCommit: "sha",
                    configHash: "hash",
                    state: "INGEST",
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                });
                throw new Error("Simulated failure");
            });
        } catch (e) {
            // expected
        }

        const run = db.getRun("run-rollback");
        expect(run).toBeUndefined();
    });

    it("persists provider health snapshots and resume checkpoints", () => {
        tempDir = mkdtempSync(join(tmpdir(), "gw-sqlite-test-health-"));
        dbPath = join(tempDir, "state.sqlite");
        db = new OrchestratorDb(dbPath);
        db.migrate();

        db.upsertProviderHealth("run-health", {
            provider: "claude",
            score: 70,
            lastErrors: ["429"],
            tokenBucket: 2,
            cooldownUntil: "2026-01-01T00:00:00.000Z",
            consecutiveFailures: 2,
            backoffSec: 10
        });

        const snapshots = db.listProviderHealth("run-health");
        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]?.provider).toBe("claude");
        expect(snapshots[0]?.consecutiveFailures).toBe(2);

        db.upsertResumeCheckpoint("run-health", "task-1", "MERGE_QUEUED", 41, "abc123");
        const checkpoint = db.getResumeCheckpoint("run-health");
        expect(checkpoint).toMatchObject({
            runId: "run-health",
            taskId: "task-1",
            state: "MERGE_QUEUED",
            eventSeq: 41,
            commitHash: "abc123"
        });
    });
});
