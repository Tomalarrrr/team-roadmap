import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout, TimeoutError, sleep, jitter } from '../fetchWithTimeout';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('jitter', () => {
  it('stays within ±ratio of the base', () => {
    for (let i = 0; i < 200; i++) {
      const v = jitter(1000, 0.2);
      expect(v).toBeGreaterThanOrEqual(800);
      expect(v).toBeLessThanOrEqual(1200);
    }
  });

  it('is roughly centered on the base over many samples', () => {
    const samples = Array.from({ length: 2000 }, () => jitter(1000, 0.2));
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(Math.abs(avg - 1000)).toBeLessThan(40);
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    const p = sleep(500);
    let done = false;
    p.then(() => { done = true; });
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await p;
    expect(done).toBe(true);
  });
});

describe('fetchWithTimeout', () => {
  it('returns the response when fetch resolves in time', async () => {
    const res = new Response('ok', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));
    const out = await fetchWithTimeout('https://x/api', {}, 1000);
    expect(out.status).toBe(200);
  });

  it('passes an AbortSignal to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await fetchWithTimeout('https://x/api', { method: 'GET' }, 1000);
    const passedInit = fetchMock.mock.calls[0][1];
    expect(passedInit.signal).toBeInstanceOf(AbortSignal);
    expect(passedInit.method).toBe('GET');
  });

  it('normalizes an AbortError into a TimeoutError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(fetchWithTimeout('https://x/api', {}, 50)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('rethrows non-abort errors unchanged', async () => {
    const netErr = new TypeError('network down');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(netErr));
    await expect(fetchWithTimeout('https://x/api', {}, 1000)).rejects.toBe(netErr);
  });
});
