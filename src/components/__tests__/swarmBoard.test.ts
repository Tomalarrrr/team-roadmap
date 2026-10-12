// What of a hut is drawn beyond its foot, against the edges of the board it is drawn on.
//
// What has to hold: on every map as it is dealt, a hut's count sits above its
// mast and not beside it, until the hut is raised to the third level; no hut's
// base runs off the bottom of the board; and the upgrade tokens of the hut in
// hand, prices and all, are on the board whichever hut that is, and on a
// desktop cover no hut and no hut's count.

import { describe, it, expect } from 'vitest';
import { MAP_IDS, buildMap, newState, type SwarmMap } from '../../swarmGameLogic';
import { TOKEN_R, badgeAside, tokenGrow, upgradeSpots } from '../swarm/swarmRender';
import { siteRadius, siteTop } from '../swarm/swarmSceneKit';

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe.each(MAP_IDS)('the board of the %s map', (id) => {
  it('has room over every hut for its mast and its count, at the first two levels', () => {
    for (const seed of SEEDS) {
      for (const site of buildMap(seed, id).sites) {
        expect(site.y - siteTop(site, 2)).toBeGreaterThan(0);
        expect([site.level, 1, 2].map((level) => badgeAside(site, level))).toEqual([false, false, false]);
      }
    }
  });

  it('has room under every hut for its base at any level', () => {
    for (const seed of SEEDS) {
      const map = buildMap(seed, id);
      // The lowest thing drawn of a hut is the shadow its pad casts: 0.55 of the pad's width below the foot.
      for (const site of map.sites) expect(site.y + siteRadius(site, 3) * 0.55).toBeLessThanOrEqual(map.h);
    }
  });

  // World units to a CSS pixel: the board at the 1000px the popup gives it, and at the 356px a phone does.
  const DESKTOP = (map: SwarmMap) => map.w / 1000;
  const PHONE = (map: SwarmMap) => map.w / 356;
  // Placing a hut's tokens is a search of the ground round it, and too slow to run on every layout: a third of them.
  const PLACED = SEEDS.filter((_, index) => index % 3 === 0);

  it('keeps the upgrade tokens of any hut on the board, at the size they are drawn on a desktop and on a phone', () => {
    const off: string[] = [];
    for (const seed of PLACED) {
      const map = buildMap(seed, id);
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
      const map = buildMap(seed, id);
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
