import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { killProcessTree } from '../../src/execution/watchdog.js';
import { runCommand } from '../../src/core/shell.js';

vi.mock('../../src/core/shell.js', () => ({
  runCommand: vi.fn(),
}));

describe('watchdog', () => {
  const originalPlatform = process.platform;
  let mockRunCommand: Mock;
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRunCommand = vi.mocked(runCommand);
    mockRunCommand.mockReset();
    mockRunCommand.mockResolvedValue({ code: 0, stdout: '', stderr: '' });

    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

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
  });

  describe('killProcessTree', () => {
    it('uses taskkill on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true
      });

      await killProcessTree(1234);

      expect(mockRunCommand).toHaveBeenCalledWith(
        'taskkill',
        ['/PID', '1234', '/T', '/F'],
        { timeoutMs: 10_000 }
      );
      expect(killSpy).not.toHaveBeenCalled();
    });

    it('uses process.kill with process group id on non-Windows', async () => {
      await killProcessTree(1234);

      expect(mockRunCommand).not.toHaveBeenCalled();
      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledTimes(1);
    });

    it('falls back to standard process.kill if process group kill fails', async () => {
      killSpy.mockImplementationOnce(() => {
        throw new Error('kill ESRCH');
      });

      await killProcessTree(1234);

      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledTimes(2);
    });

    it('silently ignores errors if both kill attempts fail', async () => {
      killSpy.mockImplementation(() => {
        throw new Error('kill ESRCH');
      });

      await expect(killProcessTree(1234)).resolves.toBeUndefined();

      expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM');
      expect(killSpy).toHaveBeenCalledTimes(2);
    });
  });
});
