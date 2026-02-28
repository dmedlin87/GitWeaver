import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PtyManager } from "../../src/execution/pty-manager.js";
import { killProcessTree } from "../../src/execution/watchdog.js";
import { runCommand } from "../../src/core/shell.js";

let emitData = true;
let exitDelayMs = 0;
let exitSignal: number | undefined = 0;
let originalPlatform = process.platform;

vi.mock("../../src/execution/watchdog.js", () => ({
  killProcessTree: vi.fn(async () => undefined)
}));

vi.mock("../../src/core/shell.js", () => ({
  runCommand: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }))
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
            exitCb?.({ exitCode: 0, signal: exitSignal as number });
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
    exitSignal = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, "platform", { value: originalPlatform });
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

  it("falls back to runCommand when PTY module is unavailable", async () => {
    vi.mocked(runCommand).mockResolvedValueOnce({
      code: 12,
      stdout: "hello \u001B[31mred\u001B[0m ",
      stderr: "api_token: verysecret12"
    });

    const ptyManager = new PtyManager();
    vi.spyOn(ptyManager as unknown as { loadPtyModule: () => Promise<null> }, "loadPtyModule")
      .mockResolvedValue(null);

    const result = await ptyManager.run("echo", ["hello"], {
      cwd: "/tmp",
      env: { SAFE: "1" },
      timeoutMs: 2000,
      heartbeatMs: 500
    });

    expect(runCommand).toHaveBeenCalledWith("echo", ["hello"], {
      cwd: "/tmp",
      env: { SAFE: "1" },
      timeoutMs: 2000
    });
    expect(result.code).toBe(12);
    expect(result.signal).toBe(0);
    expect(result.rawOutput).toContain("api_token: verysecret12");
    expect(result.normalizedOutput).toContain("[REDACTED]");
    expect(result.normalizedOutput).not.toContain("\u001B[31m");
  });

  it("inherits TERM and COLORTERM from process env when missing in options", async () => {
    process.env.TERM = "xterm-256color";
    process.env.COLORTERM = "truecolor";

    const ptyManager = new PtyManager();
    await ptyManager.run("echo", ["hello"], {
      cwd: "/",
      timeoutMs: 1000,
      heartbeatMs: 500,
      env: { SAFE_VAR: "1", TERM: "", COLORTERM: "" }
    });

    const ptyModule = await import("node-pty");
    const spawnCall = vi.mocked(ptyModule.spawn).mock.calls.at(-1);
    const spawnOptions = spawnCall?.[2] as { env: Record<string, string> };
    expect(spawnOptions.env.TERM).toBe("xterm-256color");
    expect(spawnOptions.env.COLORTERM).toBe("truecolor");
  });

  it("kills the process tree when timeout elapses", async () => {
    vi.useFakeTimers();
    emitData = false;
    exitDelayMs = 5_000;

    const ptyManager = new PtyManager();
    const runPromise = ptyManager.run("echo", ["hello"], {
      cwd: "/",
      timeoutMs: 250,
      heartbeatMs: 10_000
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(killProcessTree).toHaveBeenCalledWith(1234);

    await vi.advanceTimersByTimeAsync(5_000);
    await runPromise;
  });

  it("defaults signal to zero when PTY exits without a signal", async () => {
    exitSignal = undefined;

    const ptyManager = new PtyManager();
    const result = await ptyManager.run("echo", ["hello"], {
      cwd: "/",
      timeoutMs: 1000,
      heartbeatMs: 500
    });

    expect(result.signal).toBe(0);
  });

  it("uses POSIX shell escaping and non-windows kill path on unix-like platforms", async () => {
    vi.useFakeTimers();
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(process.platform).toBe("linux");
    emitData = false;
    exitDelayMs = 1_000;

    const ptyManager = new PtyManager();
    const runPromise = ptyManager.run("echo", ["a'b"], {
      cwd: "/",
      timeoutMs: 10_000,
      heartbeatMs: 100
    });

    await vi.advanceTimersByTimeAsync(1_500);
    await runPromise;

    const ptyModule = await import("node-pty");
    const spawnCall = vi.mocked(ptyModule.spawn).mock.calls.at(-1);
    expect(spawnCall?.[1]?.[0]).toBe("-lc");
    expect(spawnCall?.[1]?.[0]).not.toBe("-NoProfile");
    expect(spawnCall?.[1]?.[1]).toContain("'a'\\''b'");
    expect(killProcessTree).toHaveBeenCalledWith(1234);
  });

  it("uses bash when SHELL is unset and reuses loaded PTY module on subsequent runs", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.SHELL = "";

    const ptyManager = new PtyManager();
    await ptyManager.run("echo", ["one"], {
      cwd: "/",
      timeoutMs: 1000,
      heartbeatMs: 500
    });
    await ptyManager.run("echo", ["two"], {
      cwd: "/",
      timeoutMs: 1000,
      heartbeatMs: 500
    });

    const ptyModule = await import("node-pty");
    const calls = vi.mocked(ptyModule.spawn).mock.calls;
    expect(calls.at(-1)?.[0]).toBe("bash");
    expect(calls.at(-2)?.[0]).toBe("bash");
  });
});
