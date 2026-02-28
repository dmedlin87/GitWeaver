
import { describe, it, expect, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { OrchestratorDb, isSqliteBusyError } from "../../src/persistence/sqlite.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("OrchestratorDb", () => {
    let tempDir: string | undefined;
    let dbPath: string;
    let db: OrchestratorDb | undefined;

    afterEach(() => {
        if (db) {
            db.close();
            db = undefined;
        }
        if (tempDir) rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
    });

    function makeRun(runId: string) {
        const now = new Date().toISOString();
        return {
            runId,
            objective: "objective",
            repoPath: "/tmp",
            baselineCommit: "sha",
            configHash: "hash",
            state: "INGEST" as const,
            createdAt: now,
            updatedAt: now
        };
    }

    it("executes operations in a transaction", () => {
        tempDir = mkdtempSync(join(tmpdir(), "gw-sqlite-test-"));
        dbPath = join(tempDir, "state.sqlite");
        db = new OrchestratorDb(dbPath);
        db.migrate();

        db.transaction(() => {
            db.upsertRun(makeRun("run-txn"));
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
                db.upsertRun(makeRun("run-rollback"));
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

    it("applies SQLite WAL, synchronous, and busy timeout pragmas", () => {
        tempDir = mkdtempSync(join(tmpdir(), "gw-sqlite-test-pragmas-"));
        dbPath = join(tempDir, "state.sqlite");
        db = new OrchestratorDb(dbPath, {
            journalMode: "WAL",
            synchronous: "NORMAL",
            busyTimeoutMs: 3210
        });
        db.migrate();

        const native = (db as unknown as { db: DatabaseSync }).db;
        const journal = native.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
        const synchronous = native.prepare("PRAGMA synchronous").get() as { synchronous: number };
        const timeout = native.prepare("PRAGMA busy_timeout").get() as { timeout: number };

        expect(journal.journal_mode).toBe("wal");
        expect(synchronous.synchronous).toBe(1);
        expect(timeout.timeout).toBe(3210);
    });

    it("retries locked writes with bounded retry telemetry", () => {
        tempDir = mkdtempSync(join(tmpdir(), "gw-sqlite-test-busy-"));
        dbPath = join(tempDir, "state.sqlite");

        const retryAttempts: number[] = [];
        const exhaustedAttempts: number[] = [];
        db = new OrchestratorDb(dbPath, {
            busyTimeoutMs: 1,
            busyRetryMax: 2,
            onBusyRetry: (_operation, attempt) => retryAttempts.push(attempt),
            onBusyExhausted: (_operation, attempts) => exhaustedAttempts.push(attempts)
        });
        db.migrate();

        const locker = new DatabaseSync(dbPath);
        locker.exec("BEGIN IMMEDIATE");

        try {
            expect(() => db.upsertRun(makeRun("run-busy"))).toThrowError(/database is locked/i);
        } finally {
            locker.exec("ROLLBACK");
            locker.close();
        }

        expect(retryAttempts).toEqual([1, 2]);
        expect(exhaustedAttempts).toEqual([2]);
    });

    it("eventually writes when contention clears within retry budget", async () => {
        tempDir = mkdtempSync(join(tmpdir(), "gw-sqlite-test-contention-"));
        dbPath = join(tempDir, "state.sqlite");

        const retryAttempts: number[] = [];
        const exhaustedAttempts: number[] = [];
        db = new OrchestratorDb(dbPath, {
            busyTimeoutMs: 1,
            busyRetryMax: 20,
            onBusyRetry: (_operation, attempt) => retryAttempts.push(attempt),
            onBusyExhausted: (_operation, attempts) => exhaustedAttempts.push(attempts)
        });
        db.migrate();

        const worker = new Worker(
            `
            const { parentPort, workerData } = require("node:worker_threads");
            const { DatabaseSync } = require("node:sqlite");
            const blocker = new DatabaseSync(workerData.dbPath);
            blocker.exec("BEGIN IMMEDIATE");
            parentPort.postMessage("locked");
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.holdMs);
            blocker.exec("ROLLBACK");
            blocker.close();
            parentPort.postMessage("released");
            `,
            {
                eval: true,
                workerData: { dbPath, holdMs: 120 }
            }
        );

        const seen = new Set<string>();
        worker.on("message", (message: unknown) => {
            if (typeof message === "string") {
                seen.add(message);
            }
        });

        const waitFor = async (target: string): Promise<void> => {
            if (seen.has(target)) {
                return;
            }
            await new Promise<void>((resolve, reject) => {
                const onMessage = (message: unknown) => {
                    if (message === target) {
                        worker.off("message", onMessage);
                        resolve();
                    }
                };
                worker.on("message", onMessage);
                worker.once("error", reject);
            });
        };

        try {
            await waitFor("locked");
            db.upsertRun(makeRun("run-busy-cleared"));
            const run = db.getRun("run-busy-cleared");
            expect(run?.runId).toBe("run-busy-cleared");
            expect(retryAttempts.length).toBeGreaterThan(0);
            expect(exhaustedAttempts).toEqual([]);
            await waitFor("released");
        } finally {
            await worker.terminate();
        }
    });

    it("detects SQLITE_BUSY lock errors from node:sqlite error shapes", () => {
        expect(isSqliteBusyError({ message: "database is locked" })).toBe(true);
        expect(isSqliteBusyError({ errcode: 5, errstr: "database is locked", code: "ERR_SQLITE_ERROR" })).toBe(true);
        expect(isSqliteBusyError({ message: "some other failure" })).toBe(false);
    });
});
