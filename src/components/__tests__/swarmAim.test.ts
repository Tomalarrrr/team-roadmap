// What an order's ribbon is laid out from, decided without a canvas.
//
// What has to hold: the ribbon runs the way the engine will march the column
// and no other; two ways that share a path are one stretch there, carrying both
// columns; a stretch knows which of its units joined it and which set out on
// it; and the paths still to be walked are the viewer's own and nobody else's.

import { describe, it, expect } from 'vitest';
import { MATCH_TICKS, nextHop, newState, pathLength, sendSize, step, type PathKind, type Seat, type Site, type SwarmMap, type Unit } from '../../swarmGameLogic';
import { carriedOf, flowOf, ribbonWidth, routeOf, standingOf, type Sending, type Stretch } from '../swarm/swarmAim';

// A road from 0 through 1 and 2 to 3, a side road from 4 into 1, a short cut
// through the spikes from 0 straight to 2, and a hut 5 no path reaches.
//
//        4
//        |
//   0 -- 1 -- 2 -- 3        5
//    \_______/ spikes
const PATHS: [a: number, b: number, kind: PathKind][] = [
  [0, 1, 'road'],
  [1, 2, 'road'],
  [2, 3, 'road'],
  [1, 4, 'road'],
  [0, 2, 'spikes'],
];

function mapOf(): SwarmMap {
  const site = (x: number, y: number, owner: Seat | null): Site => ({ x, y, owner, n: 10, level: 1 });
  const sites = [site(100, 300, 'a'), site(300, 200, 'a'), site(500, 300, null), site(700, 300, 'b'), site(300, 50, 'a'), site(900, 550, null)];
  return {
    id: 'meadow',
    sides: ['a', 'b'],
    homes: (['a', 'b'] as const).map((seat) => sites.findIndex((site) => site.owner === seat)),
    scene: 'meadow',
    sites,
    links: sites.map((_, i) => PATHS.flatMap(([a, b]) => (a === i ? [b] : b === i ? [a] : []))),
    paths: PATHS.map(([a, b, kind]) => ({ a, b, kind })),
    rivers: [],
    w: 1000,
    h: 660,
    size: 'small',
    ticks: MATCH_TICKS,
  };
}

function unit(id: number, seat: Seat, from: number, to: number, dest: number): Unit {
  return { id, seat, from, to, dest, d: 10 };
}

const order = (from: number[], n: number[], to: number, risky = false): Sending => ({ from, n, to, risky });
const byFrom = (flow: Stretch[], from: number): Stretch | undefined => flow.find((stretch) => stretch.from === from);

describe('routeOf', () => {
  const map = mapOf();

  it('goes round by the road, hut by hut, as the engine routes a column', () => {
    expect(routeOf(map, 0, 3, false)).toEqual([0, 1, 2, 3]);
    expect(nextHop(map, 0, 3)).toBe(1);
    expect(routeOf(map, 4, 3, false)).toEqual([4, 1, 2, 3]);
  });

  it('takes the short cut only when the order is a risky one', () => {
    expect(routeOf(map, 0, 3, true)).toEqual([0, 2, 3]);
    expect(routeOf(map, 0, 2, false)).toEqual([0, 1, 2]);
  });

  it('has no way to a hut no path reaches, nor from a hut to itself', () => {
    expect(routeOf(map, 0, 5, false)).toEqual([]);
    expect(routeOf(map, 0, 5, true)).toEqual([]);
    expect(routeOf(map, 2, 2, false)).toEqual([]);
  });
});

describe('flowOf', () => {
  const map = mapOf();

  it('lays one source out as one stretch a path, each as far from the end as the paths after it are long', () => {
    const flow = flowOf(map, order([0], [10], 3));
    expect(flow.map((s) => [s.from, s.to, s.n, s.joined])).toEqual([[2, 3, 10, 10], [1, 2, 10, 10], [0, 1, 10, 0]]);
    expect(byFrom(flow, 2)!.left).toBe(0);
    expect(byFrom(flow, 1)!.left).toBe(pathLength(map, 2, 3));
    expect(byFrom(flow, 0)!.left).toBe(pathLength(map, 1, 2) + pathLength(map, 2, 3));
  });

  it('joins two sources into one stretch from where their ways meet, carrying both', () => {
    const flow = flowOf(map, order([0, 4], [10, 6], 3));
    // Four stretches for five paths walked: 1 to 2 and 2 to 3 are each there once.
    expect(flow).toHaveLength(4);
    expect(byFrom(flow, 0)).toMatchObject({ to: 1, n: 10, joined: 0 });
    expect(byFrom(flow, 4)).toMatchObject({ to: 1, n: 6, joined: 0 });
    expect(byFrom(flow, 1)).toMatchObject({ to: 2, n: 16, joined: 16 });
    expect(byFrom(flow, 2)).toMatchObject({ to: 3, n: 16, joined: 16 });
  });

  it('counts a source on another source\'s way as setting out there, not as joining', () => {
    const flow = flowOf(map, order([0, 1], [10, 4], 3));
    expect(byFrom(flow, 1)).toMatchObject({ n: 14, joined: 10 });
    expect(byFrom(flow, 2)).toMatchObject({ n: 14, joined: 14 });
  });

  it('marks the short cut and only the short cut, and only on a risky order', () => {
    const risky = flowOf(map, order([0, 4], [10, 6], 3, true));
    expect(byFrom(risky, 0)).toMatchObject({ to: 2, toll: true, n: 10 });
    expect(byFrom(risky, 4)).toMatchObject({ to: 1, toll: false, n: 6 });
    expect(byFrom(risky, 1)).toMatchObject({ to: 2, toll: false, n: 6, joined: 6 });
    expect(byFrom(risky, 2)).toMatchObject({ to: 3, toll: false, n: 16, joined: 16 });
    expect(flowOf(map, order([0, 4], [10, 6], 3)).some((s) => s.toll)).toBe(false);
  });

  it('keeps a source with nothing to send as a way nothing walks', () => {
    const flow = flowOf(map, order([0, 4], [0, 6], 3));
    expect(byFrom(flow, 0)).toMatchObject({ n: 0, joined: 0 });
    expect(byFrom(flow, 1)).toMatchObject({ n: 6, joined: 6 });
  });

  it('lays nothing for a source no path joins to the target', () => {
    expect(flowOf(map, order([0], [10], 5))).toEqual([]);
    expect(flowOf(map, order([0, 5], [10, 3], 3)).map((s) => s.n)).toEqual([10, 10, 10]);
  });
});

describe('carriedOf', () => {
  const map = mapOf();

  it('is the whole order when every hut has units and a way', () => {
    expect(carriedOf(map, order([0, 4], [5, 3], 3))).toEqual(order([0, 4], [5, 3], 3));
  });

  it('drops the hut with nothing to send and keeps the count of each that is left', () => {
    expect(carriedOf(map, order([0, 1, 4], [5, 0, 3], 3))).toEqual(order([0, 4], [5, 3], 3));
  });

  it('carries nothing to a hut no path reaches, whatever is in the huts', () => {
    expect(carriedOf(map, order([0, 4], [5, 3], 5)).from).toEqual([]);
    expect(carriedOf(map, order([0], [5], 5, true)).from).toEqual([]);
  });

  it('carries from exactly the huts the engine then queues a column in', () => {
    for (const [to, risky] of [[3, false], [5, false], [2, true]] as const) {
      const state = newState(map);
      state.huts[1].n = 0;
      const from = [0, 1, 4];
      const asked = order(from, from.map((hut) => sendSize(state.huts[hut], 'half')), to, risky);
      step(state, map, { a: from.map((hut) => ({ tick: 1, kind: 'half', from: hut, to, risky })), b: [] });
      const queued = from.filter((hut) => state.huts[hut].out.length > 0 || state.units.some((unit) => unit.from === hut));
      expect(carriedOf(map, asked).from).toEqual(queued);
    }
  });
});

describe('standingOf', () => {
  const map = mapOf();

  it('is empty on a board where nothing has been ordered', () => {
    expect(standingOf(map, newState(map), 'a')).toEqual([]);
  });

  it('follows what waits in a hut all the way to where it was sent', () => {
    const state = newState(map);
    state.huts[0].out = [{ to: 1, dest: 3, n: 5 }];
    expect(standingOf(map, state, 'a')).toEqual([
      { from: 0, to: 1, n: 5 },
      { from: 1, to: 2, n: 5 },
      { from: 2, to: 3, n: 5 },
    ]);
  });

  it('adds a unit on the road to the paths after the one it is on, and one on its last path to none', () => {
    const state = newState(map);
    state.huts[0].out = [{ to: 1, dest: 3, n: 5 }];
    state.units = [unit(1, 'a', 0, 1, 3), unit(2, 'a', 4, 1, 3), unit(3, 'a', 1, 2, 2)];
    expect(standingOf(map, state, 'a')).toEqual([
      { from: 0, to: 1, n: 5 },
      { from: 1, to: 2, n: 7 },
      { from: 2, to: 3, n: 7 },
    ]);
  });

  it('sends a risky column by the short cut and a safe one round, on the same board', () => {
    const state = newState(map);
    state.huts[0].out = [{ to: 2, dest: 2, n: 4, risky: true }, { to: 1, dest: 2, n: 3 }];
    expect(standingOf(map, state, 'a')).toEqual([
      { from: 0, to: 2, n: 4 },
      { from: 0, to: 1, n: 3 },
      { from: 1, to: 2, n: 3 },
    ]);
  });

  it('shows nobody the other side\'s marches', () => {
    const state = newState(map);
    state.huts[3].out = [{ to: 2, dest: 0, n: 8 }];
    state.units = [unit(1, 'b', 3, 2, 0)];
    expect(standingOf(map, state, 'a')).toEqual([]);
    expect(standingOf(map, state, 'b').map((leg) => leg.n)).toEqual([8, 9, 9]);
  });
});

describe('ribbonWidth', () => {
  it('widens with what walks it, by less each time, and stops', () => {
    expect(ribbonWidth(1)).toBe(6.5);
    expect(ribbonWidth(16)).toBe(11);
    expect(ribbonWidth(64)).toBe(17);
    expect(ribbonWidth(64) - ribbonWidth(16)).toBeLessThan(4 * (ribbonWidth(16) - ribbonWidth(1)));
    expect(ribbonWidth(400)).toBe(20);
  });

  it('is thinner for nothing than for one', () => {
    expect(ribbonWidth(0)).toBe(3);
  });
});
