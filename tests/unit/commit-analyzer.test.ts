import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeCommit, latestCommit } from '../../src/verification/commit-analyzer.js';
import { runCommand } from '../../src/core/shell.js';

vi.mock('../../src/core/shell.js', () => ({
  runCommand: vi.fn(),
}));

describe('commit-analyzer', () => {
  const mockRunCommand = vi.mocked(runCommand);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeCommit', () => {
    it('returns commit hash and changed files when files are modified', async () => {
      mockRunCommand.mockResolvedValue({
        code: 0,
        stdout: 'src/file1.ts\nsrc/file2.ts\n',
        stderr: '',
      });

      const result = await analyzeCommit('/mock/repo', 'abc1234');

      expect(mockRunCommand).toHaveBeenCalledWith(
        'git',
        ['-C', '/mock/repo', 'show', '--name-only', '--pretty=format:', 'abc1234'],
        { timeoutMs: 30_000 }
      );
      expect(result).toEqual({
        commitHash: 'abc1234',
        changedFiles: ['src/file1.ts', 'src/file2.ts'],
        hasChanges: true,
      });
    });

    it('returns empty array and hasChanges: false when no files are modified', async () => {
      mockRunCommand.mockResolvedValue({
        code: 0,
        stdout: '\n\n',
        stderr: '',
      });

      const result = await analyzeCommit('/mock/repo', 'abc1234');

      expect(result).toEqual({
        commitHash: 'abc1234',
        changedFiles: [],
        hasChanges: false,
      });
    });

    it('throws an error if git command fails', async () => {
      mockRunCommand.mockResolvedValue({
        code: 128,
        stdout: '',
        stderr: 'fatal: bad object abc1234',
      });

      await expect(analyzeCommit('/mock/repo', 'abc1234')).rejects.toThrow(
        'Failed to inspect commit abc1234: fatal: bad object abc1234'
      );
    });
  });

  describe('latestCommit', () => {
    it('returns the trimmed latest commit hash on success', async () => {
      mockRunCommand.mockResolvedValue({
        code: 0,
        stdout: 'def5678\n',
        stderr: '',
      });

      const result = await latestCommit('/mock/repo');

      expect(mockRunCommand).toHaveBeenCalledWith(
        'git',
        ['-C', '/mock/repo', 'rev-parse', 'HEAD'],
        { timeoutMs: 10_000 }
      );
      expect(result).toBe('def5678');
    });

    it('throws an error if git command fails', async () => {
      mockRunCommand.mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'fatal: not a git repository',
      });

      await expect(latestCommit('/mock/repo')).rejects.toThrow(
        'Unable to read HEAD: fatal: not a git repository'
      );
    });
  });
});
