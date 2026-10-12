import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-expect-error — .mjs dev script, no type declarations needed for this test.
import { createDbEngine } from '../../../local-db-engine.mjs';

type Engine = {
  get: (parts: string[]) => unknown;
  set: (parts: string[], value: unknown) => void;
};

// The database is the local dev backend's engine, so these run against stored
// values (and its server timestamps) and not against a script of responses.
const db = vi.hoisted(() => ({ engine: null as unknown as Engine, now: 0 }));

vi.mock('../dbProxy', () => ({
  getServerTimestamp: () => ({ '.sv': 'timestamp' }),
  proxyGet: async (path: string) => structuredClone(db.engine.get(path.split('/'))),
  proxyPut: async (path: string, value: object) => db.engine.set(path.split('/'), value),
  proxyRemove: async (path: string) => db.engine.set(path.split('/'), null),
  proxyTransaction: async (path: string, updater: (current: unknown) => object | null | undefined) => {
    const current = structuredClone(db.engine.get(path.split('/')));
    const next = updater(current);
    if (next === undefined || next === null) return { committed: false, snapshot: current };
    db.engine.set(path.split('/'), structuredClone(next));
    return { committed: true, snapshot: next };
  },
}));

import { createRoom, getRoom, joinRoom, putSeat, recordResult, startMatch, vacateSeat } from '../swarmApi';
import { COUNTDOWN_MS, type SwarmMatch } from '../../swarmGameLogic';

beforeEach(() => {
  db.now = 50_000;
  db.engine = createDbEngine({}, () => db.now) as Engine;
});

const matchOf = async (code: string) => (await getRoom(code))?.m as SwarmMatch;

async function seated(): Promise<string> {
  const code = await createRoom('s-ann', 'Ann');
  await joinRoom(code, 's-bob', 'Bob');
  return code;
}

describe('rooms', () => {
  it('seats the creator in a, waiting', async () => {
    const code = await createRoom('s-ann', 'Ann');
    expect(code).toMatch(/^[A-Z2-9]{4}$/);
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m.game).toBe(0);
    expect(m.players).toEqual({ a: { sessionId: 's-ann', name: 'Ann' } });
  });

  it('seats the second player in b, and gives a returning session its own seat back', async () => {
    const code = await createRoom('s-ann', 'Ann');
    expect(await joinRoom(code, 's-bob', 'Bob')).toBe('b');
    expect(await joinRoom(code, 's-ann', 'Ann')).toBe('a');
    expect((await matchOf(code)).players).toEqual({
      a: { sessionId: 's-ann', name: 'Ann' },
      b: { sessionId: 's-bob', name: 'Bob' },
    });
  });

  it('refuses a third player and a code that is not a room', async () => {
    const code = await seated();
    await expect(joinRoom(code, 's-cat', 'Cat')).rejects.toThrow('That room is full');
    await expect(joinRoom('ZZZZ', 's-cat', 'Cat')).rejects.toThrow('Room not found');
    expect((await matchOf(code)).players.b?.sessionId).toBe('s-bob');
  });
});

describe('starting and finishing', () => {
  it('will not start with one seat empty', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await startMatch(code, 60_000);
    expect((await matchOf(code)).status).toBe('waiting');
  });

  it('starts game 1 a countdown after the server time given', async () => {
    const code = await seated();
    await startMatch(code, 60_000.4);
    const m = await matchOf(code);
    expect(m).toMatchObject({ status: 'playing', game: 1, startAt: 60_000 + COUNTDOWN_MS });
    expect(m.winner).toBeUndefined();
  });

  it('does not restart a game that is being played', async () => {
    const code = await seated();
    await startMatch(code, 60_000);
    const first = await matchOf(code);
    await startMatch(code, 90_000);
    expect(await matchOf(code)).toEqual(first);
  });

  it('records a result once, and only for the game it belongs to', async () => {
    const code = await seated();
    await startMatch(code, 60_000);
    await recordResult(code, 2, 'b');
    expect((await matchOf(code)).status).toBe('playing');
    await recordResult(code, 1, 'a');
    await recordResult(code, 1, 'b');
    expect(await matchOf(code)).toMatchObject({ status: 'finished', winner: 'a' });
  });

  it('a rematch is a new game with a new seed and no winner carried over', async () => {
    const code = await seated();
    await startMatch(code, 60_000);
    const first = await matchOf(code);
    await recordResult(code, 1, 'draw');
    await startMatch(code, 120_000);
    const second = await matchOf(code);
    expect(second).toMatchObject({ status: 'playing', game: 2, startAt: 120_000 + COUNTDOWN_MS });
    expect(second.winner).toBeUndefined();
    expect(second.seed).not.toBe(first.seed);
  });
});

describe('a seat', () => {
  it('is stamped with the server time when written', async () => {
    const code = await seated();
    db.now = 71_234;
    await putSeat(code, 'b', { seq: 9, game: 1, k: 12, orders: '4:h03' });
    expect((await getRoom(code))?.s).toEqual({ b: { seq: 9, game: 1, k: 12, orders: '4:h03', at: 71_234 } });
  });

  it('left during a game gives it to the other player', async () => {
    const code = await seated();
    await startMatch(code, 60_000);
    await vacateSeat(code, 'a');
    expect(await matchOf(code)).toMatchObject({ status: 'finished', winner: 'b', gone: 'a' });
  });

  it('left before a game is free again, and the room waits', async () => {
    const code = await seated();
    await vacateSeat(code, 'b');
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m.players).toEqual({ a: { sessionId: 's-ann', name: 'Ann' } });
    expect(await joinRoom(code, 's-cat', 'Cat')).toBe('b');
  });

  it('left after a game clears the result with it', async () => {
    const code = await seated();
    await startMatch(code, 60_000);
    await recordResult(code, 1, 'a');
    await vacateSeat(code, 'b');
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m.winner).toBeUndefined();
  });

  it('left by the last player closes the room', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await vacateSeat(code, 'a');
    expect(await getRoom(code)).toBeNull();
  });
});
