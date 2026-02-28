import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PtyManager } from "../../src/execution/pty-manager.js";
import { killProcessTree } from "../../src/execution/watchdog.js";

let emitData = true;
let exitDelayMs = 0;

vi.mock("../../src/execution/watchdog.js", () => ({
  killProcessTree: vi.fn(async () => undefined)
}));

vi.mock("node-pty", () => {
  return {
    spawn: vi.fn(() => {
      let dataCb: ((chunk: string) => void) | undefined;
      let exitCb: ((args: { exitCode: number; signal: number }) => void) | undefined;

      return {
        pid: 1234,
        onData: vi.fn((cb: (chunk: string) => void) => {
          dataCb = cb;
          if (emitData) {
            setTimeout(() => {
              dataCb?.("mock output\n");
            }, 0);
          }
        }),
        onExit: vi.fn((cb: (args: { exitCode: number; signal: number }) => void) => {
          exitCb = cb;
          setTimeout(() => {
            exitCb?.({ exitCode: 0, signal: 0 });
          }, exitDelayMs);
        })
      };
    })
  };
});

describe("PtyManager", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    emitData = true;
    exitDelayMs = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("filters sensitive environment variables from spawned pty", async () => {
    process.env.OPENAI_API_KEY = "sk-test-12345";
    process.env.SAFE_VAR = "safe-value";

    const ptyManager = new PtyManager();
    await ptyManager.run("echo", ["hello"], {
      cwd: "/",
      timeoutMs: 1000,
      heartbeatMs: 500
    });

    const ptyModule = await import("node-pty");
    expect(ptyModule.spawn).toHaveBeenCalled();
    const spawnCall = vi.mocked(ptyModule.spawn).mock.calls.at(-1);
    const spawnOptions = spawnCall?.[2] as { env: Record<string, string> };
    const spawnedEnv = spawnOptions.env;

    expect(spawnedEnv.SAFE_VAR).toBe("safe-value");
    expect(spawnedEnv.OPENAI_API_KEY).toBeUndefined();
  });

  it("retains explicit environment variables from options", async () => {
    process.env.OPENAI_API_KEY = "sk-global";
    process.env.SAFE_VAR = "global-safe";

    const ptyManager = new PtyManager();
    await ptyManager.run("echo", ["hello"], {
      cwd: "/",
      timeoutMs: 1000,
      heartbeatMs: 500,
      env: { OPENAI_API_KEY: "sk-explicit" }
    });

    const ptyModule = await import("node-pty");
    expect(ptyModule.spawn).toHaveBeenCalled();
    const spawnCall = vi.mocked(ptyModule.spawn).mock.calls.at(-1);
    const spawnOptions = spawnCall?.[2] as { env: Record<string, string> };
    const spawnedEnv = spawnOptions.env;

    expect(spawnedEnv.OPENAI_API_KEY).toBe("sk-explicit");
    expect(spawnedEnv.SAFE_VAR).toBe("global-safe");
  });

  it("kills hung processes when heartbeat expires without output", async () => {
    vi.useFakeTimers();
    emitData = false;
    exitDelayMs = 2_000;

    const ptyManager = new PtyManager();
    const runPromise = ptyManager.run("echo", ["hello"], {
      cwd: "/",
      timeoutMs: 10_000,
      heartbeatMs: 500
    });

    await vi.advanceTimersByTimeAsync(2_500);
    await runPromise;

    expect(killProcessTree).toHaveBeenCalled();
    expect(vi.mocked(killProcessTree).mock.calls[0]?.[0]).toBe(1234);
  });
});
