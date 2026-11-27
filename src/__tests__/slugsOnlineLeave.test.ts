import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlugsMatch, SlugsRoom } from '../api/slugsApi';

// Leaving a game of three hands the seat to the computer from the tick the room
// holds this seat's inputs to. Leaving from a tick only this client had reached,
// past a write the room refused, left the other two waiting on inputs that never came.

vi.mock('../api/slugsApi', async (actual) => ({
  ...(await actual<typeof import('../api/slugsApi')>()),
  followRoom: vi.fn(() => () => {}),
  getRoom: vi.fn(),
  getChunks: vi.fn(async () => ({})),
  putChunk: vi.fn(async () => {}),
  putSeat: vi.fn(async () => {
    throw new Error('refused');
  }),
  recordResult: vi.fn(async () => {}),
  vacateSeat: vi.fn(async () => {}),
}));

const api = await import('../api/slugsApi');
const { onlineDriver } = await import('../components/slugs/onlineDriver');
const { stamped } = await import('../components/slugs/slugsSync');

const match: SlugsMatch = {
  status: 'playing',
  createdAt: 0,
  seed: 12345,
  game: 1,
  set: stamped(''),
  players: {
    a: { sessionId: 'session-a', name: 'Ann' },
    b: { sessionId: 'session-b', name: 'Bob' },
    c: { sessionId: 'session-c', name: 'Cat' },
  },
};

const seatAt = (k: number) => ({ seq: 1, at: 0, game: 1, k, n: 0, in: '' });

/** The room as last read: Ann's own write stopped at tick 40, the others well ahead. */
const room: SlugsRoom = { m: match, s: { a: seatAt(40), b: seatAt(600), c: seatAt(600) } };

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.mocked(api.getRoom).mockResolvedValue(room);
  vi.mocked(api.vacateSeat).mockClear();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => warn.mockRestore());

describe('leaving an online game of three', () => {
  it('gives up the seat from the tick the room holds, not from one only this client reached', async () => {
    const driver = onlineDriver('QX7Z', 'session-a', match);
    let now = 1000;
    driver.tick(now, { keys: 0 });
    // The first read of the room lands.
    await vi.waitFor(() => expect(api.getRoom).toHaveBeenCalled());
    await Promise.resolve();
    for (let i = 0; i < 60; i++) {
      now += 50;
      driver.tick(now, { keys: 0 });
      await Promise.resolve();
    }
    const reached = driver.tick(now, { keys: 0 }).tick;
    expect(reached).toBeGreaterThan(40);
    expect(warn).toHaveBeenCalledWith('[Slugs] Report failed:', expect.any(Error));

    await driver.leave();
    expect(api.vacateSeat).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.vacateSeat).mock.calls[0]).toEqual(['QX7Z', 'a', 40]);
  });

  it('gives up the seat from tick 0 when the room has nothing of this game from it', async () => {
    vi.mocked(api.getRoom).mockResolvedValue({ m: match, s: { a: { ...seatAt(40), game: 0 }, b: seatAt(600), c: seatAt(600) } });
    const driver = onlineDriver('QX7Z', 'session-a', match);
    driver.tick(1000, { keys: 0 });
    await vi.waitFor(() => expect(api.getRoom).toHaveBeenCalled());
    await Promise.resolve();
    driver.tick(1500, { keys: 0 });
    await driver.leave();
    expect(vi.mocked(api.vacateSeat).mock.calls[0]).toEqual(['QX7Z', 'a', 0]);
  });
});
