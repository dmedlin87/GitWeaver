import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { buildSandboxEnv, createSandboxHome } from "../../src/execution/sandbox-env.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";

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
  const originalHome = process.env.HOME;
  const tempHome = join(tmpdir(), "test-home-" + Date.now());

  beforeEach(() => {
    mkdirSync(tempHome, { recursive: true });
    process.env.HOME = tempHome;
    // Also mock USERPROFILE for Windows compatibility if the code checks it first
    process.env.USERPROFILE = tempHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    // Restore USERPROFILE
    if (process.env.USERPROFILE === tempHome) {
       delete process.env.USERPROFILE;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("copies provider config files", () => {
    const codexConfig = join(tempHome, ".codex");
    writeFileSync(codexConfig, "config content");

    const sandbox = createSandboxHome("run1", "task1", "codex");
    const targetConfig = join(sandbox, ".codex");

    expect(existsSync(targetConfig)).toBe(true);
    expect(readFileSync(targetConfig, "utf-8")).toBe("config content");

    // Clean up sandbox
    rmSync(sandbox, { recursive: true, force: true });
  });

  it("handles path separators correctly", () => {
      // This test is to ensure our future change (using basename) works as expected.
      // The current implementation splits by [\\/] and takes the last part.

      const codexConfig = join(tempHome, ".codex");
      writeFileSync(codexConfig, "config content");

      const sandbox = createSandboxHome("run1", "task2", "codex");
      const targetConfig = join(sandbox, ".codex");

      expect(existsSync(targetConfig)).toBe(true);

      // Clean up sandbox
      rmSync(sandbox, { recursive: true, force: true });
  });
});
