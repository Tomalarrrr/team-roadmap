import { describe, it, expect } from 'vitest';
import {
  MATCH_TICKS,
  TOWER_RANGE,
  TOWER_RELOAD,
  TOWER_START,
  WORLD_H,
  WORLD_W,
  advance,
  buildMap,
  cloneState,
  countOf,
  cpuOrders,
  decodeOrders,
  encodeOrders,
  newState,
  nextHop,
  sendSize,
  step,
  upgradeCost,
  type Order,
  type Owner,
  type Seat,
  type Shot,
  type SwarmMap,
  type SwarmState,
} from '../swarmGameLogic';

const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 98765, 4242424, 0xdeadbeef];
// With two towers a side, three and four.
const TOWER_SEEDS = [6, 11, 7];
const towersOf = (map: SwarmMap) => map.sites.flatMap((site, index) => (site.tower ? [index] : []));

// Two huts 60 apart: ten ticks' walk at the starting speed.
function duel(targetOwner: Owner, targetN: number, sourceN = 5): { map: SwarmMap; state: SwarmState } {
  const map: SwarmMap = {
    sites: [
      { x: 100, y: 100, owner: 'a', n: sourceN, level: 1 },
      { x: 160, y: 100, owner: targetOwner, n: targetN, level: 1 },
    ],
    links: [[1], [0]],
  };
  // A match with no hut and no unit on one side is over, so a neutral target
  // comes with a hut for b off on its own.
  if (targetOwner !== 'b') {
    map.sites.push({ x: 900, y: 500, owner: 'b', n: 5, level: 1 });
    map.links.push([]);
  }
  return { map, state: newState(map) };
}

const none = (): Record<Seat, Order[]> => ({ a: [], b: [] });
const run = (state: SwarmState, map: SwarmMap, orders: Record<Seat, Order[]>, to: number) =>
  advance(state, map, orders, to, null);

describe('maps', () => {
  it.each([...SEEDS, ...TOWER_SEEDS])('seed %i gives every hut a twin at the half-turn', (seed) => {
    const { sites, links } = buildMap(seed);
    expect(sites.length).toBeGreaterThanOrEqual(8);
    expect(sites[0].owner).toBe('a');
    expect(sites[1].owner).toBe('b');
    const twinOf = (i: number) =>
      sites.findIndex((s) => s.x === WORLD_W - sites[i].x && s.y === WORLD_H - sites[i].y);
    sites.forEach((site, i) => {
      const twin = twinOf(i);
      expect(twin).not.toBe(-1);
      expect(sites[twin].n).toBe(site.n);
      expect(sites[twin].level).toBe(site.level);
      expect(sites[twin].tower).toBe(site.tower);
      expect(links[twin].slice().sort()).toEqual(links[i].map(twinOf).sort());
    });
  });

  it.each([...SEEDS, ...TOWER_SEEDS])('seed %i joins every hut to every other by some route', (seed) => {
    const { sites, links } = buildMap(seed);
    const seen = new Set([0]);
    const queue = [0];
    for (let head = 0; head < queue.length; head++) {
      for (const next of links[queue[head]]) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    expect(seen.size).toBe(sites.length);
  });

  it('is the same map for the same seed, and a different one for another', () => {
    expect(buildMap(42)).toEqual(buildMap(42));
    expect(buildMap(42)).not.toEqual(buildMap(43));
  });

  it('stands a column of two to four neutral towers before each side on about half the seeds', () => {
    expect(TOWER_SEEDS.map((seed) => towersOf(buildMap(seed)).length)).toEqual([4, 6, 8]);
    expect(SEEDS.filter((seed) => towersOf(buildMap(seed)).length > 0)).toEqual([1, 7, 42, 99, 1234, 0xdeadbeef]);
    const byCount = [0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 400; seed++) {
      const map = buildMap(seed);
      const towers = towersOf(map);
      byCount[towers.length / 2]++;
      for (const index of towers) expect(map.sites[index]).toMatchObject({ owner: null, n: TOWER_START, level: 1 });
    }
    expect(byCount[0]).toBeGreaterThan(160);
    expect(byCount[0]).toBeLessThan(240);
    expect(byCount[1]).toBe(0);
    for (const count of byCount.slice(2)) expect(count).toBeGreaterThan(40);
  });

  it.each(TOWER_SEEDS)('seed %i: the towers stand evenly down x=400 and x=600, each facing one straight across', (seed) => {
    const map = buildMap(seed);
    expect(buildMap(seed)).toEqual(map);
    const column = (x: number) => map.sites.filter((s) => s.tower && s.x === x).map((s) => s.y).sort((p, q) => p - q);
    const left = column(400);
    expect(left.length).toBe(towersOf(map).length / 2);
    expect(column(600)).toEqual(left);
    const gaps = left.slice(1).map((y, k) => y - left[k]);
    expect(new Set(gaps).size).toBe(1);
    expect(left[0] + left[left.length - 1]).toBe(WORLD_H);
    // The margin above the first is a gap too, to within the rounding.
    expect(left[0]).toBeGreaterThanOrEqual(gaps[0]);
    expect(left[0]).toBeLessThan(gaps[0] + 4);
  });

  it.each(TOWER_SEEDS)('seed %i: the only paths over the middle join a tower to the one facing it, and the way across takes one', (seed) => {
    const map = buildMap(seed);
    const side = (index: number) => Math.sign(map.sites[index].x - WORLD_W / 2);
    for (const index of towersOf(map)) {
      const over = map.links[index].filter((j) => side(j) !== side(index));
      expect(over.map((j) => map.sites[j])).toEqual([{ ...map.sites[index], x: WORLD_W - map.sites[index].x }]);
    }
    const route = [0];
    while (route[route.length - 1] !== 1) route.push(nextHop(map, route[route.length - 1], 1));
    expect(route.filter((index) => map.sites[index].tower).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every hut of a tower map behind its own towers, out of their range, and off the paths over the middle', () => {
    let huts = 0;
    let nearest = Infinity;
    for (let seed = 1; seed <= 200; seed++) {
      const { sites, links } = buildMap(seed);
      const towers = sites.filter((s) => s.tower);
      if (towers.length === 0) continue;
      sites.forEach((hut, index) => {
        if (hut.tower) return;
        huts++;
        expect(Math.abs(hut.x - WORLD_W / 2)).toBeGreaterThan(100);
        expect(links[index].filter((j) => (sites[j].x - WORLD_W / 2) * (hut.x - WORLD_W / 2) < 0)).toEqual([]);
        for (const t of towers) nearest = Math.min(nearest, (hut.x - t.x) ** 2 + (hut.y - t.y) ** 2);
      });
    }
    expect(huts).toBeGreaterThan(600);
    // Nearer a tower than the 150 two huts keep between them, but never inside its range.
    expect(nearest).toBeGreaterThanOrEqual(TOWER_RANGE * TOWER_RANGE);
    expect(nearest).toBeLessThan(150 * 150);
  });

  it('still joins the two sides directly on a map with no tower', () => {
    const map = buildMap(2);
    expect(towersOf(map)).toEqual([]);
    const crossing = map.links.flatMap((linked, i) =>
      linked.filter((j) => (map.sites[i].x - WORLD_W / 2) * (map.sites[j].x - WORLD_W / 2) < 0)
    );
    expect(crossing.length).toBeGreaterThan(0);
  });
});

describe('orders on the wire', () => {
  it('come back as they went', () => {
    const orders: Order[] = [
      { tick: 4, kind: 'half', from: 0, to: 3 },
      { tick: 4, kind: 'all', from: 12, to: 10 },
      { tick: 5999, kind: 'hut', from: 7, to: 7 },
      { tick: 36, kind: 'speed', from: 1, to: 1 },
      { tick: 1300, kind: 'strength', from: 11, to: 11 },
    ];
    expect(encodeOrders(orders)).toBe('4:h03,4:aca,4mn:u77,10:v11,104:pbb');
    expect(decodeOrders(encodeOrders(orders))).toEqual(orders);
    expect(decodeOrders('')).toEqual([]);
  });
});

describe('sending and fighting', () => {
  it('five sent at a hut of nine all die and leave it four', () => {
    const { map, state } = duel(null, 9);
    run(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 30);
    expect(state.huts[1]).toMatchObject({ owner: null, n: 4 });
    expect(state.units).toEqual([]);
  });

  it('a hut falls to one more than it holds, and starts again from one', () => {
    const { map, state } = duel(null, 4);
    const captures: number[] = [];
    advance(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 19, null, (s) => {
      if (s.events.some((e) => e.kind === 'capture')) captures.push(s.tick);
    });
    // Five leave on ticks 2 to 10, two ticks apart, and walk ten ticks each.
    expect(captures).toEqual([19]);
    expect(state.huts[1]).toMatchObject({ owner: 'a', n: 1 });
  });

  it('exactly as many as it holds empty the hut without taking it', () => {
    const { map, state } = duel(null, 5);
    run(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 30);
    expect(state.huts[1]).toMatchObject({ owner: null, n: 0 });
  });

  it('half rounds up, and counts only what is not already leaving', () => {
    const { map, state } = duel(null, 9, 7);
    expect(sendSize(state.huts[0], 'half')).toBe(4);
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 0, to: 1 }], b: [] });
    expect(state.huts[0].out).toEqual([{ to: 1, dest: 1, n: 4 }]);
    expect(sendSize(state.huts[0], 'half')).toBe(2);
    expect(sendSize(state.huts[0], 'all')).toBe(3);
  });

  it('leaves the hut one at a time, every other tick', () => {
    const { map, state } = duel(null, 9);
    const orders = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 1 }], b: [] };
    run(state, map, orders, 1);
    expect(state.units.length).toBe(0);
    run(state, map, orders, 2);
    expect(state.units.length).toBe(1);
    run(state, map, orders, 6);
    expect(state.units.length).toBe(3);
    expect(state.huts[0].n).toBe(2);
  });

  it('ignores a send to a hut no path leads to', () => {
    const { map, state } = duel('b', 9);
    map.links = [[], []];
    run(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 4);
    expect(state.units).toEqual([]);
    expect(state.huts[0].out).toEqual([]);
  });

  it('ignores an order for a hut that is not yours, and a send to itself', () => {
    const { map, state } = duel('b', 9);
    run(state, map, { a: [{ tick: 1, kind: 'all', from: 1, to: 0 }, { tick: 1, kind: 'all', from: 0, to: 0 }], b: [] }, 4);
    expect(state.units).toEqual([]);
    expect(state.huts.map((h) => h.out)).toEqual([[], []]);
  });

  it('columns that meet on a path kill each other one for one', () => {
    const { map, state } = duel('b', 5);
    const orders = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 1 }], b: [{ tick: 1, kind: 'all' as const, from: 1, to: 0 }] };
    let clashes = 0;
    advance(state, map, orders, 40, null, (s) => {
      clashes += s.events.filter((e) => e.kind === 'clash').length;
    });
    expect(clashes).toBe(5);
    expect(state.units).toEqual([]);
    // Nothing reached either hut: each holds only what it bred in forty ticks.
    expect(state.huts.map((h) => [h.owner, h.n])).toEqual([['a', 4], ['b', 4]]);
  });

  it('a stronger army spends fewer units on the same hut', () => {
    const plain = duel(null, 9);
    const strong = duel(null, 9);
    strong.state.army.a.strength = 3;
    const orders = () => ({ a: [{ tick: 1, kind: 'all' as const, from: 0, to: 1 }], b: [] });
    run(plain.state, plain.map, orders(), 30);
    run(strong.state, strong.map, orders(), 30);
    expect(plain.state.huts[1].n).toBe(4);
    expect(strong.state.huts[1].n).toBe(0);
  });

  it('a faster army gets there sooner', () => {
    const { map, state } = duel(null, 9);
    state.army.a.speed = 3;
    const hits: number[] = [];
    advance(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 12, null, (s) => {
      if (s.events.some((e) => e.kind === 'hit')) hits.push(s.tick);
    });
    // Out on tick 2, then five ticks at 12 a tick to cover 60.
    expect(hits[0]).toBe(6);
  });
});

// Four huts in a row, 60 apart, with a's at the left end and b's at the right.
function row(owners: Owner[], counts: number[]): { map: SwarmMap; state: SwarmState } {
  const map: SwarmMap = {
    sites: owners.map((owner, i) => ({ x: 100 + i * 60, y: 100, owner, n: counts[i], level: 1 })),
    links: owners.map((_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < owners.length)),
  };
  return { map, state: newState(map) };
}

describe('a march of more than one path', () => {
  it('takes the shortest way by the paths there are', () => {
    const map: SwarmMap = {
      sites: [
        { x: 100, y: 100, owner: 'a', n: 5, level: 1 },
        { x: 400, y: 100, owner: 'b', n: 5, level: 1 },
        { x: 250, y: 110, owner: null, n: 5, level: 1 },
        { x: 250, y: 500, owner: null, n: 5, level: 1 },
      ],
      links: [[2, 3], [2, 3], [0, 1], [0, 1]],
    };
    expect(nextHop(map, 0, 1)).toBe(2);
    expect(nextHop(map, 1, 0)).toBe(2);
    expect(nextHop(map, 0, 3)).toBe(3);
  });

  it('walks through huts of its own without stopping in them', () => {
    const { map, state } = row(['a', 'a', 'a', 'b'], [6, 0, 0, 40]);
    const orders = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 2 }], b: [] };
    run(state, map, orders, 12);
    // The first out is one tick into its second path, and hut 1 kept nobody.
    expect(state.units[0]).toMatchObject({ from: 1, to: 2, dest: 2, d: 6 });
    run(state, map, orders, 34);
    expect(state.units).toEqual([]);
    // Six arrived, and each of the two empty huts bred three in the meantime.
    expect(state.huts.map((h) => h.n).slice(0, 3)).toEqual([3, 3, 9]);
  });

  it('fights a hut that stands in the way, and the rest carry on once it is taken', () => {
    const { map, state } = row(['a', null, null, 'b'], [10, 3, 2, 40]);
    const taken: number[] = [];
    advance(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 2 }], b: [] }, 60, null, (s) => {
      for (const e of s.events) if (e.kind === 'capture') taken.push(e.hut);
    });
    expect(taken).toEqual([1, 2]);
    expect(state.huts[2].owner).toBe('a');
    expect(state.units).toEqual([]);
  });
});

describe('breeding and upgrades', () => {
  it('a held hut breeds one every ten ticks and stops at its cap; a neutral one never does', () => {
    const { map, state } = duel(null, 9, 28);
    run(state, map, none(), 100);
    expect(state.huts[0].n).toBe(30);
    expect(state.huts[1].n).toBe(9);
  });

  it('growing a hut is paid from it and makes it breed faster', () => {
    const { map, state } = duel(null, 9, 15);
    expect(upgradeCost(state, 0, 'hut')).toBe(15);
    run(state, map, { a: [{ tick: 1, kind: 'hut', from: 0, to: 0 }], b: [] }, 70);
    expect(state.huts[0].level).toBe(2);
    // Seventy ticks at one every seven.
    expect(state.huts[0].n).toBe(10);
  });

  it('refuses an upgrade the hut cannot pay for', () => {
    const { map, state } = duel(null, 9, 19);
    step(state, map, { a: [{ tick: 1, kind: 'speed', from: 0, to: 0 }], b: [] });
    expect(state.army.a.speed).toBe(0);
    expect(state.huts[0].n).toBe(19);
  });

  it('an army upgrade is for the whole side and has a top level', () => {
    const { map, state } = duel(null, 9, 20);
    step(state, map, { a: [{ tick: 1, kind: 'speed', from: 0, to: 0 }], b: [] });
    expect(state.army).toMatchObject({ a: { speed: 1 }, b: { speed: 0 } });
    expect(state.huts[0].n).toBe(0);
    expect(upgradeCost(state, 0, 'speed')).toBe(35);
    state.army.a.speed = 3;
    expect(upgradeCost(state, 0, 'speed')).toBeNull();
  });
});

// A tower 240 from a's hut along one path, and a hut for b off on its own.
function siege(towerOwner: Owner, towerN: number, sourceN: number): { map: SwarmMap; state: SwarmState } {
  const map: SwarmMap = {
    sites: [
      { x: 100, y: 100, owner: 'a', n: sourceN, level: 1 },
      { x: 340, y: 100, owner: towerOwner, n: towerN, level: 1, tower: true },
      { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
    ],
    links: [[1], [0], []],
  };
  return { map, state: newState(map) };
}

// A path of 400 between two huts of a's, and a tower `off` to the side of its
// middle, joined to the first hut.
function bypass(towerOwner: Owner, off = 60): { map: SwarmMap; state: SwarmState } {
  const map: SwarmMap = {
    sites: [
      { x: 100, y: 100, owner: 'a', n: 12, level: 1 },
      { x: 500, y: 100, owner: 'a', n: 0, level: 1 },
      { x: 300, y: 100 + off, owner: towerOwner, n: 10, level: 1, tower: true },
      { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
    ],
    links: [[1, 2], [0], [0], []],
  };
  return { map, state: newState(map) };
}

function shotsOver(
  state: SwarmState,
  map: SwarmMap,
  orders: Record<Seat, Order[]>,
  to: number,
  cpu: Seat | null = null
): (Shot & { tick: number })[] {
  const shots: (Shot & { tick: number })[] = [];
  advance(state, map, orders, to, cpu, (s) => {
    for (const shot of s.shots) shots.push({ ...shot, tick: s.tick });
  });
  return shots;
}

const walker = (id: number, d: number) => ({ id, seat: 'a' as const, from: 0, to: 1, dest: 1, d });

describe('towers', () => {
  it('a neutral tower leaves alone a column that walks past it', () => {
    const { map, state } = bypass(null);
    const shots = shotsOver(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 120);
    expect(shots).toEqual([]);
    // Twelve walked in, and each hut bred twelve in the meantime.
    expect(state.huts.map((h) => h.n).slice(0, 2)).toEqual([12, 24]);
  });

  it('a neutral tower shoots the column sent at it', () => {
    const { map, state } = bypass(null);
    const shots = shotsOver(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 2 }], b: [] }, 120);
    expect(shots.length).toBe(7);
    // The path is 208 long; 102 along it is the first step inside the range.
    expect(shots[0]).toEqual({ tower: 2, x: 198, y: 129, seat: 'a', tick: 18 });
    expect(new Set(shots.map((s) => `${s.tower}${s.seat}`))).toEqual(new Set(['2a']));
    expect(state.huts[2]).toMatchObject({ owner: null, n: 10 - (12 - 7) });
  });

  it("a held tower shoots the other side's column as it walks past", () => {
    const { map, state } = bypass('b');
    const shots = shotsOver(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 120);
    expect(shots.length).toBe(9);
    expect(new Set(shots.map((s) => `${s.tower}${s.seat}`))).toEqual(new Set(['2a']));
    expect(state.huts[1].n).toBe(24 - 9);
    expect(state.huts[2].n).toBe(10);
  });

  it('a held tower never shoots its own side', () => {
    const { map, state } = bypass('a');
    const shots = shotsOver(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 120);
    expect(shots).toEqual([]);
    expect(state.huts[1].n).toBe(24);
  });

  it('keeps its shot until a unit comes in range, then fires once every reload', () => {
    const { map, state } = siege(null, 40, 30);
    const shots = shotsOver(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 60);
    // Out on tick 2 and six a tick from then: 132 along, 108 short of the tower, on tick 23.
    expect(shots[0]).toEqual({ tower: 1, x: 232, y: 100, seat: 'a', tick: 23 });
    expect(shots.map((s) => s.tick)).toEqual([23, 29, 35, 41, 47, 53, 59]);
    expect(TOWER_RELOAD).toBe(6);
  });

  it('reaches a unit exactly at its range and not one step beyond', () => {
    const { map, state } = bypass('b', TOWER_RANGE);
    state.units = [walker(1, 188)];
    step(state, map, none());
    // Six short of the foot of the tower: 110 off and 6 along.
    expect(state.shots).toEqual([]);
    expect(state.units).toEqual([walker(1, 194)]);
    step(state, map, none());
    expect(state.shots).toEqual([{ tower: 2, x: 300, y: 100, seat: 'a' }]);
    expect(state.units).toEqual([]);
    step(state, map, none());
    expect(state.shots).toEqual([]);
  });

  it('cannot reach a path that passes one unit outside its range', () => {
    const { map, state } = bypass('b', TOWER_RANGE + 1);
    state.units = [walker(1, 188)];
    const shots = shotsOver(state, map, none(), 10);
    expect(shots).toEqual([]);
    expect(state.units).toEqual([walker(1, 248)]);
  });

  it('shoots the nearest unit in range', () => {
    const { map, state } = bypass('b');
    state.units = [walker(1, 150), walker(2, 188), walker(3, 230)];
    step(state, map, none());
    expect(state.units.map((u) => u.id)).toEqual([1, 3]);
  });

  it('shoots the lower id of two as near', () => {
    const { map, state } = bypass('b');
    state.units = [walker(1, 206), walker(2, 182)];
    step(state, map, none());
    expect(state.shots).toEqual([{ tower: 2, x: 312, y: 100, seat: 'a' }]);
    expect(state.units.map((u) => u.id)).toEqual([2]);
  });

  it('never breeds, held or not', () => {
    const held = siege('a', 3, 5);
    run(held.state, held.map, none(), 100);
    expect(held.state.huts.map((h) => h.n)).toEqual([15, 3, 15]);
    const neutral = siege(null, 3, 5);
    run(neutral.state, neutral.map, none(), 100);
    expect(neutral.state.huts[1].n).toBe(3);
  });

  it('sells no upgrade, of itself or of the army', () => {
    const { map, state } = siege('a', 60, 60);
    expect(upgradeCost(state, 0, 'speed')).toBe(20);
    expect((['hut', 'speed', 'strength'] as const).map((kind) => upgradeCost(state, 1, kind))).toEqual([null, null, null]);
    step(state, map, { a: [{ tick: 1, kind: 'hut', from: 1, to: 1 }, { tick: 1, kind: 'speed', from: 1, to: 1 }], b: [] });
    expect(state.huts[1]).toMatchObject({ n: 60, level: 1 });
    expect(state.army.a.speed).toBe(0);
  });

  it('falls like a hut to a column that outlasts its garrison and its shots, and starts again from one', () => {
    const { map, state } = siege(null, TOWER_START, 21);
    const captures: number[] = [];
    let shots = 0;
    advance(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 120, null, (s) => {
      for (const e of s.events) if (e.kind === 'capture') captures.push(e.hut);
      shots += s.shots.length;
    });
    expect(captures).toEqual([1]);
    expect(shots).toBe(21 - TOWER_START - 1);
    expect(state.huts[1]).toMatchObject({ owner: 'a', n: 1 });
  });

  it('holds against one unit fewer', () => {
    const { map, state } = siege(null, TOWER_START, 21 - 1);
    run(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 120);
    expect(state.huts[1]).toMatchObject({ owner: null, n: 0 });
    expect(state.units).toEqual([]);
  });

  it('lets a column of its own side through, and sends out what it holds', () => {
    const { map } = row(['a', 'a', 'a', 'b'], [6, 4, 0, 40]);
    map.sites[1].tower = true;
    const state = newState(map);
    const orders = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 2 }, { tick: 1, kind: 'all' as const, from: 1, to: 2 }], b: [] };
    run(state, map, orders, 12);
    expect(state.units.find((u) => u.id === 1)).toMatchObject({ from: 1, to: 2, dest: 2, d: 6 });
    run(state, map, orders, 34);
    expect(state.units).toEqual([]);
    // Six through it and its own four, on top of the three the hut bred; the tower bred none.
    expect(state.huts.map((h) => h.n).slice(0, 3)).toEqual([3, 0, 13]);
    expect(state.huts[1].owner).toBe('a');
  });

  it('still shoots when it holds nobody, and falls to the first unit to reach it', () => {
    const { map, state } = siege('b', 0, 6);
    const captures: number[] = [];
    const shots: number[] = [];
    advance(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 60, null, (s) => {
      if (s.events.some((e) => e.kind === 'capture')) captures.push(s.tick);
      if (s.shots.length > 0) shots.push(s.tick);
    });
    // One leaves every two ticks and one is shot every six, so the sixth is the first to walk in.
    expect(shots).toEqual([23, 29, 35, 41, 47]);
    expect(captures).toEqual([51]);
    expect(state.huts[1]).toMatchObject({ owner: 'a', n: 1 });
  });

  it('is cloned with its reload, and the clone runs on alone', () => {
    const { map, state } = siege(null, 40, 30);
    const orders = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 1 }], b: [] };
    run(state, map, orders, 29);
    expect(state.shots.length).toBe(1);
    expect(state.huts[1].reload).toBe(TOWER_RELOAD);
    const copy = cloneState(state);
    expect(copy.huts[1].reload).toBe(TOWER_RELOAD);
    expect(copy.shots).toEqual([]);
    const before = JSON.stringify(state);
    run(copy, map, orders, 60);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('how a match ends', () => {
  it('is won the tick the other side has no hut and no unit left', () => {
    const { map, state } = duel('b', 2, 12);
    run(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 200);
    expect(state.winner).toBe('a');
    expect(countOf(state, 'b')).toEqual({ huts: 0, units: 0 });
    expect(state.tick).toBeLessThan(40);
  });

  it('a tower is not a hut: a side left with an empty one has lost', () => {
    const { map } = siege('b', 0, 5);
    map.sites.pop();
    map.links.pop();
    const state = newState(map);
    expect(countOf(state, 'b')).toEqual({ huts: 0, units: 0 });
    step(state, map, none());
    expect(state.winner).toBe('a');
  });

  it('a side with units in a tower and no hut plays on, and loses on huts at the clock', () => {
    const { map } = siege('b', 9, 5);
    map.sites.pop();
    map.links.pop();
    const state = newState(map);
    expect(countOf(state, 'b')).toEqual({ huts: 0, units: 9 });
    step(state, map, none());
    expect(state.winner).toBeNull();
    state.tick = MATCH_TICKS - 1;
    step(state, map, none());
    expect(state.winner).toBe('a');
  });

  it('goes to the side with more units when the clock runs out level on huts', () => {
    const { map, state } = duel('b', 9);
    state.tick = MATCH_TICKS - 1;
    step(state, map, none());
    expect(state.winner).toBe('b');
  });

  it('is a draw on the clock when huts and units are level', () => {
    const { map, state } = duel('b', 5);
    state.tick = MATCH_TICKS - 1;
    step(state, map, none());
    expect(state.winner).toBe('draw');
  });

  it('is still open one tick before the clock', () => {
    const { map, state } = duel('b', 9);
    state.tick = MATCH_TICKS - 2;
    step(state, map, none());
    expect(state.winner).toBeNull();
  });
});

describe('two clients, one game', () => {
  it('a state run in pieces, with a prediction cloned off it each time, ends where a straight run does', () => {
    const map = buildMap(42);
    expect(towersOf(map).length).toBe(8);
    const orders = none();
    const straight = newState(map);
    expect(shotsOver(straight, map, orders, 900, 'b').length).toBeGreaterThan(TOWER_START);
    const a = orders.a;
    const neighbour = map.links[0][0];
    a.push({ tick: 30, kind: 'all', from: 0, to: neighbour }, { tick: 400, kind: 'half', from: 0, to: neighbour });
    const whole = newState(map);
    run(whole, map, orders, 900);

    const pieces = newState(map);
    for (let to = 37; to < 900; to += 37) {
      run(pieces, map, orders, to);
      const predicted = cloneState(pieces);
      run(predicted, map, orders, to + 50);
      expect(pieces.tick).toBe(to);
    }
    run(pieces, map, orders, 900);
    expect(JSON.stringify(pieces)).toBe(JSON.stringify(whole));
  });

  it('a clone shares nothing with the state it was taken from', () => {
    const { map, state } = duel(null, 9);
    const orders = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 1 }], b: [] };
    run(state, map, orders, 4);
    const before = JSON.stringify(state);
    run(cloneState(state), map, orders, 30);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('the computer', () => {
  it.each([...SEEDS.slice(0, 5), ...TOWER_SEEDS])('seed %i: takes huts and beats a player who never moves', (seed) => {
    const map = buildMap(seed);
    const state = newState(map);
    advance(state, map, none(), MATCH_TICKS, 'b');
    expect(state.winner).toBe('b');
    expect(state.tick).toBeLessThan(MATCH_TICKS);
  });

  it('only ever orders from its own huts along real paths', () => {
    const map = buildMap(7);
    const state = newState(map);
    const orders = none();
    advance(state, map, orders, 1500, 'b', (s) => {
      for (const order of orders.b) {
        if (order.tick !== s.tick + 1) continue;
        if (order.kind === 'half' || order.kind === 'all') expect(map.links[order.from]).toContain(order.to);
      }
    });
    expect(orders.b.length).toBeGreaterThan(10);
    expect(orders.a).toEqual([]);
  });

  it('does not march on a tower that would shoot the column down to less than its garrison', () => {
    // Twenty-four is twelve over the garrison and its margin, and twelve is what the tower shoots of
    // them, so it grows the hut and waits.
    const short = siege(null, TOWER_START, 24);
    expect(cpuOrders(short.state, short.map, 'a')).toEqual([{ tick: 1, kind: 'hut', from: 0, to: 0 }]);
    const enough = siege(null, TOWER_START, 25);
    const orders = { a: cpuOrders(enough.state, enough.map, 'a'), b: [] };
    expect(orders.a).toEqual([{ tick: 1, kind: 'all', from: 0, to: 1 }]);
    run(enough.state, enough.map, orders, 120);
    expect(enough.state.huts[1].owner).toBe('a');
  });

  it('takes the hut it can afford before the tower it cannot', () => {
    const { map } = siege(null, TOWER_START, 14);
    map.sites.push({ x: 100, y: 340, owner: null, n: 11, level: 1 });
    map.links[0].push(3);
    map.links.push([0]);
    // The tower holds one fewer, but would shoot eight of the fourteen.
    expect(cpuOrders(newState(map), map, 'a')).toEqual([{ tick: 1, kind: 'all', from: 0, to: 3 }]);
  });

  it('takes every tower of a tower map on the way to winning it', () => {
    const map = buildMap(11);
    const state = newState(map);
    advance(state, map, none(), MATCH_TICKS, 'b');
    expect(towersOf(map).map((index) => state.huts[index].owner)).toEqual(['b', 'b', 'b', 'b', 'b', 'b']);
  });
});
