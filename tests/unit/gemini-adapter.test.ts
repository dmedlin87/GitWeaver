import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../../src/core/shell.js";
import { GeminiAdapter } from "../../src/providers/adapters/gemini.js";

const runCommandMock =
  vi.fn<
    (
      command: string,
      args: string[],
      options?: unknown,
    ) => Promise<CommandResult>
  >();

vi.mock("../../src/core/shell.js", () => ({
  runCommand: (command: string, args: string[], options?: unknown) =>
    runCommandMock(command, args, options),
}));

describe("GeminiAdapter", () => {
  beforeEach(() => {
    runCommandMock.mockReset();
  });

  it("passes prompt via stdin and keeps args deterministic", async () => {
    runCommandMock.mockResolvedValue({
      code: 0,
      stdout: '{"status":"ok"}',
      stderr: "",
    });

    const adapter = new GeminiAdapter();
    const prompt =
      'Update docs:\n- handle files, hard, n\n- keep punctuation: "quotes", commas, semicolons;';
    const result = await adapter.execute({
      prompt,
      cwd: "C:/repo/worktree",
      timeoutMs: 45_000,
    });

    expect(runCommandMock).toHaveBeenCalledTimes(1);
    expect(runCommandMock).toHaveBeenCalledWith(
      "gemini",
      [
        "--model",
        "flash",
        "--prompt",
        "orchestrator_input",
        "--output-format",
        "json",
        "--approval-mode",
        "auto_edit",
      ],
      {
        cwd: "C:/repo/worktree",
        env: undefined,
        timeoutMs: 45_000,
        stdin: prompt,
      },
    );
    expect(result).toEqual({
      provider: "gemini",
      exitCode: 0,
      stdout: '{"status":"ok"}',
      stderr: "",
      rawOutput: '{"status":"ok"}',
    });
  });

  it("preserves non-zero exits and stderr", async () => {
    runCommandMock.mockResolvedValue({
      code: 1,
      stdout: "",
      stderr: "usage: gemini [options]",
    });

    const adapter = new GeminiAdapter();
    const result = await adapter.execute({
      prompt: "test",
      cwd: "C:/repo/worktree",
      timeoutMs: 30_000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("usage:");
  });

  it("passes env to runCommand", async () => {
    runCommandMock.mockResolvedValue({
      code: 0,
      stdout: "",
      stderr: "",
    });

    const adapter = new GeminiAdapter();
    const env = { TEST_VAR: "value" };
    await adapter.execute({
      prompt: "test",
      cwd: "/tmp",
      timeoutMs: 1000,
      env,
    });

    expect(runCommandMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env,
      }),
    );
  });
});
