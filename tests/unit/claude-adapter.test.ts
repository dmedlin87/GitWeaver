import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/core/shell.js";

const { ptyRunMock } = vi.hoisted(() => ({ ptyRunMock: vi.fn() }));

vi.mock("../../src/execution/pty-manager.js", () => ({
  PtyManager: function PtyManager() { return { run: ptyRunMock }; }
}));

const runInContainerMock = vi.fn<(options: unknown) => Promise<CommandResult>>();
vi.mock("../../src/execution/container-runner.js", () => ({
  runInContainer: (options: unknown) => runInContainerMock(options)
}));

import { ClaudeAdapter } from "../../src/providers/adapters/claude.js";

const BASE_REQUEST = {
  prompt: "Do something",
  cwd: "/ws",
  timeoutMs: 60_000
};

describe("ClaudeAdapter – host mode", () => {
  beforeEach(() => {
    ptyRunMock.mockReset();
    runInContainerMock.mockReset();
  });

  it("uses correct CLI args for host mode", async () => {
    ptyRunMock.mockResolvedValue({ code: 0, signal: 0, rawOutput: "raw", normalizedOutput: "norm" });

    const adapter = new ClaudeAdapter();
    const result = await adapter.execute(BASE_REQUEST);

    expect(ptyRunMock).toHaveBeenCalledTimes(1);
    const [command, args] = ptyRunMock.mock.calls[0]!;
    expect(command).toBe("claude");
    expect(args).toContain("--print");
    expect(args).toContain("--output-format");
    expect(args).toContain("json");
    expect(args).toContain("Do something");

    expect(result.provider).toBe("claude");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("norm");
    expect(result.stderr).toBe("");
    expect(result.rawOutput).toBe("raw");
  });

  it("heartbeat is always >= 10_000", async () => {
    ptyRunMock.mockResolvedValue({ code: 0, signal: 0, rawOutput: "", normalizedOutput: "" });

    const adapter = new ClaudeAdapter();
    await adapter.execute({ ...BASE_REQUEST, timeoutMs: 1_000 });

    const [, , opts] = ptyRunMock.mock.calls[0]! as [string, string[], { heartbeatMs: number }];
    expect(opts.heartbeatMs).toBeGreaterThanOrEqual(10_000);
  });

  it("propagates non-zero exit code and empty stderr", async () => {
    ptyRunMock.mockResolvedValue({ code: 1, signal: 0, rawOutput: "failed", normalizedOutput: "failed" });

    const adapter = new ClaudeAdapter();
    const result = await adapter.execute(BASE_REQUEST);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
  });

  it("passes env and cwd to pty", async () => {
    ptyRunMock.mockResolvedValue({ code: 0, signal: 0, rawOutput: "", normalizedOutput: "" });

    const env = { CLAUDE_ENV: "test" };
    const adapter = new ClaudeAdapter();
    await adapter.execute({ ...BASE_REQUEST, env });

    const [, , opts] = ptyRunMock.mock.calls[0]! as [string, string[], { cwd: string; env: NodeJS.ProcessEnv }];
    expect(opts.cwd).toBe("/ws");
    expect(opts.env).toBe(env);
  });
});

describe("ClaudeAdapter – container mode", () => {
  beforeEach(() => {
    ptyRunMock.mockReset();
    runInContainerMock.mockReset();
  });

  it("calls runInContainer and skips pty", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const adapter = new ClaudeAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    expect(runInContainerMock).toHaveBeenCalledTimes(1);
    expect(ptyRunMock).not.toHaveBeenCalled();
  });

  it("uses docker and default image by default", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new ClaudeAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    const opts = runInContainerMock.mock.calls[0]![0] as { runtime: string; image: string };
    expect(opts.runtime).toBe("docker");
    expect(opts.image).toContain("gitweaver-runtime");
  });

  it("uses provided runtime/image overrides", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new ClaudeAdapter();
    await adapter.execute({
      ...BASE_REQUEST,
      executionMode: "container",
      containerRuntime: "podman",
      containerImage: "my-image:1.0"
    });

    const opts = runInContainerMock.mock.calls[0]![0] as { runtime: string; image: string };
    expect(opts.runtime).toBe("podman");
    expect(opts.image).toBe("my-image:1.0");
  });

  it("passes networkPolicy deny to runInContainer", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new ClaudeAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container", networkPolicy: "deny" });

    const opts = runInContainerMock.mock.calls[0]![0] as { network: string };
    expect(opts.network).toBe("deny");
  });

  it("defaults network to allow when no networkPolicy set", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new ClaudeAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    const opts = runInContainerMock.mock.calls[0]![0] as { network: string };
    expect(opts.network).toBe("allow");
  });

  it("maps stdout/stderr/rawOutput from container result", async () => {
    runInContainerMock.mockResolvedValue({ code: 3, stdout: "CLAUDE_OUT", stderr: "CLAUDE_ERR" });

    const adapter = new ClaudeAdapter();
    const result = await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    expect(result.exitCode).toBe(3);
    expect(result.stdout).toBe("CLAUDE_OUT");
    expect(result.stderr).toBe("CLAUDE_ERR");
    expect(result.rawOutput).toBe("CLAUDE_OUTCLAUDE_ERR");
  });
});
