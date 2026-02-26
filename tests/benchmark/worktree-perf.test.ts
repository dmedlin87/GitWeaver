import { describe, it, vi, beforeAll, afterAll } from 'vitest';
import { WorktreeManager } from '../../src/execution/worktree-manager.js';
import * as shell from '../../src/core/shell.js';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, mkdirSync } from 'fs';

// Mock runCommand to avoid git operations
vi.mock('../../src/core/shell.js', () => ({
  runCommand: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
}));

describe('WorktreeManager Performance', () => {
  const manager = new WorktreeManager();
  const repoPath = join(tmpdir(), 'test-repo');
  const runId = 'perf-test-' + Date.now();
  const root = join(tmpdir(), 'orc', runId);

  beforeAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
    mkdirSync(root, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  it('measures event loop responsiveness during creation', async () => {
    const iterations = 500;
    const tasks = Array.from({ length: iterations }, (_, i) => `task-${i}`);

    let ticks = 0;
    const interval = setInterval(() => {
      ticks++;
    }, 0); // As fast as possible

    const start = performance.now();

    await Promise.all(tasks.map(taskId =>
      manager.create(repoPath, runId, taskId, 'main')
    ));

    const end = performance.now();
    clearInterval(interval);

    const duration = end - start;

    console.log(`\n---------------------------------------------------`);
    console.log(`Creating ${iterations} worktrees took ${duration.toFixed(2)}ms`);
    console.log(`Event loop ticks (responsiveness): ${ticks}`);
    console.log(`Ticks per ms: ${(ticks / duration).toFixed(2)}`);
    console.log(`---------------------------------------------------\n`);
  });
});
