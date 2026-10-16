// The flood on the board: water over the paths and huts that have gone under,
// and the next ring marked before it goes, so it is never a surprise. The ring
// due next has a dashed line of water round each of its huts from the moment
// the last ring went; over its final FLOOD_WARN ticks water spreads out of the
// ground at each hut and runs in along its paths, reaching the doors as the
// ring goes under.

import { FLOOD_WARN, floodDue, floodsOf, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { PALETTE, ellipse, pathPoint, siteRadius } from './swarmSceneKit';

/** World units across the water over a drowned path, and its darker middle. */
const PATH_WATER = 15;
const PATH_DEEP = 8;
/** Points a path's water is drawn through: paths are gentle curves. */
const PATH_STEPS = 12;
/** How far above a drowned hut's foot the water stands, in its radius: low enough that the roof stands out of the pool. */
const WATERLINE = 0.15;

function strokeAlong(ctx: CanvasRenderingContext2D, map: SwarmMap, from: number, to: number, f0: number, f1: number) {
  ctx.beginPath();
  for (let i = 0; i <= PATH_STEPS; i++) {
    const p = pathPoint(map, from, to, f0 + ((f1 - f0) * i) / PATH_STEPS);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function waterOn(ctx: CanvasRenderingContext2D, map: SwarmMap, from: number, to: number, f0: number, f1: number) {
  const water = PALETTE[map.scene].water;
  ctx.lineCap = 'round';
  ctx.lineWidth = PATH_WATER;
  ctx.strokeStyle = water.shallow;
  strokeAlong(ctx, map, from, to, f0, f1);
  ctx.lineWidth = PATH_DEEP;
  ctx.strokeStyle = water.mid;
  strokeAlong(ctx, map, from, to, f0, f1);
}

/**
 * Drawn over the ground and under the huts. `tick` is the frame's tick with
 * its fraction, so the water creeps and does not step.
 */
export function drawFlood(ctx: CanvasRenderingContext2D, map: SwarmMap, state: SwarmState, tick: number): void {
  const floods = floodsOf(map);
  if (floods.length === 0) return;
  const water = PALETTE[map.scene].water;
  for (const flood of floods) {
    if (flood.tick > state.tick) break;
    for (const at of flood.paths) waterOn(ctx, map, map.paths[at].a, map.paths[at].b, 0, 1);
  }

  const due = floodDue(map, state.tick + 1);
  if (!due || due.tick - tick > map.rules.tune.floodEvery) return;
  const ring = new Set(due.huts);
  // 0 until the last FLOOD_WARN ticks, then rising to 1 as the ring goes under.
  const rise = Math.min(1, Math.max(0, 1 - (due.tick - tick) / FLOOD_WARN));
  ctx.setLineDash([5, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = water.mid;
  ctx.globalAlpha = 0.75;
  for (const at of due.huts) {
    const r = siteRadius(map.sites[at], state.huts[at].level);
    ellipse(ctx, map.sites[at].x, map.sites[at].y + 2, r * 1.5, r * 0.62);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (rise > 0) {
    ctx.globalAlpha = 0.35 + 0.55 * rise;
    for (const at of due.paths) {
      const { a, b } = map.paths[at];
      // From each end in the ring towards the middle: a path with both ends in it fills from both.
      if (ring.has(a)) waterOn(ctx, map, a, b, 0, rise * (ring.has(b) ? 0.5 : 0.7));
      if (ring.has(b)) waterOn(ctx, map, b, a, 0, rise * (ring.has(a) ? 0.5 : 0.7));
    }
    for (const at of due.huts) {
      const r = siteRadius(map.sites[at], state.huts[at].level) * 1.35 * rise;
      ctx.fillStyle = water.shallow;
      ellipse(ctx, map.sites[at].x, map.sites[at].y + 2, r, r * 0.45);
      ctx.fill();
      ctx.fillStyle = water.mid;
      ellipse(ctx, map.sites[at].x, map.sites[at].y + 2, r * 0.7, r * 0.3);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * A hut gone under: a pool where it stood, the top of its roof above the
 * water, and rings spreading out from it. `roof` draws the hut as nobody's, in
 * world units; only what is above the water is kept.
 */
export function drawDrowned(ctx: CanvasRenderingContext2D, map: SwarmMap, at: number, level: number, now: number, roof: () => void): void {
  const site = map.sites[at];
  const water = PALETTE[map.scene].water;
  const r = siteRadius(site, level);
  ctx.fillStyle = water.sand;
  ellipse(ctx, site.x, site.y + 2, r * 1.45, r * 0.62);
  ctx.fill();
  ctx.fillStyle = water.mid;
  ellipse(ctx, site.x, site.y + 2, r * 1.3, r * 0.52);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.rect(site.x - r * 3, site.y - r * 4, r * 6, r * 4 - r * WATERLINE);
  ctx.clip();
  ctx.globalAlpha = 0.75;
  roof();
  ctx.restore();
  // Two rings out from the roof, one after the other: the water is still settling over it.
  ctx.strokeStyle = water.shallow;
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 2; k++) {
    const t = ((now / 2400 + k / 2 + at * 0.37) % 1 + 1) % 1;
    ctx.globalAlpha = 0.7 * (1 - t);
    ellipse(ctx, site.x, site.y - r * 0.5, r * (0.5 + t * 0.75), r * (0.2 + t * 0.3));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
