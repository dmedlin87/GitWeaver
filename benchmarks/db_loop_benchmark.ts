
import { OrchestratorDb } from "../src/persistence/sqlite.js";
import { unlinkSync, existsSync } from "fs";
import { performance } from "perf_hooks";

const DB_PATH = "bench_test.sqlite";

function setup() {
    if (existsSync(DB_PATH)) {
        unlinkSync(DB_PATH);
    }
    const db = new OrchestratorDb(DB_PATH);
    db.migrate();
    return db;
}

function runBenchmark(count: number) {
    let db = setup();

    console.log(`Pre-inserting ${count} tasks...`);
    // Pre-insert tasks
    for (let i = 0; i < count; i++) {
        db.upsertTask({
            runId: "run-1",
            taskId: `task-${i}`,
            provider: "codex",
            type: "code",
            state: "PENDING",
            attempts: 0,
            contractHash: "hash"
        });
    }

    console.log(`Starting individual update loop for ${count} tasks...`);
    let start = performance.now();

    for (let i = 0; i < count; i++) {
        db.upsertTask({
            runId: "run-1",
            taskId: `task-${i}`,
            provider: "codex",
            type: "code",
            state: "READY",
            attempts: 0,
            contractHash: "hash"
        });
    }

    let end = performance.now();
    console.log(`Individual Update loop took ${(end - start).toFixed(2)}ms`);
    console.log(`Average time per task: ${((end - start) / count).toFixed(2)}ms`);

    db.close();
    if (existsSync(DB_PATH)) {
        unlinkSync(DB_PATH);
    }

    // --- Transaction Benchmark ---
    db = setup();

    console.log(`Pre-inserting ${count} tasks for transaction benchmark...`);
    db.transaction(() => {
        for (let i = 0; i < count; i++) {
            db.upsertTask({
                runId: "run-2",
                taskId: `task-${i}`,
                provider: "codex",
                type: "code",
                state: "PENDING",
                attempts: 0,
                contractHash: "hash"
            });
        }
    });

    console.log(`Starting batched transaction update loop for ${count} tasks...`);
    start = performance.now();

    const updates: any[] = [];
    for (let i = 0; i < count; i++) {
        updates.push({
            runId: "run-2",
            taskId: `task-${i}`,
            provider: "codex",
            type: "code",
            state: "READY",
            attempts: 0,
            contractHash: "hash"
        });
    }

    db.transaction(() => {
        for (const task of updates) {
            db.upsertTask(task);
        }
    });

    end = performance.now();
    console.log(`Batched Transaction Update loop took ${(end - start).toFixed(2)}ms`);
    console.log(`Average time per task (batched): ${((end - start) / count).toFixed(2)}ms`);

    db.close();
    if (existsSync(DB_PATH)) {
        unlinkSync(DB_PATH);
    }
}

runBenchmark(1000);
