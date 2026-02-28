import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promptYesNo } from '../../src/core/prompt.js';
import * as readlinePromises from 'node:readline/promises';

vi.mock('node:readline/promises', () => {
  return {
    createInterface: vi.fn(),
  };
});

describe('promptYesNo', () => {
  let mockQuestion: ReturnType<typeof vi.fn>;
  let mockClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockQuestion = vi.fn();
    mockClose = vi.fn();

    vi.mocked(readlinePromises.createInterface).mockReturnValue({
      question: mockQuestion,
      close: mockClose,
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return defaultValue if response is empty', async () => {
    mockQuestion.mockResolvedValueOnce('');
    const result1 = await promptYesNo('Continue?', true);
    expect(result1).toBe(true);

    mockQuestion.mockResolvedValueOnce('');
    const result2 = await promptYesNo('Continue?', false);
    expect(result2).toBe(false);
  });

  it('should return true for "y" and "yes" (case-insensitive and trimmed)', async () => {
    mockQuestion.mockResolvedValueOnce('y');
    expect(await promptYesNo('Continue?')).toBe(true);

    mockQuestion.mockResolvedValueOnce('  Y  ');
    expect(await promptYesNo('Continue?')).toBe(true);

    mockQuestion.mockResolvedValueOnce('yes');
    expect(await promptYesNo('Continue?')).toBe(true);

    mockQuestion.mockResolvedValueOnce(' YeS ');
    expect(await promptYesNo('Continue?')).toBe(true);
  });

  it('should return false for "n", "no", or unrecognized input', async () => {
    mockQuestion.mockResolvedValueOnce('n');
    expect(await promptYesNo('Continue?')).toBe(false);

    mockQuestion.mockResolvedValueOnce('no');
    expect(await promptYesNo('Continue?')).toBe(false);

    mockQuestion.mockResolvedValueOnce('random');
    expect(await promptYesNo('Continue?')).toBe(false);
  });

  it('should format the prompt correctly based on defaultValue', async () => {
    mockQuestion.mockResolvedValueOnce('y');
    await promptYesNo('Continue?', true);
    expect(mockQuestion).toHaveBeenCalledWith('Continue? [Y/n] ');

    mockQuestion.mockResolvedValueOnce('y');
    await promptYesNo('Continue?', false);
    expect(mockQuestion).toHaveBeenCalledWith('Continue? [y/N] ');
  });

  it('should always close the readline interface, even if question throws', async () => {
    mockQuestion.mockRejectedValueOnce(new Error('Input error'));

    await expect(promptYesNo('Continue?')).rejects.toThrow('Input error');

    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
