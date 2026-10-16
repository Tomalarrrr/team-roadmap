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

import { applyRoomEvent, createRoom, getRoom, hostOf, joinRoom, putSeat, recordResult, setComputer, setKind, setNest, setRules, startMatch, vacateSeat } from '../swarmApi';
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

  it('seats up to four, in seat order, and refuses a fifth and a code that is not a room', async () => {
    const code = await seated();
    expect(await joinRoom(code, 's-cat', 'Cat')).toBe('c');
    expect(await joinRoom(code, 's-dan', 'Dan')).toBe('d');
    await expect(joinRoom(code, 's-eve', 'Eve')).rejects.toThrow('That room is full');
    await expect(joinRoom('ZZZZ', 's-eve', 'Eve')).rejects.toThrow('Room not found');
    expect(Object.keys((await matchOf(code)).players)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not seat a player where the computer plays', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await setComputer(code, 'b', true);
    expect(await joinRoom(code, 's-bob', 'Bob')).toBe('c');
    await setComputer(code, 'd', true);
    await expect(joinRoom(code, 's-cat', 'Cat')).rejects.toThrow('That room is full');
  });

  it('refuses a new player during a game, and takes one into a finished room for the next', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, null);
    await expect(joinRoom(code, 's-cat', 'Cat')).rejects.toThrow('That room is in a game. Join when it ends.');
    expect(await joinRoom(code, 's-bob', 'Bob')).toBe('b');
    await recordResult(code, 1, 'a');
    expect(await joinRoom(code, 's-cat', 'Cat')).toBe('c');
    await startMatch(code, 120_000, null, null);
    expect(Object.keys((await matchOf(code)).players)).toEqual(['a', 'b', 'c']);
  });
});

describe('the computer in a seat', () => {
  it('is added and taken out between games, its letters kept in seat order', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await setComputer(code, 'd', true);
    await setComputer(code, 'b', true);
    expect((await matchOf(code)).cpu).toBe('bd');
    await setComputer(code, 'd', false);
    expect((await matchOf(code)).cpu).toBe('b');
    await setComputer(code, 'b', false);
    expect(await matchOf(code)).not.toHaveProperty('cpu');
  });

  it('is refused a seat a person sits in, and any change during a game', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await setComputer(code, 'a', true);
    expect(await matchOf(code)).not.toHaveProperty('cpu');
    await setComputer(code, 'b', true);
    await startMatch(code, 60_000, null, null);
    await setComputer(code, 'c', true);
    await setComputer(code, 'b', false);
    expect((await matchOf(code)).cpu).toBe('b');
  });

  it('makes a side, so one person and the computer can start, and it stays for the rematch', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await setComputer(code, 'c', true);
    await startMatch(code, 60_000, null, null);
    expect(await matchOf(code)).toMatchObject({ status: 'playing', game: 1, cpu: 'c' });
    await recordResult(code, 1, 'c');
    await startMatch(code, 120_000, null, null);
    expect(await matchOf(code)).toMatchObject({ status: 'playing', game: 2, cpu: 'c' });
  });
});

describe('choosing a creature', () => {
  it('sets the chosen one on the player, and can be changed', async () => {
    const code = await seated();
    await setKind(code, 's-bob', 'spider');
    await setKind(code, 's-ann', 'beetle');
    await setKind(code, 's-ann', 'bee');
    const m = await matchOf(code);
    expect(m.players.a?.kind).toBe('bee');
    expect(m.players.b).toEqual({ sessionId: 's-bob', name: 'Bob', kind: 'spider' });
  });

  it('refuses one another player has, and leaves both as they were', async () => {
    const code = await seated();
    await setKind(code, 's-ann', 'beetle');
    await expect(setKind(code, 's-bob', 'beetle')).rejects.toThrow('Another player has chosen that one.');
    const m = await matchOf(code);
    expect(m.players.a?.kind).toBe('beetle');
    expect(m.players.b).not.toHaveProperty('kind');
  });

  it('is refused once a game has started, and after it', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, null);
    await expect(setKind(code, 's-ann', 'spider')).rejects.toThrow('The creatures are chosen before a game starts.');
    await recordResult(code, 1, 'a');
    await expect(setKind(code, 's-ann', 'spider')).rejects.toThrow('The creatures are chosen before a game starts.');
    expect((await matchOf(code)).players.a).not.toHaveProperty('kind');
  });

  it('is refused a session with no seat', async () => {
    const code = await seated();
    await expect(setKind(code, 's-eve', 'spider')).rejects.toThrow('Room not found');
  });
});

describe('choosing a nest', () => {
  it('sets it on the player, keeps it for the rematch, and is refused during a game', async () => {
    const code = await seated();
    await setNest(code, 's-bob', 'many');
    await setNest(code, 's-ann', 'big');
    expect((await matchOf(code)).players).toMatchObject({ a: { nest: 'big' }, b: { nest: 'many' } });
    await setRules(code, 's-ann', { mode: 'classic', start: 'nests', twists: '', tune: '' });
    await startMatch(code, 60_000, null, null);
    await expect(setNest(code, 's-bob', 'big')).rejects.toThrow('The nests are chosen before a game starts.');
    await recordResult(code, 1, 'a');
    await startMatch(code, 120_000, null, null);
    expect(await matchOf(code)).toMatchObject({ game: 2, start: 'nests', players: { b: { nest: 'many' } } });
  });

  it('is refused a session with no seat', async () => {
    const code = await seated();
    await expect(setNest(code, 's-eve', 'many')).rejects.toThrow('Room not found');
  });
});

describe('choosing the rules', () => {
  it('is the first seated person\'s, and passes on when they leave', async () => {
    const code = await seated();
    expect(hostOf(await matchOf(code))).toBe('a');
    await vacateSeat(code, 'a', 0);
    expect(hostOf(await matchOf(code))).toBe('b');
    await setRules(code, 's-bob', { mode: 'hill', start: 'home', twists: '', tune: '' });
    expect((await matchOf(code)).mode).toBe('hill');
  });

  it('stores what is chosen, drops a choice put back to the default, and stores nothing for classic', async () => {
    const code = await seated();
    await setRules(code, 's-ann', { mode: 'regicide', start: 'draft', twists: 'opz', tune: '' });
    expect(await matchOf(code)).toMatchObject({ mode: 'regicide', start: 'draft', twists: 'opz' });
    await setRules(code, 's-ann', { mode: 'regicide', start: 'home', twists: 'o', tune: '' });
    const m = await matchOf(code);
    expect(m).toMatchObject({ mode: 'regicide', twists: 'o' });
    expect(m).not.toHaveProperty('start');
    await setRules(code, 's-ann', { mode: 'classic', start: 'home', twists: '', tune: '' });
    expect(Object.keys(await matchOf(code)).sort()).toEqual(['createdAt', 'game', 'players', 'seed', 'startAt', 'status']);
  });

  it('is refused anyone but the host, and a session with no seat, leaving the rules as they were', async () => {
    const code = await seated();
    await setRules(code, 's-ann', { mode: 'egg', start: 'home', twists: '', tune: '' });
    await expect(setRules(code, 's-bob', { mode: 'blitz', start: 'home', twists: 'f', tune: '' })).rejects.toThrow('The host chooses the rules.');
    await expect(setRules(code, 's-eve', { mode: 'blitz', start: 'home', twists: 'f', tune: '' })).rejects.toThrow('Room not found');
    const m = await matchOf(code);
    expect(m.mode).toBe('egg');
    expect(m).not.toHaveProperty('twists');
  });

  it('is refused once a game has started, and after it', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, null);
    await expect(setRules(code, 's-ann', { mode: 'blitz', start: 'home', twists: '', tune: '' })).rejects.toThrow('The rules are chosen before a game starts.');
    await recordResult(code, 1, 'a');
    await expect(setRules(code, 's-ann', { mode: 'blitz', start: 'home', twists: '', tune: '' })).rejects.toThrow('The rules are chosen before a game starts.');
    expect(await matchOf(code)).not.toHaveProperty('mode');
  });

  it('stores the settings with the rules, keeps them for the next game, and drops them put back to standard', async () => {
    const code = await seated();
    await setRules(code, 's-ann', { mode: 'classic', start: 'home', twists: '', tune: 'len=4;grow=200' });
    await expect(setRules(code, 's-bob', { mode: 'classic', start: 'home', twists: '', tune: 'len=30' })).rejects.toThrow('The host chooses the rules.');
    expect((await matchOf(code)).tune).toBe('len=4;grow=200');
    await startMatch(code, 60_000, null, null);
    expect((await matchOf(code)).tune).toBe('len=4;grow=200');
    await recordResult(code, 1, 'a');
    await startMatch(code, 70_000, null, null);
    expect((await matchOf(code)).tune).toBe('len=4;grow=200');
    await vacateSeat(code, 'b', 0);
    expect((await matchOf(code)).tune).toBe('len=4;grow=200');
  });

  it('drops the settings once the host puts them back to standard', async () => {
    const code = await seated();
    await setRules(code, 's-ann', { mode: 'classic', start: 'home', twists: '', tune: 'cap=50' });
    await setRules(code, 's-ann', { mode: 'classic', start: 'home', twists: '', tune: '' });
    expect(await matchOf(code)).not.toHaveProperty('tune');
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
  it('will not start with one side', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await startMatch(code, 60_000, null, null);
    expect((await matchOf(code)).status).toBe('waiting');
  });

  it('starts game 1 a countdown after the server time given', async () => {
    const code = await seated();
    await startMatch(code, 60_000.4, null, null);
    const m = await matchOf(code);
    expect(m).toMatchObject({ status: 'playing', game: 1, startAt: 60_000 + COUNTDOWN_MS });
    expect(m.winner).toBeUndefined();
  });

  it('carries the map and size chosen, and drops them when the next game is left to the seed', async () => {
    const code = await seated();
    await startMatch(code, 60_000, 'crossroads', 'large');
    expect(await matchOf(code)).toMatchObject({ map: 'crossroads', size: 'large' });
    await recordResult(code, 1, 'a');
    await startMatch(code, 120_000, null, null);
    const m = await matchOf(code);
    expect(m).not.toHaveProperty('map');
    expect(m).not.toHaveProperty('size');
  });

  it('carries the room\'s mode, start and twists into the game and the rematch', async () => {
    const code = await seated();
    await setRules(code, 's-ann', { mode: 'blitz', start: 'nests', twists: 'fq', tune: '' });
    await startMatch(code, 60_000, null, null);
    expect(await matchOf(code)).toMatchObject({ status: 'playing', game: 1, mode: 'blitz', start: 'nests', twists: 'fq' });
    await recordResult(code, 1, 'a');
    await startMatch(code, 120_000, null, null);
    expect(await matchOf(code)).toMatchObject({ status: 'playing', game: 2, mode: 'blitz', start: 'nests', twists: 'fq' });
  });

  it('plays classic in a room where none were chosen, storing none of the three', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, null);
    const m = await matchOf(code);
    expect(m).toMatchObject({ status: 'playing', game: 1 });
    expect(m).not.toHaveProperty('mode');
    expect(m).not.toHaveProperty('start');
    expect(m).not.toHaveProperty('twists');
  });

  it('does not restart a game that is being played', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, null);
    const first = await matchOf(code);
    await startMatch(code, 90_000, null, null);
    expect(await matchOf(code)).toEqual(first);
  });

  it('records a result once, and only for the game it belongs to, keeping the players', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, null);
    await recordResult(code, 2, 'b');
    expect((await matchOf(code)).status).toBe('playing');
    await recordResult(code, 1, 'd');
    await recordResult(code, 1, 'b');
    const m = await matchOf(code);
    expect(m).toMatchObject({ status: 'finished', winner: 'd' });
    expect(Object.keys(m.players)).toEqual(['a', 'b']);
  });

  it('a rematch is a new game with a new seed and nothing of the last result carried over', async () => {
    const code = await seated();
    await joinRoom(code, 's-cat', 'Cat');
    await startMatch(code, 60_000, null, null);
    const first = await matchOf(code);
    await vacateSeat(code, 'c', 0);
    await recordResult(code, 1, 'draw');
    expect(await matchOf(code)).toMatchObject({ winner: 'draw', out: { c: 0 } });
    await startMatch(code, 120_000, null, null);
    const second = await matchOf(code);
    expect(second).toMatchObject({ status: 'playing', game: 2, startAt: 120_000 + COUNTDOWN_MS });
    expect(second).not.toHaveProperty('winner');
    expect(second).not.toHaveProperty('out');
    expect(second.seed).not.toBe(first.seed);
  });

  it('leaves out of the rematch whoever left the last game, unless they came back', async () => {
    const code = await seated();
    await joinRoom(code, 's-cat', 'Cat');
    await joinRoom(code, 's-dan', 'Dan');
    await startMatch(code, 60_000, null, null);
    await vacateSeat(code, 'b', 0);
    await vacateSeat(code, 'd', 0);
    await recordResult(code, 1, 'a');
    expect(await joinRoom(code, 's-dan', 'Dan')).toBe('d');
    expect((await matchOf(code)).out).toEqual({ b: 0 });
    await startMatch(code, 120_000, null, null);
    expect(Object.keys((await matchOf(code)).players)).toEqual(['a', 'c', 'd']);
  });

  it('will not start a rematch when leaving out whoever left would leave one side', async () => {
    const code = await seated();
    await joinRoom(code, 's-cat', 'Cat');
    await startMatch(code, 60_000, null, null);
    await vacateSeat(code, 'b', 0);
    await vacateSeat(code, 'c', 0);
    await recordResult(code, 1, 'a');
    await startMatch(code, 120_000, null, null);
    expect((await matchOf(code)).status).toBe('finished');
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

  it('left during a game of two gives it to the other side', async () => {
    const code = await seated();
    await startMatch(code, 60_000, null, null);
    await vacateSeat(code, 'a', 40);
    const m = await matchOf(code);
    expect(m).toMatchObject({ status: 'finished', winner: 'b', gone: 'a' });
    expect(m).not.toHaveProperty('out');
  });

  it('left during a game against the computer gives it to the computer', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await setComputer(code, 'd', true);
    await startMatch(code, 60_000, null, null);
    await vacateSeat(code, 'a', 0);
    expect(await matchOf(code)).toMatchObject({ status: 'finished', winner: 'd', gone: 'a' });
  });

  describe('left during a game of more than two', () => {
    async function three(): Promise<string> {
      const code = await seated();
      await setComputer(code, 'c', true);
      await joinRoom(code, 's-dan', 'Dan');
      await startMatch(code, 60_000, null, null);
      return code;
    }

    it('is played on by the computer from the tick given, and the game goes on', async () => {
      const code = await three();
      await vacateSeat(code, 'b', 120);
      const m = await matchOf(code);
      expect(m).toMatchObject({ status: 'playing', out: { b: 120 } });
      expect(m).not.toHaveProperty('winner');
      expect(m.players.b?.sessionId).toBe('s-bob');
    });

    it('is played on from the seat\'s own promise when the room has it further on than the caller read', async () => {
      const code = await three();
      await putSeat(code, 'b', { seq: 3, game: 1, k: 300, orders: '' });
      await vacateSeat(code, 'b', 120);
      expect((await matchOf(code)).out).toEqual({ b: 300 });
    });

    it('takes no notice of a promise the seat made in an earlier game', async () => {
      const code = await three();
      await putSeat(code, 'b', { seq: 3, game: 0, k: 900, orders: '' });
      await vacateSeat(code, 'b', 0);
      expect((await matchOf(code)).out).toEqual({ b: 0 });
    });

    it('is marked once: a second report of the same seat changes nothing', async () => {
      const code = await three();
      await vacateSeat(code, 'b', 50);
      await vacateSeat(code, 'b', 80);
      expect((await matchOf(code)).out).toEqual({ b: 50 });
    });

    it('closes the room once no person is left playing', async () => {
      const code = await three();
      await vacateSeat(code, 'b', 10);
      await vacateSeat(code, 'a', 20);
      expect((await matchOf(code)).out).toEqual({ a: 20, b: 10 });
      await vacateSeat(code, 'd', 30);
      expect(await getRoom(code)).toBeNull();
    });

    it('is tried again when the mark is refused, and the error comes through when it keeps being refused', async () => {
      const code = await three();
      const real = db.engine.set;
      let refusals = 1;
      db.engine.set = (parts, value) => {
        if (parts.at(-1) === 'm' && refusals-- > 0) throw new Error('Transaction PUT failed: 401');
        real(parts, value);
      };
      await vacateSeat(code, 'b', 5);
      expect((await matchOf(code)).out).toEqual({ b: 5 });
      refusals = 3;
      await expect(vacateSeat(code, 'd', 5)).rejects.toThrow('401');
      expect((await matchOf(code)).out).toEqual({ b: 5 });
    });
  });

  it('left before a game is free again, and the room waits', async () => {
    const code = await seated();
    await vacateSeat(code, 'b', 0);
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m.players).toEqual({ a: { sessionId: 's-ann', name: 'Ann' } });
    expect(await joinRoom(code, 's-cat', 'Cat')).toBe('b');
  });

  it('left after a game clears the result, keeps the computer, and takes whoever left the game with it', async () => {
    const code = await seated();
    await setComputer(code, 'c', true);
    await joinRoom(code, 's-dan', 'Dan');
    await startMatch(code, 60_000, null, null);
    await vacateSeat(code, 'd', 0);
    await recordResult(code, 1, 'a');
    await vacateSeat(code, 'b', 0);
    const m = await matchOf(code);
    expect(m.status).toBe('waiting');
    expect(m).not.toHaveProperty('winner');
    expect(m).not.toHaveProperty('out');
    expect(m.cpu).toBe('c');
    expect(Object.keys(m.players)).toEqual(['a']);
  });

  it('left after a game keeps a player who left it and came back', async () => {
    const code = await seated();
    expect(await joinRoom(code, 's-dan', 'Dan')).toBe('c');
    await startMatch(code, 60_000, null, null);
    await vacateSeat(code, 'c', 0);
    await recordResult(code, 1, 'a');
    await joinRoom(code, 's-dan', 'Dan');
    await vacateSeat(code, 'b', 0);
    expect(Object.keys((await matchOf(code)).players)).toEqual(['a', 'c']);
  });

  it('left by the last person closes the room, whatever the computer plays', async () => {
    const code = await createRoom('s-ann', 'Ann');
    await setComputer(code, 'b', true);
    await vacateSeat(code, 'a', 0);
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
