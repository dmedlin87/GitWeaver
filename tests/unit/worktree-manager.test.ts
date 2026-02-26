import { describe, it, expect, vi, afterEach } from 'vitest';
import { WorktreeManager } from '../../src/execution/worktree-manager.js';
import * as shell from '../../src/core/shell.js';
import { join } from 'path';
import { tmpdir } from 'os';
import * as fs from 'node:fs/promises';

// Mock fs/promises
vi.mock('node:fs/promises', async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    return {
        ...actual,
        mkdir: vi.fn(),
        rm: vi.fn(),
    };
});

// Mock runCommand
vi.mock('../../src/core/shell.js', () => ({
  runCommand: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
}));

describe('WorktreeManager', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates worktree with async fs operations', async () => {
    const manager = new WorktreeManager();
    const repoPath = '/repo';
    const runId = 'run-123';
    const taskId = 'task-456';
    const baseCommit = 'main';

    const result = await manager.create(repoPath, runId, taskId, baseCommit);

    const expectedRoot = join(tmpdir(), 'orc', 'run-123');
    const expectedPath = join(expectedRoot, 'task-456');

    expect(fs.mkdir).toHaveBeenCalledWith(expectedRoot, { recursive: true });
    expect(fs.rm).toHaveBeenCalledWith(expectedPath, { recursive: true, force: true });

    expect(shell.runCommand).toHaveBeenCalledWith(
        'git',
        ['-C', repoPath, 'worktree', 'add', '-B', 'orch/run-123/task-456', expectedPath, baseCommit],
        expect.any(Object)
    );

    expect(result).toEqual({
        path: expectedPath,
        branch: 'orch/run-123/task-456'
    });
  });
});
