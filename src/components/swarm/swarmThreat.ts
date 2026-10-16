// What is coming for you: every other side's columns on their way to your
// huts, how many and how soon, said at the hut they are going for.
//
// The whole board is always on screen (drawScene fits it to the canvas), so
// nothing marching on you can be off the edge of it, and there is no marker
// at the edge to point that way. The one thing said at the edge is a siege:
// the frame of the board takes on the colour of whoever is closing on your
// home, or on the last hut you have.

import { closedOn, nextHop, paceOn, pathLength, TICK_MS, type Closed, type Seat, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { GATE_COLUMN, homeOf } from './swarmFeel';
import { BADGE, fontOf, growOf, siteRadius } from './swarmSceneKit';

export interface Threat {
  hut: number;
  side: Seat;
  /** Units of `side` on the road to `hut`, and waiting at their huts to set out for it. */
  n: number;
  /** Until the first of them is at the door, in whole seconds and never under one. */
  secs: number;
}

/** A column smaller than this is left to the counts on the board. */
export const THREAT_LEAST = 3;

/** Ticks for a unit at `d` along the path from `from` to `to` to reach `dest`, by the way it will walk; null when it has none. */
function ticksTo(map: SwarmMap, closed: Closed | undefined, from: number, to: number, d: number, dest: number, risky: boolean, speed: number): number | null {
  let ticks = Math.ceil(Math.max(0, pathLength(map, from, to) - d) / paceOn(map, from, to, speed));
  for (let at = to; at !== dest; ) {
    const hop = nextHop(map, at, dest, risky, closed);
    if (hop === -1) return null;
    ticks += Math.ceil(pathLength(map, at, hop) / paceOn(map, at, hop, speed));
    at = hop;
  }
  return ticks;
}

/** Every other side's march on a hut `seat` holds, largest first. */
export function threatsOf(map: SwarmMap, state: SwarmState, seat: Seat): Threat[] {
  const closed = closedOn(state, state.tick + 1);
  const found = new Map<string, { hut: number; side: Seat; n: number; ticks: number }>();
  const add = (hut: number, side: Seat, n: number, ticks: number | null) => {
    const key = `${hut}${side}`;
    const threat = found.get(key) ?? { hut, side, n: 0, ticks: Infinity };
    threat.n += n;
    if (ticks !== null) threat.ticks = Math.min(threat.ticks, ticks);
    found.set(key, threat);
  };
  for (const unit of state.units) {
    if (unit.seat === seat || state.huts[unit.dest].owner !== seat) continue;
    add(unit.dest, unit.seat, 1, ticksTo(map, closed, unit.from, unit.to, unit.d, unit.dest, Boolean(unit.risky), state.army[unit.seat].speed));
  }
  state.huts.forEach((hut, at) => {
    if (!hut.owner || hut.owner === seat) return;
    for (const line of hut.out) {
      if (state.huts[line.dest].owner !== seat) continue;
      add(line.dest, hut.owner, line.n, ticksTo(map, closed, at, line.to, 0, line.dest, Boolean(line.risky), state.army[hut.owner].speed));
    }
  });
  return [...found.values()]
    .filter((threat) => threat.n >= THREAT_LEAST && threat.ticks !== Infinity)
    .map(({ hut, side, n, ticks }) => ({ hut, side, n, secs: Math.max(1, Math.ceil((ticks * TICK_MS) / 1000)) }))
    .sort((p, q) => q.n - p.n || p.secs - q.secs || p.hut - q.hut);
}

/**
 * The march on your home that makes it a siege, or on your last hut once
 * your home has gone: the largest, once it is a column (GATE_COLUMN).
 */
export function siegeOf(map: SwarmMap, state: SwarmState, seat: Seat, threats: Threat[]): Threat | null {
  const held = state.huts.flatMap((hut, at) => (hut.owner === seat && !map.sites[at].tower ? [at] : []));
  const home = homeOf(map, state, seat);
  const keep = home !== -1 && state.huts[home].owner === seat ? home : held.length === 1 ? held[0] : -1;
  return threats.find((threat) => threat.hut === keep && threat.n >= GATE_COLUMN) ?? null;
}

export interface ThreatView {
  threats: Threat[];
  siege: Threat | null;
  /** When the siege pulse last beat, for the frame to swell with it. */
  beatAt: number;
  /** prefers-reduced-motion: the frame is held steady and does not pulse. */
  still: boolean;
}

/** The least height, in CSS px, a threat's words are drawn at. */
const THREAT_MIN_PX = 10;

/** A pill under each threatened hut: how many, and how soon. Then the siege frame. `px` is world units to a CSS pixel. */
export function drawThreats(ctx: CanvasRenderingContext2D, map: SwarmMap, state: SwarmState, view: ThreatView, now: number, px: number): void {
  const grow = growOf(11, THREAT_MIN_PX, px);
  const below = new Map<number, number>();
  ctx.save();
  ctx.font = fontOf(600, 11 * grow);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const threat of view.threats) {
    const site = map.sites[threat.hut];
    const stack = below.get(threat.hut) ?? 0;
    below.set(threat.hut, stack + 1);
    const text = `${threat.n} in ${threat.secs}s`;
    const width = ctx.measureText(text).width + 12 * grow;
    const tall = 16 * grow;
    const y = site.y + siteRadius(site, state.huts[threat.hut].level) * 0.55 + 6 * grow + stack * (tall + 2 * grow);
    ctx.fillStyle = BADGE[threat.side].fill;
    ctx.beginPath();
    ctx.roundRect(site.x - width / 2, y, width, tall, tall / 2);
    ctx.fill();
    ctx.fillStyle = BADGE[threat.side].text;
    ctx.fillText(text, site.x, y + tall / 2 + 0.5 * grow);
  }
  if (view.siege) {
    // Swells on the beat and falls away, so the edge is a pulse that is felt more than watched.
    const since = (now - view.beatAt) / 400;
    const swell = view.still ? 0.5 : 0.25 + 0.45 * Math.max(0, 1 - since);
    const line = 4 * px;
    ctx.globalAlpha = swell;
    ctx.strokeStyle = BADGE[view.siege.side].fill;
    ctx.lineWidth = line;
    ctx.strokeRect(line / 2, line / 2, map.w - line, map.h - line);
  }
  ctx.restore();
}

/**
 * The beat of the board's frame while a column is on its way to your home:
 * slow when it is far off, quicker as it closes. `secs` is how long until its
 * head is at the door.
 */
export function siegeBeat(secs: number): { gapMs: number } {
  const near = 1 - Math.min(Math.max(secs - 1, 0), 9) / 9;
  return { gapMs: Math.round(1100 - 600 * near) };
}
