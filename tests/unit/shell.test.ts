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

      // Simulate process exit after kill with non-null exit code
      child.emit('close', 0);

      const result = await promise;
      expect(result.code).toBe(124);
      expect(result.stderr).toContain('Command timed out after 1000ms');
    });

    it('sends SIGKILL if process does not exit after SIGTERM', async () => {
      vi.useFakeTimers();
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('sleep', ['10'], { timeoutMs: 1000 });

      // Fast-forward time to trigger timeout and SIGTERM
      vi.advanceTimersByTime(1000);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      // Fast-forward another 5000ms to trigger SIGKILL
      vi.advanceTimersByTime(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      // close fires before the forceResolve grace period (2000ms); it cancels forceResolve
      child.emit('close', null);
      const result = await promise;
      expect(result.code).toBe(124);
    });

    it('force-resolves after SIGKILL if close event never fires (Windows pipe inheritance)', async () => {
      vi.useFakeTimers();
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('sleep', ['10'], { timeoutMs: 1000 });

      vi.advanceTimersByTime(1000);
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');

      vi.advanceTimersByTime(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      // close never fires (grandchild holds pipe open on Windows); forceResolve fires after 2000ms
      vi.advanceTimersByTime(2000);

      const result = await promise;
      expect(result.code).toBe(124);
      expect(result.stderr).toContain('Command timed out after 1000ms');
    });

    it('handles process exit without timeout with null code', async () => {
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('echo', ['hello']);

      child.stdout.emit('data', 'hello');
      child.emit('close', null);

      const result = await promise;
      expect(result).toEqual({
        code: 1, // falls back to 1
        stdout: 'hello',
        stderr: '',
      });
    });

    it('ignores errors when sending SIGKILL', async () => {
      vi.useFakeTimers();
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('sleep', ['10'], { timeoutMs: 1000 });

      vi.advanceTimersByTime(1000);

      // Make kill throw an error when called with SIGKILL
      child.kill.mockImplementation((signal) => {
        if (signal === 'SIGKILL') throw new Error('Process already terminated');
      });

      vi.advanceTimersByTime(5000);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');

      child.emit('close', null);
      const result = await promise;
      expect(result.code).toBe(124);
    });

    it('clears timeout if process errors', async () => {
      vi.useFakeTimers();
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('invalid_command', [], { timeoutMs: 1000 });

      const error = new Error('spawn ENOENT');
      child.emit('error', error);

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    it('clears forceKill timeout if process errors after timeout', async () => {
      vi.useFakeTimers();
      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('sleep', ['10'], { timeoutMs: 1000 });

      // Fast-forward time to trigger timeout and set forceKill timeout
      vi.advanceTimersByTime(1000);

      const error = new Error('some error');
      child.emit('error', error);

      await expect(promise).rejects.toThrow('some error');
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

    it('handles quotes, spaces, and empty strings on Windows correctly', async () => {
      // Mock process.platform for Windows
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true
      });

      const child = createMockChildProcess();
      mockSpawn.mockReturnValue(child);

      const promise = runCommand('echo', ['', 'hello world', 'with"quote']);
      child.emit('close', 0);
      await promise;

      // verify that empty strings, strings with spaces, and strings with quotes are handled
      // via quoteWindowsArg
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/d', '/s', '/c', 'echo "" "hello world" "with\\"quote"'],
        expect.any(Object)
      );
    });
  });
});
