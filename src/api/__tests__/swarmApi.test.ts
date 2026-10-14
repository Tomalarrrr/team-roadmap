import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-expect-error — .mjs dev script, no type declarations needed for this test.
import { createDbEngine } from '../../../local-db-engine.mjs';
import { SILENT_LIVE_MS } from '../../components/swarm/swarmSync';

type Engine = {
  get: (parts: string[]) => unknown;
  set: (parts: string[], value: unknown) => void;
};

// The database is the local dev backend's engine, so these run against stored
// values (and its server timestamps) and not against a script of responses.
const db = vi.hoisted(() => ({ engine: null as unknown as Engine, now: 0, timeouts: [] as unknown[], reads: [] as string[] }));

vi.mock('../dbProxy', () => ({
  getServerTimestamp: () => ({ '.sv': 'timestamp' }),
  proxyGet: async (path: string, timeoutMs?: number) => {
    db.timeouts.push(timeoutMs);
    db.reads.push(path);
    return structuredClone(db.engine.get(path.split('/')));
  },
  proxyPut: async (path: string, value: object, timeoutMs?: number) => {
    db.timeouts.push(timeoutMs);
    db.engine.set(path.split('/'), value);
  },
  proxyRemove: async (path: string) => db.engine.set(path.split('/'), null),
  proxyTransaction: async (path: string, updater: (current: unknown) => object | null | undefined) => {
    db.reads.push(path);
    const current = structuredClone(db.engine.get(path.split('/')));
    const next = updater(current);
    if (next === undefined || next === null) return { committed: false, snapshot: current };
    db.engine.set(path.split('/'), structuredClone(next));
    return { committed: true, snapshot: next };
  },
}));

import { applyRoomEvent, createRoom, getRoom, joinRoom, putSeat, recordResult, startMatch, vacateSeat } from '../swarmApi';
import { COUNTDOWN_MS, type SwarmMatch } from '../../swarmGameLogic';

beforeEach(() => {
  db.now = 50_000;
  db.engine = createDbEngine({}, () => db.now) as Engine;
  db.timeouts = [];
  db.reads = [];
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

describe('a code that could not be a room', () => {
  // The code goes into the path of the request, and it is typed by a person or read from a link.
  it.each(['', 'AB', 'ABCDE', 'AB/D', 'A.CD', '../x', 'AB D'])('%j is refused without asking the database', async (code) => {
    await expect(joinRoom(code, 's-cat', 'Cat')).rejects.toThrow('Room not found');
    expect(db.reads).toEqual([]);
  });

  it('a code of the right shape is looked up', async () => {
    await expect(joinRoom('ZZ99', 's-cat', 'Cat')).rejects.toThrow('Room not found');
    expect(db.reads).toEqual(['swarm/ZZ99/m']);
  });
});

describe('clearing out old rooms', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const aged = (code: string, ageMs: number) => {
    const m = db.engine.get(['swarm', code, 'm']) as SwarmMatch;
    db.engine.set(['swarm', code, 'm'], { ...m, createdAt: Date.now() - ageMs });
  };

  it('happens when a room is made, and spares a room somebody is still in however old it is', async () => {
    const old = await createRoom('s-ann', 'Ann');
    const kept = await seated();
    aged(old, DAY + 60_000);
    aged(kept, DAY + 60_000);
    db.now = Date.now() - 2000;
    await putSeat(kept, 'b', { seq: 1, game: 0, k: 0, orders: '' });
    db.now = Date.now() - DAY - 1000;
    await putSeat(old, 'a', { seq: 1, game: 0, k: 0, orders: '' });

    const made = await createRoom('s-cat', 'Cat');
    await vi.waitFor(() => expect(db.engine.get(['swarm', old])).toBeNull());
    expect((await matchOf(kept)).players.b?.sessionId).toBe('s-bob');
    expect((await matchOf(made)).players.a?.sessionId).toBe('s-cat');
  });
});

describe('starting and finishing', () => {
  it('will not start with one seat empty', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await startMatch(code, 60_000, null, false);
    expect((await matchOf(code)).status).toBe('waiting');
  });

  it('starts game 1 a countdown after the server time given', async () => {
    const code = await seated();
    await startMatch(code, 60_000.4, null, false);
    const m = await matchOf(code);
    expect(m).toMatchObject({ status: 'playing', game: 1, startAt: 60_000 + COUNTDOWN_MS });
    expect(m.winner).toBeUndefined();
  });

  it('carries the map chosen, and drops it when the next game is left to the seed', async () => {
    const code = await seated();
    await startMatch(code, 60_000, 'thorns', false);
    expect((await matchOf(code)).map).toBe('thorns');
    await recordResult(code, 1, 'a');
    await startMatch(code, 120_000, null, false);
    expect(await matchOf(code)).not.toHaveProperty('map');
  });

  it('carries the third side for the game it was asked for, and lets the computer win it', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, true);
    expect((await matchOf(code)).third).toBe(true);
    await recordResult(code, 1, 'c');
    expect(await matchOf(code)).toMatchObject({ status: 'finished', winner: 'c' });
    await startMatch(code, 120_000, null, false);
    expect(await matchOf(code)).not.toHaveProperty('third');
  });

  it('does not restart a game that is being played', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, false);
    const first = await matchOf(code);
    await startMatch(code, 90_000, null, false);
    expect(await matchOf(code)).toEqual(first);
  });

  it('records a result once, and only for the game it belongs to', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, false);
    await recordResult(code, 2, 'b');
    expect((await matchOf(code)).status).toBe('playing');
    await recordResult(code, 1, 'a');
    await recordResult(code, 1, 'b');
    expect(await matchOf(code)).toMatchObject({ status: 'finished', winner: 'a' });
  });

  it('a rematch is a new game with a new seed and no winner carried over', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, false);
    const first = await matchOf(code);
    await recordResult(code, 1, 'draw');
    await startMatch(code, 120_000, null, false);
    const second = await matchOf(code);
    expect(second).toMatchObject({ status: 'playing', game: 2, startAt: 120_000 + COUNTDOWN_MS });
    expect(second.winner).toBeUndefined();
    expect(second.seed).not.toBe(first.seed);
  });
});

describe('a seat', () => {
  // Short enough to be sent again many times inside the silence a seat is
  // given up after, and not so short that an ordinary slow request is dropped.
  it('is read and written on a timeout far inside the silence that forfeits it', async () => {
    const code = await seated();
    db.timeouts = [];
    await putSeat(code, 'a', { seq: 1, game: 1, k: 0, orders: '' });
    await getRoom(code);
    expect(db.timeouts).toEqual([6000, 6000]);
    expect(6000 * 10).toBeLessThanOrEqual(SILENT_LIVE_MS);
  });

  it('is stamped with the server time when written', async () => {
    const code = await seated();
    db.now = 71_234;
    await putSeat(code, 'b', { seq: 9, game: 1, k: 12, orders: '4:h03' });
    expect((await getRoom(code))?.s).toEqual({ b: { seq: 9, game: 1, k: 12, orders: '4:h03', at: 71_234 } });
  });

  it('is written with the write it replaces, for the rules to hold it to', async () => {
    const code = await seated();
    await putSeat(code, 'b', { seq: 9, game: 1, k: 12, orders: '4:h03', base: 8 });
    expect((await getRoom(code))?.s?.b).toMatchObject({ seq: 9, base: 8 });
  });

  it('left during a game gives it to the other player', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, false);
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
    await startMatch(code, 60_000, null, false);
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

// The events are the shapes Firebase's REST stream sends: the room as it stands
// first, then each write at the path it was made to.
describe('the room followed from its stream', () => {
  const start = { m: { status: 'waiting', game: 0 }, s: { a: { seq: 1, k: 0 } } };

  it('starts from the room as it stands', () => {
    expect(applyRoomEvent(null, 'put', '/', start)).toEqual(start);
  });

  it('takes a seat write at its own path and leaves the rest as it was', () => {
    const before = structuredClone(start);
    const next = applyRoomEvent(start, 'put', '/s/b', { seq: 7, k: 3 });
    expect(next).toEqual({ ...start, s: { a: { seq: 1, k: 0 }, b: { seq: 7, k: 3 } } });
    expect(start).toEqual(before);
  });

  it('replaces a seat outright, dropping fields the new write does not have', () => {
    const next = applyRoomEvent(start, 'put', '/s/a', { seq: 2 });
    expect(next).toEqual({ ...start, s: { a: { seq: 2 } } });
  });

  it('merges a patch field by field, and removes what it sets to null', () => {
    const playing = applyRoomEvent(start, 'put', '/m/winner', 'a');
    const next = applyRoomEvent(playing, 'patch', '/m', { status: 'playing', winner: null, game: 1 });
    expect(next).toEqual({ m: { status: 'playing', game: 1 }, s: start.s });
  });

  it('follows a patch whose keys are paths further down', () => {
    const next = applyRoomEvent(start, 'patch', '/', { 's/a/k': 9, 'm/game': 2 });
    expect(next).toEqual({ m: { status: 'waiting', game: 2 }, s: { a: { seq: 1, k: 9 } } });
  });

  it('drops a node left with no children, as the database does', () => {
    expect(applyRoomEvent(start, 'put', '/s/a', null)).toEqual({ m: start.m });
  });

  it('is null once the room is removed', () => {
    expect(applyRoomEvent(start, 'put', '/', null)).toBeNull();
  });

  it('refuses a patch that is not an object', () => {
    expect(() => applyRoomEvent(start, 'patch', '/m', 3)).toThrow('patch at /m is not an object');
  });
});
