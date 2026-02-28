import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PtyManager } from "../../src/execution/pty-manager.js";

vi.mock("node-pty", () => {
  return {
    spawn: vi.fn((shell, args, options) => {
      let exitCb: (args: any) => void;
      return {
        pid: 1234,
        onData: vi.fn((cb) => cb("mock output\n")),
        onExit: vi.fn((cb) => {
          exitCb = cb;
          setTimeout(() => {
            exitCb({ exitCode: 0, signal: 0 });
          }, 0);
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
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("filters sensitive environment variables from spawned pty", async () => {
    process.env.OPENAI_API_KEY = "sk-test-12345";
    process.env.SAFE_VAR = "safe-value";

    const ptyManager = new PtyManager();
    const runPromise = ptyManager.run("echo", ["hello"], {
      cwd: "/",
      timeoutMs: 1000,
      heartbeatMs: 500
    });

    await runPromise;

    const ptyModule = await import("node-pty");
    expect(ptyModule.spawn).toHaveBeenCalled();
    const spawnCall = vi.mocked(ptyModule.spawn).mock.calls[0];
    const spawnOptions = spawnCall[2] as { env: Record<string, string> };
    const spawnedEnv = spawnOptions.env;

    expect(spawnedEnv.SAFE_VAR).toBe("safe-value");
    expect(spawnedEnv.OPENAI_API_KEY).toBeUndefined();
  });

  it("retains explicit environment variables from options", async () => {
    process.env.OPENAI_API_KEY = "sk-global";
    process.env.SAFE_VAR = "global-safe";

    const ptyManager = new PtyManager();
    const runPromise = ptyManager.run("echo", ["hello"], {
      cwd: "/",
      timeoutMs: 1000,
      heartbeatMs: 500,
      env: { OPENAI_API_KEY: "sk-explicit" }
    });

    await runPromise;

    const ptyModule = await import("node-pty");
    expect(ptyModule.spawn).toHaveBeenCalled();
    const spawnCall = vi.mocked(ptyModule.spawn).mock.calls[1]; // 2nd call since previous test
    const spawnOptions = spawnCall[2] as { env: Record<string, string> };
    const spawnedEnv = spawnOptions.env;

    expect(spawnedEnv.OPENAI_API_KEY).toBe("sk-explicit");
    expect(spawnedEnv.SAFE_VAR).toBe("global-safe"); // The baseEnv is merged under options.env now
  });
});
