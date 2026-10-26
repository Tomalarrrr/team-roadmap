import { describe, it, expect } from 'vitest';
import {
  BURN_COST,
  BURN_FUSE,
  BURN_TICKS,
  CLASSIC,
  CUT_COST,
  CUT_TICKS,
  MATCH_TICKS,
  WALLS_MOST,
  WALL_COST,
  WALL_HP,
  burnCost,
  buildMap,
  cloneState,
  closedOn,
  cpuOrders,
  cutCost,
  decodeOrders,
  encodeOrders,
  newState,
  pathLength,
  step,
  thinksAt,
  wallCost,
  type Order,
  type PathKind,
  type Rules,
  type Seat,
  type Site,
  type SwarmMap,
  type SwarmState,
  type Unit,
} from '../swarmGameLogic';
import { calloutsFor } from '../components/swarm/swarmFeel';
import { pathSpots } from '../components/swarm/swarmSceneWalls';
import { pathPoint } from '../components/swarm/swarmSceneKit';

const WALLS: Rules = { ...CLASSIC, twists: ['walls'] };

function mapOf(sites: Site[], ways: [number, number, PathKind][], rules: Rules = WALLS): SwarmMap {
  const links = sites.map((_, at) => ways.flatMap(([a, b]) => (a === at ? [b] : b === at ? [a] : [])));
  const paths = ways.map(([a, b, kind]) => ({ a: Math.min(a, b), b: Math.max(a, b), kind }));
  const sides = (['a', 'b'] as const).filter((seat) => sites.some((site) => site.owner === seat));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides, homes: sides.map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks: MATCH_TICKS, rules };
}

const hut = (x: number, owner: Seat | null, n: number, y = 300): Site => ({ x, y, owner, n, level: 1 });

let nextId = 1000;
function put(state: SwarmState, seat: Seat, from: number, to: number, d: number): Unit {
  const unit: Unit = { id: nextId++, seat, from, to, dest: to, d };
  state.units.push(unit);
  return unit;
}

const run = (state: SwarmState, map: SwarmMap, ticks: number) => {
  for (let t = 0; t < ticks; t++) step(state, map, {});
};

// a holds 1 at the near end of the middle path, b holds 2 at the far end, and both homes are off on a road.
const ground = (rules: Rules = WALLS, kind: PathKind = 'road') =>
  mapOf([hut(50, 'a', 5), hut(150, 'a', 30), hut(850, 'b', 30), hut(950, 'b', 5)], [[0, 1, 'road'], [1, 2, kind], [2, 3, 'road']], rules);
const order = (kind: 'cut' | 'wall' | 'burn', tick: number, from = 1, to = 2): { a: Order[] } => ({ a: [{ tick, kind, from, to }] });

describe('cutting a path', () => {
  it('can only be done with the walls twist, from a hut someone holds', () => {
    expect(cutCost(newState(ground(CLASSIC)), ground(CLASSIC), 1, 2)).toBeNull();
    expect(cutCost(newState(ground()), ground(), 1, 2)).toBe(CUT_COST);
    expect(cutCost(newState(ground()), ground(), 1, 3)).toBeNull();
    const map = ground();
    const state = newState(map);
    state.huts[1].owner = null;
    expect(cutCost(state, map, 1, 2)).toBeNull();
    const classic = ground(CLASSIC);
    const unchanged = newState(classic);
    step(unchanged, classic, order('cut', 1));
    expect(unchanged.fuses).toEqual([]);
    expect(unchanged.huts[1].n).toBe(30);
  });

  it.each([
    ['buildings', ['buildings']],
    ['buildings and walls', ['buildings', 'walls']],
  ] as const)('leaves the bridge fire of the buildings twist as it was, with %s', (_, twists) => {
    // A cut that closed for as long as a burnt bridge would not show which of the two a fire is taken for.
    const map = ground({ ...CLASSIC, twists: [...twists], tune: { ...CLASSIC.tune, cutTicks: 100 } }, 'bridge');
    expect(cutCost(newState(map), map, 1, 2)).toBe(twists.length === 1 ? null : CUT_COST);
    const state = newState(map);
    step(state, map, order('burn', 1));
    expect(state.fuses).toEqual([{ path: 1, from: 1, seat: 'a', burns: 1 + BURN_FUSE }]);
    expect(state.events).toContainEqual({ kind: 'light', path: 1, from: 1, seat: 'a' });
    run(state, map, BURN_FUSE);
    expect(state.events).toContainEqual({ kind: 'burn', path: 1, seat: 'a', dead: 0 });
    expect(state.closed[1]).toBe(1 + BURN_FUSE + BURN_TICKS - 1);
  });

  it('with both twists offers a bridge fire, not a cut, on a bridge', () => {
    const both: Rules = { ...CLASSIC, twists: ['buildings', 'walls'] };
    const map = ground(both, 'bridge');
    const state = newState(map);
    expect(burnCost(state, map, 1, 2)).toBe(BURN_COST);
    expect(pathSpots(map, state, 1, 17).filter((spot) => spot.to === 2).map((spot) => spot.kind)).toEqual(['burn', 'wall']);
  });

  it('costs the tuned price and is not started by a hut that cannot pay', () => {
    const tuned = { ...ground(), rules: { ...WALLS, tune: { ...CLASSIC.tune, cutCost: 25 } } };
    expect(cutCost(newState(tuned), tuned, 1, 2)).toBe(25);
    const map = ground();
    const poor = newState(map);
    poor.huts[1].n = CUT_COST - 1;
    step(poor, map, order('cut', 1));
    expect(poor.fuses).toEqual([]);
    expect(poor.huts[1].n).toBe(CUT_COST - 1);
  });

  it('closes BURN_FUSE ticks after it is started, with everything on it, for CUT_TICKS, and cannot be cut again for CUT_TICKS more', () => {
    const map = ground();
    const state = newState(map);
    step(state, map, order('cut', 1));
    expect(state.huts[1].n).toBe(30 - CUT_COST);
    expect(state.fuses).toEqual([{ path: 1, from: 1, seat: 'a', burns: 1 + BURN_FUSE, cut: true }]);
    expect(state.events).toContainEqual({ kind: 'light', path: 1, from: 1, seat: 'a', cut: true });
    expect(cutCost(state, map, 1, 2)).toBeNull();
    const length = pathLength(map, 1, 2);
    for (const d of [0, 20, length / 2]) put(state, 'b', 2, 1, d);
    run(state, map, BURN_FUSE - 1);
    expect(closedOn(state, state.tick)).toBeUndefined();
    expect(state.units.length).toBe(3);
    step(state, map, {});
    expect(state.events).toContainEqual({ kind: 'burn', path: 1, seat: 'a', dead: 3, cut: true });
    expect(state.units).toEqual([]);
    const down = state.tick;
    expect(closedOn(state, down + CUT_TICKS - 1)!.paths.has(1)).toBe(true);
    expect(closedOn(state, down + CUT_TICKS)).toBeUndefined();
    run(state, map, 2 * CUT_TICKS - 1);
    expect(cutCost(state, map, 1, 2)).toBeNull();
    run(state, map, 1);
    expect(cutCost(state, map, 1, 2)).toBe(CUT_COST);
  });

  it('stays closed for the tuned time', () => {
    const map = { ...ground(), rules: { ...WALLS, tune: { ...CLASSIC.tune, cutTicks: 100 } } };
    const state = newState(map);
    step(state, map, order('cut', 1));
    run(state, map, BURN_FUSE);
    expect(state.closed[1]).toBe(state.tick + 100 - 1);
  });

  it('stops when the hut it was started from is taken', () => {
    const map = ground();
    const state = newState(map);
    step(state, map, order('cut', 1));
    state.huts[1].owner = 'b';
    step(state, map, {});
    expect(state.fuses).toEqual([]);
    expect(state.events).toContainEqual({ kind: 'doused', path: 1, seat: 'a', cut: true });
    run(state, map, BURN_FUSE);
    expect(state.closed[1]).toBe(0);
  });

  it('is called out to the sides that did not start it, as a cut and not a fire', () => {
    const map = ground();
    const before = newState(map);
    const after = newState(map);
    step(after, map, order('cut', 1));
    expect(calloutsFor(before, after, map, 'b', false)).toContain('pathCut');
    expect(calloutsFor(before, after, map, 'b', false)).not.toContain('bridgeAlight');
    expect(calloutsFor(before, after, map, 'a', false)).not.toContain('pathCut');
  });
});

describe('a wall', () => {
  it('can only be built with the walls twist, from a hut someone holds, and costs WALL_COST', () => {
    expect(wallCost(newState(ground(CLASSIC)), ground(CLASSIC), 1, 2)).toBeNull();
    expect(wallCost(newState(ground()), ground(), 1, 3)).toBeNull();
    const map = ground();
    const state = newState(map);
    expect(wallCost(state, map, 1, 2)).toBe(WALL_COST);
    step(state, map, order('wall', 1));
    expect(state.walls).toEqual([{ path: 1, seat: 'a', hp: WALL_HP }]);
    expect(state.huts[1].n).toBe(30 - WALL_COST);
    expect(state.events).toContainEqual({ kind: 'wall', path: 1, seat: 'a' });
    const poor = newState(map);
    poor.huts[1].n = WALL_COST - 1;
    step(poor, map, order('wall', 1));
    expect(poor.walls).toEqual([]);
  });

  it('kills each unit of another side that reaches its middle, whichever way it walks, one off it for each', () => {
    const map = ground();
    const state = newState(map);
    step(state, map, order('wall', 1));
    const middle = pathLength(map, 1, 2) / 2;
    const coming = put(state, 'b', 2, 1, middle - 1);
    const going = put(state, 'b', 1, 2, middle - 1);
    step(state, map, {});
    expect(state.units).not.toContain(coming);
    expect(state.units).not.toContain(going);
    expect(state.walls[0].hp).toBe(WALL_HP - 2);
    expect(state.events.filter((e) => e.kind === 'wallHit')).toEqual([
      { kind: 'wallHit', path: 1, seat: 'b', hp: WALL_HP - 1 },
      { kind: 'wallHit', path: 1, seat: 'b', hp: WALL_HP - 2 },
    ]);
  });

  it('lets its own side through, what has not reached it yet, and what was past it when it went up', () => {
    const map = ground();
    const state = newState(map);
    const middle = pathLength(map, 1, 2) / 2;
    const past = put(state, 'b', 2, 1, middle + 5);
    step(state, map, order('wall', 1));
    const own = put(state, 'a', 1, 2, middle - 1);
    const far = put(state, 'b', 2, 1, 10);
    run(state, map, 3);
    expect(state.units).toContain(own);
    expect(state.units).toContain(far);
    expect(state.units).toContain(past);
    expect(state.walls[0].hp).toBe(WALL_HP);
  });

  it('falls when it has stopped its last, and lets the next one by', () => {
    const map = { ...ground(), rules: { ...WALLS, tune: { ...CLASSIC.tune, wallHp: 5 } } };
    const state = newState(map);
    step(state, map, order('wall', 1));
    expect(state.walls[0].hp).toBe(5);
    const middle = pathLength(map, 1, 2) / 2;
    const stopped = [1, 2, 3, 4, 5].map(() => put(state, 'b', 2, 1, middle - 1));
    step(state, map, {});
    for (const unit of stopped) expect(state.units).not.toContain(unit);
    expect(state.walls).toEqual([]);
    const next = put(state, 'b', 2, 1, middle - 1);
    step(state, map, {});
    expect(state.units).toContain(next);
  });

  it('is one to a path, not built on a closed path, and goes down with a cut', () => {
    const map = ground();
    const state = newState(map);
    step(state, map, order('wall', 1));
    expect(wallCost(state, map, 1, 2)).toBeNull();
    expect(wallCost(state, map, 2, 1)).toBeNull();
    step(state, map, { b: [{ tick: 2, kind: 'cut', from: 2, to: 1 }] });
    run(state, map, BURN_FUSE);
    expect(state.walls).toEqual([]);
    expect(state.closed[1]).toBeGreaterThanOrEqual(state.tick);
    expect(wallCost(state, map, 1, 2)).toBeNull();
    const n = state.huts[1].n;
    step(state, map, order('wall', state.tick + 1));
    expect(state.walls).toEqual([]);
    expect(state.huts[1].n).toBeGreaterThanOrEqual(n);
  });

  it(`stands at most ${WALLS_MOST} to a side`, () => {
    // a's hut in the middle with a path to each of five of b's.
    const sites = [hut(500, 'a', 200), ...[0, 1, 2, 3, 4].map((k) => hut(100 + k * 200, 'b', 5, 600))];
    const map = mapOf(sites, [1, 2, 3, 4, 5].map((to) => [0, to, 'road'] as [number, number, PathKind]));
    const state = newState(map);
    step(state, map, { a: [1, 2, 3, 4].map((to) => ({ tick: 1, kind: 'wall' as const, from: 0, to })) });
    expect(state.walls.map((wall) => wall.path)).toEqual([0, 1, 2]);
    expect(state.huts[0].n).toBe(200 - WALLS_MOST * WALL_COST);
    expect(wallCost(state, map, 0, 5)).toBeNull();
    // b may still build one of its own.
    expect(wallCost(state, map, 5, 0)).toBe(WALL_COST);
  });

  it('is copied with the state, and the copy shares nothing with it', () => {
    const map = ground();
    const state = newState(map);
    step(state, map, order('wall', 1));
    const copy = cloneState(state);
    expect(copy.walls).toEqual(state.walls);
    copy.walls[0].hp = 1;
    copy.walls.push({ path: 0, seat: 'a', hp: 3 });
    expect(state.walls).toEqual([{ path: 1, seat: 'a', hp: WALL_HP }]);
  });
});

describe('the computer with the walls twist', () => {
  const coming = (n: number, rules: Rules = WALLS, garrison = 30) => {
    const map = ground(rules);
    const state = newState(map);
    state.huts[1].n = garrison;
    for (let k = 0; k < n; k++) put(state, 'b', 2, 1, k * 4);
    return { map, state, orders: cpuOrders(state, map, 'a') };
  };

  it('walls a path when the wall stops WALL_GAIN more than it costs, and not for fewer', () => {
    expect(coming(12).orders.filter((o) => o.kind === 'wall')).toEqual([]);
    expect(coming(13).orders.filter((o) => o.kind === 'wall')).toEqual([{ tick: 1, kind: 'wall', from: 1, to: 2 }]);
    expect(coming(13, CLASSIC).orders.filter((o) => o.kind === 'wall')).toEqual([]);
  });

  it('cuts a path only when what is on it would otherwise take the hut', () => {
    expect(coming(30, WALLS, 20).orders.filter((o) => o.kind === 'cut')).toEqual([{ tick: 1, kind: 'cut', from: 1, to: 2 }]);
    expect(coming(30, CLASSIC, 20).orders.filter((o) => o.kind === 'cut')).toEqual([]);
    expect(coming(10, WALLS, 60).orders.filter((o) => o.kind === 'cut')).toEqual([]);
  });

  it('holds its hut with a wall it would have lost without one', () => {
    const play = (rules: Rules) => {
      const { map, state } = coming(24, rules, 18);
      // Nothing to send to its help.
      state.huts[0].n = 0;
      for (let t = 0; t < 200; t++) step(state, map, {}, { a: 0 });
      return state.huts[1].owner;
    };
    expect(play(CLASSIC)).toBe('b');
    expect(play(WALLS)).toBe('a');
  });
});

describe('the walls twist between two clients', () => {
  it('a game the computer plays on both sides ends the same run straight, run in pieces with predictions, and with the orders sent over the wire', () => {
    const map = buildMap(1, 'meadow', ['a', 'b'], undefined, WALLS);
    // One client decides each seat's orders as a person would give them, and runs them as it goes.
    const whole = newState(map);
    const given: Record<'a' | 'b', Order[]> = { a: [], b: [] };
    const seen = new Set<string>();
    while (whole.tick < 3000 && whole.winner === null) {
      for (const seat of ['a', 'b'] as const) if (thinksAt(map, seat, whole.tick)) given[seat].push(...cpuOrders(whole, map, seat));
      step(whole, map, given);
      for (const e of whole.events) if (e.kind === 'wall' || e.kind === 'wallHit' || (e.kind === 'burn' && e.cut)) seen.add(e.kind);
    }
    // Equal boards say nothing unless walls went up and were walked into, and a path was cut.
    expect([...seen].sort()).toEqual(['burn', 'wall', 'wallHit']);

    // The other is sent nothing but the orders as text, and runs in pieces with a prediction cloned off each.
    const sent = { a: decodeOrders(encodeOrders(given.a)), b: decodeOrders(encodeOrders(given.b)) };
    const pieces = newState(map);
    for (let to = 41; to < whole.tick; to += 41) {
      while (pieces.tick < to) step(pieces, map, sent);
      const predicted = cloneState(pieces);
      for (let t = 0; t < 60; t++) step(predicted, map, sent);
    }
    while (pieces.tick < whole.tick) step(pieces, map, sent);
    expect(JSON.stringify(pieces)).toBe(JSON.stringify(whole));
  });

  it('carries cut and wall orders over the wire', () => {
    const orders: Order[] = [
      { tick: 1, kind: 'cut', from: 3, to: 7 },
      { tick: 4000, kind: 'wall', from: 7, to: 3 },
    ];
    expect(encodeOrders(orders)).toMatch(/:j.*:q/);
    expect(decodeOrders(encodeOrders(orders))).toEqual(orders);
  });
});

describe('the tokens on the board', () => {
  it('put a lone bridge fire where it has always been, and a wall beyond the cut on a long path', () => {
    const both: Rules = { ...CLASSIC, twists: ['buildings', 'walls'] };
    const map = ground(both, 'bridge');
    const state = newState(map);
    const length = pathLength(map, 1, 2);
    const [burn, wall] = pathSpots(map, state, 1, 17).filter((spot) => spot.to === 2);
    const old = pathPoint(map, 1, 2, Math.min(0.4, 70 / length));
    expect(burn.x).toBeCloseTo(old.x);
    expect(burn.y).toBeCloseTo(old.y);
    expect(Math.hypot(wall.x - burn.x, wall.y - burn.y)).toBeCloseTo(2.2 * 17);
  });

  it('stand side by side on a path too short for two in a line, and none are offered for what cannot be done', () => {
    const map = mapOf([hut(450, 'a', 30), hut(550, 'b', 30)], [[0, 1, 'road']]);
    const state = newState(map);
    const [cut, wall] = pathSpots(map, state, 0, 17);
    expect([cut.kind, wall.kind]).toEqual(['cut', 'wall']);
    expect(cut.y).not.toBeCloseTo(wall.y);
    expect(Math.hypot(wall.x - cut.x, wall.y - cut.y)).toBeCloseTo(2.2 * 17);
    expect(pathSpots(ground(CLASSIC), newState(ground(CLASSIC)), 1, 17)).toEqual([]);
  });
});
