import { describe, it, expect } from 'vitest';
import {
  CLASSIC,
  MAP_IDS,
  SEATS,
  SIZE_IDS,
  START_UNITS,
  advance,
  buildMap,
  centreOf,
  newState,
  type Computer,
  type Nest,
  type Seat,
  type Site,
  type SizeId,
  type StartId,
  type SwarmMap,
} from '../swarmGameLogic';

// The starts decided when the map is built: close, scattered and nests. Each
// is checked on every map, size and number of sides over eight seeds.

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const SIDES: Seat[][] = [['a', 'b'], ['a', 'b', 'c'], [...SEATS]];

interface Board {
  label: string;
  seed: number;
  size: SizeId | undefined;
  map: SwarmMap;
  home: SwarmMap;
}

function boards(start: StartId, nests: Partial<Record<Seat, Nest>> = {}, sideCounts = [2, 3, 4]): Board[] {
  const out: Board[] = [];
  for (const id of MAP_IDS) {
    for (const sides of SIDES.filter((each) => sideCounts.includes(each.length))) {
      for (const size of [undefined, ...SIZE_IDS]) {
        for (const seed of SEEDS) {
          out.push({
            label: `${id}, ${sides.length} sides, ${size ?? 'own size'}, seed ${seed}`,
            seed,
            size,
            map: buildMap(seed, id, sides, size, { ...CLASSIC, start, nests }),
            home: buildMap(seed, id, sides, size),
          });
        }
      }
    }
  }
  return out;
}

type Move = (map: SwarmMap, site: { x: number; y: number }) => { x: number; y: number };
const cy = (map: SwarmMap) => centreOf(map).y;
// The moves that take the first side's start to each other side's, in the map's order of the sides.
const IMAGES: Move[] = [
  (_, p) => p,
  (map, p) => ({ x: map.w - p.x, y: 2 * cy(map) - p.y }),
  (map, p) => ({ x: map.w - p.x, y: p.y }),
  (map, p) => ({ x: p.x, y: 2 * cy(map) - p.y }),
];

const heldBy = (map: SwarmMap, seat: Seat, move: Move = IMAGES[0]) =>
  map.sites
    .filter((site) => site.owner === seat)
    .map((site) => {
      const p = move(map, site);
      return `${p.x},${p.y} level ${site.level} n ${site.n}`;
    })
    .sort();

const extrasOf = (map: SwarmMap, k: number) => map.sites.flatMap((site, at) => (site.owner === map.sides[k] && at !== map.homes[k] ? [at] : []));
const span = (p: Site, q: Site) => Math.hypot(p.x - q.x, p.y - q.y);
const ownTo = (map: SwarmMap, k: number, at: number) =>
  map.homes.every((other, j) => j === k || span(map.sites[at], map.sites[map.homes[k]]) < span(map.sites[at], map.sites[other]));

function hopsBetween(map: SwarmMap, from: number, to: number): number {
  const hops = map.sites.map(() => Infinity);
  hops[from] = 0;
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    for (const next of map.links[queue[head]]) {
      if (hops[next] !== Infinity) continue;
      hops[next] = hops[queue[head]] + 1;
      queue.push(next);
    }
  }
  return hops[to];
}

const nearestHomes = (map: SwarmMap) =>
  Math.min(...map.homes.flatMap((p, i) => map.homes.slice(i + 1).map((q) => hopsBetween(map, p, q))));

/** What the board holds, wherever it stands. */
const contents = (map: SwarmMap) => map.sites.map(({ owner, n, level, tower, fort }) => JSON.stringify({ owner, n, level, tower, fort })).sort();

describe('every start decided when the map is built', () => {
  const STARTS: [string, StartId, Partial<Record<Seat, Nest>>][] = [
    ['home', 'home', {}],
    ['close', 'close', {}],
    ['scattered', 'scattered', {}],
    ['nests, all big', 'nests', {}],
    ['nests, all many', 'nests', { a: 'many', b: 'many', c: 'many', d: 'many' }],
  ];

  it.each(STARTS)('keeps the board the same for every side with the %s start', (_, start, nests) => {
    let boardsSeen = 0;
    for (const { label, map } of boards(start, nests)) {
      boardsSeen++;
      const sides = map.sides.length;
      const first = heldBy(map, map.sides[0]);
      for (let k = 1; k < (sides === 4 ? 4 : 2); k++) expect(heldBy(map, map.sides[k], IMAGES[k]), label).toEqual(first);
      if (sides === 3) expect(heldBy(map, 'c', IMAGES[1]), label).toEqual(heldBy(map, 'c'));
    }
    expect(boardsSeen).toBe(MAP_IDS.length * 3 * (SIZE_IDS.length + 1) * SEEDS.length);
  });

  it.each(STARTS)('builds the same board from the same seed with the %s start', (_, start, nests) => {
    for (const id of MAP_IDS) {
      const rules = { ...CLASSIC, start, nests };
      expect(buildMap(5, id, SEATS.slice(0, 3), 'medium', rules)).toEqual(buildMap(5, id, SEATS.slice(0, 3), 'medium', rules));
    }
  });

  it('leaves the map of the home start and the draft as a classic one', () => {
    for (const { label, map, home } of boards('draft')) {
      expect(map.sites, label).toEqual(home.sites);
      expect(map.homes, label).toEqual(home.homes);
    }
    for (const { label, map, home } of boards('home', {}, [3])) expect(map.sites, label).toEqual(home.sites);
  });
});

describe('the close start', () => {
  const all = boards('close');

  it('never puts two homes next door, and never further apart than the map put them', () => {
    for (const { label, map, home } of all) {
      const apart = nearestHomes(map);
      expect(apart, label).toBeGreaterThanOrEqual(2);
      expect(apart, label).toBeLessThanOrEqual(nearestHomes(home));
    }
  });

  it('puts homes 2 paths apart on most boards and on some board of every map', () => {
    const two = all.filter(({ map }) => nearestHomes(map) === 2);
    expect(two.length).toBeGreaterThan(all.length * 0.7);
    for (const id of MAP_IDS) expect(two.some(({ map }) => map.id === id), id).toBe(true);
  });

  it('moves a home by trading places with a hut, so the board holds what it held', () => {
    let moved = 0;
    for (const { label, map, home } of all.filter(({ map }) => map.sides.length !== 3)) {
      expect(contents(map), label).toEqual(contents(home));
      if (map.homes[0] !== home.homes[0]) moved++;
    }
    expect(moved).toBeGreaterThan(0);
  });
});

describe('the scattered start', () => {
  const all = boards('scattered');

  it('gives two and four sides two huts besides the home, each of level 1 with 5 units, in their own part of the board', () => {
    for (const { label, map } of all.filter(({ map }) => map.sides.length !== 3)) {
      map.sides.forEach((_, k) => {
        const extras = extrasOf(map, k);
        expect(extras, label).toHaveLength(2);
        for (const at of extras) {
          expect(map.sites[at], label).toMatchObject({ level: 1, n: START_UNITS });
          expect(ownTo(map, k, at), label).toBe(true);
        }
      });
    }
  });

  it('gives the middle of three a hut and its image for each hut a seat is given, and the seats the same as each other', () => {
    let paired = 0;
    const three = all.filter(({ map }) => map.sides.length === 3);
    for (const { label, map, home } of three) {
      const given = (k: number) => extrasOf(map, k).length - extrasOf(home, k).length;
      expect(extrasOf(map, 0).length, label).toBe(extrasOf(map, 1).length);
      expect(given(2), label).toBeLessThanOrEqual(2 * given(0));
      if (given(0) > 0 && given(2) === 2 * given(0)) paired++;
    }
    // A few small crossroads leave a seat's part no open hut, and so nothing to pair.
    expect(paired).toBeGreaterThan(three.length * 0.9);
  });

  it('spreads the huts out further than the nearest two would stand', () => {
    const closest = (map: SwarmMap, huts: number[]) =>
      Math.min(...huts.flatMap((p, i) => huts.slice(i + 1).map((q) => span(map.sites[p], map.sites[q]))));
    let further = 0;
    let compared = 0;
    for (const { label, seed, size, map } of all.filter(({ map }) => map.sides.length === 2)) {
      const many = buildMap(seed, map.id, map.sides, size, { ...CLASSIC, start: 'nests', nests: { a: 'many' } });
      const near = extrasOf(many, 0)
        .sort((p, q) => span(many.sites[p], many.sites[many.homes[0]]) - span(many.sites[q], many.sites[many.homes[0]]))
        .slice(0, 2);
      if (near.length < 2) continue;
      compared++;
      const scattered = closest(map, [map.homes[0], ...extrasOf(map, 0)]);
      const nearest = closest(many, [many.homes[0], ...near]);
      if (JSON.stringify(many.homes) !== JSON.stringify(map.homes)) continue;
      expect(scattered, label).toBeGreaterThanOrEqual(nearest - 1e-9);
      if (scattered > nearest) further++;
    }
    expect(compared).toBeGreaterThan(0);
    expect(further).toBeGreaterThan(0);
  });
});

describe('the nests start', () => {
  it('makes a big nest a home of level 3 with 37 units and nothing else, but for two huts and their images in the middle of three', () => {
    let paired = 0;
    const all = boards('nests');
    for (const { label, map, home } of all) {
      map.sides.forEach((_, k) => {
        expect(map.sites[map.homes[k]], label).toMatchObject({ level: 3, n: 37 });
        const given = extrasOf(map, k).length - extrasOf(home, k).length;
        const middle = map.sides.length === 3 && k === 2;
        expect(middle ? [0, 2, 4] : [0], label).toContain(given);
        if (middle && given === 4) paired++;
      });
    }
    // Where the middle's part has too few open huts with open images it is given what there is: 148 of 192 boards had room for both.
    expect(paired).toBeGreaterThan(all.filter(({ map }) => map.sides.length === 3).length * 0.7);
  });

  it('gives a nest of many its nearest open huts of its own part, three on every map but a few small ones', () => {
    const all = boards('nests', { a: 'many', b: 'many', c: 'many', d: 'many' }, [2, 4]);
    let short = 0;
    for (const { label, map } of all) {
      map.sides.forEach((_, k) => {
        const extras = extrasOf(map, k);
        expect(extras.length, label).toBeGreaterThanOrEqual(2);
        expect(extras.length, label).toBeLessThanOrEqual(3);
        if (extras.length < 3) {
          short++;
          // Four corner islands on the archipelago hold too few huts for a third, and down the lanes on the small
          // ground, or the medium with four sides, the only other hut near enough is a tower.
          const lanes = map.id === 'lanes' && (map.size === 'small' || (map.size === 'medium' && map.sides.length === 4));
          expect(['guns', 'crossroads', 'archipelago'].includes(map.id) || lanes, label).toBe(true);
        }
        expect(map.sites[map.homes[k]], label).toMatchObject({ level: 1 });
        for (const at of extras) {
          expect(map.sites[at], label).toMatchObject({ level: 1, n: START_UNITS });
          expect(ownTo(map, k, at), label).toBe(true);
        }
      });
      // Nothing left open in the first side's part, whose images are open too, stands nearer its home than what it took.
      const home = map.sites[map.homes[0]];
      const furthest = Math.max(...extrasOf(map, 0).map((at) => span(map.sites[at], home)));
      map.sites.forEach((site, at) => {
        const images = IMAGES.slice(0, map.sides.length).map((move) => map.sites.find((other) => {
          const p = move(map, site);
          return other.x === p.x && other.y === p.y;
        }));
        const open = images.every((image) => image && !image.owner && !image.tower && !image.fort) && new Set(images).size === images.length;
        if (open && ownTo(map, 0, at)) expect(span(site, home), label).toBeGreaterThanOrEqual(furthest);
      });
    }
    // A side in twenty, over the sides of every board.
    expect(short).toBeLessThan(all.reduce((sum, { map }) => sum + map.sides.length, 0) / 20);
  });

  it('starts each side with the nest it picked, and a side that picked none big', () => {
    for (const id of MAP_IDS) {
      const map = buildMap(3, id, ['a', 'b'], undefined, { ...CLASSIC, start: 'nests', nests: { b: 'many' } });
      expect(map.sites[map.homes[0]], id).toMatchObject({ level: 3, n: 37 });
      expect(extrasOf(map, 0), id).toEqual([]);
      expect(map.sites[map.homes[1]], id).toMatchObject({ level: 1 });
      expect(extrasOf(map, 1).length, id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('a game from every start', () => {
  it.each(['close', 'scattered', 'nests'] as StartId[])('plays out the same twice with the %s start', (start) => {
    const play = () => {
      const map = buildMap(11, 'thorns', ['a', 'b', 'c'], undefined, { ...CLASSIC, start, nests: { a: 'many' } });
      const state = newState(map);
      const cpu: Computer = { a: 0, b: 0, c: 0 };
      advance(state, map, {}, 600, cpu);
      return state;
    };
    const first = play();
    // The game can end before the 600 ticks; it has to have been played well past the opening.
    expect(first.tick).toBeGreaterThan(300);
    expect(play()).toEqual(first);
  });
});
