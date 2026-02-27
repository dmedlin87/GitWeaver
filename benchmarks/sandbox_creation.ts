
import { createSandboxHome } from "../src/execution/sandbox-env.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { performance } from "perf_hooks";

const ITERATIONS = 1000;
const MOCK_HOME = join(tmpdir(), "bench-sandbox-home");

function setup() {
    if (rmSync) {
        rmSync(MOCK_HOME, { recursive: true, force: true });
    }
    mkdirSync(MOCK_HOME, { recursive: true });

    // Create dummy provider configs
    writeFileSync(join(MOCK_HOME, ".codex"), "dummy-codex-config");
    writeFileSync(join(MOCK_HOME, ".claude"), "dummy-claude-config");
    writeFileSync(join(MOCK_HOME, ".gemini"), "dummy-gemini-config");
    mkdirSync(join(MOCK_HOME, ".config"));
    writeFileSync(join(MOCK_HOME, ".config", "gemini"), "dummy-gemini-config-2");

    // Mock HOME
    process.env.HOME = MOCK_HOME;
    process.env.USERPROFILE = MOCK_HOME;
}

function teardown() {
    if (rmSync) {
        rmSync(MOCK_HOME, { recursive: true, force: true });
    }
}

async function runBenchmark() {
    setup();

    console.log(`Running sandbox creation benchmark with ${ITERATIONS} iterations...`);

    const start = performance.now();

    for (let i = 0; i < ITERATIONS; i++) {
        const runId = `bench-run-${i}`;
        const taskId = `bench-task-${i}`;
        // Alternating providers
        const provider = i % 3 === 0 ? "codex" : (i % 3 === 1 ? "claude" : "gemini");

        // This is currently synchronous
        await createSandboxHome(runId, taskId, provider as any);
    }

    const end = performance.now();
    const duration = end - start;

    console.log(`Total time: ${duration.toFixed(2)}ms`);
    console.log(`Average time per creation: ${(duration / ITERATIONS).toFixed(4)}ms`);

    teardown();
}

runBenchmark().catch(console.error);
