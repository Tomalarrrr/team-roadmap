import { describe, it, expect } from 'vitest';
import {
  CLASSIC,
  cpuPickTick,
  DRAFT_TICKS,
  MATCH_TICKS,
  START_UNITS,
  advance,
  buildMap,
  cloneState,
  decodeOrders,
  drafting,
  encodeOrders,
  newState,
  type Computer,
  type Order,
  type Seat,
  type Site,
  type SwarmMap,
  type SwarmState,
} from '../swarmGameLogic';

// What has to hold: nothing moves in the draft; a side starts on the first
// hut it picks that no other side picked first, never a tower; picks made on
// one tick go round the sides in turn; a home nobody starts from goes to
// nobody with 5; the computer picks the best hut of its own part half way
// through; and a map without the draft never looks at a pick.

const DRAFT = { ...CLASSIC, start: 'draft' as const };

// In a row: a's home, a hut, a tower, a hut of level 2, a hut and b's home. c, when it plays, sits off on its own.
//   0 home a   1 hut   2 tower   3 hut, level 2   4 hut   5 home b   (6 home c)
function board(sides: Seat[] = ['a', 'b']): SwarmMap {
  const sites: Site[] = [
    { x: 100, y: 300, owner: 'a', n: 12, level: 1 },
    { x: 260, y: 300, owner: null, n: 8, level: 1 },
    { x: 420, y: 300, owner: null, n: 10, level: 1, tower: true },
    { x: 580, y: 300, owner: null, n: 20, level: 2 },
    { x: 740, y: 300, owner: null, n: 8, level: 1 },
    { x: 900, y: 300, owner: 'b', n: 12, level: 1 },
  ];
  const links = [[1], [0, 2], [1, 3], [2, 4], [3, 5], [4]];
  if (sides.includes('c')) {
    sites.push({ x: 500, y: 620, owner: 'c', n: 12, level: 1 });
    links.push([]);
  }
  const paths = links.flatMap((linked, a) => linked.filter((b) => a < b).map((b) => ({ a, b, kind: 'road' as const })));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides, homes: sides.map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks: MATCH_TICKS, rules: DRAFT };
}

const nest = (tick: number, hut: number): Order => ({ tick, kind: 'nest', from: hut, to: hut });

/** The state at `to`, played from the start on `orders`. */
function playTo(map: SwarmMap, orders: Partial<Record<Seat, Order[]>>, to: number, cpu: Computer = {}): SwarmState {
  const state = newState(map);
  advance(state, map, orders, to, cpu);
  return state;
}

describe('the draft', () => {
  it('goes on the wire as n', () => {
    const orders = [nest(12, 3)];
    expect(encodeOrders(orders)).toBe('c:n33');
    expect(decodeOrders('c:n33')).toStrictEqual(orders);
  });

  it('is on for the draft start only, through its last tick', () => {
    const map = board();
    expect(drafting(map, 1)).toBe(true);
    expect(drafting(map, DRAFT_TICKS)).toBe(true);
    expect(drafting(map, DRAFT_TICKS + 1)).toBe(false);
    expect(drafting({ ...map, rules: CLASSIC }, 1)).toBe(false);
  });

  it('holds everything still through the draft, and lets it go after', () => {
    const map = board();
    const send = (tick: number): Order => ({ tick, kind: 'all', from: 0, to: 1 });
    const start = newState(map);
    const still = playTo(map, { a: [send(5)] }, DRAFT_TICKS);
    expect(still.tick).toBe(DRAFT_TICKS);
    expect(still.huts.map((hut) => hut.n)).toEqual(start.huts.map((hut) => hut.n));
    expect(still.units).toEqual([]);
    // Ten ticks on, a's home has bred one; a send after the draft walks.
    const after = playTo(map, { a: [send(5), send(DRAFT_TICKS + 5)] }, DRAFT_TICKS + 10);
    expect(after.units.filter((unit) => unit.seat === 'a').length).toBeGreaterThan(0);
    expect(after.huts[5].n).toBe(13);
  });

  it('starts a side on the hut it picked, with 5 at that hut\'s level, and leaves its home to nobody with 5', () => {
    const map = board();
    const orders = { a: [nest(10, 3)] };
    const before = playTo(map, orders, DRAFT_TICKS - 1);
    expect(before.picks).toEqual([3, -1]);
    expect(before.huts[3].owner).toBe(null);
    expect(before.homes).toEqual([0, 5]);
    const settled = playTo(map, orders, DRAFT_TICKS);
    expect(settled.homes).toEqual([3, 5]);
    expect(settled.huts[3]).toMatchObject({ owner: 'a', n: START_UNITS, level: 2 });
    expect(settled.huts[0]).toMatchObject({ owner: null, n: START_UNITS, level: 1 });
    expect(settled.huts[5]).toMatchObject({ owner: 'b', n: 12 });
    expect(settled.events).toContainEqual({ kind: 'capture', hut: 3, seat: 'a' });
  });

  it('takes a side\'s first pick only', () => {
    expect(playTo(board(), { a: [nest(10, 1), nest(11, 3)] }, 20).picks).toEqual([1, -1]);
  });

  it('refuses a tower, and the side can pick again', () => {
    expect(playTo(board(), { a: [nest(10, 2)] }, 20).picks).toEqual([-1, -1]);
    expect(playTo(board(), { a: [nest(10, 2), nest(11, 1)] }, 20).picks).toEqual([1, -1]);
  });

  it('gives a hut to the side that picked it first, and the other can pick again', () => {
    const state = playTo(board(), { a: [nest(11, 3), nest(12, 1)], b: [nest(10, 3)] }, 20);
    expect(state.picks).toEqual([1, 3]);
  });

  it('goes round the sides for picks of one hut on one tick, a tick each', () => {
    const map = board(['a', 'b', 'c']);
    const all = (tick: number) => ({ a: [nest(tick, 3)], b: [nest(tick, 3)], c: [nest(tick, 3)] });
    const winner = (tick: number) => map.sides[playTo(map, all(tick), tick).picks.indexOf(3)];
    expect([winner(9), winner(10), winner(11)]).toEqual(['a', 'b', 'c']);
  });

  it('moves a side whose home another picked to the nearest hut no other side holds or picked', () => {
    const settled = playTo(board(), { a: [nest(10, 5)] }, DRAFT_TICKS);
    expect(settled.homes).toEqual([5, 4]);
    expect(settled.huts[5]).toMatchObject({ owner: 'a', n: START_UNITS });
    expect(settled.huts[4]).toMatchObject({ owner: 'b', n: START_UNITS });
    expect(settled.huts[0]).toMatchObject({ owner: null, n: START_UNITS });
  });

  it('gives up a side\'s pick with the white flag, for another side to take', () => {
    const map = board(['a', 'b', 'c']);
    const state = playTo(map, { a: [nest(10, 3), { tick: 11, kind: 'flag', from: 0, to: 0 }], b: [nest(12, 3)] }, DRAFT_TICKS);
    expect(state.yielded).toEqual(['a']);
    expect(state.picks).toEqual([-1, 3, -1]);
    expect(state.homes).toEqual([0, 3, 6]);
    expect(state.huts[0].owner).toBe(null);
    expect(state.huts[3].owner).toBe('b');
  });

  it('has the computer pick the best hut of its own part half way through', () => {
    const map = board();
    const cpu: Computer = { b: 0 };
    expect(playTo(map, {}, cpuPickTick(map) - 1, cpu).picks).toEqual([-1, -1]);
    expect(playTo(map, {}, cpuPickTick(map), cpu).picks).toEqual([-1, 3]);
    // Hut 3 stands nearer b's home than a's, so a computer at a stays home rather than reach for it.
    expect(playTo(map, {}, cpuPickTick(map), { a: 0 }).picks).toEqual([0, -1]);
    const settled = playTo(map, {}, DRAFT_TICKS, cpu);
    expect(settled.homes).toEqual([0, 3]);
    expect(settled.huts[3]).toMatchObject({ owner: 'b', n: START_UNITS, level: 2 });
  });

  it('has the computer keep its home when a person beat it to the better hut', () => {
    const settled = playTo(board(), { a: [nest(10, 3)] }, DRAFT_TICKS, { b: 0 });
    expect(settled.picks).toEqual([3, 5]);
    expect(settled.homes).toEqual([3, 5]);
    expect(settled.huts[5]).toMatchObject({ owner: 'b', n: 12 });
  });

  it('settles every side of a real board on a hut of its own, the same way twice', () => {
    for (const sides of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']] as Seat[][]) {
      const map = buildMap(7, 'meadow', sides, undefined, DRAFT);
      const cpu: Computer = Object.fromEntries(sides.map((seat) => [seat, 0]));
      const settled = playTo(map, {}, DRAFT_TICKS, cpu);
      expect(new Set(settled.homes).size).toBe(sides.length);
      settled.homes.forEach((home, k) => {
        expect(map.sites[home].tower).toBeFalsy();
        expect(settled.huts[home].owner).toBe(sides[k]);
      });
      // On this meadow each of two sides' parts holds a hut of level 2, and the computer moves to it.
      if (sides.length === 2) expect(settled.homes.every((home, k) => home !== map.homes[k] && settled.huts[home].level === 2)).toBe(true);
      const first = playTo(map, {}, DRAFT_TICKS + 200, cpu);
      expect(playTo(map, {}, DRAFT_TICKS + 200, cpu)).toEqual(first);
    }
  });

  it('never looks at a pick without the draft', () => {
    const map = buildMap(7, 'meadow', ['a', 'b']);
    const plain = newState(map);
    advance(plain, map, {}, DRAFT_TICKS + 40);
    const picked = newState(map);
    const free = map.sites.findIndex((site) => !site.owner && !site.tower);
    advance(picked, map, { a: [nest(10, free)] }, DRAFT_TICKS + 40);
    expect(picked).toEqual(plain);
    expect(plain.picks).toEqual([-1, -1]);
    expect(plain.homes).toEqual(map.homes);
  });

  it('copies the homes and picks with the state', () => {
    const state = playTo(board(), { a: [nest(10, 3)] }, 20);
    const copy = cloneState(state);
    copy.picks[1] = 4;
    copy.homes[1] = 4;
    expect(state.picks).toEqual([3, -1]);
    expect(state.homes).toEqual([0, 5]);
  });
});
