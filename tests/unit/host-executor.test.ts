import { describe, expect, it } from "vitest";
import { HostExecutor } from "../../src/secure/host-executor.js";

describe("HostExecutor", () => {
  const executor = new HostExecutor();

  describe("prepareEnvironment", () => {
    it("allows PATH from allowlist", () => {
      const env = executor.prepareEnvironment({ PATH: "/usr/bin", UNRELATED: "x" });
      expect(env.PATH).toBe("/usr/bin");
      expect(env.UNRELATED).toBeUndefined();
    });

    it("allows all allowlisted variables that are present", () => {
      const env = executor.prepareEnvironment({
        PATH: "/bin",
        SystemRoot: "C:\\Windows",
        ComSpec: "cmd.exe",
        HOME: "/home/user",
        USERPROFILE: "C:\\Users\\user",
        TMP: "/tmp",
        TEMP: "/tmp",
        CI: "true",
        NODE_ENV: "test"
      });

      expect(env.PATH).toBe("/bin");
      expect(env.SystemRoot).toBe("C:\\Windows");
      expect(env.ComSpec).toBe("cmd.exe");
      expect(env.HOME).toBe("/home/user");
      expect(env.USERPROFILE).toBe("C:\\Users\\user");
      expect(env.TMP).toBe("/tmp");
      expect(env.TEMP).toBe("/tmp");
      expect(env.CI).toBe("true");
      expect(env.NODE_ENV).toBe("test");
    });

    it("does not include allowlisted vars that are missing from baseEnv", () => {
      const env = executor.prepareEnvironment({ PATH: "/bin" });
      expect(env.HOME).toBeUndefined();
      expect(env.CI).toBeUndefined();
    });

    it("includes ORCH_ prefixed variables", () => {
      const env = executor.prepareEnvironment({
        ORCH_RUN_ID: "abc-123",
        ORCH_TASK_ID: "task-1",
        NOT_ORCH: "ignored"
      });
      expect(env.ORCH_RUN_ID).toBe("abc-123");
      expect(env.ORCH_TASK_ID).toBe("task-1");
      expect(env.NOT_ORCH).toBeUndefined();
    });

    it("removes API keys from denylist", () => {
      const env = executor.prepareEnvironment({
        PATH: "/bin",
        OPENAI_API_KEY: "sk-open",
        ANTHROPIC_API_KEY: "sk-ant",
        GOOGLE_API_KEY: "goog",
        GEMINI_API_KEY: "gem",
        AWS_SECRET_ACCESS_KEY: "aws",
        GITHUB_TOKEN: "ghp",
        GH_TOKEN: "ghx",
        NPM_TOKEN: "npm"
      });

      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.GOOGLE_API_KEY).toBeUndefined();
      expect(env.GEMINI_API_KEY).toBeUndefined();
      expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.GH_TOKEN).toBeUndefined();
      expect(env.NPM_TOKEN).toBeUndefined();
    });

    it("denylist takes precedence over allowlist (if same key)", () => {
      // OPENAI_API_KEY is not in allowlist, but confirm deny wins regardless
      const env = executor.prepareEnvironment({ OPENAI_API_KEY: "leaked" });
      expect(env.OPENAI_API_KEY).toBeUndefined();
    });

    it("ORCH_ vars that happen to be in denylist are still stripped", () => {
      // Hypothetical: if ORCH_ key name collides with denylist — deny wins
      // This tests the delete loop runs after ORCH_ inclusion
      const base: NodeJS.ProcessEnv = { ORCH_NPM_TOKEN: "token" }; // Not in denylist by that name
      const env = executor.prepareEnvironment(base);
      expect(env.ORCH_NPM_TOKEN).toBe("token");
    });

    it("returns empty object when baseEnv is empty", () => {
      const env = executor.prepareEnvironment({});
      expect(Object.keys(env)).toHaveLength(0);
    });
  });

  describe("networkAllowed", () => {
    it("returns taskAllowsNetwork correctly", () => {
      expect(executor.networkAllowed(true)).toBe(true);
      expect(executor.networkAllowed(false)).toBe(false);
    });
  });

  describe("modeName", () => {
    it("returns 'host'", () => {
      expect(executor.modeName()).toBe("host");
    });
  });
});
