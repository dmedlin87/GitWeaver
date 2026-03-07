import { describe, expect, it } from "vitest";
import { ContainerExecutor } from "../../src/secure/container-executor.js";

describe("ContainerExecutor", () => {
  const executor = new ContainerExecutor();

  describe("prepareEnvironment", () => {
    it("inherits allowlist behavior from HostExecutor", () => {
      const env = executor.prepareEnvironment({
        PATH: "/usr/bin",
        CI: "true",
        UNRELATED: "should-not-appear"
      });
      expect(env.PATH).toBe("/usr/bin");
      expect(env.CI).toBe("true");
      expect(env.UNRELATED).toBeUndefined();
    });

    it("inherits ORCH_ pass-through from HostExecutor", () => {
      const env = executor.prepareEnvironment({ ORCH_RUN_ID: "run-xyz" });
      expect(env.ORCH_RUN_ID).toBe("run-xyz");
    });

    it("inherits denylist behavior from HostExecutor", () => {
      const env = executor.prepareEnvironment({
        ANTHROPIC_API_KEY: "secret",
        GITHUB_TOKEN: "ghp_token"
      });
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.GITHUB_TOKEN).toBeUndefined();
    });
  });

  describe("networkAllowed", () => {
    it("honors taskAllowsNetwork=true", () => {
      expect(executor.networkAllowed(true)).toBe(true);
    });

    it("honors taskAllowsNetwork=false (deny)", () => {
      expect(executor.networkAllowed(false)).toBe(false);
    });

    it("returns false if taskAllowsNetwork is undefined", () => {
      expect(executor.networkAllowed(undefined)).toBe(false);
    });
  });

  describe("modeName", () => {
    it("returns 'container'", () => {
      expect(executor.modeName()).toBe("container");
    });
  });
});
