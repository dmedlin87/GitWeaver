import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/core/shell.js";

// Mock PtyManager — hoisted so the mock factory can reference it
const { ptyRunMock } = vi.hoisted(() => ({ ptyRunMock: vi.fn() }));

vi.mock("../../src/execution/pty-manager.js", () => ({
  // Must be a regular function (not arrow) to be usable as a constructor
  PtyManager: function PtyManager() {
    return { run: ptyRunMock };
  },
}));

// Mock container-runner
const runInContainerMock =
  vi.fn<(options: unknown) => Promise<CommandResult>>();
vi.mock("../../src/execution/container-runner.js", () => ({
  runInContainer: (options: unknown) => runInContainerMock(options),
}));

import { CodexAdapter } from "../../src/providers/adapters/codex.js";

const BASE_REQUEST = {
  prompt: "Fix the bug",
  cwd: "/workspace",
  timeoutMs: 60_000,
};

describe("CodexAdapter – host mode", () => {
  beforeEach(() => {
    ptyRunMock.mockReset();
    runInContainerMock.mockReset();
  });

  it("builds correct args without outputSchemaPath", async () => {
    ptyRunMock.mockResolvedValue({
      code: 0,
      signal: 0,
      rawOutput: "raw",
      normalizedOutput: "norm",
    });

    const adapter = new CodexAdapter();
    const result = await adapter.execute(BASE_REQUEST);

    expect(ptyRunMock).toHaveBeenCalledTimes(1);
    const [command, args] = ptyRunMock.mock.calls[0]!;
    expect(command).toBe("codex");
    expect(args).toEqual([
      "exec",
      "--json",
      "-m",
      "o4-mini",
      "--cd",
      "/workspace",
      "Fix the bug",
    ]);
    expect(result.provider).toBe("codex");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("norm");
    expect(result.stderr).toBe("");
    expect(result.rawOutput).toBe("raw");
  });

  it("inserts --output-schema args when outputSchemaPath is provided", async () => {
    ptyRunMock.mockResolvedValue({
      code: 0,
      signal: 0,
      rawOutput: "",
      normalizedOutput: "",
    });

    const adapter = new CodexAdapter();
    await adapter.execute({
      ...BASE_REQUEST,
      outputSchemaPath: "/tmp/schema.json",
    });

    const [, args] = ptyRunMock.mock.calls[0]!;
    expect(args).toContain("--output-schema");
    expect(args).toContain("/tmp/schema.json");
    // schema args should be before prompt
    const schemaIdx = args.indexOf("--output-schema");
    const promptIdx = args.indexOf("Fix the bug");
    expect(schemaIdx).toBeLessThan(promptIdx);
  });

  it("heartbeat is >= 10_000", async () => {
    ptyRunMock.mockResolvedValue({
      code: 0,
      signal: 0,
      rawOutput: "",
      normalizedOutput: "",
    });

    const adapter = new CodexAdapter();
    // Use a very short timeout that would make floor(t/3) < 10_000
    await adapter.execute({ ...BASE_REQUEST, timeoutMs: 9_000 });

    const [, , opts] = ptyRunMock.mock.calls[0]! as [
      string,
      string[],
      { heartbeatMs: number },
    ];
    expect(opts.heartbeatMs).toBeGreaterThanOrEqual(10_000);
  });

  it("heartbeat uses floor(timeoutMs / 3) when result >= 10_000", async () => {
    ptyRunMock.mockResolvedValue({
      code: 0,
      signal: 0,
      rawOutput: "",
      normalizedOutput: "",
    });

    const adapter = new CodexAdapter();
    await adapter.execute({ ...BASE_REQUEST, timeoutMs: 90_000 });

    const [, , opts] = ptyRunMock.mock.calls[0]! as [
      string,
      string[],
      { heartbeatMs: number },
    ];
    expect(opts.heartbeatMs).toBe(30_000);
  });

  it("passes env and cwd through to pty", async () => {
    ptyRunMock.mockResolvedValue({
      code: 0,
      signal: 0,
      rawOutput: "",
      normalizedOutput: "",
    });

    const env = { MY_VAR: "val" };
    const adapter = new CodexAdapter();
    await adapter.execute({ ...BASE_REQUEST, env });

    const [, , opts] = ptyRunMock.mock.calls[0]! as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];
    expect(opts.cwd).toBe("/workspace");
    expect(opts.env).toBe(env);
  });

  it("propagates non-zero exit code", async () => {
    ptyRunMock.mockResolvedValue({
      code: 1,
      signal: 0,
      rawOutput: "err output",
      normalizedOutput: "",
    });

    const adapter = new CodexAdapter();
    const result = await adapter.execute(BASE_REQUEST);
    expect(result.exitCode).toBe(1);
  });
});

describe("CodexAdapter – container mode", () => {
  beforeEach(() => {
    ptyRunMock.mockReset();
    runInContainerMock.mockReset();
  });

  it("calls runInContainer with default runtime/image when not specified", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "ok", stderr: "" });

    const adapter = new CodexAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    expect(runInContainerMock).toHaveBeenCalledTimes(1);
    expect(ptyRunMock).not.toHaveBeenCalled();
    const opts = runInContainerMock.mock.calls[0]![0] as {
      runtime: string;
      image: string;
    };
    expect(opts.runtime).toBe("docker");
    expect(opts.image).toContain("gitweaver-runtime");
  });

  it("uses specified containerRuntime and containerImage", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new CodexAdapter();
    await adapter.execute({
      ...BASE_REQUEST,
      executionMode: "container",
      containerRuntime: "podman",
      containerImage: "custom/image:v1",
    });

    const opts = runInContainerMock.mock.calls[0]![0] as {
      runtime: string;
      image: string;
    };
    expect(opts.runtime).toBe("podman");
    expect(opts.image).toBe("custom/image:v1");
  });

  it("passes networkPolicy to runInContainer", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new CodexAdapter();
    await adapter.execute({
      ...BASE_REQUEST,
      executionMode: "container",
      networkPolicy: "deny",
    });

    const opts = runInContainerMock.mock.calls[0]![0] as { network: string };
    expect(opts.network).toBe("deny");
  });

  it("defaults networkPolicy to allow when not specified", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new CodexAdapter();
    await adapter.execute({ ...BASE_REQUEST, executionMode: "container" });

    const opts = runInContainerMock.mock.calls[0]![0] as { network: string };
    expect(opts.network).toBe("allow");
  });

  it("maps stdout/stderr/rawOutput from container result", async () => {
    runInContainerMock.mockResolvedValue({
      code: 2,
      stdout: "OUT",
      stderr: "ERR",
    });

    const adapter = new CodexAdapter();
    const result = await adapter.execute({
      ...BASE_REQUEST,
      executionMode: "container",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("OUT");
    expect(result.stderr).toBe("ERR");
    expect(result.rawOutput).toBe("OUTERR");
  });

  it("passes container hardening options through to runInContainer", async () => {
    runInContainerMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

    const adapter = new CodexAdapter();
    await adapter.execute({
      ...BASE_REQUEST,
      executionMode: "container",
      containerMemoryMb: 1024,
      containerCpuLimit: 1.5,
      containerRunAsUser: "1000:1000",
      containerDropCapabilities: true,
      containerReadOnlyRootfs: true,
    });

    const opts = runInContainerMock.mock.calls[0]![0] as {
      memoryMb: number;
      cpuLimit: number;
      user: string;
      dropCapabilities: boolean;
      readOnlyRootfs: boolean;
    };
    expect(opts.memoryMb).toBe(1024);
    expect(opts.cpuLimit).toBe(1.5);
    expect(opts.user).toBe("1000:1000");
    expect(opts.dropCapabilities).toBe(true);
    expect(opts.readOnlyRootfs).toBe(true);
  });
});
