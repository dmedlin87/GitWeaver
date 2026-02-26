import { describe, expect, it } from "vitest";
import { buildSandboxEnv } from "../../src/execution/sandbox-env.js";
import { tmpdir } from "node:os";

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
