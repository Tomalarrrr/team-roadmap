// The draft start as it is drawn: while the sides pick the huts they start
// from, each pick is a ring on the ground in its side's colour, so everyone
// sees where the others mean to start as soon as their picks land, and which
// huts are gone. The viewer's own is the heavier ring.

import { drafting, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { BADGE, siteRadius, type Ctx } from './swarmSceneKit';
import type { View } from './swarmRender';

export function drawPicks(ctx: Ctx, map: SwarmMap, state: SwarmState, view: View): void {
  if (!drafting(map, state.tick + 1)) return;
  ctx.save();
  map.sides.forEach((seat, k) => {
    const hut = state.picks[k];
    if (hut === -1) return;
    const site = map.sites[hut];
    const r = siteRadius(site, state.huts[hut].level);
    ctx.beginPath();
    ctx.ellipse(site.x, site.y + 2, r * 1.3, r * 0.5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = BADGE[seat].fill;
    ctx.lineWidth = seat === view.seat ? 3.2 : 1.6;
    ctx.stroke();
  });
  ctx.restore();
}
