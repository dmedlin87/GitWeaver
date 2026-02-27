import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { EventEmitter } from 'events';
import { runCommand, runShellLine } from '../../src/core/shell.js';
import * as cp from 'node:child_process';
import { PassThrough } from 'stream';

vi.mock('node:child_process');

describe('shell', () => {
  let mockSpawn: Mock;
  // Store the original platform to restore it after each test
  const originalPlatform = process.platform;

  beforeEach(() => {
    mockSpawn = vi.mocked(cp.spawn);
    mockSpawn.mockReset();

    // Default to linux for most tests to ensure consistency
    Object.defineProperty(process, 'platform', {
      value: 'linux',
      configurable: true
    });
  });

  afterEach(() => {
    // Restore original platform
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
      configurable: true
    });
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function createMockChildProcess() {
    const child = new EventEmitter() as any;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    };
    child.kill = vi.fn();
    return child;
  }

  describe('runCommand', () => {
    it('resolves with stdout and exit code 0 on success', async () => {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('echo', ['hello']);

      child.stdout.emit('data', 'hello');
      child.emit('close', 0);

      const result = await promise;
      expect(result).toEqual({
        code: 0,
        stdout: 'hello',
        stderr: '',
      });
      expect(mockSpawn).toHaveBeenCalledWith('echo', ['hello'], expect.objectContaining({
        shell: false,
        stdio: 'pipe',
      }));
    });

    it('resolves with stderr and non-zero exit code on failure', async () => {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('ls', ['nonexistent']);

      child.stderr.emit('data', 'No such file');
      child.emit('close', 1);

      const result = await promise;
      expect(result).toEqual({
        code: 1,
        stdout: '',
        stderr: 'No such file',
      });
    });

    it('rejects on spawn error', async () => {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('invalid_command', []);
      const error = new Error('spawn ENOENT');

      // We need to trigger the error event on the next tick or immediately
      child.emit('error', error);

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    it('handles timeout correctly', async () => {
      vi.useFakeTimers();
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('sleep', ['10'], { timeoutMs: 1000 });

      // Fast-forward time to trigger timeout
      vi.advanceTimersByTime(1000);

      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Simulate process exit after kill
      child.emit('close', null); // Code is null when killed by signal usually, or we can pass a code

      const result = await promise;
      expect(result.code).toBe(124);
      expect(result.stderr).toContain('Command timed out after 1000ms');
    });

    it('writes to stdin if provided', async () => {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const stdinContent = 'some input';
      const promise = runCommand('cat', [], { stdin: stdinContent });

      child.emit('close', 0);

      await promise;
      expect(child.stdin.write).toHaveBeenCalledWith(stdinContent);
      expect(child.stdin.end).toHaveBeenCalled();
    });
  });

  describe('runShellLine', () => {
    it('uses sh -lc on non-Windows', async () => {
      // Platform is already set to linux in beforeEach

      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runShellLine('echo hello');
      child.emit('close', 0);
      await promise;

      expect(mockSpawn).toHaveBeenCalledWith('sh', ['-lc', 'echo hello'], expect.any(Object));
    });

    it('uses powershell on Windows', async () => {
      // Mock process.platform for Windows
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true
      });

      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runShellLine('echo hello');
      child.emit('close', 0);
      await promise;

      // On Windows, runCommand wraps execution in cmd.exe
      // The command passed to runCommand is "powershell" with args ["-NoProfile", "-Command", "echo hello"]
      // buildSpawnSpec constructs: cmd.exe /d /s /c powershell -NoProfile -Command "echo hello"
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/d', '/s', '/c', 'powershell -NoProfile -Command "echo hello"'],
        expect.any(Object)
      );
    });
  });
});
