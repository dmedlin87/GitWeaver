import { describe, expect, it } from "vitest";
import { createSecureExecutor } from "../../src/secure/factory.js";
import { HostExecutor } from "../../src/secure/host-executor.js";
import { ContainerExecutor } from "../../src/secure/container-executor.js";

describe("createSecureExecutor", () => {
  it("returns a HostExecutor for mode=host", () => {
    const executor = createSecureExecutor("host");
    expect(executor).toBeInstanceOf(HostExecutor);
    expect(executor.modeName()).toBe("host");
  });

  it("returns a ContainerExecutor for mode=container", () => {
    const executor = createSecureExecutor("container");
    expect(executor).toBeInstanceOf(ContainerExecutor);
    expect(executor.modeName()).toBe("container");
  });

  it("host executor always allows network", () => {
    const executor = createSecureExecutor("host");
    expect(executor.networkAllowed(false)).toBe(true);
    expect(executor.networkAllowed(true)).toBe(true);
  });

  it("container executor honors task network policy", () => {
    const executor = createSecureExecutor("container");
    expect(executor.networkAllowed(false)).toBe(false);
    expect(executor.networkAllowed(true)).toBe(true);
  });
});
