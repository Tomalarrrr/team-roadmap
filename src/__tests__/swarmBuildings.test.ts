import { describe, it, expect } from 'vitest';
import {
  BURN_COST,
  BURN_FUSE,
  BURN_TICKS,
  CLASSIC,
  HUT_CAP,
  MAP_IDS,
  MATCH_TICKS,
  SIZE_IDS,
  burnCost,
  buildMap,
  closedOn,
  cpuOrders,
  newState,
  pathLength,
  unitSpeed,
  step,
  upgradeCost,
  type PathKind,
  type Rules,
  type Seat,
  type Site,
  type SwarmMap,
  type SwarmState,
  type Unit,
} from '../swarmGameLogic';
import { calloutsFor } from '../components/swarm/swarmFeel';
import { tunnelSight } from '../components/swarm/swarmSceneBuilt';

const BUILT: Rules = { ...CLASSIC, twists: ['buildings'] };

function mapOf(sites: Site[], ways: [number, number, PathKind][], rules: Rules = BUILT): SwarmMap {
  const links = sites.map((_, at) => ways.flatMap(([a, b]) => (a === at ? [b] : b === at ? [a] : [])));
  const paths = ways.map(([a, b, kind]) => ({ a: Math.min(a, b), b: Math.max(a, b), kind }));
  const sides = (['a', 'b'] as const).filter((seat) => sites.some((site) => site.owner === seat));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides, homes: sides.map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks: MATCH_TICKS, rules };
}

const hut = (x: number, owner: Seat | null, n: number, more: Partial<Site> = {}): Site => ({ x, y: 300, owner, n, level: 1, ...more });

let nextId = 1000;
function put(state: SwarmState, seat: Seat, from: number, to: number, d: number, more: Partial<Unit> = {}): Unit {
  const unit: Unit = { id: nextId++, seat, from, to, dest: to, d, ...more };
  state.units.push(unit);
  return unit;
}

const run = (state: SwarmState, map: SwarmMap, ticks: number) => {
  for (let t = 0; t < ticks; t++) step(state, map, {});
};

describe('a trap', () => {
  // a's home, the trap, and b's home a long way off.
  const ground = () => mapOf([hut(100, 'a', 5), hut(400, null, 0, { building: 'trap' }), hut(900, 'b', 5)], [[0, 1, 'road'], [1, 2, 'road']]);

  it('kills every second unit, in the order they were made, of the column still walking in when it is taken', () => {
    const map = ground();
    const state = newState(map);
    const length = pathLength(map, 0, 1);
    const first = put(state, 'a', 0, 1, length - 1);
    const rest = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => put(state, 'a', 0, 1, length - 10 - k * 8));
    const theirs = put(state, 'b', 2, 1, 5);
    step(state, map, {});
    expect(state.huts[1].owner).toBe('a');
    expect(state.events.filter((e) => e.kind === 'trap')).toEqual([{ kind: 'trap', hut: 1, seat: 'a', dead: 4 }]);
    expect(state.units.map((u) => u.id)).toEqual([rest[0], rest[2], rest[4], rest[6], theirs].map((u) => u.id));
    expect(state.units).not.toContain(first);
    expect(state.huts[1].building).toBeUndefined();
    expect(map.sites[1].building).toBe('trap');
  });

  it('is a hut like any other once it has gone off', () => {
    const map = ground();
    const state = newState(map);
    put(state, 'a', 0, 1, pathLength(map, 0, 1) - 1);
    step(state, map, {});
    const n = state.huts[1].n;
    run(state, map, 40);
    expect(state.huts[1].n).toBe(n + 4);
    put(state, 'b', 2, 1, pathLength(map, 1, 2) - 1);
    put(state, 'b', 2, 1, pathLength(map, 1, 2) - 30);
    run(state, map, 1);
    expect(state.events.some((e) => e.kind === 'trap')).toBe(false);
  });
});

describe('the buildings that never breed', () => {
  // a holds the building at 1 and the huts 0 and 2 either side of it; 3 is a hut of a's off on its own, 4 is b's.
  const ground = (building: Site['building'], n = 10) =>
    mapOf(
      [hut(100, 'a', 5), hut(300, 'a', n, { building }), hut(500, 'a', 29), hut(700, 'a', 29), hut(950, 'b', 5)],
      [[0, 1, 'road'], [1, 2, 'road'], [2, 3, 'road'], [3, 4, 'road']],
    );

  it.each(['barracks', 'granary', 'beacon'] as const)('a %s never breeds, and cannot be made bigger', (building) => {
    const map = ground(building);
    const state = newState(map);
    expect(upgradeCost(map, state, 1, 'hut')).toBeNull();
    expect(upgradeCost(map, state, 0, 'hut')).not.toBeNull();
    run(state, map, 100);
    expect(state.huts[1].n).toBe(10);
    expect(state.huts[0].n).toBe(15);
  });

  it('a barracks sends out units that each live through one fight on a path', () => {
    const map = ground('barracks');
    const state = newState(map);
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 1, to: 2 }] });
    run(state, map, 12);
    expect(state.units.length).toBe(5);
    expect(state.units.every((u) => u.tough)).toBe(true);

    const duel = mapOf([hut(100, 'a', 5), hut(500, 'b', 5)], [[0, 1, 'road']]);
    const fight = newState(duel);
    const mid = Math.floor(pathLength(duel, 0, 1) / 2);
    const ours = put(fight, 'a', 0, 1, mid - 2, { tough: true });
    put(fight, 'b', 1, 0, mid - 2);
    run(fight, duel, 1);
    expect(fight.units).toEqual([ours]);
    expect(ours.tough).toBeUndefined();
    put(fight, 'b', 1, 0, pathLength(duel, 0, 1) - ours.d - 12);
    run(fight, duel, 2);
    expect(fight.units).toEqual([]);
  });

  it('a barracks toughens what walks on through it, and nothing that stops there', () => {
    const map = ground('barracks');
    const state = newState(map);
    const passing = put(state, 'a', 0, 1, pathLength(map, 0, 1) - 1, { dest: 3 });
    const stopping = put(state, 'a', 0, 1, pathLength(map, 0, 1) - 1);
    run(state, map, 1);
    expect(state.units).toEqual([{ ...passing, from: 1, to: 2, tough: true }]);
    expect(state.units).not.toContain(stopping);
    expect(state.huts[1].n).toBe(11);
  });

  it('a unit out of a barracks takes a hut of one where a plain one only empties it', () => {
    const duel = mapOf([hut(100, 'a', 5), hut(500, 'b', 1)], [[0, 1, 'road']]);
    const tough = newState(duel);
    put(tough, 'a', 0, 1, pathLength(duel, 0, 1) - 1, { tough: true });
    run(tough, duel, 1);
    expect(tough.huts[1]).toMatchObject({ owner: 'a', n: 1 });
    const plain = newState(duel);
    put(plain, 'a', 0, 1, pathLength(duel, 0, 1) - 1);
    run(plain, duel, 1);
    expect(plain.huts[1]).toMatchObject({ owner: 'b', n: 0 });
  });

  it('a granary lets the huts next to it breed half as many again, while its owner holds it', () => {
    const map = ground('granary');
    const state = newState(map);
    run(state, map, 300);
    expect(state.huts[2].n).toBe((HUT_CAP[0] * 3) / 2);
    expect(state.huts[3].n).toBe(HUT_CAP[0]);
    state.huts[1].owner = 'b';
    state.huts[2].n = 40;
    run(state, map, 100);
    expect(state.huts[2].n).toBe(40);
  });

  it('a beacon quickens what leaves it and what walks on through it, and nothing that only walks to it', () => {
    const map = ground('beacon');
    const state = newState(map);
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 1, to: 3 }] });
    run(state, map, 3);
    expect(state.units.length).toBeGreaterThan(0);
    expect(state.units.every((u) => u.fast && unitSpeed(state, u) === 1)).toBe(true);

    const through = newState(map);
    const passing = put(through, 'a', 0, 1, pathLength(map, 0, 1) - 1, { dest: 3 });
    const stopping = put(through, 'a', 0, 1, pathLength(map, 0, 1) - 1);
    expect(unitSpeed(through, passing)).toBe(0);
    run(through, map, 1);
    expect(through.units).toEqual([{ ...passing, from: 1, to: 2, fast: true }]);
    expect(through.units).not.toContain(stopping);
    expect(unitSpeed(through, passing)).toBe(1);
    through.army.a.speed = 3;
    expect(unitSpeed(through, passing)).toBe(3);
  });
});

describe('where the buildings go', () => {
  const strip = (map: SwarmMap) => ({ ...map, rules: CLASSIC, sites: map.sites.map((site) => {
      const plain = { ...site };
      delete plain.building;
      return plain;
    }) });

  it.each(MAP_IDS)('on the %s map they leave the ground as it was, and none is built without the twist', (id) => {
    for (const sides of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']] as Seat[][]) {
      for (const seed of [1, 2, 3]) {
        const plain = buildMap(seed, id, sides, 'medium', CLASSIC);
        expect(plain.sites.some((site) => site.building)).toBe(false);
        expect(strip(buildMap(seed, id, sides, 'medium', BUILT))).toEqual(plain);
      }
    }
  });

  it('each kind is built at the images of one hut under the turn, never at or next to a start', () => {
    const seen = new Set<string>();
    for (const id of MAP_IDS) {
      for (const sides of [['a', 'b'], ['a', 'b', 'c', 'd']] as Seat[][]) {
        for (const size of SIZE_IDS) {
          for (let seed = 1; seed <= 6; seed++) {
            const map = buildMap(seed, id, sides, size, BUILT);
            expect(buildMap(seed, id, sides, size, BUILT)).toEqual(map);
            // The turn is about the middle of the starts, which is not always the middle of the world.
            const centre = { x: map.homes.reduce((x, home) => x + map.sites[home].x, 0) / sides.length, y: map.homes.reduce((y, home) => y + map.sites[home].y, 0) / sides.length };
            map.sites.forEach((site, at) => {
              if (!site.building) return;
              seen.add(site.building);
              expect(site.owner).toBeNull();
              expect(site.tower || site.fort).toBeFalsy();
              for (const home of map.homes) expect([home, ...map.links[home]]).not.toContain(at);
              const images = map.sites.filter((other) => other.building === site.building);
              expect(images.length).toBe(sides.length);
              expect(images).toContainEqual(expect.objectContaining({ x: 2 * centre.x - site.x, y: 2 * centre.y - site.y }));
            });
          }
        }
      }
    }
    expect([...seen].sort()).toEqual(['barracks', 'beacon', 'granary', 'trap']);
  });

  it('any kind can be the one built where there is room for only one or two', () => {
    const seen = new Set<string>();
    for (const id of MAP_IDS) {
      for (let seed = 1; seed <= 10; seed++) {
        const map = buildMap(seed, id, ['a', 'b'], 'small', BUILT);
        const kinds = new Set(map.sites.flatMap((site) => (site.building ? [site.building] : [])));
        if (kinds.size <= 2) for (const kind of kinds) seen.add(kind);
      }
    }
    expect([...seen].sort()).toEqual(['barracks', 'beacon', 'granary', 'trap']);
  });
});

describe('a burning bridge', () => {
  // a holds 1 at the near end of the bridge, b holds 2 at the far end, and both homes are off on a road.
  const ground = (rules: Rules = BUILT, kind: PathKind = 'bridge') =>
    mapOf([hut(50, 'a', 5), hut(150, 'a', 30), hut(850, 'b', 30), hut(950, 'b', 5)], [[0, 1, 'road'], [1, 2, kind], [2, 3, 'road']], rules);
  const burn = (tick: number) => ({ a: [{ tick, kind: 'burn' as const, from: 1, to: 2 }] });

  it('can only be lit with the buildings twist, and only a bridge', () => {
    expect(burnCost(newState(ground(CLASSIC)), ground(CLASSIC), 1, 2)).toBeNull();
    expect(burnCost(newState(ground(BUILT, 'road')), ground(BUILT, 'road'), 1, 2)).toBeNull();
    expect(burnCost(newState(ground()), ground(), 1, 2)).toBe(BURN_COST);
    expect(burnCost(newState(ground()), ground(), 0, 1)).toBeNull();
    const map = ground(CLASSIC);
    const state = newState(map);
    step(state, map, burn(1));
    expect(state.fuses).toEqual([]);
    expect(state.huts[1].n).toBe(30);
  });

  it('costs BURN_COST of the hut, and is not lit by a hut that cannot pay', () => {
    const map = ground();
    const poor = newState(map);
    poor.huts[1].n = BURN_COST - 1;
    step(poor, map, burn(1));
    expect(poor.fuses).toEqual([]);
    expect(poor.huts[1].n).toBe(BURN_COST - 1);

    const state = newState(map);
    step(state, map, burn(1));
    expect(state.huts[1].n).toBe(30 - BURN_COST);
    expect(state.fuses).toEqual([{ path: 1, from: 1, seat: 'a', burns: 1 + BURN_FUSE }]);
    expect(state.events).toContainEqual({ kind: 'light', path: 1, from: 1, seat: 'a' });
    step(state, map, burn(2));
    expect(state.fuses.length).toBe(1);
    expect(state.huts[1].n).toBe(30 - BURN_COST);
  });

  it('goes down after BURN_FUSE ticks with everything on it, stays down BURN_TICKS, and is not burnt again for BURN_TICKS more', () => {
    const map = ground();
    const state = newState(map);
    step(state, map, burn(1));
    const length = pathLength(map, 1, 2);
    for (const d of [0, 20, length - 6 * BURN_FUSE - 40]) put(state, 'b', 2, 1, d);
    run(state, map, BURN_FUSE - 1);
    expect(closedOn(state, state.tick)).toBeUndefined();
    expect(state.units.length).toBe(3);
    step(state, map, {});
    expect(state.tick).toBe(1 + BURN_FUSE);
    expect(state.events).toContainEqual({ kind: 'burn', path: 1, seat: 'a', dead: 3 });
    expect(state.units).toEqual([]);
    const down = state.tick;
    expect(closedOn(state, down + BURN_TICKS - 1)!.paths.has(1)).toBe(true);
    expect(closedOn(state, down + BURN_TICKS)).toBeUndefined();
    run(state, map, BURN_TICKS);
    expect(burnCost(state, map, 1, 2)).toBeNull();
    run(state, map, BURN_TICKS - 1);
    expect(burnCost(state, map, 1, 2)).toBeNull();
    run(state, map, 1);
    expect(burnCost(state, map, 1, 2)).toBe(BURN_COST);
  });

  it('goes out when the hut it was lit from is taken before it burns', () => {
    const map = ground();
    const state = newState(map);
    step(state, map, burn(1));
    state.huts[1].owner = 'b';
    step(state, map, {});
    expect(state.fuses).toEqual([]);
    expect(state.events).toContainEqual({ kind: 'doused', path: 1, seat: 'a' });
    run(state, map, BURN_FUSE);
    expect(state.closed[1]).toBe(0);
  });

  it('is lit by the computer when enough of another side will go down with it, and not for fewer', () => {
    const lit = (n: number) => {
      const map = ground();
      const state = newState(map);
      for (let k = 0; k < n; k++) put(state, 'b', 2, 1, k * 4);
      return cpuOrders(state, map, 'a').filter((order) => order.kind === 'burn');
    };
    expect(lit(7)).toEqual([]);
    expect(lit(8)).toEqual([{ tick: 1, kind: 'burn', from: 1, to: 2 }]);
  });

  it('is called out to the sides that did not light it', () => {
    const map = ground();
    const before = newState(map);
    const after = newState(map);
    step(after, map, burn(1));
    expect(calloutsFor(before, after, map, 'b', false)).toContain('bridgeAlight');
    expect(calloutsFor(before, after, map, 'a', false)).not.toContain('bridgeAlight');
  });
});

describe('a tunnel', () => {
  // a's home, a tunnel or a road to 1, then on to b. A tower of b's stands over the middle of it.
  const ground = (kind: PathKind) =>
    mapOf([hut(100, 'a', 5), hut(700, null, 0), hut(950, 'b', 5), { x: 400, y: 360, owner: 'b', n: 10, level: 1, tower: true }], [[0, 1, kind], [1, 2, 'road']], CLASSIC);

  it('lets sides pass each other at road pace, and no tower reaches it', () => {
    for (const kind of ['tunnel', 'road'] as const) {
      const map = ground(kind);
      const state = newState(map);
      const mid = Math.floor(pathLength(map, 0, 1) / 2);
      const ours = put(state, 'a', 0, 1, mid - 3);
      put(state, 'b', 1, 0, mid - 3);
      run(state, map, 1);
      expect(ours.d).toBe(mid + 3);
      expect(state.units.length).toBe(kind === 'tunnel' ? 2 : 0);
    }
    for (const kind of ['tunnel', 'road'] as const) {
      const map = ground(kind);
      const state = newState(map);
      put(state, 'a', 0, 1, 280);
      run(state, map, 1);
      expect(state.shots.length).toBe(kind === 'tunnel' ? 0 : 1);
    }
  });

  it('shows another side only the last of its column, and its own side all of it, fainter underground', () => {
    const map = ground('tunnel');
    const length = pathLength(map, 0, 1);
    const unit: Unit = { id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 0 };
    expect(tunnelSight(map, unit, length / 2, length, 'b')).toBe(0);
    expect(tunnelSight(map, unit, length * 0.84, length, 'b')).toBe(0);
    expect(tunnelSight(map, unit, length - 44, length, 'b')).toBe(1);
    expect(tunnelSight(map, unit, length / 2, length, 'a')).toBeCloseTo(0.4);
    expect(tunnelSight(map, unit, 10, length, 'a')).toBe(1);
    expect(tunnelSight(map, { ...unit, to: 1 }, 10, length, 'b')).toBe(0);
    expect(tunnelSight(ground('road'), unit, length / 2, length, 'b')).toBe(1);
  });
});

describe('the warren', () => {
  it.each([2, 3, 4])('digs four tunnels for %i sides, each with its twin under the turn, none from a start or sharing an end', (count) => {
    const sides = (['a', 'b', 'c', 'd'] as const).slice(0, count);
    for (const size of SIZE_IDS) {
      for (let seed = 1; seed <= 8; seed++) {
        const map = buildMap(seed, 'warren', [...sides], size);
        expect(buildMap(seed, 'warren', [...sides], size)).toEqual(map);
        const tunnels = map.paths.filter((path) => path.kind === 'tunnel');
        expect(tunnels.length).toBe(4);
        const ends = tunnels.flatMap((path) => [path.a, path.b]);
        expect(new Set(ends).size).toBe(ends.length);
        for (const end of ends) expect(map.homes).not.toContain(end);
        const centre = { x: map.homes.reduce((x, home) => x + map.sites[home].x, 0) / count, y: map.homes.reduce((y, home) => y + map.sites[home].y, 0) / count };
        const image = (at: number) => map.sites.findIndex((site) => Math.abs(site.x - (2 * centre.x - map.sites[at].x)) <= 1 && Math.abs(site.y - (2 * centre.y - map.sites[at].y)) <= 1);
        for (const path of tunnels) expect(tunnels).toContainEqual(expect.objectContaining({ a: Math.min(image(path.a), image(path.b)), b: Math.max(image(path.a), image(path.b)) }));
      }
    }
  });
});
