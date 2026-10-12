import { describe, it, expect } from 'vitest';
import {
  CPU_THINK_TICKS,
  FIELD_TOP,
  FORT_LIVES,
  LUCK_DEN,
  MAP_IDS,
  MATCH_TICKS,
  SEATS,
  TOLL_EVERY,
  TOWER_RANGE,
  TOWER_RELOAD,
  TOWER_START,
  advance,
  buildMap,
  centreOf,
  cloneState,
  countOf,
  cpuOrders,
  decodeOrders,
  encodeOrders,
  mulberry32,
  newState,
  otherSeat,
  nextHop,
  paceOn,
  pathLength,
  pathOf,
  sendSize,
  step,
  takesToll,
  upgradeCost,
  type MapId,
  type Order,
  type Owner,
  type Path,
  type PathKind,
  type Seat,
  type Shot,
  type Site,
  type SwarmEvent,
  type SwarmMap,
  type SwarmState,
} from '../swarmGameLogic';

const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 98765, 4242424, 0xdeadbeef];
// Of the guns map, with two towers a side, three and four.
const TOWER_SEEDS = [2, 1, 7];
const towersOf = (map: SwarmMap) => map.sites.flatMap((site, index) => (site.tower ? [index] : []));

// A map of the huts and links given. Every path is a road but the ones named.
function mapOf(sites: Site[], links: number[][], named: Path[] = []): SwarmMap {
  const paths: Path[] = [];
  links.forEach((linked, a) => {
    for (const b of linked) if (a < b) paths.push(named.find((p) => p.a === a && p.b === b) ?? { a, b, kind: 'road' });
  });
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660 };
}

// Two huts 60 apart: ten ticks' walk at the starting speed.
function duel(targetOwner: Owner, targetN: number, sourceN = 5): { map: SwarmMap; state: SwarmState } {
  const sites: Site[] = [
    { x: 100, y: 100, owner: 'a', n: sourceN, level: 1 },
    { x: 160, y: 100, owner: targetOwner, n: targetN, level: 1 },
  ];
  const links = [[1], [0]];
  // A match with no hut and no unit on one side is over, so a neutral target
  // comes with a hut for b off on its own.
  if (targetOwner !== 'b') {
    sites.push({ x: 900, y: 500, owner: 'b', n: 5, level: 1 });
    links.push([]);
  }
  const map = mapOf(sites, links);
  return { map, state: newState(map) };
}

const none = (): Record<Seat, Order[]> => ({ a: [], b: [] });
const run = (state: SwarmState, map: SwarmMap, orders: Record<Seat, Order[]>, to: number) =>
  advance(state, map, orders, to, null);

const MAP_SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

type Point = { x: number; y: number };
const sideOf = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
// Touching counts as meeting, so a road that only reaches the bank is caught too.
const meet = (p: Point, q: Point, r: Point, s: Point) => sideOf(p, q, r) * sideOf(p, q, s) <= 0 && sideOf(r, s, p) * sideOf(r, s, q) <= 0;
const crossings = (map: SwarmMap, path: Path) =>
  map.rivers.flatMap((river) => river.slice(1).filter((point, k) => meet(map.sites[path.a], map.sites[path.b], river[k], point))).length;
const byNumber = (p: number, q: number) => p - q;

function routeOf(map: SwarmMap, from: number, to: number, risky: boolean): number[] {
  const route = [from];
  while (route[route.length - 1] !== to) route.push(nextHop(map, route[route.length - 1], to, risky));
  return route;
}
const kindsOn = (map: SwarmMap, route: number[]) => route.slice(1).map((hut, k) => pathOf(map, route[k], hut)?.kind);
const lengthOf = (map: SwarmMap, route: number[]) => route.slice(1).reduce((sum, hut, k) => sum + pathLength(map, route[k], hut), 0);

describe.each(MAP_IDS)('the %s map', (id) => {
  it('is the same from both ends: every hut, path and river has its twin at the half-turn', () => {
    for (const seed of MAP_SEEDS) {
      const map = buildMap(seed, id);
      const { sites, links, rivers } = map;
      expect(sites.length).toBeGreaterThanOrEqual(8);
      expect(sites[0].owner).toBe('a');
      expect(sites[1].owner).toBe('b');
      const centre = centreOf(map);
      const turn = (p: Point) => ({ x: 2 * centre.x - p.x, y: 2 * centre.y - p.y });
      const twinOf = (i: number) => sites.findIndex((s) => s.x === turn(sites[i]).x && s.y === turn(sites[i]).y);
      sites.forEach((site, i) => {
        const twin = twinOf(i);
        expect(twin).not.toBe(-1);
        const owner = site.owner === 'a' ? 'b' : site.owner === 'b' ? 'a' : null;
        expect(sites[twin]).toStrictEqual({ ...site, ...turn(site), owner });
        expect(links[twin].slice().sort(byNumber)).toEqual(links[i].map(twinOf).sort(byNumber));
      });
      for (const path of map.paths) {
        const [a, b] = [twinOf(path.a), twinOf(path.b)].sort(byNumber);
        expect(pathOf(map, a, b)).toEqual({ ...path, a, b, up: path.up === undefined ? undefined : twinOf(path.up) });
      }
      expect(rivers.map((river) => river.map(turn).reverse())).toEqual(rivers);
    }
  });

  it('joins every hut to every other by paths that take no toll', () => {
    for (const seed of MAP_SEEDS) {
      const { sites, paths } = buildMap(seed, id);
      const seen = new Set([0]);
      const queue = [0];
      for (let head = 0; head < queue.length; head++) {
        for (const path of paths) {
          if (takesToll(path.kind) || (path.a !== queue[head] && path.b !== queue[head])) continue;
          const next = path.a === queue[head] ? path.b : path.a;
          if (seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      expect(seen.size).toBe(sites.length);
    }
  });

  it('lists every path once, lower hut first, and the links say the same', () => {
    for (const seed of MAP_SEEDS) {
      const { sites, links, paths } = buildMap(seed, id);
      const joined: number[][] = sites.map(() => []);
      for (const path of paths) {
        expect(path.a).toBeLessThan(path.b);
        joined[path.a].push(path.b);
        joined[path.b].push(path.a);
        if (path.kind === 'climb') expect([path.a, path.b]).toContain(path.up);
        else expect(path.up).toBeUndefined();
      }
      expect(new Set(paths.map((p) => `${p.a}-${p.b}`)).size).toBe(paths.length);
      expect(links.map((linked) => linked.slice().sort(byNumber))).toEqual(joined.map((linked) => linked.sort(byNumber)));
    }
  });

  it('keeps its huts 150 apart, on whole numbers, clear of the edges, and few enough for an order to name', () => {
    for (const seed of MAP_SEEDS) {
      const { sites, w, h } = buildMap(seed, id);
      expect(sites.length).toBeLessThanOrEqual(36);
      sites.forEach((p, i) => {
        expect(Number.isInteger(p.x) && Number.isInteger(p.y)).toBe(true);
        expect(p.x).toBeGreaterThanOrEqual(60);
        expect(p.x).toBeLessThanOrEqual(w - 60);
        expect(p.y).toBeGreaterThanOrEqual(FIELD_TOP + 70);
        expect(p.y).toBeLessThanOrEqual(h - 55);
        // A tower may stand nearer: what it keeps from a hut is its range.
        for (const q of sites.slice(i + 1)) {
          if (!p.tower && !q.tower) expect((p.x - q.x) ** 2 + (p.y - q.y) ** 2).toBeGreaterThanOrEqual(150 * 150);
        }
      });
    }
  });

  it('lies in a world of the one shape, and only the meadow in the big one', () => {
    const { w, h } = buildMap(1, id);
    expect({ w, h }).toEqual(id === 'meadow' ? { w: 1400, h: 924 } : { w: 1000, h: 660 });
    expect(w * 660).toBe(h * 1000);
  });

  it('crosses a river only by a bridge or a ford, once', () => {
    for (const seed of MAP_SEEDS) {
      const map = buildMap(seed, id);
      for (const path of map.paths) expect(crossings(map, path)).toBe(path.kind === 'bridge' || path.kind === 'ford' ? 1 : 0);
    }
  });

  it('marches a path to the hut at its other end, never round it', () => {
    for (const seed of MAP_SEEDS) {
      const map = buildMap(seed, id);
      for (const path of map.paths) {
        expect([nextHop(map, path.a, path.b, true), nextHop(map, path.b, path.a, true)]).toEqual([path.b, path.a]);
        if (!takesToll(path.kind)) expect([nextHop(map, path.a, path.b), nextHop(map, path.b, path.a)]).toEqual([path.b, path.a]);
      }
    }
  });

  it('is the same map for the same seed, and a different one for another', () => {
    expect(buildMap(42, id)).toEqual(buildMap(42, id));
    expect(buildMap(42, id)).not.toEqual(buildMap(43, id));
    expect(buildMap(42, id).id).toBe(id);
  });
});

describe('the places', () => {
  const kindsOf = (map: SwarmMap) => new Set(map.paths.map((p) => p.kind));
  const count = (map: SwarmMap, kind: PathKind) => map.paths.filter((p) => p.kind === kind).length;

  it('the seed picks one when the host has not, and each has its own scene', () => {
    expect(MAP_SEEDS.map((seed) => buildMap(seed).id)).toEqual(MAP_SEEDS.map((seed) => MAP_IDS[seed % MAP_IDS.length]));
    expect(buildMap(0xdeadbeef).id).toBe(MAP_IDS[0xdeadbeef % MAP_IDS.length]);
    expect(buildMap(8)).toEqual(buildMap(8, 'guns'));
    expect(MAP_IDS.map((id) => buildMap(1, id).scene)).toEqual(['meadow', 'scrub', 'valley', 'ice', 'terrace']);
  });

  it.each<MapId>(['thorns', 'bridges', 'hill'])('%s is drawn three ways, each of them both ways up', (id) => {
    const maps = MAP_SEEDS.map((seed) => buildMap(seed, id));
    const shapes = new Set(maps.map((map) => JSON.stringify(map.paths)));
    expect(shapes.size).toBe(3);
    for (const shape of shapes) {
      // Hut 2 is off the middle line in every drawing, so turning one over moves it.
      const heights = maps.filter((map) => JSON.stringify(map.paths) === shape).map((map) => map.sites[2].y);
      expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(100);
    }
  });

  it('meadow is huts and roads and nothing else', () => {
    for (const seed of MAP_SEEDS) {
      const map = buildMap(seed, 'meadow');
      expect([...kindsOf(map)]).toEqual(['road']);
      expect(map.sites.filter((s) => s.tower || s.fort)).toEqual([]);
      expect(map.rivers).toEqual([]);
    }
  });

  it('meadow, the big map, has about twice the huts of any other', () => {
    const counts = Array.from({ length: 400 }, (_, seed) => buildMap(seed + 1, 'meadow').sites.length);
    expect([Math.min(...counts), Math.max(...counts)]).toEqual([18, 23]);
    const starts = Array.from({ length: 400 }, (_, seed) => buildMap(seed + 1, 'meadow').sites[1].x - buildMap(seed + 1, 'meadow').sites[0].x);
    expect(Math.min(...starts)).toBeGreaterThanOrEqual(1160);
  });

  it('thorns has a key hut the roads go round to and the spikes run straight at', () => {
    for (const seed of MAP_SEEDS) {
      const map = buildMap(seed, 'thorns');
      expect([...kindsOf(map)].filter((kind) => !['road', 'wide', 'narrow', 'spikes'].includes(kind))).toEqual([]);
      expect(count(map, 'spikes')).toBeGreaterThanOrEqual(2);
      expect(count(map, 'wide')).toBeGreaterThanOrEqual(2);
      const key = map.sites.reduce((best, site, index) => (site.n > map.sites[best].n ? index : best), 0);
      expect(map.sites[key].level).toBeGreaterThanOrEqual(2);
      expect(map.sites[key].n).toBeGreaterThanOrEqual(20);
      const round = routeOf(map, 0, key, false);
      const straight = routeOf(map, 0, key, true);
      expect(kindsOn(map, round)).not.toContain('spikes');
      expect(kindsOn(map, straight).pop()).toBe('spikes');
      expect(straight.length).toBe(3);
      expect(lengthOf(map, round) * 4).toBeGreaterThan(lengthOf(map, straight) * 5);
    }
  });

  it('bridges has one river from edge to edge, two bridges, and a ford that is the shorter way over', () => {
    for (const seed of MAP_SEEDS) {
      const map = buildMap(seed, 'bridges');
      expect(map.rivers.length).toBe(1);
      const river = map.rivers[0];
      expect(river.length).toBeGreaterThanOrEqual(6);
      for (const end of [river[0], river[river.length - 1]]) {
        expect(end.x <= 0 || end.x >= map.w || end.y <= 0 || end.y >= map.h).toBe(true);
      }
      expect([count(map, 'bridge'), count(map, 'ford')]).toEqual([2, 1]);
      const dry = routeOf(map, 0, 1, false);
      const wet = routeOf(map, 0, 1, true);
      expect(kindsOn(map, dry).filter((kind) => kind === 'bridge' || kind === 'ford')).toEqual(['bridge']);
      expect(kindsOn(map, wet).filter((kind) => kind === 'bridge' || kind === 'ford')).toEqual(['ford']);
      expect(lengthOf(map, wet)).toBeLessThan(lengthOf(map, dry));
    }
  });

  it('hill has one fort, in the middle, and no way to it that does not climb', () => {
    for (const seed of MAP_SEEDS) {
      const map = buildMap(seed, 'hill');
      const forts = map.sites.flatMap((site, index) => (site.fort ? [index] : []));
      expect(forts.length).toBe(1);
      const fort = map.sites[forts[0]];
      expect(fort).toMatchObject({ ...centreOf(map), owner: null });
      expect([2, 3]).toContain(fort.level);
      expect(fort.n).toBeGreaterThanOrEqual(14);
      const climbs = map.paths.filter((p) => p.kind === 'climb');
      expect(climbs.length).toBeGreaterThanOrEqual(4);
      // The top of a climb is the fort or one of the huts that stand round it.
      for (const climb of climbs) expect([forts[0], ...map.links[forts[0]]]).toContain(climb.up);
      const flat = new Set([0]);
      const queue = [0];
      for (let head = 0; head < queue.length; head++) {
        for (const next of map.links[queue[head]]) {
          if (flat.has(next) || pathOf(map, queue[head], next)?.kind === 'climb') continue;
          flat.add(next);
          queue.push(next);
        }
      }
      expect(flat.size).toBeGreaterThanOrEqual(4);
      expect(flat.has(forts[0])).toBe(false);
    }
  });

  it('guns stands a column of two to four neutral towers before each side, and no other place has a tower', () => {
    expect(TOWER_SEEDS.map((seed) => towersOf(buildMap(seed, 'guns')).length)).toEqual([4, 6, 8]);
    const byCount = [0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 400; seed++) {
      const map = buildMap(seed, 'guns');
      const towers = towersOf(map);
      byCount[towers.length / 2]++;
      for (const index of towers) expect(map.sites[index]).toMatchObject({ owner: null, n: TOWER_START, level: 1 });
    }
    expect(byCount.slice(0, 2)).toEqual([0, 0]);
    for (const count of byCount.slice(2)) expect(count).toBeGreaterThan(100);
    for (const id of MAP_IDS) {
      if (id !== 'guns') expect(MAP_SEEDS.flatMap((seed) => towersOf(buildMap(seed, id)))).toEqual([]);
    }
  });

  it.each(TOWER_SEEDS)('guns %i: the towers stand evenly down x=400 and x=600, each facing one straight across', (seed) => {
    const map = buildMap(seed, 'guns');
    const column = (x: number) => map.sites.filter((s) => s.tower && s.x === x).map((s) => s.y).sort((p, q) => p - q);
    const left = column(400);
    expect(left.length).toBe(towersOf(map).length / 2);
    expect(column(600)).toEqual(left);
    const gaps = left.slice(1).map((y, k) => y - left[k]);
    expect(new Set(gaps).size).toBe(1);
    expect(left[0] + left[left.length - 1]).toBe(2 * centreOf(map).y);
    // The margin between the top of the field and the first is a gap too, to within the rounding.
    expect(left[0] - FIELD_TOP).toBeGreaterThanOrEqual(gaps[0]);
    expect(left[0] - FIELD_TOP).toBeLessThan(gaps[0] + 4);
  });

  it.each(TOWER_SEEDS)('guns %i: the only paths over the middle join a tower to the one facing it, and the way across takes one', (seed) => {
    const map = buildMap(seed, 'guns');
    const side = (index: number) => Math.sign(map.sites[index].x - map.w / 2);
    for (const index of towersOf(map)) {
      const over = map.links[index].filter((j) => side(j) !== side(index));
      expect(over.map((j) => map.sites[j])).toEqual([{ ...map.sites[index], x: map.w - map.sites[index].x }]);
    }
    expect(routeOf(map, 0, 1, false).filter((index) => map.sites[index].tower).length).toBeGreaterThanOrEqual(2);
  });

  it('guns keeps every hut behind its own towers, out of their range, and off the paths over the middle', () => {
    let huts = 0;
    let nearest = Infinity;
    for (let seed = 1; seed <= 200; seed++) {
      const { sites, links, w } = buildMap(seed, 'guns');
      const towers = sites.filter((s) => s.tower);
      sites.forEach((hut, index) => {
        if (hut.tower) return;
        huts++;
        expect(Math.abs(hut.x - w / 2)).toBeGreaterThan(100);
        expect(links[index].filter((j) => (sites[j].x - w / 2) * (hut.x - w / 2) < 0)).toEqual([]);
        for (const t of towers) nearest = Math.min(nearest, (hut.x - t.x) ** 2 + (hut.y - t.y) ** 2);
      });
    }
    expect(huts).toBeGreaterThan(600);
    // Nearer a tower than the 150 two huts keep between them, but never inside its range.
    expect(nearest).toBeGreaterThanOrEqual(TOWER_RANGE * TOWER_RANGE);
    expect(nearest).toBeLessThan(150 * 150);
  });

  it('guns stands no hut straight above or below a tower, where the tower would be drawn over it', () => {
    let beside = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const { sites } = buildMap(seed, 'guns');
      const towers = sites.filter((s) => s.tower);
      for (const hut of sites) {
        if (hut.tower) continue;
        for (const t of towers) {
          if (Math.abs(hut.x - t.x) < 80) expect(Math.abs(hut.y - t.y)).toBeGreaterThanOrEqual(170);
          else if (Math.abs(hut.y - t.y) < 170) beside++;
        }
      }
    }
    // The rule only bites above and below: huts still stand level with a tower to its side.
    expect(beside).toBeGreaterThan(600);
  });

  it('meadow joins the two sides directly', () => {
    const map = buildMap(2, 'meadow');
    const crossing = map.links.flatMap((linked, i) =>
      linked.filter((j) => (map.sites[i].x - map.w / 2) * (map.sites[j].x - map.w / 2) < 0)
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

  it('carry a risky send as a capital letter, and read an old string as before', () => {
    const orders: Order[] = [
      { tick: 4, kind: 'half', from: 0, to: 3, risky: true },
      { tick: 4, kind: 'half', from: 0, to: 3 },
      { tick: 40, kind: 'all', from: 35, to: 10, risky: true },
      { tick: 41, kind: 'all', from: 10, to: 17 },
    ];
    expect(encodeOrders(orders)).toBe('4:H03,4:h03,14:Aza,15:aah');
    expect(decodeOrders(encodeOrders(orders))).toStrictEqual(orders);
    expect(decodeOrders('4:h03,4mn:u77')).toStrictEqual([
      { tick: 4, kind: 'half', from: 0, to: 3 },
      { tick: 5999, kind: 'hut', from: 7, to: 7 },
    ]);
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
    const map = mapOf(duel('b', 9).map.sites, [[], []]);
    const state = newState(map);
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

  it('a faster unit that catches one of the other side on the path fights it there, and does not walk through', () => {
    const { map, state } = lane('road');
    state.army.a.speed = 3;
    state.units = [
      { id: 1, seat: 'b', from: 0, to: 1, dest: 1, d: 100 },
      { id: 2, seat: 'a', from: 0, to: 1, dest: 1, d: 90 },
    ];
    step(state, map, none());
    // Twelve a tick behind six a tick: still four short.
    expect(state.units.map((u) => [u.id, u.d])).toEqual([[1, 106], [2, 102]]);
    expect(state.events).toEqual([]);
    step(state, map, none());
    expect(state.units).toEqual([]);
    expect(state.events).toEqual([{ kind: 'clash', from: 0, to: 1, d: 113 }]);
  });

  it('two of the other side walking the same way at one pace never meet', () => {
    const { map, state } = lane('road');
    state.units = [
      { id: 1, seat: 'b', from: 0, to: 1, dest: 1, d: 100 },
      { id: 2, seat: 'a', from: 0, to: 1, dest: 1, d: 90 },
    ];
    run(state, map, none(), 20);
    expect(state.units.map((u) => [u.id, u.d])).toEqual([[1, 220], [2, 210]]);
  });

  it('a unit behind one of its own side still fights whoever of the other side it meets', () => {
    const { map, state } = lane('road');
    // Coming down the path an ant leads a bee, and an ant walks up it to meet them.
    state.units = [
      { id: 1, seat: 'a', from: 1, to: 0, dest: 0, d: 115 },
      { id: 2, seat: 'b', from: 1, to: 0, dest: 0, d: 110 },
      { id: 3, seat: 'a', from: 0, to: 1, dest: 1, d: 118 },
    ];
    step(state, map, none());
    // The two ants pass. The bee is 124 from the far end and so is the ant walking up.
    expect(state.units.map((u) => [u.id, u.d])).toEqual([[1, 121]]);
    expect(state.events).toEqual([{ kind: 'clash', from: 0, to: 1, d: 124 }]);
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

  it.each([1, 2, 3])('two armies of strength %i trade one for one at a hut, as two of none do', (strength) => {
    const left = (sourceN: number) => {
      const { map, state } = duel('b', 9, sourceN);
      state.army.a.strength = strength;
      state.army.b.strength = strength;
      run(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 40);
      return state.huts[1].n;
    };
    // The hut breeds four while the column walks and comes in.
    expect(left(5)).toBe(8);
    expect(left(9)).toBe(4);
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
  const map = mapOf(
    owners.map((owner, i) => ({ x: 100 + i * 60, y: 100, owner, n: counts[i], level: 1 })),
    owners.map((_, i) => [i - 1, i + 1].filter((j) => j >= 0 && j < owners.length))
  );
  return { map, state: newState(map) };
}

describe('a march of more than one path', () => {
  it('takes the shortest way by the paths there are', () => {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 5, level: 1 },
        { x: 400, y: 100, owner: 'b', n: 5, level: 1 },
        { x: 250, y: 110, owner: null, n: 5, level: 1 },
        { x: 250, y: 500, owner: null, n: 5, level: 1 },
      ],
      [[2, 3], [2, 3], [0, 1], [0, 1]]
    );
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

// A full level 3 hut of b's, a full level 3 hut of a's `length` away on either side of it, and b's reserve 291 off.
function storm(columns: number, strength: number, length: number, relief = 0): { fell: number | null; least: number } {
  const map = mapOf(
    [
      { x: 500, y: 300, owner: 'b', n: 80, level: 3 },
      { x: 500 - length, y: 300, owner: 'a', n: 80, level: 3 },
      { x: 500 + length, y: 300, owner: 'a', n: 80, level: 3 },
      { x: 650, y: 550, owner: 'b', n: relief, level: 3 },
    ],
    [[1, 2, 3], [0], [0], [0]]
  );
  const state = newState(map);
  state.army.a.strength = strength;
  state.army.b.strength = strength;
  const orders = {
    a: [1, 2].slice(0, columns).map((from) => ({ tick: 1, kind: 'all' as const, from, to: 0 })),
    b: [{ tick: 1, kind: 'all' as const, from: 3, to: 0 }],
  };
  let fell: number | null = null;
  let least = 80;
  advance(state, map, orders, 300, null, (s) => {
    if (fell === null && s.huts[0].owner === 'a') fell = s.tick;
    least = Math.min(least, s.huts[0].n);
  });
  return { fell, least };
}

describe('taking a full level 3 hut', () => {
  // 200 is walked in 34 ticks and 206 in 35, so the columns come in on ticks of either parity.
  describe.each([200, 206])('from %i away', (length) => {
    it.each([0, 1, 2, 3])('two full huts of strength %i take it from the same strength', (strength) => {
      expect(storm(2, strength, length).fell).toBe(length === 200 ? 133 : 134);
    });

    it.each([0, 1, 2, 3])('one full hut of strength %i does not, and leaves it 31', (strength) => {
      expect(storm(1, strength, length)).toEqual({ fell: null, least: 31 });
    });
  });

  it('holds against two full huts when 60 are sent to it as the columns set out, and falls later with 40', () => {
    expect(storm(2, 3, 200, 60)).toEqual({ fell: null, least: 11 });
    expect(storm(2, 3, 200, 40).fell).toBe(183);
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
  const map = mapOf(
    [
      { x: 100, y: 100, owner: 'a', n: sourceN, level: 1 },
      { x: 340, y: 100, owner: towerOwner, n: towerN, level: 1, tower: true },
      { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
    ],
    [[1], [0], []]
  );
  return { map, state: newState(map) };
}

// A path of 400 between two huts of a's, and a tower `off` to the side of its
// middle, joined to the first hut.
function bypass(towerOwner: Owner, off = 60): { map: SwarmMap; state: SwarmState } {
  const map = mapOf(
    [
      { x: 100, y: 100, owner: 'a', n: 12, level: 1 },
      { x: 500, y: 100, owner: 'a', n: 0, level: 1 },
      { x: 300, y: 100 + off, owner: towerOwner, n: 10, level: 1, tower: true },
      { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
    ],
    [[1, 2], [0], [0], []]
  );
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
    const map = buildMap(7, 'guns');
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
  it.each(MAP_IDS)('%s: takes huts and beats a player who never moves', (id) => {
    for (const seed of SEEDS) {
      const map = buildMap(seed, id);
      const state = newState(map);
      advance(state, map, none(), MATCH_TICKS, 'b');
      expect(state.winner).toBe('b');
      expect(state.tick).toBeLessThan(MATCH_TICKS);
    }
  });

  it('only ever orders from its own huts along real paths', () => {
    const map = buildMap(7, 'guns');
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
    const { sites } = siege(null, TOWER_START, 14).map;
    const map = mapOf([...sites, { x: 100, y: 340, owner: null, n: 11, level: 1 }], [[1, 3], [0], [], [0]]);
    // The tower holds one fewer, but would shoot eight of the fourteen.
    expect(cpuOrders(newState(map), map, 'a')).toEqual([{ tick: 1, kind: 'all', from: 0, to: 3 }]);
  });

  it('takes every tower of a tower map on the way to winning it', () => {
    const map = buildMap(1, 'guns');
    const state = newState(map);
    advance(state, map, none(), MATCH_TICKS, 'b');
    expect(towersOf(map).map((index) => state.huts[index].owner)).toEqual(['b', 'b', 'b', 'b', 'b', 'b']);
  });
});

// Two huts of a's 240 apart, joined by one path of the kind given, and a hut for b off on its own.
function lane(kind: PathKind, up?: number, sourceN = 12): { map: SwarmMap; state: SwarmState } {
  const map = mapOf(
    [
      { x: 100, y: 100, owner: 'a', n: sourceN, level: 1 },
      { x: 340, y: 100, owner: 'a', n: 0, level: 1 },
      { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
    ],
    [[1], [0], []],
    [{ a: 0, b: 1, kind, ...(up !== undefined && { up }) }]
  );
  return { map, state: newState(map) };
}

const tollsOver = (state: SwarmState, map: SwarmMap, orders: Record<Seat, Order[]>, to: number) => {
  const tolls: (SwarmEvent & { tick: number })[] = [];
  advance(state, map, orders, to, null, (s) => {
    for (const event of s.events) if (event.kind === 'toll') tolls.push({ ...event, tick: s.tick });
  });
  return tolls;
};

describe('the pace of a path', () => {
  const stride = (kind: PathKind, from: number, speed: number, up?: number) => {
    const { map, state } = lane(kind, up);
    state.army.a.speed = speed;
    state.units = [{ id: 1, seat: 'a', from, to: 1 - from, dest: 1 - from, d: 0 }];
    step(state, map, none());
    expect(paceOn(map, from, 1 - from, speed)).toBe(state.units[0].d);
    return state.units[0].d;
  };

  it.each<[PathKind, number, number]>([
    ['road', 6, 12],
    ['bridge', 6, 12],
    ['spikes', 6, 12],
    ['ford', 6, 12],
    ['wide', 8, 16],
    ['narrow', 4, 8],
  ])('a %s is walked at %i a tick, and %i by the fastest army, either way along it', (kind, slow, fast) => {
    expect([stride(kind, 0, 0), stride(kind, 1, 0)]).toEqual([slow, slow]);
    expect([stride(kind, 0, 3), stride(kind, 1, 3)]).toEqual([fast, fast]);
  });

  it('a climb is half pace up and a wide road down, whichever end is the top', () => {
    expect([stride('climb', 0, 0, 1), stride('climb', 1, 0, 1)]).toEqual([3, 8]);
    expect([stride('climb', 0, 0, 0), stride('climb', 1, 0, 0)]).toEqual([8, 3]);
    expect([stride('climb', 0, 3, 1), stride('climb', 1, 3, 1)]).toEqual([6, 16]);
  });

  it('a column up a climb takes twice as long as one along a road', () => {
    const arrival = (kind: PathKind, up?: number) => {
      const { map, state } = lane(kind, up, 1);
      let tick = 0;
      advance(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 200, null, (s) => {
        if (tick === 0 && s.tick > 2 && s.units.length === 0) tick = s.tick;
      });
      return tick;
    };
    // Out on tick 2 with its first step taken, and 240 to walk.
    expect([arrival('road'), arrival('climb', 1), arrival('climb', 0), arrival('narrow')]).toEqual([41, 81, 31, 61]);
  });
});

describe('spikes and fords', () => {
  it('take every fourth unit over the middle, and say whose it was and where', () => {
    expect(TOLL_EVERY).toBe(4);
    const { map, state } = lane('spikes');
    const tolls = tollsOver(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1, risky: true }], b: [] }, 100);
    // Out every other tick from tick 2, and 120 is twenty steps.
    expect(tolls).toEqual([27, 35, 43].map((tick) => ({ kind: 'toll', from: 0, to: 1, d: 120, seat: 'a', tick })));
    expect(state.tolls).toEqual([12]);
    expect(state.units).toEqual([]);
    // Nine of the twelve walked in, and each hut bred ten.
    expect(state.huts.map((h) => h.n).slice(0, 2)).toEqual([10, 19]);
  });

  it('a ford does the same, and a road counts nobody', () => {
    const ford = lane('ford');
    expect(tollsOver(ford.state, ford.map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1, risky: true }], b: [] }, 100).length).toBe(3);
    const road = lane('road');
    expect(tollsOver(road.state, road.map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1, risky: true }], b: [] }, 100)).toEqual([]);
    expect(road.state.tolls).toEqual([0]);
    expect(road.state.huts[1].n).toBe(22);
  });

  it('keep one count for both sides and both directions', () => {
    const { map, state } = lane('spikes');
    state.tolls = [2];
    // The ant is over the middle on this tick, and the bee coming the other way a tick later, behind it.
    state.units = [
      { id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 228, risky: true },
      { id: 2, seat: 'a', from: 0, to: 1, dest: 1, d: 114, risky: true },
      { id: 3, seat: 'b', from: 1, to: 0, dest: 0, d: 5, risky: true },
    ];
    step(state, map, none());
    expect(state.tolls).toEqual([3]);
    state.units = [{ id: 3, seat: 'b', from: 1, to: 0, dest: 0, d: 114, risky: true }];
    step(state, map, none());
    expect(state.events).toEqual([{ kind: 'toll', from: 1, to: 0, d: 120, seat: 'b' }]);
    expect(state.tolls).toEqual([4]);
    expect(state.units).toEqual([]);
  });

  it('count only what is left of two columns that meet at the middle', () => {
    const { map, state } = lane('spikes');
    state.tolls = [2];
    state.units = [
      { id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 114, risky: true },
      { id: 2, seat: 'b', from: 1, to: 0, dest: 0, d: 114, risky: true },
    ];
    step(state, map, none());
    // Counted before they fought, the ant made the count three and the bee paid the toll, every time.
    expect(state.events).toEqual([{ kind: 'clash', from: 0, to: 1, d: 120 }]);
    expect(state.tolls).toEqual([2]);
    expect(state.units).toEqual([]);
  });

  it('have one middle on a path of odd length, where two units that walk at each other meet', () => {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 0, level: 1 },
        { x: 345, y: 100, owner: 'b', n: 0, level: 1 },
      ],
      [[1], [0]],
      [{ a: 0, b: 1, kind: 'ford' }]
    );
    const state = newState(map);
    state.tolls = [2];
    state.units = [
      { id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 116, risky: true },
      { id: 2, seat: 'b', from: 1, to: 0, dest: 0, d: 116, risky: true },
    ];
    // Each is 122 along after this tick, one short of the other. Half of 245 rounded down counted both, and the bee paid.
    step(state, map, none());
    expect(state.events).toEqual([]);
    expect(state.units.map((u) => u.d)).toEqual([122, 122]);
    step(state, map, none());
    expect(state.events).toEqual([{ kind: 'clash', from: 0, to: 1, d: 122 }]);
    expect(state.tolls).toEqual([2]);
    expect(state.units).toEqual([]);
  });

  it('carry the count on from one send to the next', () => {
    const { map, state } = lane('spikes', undefined, 6);
    const orders = {
      a: [
        { tick: 1, kind: 'half' as const, from: 0, to: 1, risky: true },
        { tick: 100, kind: 'all' as const, from: 0, to: 1, risky: true },
      ],
      b: [],
    };
    // Three cross and none dies. The hut has twelve by tick 100, and the first of them is the fourth over.
    expect(tollsOver(state, map, orders, 99)).toEqual([]);
    expect(state.tolls).toEqual([3]);
    expect(tollsOver(state, map, orders, 200).map((toll) => toll.tick)).toEqual([119, 127, 135]);
    expect(state.tolls).toEqual([15]);
  });

  it('count a unit once, as it steps over the middle, and not one that is past it', () => {
    const { map, state } = lane('spikes');
    state.tolls = [3];
    state.units = [
      { id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 120, risky: true },
      { id: 2, seat: 'a', from: 0, to: 1, dest: 1, d: 108, risky: true },
    ];
    step(state, map, none());
    expect(state.tolls).toEqual([3]);
    expect(state.units.map((u) => u.d)).toEqual([126, 114]);
    step(state, map, none());
    expect(state.tolls).toEqual([4]);
    expect(state.units.map((u) => u.id)).toEqual([1]);
  });

  it('are closed to a send that is not risky', () => {
    const { map, state } = lane('spikes');
    expect(nextHop(map, 0, 1)).toBe(-1);
    expect(nextHop(map, 0, 1, true)).toBe(1);
    run(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 40);
    expect(state.huts[0].out).toEqual([]);
    expect(state.units).toEqual([]);
    expect(state.tolls).toEqual([0]);
  });

  it('are cloned with their count', () => {
    const { map, state } = lane('ford');
    const orders = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 1, risky: true }], b: [] };
    run(state, map, orders, 30);
    expect(state.tolls).toEqual([5]);
    const copy = cloneState(state);
    expect(copy.tolls).toEqual([5]);
    run(copy, map, orders, 60);
    expect(copy.tolls).toEqual([12]);
    expect(state.tolls).toEqual([5]);
  });
});

// Spikes straight from a's hut to b's, 300 long, and a road round by a hut of a's, 250 each way.
function triangle(): { map: SwarmMap; state: SwarmState } {
  const map = mapOf(
    [
      { x: 100, y: 100, owner: 'a', n: 6, level: 1 },
      { x: 400, y: 100, owner: 'b', n: 40, level: 1 },
      { x: 250, y: 300, owner: 'a', n: 0, level: 1 },
    ],
    [[1, 2], [0, 2], [0, 1]],
    [{ a: 0, b: 1, kind: 'spikes' }]
  );
  return { map, state: newState(map) };
}

// A road from a's hut to a junction, and from there spikes straight on to b's
// hut, 300 long, or a road round by a third hut of a's, 250 each way.
function fork(): { map: SwarmMap; state: SwarmState } {
  const map = mapOf(
    [
      { x: 100, y: 300, owner: 'a', n: 8, level: 1 },
      { x: 200, y: 300, owner: 'a', n: 0, level: 1 },
      { x: 500, y: 300, owner: 'b', n: 40, level: 1 },
      { x: 350, y: 100, owner: 'a', n: 0, level: 1 },
    ],
    [[1], [0, 2, 3], [1, 3], [1, 2]],
    [{ a: 1, b: 2, kind: 'spikes' }]
  );
  return { map, state: newState(map) };
}

describe('the safe way and the risky way', () => {
  it('a safe send goes round the spikes though they are shorter, and a risky one goes over them', () => {
    const { map } = triangle();
    expect(pathLength(map, 0, 1)).toBeLessThan(pathLength(map, 0, 2) + pathLength(map, 2, 1));
    expect([nextHop(map, 0, 1), nextHop(map, 1, 0)]).toEqual([2, 2]);
    expect([nextHop(map, 0, 1, true), nextHop(map, 1, 0, true)]).toEqual([1, 0]);

    const safe = triangle();
    expect(tollsOver(safe.state, safe.map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 12)).toEqual([]);
    expect(safe.state.units.map((u) => [u.from, u.to, u.risky])).toEqual(Array(6).fill([0, 2, undefined]));
    run(safe.state, safe.map, none(), 120);
    expect(safe.state.tolls).toEqual([0, 0, 0]);

    const risky = triangle();
    run(risky.state, risky.map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1, risky: true }], b: [] }, 12);
    expect(risky.state.units.map((u) => [u.from, u.to, u.risky])).toEqual(Array(6).fill([0, 1, true]));
    expect(tollsOver(risky.state, risky.map, none(), 120).length).toBe(1);
    expect(risky.state.tolls).toEqual([6, 0, 0]);
  });

  it('a risky send takes the road when the road is quicker', () => {
    const map = mapOf(
      [
        { x: 100, y: 100, owner: 'a', n: 6, level: 1 },
        { x: 400, y: 100, owner: 'b', n: 40, level: 1 },
        { x: 250, y: 110, owner: 'a', n: 0, level: 1 },
        { x: 250, y: 500, owner: 'a', n: 0, level: 1 },
      ],
      [[2, 3], [2, 3], [0, 1], [0, 1]],
      [{ a: 0, b: 3, kind: 'ford' }, { a: 1, b: 3, kind: 'ford' }]
    );
    expect(nextHop(map, 0, 1, true)).toBe(2);
  });

  it('routes by the time a path takes: round by the wide road, and up a climb only when there is no quicker way', () => {
    const round = (kind: PathKind, up?: number) =>
      mapOf(
        [
          { x: 100, y: 100, owner: 'a', n: 6, level: 1 },
          { x: 400, y: 100, owner: 'b', n: 40, level: 1 },
          { x: 250, y: 250, owner: 'a', n: 0, level: 1 },
        ],
        [[1, 2], [0, 2], [0, 1]],
        [{ a: 0, b: 1, kind, ...(up !== undefined && { up }) }]
      );
    // 300 straight, 424 round.
    expect([nextHop(round('road'), 0, 1), nextHop(round('road'), 1, 0)]).toEqual([1, 0]);
    expect([nextHop(round('narrow'), 0, 1), nextHop(round('narrow'), 1, 0)]).toEqual([2, 2]);
    expect([nextHop(round('climb', 1), 0, 1), nextHop(round('climb', 1), 1, 0)]).toEqual([2, 0]);
    expect([nextHop(round('climb', 0), 0, 1), nextHop(round('climb', 0), 1, 0)]).toEqual([1, 2]);
  });

  it('two sends by the same first path are kept apart, and part where the ways do', () => {
    const { map, state } = fork();
    const orders = {
      a: [
        { tick: 1, kind: 'half' as const, from: 0, to: 2 },
        { tick: 1, kind: 'all' as const, from: 0, to: 2, risky: true },
      ],
      b: [],
    };
    step(state, map, orders);
    expect(state.huts[0].out).toStrictEqual([
      { to: 1, dest: 2, n: 4 },
      { to: 1, dest: 2, n: 4, risky: true },
    ]);
    const round = new Set<number>();
    const over = new Set<number>();
    advance(state, map, orders, 60, null, (s) => {
      for (const unit of s.units) {
        if (unit.from !== 1) continue;
        expect(unit.to).toBe(unit.risky ? 2 : 3);
        (unit.risky ? over : round).add(unit.id);
      }
    });
    expect([round.size, over.size]).toEqual([4, 4]);
    expect(state.tolls).toEqual([0, 4, 0, 0]);
  });

  it('a second send the same way joins the line already leaving', () => {
    const { map, state } = fork();
    const send = { tick: 1, kind: 'half' as const, from: 0, to: 2, risky: true };
    step(state, map, { a: [send, send], b: [] });
    expect(state.huts[0].out).toStrictEqual([{ to: 1, dest: 2, n: 6, risky: true }]);
  });
});

// A fort 60 from a's hut, and a hut for b off on its own.
function keep(fortOwner: Owner, fortN: number, sourceN: number, level = 1): { map: SwarmMap; state: SwarmState } {
  const map = mapOf(
    [
      { x: 100, y: 100, owner: 'a', n: sourceN, level: 1 },
      { x: 160, y: 100, owner: fortOwner, n: fortN, level, fort: true },
      { x: 900, y: 500, owner: 'b', n: 5, level: 1 },
    ],
    [[1], [0], []]
  );
  return { map, state: newState(map) };
}

describe('a fort', () => {
  const storm = (fortN: number, sourceN: number) => {
    const { map, state } = keep(null, fortN, sourceN);
    // Short of the twenty ticks a fort taken on the way would need to breed.
    run(state, map, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }], b: [] }, 40);
    expect(state.units).toEqual([]);
    return state.huts[1];
  };

  it('costs two attackers for each defender', () => {
    expect(FORT_LIVES).toBe(2);
    expect(storm(4, 8)).toMatchObject({ owner: null, n: 0, hurt: 0 });
    expect(storm(4, 7)).toMatchObject({ owner: null, n: 1, hurt: 1 });
    expect(storm(4, 1)).toMatchObject({ owner: null, n: 4, hurt: 1 });
  });

  it('falls to one more than twice what it holds, and the new garrison starts unhurt', () => {
    expect(storm(4, 9)).toMatchObject({ owner: 'a', n: 1, hurt: 0 });
    expect(storm(3, 7)).toMatchObject({ owner: 'a', n: 1, hurt: 0 });
    expect(storm(1, 2)).toMatchObject({ owner: null, n: 0, hurt: 0 });
  });

  it('a hut that is no fort has no wound to keep', () => {
    const { state } = duel(null, 4);
    expect('hurt' in state.huts[1]).toBe(false);
    expect(keep(null, 4, 5).state.huts.map((h) => h.hurt)).toEqual([undefined, 0, undefined]);
  });

  it('forgets a wound when it changes hands', () => {
    const { map, state } = keep('b', 0, 5);
    state.huts[1].hurt = 1;
    state.units = [{ id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 54 }];
    step(state, map, none());
    expect(state.huts[1]).toMatchObject({ owner: 'a', n: 1, hurt: 0 });
  });

  it('breeds at half the pace of a hut of its level, and only when held', () => {
    const first = keep('a', 3, 5);
    run(first.state, first.map, none(), 100);
    expect(first.state.huts.map((h) => h.n)).toEqual([15, 8, 15]);
    const second = keep('a', 3, 5, 2);
    run(second.state, second.map, none(), 100);
    expect(second.state.huts[1].n).toBe(10);
    const neutral = keep(null, 3, 5);
    run(neutral.state, neutral.map, none(), 100);
    expect(neutral.state.huts[1].n).toBe(3);
  });

  it('is cloned with its wound', () => {
    const { map, state } = keep(null, 4, 3);
    const orders = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 1 }], b: [] };
    run(state, map, orders, 30);
    expect(state.huts[1]).toMatchObject({ n: 3, hurt: 1 });
    const copy = cloneState(state);
    expect(copy.huts[1]).toMatchObject({ n: 3, hurt: 1 });
    copy.huts[1].hurt = 0;
    expect(state.huts[1].hurt).toBe(1);
  });
});

describe('the computer and the new ground', () => {
  it('counts a fort at two lives a defender', () => {
    const short = keep(null, 4, 10);
    expect(cpuOrders(short.state, short.map, 'a')).toEqual([]);
    const enough = keep(null, 4, 11);
    const orders = { a: cpuOrders(enough.state, enough.map, 'a'), b: [] };
    expect(orders.a).toEqual([{ tick: 1, kind: 'all', from: 0, to: 1 }]);
    run(enough.state, enough.map, orders, 60);
    expect(enough.state.huts[1].owner).toBe('a');
    // The same eleven take a hut of four with half of them.
    const hut = duel(null, 4, 11);
    expect(cpuOrders(hut.state, hut.map, 'a')).toEqual([{ tick: 1, kind: 'half', from: 0, to: 1 }]);
    // A wound already taken is a life less to pay for.
    short.state.huts[1].hurt = 1;
    expect(cpuOrders(short.state, short.map, 'a')).toEqual([{ tick: 1, kind: 'all', from: 0, to: 1 }]);
  });

  it('costs a hut of a stronger army at more than it holds, and of a weaker one at less', () => {
    const facing = (sourceN: number, targetN: number, mine: number, theirs: number) => {
      const { map, state } = duel('b', targetN, sourceN);
      state.army.a.strength = mine;
      state.army.b.strength = theirs;
      const orders = { a: cpuOrders(state, map, 'a'), b: [] };
      run(state, map, orders, 140);
      return { orders: orders.a, owner: state.huts[1].owner };
    };
    // Each of five at strength 3 costs an army of none two units, and so does each one bred on the way.
    expect(facing(22, 5, 0, 3)).toEqual({ orders: [{ tick: 1, kind: 'hut', from: 0, to: 0 }], owner: 'b' });
    expect(facing(23, 5, 0, 3)).toEqual({ orders: [{ tick: 1, kind: 'all', from: 0, to: 1 }], owner: 'a' });
    // And twenty of none cost an army at strength 3 ten.
    expect(facing(14, 20, 3, 0)).toEqual({ orders: [], owner: 'b' });
    expect(facing(15, 20, 3, 0)).toEqual({ orders: [{ tick: 1, kind: 'all', from: 0, to: 1 }], owner: 'a' });
  });

  it('counts what a held hut breeds while the column climbs to it', () => {
    const ordersOn = (kind: PathKind, up?: number) => {
      const { map } = lane(kind, up, 18);
      map.sites[1] = { ...map.sites[1], owner: 'b', n: 5 };
      return cpuOrders(newState(map), map, 'a');
    };
    // Eighteen take 76 ticks to be in along a road, 116 up the climb and 66 down it: seven bred, eleven and six.
    expect(ordersOn('road')).toEqual([{ tick: 1, kind: 'all', from: 0, to: 1 }]);
    expect(ordersOn('climb', 1)).toEqual([]);
    expect(ordersOn('climb', 0)).toEqual([{ tick: 1, kind: 'all', from: 0, to: 1 }]);
  });

  it('crosses a ford for a hut it can still take with what the ford leaves, and says the send is risky', () => {
    const across = (sourceN: number, counted = 0) => {
      const { map } = lane('ford', undefined, sourceN);
      map.sites[1] = { ...map.sites[1], owner: null, n: 5 };
      const state = newState(map);
      state.tolls = [counted];
      return { map, state, orders: { a: cpuOrders(state, map, 'a'), b: [] } };
    };
    expect(across(9).orders.a).toEqual([]);
    const enough = across(10);
    expect(enough.orders.a).toStrictEqual([{ tick: 1, kind: 'all', from: 0, to: 1, risky: true }]);
    expect(tollsOver(enough.state, enough.map, enough.orders, 100).length).toBe(2);
    expect(enough.state.huts[1].owner).toBe('a');
    // With three counted already the first over dies, and that is one too many.
    expect(across(10, 3).orders.a).toEqual([]);
  });

  it('walks its rear up by the roads, not over the spikes that are nearer the front', () => {
    // The rear hut 0, and two ways on to b's hut 2: straight by hut 3, or round by huts 1 and 4.
    const rear = (a: number, b: number) => {
      const map = mapOf(
        [
          { x: 100, y: 300, owner: 'a', n: 10, level: 1 },
          { x: 250, y: 100, owner: 'a', n: 0, level: 1 },
          { x: 700, y: 300, owner: 'b', n: 40, level: 1 },
          { x: 400, y: 300, owner: 'a', n: 0, level: 1 },
          { x: 550, y: 100, owner: 'a', n: 0, level: 1 },
        ],
        [[3, 1], [0, 4], [3, 4], [0, 2], [1, 2]],
        [{ a, b, kind: 'spikes' }]
      );
      return cpuOrders(newState(map), map, 'a');
    };
    expect(rear(0, 3)).toStrictEqual([{ tick: 1, kind: 'all', from: 0, to: 1 }]);
    // Nor by a road to a hut that has only spikes between it and the front.
    expect(rear(2, 3)).toStrictEqual([{ tick: 1, kind: 'all', from: 0, to: 1 }]);
  });

  it('a full hut with nothing to buy and only a ford it cannot afford before it sends what it has to the front', () => {
    const idle = (n: number) => {
      const map = mapOf(
        [
          { x: 100, y: 300, owner: 'a', n, level: 3 },
          { x: 300, y: 500, owner: null, n: 200, level: 1 },
          { x: 300, y: 100, owner: 'a', n: 0, level: 1 },
          { x: 600, y: 100, owner: 'b', n: 99, level: 1 },
        ],
        [[1, 2], [0], [0, 3], [2]],
        [{ a: 0, b: 1, kind: 'ford' }]
      );
      const state = newState(map);
      state.army.a = { speed: 3, strength: 3, luck: 0 };
      return cpuOrders(state, map, 'a');
    };
    expect(idle(80)).toStrictEqual([{ tick: 1, kind: 'all', from: 0, to: 2 }]);
    expect(idle(79)).toEqual([]);
  });
});

// Both seats played by the computer. Seat b thinks half a think after seat a: a map is the same from both ends and
// a fight favours neither side, so two computers thinking on one tick would mirror each other all the way to the clock.
function playOut(state: SwarmState, map: SwarmMap, orders: Record<Seat, Order[]>, to: number, onStep?: (state: SwarmState) => void): void {
  while (state.tick < to && state.winner === null) {
    if (state.tick % CPU_THINK_TICKS === 0) orders.a.push(...cpuOrders(state, map, 'a'));
    if (state.tick % CPU_THINK_TICKS === CPU_THINK_TICKS / 2) orders.b.push(...cpuOrders(state, map, 'b'));
    step(state, map, orders);
    onStep?.(state);
  }
}

describe.each(MAP_IDS)('two computers on the %s map', (id) => {
  it.each([1, 2, 3, 4])('seed %i: play to a result, and a second client fed the same orders sees the same game', (seed) => {
    const map = buildMap(seed, id);
    const state = newState(map);
    const orders = none();
    const theirMap = buildMap(seed, id);
    const theirs = newState(theirMap);
    let predicted: SwarmState | null = null;
    const astray = new Set<number>();
    playOut(state, map, orders, MATCH_TICKS, (s) => {
      for (const unit of s.units) {
        const kind = pathOf(map, unit.from, unit.to)?.kind;
        if (!kind || (takesToll(kind) && !unit.risky)) astray.add(unit.id);
      }
      step(theirs, theirMap, orders);
      if (s.tick % 250 === 0 || s.winner !== null) expect(theirs).toEqual(s);
      if (s.tick === 500) predicted = cloneState(s);
    });
    // No unit off the paths, and none on a toll that was not sent the risky way.
    expect([...astray]).toEqual([]);
    expect(['a', 'b', 'draw']).toContain(state.winner);
    expect(state.tick).toBeGreaterThan(500);
    expect(state.tick).toBeLessThanOrEqual(MATCH_TICKS);
    expect(orders.a.length).toBeGreaterThan(10);
    expect(orders.b.length).toBeGreaterThan(10);
    // The orders went over the wire between the two.
    expect(decodeOrders(encodeOrders(orders.a))).toStrictEqual(orders.a);

    expect(predicted).not.toBeNull();
    if (predicted) {
      run(predicted, theirMap, orders, MATCH_TICKS);
      expect(JSON.stringify({ ...(predicted as SwarmState), events: [], shots: [] })).toBe(JSON.stringify({ ...state, events: [], shots: [] }));
    }
  });
});

describe('two computers and the toll', () => {
  it.each<[MapId, PathKind]>([['thorns', 'spikes'], ['bridges', 'ford']])('on %s they do send columns over the %s, and pay for it', (id, kind) => {
    let sends = 0;
    let deaths = 0;
    for (const seed of [1, 2, 3, 4]) {
      const map = buildMap(seed, id);
      const state = newState(map);
      const orders = none();
      let died = 0;
      playOut(state, map, orders, MATCH_TICKS, (s) => {
        for (const event of s.events) {
          if (event.kind !== 'toll') continue;
          expect(pathOf(map, event.from, event.to)?.kind).toBe(kind);
          died++;
        }
      });
      expect(state.tolls.reduce((sum, n) => sum + Math.floor(n / TOLL_EVERY), 0)).toBe(died);
      sends += [...orders.a, ...orders.b].filter((order) => order.risky).length;
      deaths += died;
    }
    expect(sends).toBeGreaterThan(0);
    expect(deaths).toBeGreaterThan(0);
  });
});

// A player who sends from its own huts to anywhere on the map, toll or none, and buys what it can, on the throw of a seeded die.
function scramble(state: SwarmState, map: SwarmMap, seat: Seat, rnd: () => number, rate: number): Order[] {
  const int = (n: number) => Math.floor(rnd() * n);
  const orders: Order[] = [];
  state.huts.forEach((hut, from) => {
    if (hut.owner !== seat || rnd() > rate) return;
    const roll = rnd();
    if (roll < 0.12) orders.push({ tick: state.tick + 1, kind: (['hut', 'speed', 'strength'] as const)[int(3)], from, to: from });
    else orders.push({ tick: state.tick + 1, kind: roll < 0.6 ? 'half' : 'all', from, to: int(map.sites.length), ...(rnd() < 0.4 && { risky: true }) });
  });
  return orders;
}

// What has to hold of a state after any tick, whatever orders went into it.
function faults(state: SwarmState, map: SwarmMap, lastNextId: number): string[] {
  const found: string[] = [];
  const whole = (n: number) => Number.isInteger(n) && n >= 0;
  state.huts.forEach((hut, index) => {
    if (!whole(hut.n)) found.push(`hut ${index} holds ${hut.n}`);
    if (![1, 2, 3].includes(hut.level)) found.push(`hut ${index} is level ${hut.level}`);
    if (!hut.owner && hut.out.length > 0) found.push(`hut ${index} sends with no owner`);
    for (const line of hut.out) {
      if (!whole(line.n) || line.n === 0) found.push(`hut ${index} has ${line.n} to send`);
      if (!map.links[index].includes(line.to)) found.push(`hut ${index} sends to ${line.to}, which no path joins it to`);
    }
    if (hut.hurt !== undefined && ![0, 1].includes(hut.hurt)) found.push(`fort ${index} is hurt ${hut.hurt}`);
  });
  let last = 0;
  for (const unit of state.units) {
    if (unit.id <= last || unit.id >= state.nextId) found.push(`unit ${unit.id} after ${last}, next ${state.nextId}`);
    last = unit.id;
    const path = pathOf(map, unit.from, unit.to);
    if (!path) found.push(`unit ${unit.id} walks from ${unit.from} to ${unit.to}, where no path is`);
    else if (!whole(unit.d) || unit.d >= pathLength(map, unit.from, unit.to)) found.push(`unit ${unit.id} is ${unit.d} along its path`);
    else if (takesToll(path.kind) && !unit.risky) found.push(`unit ${unit.id} is on a toll it was not sent over`);
  }
  for (const seat of SEATS) {
    const army = state.army[seat];
    if (![army.speed, army.strength].every((level) => [0, 1, 2, 3].includes(level))) found.push(`army ${seat} is ${JSON.stringify(army)}`);
    if (!whole(army.luck) || army.luck >= LUCK_DEN) found.push(`army ${seat} has luck ${army.luck}`);
  }
  if (state.nextId < lastNextId) found.push(`next id fell from ${lastNextId} to ${state.nextId}`);
  return found;
}

type Stand = { lane: number; at: number; seat: Seat };
// Where each unit stands, measured from the lower-numbered hut of its path.
const standing = (state: SwarmState, map: SwarmMap) =>
  new Map<number, Stand>(
    state.units.map((u) => [
      u.id,
      { lane: Math.min(u.from, u.to) * 100 + Math.max(u.from, u.to), at: u.from < u.to ? u.d : pathLength(map, u.from, u.to) - u.d, seat: u.seat },
    ])
  );
// The pairs of enemies that were on one path before and after a tick and are level now or have changed places.
function passed(before: Map<number, Stand>, after: Map<number, Stand>): string[] {
  const found: string[] = [];
  const lanes = new Map<number, Record<Seat, [was: number, now: number][]>>();
  for (const [id, now] of after) {
    const was = before.get(id);
    if (was?.lane !== now.lane) continue;
    const lane = lanes.get(now.lane) ?? { a: [], b: [] };
    lanes.set(now.lane, lane);
    lane[now.seat].push([was.at, now.at]);
  }
  for (const [at, lane] of lanes) {
    for (const p of lane.a) {
      for (const q of lane.b) if (Math.sign(p[0] - q[0]) !== Math.sign(p[1] - q[1])) found.push(`${p} and ${q} on ${at}`);
    }
  }
  return found;
}

const withoutDrawing = (state: SwarmState) => JSON.stringify({ ...state, events: [], shots: [] });

describe.each(MAP_IDS)('a scrambled game on the %s map', (id) => {
  // On the third seed seat b is the computer.
  const play = (seed: number, to: number, onStep?: (state: SwarmState, map: SwarmMap) => void) => {
    const map = buildMap(seed, id);
    const state = newState(map);
    const orders = none();
    const rnd = mulberry32(seed * 977 + 3);
    while (state.tick < to && state.winner === null) {
      orders.a.push(...scramble(state, map, 'a', rnd, 0.1 + 0.05 * seed));
      if (seed !== 3) orders.b.push(...scramble(state, map, 'b', rnd, 0.1 + 0.05 * seed));
      else if (state.tick % CPU_THINK_TICKS === 0) orders.b.push(...cpuOrders(state, map, 'b'));
      step(state, map, orders);
      onStep?.(state, map);
    }
    return { map, state, orders };
  };

  it('keeps every count whole, every unit on a path, and no two enemies ever pass or stand level', () => {
    let clashes = 0;
    let most = 0;
    for (const seed of [1, 2, 3]) {
      let nextId = 1;
      let stood = new Map<number, Stand>();
      play(seed, 600, (state, map) => {
        expect(faults(state, map, nextId)).toEqual([]);
        nextId = state.nextId;
        const stand = standing(state, map);
        expect(passed(stood, stand)).toEqual([]);
        stood = stand;
        clashes += state.events.filter((event) => event.kind === 'clash').length + state.shots.length;
        most = Math.max(most, state.units.length);
      });
    }
    // Enough was fought for the checks to have had something to see. On the guns map it is the towers that fight.
    expect(clashes).toBeGreaterThan(100);
    expect(most).toBeGreaterThan(30);
  });

  it('is the same game on a client that got the orders off the wire, ran it in pieces and kept it as text between them', () => {
    for (const seed of [1, 3]) {
      const { state, orders } = play(seed, 600);
      const theirMap = buildMap(seed, id);
      // Their copy of seat a's orders came in another order, but for the orders of one tick.
      const late = orders.a.filter((order) => order.tick % 2 === 0);
      const wire = { a: decodeOrders(encodeOrders([...late, ...orders.a.filter((order) => order.tick % 2 === 1)])), b: decodeOrders(encodeOrders(orders.b)) };
      let theirs = newState(theirMap);
      for (let to = 97; to < state.tick; to += 97) {
        run(theirs, theirMap, wire, to);
        theirs = JSON.parse(JSON.stringify(theirs)) as SwarmState;
      }
      run(theirs, theirMap, wire, state.tick);
      expect(withoutDrawing(theirs)).toBe(withoutDrawing(state));
      expect(state.nextId).toBeGreaterThan(200);
    }
  });

  it('never throws on orders no honest client would send, and keeps its counts whole through them', () => {
    const map = buildMap(5, id);
    const state = newState(map);
    const orders = none();
    const rnd = mulberry32(55);
    const int = (n: number) => Math.floor(rnd() * n);
    const wire = '0123456789abcdefghijklmnopqrstuvwxyz';
    const letters = 'ahuvpxyzAHUVPXYZ';
    const odd = [NaN, -1, 1.5, 1e9, Infinity, undefined, 0, 1, 2, 3];
    let nextId = 1;
    while (state.tick < 500 && state.winner === null) {
      orders.a.push(...scramble(state, map, 'a', rnd, 0.3));
      // What the database's rule for the text lets through, then what only a bug in a client could make.
      const text = Array.from({ length: 6 }, () => `${(state.tick + int(3)).toString(36)}:${letters[int(letters.length)]}${wire[int(36)]}${wire[int(36)]}`).join(',');
      orders.b.push(...decodeOrders(text), ...scramble(state, map, 'b', rnd, 0.3));
      orders.b.push({ tick: state.tick + 1, kind: (['half', 'all', 'hut', 'speed', undefined] as const)[int(5)], from: odd[int(odd.length)], to: odd[int(odd.length)] } as unknown as Order);
      step(state, map, orders);
      expect(faults(state, map, nextId)).toEqual([]);
      nextId = state.nextId;
    }
    expect(orders.b.length).toBeGreaterThan(3000);
    expect(state.nextId).toBeGreaterThan(200);
  });
});

describe('orders that do not hold', () => {
  it('do nothing at all: from a hut that is not the seat\'s, to nowhere, for no tick, or for more than the hut can pay', () => {
    const map = buildMap(2, 'guns');
    const [tower] = towersOf(map);
    const fresh = () => {
      const state = newState(map);
      state.huts[tower].owner = 'a';
      state.huts[tower].n = 60;
      return state;
    };
    const neutral = map.sites.findIndex((site) => site.owner === null && !site.tower);
    const far = map.sites.length;
    const bad: Order[] = [
      { tick: 1, kind: 'all', from: 1, to: 0 },
      { tick: 1, kind: 'all', from: neutral, to: 0 },
      { tick: 1, kind: 'all', from: 0, to: 0 },
      { tick: 1, kind: 'half', from: 0, to: far },
      { tick: 1, kind: 'half', from: 0, to: -1 },
      { tick: 1, kind: 'half', from: 0, to: NaN },
      { tick: 1, kind: 'half', from: 0, to: 1.5 },
      { tick: 1, kind: 'all', from: far, to: 0 },
      { tick: 1, kind: 'all', from: 0.5, to: 1 },
      { tick: 0, kind: 'all', from: 0, to: 1 },
      { tick: NaN, kind: 'all', from: 0, to: 1 },
      { tick: 1, kind: 'hut', from: 0, to: 0 },
      { tick: 1, kind: 'speed', from: 0, to: 0 },
      { tick: 1, kind: 'strength', from: 1, to: 1 },
      { tick: 1, kind: 'hut', from: tower, to: tower },
      { tick: 1, kind: 'speed', from: tower, to: tower },
      ...decodeOrders('1:x00,1:Z01,1:q10'),
    ];
    const state = fresh();
    const untouched = fresh();
    step(state, map, { a: bad, b: [] });
    step(untouched, map, none());
    expect(state).toEqual(untouched);
    // The same orders from the hut that can pay are taken.
    state.huts[0].n = 60;
    step(state, map, { a: [{ tick: 2, kind: 'speed', from: 0, to: 0 }, { tick: 2, kind: 'half', from: tower, to: 0 }], b: [] });
    expect(state.army.a.speed).toBe(1);
    expect(state.units.map((u) => u.from)).toEqual([tower]);
  });

  it('thousands for one tick commit the hut once and buy only what it can pay for', () => {
    const { map, state } = duel(null, 9, 90);
    const many = (order: Order) => Array.from({ length: 3000 }, () => order);
    step(state, map, { a: [...many({ tick: 1, kind: 'strength', from: 0, to: 0 }), ...many({ tick: 1, kind: 'all', from: 0, to: 1 }), ...many({ tick: 1, kind: 'half', from: 0, to: 1 })], b: [] });
    // Twenty and thirty-five are paid, and the thirty-five left cannot pay fifty.
    expect(state.army.a).toMatchObject({ strength: 2 });
    expect(state.huts[0]).toMatchObject({ n: 35, out: [{ to: 1, dest: 1, n: 35 }] });
  });
});

// For each hut, the one at the half-turn of the board from it.
const twinsOf = (map: SwarmMap) =>
  map.sites.map((site) => map.sites.findIndex((other) => other.x === map.w - site.x && other.y === 2 * centreOf(map).y - site.y));

describe('neither seat has the better end', () => {
  it.each(MAP_IDS)('%s: the way between two huts\' twins is the twin of the way between the huts', (id) => {
    let ways = 0;
    for (const seed of MAP_SEEDS) {
      const map = buildMap(seed, id);
      const twin = twinsOf(map);
      expect(twin).not.toContain(-1);
      const odd: number[][] = [];
      for (const risky of [false, true]) {
        map.sites.forEach((_, from) =>
          map.sites.forEach((_, to) => {
            const hop = nextHop(map, from, to, risky);
            if (nextHop(map, twin[from], twin[to], risky) !== (hop === -1 ? -1 : twin[hop])) odd.push([from, to]);
            if (hop !== -1) ways++;
          })
        );
      }
      expect(odd).toEqual([]);
    }
    expect(ways).toBeGreaterThan(5000);
  });

  // The state with its huts renumbered and its seats renamed. By their twins and each for the other, it is the
  // state as the other seat sees it from its own end of the board.
  const seen = (state: SwarmState, twin: number[], swap: (owner: Owner) => Owner) => {
    return {
      huts: state.huts.map((_, index) => {
        const hut = state.huts[twin[index]];
        const out = hut.out.map((line) => `${twin[line.to]} ${twin[line.dest]} ${line.n} ${line.risky === true}`).sort();
        return { ...hut, owner: swap(hut.owner), out };
      }),
      units: state.units.map((u) => `${swap(u.seat)} ${twin[u.from]} ${twin[u.to]} ${twin[u.dest]} ${u.d} ${u.risky === true}`).sort(),
      army: { a: state.army[swap('a') as Seat], b: state.army[swap('b') as Seat] },
    };
  };

  it.each(MAP_IDS)('%s: two players who give each other\'s orders from opposite ends stay level to the last tick', (id) => {
    let clashes = 0;
    let taken = 0;
    for (const seed of [1, 2, 3]) {
      const map = buildMap(seed, id);
      const twin = twinsOf(map);
      const state = newState(map);
      const orders = none();
      const rnd = mulberry32(seed * 31 + 7);
      while (state.tick < 900 && state.winner === null) {
        const mine = scramble(state, map, 'a', rnd, 0.15);
        orders.a.push(...mine);
        orders.b.push(...mine.map((order) => ({ ...order, from: twin[order.from], to: twin[order.to] })));
        step(state, map, orders);
        clashes += state.events.filter((event) => event.kind === 'clash').length;
        taken += state.events.filter((event) => event.kind === 'capture').length;
        if (state.tick % 20 > 0) continue;
        const plain = seen(state, twin.map((_, index) => index), (owner) => owner);
        expect(seen(state, twin, (owner) => owner && otherSeat(owner))).toEqual(plain);
      }
      expect(state.winner).toBeNull();
      expect(countOf(state, 'a')).toEqual(countOf(state, 'b'));
    }
    expect(clashes).toBeGreaterThan(20);
    expect(taken).toBeGreaterThan(20);
  });

  // A hut of nobody's between the two sides' first huts, 120 from each.
  function between(n: number, aHolds: number, bHolds: number): { map: SwarmMap; state: SwarmState } {
    const map = mapOf(
      [
        { x: 100, y: 300, owner: 'a', n: aHolds, level: 1 },
        { x: 340, y: 300, owner: 'b', n: bHolds, level: 1 },
        { x: 220, y: 300, owner: null, n, level: 1 },
      ],
      [[2], [2], [0, 1]]
    );
    return { map, state: newState(map) };
  }
  const bothSend = { a: [{ tick: 1, kind: 'all' as const, from: 0, to: 2 }], b: [{ tick: 1, kind: 'all' as const, from: 1, to: 2 }] };

  it('two columns that reach one hut in step fight at its door, and the hut is left alone', () => {
    const { map, state } = between(4, 5, 5);
    let clashes = 0;
    advance(state, map, bothSend, 40, null, (s) => {
      clashes += s.events.filter((event) => event.kind === 'clash').length;
      expect(s.events.filter((event) => event.kind === 'hit' || event.kind === 'capture')).toEqual([]);
    });
    // Sent in one after the other, the ants killed three of the four and the bees the last, and the hut was the ants'.
    expect(clashes).toBe(5);
    expect(state.huts[2]).toMatchObject({ owner: null, n: 4 });
    expect(state.units).toEqual([]);
  });

  it('what one column has over the other goes on in to the hut', () => {
    const { map, state } = between(4, 8, 5);
    run(state, map, bothSend, 40);
    expect(state.huts[2]).toMatchObject({ owner: null, n: 1 });
    const more = between(4, 10, 5);
    run(more.state, more.map, bothSend, 44);
    expect(more.state.huts[2]).toMatchObject({ owner: 'a', n: 1 });
  });

  it.each([[1, 2], [2, 1]])('an empty hut keeps its owner when its relief and its attacker arrive together, whichever was made first (%i, %i)', (relief, attacker) => {
    const { map, state } = between(0, 5, 5);
    state.huts[2].owner = 'a';
    state.units = [
      { id: relief, seat: 'a' as const, from: 0, to: 2, dest: 2, d: 114 },
      { id: attacker, seat: 'b' as const, from: 1, to: 2, dest: 2, d: 114 },
    ].sort((p, q) => p.id - q.id);
    state.nextId = 3;
    step(state, map, none());
    expect(state.huts[2]).toMatchObject({ owner: 'a', n: 0 });
    expect(state.units).toEqual([]);
  });

  it('enemies cannot come onto a path level through one hut: the one that would follow the other in has met it at the door', () => {
    // An ant walks through its own empty hut for the bees' on the tick two faster bees reach it: one to stay, one to walk on.
    const map = mapOf(
      [
        { x: 100, y: 300, owner: 'a', n: 5, level: 1 },
        { x: 300, y: 300, owner: 'a', n: 0, level: 1 },
        { x: 600, y: 300, owner: 'b', n: 5, level: 1 },
        { x: 300, y: 200, owner: 'b', n: 5, level: 1 },
        { x: 300, y: 400, owner: 'b', n: 5, level: 1 },
      ],
      [[1], [0, 2, 3, 4], [1], [1], [1]]
    );
    const state = newState(map);
    state.army.b.speed = 1;
    state.units = [
      { id: 1, seat: 'a', from: 0, to: 1, dest: 2, d: 198 },
      { id: 2, seat: 'b', from: 3, to: 1, dest: 1, d: 98 },
      { id: 3, seat: 'b', from: 4, to: 1, dest: 0, d: 98 },
    ];
    state.nextId = 4;
    step(state, map, none());
    // Before, the ant and the second bee both stood at the start of the path to hut 2, and the bee walked off ahead.
    expect(state.units).toEqual([]);
    expect(state.huts[1]).toMatchObject({ owner: 'b', n: 1 });
  });
});
