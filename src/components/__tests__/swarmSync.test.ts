// Clients in one room, and whether they end on the same board.
//
// What has to hold: whatever the connection does to reads and writes, and
// whatever a player does with their tab, the state a client has run for good
// is the state every other client has run for good. Each test here plays a
// game through the functions the board itself calls and compares the boards.

import { describe, it, expect } from 'vitest';
import {
  SEATS,
  buildMap,
  countOf,
  decodeOrders,
  encodeOrders,
  lastTick,
  ORDERS_MAX,
  newState,
  sidesOf,
  type Order,
  type OrderKind,
  type Seat,
  type SwarmMatch,
  type SwarmSeatState,
} from '../../swarmGameLogic';
import {
  BEAT_AWAY_MS,
  fitsOrders,
  BEAT_IDLE_MS,
  POLL_AWAY_MS,
  SILENT_IDLE_MS,
  SILENT_LIVE_MS,
  newLockstep,
  orderTick,
  pace,
  restingReport,
  sending,
  settle,
  silent,
  sound,
  withStored,
  type Ear,
  type Lockstep,
  type SeatWrite,
} from '../swarm/swarmSync';

const SEED = 77;
const ORDER_DELAY = 4;
const KINDS: OrderKind[] = ['half', 'all', 'half', 'all', 'hut', 'speed', 'strength'];

function dice(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Seats = Partial<Record<Seat, SwarmSeatState>>;

/**
 * The room, with the things the database does to a write: stamp it, and under
 * the rules refuse one that takes back what a seat has said, that was built on
 * a write the room has since replaced, or that promises past the tick the
 * computer took the seat over from.
 */
class Room {
  m: SwarmMatch;
  s: Seats = {};
  history: Seats[] = [{}];
  refused = 0;
  private stamp = 0;
  private rules: boolean;

  /** `people` sit in their seats; `cpu` are the seats the computer plays. */
  constructor(rules: boolean, people: readonly Seat[] = ['a', 'b'], cpu = '') {
    this.rules = rules;
    const players = Object.fromEntries(people.map((seat) => [seat, { sessionId: seat, name: seat.toUpperCase() }]));
    this.m = { status: 'playing', createdAt: 0, seed: SEED, players, game: 1, startAt: 0, ...(cpu && { cpu }) };
  }

  /** What vacateSeat does to a seat in a game of more than two: the computer plays it after its promise. */
  leave(seat: Seat) {
    const stored = this.s[seat];
    this.m = { ...this.m, out: { ...this.m.out, [seat]: stored?.game === this.m.game ? stored.k : 0 } };
  }

  put(seat: Seat, { base, ...state }: SeatWrite): boolean {
    const stored = this.s[seat];
    const out = this.m.out?.[seat];
    if (this.rules && out !== undefined && state.game === this.m.game && state.k > out) {
      this.refused++;
      return false;
    }
    if (this.rules && stored && stored.game === this.m.game) {
      const moved = base !== undefined && base !== stored.seq;
      if (moved || state.game !== stored.game || state.k < stored.k || !state.orders.startsWith(stored.orders)) {
        this.refused++;
        return false;
      }
    }
    this.s = { ...this.s, [seat]: { ...state, at: ++this.stamp } };
    return true;
  }

  /** Close a step: what a read that started now would return. */
  keep() {
    this.history.push(this.s);
  }

  read(stepsAgo: number): Seats {
    return this.history[Math.max(this.history.length - 1 - stepsAgo, 0)];
  }
}

/**
 * What a connection does to a tab: `lag` is how many steps old a read can be,
 * `lose` the share of writes that never arrive, `late` the share that take
 * `slow` steps to, and `deaf` the share that arrive with no answer coming back.
 */
interface Faults {
  lag: number;
  lose: number;
  late: number;
  slow: number;
  deaf: number;
}

/** A tab, doing what the board's pump does once a frame. */
class Tab {
  lock: Lockstep | null = null;
  view: Seats = {};
  seq: number;
  sentKey = '';
  sentK = -1;
  given = 0;
  /** Writes on their way: [steps left, state]. */
  flying: [number, SeatWrite][] = [];
  seat: Seat;
  faults: Faults;
  private room: Room;
  private rand: () => number;

  constructor(seat: Seat, room: Room, rand: () => number, faults: Faults) {
    this.seat = seat;
    this.room = room;
    this.rand = rand;
    this.faults = faults;
    this.seq = Math.floor(rand() * 1e6) * 1000;
  }

  poll() {
    this.view = this.room.read(Math.floor(this.rand() * (this.faults.lag + 1)));
    for (const seat of SEATS) {
      const state = this.view[seat];
      if (state && !sound(state)) this.view = { ...this.view, [seat]: undefined };
    }
  }

  /**
   * `synced` false is a tab whose clock is not set yet: it knows the room and
   * not the time. `beat` is the heartbeat coming due, which sends whether or
   * not there is anything new.
   */
  frame(tick: number, synced: boolean, orders: number, beat = false) {
    for (const flight of this.flying) flight[0]--;
    for (const [, write] of this.flying.filter(([left]) => left <= 0)) {
      // `deaf` is a write that lands and whose answer never comes back: the tab takes it for lost.
      if (!this.room.put(this.seat, write) || this.rand() < this.faults.deaf) this.sentKey = '';
      else if (this.lock && write.game === this.lock.game && this.lock.ownSeq === write.base) this.lock.ownSeq = write.seq;
    }
    this.flying = this.flying.filter(([left]) => left > 0);

    if (!synced) {
      if (this.flying.length === 0) this.send(restingReport(this.room.m, this.view[this.seat], ++this.seq), 'rest');
      return;
    }
    if (!this.lock) this.lock = newLockstep(1, buildMap(SEED, undefined, sidesOf(this.room.m)));
    const lock = this.lock;
    settle(lock, this.seat, this.room.m, this.view, tick);
    for (let i = 0; i < orders; i++) this.give(tick);
    const key = `1|${lock.orders[this.seat].length}`;
    // One write at a time, as the board sends them: the promise waits for the last to come back.
    if (this.flying.length > 0) return;
    if (beat || key !== this.sentKey || Math.min(tick, lock.map.ticks) - this.sentK >= 4) this.send(sending(lock, this.seat, ++this.seq, tick), key);
  }

  private give(tick: number) {
    const lock = this.lock as Lockstep;
    if (tick < 0 || lock.shown.winner !== null) return;
    const held = lock.shown.huts.flatMap((hut, index) => (hut.owner === this.seat ? [index] : []));
    if (held.length === 0) return;
    const mine = lock.orders[this.seat];
    const last = mine.length > 0 ? mine[mine.length - 1].tick : 0;
    const from = held[Math.floor(this.rand() * held.length)];
    const kind = KINDS[Math.floor(this.rand() * KINDS.length)];
    const to = Math.floor(this.rand() * lock.shown.huts.length);
    mine.push({ tick: orderTick(tick + ORDER_DELAY, lock.promised, lock.confirmed.tick, last), kind, from, to });
    this.given++;
  }

  private send(write: SeatWrite, key: string) {
    this.sentKey = key;
    this.sentK = write.k;
    if (this.rand() < this.faults.lose) {
      this.sentKey = '';
      return;
    }
    this.flying.push([this.rand() < this.faults.late ? this.faults.slow : 1, write]);
  }
}

const CLEAN: Faults = { lag: 0, lose: 0, late: 0, slow: 1, deaf: 0 };
const ROUGH: Faults = { lag: 3, lose: 0.15, late: 0.2, slow: 4, deaf: 0.1 };

/** Let every tab hear everything, and run them all to the same tick. */
function drain(room: Room, tabs: Tab[], tick: number) {
  for (const tab of tabs) tab.faults = CLEAN;
  for (let i = 0; i < 12; i++) {
    for (const tab of tabs) {
      tab.poll();
      tab.frame(tick, true, 0, true);
    }
    room.keep();
  }
}

/** The confirmed state, as its tick and a sum over everything in it: short enough to read when two differ. */
function board(tab: Tab): string {
  const { confirmed } = tab.lock as Lockstep;
  let sum = 0;
  for (const char of JSON.stringify(confirmed)) sum = (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0;
  return `tick ${confirmed.tick} sum ${sum}`;
}

interface Play {
  rules: boolean;
  ticks: number;
  /** Called before each tick's frames; returns the tick each tab believes it is, or null for one with no clock. */
  script?: (tick: number, tabs: Tab[], room: Room) => void;
  tickOf?: (tab: Tab, tick: number) => number | null;
  tabs?: (room: Room, rand: () => number) => Tab[];
  seed?: number;
  room?: Room;
}

function play({ rules, ticks, script, tickOf, tabs: make, seed = 5, room = new Room(rules) }: Play) {
  const rand = dice(seed);
  const tabs = make ? make(room, rand) : [new Tab('a', room, rand, ROUGH), new Tab('b', room, rand, ROUGH)];
  for (let tick = -10; tick <= ticks; tick++) {
    script?.(tick, tabs, room);
    for (const tab of tabs) {
      if (rand() < 0.7) tab.poll();
      const theirs = tickOf ? tickOf(tab, tick) : tick;
      tab.frame(theirs ?? 0, theirs !== null, rand() < 0.25 ? 1 : 0);
    }
    room.keep();
  }
  drain(room, tabs, ticks);
  return { room, tabs };
}

describe.each([
  ['with the rules that refuse a seat taking its word back', true],
  ['with rules that let any write land', false],
])('two clients %s', (_, rules) => {
  it('end on the same board through lost, late and stale requests', () => {
    const { tabs, room } = play({ rules, ticks: 500 });
    const [a, b] = tabs;
    expect((a.lock as Lockstep).confirmed.tick).toBe(500);
    expect(board(a)).toBe(board(b));
    // The orders have to have mattered, or equal boards say nothing.
    expect(a.given).toBeGreaterThan(40);
    expect(b.given).toBeGreaterThan(40);
    const unplayed = new Tab('a', new Room(rules), dice(1), CLEAN);
    unplayed.view = { b: { seq: 1, at: 1, game: 1, k: 500, orders: '' } };
    unplayed.frame(500, true, 0);
    expect(board(unplayed)).toMatch(/^tick 500 /);
    expect(board(a)).not.toBe(board(unplayed));
    expect(decodeOrders((room.s.a as SwarmSeatState).orders)).toHaveLength((a.lock as Lockstep).orders.a.length);
  });

  it('end on the same board when one of them reloads the page mid-game', () => {
    let before = '';
    const { tabs, room } = play({
      rules,
      ticks: 500,
      script: (tick, tabs, room) => {
        if (tick !== 250) return;
        before = (room.s.b as SwarmSeatState).orders;
        // Only the rules can stop the new page writing over a write of the old
        // page's that it has not read yet, so without them it reads the room as it is.
        tabs[1] = new Tab('b', room, dice(99), rules ? ROUGH : { ...ROUGH, lag: 0 });
        // The board writes nothing until it has read the room once.
        tabs[1].poll();
      },
      // A reloaded tab reads the room for a while before it knows the time.
      tickOf: (tab, tick) => (tab.seat === 'b' && tick >= 250 && tick < 262 ? null : tick),
    });
    const [a, b] = tabs;
    expect(decodeOrders(before).length).toBeGreaterThan(10);
    expect((room.s.b as SwarmSeatState).orders.startsWith(before)).toBe(true);
    expect(b.given).toBeGreaterThan(10);
    expect((a.lock as Lockstep).confirmed.tick).toBe(500);
    expect(board(a)).toBe(board(b));
  });

  it('end on the same board when one clock steps back further than an order is delayed', () => {
    const { tabs } = play({
      rules,
      ticks: 400,
      // Seat a's estimate of the server time drops by a second and a half every few seconds, and comes back.
      tickOf: (tab, tick) => (tab.seat === 'a' && tick > 30 && tick % 40 >= 30 ? tick - 15 : tick),
      // Every write of a's takes over a second while its reads are quick, so its promise trails what it has run.
      tabs: (room, rand) => [new Tab('a', room, rand, { lag: 0, lose: 0, late: 1, slow: 12, deaf: 0 }), new Tab('b', room, rand, CLEAN)],
    });
    const [a, b] = tabs;
    expect(a.given).toBeGreaterThan(40);
    expect(board(a)).toBe(board(b));
  });
});

describe('more than two sides', () => {
  it('three people and the computer end on the same board through lost, late and stale requests', () => {
    const room = new Room(true, ['a', 'b', 'd'], 'c');
    const { tabs } = play({
      rules: true,
      ticks: 400,
      room,
      tabs: (room, rand) => [new Tab('a', room, rand, ROUGH), new Tab('b', room, rand, ROUGH), new Tab('d', room, rand, ROUGH)],
    });
    const [a, b, d] = tabs;
    expect((a.lock as Lockstep).map.sides).toEqual(['a', 'b', 'c', 'd']);
    expect((a.lock as Lockstep).confirmed.tick).toBe(400);
    for (const tab of tabs) expect(tab.given).toBeGreaterThan(20);
    expect(board(a)).toBe(board(b));
    expect(board(a)).toBe(board(d));
    expect(room.s).not.toHaveProperty('c');
  });

  it('a person who leaves mid-game is played on by the computer, and the rest end on the same board', () => {
    const room = new Room(true, ['a', 'b', 'c']);
    const gone: { tab?: Tab } = {};
    const { tabs } = play({
      rules: true,
      ticks: 450,
      room,
      tabs: (room, rand) => [new Tab('a', room, rand, ROUGH), new Tab('b', room, rand, ROUGH), new Tab('c', room, rand, ROUGH)],
      script: (tick, tabs, room) => {
        if (tick !== 200) return;
        gone.tab = tabs.pop();
        room.leave('c');
      },
    });
    const [a, b] = tabs;
    const out = room.m.out?.c as number;
    expect(out).toBeGreaterThan(150);
    // The confirmed state ran past the seat that stopped writing, which only the computer taking it over allows.
    expect((a.lock as Lockstep).confirmed.tick).toBe(450);
    expect((room.s.c as SwarmSeatState).k).toBe(out);
    expect(board(a)).toBe(board(b));
    // A write from the tab that left, promising past the tick it left at, is refused.
    const left = gone.tab as Tab;
    left.faults = CLEAN;
    left.flying = [];
    const refused = room.refused;
    left.frame(460, true, 0, true);
    left.frame(461, true, 0, true);
    expect(room.refused).toBe(refused + 1);
    expect((room.s.c as SwarmSeatState).k).toBe(out);
  });

  it('without the computer taking over, the others could not run past the seat that stopped writing', () => {
    const room = new Room(true, ['a', 'b', 'c']);
    let stopped = 0;
    const { tabs } = play({
      rules: true,
      ticks: 450,
      room,
      tabs: (room, rand) => [new Tab('a', room, rand, ROUGH), new Tab('b', room, rand, ROUGH), new Tab('c', room, rand, ROUGH)],
      script: (tick, tabs, room) => {
        if (tick !== 200) return;
        tabs.pop();
        stopped = (room.s.c as SwarmSeatState).k;
      },
    });
    expect((tabs[0].lock as Lockstep).confirmed.tick).toBeLessThanOrEqual(200);
    expect((tabs[0].lock as Lockstep).confirmed.tick).toBeGreaterThanOrEqual(stopped);
  });
});

describe('the orders a seat may store', () => {
  it('takes an order up to the cap, to the character, and none past it', () => {
    const order = (tick: number): Order => ({ tick, kind: 'half', from: 0, to: 1 });
    // '1:h01' is 5 characters and a comma joins each to the next.
    const list = Array.from({ length: 33332 }, () => order(1));
    expect(encodeOrders(list).length).toBe(ORDERS_MAX - 9);
    // A comma and 'zzzz:h01' end exactly at the cap; a tick one longer goes past it.
    expect(fitsOrders(list, order(36 ** 4 - 1))).toBe(true);
    expect(fitsOrders(list, order(36 ** 4))).toBe(false);
    expect(fitsOrders([], order(1))).toBe(true);
  });
});

describe('one seat open in two tabs', () => {
  it('plays as one seat, and all three boards agree, when the rules refuse a stale write', () => {
    const { tabs, room } = play({
      rules: true,
      ticks: 400,
      tabs: (room, rand) => [new Tab('a', room, rand, ROUGH), new Tab('b', room, rand, ROUGH), new Tab('b', room, rand, ROUGH)],
    });
    const [a, b1, b2] = tabs;
    expect(b1.given).toBeGreaterThan(20);
    expect(b2.given).toBeGreaterThan(20);
    expect(room.refused).toBeGreaterThan(0);
    expect(board(a)).toBe(board(b1));
    expect(board(a)).toBe(board(b2));
  });
});

describe('withStored', () => {
  const o = (tick: number, from = 0, to = 1): Order => ({ tick, kind: 'half', from, to });

  it('is the same list when the room holds nothing this client lacks', () => {
    const mine = [o(5), o(9)];
    expect(withStored(mine, { k: 6, orders: encodeOrders([o(5)]) })).toBe(mine);
    expect(withStored(mine, { k: 0, orders: '' })).toBe(mine);
  });

  it('takes back everything a reloaded tab had given', () => {
    const stored = [o(5), o(9, 2, 3)];
    expect(withStored([], { k: 12, orders: encodeOrders(stored) })).toEqual(stored);
  });

  it('drops an order the room has promised past without holding, though the room has nothing new', () => {
    expect(withStored([o(5), o(9), o(14)], { k: 12, orders: encodeOrders([o(5)]) })).toEqual([o(5), o(14)]);
  });

  it('puts the room first and keeps only what its promise leaves room for', () => {
    const shared = o(5);
    const theirs = o(20, 2, 3);
    const merged = withStored([shared, o(18, 4, 5), o(26, 6, 7)], { k: 22, orders: encodeOrders([shared, theirs]) });
    expect(merged).toEqual([shared, theirs, o(26, 6, 7)]);
  });
});

describe('sound', () => {
  const state = (over: object): SwarmSeatState => ({ seq: 1, at: 1, game: 1, k: 4, orders: '4:h03,a:A1z', ...over } as SwarmSeatState);

  it('passes what the game writes', () => {
    expect(sound(state({}))).toBe(true);
    expect(sound(state({ orders: '' }))).toBe(true);
    expect(sound(state({ orders: encodeOrders([{ tick: buildMap(SEED).ticks + 4, kind: 'strength', from: 35, to: 0, risky: true }]) }))).toBe(true);
  });

  it.each([',', '5:', '5:h01,', '5:h0', ':h01', '5:h012', '5;h01'])('refuses orders %j, which the decoder cannot be trusted with', (orders) => {
    expect(sound(state({ orders }))).toBe(false);
  });

  it('is needed: the decoder throws on some of these', () => {
    expect(() => decodeOrders(',')).toThrow();
    expect(() => decodeOrders('5:')).toThrow();
  });

  it.each([{ k: -1 }, { k: 1.5 }, { k: '7' }, { k: undefined }, { game: 'x' }, { orders: undefined }, { orders: 7 }])('refuses %j', (over) => {
    expect(sound(state(over))).toBe(false);
  });
});

describe('orderTick', () => {
  it('is a delay ahead when nothing is in the way', () => {
    expect(orderTick(104, 100, 100, 90)).toBe(104);
  });

  it('is never a tick this client has already run for good, however far the clock stepped back', () => {
    expect(orderTick(84, 80, 100, 0)).toBe(101);
  });

  it('is never a tick promised complete, and never before the last order', () => {
    expect(orderTick(84, 100, 80, 0)).toBe(101);
    expect(orderTick(84, 80, 80, 120)).toBe(120);
  });
});

describe('settle', () => {
  const lock = (sides: readonly Seat[] = ['a', 'b']): Lockstep => newLockstep(1, buildMap(SEED, undefined, sides));
  const stored = (seq: number, k: number, orders: string): SwarmSeatState => ({ seq, at: 1, game: 1, k, orders });
  const people = {};

  it('runs for good only as far as the other seat has promised, and shows on to now', () => {
    const game = lock();
    settle(game, 'a', people, { b: stored(1, 30, '') }, 50);
    expect(game.confirmed.tick).toBe(30);
    expect(game.shown.tick).toBe(50);
    settle(game, 'a', people, { b: stored(2, 90, '') }, 60);
    expect(game.confirmed.tick).toBe(60);
  });

  it('runs for good only as far as the lowest promise of all the other people', () => {
    const game = lock(['a', 'b', 'c', 'd']);
    settle(game, 'b', people, { a: stored(1, 70, ''), c: stored(2, 25, ''), d: stored(3, 40, '') }, 80);
    expect(game.confirmed.tick).toBe(25);
    expect(game.shown.tick).toBe(80);
    settle(game, 'b', people, { a: stored(1, 70, ''), c: stored(4, 90, ''), d: stored(3, 40, '') }, 80);
    expect(game.confirmed.tick).toBe(40);
  });

  it('does not wait on a person who has written nothing in this game', () => {
    const game = lock(['a', 'b', 'c']);
    settle(game, 'a', people, { b: stored(1, 60, ''), c: { ...stored(2, 400, ''), game: 0 } }, 70);
    expect(game.confirmed.tick).toBe(0);
  });

  it('does not wait on a seat the computer plays from the start', () => {
    const game = lock(['a', 'b', 'c']);
    settle(game, 'a', { cpu: 'c' }, { b: stored(1, 60, '') }, 70);
    expect(game.confirmed.tick).toBe(60);
    settle(game, 'a', { cpu: 'bc' }, {}, 75);
    expect(game.confirmed.tick).toBe(75);
  });

  it('waits on a seat that left until the room holds its promise through the tick it left at, and not after', () => {
    const game = lock(['a', 'b', 'c']);
    const left = { out: { c: 50 } };
    settle(game, 'a', left, { b: stored(1, 200, ''), c: stored(2, 35, '') }, 100);
    expect(game.confirmed.tick).toBe(35);
    settle(game, 'a', left, { b: stored(1, 200, ''), c: stored(3, 50, '') }, 100);
    expect(game.confirmed.tick).toBe(100);
  });

  it('runs the orders of a seat that left up to the tick it left at, and the computer\'s after it', () => {
    const map = buildMap(SEED, undefined, ['a', 'b', 'c']);
    const start = newState(map);
    const hut = start.huts.findIndex((h) => h.owner === 'c');
    const away = start.huts.findIndex((h) => h.owner === 'a');
    const orders = encodeOrders([{ tick: 40, kind: 'all', from: hut, to: away }]);
    const before = lock(['a', 'b', 'c']);
    settle(before, 'a', { out: { c: 45 } }, { b: stored(1, 60, ''), c: stored(2, 45, orders) }, 60);
    const after = lock(['a', 'b', 'c']);
    settle(after, 'a', { out: { c: 39 } }, { b: stored(1, 60, ''), c: stored(2, 39, orders) }, 60);
    expect(before.confirmed.tick).toBe(60);
    expect(after.confirmed.tick).toBe(60);
    expect(before.orders.c).toHaveLength(1);
    expect(before.confirmed.huts[hut].n).not.toBe(after.confirmed.huts[hut].n);
  });

  it('builds its next write on the room it read, and not on a read that crossed a later write of its own', () => {
    const game = lock();
    const first = sending(game, 'a', 7, 10);
    settle(game, 'a', people, { a: { ...first, at: 1 } }, 11);
    expect(game.ownSeq).toBe(7);
    sending(game, 'a', 8, 14);
    game.ownSeq = 8;
    settle(game, 'a', people, { a: { ...first, at: 1 } }, 15);
    expect(game.ownSeq).toBe(8);
    // Another tab's write is not this tab's past: it is taken in whatever its number.
    settle(game, 'a', people, { a: stored(3, 16, '') }, 16);
    expect(game.ownSeq).toBe(3);
    expect(game.promised).toBe(16);
  });

  it('ignores what the room holds from another game', () => {
    const game = lock();
    settle(game, 'a', people, { a: { seq: 5, at: 1, game: 9, k: 400, orders: '4:h01' }, b: { seq: 6, at: 1, game: 9, k: 400, orders: '4:h10' } }, 20);
    expect(game.orders).toEqual({ a: [], b: [], c: [], d: [] });
    expect(game.promised).toBe(0);
    expect(game.confirmed.tick).toBe(0);
  });
});

describe('restingReport', () => {
  const match = (status: SwarmMatch['status'], game: number): SwarmMatch => ({ status, createdAt: 0, seed: 1, players: {}, game, startAt: 0 });
  const stored: SwarmSeatState = { seq: 3, at: 9, game: 2, k: 140, orders: '4:h03' };
  const idle = { seq: 8, game: 0, k: 0, orders: '' };

  it('repeats what the room holds for this seat in a game it has not joined yet, as a write on top of it', () => {
    expect(restingReport(match('playing', 2), stored, 8)).toEqual({ seq: 8, game: 2, k: 140, orders: '4:h03', base: 3 });
  });

  it('says no game when there is none, or when what the room holds is from another', () => {
    expect(restingReport(match('finished', 2), stored, 8)).toEqual(idle);
    expect(restingReport(match('waiting', 2), stored, 8)).toEqual(idle);
    expect(restingReport(match('playing', 3), stored, 8)).toEqual(idle);
    expect(restingReport(match('playing', 2), undefined, 8)).toEqual(idle);
  });
});

describe('sending', () => {
  const lock = (): Lockstep => {
    const game = newLockstep(3, buildMap(SEED));
    game.orders.a.push({ tick: 9, kind: 'all', from: 0, to: 1 });
    return game;
  };

  it('promises through the tick it is sent on and no further than the map\'s game can run, overtime and all', () => {
    const game = lock();
    expect(sending(game, 'a', 41, 12)).toEqual({ seq: 41, game: 3, k: 12, orders: '9:a01' });
    expect(game.promised).toBe(12);
    expect(sending(game, 'a', 42, 7).k).toBe(12);
    expect(sending(game, 'a', 43, game.map.ticks + 50).k).toBe(game.map.ticks + 50);
    expect(sending(game, 'a', 44, lastTick(game.map) + 50).k).toBe(lastTick(game.map));
    expect(sending(lock(), 'a', 44, -20).k).toBe(0);
  });

  it('names the write it is built on once there is one', () => {
    const game = lock();
    game.ownSeq = 40;
    expect(sending(game, 'a', 41, 12).base).toBe(40);
  });
});

describe('pace', () => {
  it('does not slow a game down in a hidden tab', () => {
    expect(pace(true, true, true)).toEqual(pace(true, false, true));
    expect(pace(true, true, true)).toEqual({ poll: 150, beat: 1000 });
  });

  it('reads and writes far less often when nothing is being played, and less again when hidden', () => {
    expect(pace(false, false, true)).toEqual({ poll: 800, beat: BEAT_IDLE_MS });
    expect(pace(false, true, true)).toEqual({ poll: POLL_AWAY_MS, beat: BEAT_AWAY_MS });
  });

  it('keeps writing at the game rate until the clock is set', () => {
    expect(pace(false, false, false).beat).toBe(1000);
    expect(pace(false, true, false).beat).toBe(1000);
  });

  it('never leaves a seat silent for anything like as long as it is given up after', () => {
    expect(BEAT_AWAY_MS * 4).toBeLessThanOrEqual(SILENT_IDLE_MS);
    expect(pace(true, true, true).beat * 10).toBeLessThanOrEqual(SILENT_LIVE_MS);
  });
});

describe('the board the tests play on', () => {
  it.each([[['a', 'b']], [['a', 'b', 'c']], [['a', 'b', 'c', 'd']]] as Seat[][][])('is one where every seat of %j holds something to give orders from', (sides) => {
    const start = newState(buildMap(SEED, undefined, sides));
    for (const seat of sides) expect(countOf(start, seat).huts).toBeGreaterThan(0);
  });
});

describe('giving a silent seat up', () => {
  const ear = (): Ear => ({ seq: 7, at: 0, playing: false });

  it('waits the long silence out in the lobby and the short one in a game', () => {
    const lobby = ear();
    expect(silent(lobby, true, 7, false, SILENT_IDLE_MS)).toBe(false);
    expect(silent(lobby, true, 7, false, SILENT_IDLE_MS + 1)).toBe(true);
    const game = { ...ear(), playing: true };
    expect(silent(game, true, 7, true, SILENT_LIVE_MS)).toBe(false);
    expect(silent(game, true, 7, true, SILENT_LIVE_MS + 1)).toBe(true);
  });

  it('counts a game from its start, not from a write made at the lobby rate before it', () => {
    // A hidden tab in the lobby writes every BEAT_AWAY_MS and reads every POLL_AWAY_MS,
    // so at the start of a game its last write can be nearly as old as a game allows.
    const heard = ear();
    const start = BEAT_AWAY_MS + POLL_AWAY_MS - 1;
    expect(silent(heard, true, 7, true, start)).toBe(false);
    expect(silent(heard, true, 7, true, SILENT_LIVE_MS + 1)).toBe(false);
    expect(silent(heard, true, 7, true, start + SILENT_LIVE_MS)).toBe(false);
    expect(silent(heard, true, 7, true, start + SILENT_LIVE_MS + 1)).toBe(true);
  });

  it('starts again on every write, and after giving up', () => {
    const heard = { ...ear(), playing: true };
    expect(silent(heard, true, 8, true, SILENT_LIVE_MS + 5)).toBe(false);
    expect(silent(heard, true, 8, true, 2 * SILENT_LIVE_MS + 5)).toBe(false);
    expect(silent(heard, true, 8, true, 2 * SILENT_LIVE_MS + 6)).toBe(true);
    expect(silent(heard, true, 8, true, 2 * SILENT_LIVE_MS + 7)).toBe(false);
  });

  it('never gives up a seat nobody is in', () => {
    const heard = ear();
    expect(silent(heard, false, undefined, false, 10 * SILENT_IDLE_MS)).toBe(false);
    expect(silent(heard, false, undefined, false, 20 * SILENT_IDLE_MS)).toBe(false);
  });
});
