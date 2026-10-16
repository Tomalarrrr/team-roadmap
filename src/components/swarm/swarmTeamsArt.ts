// Which huts on the board are an ally's, in teams and in survival (see teamOf).
// An ally's huts carry its own colour like everyone else's, so without a mark
// the viewer has to remember which of the other colours is on their side.

import { allied, type Seat, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { BADGE, ellipse, siteRadius, type Ctx } from './swarmSceneKit';

/**
 * A faint broken ring in the viewer's colour on the ground round every hut an
 * ally holds, drawn before the huts so that each stands in its own. Wider than
 * the rings an order draws, so one never sits on the other.
 */
export function drawAllies(ctx: Ctx, map: SwarmMap, state: SwarmState, seat: Seat): void {
  ctx.save();
  ctx.strokeStyle = BADGE[seat].fill;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([4, 5]);
  state.huts.forEach((hut, index) => {
    if (hut.owner === seat || !allied(map, hut.owner, seat)) return;
    const site = map.sites[index];
    const r = siteRadius(site, hut.level);
    ellipse(ctx, site.x, site.y + 2, r * 1.5, r * 0.6);
    ctx.stroke();
  });
  ctx.restore();
}
