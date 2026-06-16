import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWriteCoalescer } from '../writeCoalescer';

describe('createWriteCoalescer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses a burst of writes to the same key into one trailing write', async () => {
    const writes: number[] = [];
    const c = createWriteCoalescer(100);

    c.schedule('k', async () => { writes.push(1); });
    c.schedule('k', async () => { writes.push(2); });
    c.schedule('k', async () => { writes.push(3); });

    expect(writes).toEqual([]);        // nothing fires before the delay
    expect(c.pending).toBe(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(writes).toEqual([3]);       // only the latest write runs
    expect(c.pending).toBe(0);
  });

  it('fires onBurstStart once and onBurstEnd once per key burst', async () => {
    const onBurstStart = vi.fn();
    const onBurstEnd = vi.fn();
    const c = createWriteCoalescer(100, { onBurstStart, onBurstEnd });

    c.schedule('k', async () => {});
    c.schedule('k', async () => {});
    expect(onBurstStart).toHaveBeenCalledTimes(1);
    expect(onBurstEnd).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);
    expect(onBurstEnd).toHaveBeenCalledTimes(1);
  });

  it('still settles the burst (onBurstEnd) when the write rejects', async () => {
    const onBurstEnd = vi.fn();
    const c = createWriteCoalescer(100, { onBurstEnd });

    c.schedule('k', async () => { throw new Error('boom'); });
    await vi.advanceTimersByTimeAsync(100);

    expect(onBurstEnd).toHaveBeenCalledTimes(1);
    expect(c.pending).toBe(0);
  });

  it('tracks independent keys separately', async () => {
    const writes: string[] = [];
    const c = createWriteCoalescer(100);

    c.schedule('a', async () => { writes.push('a'); });
    c.schedule('b', async () => { writes.push('b'); });
    expect(c.pending).toBe(2);

    await vi.advanceTimersByTimeAsync(100);
    expect(writes.sort()).toEqual(['a', 'b']);
  });

  it('flushAll fires pending writes immediately', async () => {
    const writes: string[] = [];
    const c = createWriteCoalescer(10_000);

    c.schedule('a', async () => { writes.push('a'); });
    c.flushAll();
    await vi.advanceTimersByTimeAsync(0);

    expect(writes).toEqual(['a']);
    expect(c.pending).toBe(0);
  });

  it('cancelAll drops pending writes but balances onBurstEnd', async () => {
    const writes: string[] = [];
    const onBurstStart = vi.fn();
    const onBurstEnd = vi.fn();
    const c = createWriteCoalescer(100, { onBurstStart, onBurstEnd });

    c.schedule('a', async () => { writes.push('a'); });
    c.schedule('b', async () => { writes.push('b'); });
    c.cancelAll();

    await vi.advanceTimersByTimeAsync(200);
    expect(writes).toEqual([]);                       // nothing fired
    expect(onBurstStart).toHaveBeenCalledTimes(2);
    expect(onBurstEnd).toHaveBeenCalledTimes(2);      // balanced
    expect(c.pending).toBe(0);
  });
});
