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

import {
  createRoom,
  createServerClock,
  getRoom,
  joinRoom,
  putSeat,
  recordRound,
  startMatch,
  vacateSeat,
} from '../snakeApi';
import type { SnakeMatch } from '../../snakeGameLogic';

beforeEach(() => {
  db.now = 50_000;
  db.engine = createDbEngine({}, () => db.now) as Engine;
});

const matchOf = async (code: string) => (await getRoom(code))?.m as SnakeMatch;

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
    expect(m.players).toEqual({ a: { sessionId: 's-ann', name: 'Ann' } });
  });

  it('seats a second player in b and hands a returning one their own seat', async () => {
    const code = await createRoom('s-ann', 'Ann');
    expect(await joinRoom(code, 's-bob', 'Bob')).toBe('b');
    expect(await joinRoom(code, 's-ann', 'Ann')).toBe('a');
    expect(await joinRoom(code, 's-bob', 'Bob')).toBe('b');
  });

  it('turns a third player away, and a wrong code', async () => {
    const code = await seated();
    await expect(joinRoom(code, 's-cat', 'Cat')).rejects.toThrow('That room is full');
    await expect(joinRoom('NOPE', 's-cat', 'Cat')).rejects.toThrow('Room not found');
    expect((await matchOf(code)).players.b?.name).toBe('Bob');
  });

  it('clears out rooms a day old when a new one is made', async () => {
    const old = await createRoom('s-ann', 'Ann');
    const m = await matchOf(old);
    db.engine.set(['snake', old, 'm'], { ...m, createdAt: Date.now() - 25 * 60 * 60 * 1000 });
    const fresh = await createRoom('s-bob', 'Bob');
    await vi.waitFor(() => expect(db.engine.get(['snake', old])).toBeNull());
    expect(await matchOf(fresh)).toMatchObject({ status: 'waiting' });
  });
});

describe('a match', () => {
  it('will not start with one player', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await startMatch(code, 10_000);
    expect((await matchOf(code)).status).toBe('waiting');
  });

  it('starts round 1 three seconds out, on the server clock it was given', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    expect(await matchOf(code)).toMatchObject({ status: 'playing', round: 1, startAt: 13_000, scoreA: 0, scoreB: 0 });
  });

  it('scores a round and sets up the next after a pause', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    await recordRound(code, 1, { winner: 'b', why: 'crash' }, 20_000);
    expect(await matchOf(code)).toMatchObject({
      status: 'playing', round: 2, startAt: 24_500, scoreA: 0, scoreB: 1, lastWinner: 'b', lastWhy: 'crash',
    });
  });

  it('counts a round once, however many clients report it', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    await recordRound(code, 1, { winner: 'a', why: 'crash' }, 20_000);
    await recordRound(code, 1, { winner: 'a', why: 'crash' }, 20_300);
    expect(await matchOf(code)).toMatchObject({ round: 2, scoreA: 1, startAt: 24_500 });
  });

  it('replays a drawn round without scoring it', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    await recordRound(code, 1, { winner: 'draw', why: 'clock' }, 20_000);
    expect(await matchOf(code)).toMatchObject({ status: 'playing', round: 2, scoreA: 0, scoreB: 0, lastWinner: 'draw' });
  });

  it('is won on the third round taken, and not before', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    await recordRound(code, 1, { winner: 'a', why: 'crash' }, 20_000);
    await recordRound(code, 2, { winner: 'b', why: 'crash' }, 30_000);
    await recordRound(code, 3, { winner: 'a', why: 'clock' }, 40_000);
    expect((await matchOf(code)).status).toBe('playing');
    await recordRound(code, 4, { winner: 'a', why: 'crash' }, 50_000);
    const m = await matchOf(code);
    expect(m).toMatchObject({ status: 'finished', winner: 'a', scoreA: 3, scoreB: 1, round: 4 });
    await recordRound(code, 4, { winner: 'b', why: 'crash' }, 51_000);
    expect((await matchOf(code)).scoreB).toBe(1);
  });

  it('rematches on a round number no old seat state can carry', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    for (const round of [1, 2, 3]) await recordRound(code, round, { winner: 'b', why: 'crash' }, 20_000);
    const first = await matchOf(code);
    await startMatch(code, 60_000);
    const m = await matchOf(code);
    expect(m).toMatchObject({ status: 'playing', round: 4, startAt: 63_000, scoreA: 0, scoreB: 0 });
    expect(m.winner).toBeUndefined();
    expect(m.lastWinner).toBeUndefined();
    expect(m.seed).not.toBe(first.seed);
  });
});

describe('the tally of matches', () => {
  const win = async (code: string, winner: 'a' | 'b') => {
    await startMatch(code, 10_000);
    const from = (await matchOf(code)).round;
    for (const round of [from, from + 1, from + 2]) await recordRound(code, round, { winner, why: 'crash' }, 20_000);
  };

  it('counts a match when it is won, not round by round', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    await recordRound(code, 1, { winner: 'a', why: 'crash' }, 20_000);
    await recordRound(code, 2, { winner: 'a', why: 'crash' }, 20_000);
    expect((await matchOf(code)).winsA).toBeUndefined();
    await recordRound(code, 3, { winner: 'a', why: 'crash' }, 20_000);
    expect(await matchOf(code)).toMatchObject({ status: 'finished', winsA: 1, winsB: 0 });
  });

  it('carries through rematches', async () => {
    const code = await seated();
    await win(code, 'a');
    await win(code, 'b');
    await win(code, 'b');
    expect(await matchOf(code)).toMatchObject({ winner: 'b', winsA: 1, winsB: 2 });
    await startMatch(code, 90_000);
    expect(await matchOf(code)).toMatchObject({ status: 'playing', scoreB: 0, winsA: 1, winsB: 2 });
  });

  it('counts a forfeit for the player who stayed', async () => {
    const code = await seated();
    await win(code, 'b');
    await startMatch(code, 60_000);
    await vacateSeat(code, 'b');
    expect(await matchOf(code)).toMatchObject({ winner: 'a', gone: 'b', winsA: 1, winsB: 1 });
  });

  it('starts again when one of the two leaves the room', async () => {
    const code = await seated();
    await win(code, 'a');
    await vacateSeat(code, 'b');
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m.winsA).toBeUndefined();
    expect(m.winsB).toBeUndefined();
  });

  it('counts from none in a room made before there was a tally', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    const m = await matchOf(code);
    expect('winsA' in m).toBe(false);
    for (const round of [1, 2, 3]) await recordRound(code, round, { winner: 'b', why: 'crash' }, 20_000);
    expect(await matchOf(code)).toMatchObject({ winsA: 0, winsB: 1 });
  });
});

describe('leaving', () => {
  it('frees the seat before a match and keeps the other player where they sit', async () => {
    const code = await seated();
    await vacateSeat(code, 'a');
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m.players).toEqual({ b: { sessionId: 's-bob', name: 'Bob' } });
    expect(await joinRoom(code, 's-cat', 'Cat')).toBe('a');
  });

  it('gives the match to the player who stayed', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    await vacateSeat(code, 'b');
    expect(await matchOf(code)).toMatchObject({ status: 'finished', winner: 'a', gone: 'b' });
  });

  it('returns a finished room to waiting when one player goes', async () => {
    const code = await seated();
    await startMatch(code, 10_000);
    await vacateSeat(code, 'b');
    await vacateSeat(code, 'b');
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m.winner).toBeUndefined();
    expect(m.gone).toBeUndefined();
    expect(m.players).toEqual({ a: { sessionId: 's-ann', name: 'Ann' } });
  });

  it('removes the room with its last player', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await vacateSeat(code, 'a');
    expect(await getRoom(code)).toBeNull();
  });

  it('does nothing for a seat nobody holds', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await vacateSeat(code, 'b');
    expect((await matchOf(code)).players.a?.name).toBe('Ann');
  });
});

describe('seat states', () => {
  it('are stamped by the server, beside the match and not in it', async () => {
    const code = await seated();
    db.now = 77_000;
    await putSeat(code, 'b', { seq: 5, round: 1, k: 3, path: '0a0b', len: 4, dir: 3, adj: 2, ate: '0,0,0' });
    const room = await getRoom(code);
    expect(room?.s?.b).toMatchObject({ seq: 5, at: 77_000, k: 3 });
    expect(room?.s?.a).toBeUndefined();
    expect(room?.m.players.b?.name).toBe('Bob');
  });
});

describe('server clock', () => {
  it('knows nothing until one of its own writes has come back stamped', () => {
    let local = 100;
    const clock = createServerClock(() => local);
    expect(clock.now()).toBeNull();
    clock.sent(1);
    // Seen in a read before the write was acknowledged: the window is still open.
    clock.seen(1, 9_000);
    expect(clock.now()).toBeNull();
    clock.seen(2, 9_000);
    expect(clock.now()).toBeNull();
    local = 180;
    clock.acked(1);
    clock.seen(1, 9_000);
    // Stamp 9000 set against the midpoint of [100, 180].
    local = 500;
    expect(clock.now()).toBe(500 + (9_000 - 140));
  });

  it('keeps the sample with the shortest round trip', () => {
    let local = 0;
    const clock = createServerClock(() => local);
    const sample = (seq: number, sent: number, acked: number, at: number) => {
      local = sent;
      clock.sent(seq);
      local = acked;
      clock.acked(seq);
      clock.seen(seq, at);
    };
    sample(1, 0, 400, 5_300);
    sample(2, 1_000, 1_040, 6_020);
    sample(3, 2_000, 2_300, 7_000);
    local = 3_000;
    // Offsets were 5100, 5000 and 4850; the 40ms round trip gave 5000.
    expect(clock.now()).toBe(8_000);
  });

  it('forgets a write that failed', () => {
    let local = 0;
    const clock = createServerClock(() => local);
    clock.sent(1);
    clock.failed(1);
    local = 50;
    clock.acked(1);
    clock.seen(1, 4_000);
    expect(clock.now()).toBeNull();
  });
});
