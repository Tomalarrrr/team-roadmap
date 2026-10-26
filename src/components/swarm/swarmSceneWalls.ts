// The walls twist as drawn: a path being cut, the trench where it was cut,
// the walls across paths, and the tokens that order them. A cut bridge is
// drawn as the buildings twist draws a burnt one.

import { BURN_FUSE, CLOSED_FOREVER, burnCost, cutCost, pathLength, wallCost, type SwarmEvent, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { pill } from './swarmSceneBuilt';
import { BADGE, PALETTE, PATH_W, ellipse, pathPoint, type Ctx } from './swarmSceneKit';

const INK = '#2b241a';
const FLARE_MS = 4000;
/** How long a wall shudders after a unit walks into it. */
const KNOCK_MS = 220;
/** How far along a path from the hut in hand its first token sits, as the bridge's burn token always has. */
const TOKEN_REACH = 70;
/** From one token's middle to the next along a path, in token radii. */
const TOKEN_GAP = 2.2;

export interface Walled {
  /** Cuts that went through or were stopped, for the dust over them. */
  flares: { path: number; kind: 'burn' | 'doused'; at: number }[];
  /** By path, when its wall was last walked into. */
  knocks: Map<number, number>;
}

export const newWalled = (): Walled => ({ flares: [], knocks: new Map() });

export function walledEvents(walled: Walled, events: SwarmEvent[], now: number): void {
  for (const event of events) {
    if ((event.kind === 'burn' || event.kind === 'doused') && event.cut) walled.flares.push({ path: event.path, kind: event.kind, at: now });
    else if (event.kind === 'wallHit') walled.knocks.set(event.path, now);
  }
  walled.flares = walled.flares.filter((flare) => now - flare.at < FLARE_MS);
}

/** A crack in the ground that runs from the hut it was started at to the far end as the count runs down. */
function drawCrack(ctx: Ctx, map: SwarmMap, from: number, to: number, done: number) {
  const steps = Math.max(4, Math.round((pathLength(map, from, to) * done) / 7));
  ctx.save();
  ctx.strokeStyle = 'rgba(30, 22, 12, 0.8)';
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const p = pathPoint(map, from, to, (done * i) / steps);
    const zig = i === 0 || i === steps ? 0 : (i % 2 === 0 ? 1 : -1) * (2 + ((i * 5) % 3));
    ctx.lineTo(p.x - Math.sin(p.angle) * zig, p.y + Math.cos(p.angle) * zig);
  }
  ctx.stroke();
  ctx.restore();
}

/** Where a path was cut: the road broken off on both sides of a trench. */
function drawTrench(ctx: Ctx, map: SwarmMap, at: number) {
  const path = map.paths[at];
  const mid = pathPoint(map, path.a, path.b, 0.5);
  const across = PATH_W[path.kind] / 2 + 6;
  const dig = PALETTE[map.scene].dig;
  ctx.save();
  ctx.translate(mid.x, mid.y);
  ctx.rotate(mid.angle);
  ctx.fillStyle = PALETTE[map.scene].base;
  ctx.fillRect(-15, -across, 30, across * 2);
  ctx.fillStyle = dig.bank;
  for (const side of [-1, 1]) {
    ellipse(ctx, side * 11, 0, 4, across * 0.9);
    ctx.fill();
  }
  ctx.fillStyle = dig.floor;
  ellipse(ctx, 0, 0, 8, across);
  ctx.fill();
  ctx.fillStyle = dig.under;
  ellipse(ctx, 0, 0, 5, across * 0.8);
  ctx.fill();
  ctx.restore();
}

/** Under the units: the cracks of paths being cut, the trenches of cut ones, and the walls. */
export function drawWallsUnder(ctx: Ctx, map: SwarmMap, state: SwarmState, walled: Walled, now: number, alpha: number) {
  map.paths.forEach((path, at) => {
    // A bridge's fire and its gap are drawn with the buildings.
    if (path.kind === 'bridge') return;
    const fuse = state.fuses.find((lit) => lit.path === at);
    const until = state.closed[at];
    if (fuse) drawCrack(ctx, map, fuse.from, fuse.from === path.a ? path.b : path.a, Math.min(1, Math.max(0.05, 1 - (fuse.burns - state.tick - alpha) / BURN_FUSE)));
    if (until >= state.tick && until !== CLOSED_FOREVER) drawTrench(ctx, map, at);
  });
  for (const flare of walled.flares) {
    const path = map.paths[flare.path];
    if (path.kind === 'bridge') continue;
    const mid = pathPoint(map, path.a, path.b, 0.5);
    const age = (now - flare.at) / FLARE_MS;
    // Dust off the cut that went through, or a paler puff off one that was stopped.
    ctx.fillStyle = flare.kind === 'burn' ? `rgba(110, 92, 66, ${0.4 * (1 - age)})` : `rgba(200, 196, 188, ${0.45 * (1 - age)})`;
    for (let k = 0; k < 4; k++) {
      ellipse(ctx, mid.x + (k - 1.5) * 9 + Math.sin(k * 2.3) * 3, mid.y - 6 - age * 24 - k * 3, 6 + age * 10, 4 + age * 6);
      ctx.fill();
    }
  }
  for (const wall of state.walls) drawWall(ctx, map, wall.path, wall.seat, now - (walled.knocks.get(wall.path) ?? -Infinity));
}

/** A palisade across the middle of the path, its posts standing up off the ground, bound with a band of its side's colour. */
function drawWall(ctx: Ctx, map: SwarmMap, at: number, seat: keyof typeof BADGE, since: number) {
  const path = map.paths[at];
  const mid = pathPoint(map, path.a, path.b, 0.5);
  const half = PATH_W[path.kind] / 2 + 5;
  const shake = since < KNOCK_MS ? Math.sin(since * 0.12) * 1.5 * (1 - since / KNOCK_MS) : 0;
  // Across the path: the wall's line on the ground, from one end to the other.
  const ax = -Math.sin(mid.angle);
  const ay = Math.cos(mid.angle);
  const posts = Math.max(4, Math.round(half / 4));
  const feet = Array.from({ length: posts }, (_, k) => {
    const t = (k / (posts - 1)) * 2 - 1;
    return { x: mid.x + shake + ax * half * t, y: mid.y + ay * half * t, tall: 12 + ((k * 7) % 3) };
  }).sort((p, q) => p.y - q.y);
  ctx.save();
  ctx.fillStyle = 'rgba(20, 16, 10, 0.3)';
  ellipse(ctx, mid.x, mid.y + 1.5, Math.abs(ax) * half + 4, Math.abs(ay) * half * 0.5 + 3);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK;
  for (const foot of feet) {
    ctx.fillStyle = '#8a6a44';
    ctx.beginPath();
    ctx.moveTo(foot.x - 2.2, foot.y);
    ctx.lineTo(foot.x - 2.2, foot.y - foot.tall + 3);
    ctx.lineTo(foot.x, foot.y - foot.tall);
    ctx.lineTo(foot.x + 2.2, foot.y - foot.tall + 3);
    ctx.lineTo(foot.x + 2.2, foot.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.strokeStyle = BADGE[seat].fill;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const foot of [feet[0], feet[feet.length - 1]].sort((p, q) => p.x - q.x)) ctx.lineTo(foot.x, foot.y - 6);
  ctx.stroke();
  ctx.restore();
}

/** Over the units: the seconds left on a cut, and what each wall has left in it. */
export function drawWallsOver(ctx: Ctx, map: SwarmMap, state: SwarmState, alpha: number, grow: number) {
  for (const fuse of state.fuses) {
    const path = map.paths[fuse.path];
    if (path.kind === 'bridge') continue;
    const mid = pathPoint(map, path.a, path.b, 0.5);
    pill(ctx, String(Math.max(1, Math.ceil((fuse.burns - state.tick - alpha) / 10))), mid.x, mid.y - 14 * grow, grow);
  }
  for (const wall of state.walls) {
    const path = map.paths[wall.path];
    const mid = pathPoint(map, path.a, path.b, 0.5);
    pill(ctx, String(wall.hp), mid.x, mid.y - 16 - 9 * grow, grow);
  }
}

export type PathOrder = 'burn' | 'cut' | 'wall';

/**
 * A token for each order the hut in hand can give on each of its paths, out
 * along the path: a bridge's fire or a cut nearer the hut, and a wall
 * further on, towards where it will stand. On a path too short for two in a
 * line they stand side by side. `radius` is a token's drawn radius.
 */
export function pathSpots(map: SwarmMap, state: SwarmState, hut: number, radius: number): { kind: PathOrder; to: number; x: number; y: number; cost: number }[] {
  return map.links[hut].flatMap((to) => {
    const burn = burnCost(state, map, hut, to);
    const cut = burn === null ? cutCost(state, map, hut, to) : null;
    const wall = wallCost(state, map, hut, to);
    const kinds = [
      ...(burn !== null ? [{ kind: 'burn' as const, cost: burn }] : []),
      ...(cut !== null ? [{ kind: 'cut' as const, cost: cut }] : []),
      ...(wall !== null ? [{ kind: 'wall' as const, cost: wall }] : []),
    ];
    const length = pathLength(map, hut, to);
    const near = Math.min(0.4 * length, TOKEN_REACH);
    const inLine = near + (kinds.length - 1) * TOKEN_GAP * radius <= 0.6 * length;
    return kinds.map(({ kind, cost }, k) => {
      const p = pathPoint(map, hut, to, (near + (inLine ? k * TOKEN_GAP * radius : 0)) / length);
      const aside = inLine ? 0 : (k - (kinds.length - 1) / 2) * TOKEN_GAP * radius;
      return { kind, to, cost, x: p.x - Math.sin(p.angle) * aside, y: p.y + Math.cos(p.angle) * aside };
    });
  });
}

/** A spade: what cuts a path. */
export function spadeIcon(ctx: Ctx) {
  ctx.beginPath();
  ctx.moveTo(-5, -7);
  ctx.lineTo(1.5, -0.5);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-7, -5);
  ctx.lineTo(-3, -9);
  ctx.stroke();
  ctx.fillStyle = '#8f9497';
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(4, 2);
  ctx.quadraticCurveTo(7, 7, 7, 7);
  ctx.quadraticCurveTo(2, 7, -2, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Three stakes bound together: a wall. */
export function wallIcon(ctx: Ctx) {
  ctx.fillStyle = '#8a6a44';
  for (const x of [-5, 0, 5]) {
    ctx.beginPath();
    ctx.moveTo(x - 2, 6);
    ctx.lineTo(x - 2, -4);
    ctx.lineTo(x, -7);
    ctx.lineTo(x + 2, -4);
    ctx.lineTo(x + 2, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-7.5, 1);
  ctx.lineTo(7.5, 1);
  ctx.stroke();
}
