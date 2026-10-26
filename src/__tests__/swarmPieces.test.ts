import { describe, it, expect } from 'vitest';
import {
  BUILDINGS,
  BUILT_GROUPS,
  CLASSIC,
  GUN_TYPES,
  HUT_CAP,
  MAP_IDS,
  MATCH_TICKS,
  PIECES,
  PIECE_IDS,
  RELOADS,
  SIZE_IDS,
  TOWER_START,
  advance,
  buildMap,
  cloneState,
  growTicks,
  newState,
  pathLength,
  reachOf,
  step,
  withPiece,
  type PathKind,
  type PieceId,
  type Rules,
  type Seat,
  type Site,
  type SwarmMap,
  type SwarmState,
  type Unit,
} from '../swarmGameLogic';
import { SIGHT_HUT, SIGHT_WATCH, fogOf, newFog } from '../components/swarm/swarmFog';

function mapOf(sites: Site[], ways: [number, number, PathKind][], rules: Rules = CLASSIC): SwarmMap {
  const links = sites.map((_, at) => ways.flatMap(([a, b]) => (a === at ? [b] : b === at ? [a] : [])));
  const paths = ways.map(([a, b, kind]) => ({ a: Math.min(a, b), b: Math.max(a, b), kind }));
  const sides = (['a', 'b'] as const).filter((seat) => sites.some((site) => site.owner === seat));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides, homes: sides.map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks: MATCH_TICKS, rules };
}

const site = (x: number, owner: Seat | null, n: number, y = 300): Site => ({ x, y, owner, n, level: 1 });

let nextId = 5000;
function put(state: SwarmState, seat: Seat, from: number, to: number, d: number, more: Partial<Unit> = {}): Unit {
  const unit: Unit = { id: nextId++, seat, from, to, dest: to, d, ...more };
  state.units.push(unit);
  return unit;
}

const run = (state: SwarmState, map: SwarmMap, ticks: number) => {
  for (let t = 0; t < ticks; t++) step(state, map, {});
};

describe('withPiece', () => {
  // A site that already stands as something, so each piece has to clear what was there.
  const armed: Site = { x: 300, y: 200, owner: 'a', n: 7, level: 2, tower: true, arm: 'mortar' };

  it.each(PIECE_IDS)('a site made a %s starts the game as one', (piece) => {
    const from = piece === 'hut' ? armed : { ...armed, tower: undefined, arm: undefined, building: 'granary' as const };
    const placed = withPiece(from, piece);
    expect(placed).toMatchObject({ x: 300, y: 200, owner: 'a' });
    const map = mapOf([placed, site(800, 'b', 5)], [[0, 1, 'road']]);
    const hut = newState(map).huts[0];
    const gun = piece === 'cannon' || (GUN_TYPES as readonly PieceId[]).includes(piece);
    const building = (BUILDINGS as readonly PieceId[]).includes(piece);
    expect(hut.reload !== undefined).toBe(gun);
    expect(hut.type).toBe(gun && piece !== 'cannon' ? piece : undefined);
    expect(hut.hurt !== undefined).toBe(piece === 'fort');
    expect(hut.building).toBe(building ? piece : undefined);
    expect(hut.n).toBe(gun ? TOWER_START : from.n);
    expect(hut.level).toBe(gun ? 1 : from.level);
  });

  it('names every piece once, and says what each does with figures and no dashes', () => {
    expect(new Set(PIECE_IDS).size).toBe(PIECE_IDS.length);
    expect(Object.keys(PIECES).sort()).toEqual([...PIECE_IDS].sort());
    for (const piece of PIECE_IDS) {
      expect(PIECES[piece].about).not.toMatch(/[—–]|undefined|NaN/);
      if (piece !== 'hut' && piece !== 'barracks' && piece !== 'beacon' && piece !== 'burrow') expect(PIECES[piece].about).toMatch(/\d/);
    }
  });
});

describe('the flame tower and the long gun', () => {
  // b's tower at 1, with a's home at 0 out along the road; units of a's are put on the road walking at the tower.
  const ground = (arm?: Site['arm']) => mapOf([site(100, 'a', 5), { ...site(500, 'b', TOWER_START), tower: true, ...(arm && { arm }) }, site(900, 'b', 5)], [[0, 1, 'road'], [1, 2, 'road']]);
  const at = (map: SwarmMap, away: number) => pathLength(map, 0, 1) - away;

  it('a flame burns every unit in its reach at once, and nothing past it', () => {
    const map = ground('flame');
    const state = newState(map);
    expect(reachOf(map, state, 1)).toBe(70);
    const close = [30, 45, 60].map((away) => put(state, 'a', 0, 1, at(map, away)));
    const far = put(state, 'a', 0, 1, at(map, 100));
    step(state, map, {});
    expect(state.units).toEqual([far]);
    expect(state.shots.map((shot) => shot.type)).toEqual(['flame', 'flame', 'flame']);
    expect(close.every((unit) => !state.units.includes(unit))).toBe(true);
    expect(state.huts[1].reload).toBe(RELOADS.flame[0]);
  });

  it('a cannon in the same place kills one of the same three', () => {
    const map = ground();
    const state = newState(map);
    [30, 45, 60].forEach((away) => put(state, 'a', 0, 1, at(map, away)));
    step(state, map, {});
    expect(state.units.length).toBe(2);
  });

  it('a flame leaves a unit its carapace on, and burns it the next time', () => {
    const map = ground('flame');
    const state = newState(map);
    state.army.a.carapace = true;
    const unit = put(state, 'a', 0, 1, at(map, 60));
    step(state, map, {});
    expect(state.units).toEqual([unit]);
    expect(unit.cracked).toBe(true);
    // Held where it is, so the second burst finds it in reach.
    unit.held = 100;
    run(state, map, RELOADS.flame[0]);
    expect(state.units).toEqual([]);
  });

  it('a long gun shoots the furthest unit in its reach, not the nearest', () => {
    const map = ground('longgun');
    const state = newState(map);
    expect(reachOf(map, state, 1)).toBe(200);
    const near = put(state, 'a', 0, 1, at(map, 60));
    const furthest = put(state, 'a', 0, 1, at(map, 180));
    const out = put(state, 'a', 0, 1, at(map, 240));
    step(state, map, {});
    expect(state.units).toEqual([near, out]);
    expect(state.units).not.toContain(furthest);
    expect(state.huts[1].reload).toBe(RELOADS.longgun[0]);
  });

  it('a cannon in the same place shoots the nearest', () => {
    const map = ground();
    const state = newState(map);
    put(state, 'a', 0, 1, at(map, 60));
    const furthest = put(state, 'a', 0, 1, at(map, 100));
    step(state, map, {});
    expect(state.units).toEqual([furthest]);
  });
});

describe('a hall', () => {
  // a holds a hut at 0 and a hall at 1, both level 1, and b sits far off.
  const ground = () => mapOf([site(100, 'a', 0), { ...site(300, 'a', 0), building: 'hall' }, site(900, 'b', 0)], [[0, 1, 'road'], [1, 2, 'road']]);

  it('breeds at half the pace of a hut of its level', () => {
    const map = ground();
    const state = newState(map);
    const every = growTicks(map, 1);
    run(state, map, every * 6);
    expect(state.huts[0].n).toBe(6);
    expect(state.huts[1].n).toBe(3);
  });

  it('holds twice the cap of a hut of its level', () => {
    const map = ground();
    const state = newState(map);
    state.huts[0].n = HUT_CAP[0];
    state.huts[1].n = HUT_CAP[0];
    run(state, map, growTicks(map, 1) * 2 * 4);
    expect(state.huts[0].n).toBe(HUT_CAP[0]);
    expect(state.huts[1].n).toBe(HUT_CAP[0] + 4);
    state.huts[1].n = 2 * HUT_CAP[0];
    run(state, map, growTicks(map, 1) * 2 * 4);
    expect(state.huts[1].n).toBe(2 * HUT_CAP[0]);
  });
});

describe('a watchtower', () => {
  // b's cannon at 1, b's watchtower at 2 next to it, and a column of a's 140 out: past a cannon's 110, inside 150.
  const ground = (watcher: Seat, rules: Rules = CLASSIC) =>
    mapOf(
      [site(100, 'a', 5), { ...site(500, 'b', TOWER_START), tower: true }, { ...site(700, watcher, 5), building: 'watch' }, site(900, 'b', 5)],
      [[0, 1, 'road'], [1, 2, 'road'], [2, 3, 'road']],
      rules,
    );

  it('lets its owner\'s tower next to it reach 40 further', () => {
    const map = ground('b');
    const state = newState(map);
    expect(reachOf(map, state, 1)).toBe(150);
    put(state, 'a', 0, 1, pathLength(map, 0, 1) - 140);
    step(state, map, {});
    expect(state.units).toEqual([]);
  });

  it('does nothing for a tower another side holds', () => {
    const map = ground('a');
    const state = newState(map);
    expect(reachOf(map, state, 1)).toBe(110);
    const unit = put(state, 'a', 0, 1, pathLength(map, 0, 1) - 140);
    step(state, map, {});
    expect(state.units).toEqual([unit]);
  });

  it('never breeds', () => {
    const map = ground('b');
    const state = newState(map);
    run(state, map, 200);
    expect(state.huts[2].n).toBe(5);
    expect(state.huts[3].n).toBeGreaterThan(5);
  });

  it('sees twice as far as a hut for its owner in the fog', () => {
    const map = ground('b', { ...CLASSIC, twists: ['fog'] });
    const state = newState(map);
    const eyes = fogOf(newFog(map, 'b')!, map, state).eyes;
    expect(eyes).toContainEqual(expect.objectContaining({ x: 700, y: 300, r: SIGHT_WATCH }));
    expect(eyes).toContainEqual(expect.objectContaining({ x: 900, y: 300, r: SIGHT_HUT }));
  });
});

describe('a burrow', () => {
  // a's hut at 0, the piece at 1 that a holds, a's hut at 2, and b's cannon at 3 off to the side of the road from 1 to 2.
  const ground = (piece: PieceId) =>
    mapOf(
      [site(100, 'a', 5), withPiece(site(300, 'a', 20), piece), site(500, 'a', 5), { ...site(400, 'b', TOWER_START, 370), tower: true }, site(900, 'b', 5, 600)],
      [[0, 1, 'road'], [1, 2, 'road'], [3, 4, 'road'], [2, 4, 'road']],
    );

  it('sends its units out of every tower\'s reach as far as the next hut', () => {
    const map = ground('burrow');
    const state = newState(map);
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 1, to: 2 }] });
    run(state, map, 30);
    expect(state.units.length).toBeGreaterThan(0);
    expect(state.units.every((unit) => unit.under)).toBe(true);
    expect(state.huts[3].reload).toBe(0);
  });

  it('out of a plain hut the same units are shot', () => {
    const map = ground('hut');
    const state = newState(map);
    step(state, map, { a: [{ tick: 1, kind: 'half', from: 1, to: 2 }] });
    run(state, map, 30);
    expect(state.units.some((unit) => unit.under)).toBe(false);
    expect(state.huts[3].reload).toBeGreaterThan(0);
  });

  it('takes under ground what walks on through it, and lets it up at the next hut it walks through', () => {
    const map = ground('burrow');
    const state = newState(map);
    const unit = put(state, 'a', 0, 1, pathLength(map, 0, 1) - 1, { dest: 4 });
    step(state, map, {});
    expect(unit).toMatchObject({ from: 1, to: 2, under: true });
    while (unit.to === 2 && state.units.includes(unit)) step(state, map, {});
    expect(unit).toMatchObject({ from: 2, to: 4 });
    expect(unit.under).toBeUndefined();
  });

  it('never breeds', () => {
    const map = ground('burrow');
    const state = newState(map);
    run(state, map, 200);
    expect(state.huts[1].n).toBe(20);
  });
});

describe('the buildings twist draws the new pieces too', () => {
  const BUILT: Rules = { ...CLASSIC, twists: ['buildings'] };

  it('builds every kind somewhere, never more than BUILT_GROUPS kinds on one board', () => {
    const seen = new Set<string>();
    for (const id of MAP_IDS) {
      for (const size of SIZE_IDS) {
        for (let seed = 1; seed <= 4; seed++) {
          const map = buildMap(seed, id, ['a', 'b'], size, BUILT);
          const kinds = new Set(map.sites.flatMap((s) => (s.building ? [s.building] : [])));
          expect(kinds.size).toBeLessThanOrEqual(BUILT_GROUPS);
          for (const kind of kinds) seen.add(kind);
        }
      }
    }
    expect([...seen].sort()).toEqual([...BUILDINGS].sort());
  });

  it('arms each tower and its images under the turn with one gun, and draws every gun', () => {
    const seen = new Set<string>();
    for (const sides of [['a', 'b'], ['a', 'b', 'c', 'd']] as Seat[][]) {
      for (let seed = 1; seed <= 12; seed++) {
        const map = buildMap(seed, 'guns', sides, 'medium', BUILT);
        const towers = map.sites.filter((s) => s.tower);
        expect(towers.length).toBeGreaterThan(0);
        const centre = { x: map.homes.reduce((x, home) => x + map.sites[home].x, 0) / sides.length, y: map.homes.reduce((y, home) => y + map.sites[home].y, 0) / sides.length };
        for (const tower of towers) {
          seen.add(tower.arm ?? 'cannon');
          const image = map.sites.find((s) => s.x === 2 * centre.x - tower.x && s.y === 2 * centre.y - tower.y);
          expect(image?.arm).toBe(tower.arm);
        }
        expect(buildMap(seed, 'guns', sides, 'medium', CLASSIC).sites.some((s) => s.arm)).toBe(false);
      }
    }
    expect([...seen].sort()).toEqual(['cannon', 'flame', 'longgun']);
  });
});

describe('a board of every piece', () => {
  // Every piece laid on the neutral huts of a real map, held by one side or the other, played by the computer on both.
  function everyPiece(): SwarmMap {
    const map = buildMap(3, 'meadow', ['a', 'b'], 'large', CLASSIC);
    const open = map.sites.flatMap((s, at) => (s.owner === null && !map.homes.some((home) => map.links[home].includes(at)) ? [at] : []));
    expect(open.length).toBeGreaterThanOrEqual(PIECE_IDS.length);
    const sites = map.sites.slice();
    PIECE_IDS.forEach((piece, k) => (sites[open[k]] = withPiece({ ...sites[open[k]], owner: k % 2 ? 'b' : 'a', n: 20 }, piece)));
    return { ...map, sites };
  }

  it('plays the same on two clients, and from a copy taken at any point', () => {
    const map = everyPiece();
    const cpu = { a: 0, b: 0 };
    const one = newState(map);
    advance(one, map, {}, 900, cpu);
    const two = newState(map);
    let underground = 0;
    for (let at = 50; at < 900; at += 50) {
      advance(two, map, {}, at, cpu);
      if (two.units.some((unit) => unit.under)) underground++;
      const copy = cloneState(two);
      // A tick on, as well as at the end: a unit can come up out of the ground before the end and hide that the copy lost it.
      advance(copy, map, {}, at + 1, cpu);
      advance(two, map, {}, at + 1, cpu);
      expect({ ...copy, events: [], shots: [] }).toEqual({ ...two, events: [], shots: [] });
      advance(copy, map, {}, 900, cpu);
      expect({ ...copy, events: [], shots: [] }).toEqual({ ...one, events: [], shots: [] });
    }
    // Without a unit under ground at some copy, the copy would not be tested on it.
    expect(underground).toBeGreaterThan(0);
    advance(two, map, {}, 900, cpu);
    expect({ ...two, events: [], shots: [] }).toEqual({ ...one, events: [], shots: [] });
    expect(one.tick).toBe(900);
  });
});
