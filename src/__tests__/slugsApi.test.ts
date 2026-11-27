import { describe, it, expect, vi, beforeEach } from 'vitest';
// @ts-expect-error — .mjs dev script, no type declarations needed for this test.
import { createDbEngine } from '../../local-db-engine.mjs';

type Engine = {
  get: (parts: string[]) => unknown;
  set: (parts: string[], value: unknown) => void;
};

// As in src/api/__tests__/swarmApi.test.ts: the local dev backend's engine
// holds the values, so these run against what is stored and not a script.
const db = vi.hoisted(() => ({ engine: null as unknown as Engine, now: 0 }));

vi.mock('../api/dbProxy', () => ({
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
  getChunks,
  getRoom,
  joinRoom,
  putChunk,
  putSeat,
  recordResult,
  setComputer,
  setReady,
  setSettings,
  startMatch,
  vacateSeat,
} from '../api/slugsApi';
import type { SlugsMatch } from '../api/slugsApi';

beforeEach(() => {
  db.now = 50_000;
  db.engine = createDbEngine({}, () => db.now) as Engine;
});

const matchOf = async (code: string) => (await getRoom(code))!.m;

async function seated(): Promise<string> {
  const code = await createRoom('s-ann', 'Ann');
  await joinRoom(code, 's-bob', 'Bob');
  return code;
}

async function playing(): Promise<string> {
  const code = await seated();
  await setReady(code, 's-bob', true);
  await startMatch(code, 's-ann', 1);
  return code;
}

describe('slugs rooms', () => {
  it('seats the creator in a and the next person in b, and no third person', async () => {
    const code = await createRoom('s-ann', 'Ann');
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    expect(await joinRoom(code, 's-bob', 'Bob')).toBe('b');
    expect(await joinRoom(code, 's-bob', 'Bob')).toBe('b');
    await expect(joinRoom(code, 's-cat', 'Cat')).rejects.toThrow('full');
    await expect(joinRoom('nope/../x', 's-cat', 'Cat')).rejects.toThrow('Room not found');
    await expect(joinRoom('ZZZZ', 's-cat', 'Cat')).rejects.toThrow('Room not found');
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m.players.a!.name).toBe('Ann');
    expect(m.players.b!.name).toBe('Bob');
  });

  it('gives each room its own seed', async () => {
    const one = await matchOf(await createRoom('s-ann', 'Ann'));
    const two = await matchOf(await createRoom('s-ann', 'Ann'));
    expect(one.seed).not.toBe(two.seed);
  });

  it('lets only the host choose settings and computers, and asks the guest to be ready again after a change', async () => {
    const code = await seated();
    await setReady(code, 's-bob', true);
    expect((await matchOf(code)).players.b!.ready).toBe(true);
    await expect(setSettings(code, 's-bob', 'perTeam=2')).rejects.toThrow('Only the host');
    await setSettings(code, 's-ann', 'perTeam=2');
    let m = await matchOf(code);
    expect(m.set).toBe('perTeam=2');
    expect(m.players.b!.ready).toBeUndefined();

    await setReady(code, 's-bob', true);
    await expect(setComputer(code, 's-bob', 'c', true)).rejects.toThrow('Only the host');
    await expect(setComputer(code, 's-ann', 'b', true)).rejects.toThrow('taken');
    await setComputer(code, 's-ann', 'd', true);
    await setComputer(code, 's-ann', 'c', true);
    m = await matchOf(code);
    expect(m.cpu).toBe('cd');
    expect(m.players.b!.ready).toBeUndefined();
    await setComputer(code, 's-ann', 'c', false);
    await setComputer(code, 's-ann', 'd', false);
    expect((await matchOf(code)).cpu).toBeUndefined();
    await setSettings(code, 's-ann', '');
    expect((await matchOf(code)).set).toBeUndefined();
  });
});

describe('slugs starting a game', () => {
  it('starts only from the host, once the guest is ready, with two teams', async () => {
    const alone = await createRoom('s-ann', 'Ann');
    await expect(startMatch(alone, 's-ann', 1)).rejects.toThrow('two teams');
    await setComputer(alone, 's-ann', 'b', true);
    await startMatch(alone, 's-ann', 1);
    expect((await matchOf(alone)).status).toBe('playing');

    const code = await seated();
    await expect(startMatch(code, 's-ann', 1)).rejects.toThrow('ready');
    await setReady(code, 's-bob', true);
    await expect(startMatch(code, 's-bob', 1)).rejects.toThrow('Only the host');
    await startMatch(code, 's-ann', 0xbeef);
    const m = await matchOf(code);
    expect(m.status).toBe('playing');
    expect(m.game).toBe(1);
    expect(m.seed).toBe(0xbeef);
    expect(m.players.b).toEqual({ sessionId: 's-bob', name: 'Bob' });
    await expect(setSettings(code, 's-ann', 'perTeam=2')).rejects.toThrow('being played');
    await expect(joinRoom(code, 's-cat', 'Cat')).rejects.toThrow('in a game');
  });

  it('starts a rematch with a new seed and no result, and lets go of the inputs from two games back', async () => {
    const code = await playing();
    await putChunk(code, 1, 'a', 0, '3K1');
    await recordResult(code, 1, 'a');
    await setReady(code, 's-bob', true);
    await startMatch(code, 's-ann', 0xcafe);
    await putChunk(code, 2, 'a', 0, '5K2');
    let m: SlugsMatch = await matchOf(code);
    expect(m.game).toBe(2);
    expect(m.seed).toBe(0xcafe);
    expect(m.winner).toBeUndefined();
    // Kept through game two, for a client still playing out the end of game one.
    expect(await getChunks(code, 1, 'a')).toEqual({ c0: '3K1' });

    await recordResult(code, 2, 'b');
    await setReady(code, 's-bob', true);
    await startMatch(code, 's-ann', 1);
    m = await matchOf(code);
    expect(m.game).toBe(3);
    expect(await getChunks(code, 1, 'a')).toEqual({});
    expect(await getChunks(code, 2, 'a')).toEqual({ c0: '5K2' });
  });

  it('records the first result for a game and no other', async () => {
    const code = await playing();
    await recordResult(code, 1, 'b');
    await recordResult(code, 1, 'a');
    await recordResult(code, 7, 'a');
    const m = await matchOf(code);
    expect(m.status).toBe('finished');
    expect(m.winner).toBe('b');
  });

  it('reads the seats without the sealed chunks, and the chunks on their own', async () => {
    const code = await playing();
    await putChunk(code, 1, 'b', 0, '9K3');
    await putSeat(code, 'b', { seq: 3, game: 1, k: 40, n: 1, in: '20K0', prev: '9K3' });
    const room = (await getRoom(code))!;
    expect(room.h).toBeUndefined();
    expect(room.s!.b!.in).toBe('20K0');
    expect(room.s!.b!.at).toBe(50_000);
    expect(await getChunks(code, 1, 'b')).toEqual({ c0: '9K3' });
  });
});

describe('slugs leaving', () => {
  it('hands a game of two to the one who stayed', async () => {
    const code = await playing();
    await vacateSeat(code, 'b', 0);
    const m = await matchOf(code);
    expect(m.status).toBe('finished');
    expect(m.winner).toBe('a');
    expect(m.gone).toBe('b');
  });

  it('hands a leaver of a game of three to the computer from its promise, or the room\'s where that is later', async () => {
    const code = await seated();
    await setComputer(code, 's-ann', 'c', true);
    await setReady(code, 's-bob', true);
    await startMatch(code, 's-ann', 1);
    await putSeat(code, 'b', { seq: 1, game: 1, k: 900, n: 0, in: '' });
    await vacateSeat(code, 'b', 300);
    const m = await matchOf(code);
    expect(m.status).toBe('playing');
    expect(m.out).toEqual({ b: 900 });
    await vacateSeat(code, 'b', 2000);
    expect((await matchOf(code)).out).toEqual({ b: 900 });

    // Nobody left playing: the room goes.
    await vacateSeat(code, 'a', 1200);
    expect(await getRoom(code)).toBeNull();
  });

  it('brings a person who left a game of three back into the next one', async () => {
    const code = await seated();
    await setComputer(code, 's-ann', 'c', true);
    await setReady(code, 's-bob', true);
    await startMatch(code, 's-ann', 1);
    await vacateSeat(code, 'b', 10);
    await recordResult(code, 1, 'a');
    expect(await joinRoom(code, 's-bob', 'Bob')).toBe('b');
    expect((await matchOf(code)).out).toBeUndefined();
  });

  it('frees a seat between games, and removes the room with its last person', async () => {
    const code = await seated();
    await vacateSeat(code, 'a', 0);
    const m = await matchOf(code);
    expect(m.players.a).toBeUndefined();
    expect(m.players.b!.name).toBe('Bob');
    await vacateSeat(code, 'b', 0);
    expect(await getRoom(code)).toBeNull();
  });
});
