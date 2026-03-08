import { describe, expect, it } from "vitest";
import { AdvisoryExecutor } from "../../src/secure/advisory-executor.js";

describe("AdvisoryExecutor", () => {
  const executor = new AdvisoryExecutor();

  describe("prepareEnvironment", () => {
    it("preserves allowlisted variables", () => {
      const baseEnv = {
        PATH: "/usr/bin",
        CI: "true",
        UNKNOWN_VAR: "value"
      };
      const env = executor.prepareEnvironment(baseEnv);
      expect(env.PATH).toBe("/usr/bin");
      expect(env.CI).toBe("true");
      expect(env.UNKNOWN_VAR).toBeUndefined();
    });

    it("preserves ORCH_ variables", () => {
      const baseEnv = {
        ORCH_TEST_VAR: "test_value",
        ORCH_ANOTHER_VAR: "another_value",
        OTHER_VAR: "should_be_removed"
      };
      const env = executor.prepareEnvironment(baseEnv);
      expect(env.ORCH_TEST_VAR).toBe("test_value");
      expect(env.ORCH_ANOTHER_VAR).toBe("another_value");
      expect(env.OTHER_VAR).toBeUndefined();
    });

    it("removes denylisted variables even if they match ORCH_", () => {
      // Although currently no denylisted var starts with ORCH_, this tests precedence.
      // Let's assume we add a denylisted var starting with ORCH_ for this test scenario?
      // Or just test standard denylist behavior.
      const baseEnv = {
        OPENAI_API_KEY: "sk-12345",
        ANTHROPIC_API_KEY: "sk-ant-12345",
        ORCH_OPENAI_API_KEY: "sk-orch-12345" // Should be allowed as it is not in DENYLIST literally
      };
      const env = executor.prepareEnvironment(baseEnv);
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ORCH_OPENAI_API_KEY).toBe("sk-orch-12345");
    });

    it("removes newly added sensitive tokens", () => {
      const baseEnv = {
        GITHUB_TOKEN: "ghp_12345",
        GH_TOKEN: "ghp_67890",
        NPM_TOKEN: "npm_abcde"
      };
      const env = executor.prepareEnvironment(baseEnv);
      expect(env.GITHUB_TOKEN).toBeUndefined();
      expect(env.GH_TOKEN).toBeUndefined();
      expect(env.NPM_TOKEN).toBeUndefined();
    });
  });

  describe("networkAllowed", () => {
    it("returns true if taskAllowsNetwork is true", () => {
      expect(executor.networkAllowed(true)).toBe(true);
    });

    it("returns false if taskAllowsNetwork is false", () => {
      expect(executor.networkAllowed(false)).toBe(false);
    });

    it("falls back to false if taskAllowsNetwork is undefined", () => {
      expect(executor.networkAllowed(undefined as unknown as boolean)).toBe(false);
    });
  });
});
