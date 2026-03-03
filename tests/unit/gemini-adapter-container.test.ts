import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/core/shell.js";

const runCommandMock = vi.fn<(command: string, args: string[], options?: unknown) => Promise<CommandResult>>();
vi.mock("../../src/core/shell.js", () => ({
  runCommand: (command: string, args: string[], options?: unknown) => runCommandMock(command, args, options)
}));

const runInContainerMock = vi.fn<(options: unknown) => Promise<CommandResult>>();
vi.mock("../../src/execution/container-runner.js", () => ({
  runInContainer: (options: unknown) => runInContainerMock(options)
}));

import { GeminiAdapter } from "../../src/providers/adapters/gemini.js";

const BASE_REQUEST = {
  prompt: "my prompt",
  cwd: "/workspace",
  timeoutMs: 30_000
};

describe("GeminiAdapter – container branch", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
    runInContainerMock.mockReset();
  });

  it("calls runInContainer when executionMode is container", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "result", stderr: "" });

    const adapter = new GeminiAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    expect(runInContainerMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).not.toHaveBeenCalled();
  });

  it("calls runCommand when executionMode is host (default)", async () => {
    runCommandMock.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const adapter = new GeminiAdapter();
    await adapter.execute(BASE_REQUEST);

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runInContainerMock).not.toHaveBeenCalled();
  });

  it("uses docker and default image in container mode", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new GeminiAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    const opts = runInContainerMock.mock.calls[0]![0] as { runtime: string; image: string };
    expect(opts.runtime).toBe("docker");
    expect(opts.image).toContain("gitweaver-runtime");
  });

  it("forwards stdin (prompt) to container", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new GeminiAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    const opts = runInContainerMock.mock.calls[0]![0] as { stdin: string };
    expect(opts.stdin).toBe("my prompt");
  });

  it("passes networkPolicy deny to container", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new GeminiAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container", networkPolicy: "deny" });

    const opts = runInContainerMock.mock.calls[0]![0] as { network: string };
    expect(opts.network).toBe("deny");
  });

  it("defaults network to deny in container mode", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new GeminiAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    const opts = runInContainerMock.mock.calls[0]![0] as { network: string };
    expect(opts.network).toBe("deny");
  });

  it("maps stdout/stderr/rawOutput from container result", async () => {
    runInContainerMock.mockResolvedValue({ code: 5, stdout: "GEM", stderr: "INI" });

    const adapter = new GeminiAdapter();
    const result = await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe("GEM");
    expect(result.stderr).toBe("INI");
    expect(result.rawOutput).toBe("GEMINI");
  });

  it("uses custom runtime and image overrides", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new GeminiAdapter();
    await adapter.execute({
      ...BASE_REQUEST,
      executionMode: "container",
      containerRuntime: "podman",
      containerImage: "custom-gemini:2.0"
    });

    const opts = runInContainerMock.mock.calls[0]![0] as { runtime: string; image: string };
    expect(opts.runtime).toBe("podman");
    expect(opts.image).toBe("custom-gemini:2.0");
  });
});
