import { describe, it, expect, vi } from 'vitest';
import { withRetry, isRetryableError } from '../retry';

describe('withRetry', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');
    
    const result = await withRetry(fn, { baseDelayMs: 10 });
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fails'));
    
    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 10 }))
      .rejects.toThrow('always fails');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');
    
    await withRetry(fn, { baseDelayMs: 10, onRetry });
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1);
  });
});

describe('isRetryableError', () => {
  it('returns true for network errors', () => {
    expect(isRetryableError(new Error('Network error'))).toBe(true);
    expect(isRetryableError(new Error('Connection timeout'))).toBe(true);
    expect(isRetryableError(new Error('Failed to fetch'))).toBe(true);
  });

  it('returns false for permanent errors', () => {
    expect(isRetryableError(new Error('Permission denied'))).toBe(false);
    expect(isRetryableError(new Error('Unauthorized access'))).toBe(false);
    expect(isRetryableError(new Error('invalid_argument: bad data'))).toBe(false);
    expect(isRetryableError(new Error('Resource already exists'))).toBe(false);
  });

  it('returns true for unknown errors (fail-open strategy)', () => {
    expect(isRetryableError(new Error('Validation failed'))).toBe(true);
    expect(isRetryableError(new Error('Something went wrong'))).toBe(true);
  });
});
