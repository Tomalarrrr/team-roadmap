// What of a hut is drawn beyond its foot, against the edges of the board it is
// drawn on, and the rows of the sheet the units are drawn from.
//
// What has to hold: on every map as it is dealt, for two, three or four sides
// and at every size, a hut's count sits above its mast and not beside it, until
// the hut is raised to the third level; no hut's base runs off the bottom of the
// board; and the upgrade tokens of the hut in hand, prices and all, are on the
// board whichever hut that is, and on a desktop cover no hut and no hut's
// count. The sheet has rows for the sides in the game and no others, and no two
// sides share one. Each creature's home is its own, at every level, and stays
// inside the sprite it is painted into.

import { describe, it, expect } from 'vitest';
import { KINDS, MAP_IDS, SEATS, SIZE_IDS, buildMap, kindsOf, mulberry32, newState, type Kind, type MapId, type SceneId, type Seat, type Site, type SizeId, type SwarmMap } from '../../swarmGameLogic';
import { TOKEN_R, badgeAside, sheetRows, tokenGrow, upgradeSpots } from '../swarm/swarmRender';
import { paintSite } from '../swarm/swarmSceneHuts';
import { PALETTE, siteRadius, siteTop, type Ctx } from '../swarm/swarmSceneKit';

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
/** Every other way a map can be dealt is a fresh layout of it, checked on fewer seeds to keep the run under a minute. */
const FEWER = SEEDS.slice(0, 40);

interface Layout {
  id: MapId;
  sides: readonly Seat[];
  size: SizeId | undefined;
  seeds: number[];
}

const LAYOUTS: Layout[] = MAP_IDS.flatMap((id) => [
  { id, sides: ['a', 'b'], size: undefined, seeds: SEEDS },
  ...[['a', 'b', 'c'] as const, SEATS].flatMap((sides) => SIZE_IDS.map((size) => ({ id, sides, size, seeds: FEWER }))),
]);

const nameOf = ({ id, sides, size }: Layout) => `${id} map for ${sides.length} sides at ${size ?? 'its own'} size`;

describe.each(LAYOUTS.map((layout) => [nameOf(layout), layout] as const))('the board of the %s', (_, { id, sides, size, seeds }) => {
  const dealt = (seed: number) => buildMap(seed, id, sides, size);

  it('has room over every hut for its mast and its count, at the first two levels', () => {
    for (const seed of seeds) {
      for (const site of dealt(seed).sites) {
        expect(site.y - siteTop(site, 2)).toBeGreaterThan(0);
        expect([site.level, 1, 2].map((level) => badgeAside(site, level))).toEqual([false, false, false]);
      }
    }
  });

  it('has room under every hut for its base at any level', () => {
    for (const seed of seeds) {
      const map = dealt(seed);
      // The lowest thing drawn of a hut is the shadow its pad casts: 0.55 of the pad's width below the foot.
      for (const site of map.sites) expect(site.y + siteRadius(site, 3) * 0.55).toBeLessThanOrEqual(map.h);
    }
  });

  // World units to a CSS pixel: the board at the 1000px the popup gives it, and at the 356px a phone does.
  const DESKTOP = (map: SwarmMap) => map.w / 1000;
  const PHONE = (map: SwarmMap) => map.w / 356;
  // Placing a hut's tokens is a search of the ground round it, and too slow to run on every layout: a third of them.
  const PLACED = seeds.filter((_, index) => index % 3 === 0);

  it('deals the sides it was asked for, each with a home of its own', () => {
    for (const seed of seeds.slice(0, 5)) {
      const map = dealt(seed);
      expect(map.sides).toEqual(sides);
      expect(map.homes.map((home) => map.sites[home].owner)).toEqual(sides);
      // Three sides start with more than a home each: see startThree.
      if (sides.length !== 3) expect(sides.map((seat) => map.sites.filter((site) => site.owner === seat).length)).toEqual(sides.map(() => 1));
    }
  });

  it('keeps the upgrade tokens of any hut on the board, at the size they are drawn on a desktop and on a phone', () => {
    const off: string[] = [];
    for (const seed of PLACED) {
      const map = dealt(seed);
      const state = newState(map);
      for (const px of [DESKTOP(map), PHONE(map)]) {
        const radius = TOKEN_R * tokenGrow(px);
        map.sites.forEach((_, hut) => {
          for (const spot of upgradeSpots(map, state, hut, px)) {
            // The price under a token ends 3 below its disc, at the token's own scale.
            const inside = spot.x - radius >= 0 && spot.x + radius <= map.w && spot.y - radius >= 0 && spot.y + radius + 3 * tokenGrow(px) <= map.h;
            if (!inside) off.push(`seed ${seed}: a token of hut ${hut} is off the board at ${spot.x}, ${spot.y}`);
          }
        });
      }
    }
    expect(off).toEqual([]);
  });

  it('puts the tokens of any hut over no hut, mast or count on a desktop', () => {
    const covered: string[] = [];
    for (const seed of PLACED) {
      const map = dealt(seed);
      const state = newState(map);
      const px = DESKTOP(map);
      const radius = TOKEN_R * tokenGrow(px);
      map.sites.forEach((_, hut) => {
        for (const spot of upgradeSpots(map, state, hut, px)) {
          map.sites.forEach((site, other) => {
            const r = siteRadius(site, site.level);
            // The building and its mast, and over them the bubble: 32 tall on a tail of 8, and 32 wide at the least.
            const top = site.y - siteTop(site, site.level) - 2;
            const overHut = spot.x + radius > site.x - r && spot.x - radius < site.x + r && spot.y + radius > top && spot.y - radius < site.y + r * 0.3;
            const overCount = spot.x + radius > site.x - 16 && spot.x - radius < site.x + 16 && spot.y + radius > top - 32 && spot.y - radius < top;
            if (overHut || overCount) covered.push(`seed ${seed}: a token of hut ${hut} is over hut ${other}`);
          });
        }
      });
    }
    expect(covered).toEqual([]);
  });
});

describe('the sheet of unit poses', () => {
  const LOOKS = kindsOf({ players: {} }, SEATS);

  it('gives each side in the game the rows of its creature, ants four coats, bees one row, beetles and spiders two coats', () => {
    expect(LOOKS).toEqual({ a: 'ant', b: 'bee', c: 'beetle', d: 'spider' });
    expect(sheetRows(SEATS, LOOKS)).toEqual({ first: { a: 0, b: 4, c: 5, d: 7 }, shadow: 9 });
  });

  it('paints no rows for a side not in the game', () => {
    expect(sheetRows(['a', 'b'], LOOKS)).toEqual({ first: { a: 0, b: 4 }, shadow: 5 });
    expect(sheetRows(['a', 'c'], { ...LOOKS, a: 'spider', c: 'bee' })).toEqual({ first: { a: 0, c: 2 }, shadow: 3 });
  });
});

/**
 * Paints a hut into a context that keeps a line for every call and every style set, and every point the drawing
 * reaches, moved by the translations in force. The painters move only by translating.
 */
function painted(kind: Kind, scene: SceneId, level: number) {
  const calls: string[] = [];
  const reach: { x: number; y: number }[] = [];
  let at = { x: 0, y: 0 };
  const saved: { x: number; y: number }[] = [];
  const mark = (...xy: number[]) => {
    for (let i = 0; i < xy.length; i += 2) reach.push({ x: at.x + xy[i], y: at.y + xy[i + 1] });
  };
  const ctx = new Proxy({} as Ctx, {
    get: (_, name: string) => (...args: number[]) => {
      calls.push(`${name}(${args.map((arg) => (typeof arg === 'number' ? arg.toFixed(2) : String(arg))).join(', ')})`);
      if (name === 'save') saved.push(at);
      if (name === 'restore') at = saved.pop()!;
      if (name === 'translate') at = { x: at.x + args[0], y: at.y + args[1] };
      if (['rotate', 'scale', 'setTransform', 'transform'].includes(name)) throw new Error(`the painter calls ${name}, which this does not follow`);
      if (['moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo'].includes(name)) mark(...args);
      if (name === 'ellipse') {
        // A turned ellipse is boxed by its longer radius both ways.
        const [x, y, rx, ry, turn] = args;
        const wide = turn ? Math.max(rx, ry) : rx;
        const tall = turn ? Math.max(rx, ry) : ry;
        mark(x - wide, y - tall, x + wide, y + tall);
      }
      if (name === 'roundRect') mark(args[0], args[1], args[0] + args[2], args[1] + args[3]);
      if (name === 'createLinearGradient' || name === 'createRadialGradient') return { addColorStop: (stop: number, colour: string) => calls.push(`stop(${stop}, ${colour})`) };
    },
    set: (_, name: string, value: unknown) => {
      calls.push(`${name} = ${typeof value === 'string' ? value : 'gradient'}`);
      return true;
    },
  });
  const site: Site = { x: 0, y: 0, owner: 'a', n: 0, level };
  paintSite(ctx, mulberry32(level * 7919), scene, site, 'a', kind, level);
  return { calls, reach, r: siteRadius(site, level) };
}

describe('the home of each creature', () => {
  const SCENES = Object.keys(PALETTE) as SceneId[];
  const LEVELS = [1, 2, 3];

  it('paints the same thing twice from the same seed, so two that differ are different drawings', () => {
    for (const kind of KINDS) {
      for (const level of LEVELS) {
        const first = painted(kind, 'meadow', level).calls;
        expect(first.length).toBeGreaterThan(200);
        expect(painted(kind, 'meadow', level).calls).toEqual(first);
      }
    }
  });

  it('is its own at every level: no two creatures share a drawing, and only the ants build of mound soil', () => {
    for (const scene of SCENES) {
      for (const level of LEVELS) {
        const drawings = KINDS.map((kind) => painted(kind, scene, level).calls.join('\n'));
        expect(new Set(drawings).size).toBe(KINDS.length);
        // The fill of an ant cone, and the cut wood of a beetle's stump.
        expect(drawings.map((drawing) => drawing.includes('fillStyle = #9a6a42'))).toEqual(KINDS.map((kind) => kind === 'ant'));
        expect(drawings.map((drawing) => drawing.includes('fillStyle = #c29a64'))).toEqual(KINDS.map((kind) => kind === 'beetle'));
      }
    }
  });

  it('stays inside the sprite it is painted into, which runs 1.7 half-widths to either side, 2.9 up and 0.7 down', () => {
    const out: string[] = [];
    for (const kind of KINDS) {
      for (const scene of SCENES) {
        for (const level of LEVELS) {
          const { reach, r } = painted(kind, scene, level);
          const beyond = reach.filter(({ x, y }) => Math.abs(x) > r * 1.7 || y < -r * 2.9 || y > r * 0.7);
          if (beyond.length > 0) out.push(`${kind} in the ${scene} at level ${level} reaches ${beyond[0].x.toFixed(1)}, ${beyond[0].y.toFixed(1)}`);
        }
      }
    }
    expect(out).toEqual([]);
  });
});
