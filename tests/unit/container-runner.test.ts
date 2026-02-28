import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/core/shell.js";

const runCommandMock = vi.fn<(command: string, args: string[], options?: unknown) => Promise<CommandResult>>();
vi.mock("../../src/core/shell.js", () => ({
  runCommand: (command: string, args: string[], options?: unknown) => runCommandMock(command, args, options)
}));

import { runInContainer } from "../../src/execution/container-runner.js";

const BASE_OPTIONS = {
  runtime: "docker" as const,
  image: "my/image:latest",
  workspacePath: "/workspace",
  command: "codex",
  args: ["exec", "--json"],
  timeoutMs: 30_000,
  network: "allow" as const
};

describe("runInContainer", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
    runCommandMock.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  it("calls docker with correct base args", async () => {
    await runInContainer(BASE_OPTIONS);

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = runCommandMock.mock.calls[0]!;
    expect(cmd).toBe("docker");
    expect(args).toContain("run");
    expect(args).toContain("--rm");
    expect(args).toContain("-i");
    expect(args).toContain("/workspace");
    expect(args).toContain("my/image:latest");
    expect(args).toContain("codex");
  });

  it("uses podman when runtime is podman", async () => {
    await runInContainer({ ...BASE_OPTIONS, runtime: "podman" });

    const [cmd] = runCommandMock.mock.calls[0]!;
    expect(cmd).toBe("podman");
  });

  it("mounts workspacePath as /workspace volume", async () => {
    await runInContainer({ ...BASE_OPTIONS, workspacePath: "/my/project" });

    const [, args] = runCommandMock.mock.calls[0]!;
    const volIdx = args.indexOf("-v");
    expect(volIdx).toBeGreaterThan(-1);
    expect(args[volIdx + 1]).toBe("/my/project:/workspace");
  });

  it("passes --network none when network is deny", async () => {
    await runInContainer({ ...BASE_OPTIONS, network: "deny" });

    const [, args] = runCommandMock.mock.calls[0]!;
    expect(args).toContain("--network");
    expect(args).toContain("none");
  });

  it("does NOT include --network none when network is allow", async () => {
    await runInContainer({ ...BASE_OPTIONS, network: "allow" });

    const [, args] = runCommandMock.mock.calls[0]!;
    expect(args).not.toContain("--network");
    expect(args).not.toContain("none");
  });

  it("passes env as -e KEY=VALUE flags excluding undefined values", async () => {
    await runInContainer({
      ...BASE_OPTIONS,
      env: { FOO: "bar", BAZ: undefined, QUX: "quux" }
    });

    const [, args] = runCommandMock.mock.calls[0]!;
    expect(args).toContain("-e");
    expect(args).toContain("FOO=bar");
    expect(args).toContain("QUX=quux");
    // undefined values should not appear
    const envPairs = args.filter((a, i) => args[i - 1] === "-e");
    expect(envPairs.some((p) => p.startsWith("BAZ="))).toBe(false);
  });

  it("passes no -e flags when env is undefined", async () => {
    await runInContainer({ ...BASE_OPTIONS, env: undefined });

    const [, args] = runCommandMock.mock.calls[0]!;
    expect(args).not.toContain("-e");
  });

  it("passes stdin to runCommand options", async () => {
    await runInContainer({ ...BASE_OPTIONS, stdin: "hello stdin" });

    const [, , opts] = runCommandMock.mock.calls[0]! as [string, string[], { stdin?: string }];
    expect(opts?.stdin).toBe("hello stdin");
  });

  it("includes additional command args after image", async () => {
    await runInContainer({ ...BASE_OPTIONS, args: ["exec", "--json", "--cd", "/path"] });

    const [, args] = runCommandMock.mock.calls[0]!;
    const imageIdx = args.indexOf("my/image:latest");
    expect(args.slice(imageIdx)).toEqual(["my/image:latest", "codex", "exec", "--json", "--cd", "/path"]);
  });

  it("sets cwd on runCommand to workspacePath", async () => {
    await runInContainer({ ...BASE_OPTIONS, workspacePath: "/my/workspace" });

    const [, , opts] = runCommandMock.mock.calls[0]! as [string, string[], { cwd: string }];
    expect(opts?.cwd).toBe("/my/workspace");
  });

  it("returns the CommandResult from runCommand", async () => {
    runCommandMock.mockResolvedValue({ code: 42, stdout: "OUT", stderr: "ERR" });

    const result = await runInContainer(BASE_OPTIONS);
    expect(result.code).toBe(42);
    expect(result.stdout).toBe("OUT");
    expect(result.stderr).toBe("ERR");
  });
});
