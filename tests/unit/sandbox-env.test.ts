import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildSandboxEnv, createSandboxHome } from "../../src/execution/sandbox-env.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, rmdirSync, writeFileSync, rmSync } from "node:fs";

describe("buildSandboxEnv", () => {
  it("filters unsafe variables", () => {
    const baseEnv = {
      PATH: "/usr/bin",
      SECRET: "secret",
      TERM: "xterm",
      ORCH_TEST: "allowed"
    };
    const sandboxHome = "/tmp/sandbox";
    const env = buildSandboxEnv(baseEnv, sandboxHome);

    expect(env.PATH).toBe("/usr/bin");
    expect(env.TERM).toBe("xterm");
    expect(env.SECRET).toBeUndefined();
    expect(env.ORCH_TEST).toBe("allowed");
    expect(env.HOME).toBe(sandboxHome);
    expect(env.USERPROFILE).toBe(sandboxHome);
    expect(env.TMP).toBe(tmpdir());
  });

  it("handles empty baseEnv", () => {
    const baseEnv = {};
    const sandboxHome = "/tmp/sandbox";
    const env = buildSandboxEnv(baseEnv, sandboxHome);

    expect(env.HOME).toBe(sandboxHome);
    expect(env.TMP).toBeDefined();
  });
});

describe("createSandboxHome", () => {
  const mockHome = join(tmpdir(), "orch-test-home");

  beforeEach(() => {
    if (existsSync(mockHome)) {
      rmSync(mockHome, { recursive: true, force: true });
    }
    mkdirSync(mockHome, { recursive: true });
    process.env.HOME = mockHome;
    process.env.USERPROFILE = mockHome;
  });

  afterEach(() => {
    if (existsSync(mockHome)) {
      rmSync(mockHome, { recursive: true, force: true });
    }
  });

  it("creates sandbox home and copies provider config", async () => {
    const configPath = join(mockHome, ".codex");
    writeFileSync(configPath, "dummy-config");

    const runId = "test-run";
    const taskId = "task-1";

    // @ts-expect-error - testing specific provider logic
    const sandboxPath = await createSandboxHome(runId, taskId, "codex");

    expect(existsSync(sandboxPath)).toBe(true);
    expect(existsSync(join(sandboxPath, ".codex"))).toBe(true);
  });

  it("handles missing provider config gracefully", async () => {
    const runId = "test-run-2";
    const taskId = "task-2";

    // @ts-expect-error - testing specific provider logic
    const sandboxPath = await createSandboxHome(runId, taskId, "codex");

    expect(existsSync(sandboxPath)).toBe(true);
    expect(existsSync(join(sandboxPath, ".codex"))).toBe(false);
  });
});
