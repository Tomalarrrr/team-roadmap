import { describe, it, expect } from 'vitest';
import {
  CLASSIC,
  MATCH_TICKS,
  SEATS,
  advance,
  buildMap,
  countOf,
  cpuOrders,
  decodeOrders,
  encodeOrders,
  newState,
  step,
  type Computer,
  type Order,
  type Seat,
  type Site,
  type SwarmMap,
} from '../swarmGameLogic';

function mapOf(sites: Site[], links: number[][], sides: Seat[]): SwarmMap {
  const paths = links.flatMap((linked, a) => linked.filter((b) => a < b).map((b) => ({ a, b, kind: 'road' as const })));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides, homes: sides.map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks: MATCH_TICKS, rules: CLASSIC };
}

// a's home and its level 2 hut, a fort of b's between them and b's home, and c off on its own.
function board(sides: Seat[]) {
  const sites: Site[] = [
    { x: 100, y: 100, owner: 'a', n: 12, level: 1 },
    { x: 160, y: 100, owner: 'a', n: 7, level: 2 },
    { x: 400, y: 100, owner: 'b', n: 6, level: 1, fort: true },
    { x: 460, y: 100, owner: 'b', n: 6, level: 1 },
  ];
  const links = [[1], [0, 2], [1, 3], [2]];
  if (sides.includes('c')) {
    sites.push({ x: 900, y: 600, owner: 'c', n: 5, level: 1 });
    links.push([]);
  }
  const map = mapOf(sites, links, sides);
  return { map, state: newState(map) };
}

const flag = (tick: number): Order => ({ tick, kind: 'flag', from: 0, to: 0 });

describe('the white flag', () => {
  it('goes on the wire as w', () => {
    const orders = [flag(40)];
    expect(encodeOrders(orders)).toBe('14:w00');
    expect(decodeOrders('14:w00')).toStrictEqual(orders);
  });

  it('with two sides gives the other the game on its tick', () => {
    const { map, state } = board(['a', 'b']);
    // A column on the road, to show it goes too.
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 1, to: 2 }], b: [] });
    step(state, map, {});
    expect(countOf(state, 'a').units).toBeGreaterThan(0);
    step(state, map, { a: [flag(3)] });
    expect(state.winner).toBe('b');
    expect(state.tick).toBe(3);
    expect(state.yielded).toEqual(['a']);
    expect(state.events).toContainEqual({ kind: 'flag', seat: 'a', huts: [0, 1] });
    expect(state.units.filter((unit) => unit.seat === 'a')).toEqual([]);
    expect(state.huts.slice(0, 2).map(({ owner, level, out }) => ({ owner, level, out }))).toEqual([
      { owner: null, level: 1, out: [] },
      { owner: null, level: 2, out: [] },
    ]);
  });

  it('with three sides leaves the huts loaded for the others to race for, and play goes on', () => {
    const { map, state } = board(['a', 'b', 'c']);
    const before = state.huts.map((hut) => hut.n);
    step(state, map, { a: [flag(1)] });
    expect(state.winner).toBeNull();
    expect(state.huts.map((hut) => hut.owner)).toEqual([null, null, 'b', 'b', 'c']);
    // Neutral, they breed no more: what was in them is what there is to take.
    for (let tick = 0; tick < 30; tick++) step(state, map, {});
    expect(state.huts.slice(0, 2).map((hut) => hut.n)).toEqual(before.slice(0, 2));
    const race: Order[] = [{ tick: 32, kind: 'all', from: 2, to: 1 }, { tick: 32, kind: 'all', from: 3, to: 1 }];
    advance(state, map, { b: race }, 120);
    expect(state.huts[1].owner).toBe('b');
    expect(state.winner).toBeNull();
  });

  it('keeps a fort what it is when its side gives up', () => {
    const { map, state } = board(['a', 'b', 'c']);
    state.huts[2].hurt = 1;
    step(state, map, { b: [flag(1)] });
    expect(state.huts[2]).toMatchObject({ owner: null, n: 6, hurt: 1 });
  });

  it('from a side with nothing does nothing', () => {
    const { map, state } = board(['a', 'b', 'c']);
    state.huts[4] = { ...state.huts[4], owner: null };
    const quiet = structuredClone(state);
    step(state, map, { c: [flag(1)] });
    step(quiet, map, {});
    expect(state.yielded).toEqual([]);
    expect(state.events).toEqual([]);
    expect(state).toEqual(quiet);
  });

  it('is raised once: a second flag finds nothing to give up', () => {
    const { map, state } = board(['a', 'b', 'c']);
    step(state, map, { a: [flag(1), flag(1)] });
    step(state, map, { a: [flag(2)] });
    expect(state.yielded).toEqual(['a']);
    expect(state.events).toEqual([]);
  });

  it('is never raised by the computer, however far behind', () => {
    const { map, state } = board(['a', 'b']);
    state.huts[1] = { ...state.huts[1], n: 0 };
    state.huts[2] = { ...state.huts[2], n: 80 };
    state.huts[3] = { ...state.huts[3], n: 80 };
    for (let tick = 0; tick < 10; tick++) expect(cpuOrders(state, map, 'a').filter((order) => order.kind === 'flag')).toEqual([]);
    advance(state, map, {}, 2000, { a: 0, b: 0 });
    expect(state.winner).toBe('b');
    expect(state.yielded).toEqual([]);
  });

  it('plays out the same twice', () => {
    const play = () => {
      const sides = SEATS.slice(0, 3);
      const map = buildMap(42, 'meadow', sides);
      const state = newState(map);
      const cpu: Computer = { b: 0, c: 0 };
      advance(state, map, { a: [{ tick: 3, kind: 'half', from: map.homes[0], to: map.homes[1] }, flag(150)] }, 900, cpu);
      return state;
    };
    const first = play();
    expect(first.yielded).toEqual(['a']);
    expect(JSON.stringify(play())).toBe(JSON.stringify(first));
  });
});

describe('the orders the twists and starts will give', () => {
  it('do nothing on their own', () => {
    const { map, state } = board(['a', 'b']);
    const quiet = structuredClone(state);
    const kinds = ['nest', 'burn', 'rain', 'call', 'decoy'] as const;
    step(state, map, { a: kinds.map((kind) => ({ tick: 1, kind, from: 1, to: 2 })) });
    step(quiet, map, {});
    expect(state).toEqual(quiet);
    expect(encodeOrders(kinds.map((kind) => ({ tick: 1, kind, from: 1, to: 2 })))).toBe('1:n12,1:x12,1:r12,1:c12,1:y12');
  });
});
