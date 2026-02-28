import { describe, expect, it, vi, beforeEach } from "vitest";
import { runGate } from "../../src/verification/post-merge-gate.js";
import { runShellLine } from "../../src/core/shell.js";
import { runInContainer } from "../../src/execution/container-runner.js";

vi.mock("../../src/core/shell.js", () => ({
  runShellLine: vi.fn(),
}));

vi.mock("../../src/execution/container-runner.js", () => ({
  runInContainer: vi.fn(),
}));

describe("runGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("host execution", () => {
    it("runs command on the host successfully when executionMode is 'host'", async () => {
      vi.mocked(runShellLine).mockResolvedValue({
        code: 0,
        stdout: "success",
        stderr: ""
      });

      const result = await runGate("echo success", "/workspace", 1000, {
        executionMode: "host",
        env: { TEST_ENV: "1" }
      });

      expect(runShellLine).toHaveBeenCalledWith("echo success", {
        cwd: "/workspace",
        timeoutMs: 1000,
        env: { TEST_ENV: "1" }
      });
      expect(runInContainer).not.toHaveBeenCalled();

      expect(result).toEqual({
        ok: true,
        command: "echo success",
        stdout: "success",
        stderr: "",
        exitCode: 0
      });
    });

    it("runs command on the host successfully when no options are provided (default to host)", async () => {
      vi.mocked(runShellLine).mockResolvedValue({
        code: 0,
        stdout: "default success",
        stderr: ""
      });

      const result = await runGate("echo default", "/workspace");

      expect(runShellLine).toHaveBeenCalledWith("echo default", {
        cwd: "/workspace",
        timeoutMs: 120_000,
        env: undefined
      });
      expect(runInContainer).not.toHaveBeenCalled();

      expect(result).toEqual({
        ok: true,
        command: "echo default",
        stdout: "default success",
        stderr: "",
        exitCode: 0
      });
    });

    it("handles host command failure", async () => {
      vi.mocked(runShellLine).mockResolvedValue({
        code: 1,
        stdout: "",
        stderr: "command failed"
      });

      const result = await runGate("fail_cmd", "/workspace", 1000, {
        executionMode: "host"
      });

      expect(result).toEqual({
        ok: false,
        command: "fail_cmd",
        stdout: "",
        stderr: "command failed",
        exitCode: 1
      });
    });
  });

  describe("container execution", () => {
    it("runs command in a container successfully", async () => {
      vi.mocked(runInContainer).mockResolvedValue({
        code: 0,
        stdout: "container success",
        stderr: ""
      });

      const result = await runGate("echo in container", "/workspace", 1000, {
        executionMode: "container",
        containerRuntime: "podman",
        containerImage: "alpine:latest",
        networkPolicy: "deny",
        env: { TEST_ENV: "1" }
      });

      expect(runInContainer).toHaveBeenCalledWith({
        runtime: "podman",
        image: "alpine:latest",
        workspacePath: "/workspace",
        env: { TEST_ENV: "1" },
        command: "sh",
        args: ["-lc", "echo in container"],
        timeoutMs: 1000,
        network: "deny"
      });
      expect(runShellLine).not.toHaveBeenCalled();

      expect(result).toEqual({
        ok: true,
        command: "echo in container",
        stdout: "container success",
        stderr: "",
        exitCode: 0
      });
    });

    it("runs command in a container with default runtime and image", async () => {
      vi.mocked(runInContainer).mockResolvedValue({
        code: 0,
        stdout: "default container success",
        stderr: ""
      });

      const result = await runGate("echo in container default", "/workspace", 120_000, {
        executionMode: "container"
      });

      expect(runInContainer).toHaveBeenCalledWith({
        runtime: "docker",
        image: "ghcr.io/dmedlin87/gitweaver-runtime:latest",
        workspacePath: "/workspace",
        env: undefined,
        command: "sh",
        args: ["-lc", "echo in container default"],
        timeoutMs: 120_000,
        network: "allow"
      });

      expect(result).toEqual({
        ok: true,
        command: "echo in container default",
        stdout: "default container success",
        stderr: "",
        exitCode: 0
      });
    });

    it("handles container command failure", async () => {
      vi.mocked(runInContainer).mockResolvedValue({
        code: 2,
        stdout: "",
        stderr: "container failed"
      });

      const result = await runGate("fail_cmd", "/workspace", 1000, {
        executionMode: "container"
      });

      expect(result).toEqual({
        ok: false,
        command: "fail_cmd",
        stdout: "",
        stderr: "container failed",
        exitCode: 2
      });
    });

    it("passes container hardening flags when provided", async () => {
      vi.mocked(runInContainer).mockResolvedValue({
        code: 0,
        stdout: "ok",
        stderr: ""
      });

      await runGate("echo secure", "/workspace", 1000, {
        executionMode: "container",
        containerMemoryMb: 512,
        containerCpuLimit: 1,
        containerRunAsUser: "1000:1000",
        containerDropCapabilities: true,
        containerReadOnlyRootfs: true
      });

      expect(runInContainer).toHaveBeenCalledWith({
        runtime: "docker",
        image: "ghcr.io/dmedlin87/gitweaver-runtime:latest",
        workspacePath: "/workspace",
        env: undefined,
        command: "sh",
        args: ["-lc", "echo secure"],
        timeoutMs: 1000,
        network: "allow",
        memoryMb: 512,
        cpuLimit: 1,
        user: "1000:1000",
        dropCapabilities: true,
        readOnlyRootfs: true
      });
    });
  });
});
