/**
 * Shared mock-shell helpers for tests.
 * Provides factory functions for creating runCommand / runShellLine mocks.
 */
import { vi } from "vitest";
import type { CommandResult } from "../../src/core/shell.js";

export type RunCommandMock = ReturnType<typeof createRunCommandMock>;

/** Create a vi.fn() typed as runCommand and pre-wired with a default success response. */
export function createRunCommandMock(
  defaultResult: CommandResult = { code: 0, stdout: "", stderr: "" }
): ReturnType<typeof vi.fn<(command: string, args: string[], options?: unknown) => Promise<CommandResult>>> {
  const mock = vi.fn<(command: string, args: string[], options?: unknown) => Promise<CommandResult>>();
  mock.mockResolvedValue(defaultResult);
  return mock;
}

/** Convenience: make a CommandResult object. */
export function makeCommandResult(
  overrides: Partial<CommandResult> & Pick<CommandResult, "code">
): CommandResult {
  return { stdout: "", stderr: "", ...overrides };
}
