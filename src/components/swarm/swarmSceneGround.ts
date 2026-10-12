// The ground of each of Swarm's five places, painted once into the cached
// layer: the turf or snow or dust, the paths by their kind, the river with its
// bridges and fords, and whatever lies about. Nothing here moves.

import { mulberry32, pathLength, type Path, type Site, type SwarmMap } from '../../swarmGameLogic';
import {
  PALETTE,
  PATH_W,
  areaOf,
  crossingsOf,
  ellipse,
  pathPoint,
  pickTone,
  riverDir,
  riverGap,
  siteRadius,
  summitOf,
  tracePath,
  type Crossing,
  type Ctx,
  type Point,
  type River,
  type Rnd,
} from './swarmSceneKit';

interface Ground {
  ctx: Ctx;
  rnd: Rnd;
  map: SwarmMap;
  rivers: River[];
  /** Points along every path with half its width there, to keep the scatter off the paths. */
  trail: { x: number; y: number; half: number }[];
  rings: Ring[];
  summit: Point;
  /** What every count of things strewn over the whole board is multiplied by, so a bigger world is strewn as thickly. */
  area: number;
  /** Where growth is thick. Between these and the edge of the board the ground is mostly clear. */
  groves: { x: number; y: number; r: number }[];
  /** What stands on the ground, kept until all of it is known so the nearer is painted over the further. */
  props: { y: number; paint: () => void }[];
}

/** The way the wind lies on the ice, as an angle. The snow in swarmFeel streams the same way. */
export const WIND = 0.1;

// A terraced hill is a stack of level rings, each held up by a wall on the side we see it from.

/** A ring as how far it reaches from the summit at each of RING_STEPS angles, before the board's squash. */
export interface Ring {
  r: number[];
}

const RING_STEPS = 240;
/** The board is seen from above and in front, so a circle on the ground is this much flatter than wide. */
const RING_SQUASH = 0.6;
const WALL_H = 11;
/** Level ground kept between the biggest hut a site can grow to and any wall. */
const PAD_ROOM = 14;
/** Walls on open ground are built about this far apart. */
const RING_GAP = 85;

/**
 * The terraces are cut to suit what stands on the hill: a wall goes where no hut is, between one
 * band of huts and the next, and where it has to pass close to a hut it bows round the hut's pad.
 * Outermost first.
 */
export function ringsOf(map: SwarmMap, seed: number): Ring[] {
  const rnd = mulberry32(seed ^ 0x7e55);
  const summit = summitOf(map);
  const pads = map.sites.map((site) => {
    const dx = site.x - summit.x;
    const dy = (site.y - summit.y) / RING_SQUASH;
    return { rho: Math.hypot(dx, dy), angle: Math.atan2(dy, dx), room: siteRadius(site, 3) + PAD_ROOM };
  });
  /** How far a wall at this distance would be from the nearest pad: negative when it would cut one. */
  const slack = (rho: number) => Math.min(...pads.map((pad) => Math.abs(rho - pad.rho) - pad.room));

  // Past the furthest corner no part of a ring is on the board.
  const reach = Math.ceil(Math.hypot(Math.max(summit.x, map.w - summit.x), Math.max(summit.y, map.h - summit.y) / RING_SQUASH));
  const walls: number[] = [];
  for (let rho = 0, from = -1; rho <= reach; rho++) {
    const open = slack(rho) >= 0 && rho < reach;
    if (open && from < 0) from = rho;
    if (!open && from >= 0) {
      const count = 1 + Math.floor((rho - from) / RING_GAP);
      for (let i = 0; i < count; i++) walls.push(from + ((i + 0.5) * (rho - from)) / count);
      from = -1;
    }
  }
  // A band of huts too deep to leave a gap still gets a wall, where it has the least bowing to do.
  for (let i = walls.length - 1; i > 0; i--) {
    let best = 0;
    for (let rho = walls[i - 1] + RING_GAP; rho <= walls[i] - RING_GAP; rho++) {
      if (best === 0 || slack(rho) > slack(best)) best = rho;
    }
    if (best > 0 && slack(best) > -32) walls.splice(i, 0, best);
  }

  const rings = walls.map((wall) => {
    const phase = [rnd() * 6.3, rnd() * 6.3, rnd() * 6.3];
    const least = new Array<number>(RING_STEPS).fill(0);
    const most = new Array<number>(RING_STEPS).fill(Infinity);
    const r: number[] = [];
    for (let i = 0; i < RING_STEPS; i++) {
      const angle = (i / RING_STEPS) * Math.PI * 2;
      r.push(wall * (1 + 0.035 * Math.sin(2 * angle + phase[0]) + 0.03 * Math.sin(3 * angle + phase[1]) + 0.02 * Math.sin(5 * angle + phase[2])));
      for (const pad of pads) {
        const across = pad.rho * Math.sin(angle - pad.angle);
        if (Math.abs(across) >= pad.room) continue;
        const along = pad.rho * Math.cos(angle - pad.angle);
        const chord = Math.sqrt(pad.room * pad.room - across * across);
        if (pad.rho < wall) least[i] = Math.max(least[i], along + chord);
        // The wall stands below its ring on the page, so a hut under one needs that much more room.
        else if (along > chord) most[i] = Math.min(most[i], along - chord - WALL_H / RING_SQUASH);
      }
    }
    // Eased again and again and held to the pads each time, so a bow has shoulders and not corners.
    for (let pass = 0; pass < 60; pass++) {
      const was = r.slice();
      for (let i = 0; i < RING_STEPS; i++) {
        const eased = (was[(i + RING_STEPS - 1) % RING_STEPS] + 2 * was[i] + was[(i + 1) % RING_STEPS]) / 4;
        r[i] = Math.max(least[i], Math.min(most[i], eased));
      }
    }
    return { r };
  });
  return rings.reverse();
}

function ringAt(ring: Ring, angle: number): number {
  const at = ((((angle / (Math.PI * 2)) % 1) + 1) % 1) * RING_STEPS;
  const i = Math.floor(at) % RING_STEPS;
  return ring.r[i] + (ring.r[(i + 1) % RING_STEPS] - ring.r[i]) * (at - Math.floor(at));
}

/** `grow` scales the ring about the summit and `drop` lowers it, for the wall under one. */
export function traceRing(ctx: Ctx, summit: Point, ring: Ring, grow = 1, drop = 0) {
  ctx.beginPath();
  for (let i = 0; i < RING_STEPS; i++) {
    const angle = (i / RING_STEPS) * Math.PI * 2;
    const r = ring.r[i] * grow;
    ctx.lineTo(summit.x + Math.cos(angle) * r, summit.y + Math.sin(angle) * r * RING_SQUASH + drop);
  }
  ctx.closePath();
}

function inRing(summit: Point, ring: Ring, x: number, y: number): boolean {
  const dy = (y - summit.y) / RING_SQUASH;
  return Math.hypot(x - summit.x, dy) < ringAt(ring, Math.atan2(dy, x - summit.x));
}

function onWall(g: Ground, x: number, y: number): boolean {
  return g.rings.some((ring) => !inRing(g.summit, ring, x, y) && inRing(g.summit, ring, x, y - WALL_H));
}

/** How many terraces up a place is. */
function levelAt(g: Ground, x: number, y: number): number {
  return g.rings.filter((ring) => inRing(g.summit, ring, x, y)).length;
}

// The small things the ground is dressed with.

function blade(ctx: Ctx, rnd: Rnd, x: number, y: number, length: number, tones: readonly string[]) {
  const lean = (rnd() - 0.5) * 1.1;
  ctx.strokeStyle = pickTone(rnd, tones);
  ctx.globalAlpha = 0.35 + rnd() * 0.4;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + lean * length * 0.3, y - length * 0.6, x + lean * length, y - length);
  ctx.stroke();
}

function turf(g: Ground, count: number, shortest: number, longest: number, tones: readonly string[]) {
  const { ctx, rnd } = g;
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < count * g.area; i++) {
    const x = rnd() * g.map.w;
    const y = rnd() * g.map.h;
    const length = shortest + rnd() * (longest - shortest);
    if (g.rings.length > 0 && onWall(g, x, y)) continue;
    blade(ctx, rnd, x, y, length, tones);
  }
  ctx.globalAlpha = 1;
}

function stone(ctx: Ctx, rnd: Rnd, x: number, y: number, rx: number, tones: readonly string[], cast: string) {
  const ry = rx * (0.55 + rnd() * 0.25);
  const rot = rnd() * 3;
  ctx.fillStyle = cast;
  ellipse(ctx, x + rx * 0.3, y + ry * 0.45, rx, ry, rot);
  ctx.fill();
  ctx.fillStyle = pickTone(rnd, tones);
  ellipse(ctx, x, y, rx, ry, rot);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 250, 0.3)';
  ellipse(ctx, x - rx * 0.25, y - ry * 0.3, rx * 0.5, ry * 0.4, rot);
  ctx.fill();
}

function tuft(ctx: Ctx, rnd: Rnd, x: number, y: number, size: number, tones: readonly string[]) {
  ctx.fillStyle = 'rgba(20, 24, 10, 0.2)';
  ellipse(ctx, x + 1, y + 0.8, size * 0.55, size * 0.2);
  ctx.fill();
  ctx.lineCap = 'round';
  const blades = 7 + Math.floor(rnd() * 5);
  for (let i = 0; i < blades; i++) {
    const lean = (i / (blades - 1) - 0.5) * 1.6 + (rnd() - 0.5) * 0.3;
    const length = size * (0.6 + rnd() * 0.5);
    ctx.strokeStyle = pickTone(rnd, tones);
    ctx.lineWidth = 0.9 + rnd() * 0.5;
    ctx.beginPath();
    ctx.moveTo(x + lean * size * 0.12, y);
    ctx.quadraticCurveTo(x + lean * length * 0.25, y - length * 0.6, x + lean * length * 0.7, y - length * (1 - Math.abs(lean) * 0.25));
    ctx.stroke();
  }
}

/** A round shrub built of lobes, the darkest low and to the right, the lightest where the sun is. */
function bush(ctx: Ctx, rnd: Rnd, x: number, y: number, size: number, tones: readonly string[], cast: string) {
  ctx.fillStyle = cast;
  ellipse(ctx, x + size * 0.25, y + size * 0.3, size * 1.05, size * 0.42);
  ctx.fill();
  const lobes = tones.length * 3;
  for (let i = 0; i < lobes; i++) {
    const tone = Math.floor((i / lobes) * tones.length);
    const angle = rnd() * Math.PI * 2;
    const reach = rnd() * size * 0.55;
    const r = size * (0.3 + rnd() * 0.22) * (1 - tone * 0.1);
    ctx.fillStyle = tones[tone];
    ellipse(ctx, x + Math.cos(angle) * reach - tone * size * 0.07, y - size * 0.38 + Math.sin(angle) * reach * 0.55 - tone * size * 0.08, r, r * 0.85);
    ctx.fill();
  }
}

function quadAt(sx: number, sy: number, cx: number, cy: number, ex: number, ey: number, t: number) {
  const g = 1 - t;
  const tx = g * (cx - sx) + t * (ex - cx);
  const ty = g * (cy - sy) + t * (ey - cy);
  const d = Math.hypot(tx, ty) || 1;
  return { x: g * g * sx + 2 * g * t * cx + t * t * ex, y: g * g * sy + 2 * g * t * cy + t * t * ey, tx: tx / d, ty: ty / d };
}

const CANE = ['#4a2c1c', '#5c3a22', '#3a2416', '#6a4a2a'];

/** A bramble: arching canes that root where they touch down, set with thorns. */
function bramble(ctx: Ctx, rnd: Rnd, x: number, y: number, size: number, cast: string) {
  ctx.fillStyle = cast;
  ellipse(ctx, x + size * 0.2, y + size * 0.2, size * 1.15, size * 0.4);
  ctx.fill();
  ctx.lineCap = 'round';
  const canes = 9 + Math.floor(rnd() * 5);
  for (let i = 0; i < canes; i++) {
    const root = rnd() * Math.PI * 2;
    const sx = x + Math.cos(root) * size * 0.3;
    const sy = y + Math.sin(root) * size * 0.12;
    const ex = x + (rnd() - 0.5) * size * 2.2;
    const ey = y + (rnd() - 0.6) * size * 0.4;
    const cx = (sx + ex) / 2 + (rnd() - 0.5) * size * 0.5;
    const cy = Math.min(sy, ey) - size * (0.5 + rnd() * 0.7);
    ctx.strokeStyle = pickTone(rnd, CANE);
    ctx.lineWidth = 1.1 + rnd() * 0.7;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    ctx.strokeStyle = '#e6d6ac';
    ctx.lineWidth = 0.7;
    for (let t = 0.14; t < 0.92; t += 0.16) {
      const p = quadAt(sx, sy, cx, cy, ex, ey, t);
      const side = rnd() < 0.5 ? -1 : 1;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.ty * side * 2.2 + p.tx * 0.9, p.y + p.tx * side * 2.2 + p.ty * 0.9);
      ctx.stroke();
    }
    if (rnd() < 0.6) {
      const p = quadAt(sx, sy, cx, cy, ex, ey, 0.3 + rnd() * 0.5);
      ctx.fillStyle = rnd() < 0.5 ? '#6f7a3c' : '#59642e';
      ellipse(ctx, p.x, p.y - 1, 2.2, 1.2, rnd() * 3);
      ctx.fill();
    }
  }
}

const THORN = ['#7d7f52', '#96986a', '#5f6140', '#a8a878'];

/** A thorn bush: no leaves to speak of, a dome of grey spines. */
function thornBush(ctx: Ctx, rnd: Rnd, x: number, y: number, size: number, cast: string) {
  ctx.fillStyle = cast;
  ellipse(ctx, x + size * 0.2, y + size * 0.15, size * 0.95, size * 0.32);
  ctx.fill();
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 70; i++) {
    const px = x + (rnd() - 0.5) * size * 1.6;
    const py = y - rnd() * size * 0.85;
    const ox = (px - x) / (size * 0.8);
    const oy = (py - (y - size * 0.3)) / (size * 0.55);
    if (ox * ox + oy * oy > 1) continue;
    const angle = Math.atan2(py - y, px - x) + (rnd() - 0.5) * 0.9;
    const length = size * (0.2 + rnd() * 0.24);
    ctx.strokeStyle = pickTone(rnd, THORN);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(angle) * length, py + Math.sin(angle) * length);
    ctx.stroke();
  }
}

const FROND = ['#2f6a2c', '#3f7f34', '#55943f', '#27581f'];

function fern(ctx: Ctx, rnd: Rnd, x: number, y: number, size: number, cast: string) {
  ctx.fillStyle = cast;
  ellipse(ctx, x + 1.5, y + 1, size * 0.8, size * 0.25);
  ctx.fill();
  ctx.lineCap = 'round';
  const fronds = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < fronds; i++) {
    const lean = (i / (fronds - 1) - 0.5) * 2 + (rnd() - 0.5) * 0.3;
    const ex = x + lean * size;
    const ey = y - size * (0.75 - Math.abs(lean) * 0.45);
    const cx = x + lean * size * 0.35;
    const cy = y - size * 0.9;
    ctx.strokeStyle = pickTone(rnd, FROND);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let t = 0.2; t < 0.96; t += 0.11) {
      const p = quadAt(x, y, cx, cy, ex, ey, t);
      const length = size * 0.22 * (1 - t * 0.75);
      for (const side of [-1, 1]) {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.ty * side * length + p.tx * length * 0.5, p.y + p.tx * side * length + p.ty * length * 0.5);
      }
    }
    ctx.stroke();
  }
}

function lilyPad(ctx: Ctx, rnd: Rnd, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(10, 36, 40, 0.3)';
  ellipse(ctx, x + 0.8, y + 1.1, r, r * 0.6);
  ctx.fill();
  // A pad is a disc with a notch cut to the stalk.
  const notch = rnd() * Math.PI * 2;
  ctx.fillStyle = pickTone(rnd, ['#4f8a3c', '#5f9a46', '#437a34']);
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.6, 0, notch + 0.4, notch + Math.PI * 2);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(210, 236, 160, 0.3)';
  ellipse(ctx, x - r * 0.25, y - r * 0.18, r * 0.45, r * 0.22);
  ctx.fill();
}

function floe(ctx: Ctx, rnd: Rnd, x: number, y: number, r: number) {
  ctx.fillStyle = 'rgba(12, 40, 64, 0.35)';
  ellipse(ctx, x + 1, y + 1.6, r, r * 0.55);
  ctx.fill();
  ctx.fillStyle = '#f4f9fc';
  ctx.beginPath();
  for (let i = 0; i < 7; i++) {
    const angle = (i / 7) * Math.PI * 2;
    const reach = r * (0.75 + rnd() * 0.35);
    ctx.lineTo(x + Math.cos(angle) * reach, y + Math.sin(angle) * reach * 0.55);
  }
  ctx.closePath();
  ctx.fill();
}

/** Ice pushed up out of the ground in splinters, lit on the left face. */
function shards(ctx: Ctx, rnd: Rnd, x: number, y: number, size: number, cast: string) {
  ctx.fillStyle = cast;
  ellipse(ctx, x + size * 0.3, y + size * 0.12, size * 0.8, size * 0.24);
  ctx.fill();
  const count = 2 + Math.floor(rnd() * 3);
  ctx.lineJoin = 'round';
  for (let i = 0; i < count; i++) {
    const bx = x + (i - (count - 1) / 2) * size * 0.34 + (rnd() - 0.5) * size * 0.1;
    const w = size * (0.14 + rnd() * 0.1);
    const tipX = bx + (rnd() - 0.5) * size * 0.4;
    const tipY = y - size * (0.6 + rnd() * 0.7);
    ctx.fillStyle = '#eef8fc';
    ctx.beginPath();
    ctx.moveTo(bx - w, y);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(bx + w * 0.15, y + w * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9fc3d9';
    ctx.beginPath();
    ctx.moveTo(bx + w * 0.15, y + w * 0.3);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(bx + w, y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(70, 110, 150, 0.6)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(bx - w, y);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(bx + w, y);
    ctx.lineTo(bx + w * 0.15, y + w * 0.3);
    ctx.closePath();
    ctx.stroke();
  }
}

/** An outcrop: broken faces, the left ones lit, and snow lying on top where there is snow. */
function rock(ctx: Ctx, rnd: Rnd, x: number, y: number, size: number, tones: readonly string[], cast: string, snow: boolean) {
  ctx.fillStyle = cast;
  ellipse(ctx, x + size * 0.3, y + size * 0.25, size * 1.15, size * 0.4);
  ctx.fill();
  const top: Point[] = [];
  for (let i = 0; i < 7; i++) {
    const angle = Math.PI * (1 + i / 6);
    const reach = size * (0.75 + rnd() * 0.35);
    top.push({ x: x + Math.cos(angle) * reach, y: y + Math.sin(angle) * reach * 0.8 });
  }
  ctx.fillStyle = tones[tones.length - 1];
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  for (const p of top) ctx.lineTo(p.x, p.y);
  ctx.lineTo(x + size, y);
  ctx.quadraticCurveTo(x, y + size * 0.36, x - size, y);
  ctx.fill();
  ctx.fillStyle = tones[0];
  ctx.beginPath();
  ctx.moveTo(x - size, y);
  for (let i = 0; i < 4; i++) ctx.lineTo(top[i].x, top[i].y);
  ctx.lineTo(x - size * 0.05, y - size * 0.12);
  ctx.lineTo(x - size * 0.4, y + size * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tones[1];
  ctx.beginPath();
  ctx.moveTo(top[3].x, top[3].y);
  ctx.lineTo(top[4].x, top[4].y);
  ctx.lineTo(x + size * 0.35, y + size * 0.05);
  ctx.lineTo(x - size * 0.05, y - size * 0.12);
  ctx.closePath();
  ctx.fill();
  if (!snow) return;
  ctx.fillStyle = '#f6fafc';
  ctx.beginPath();
  ctx.moveTo(top[1].x, top[1].y);
  for (let i = 2; i < 6; i++) ctx.lineTo(top[i].x, top[i].y);
  ctx.lineTo(top[5].x, top[5].y + size * 0.2);
  ctx.quadraticCurveTo(x + size * 0.2, y - size * 0.5, x, y - size * 0.3);
  ctx.quadraticCurveTo(x - size * 0.3, y - size * 0.5, top[1].x, top[1].y + size * 0.22);
  ctx.closePath();
  ctx.fill();
}

function fallenLog(ctx: Ctx, rnd: Rnd, x: number, y: number, length: number, cast: string, moss: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rnd() - 0.5) * 0.9);
  ctx.fillStyle = cast;
  ctx.beginPath();
  ctx.roundRect(-length / 2 + 2, -1, length, 7.5, 3.5);
  ctx.fill();
  ctx.fillStyle = '#5f4226';
  ctx.beginPath();
  ctx.roundRect(-length / 2, -3.5, length, 7, 3.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(214, 176, 118, 0.35)';
  ctx.fillRect(-length / 2 + 3, -3, length - 6, 2.2);
  ctx.strokeStyle = 'rgba(34, 20, 8, 0.45)';
  ctx.lineWidth = 0.6;
  for (let i = 0; i < 5; i++) {
    const bx = -length / 2 + 4 + rnd() * (length - 12);
    ctx.beginPath();
    ctx.moveTo(bx, -1 + rnd() * 3);
    ctx.lineTo(bx + 3 + rnd() * 5, -1 + rnd() * 3);
    ctx.stroke();
  }
  ctx.fillStyle = '#c9a46a';
  ellipse(ctx, length / 2 - 1, 0, 2.1, 3.4);
  ctx.fill();
  ctx.fillStyle = '#8a6238';
  ellipse(ctx, length / 2 - 1, 0, 1, 1.7);
  ctx.fill();
  if (moss) {
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(84, 118, 50, 0.85)' : 'rgba(112, 140, 60, 0.8)';
      ellipse(ctx, -length / 2 + 4 + rnd() * (length - 10), -2.4, 2 + rnd() * 3, 1.3);
      ctx.fill();
    }
  }
  ctx.restore();
}

function flower(ctx: Ctx, x: number, y: number, r: number, petal: string, eye: string) {
  ctx.fillStyle = 'rgba(20, 24, 10, 0.22)';
  ellipse(ctx, x + 0.9, y + 1, r * 1.5, r * 1.1);
  ctx.fill();
  ctx.fillStyle = petal;
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    ellipse(ctx, x + Math.cos(angle) * r, y + Math.sin(angle) * r, r * 0.75, r * 0.45, angle);
    ctx.fill();
  }
  ctx.fillStyle = eye;
  ellipse(ctx, x, y, r * 0.6, r * 0.6);
  ctx.fill();
}

function deadLeaf(ctx: Ctx, rnd: Rnd, x: number, y: number) {
  const length = 7 + rnd() * 7;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rnd() * Math.PI * 2);
  ctx.fillStyle = 'rgba(30, 38, 18, 0.25)';
  ctx.beginPath();
  ctx.moveTo(-length + 1, 1.5);
  ctx.quadraticCurveTo(1, -length * 0.5 + 1.5, length + 1, 1.5);
  ctx.quadraticCurveTo(1, length * 0.5 + 1.5, -length + 1, 1.5);
  ctx.fill();
  ctx.fillStyle = pickTone(rnd, ['#a9772f', '#8e5a26', '#b88a3a', '#7d6a2c']);
  ctx.beginPath();
  ctx.moveTo(-length, 0);
  ctx.quadraticCurveTo(0, -length * 0.5, length, 0);
  ctx.quadraticCurveTo(0, length * 0.5, -length, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60, 36, 12, 0.5)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-length, 0);
  ctx.lineTo(length, 0);
  ctx.stroke();
  ctx.restore();
}

function mushrooms(ctx: Ctx, rnd: Rnd, x: number, y: number, cast: string) {
  const caps = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < caps; i++) {
    const mx = x + (i - (caps - 1) / 2) * 3.4 + (rnd() - 0.5) * 2;
    const my = y + (rnd() - 0.5) * 3;
    const r = 1.5 + rnd() * 1.5;
    ctx.fillStyle = cast;
    ellipse(ctx, mx + 1, my + 0.5, r, r * 0.4);
    ctx.fill();
    ctx.fillStyle = '#e6dcc0';
    ctx.fillRect(mx - 0.5, my - r, 1, r);
    ctx.fillStyle = rnd() < 0.5 ? '#a04e2a' : '#c08a52';
    ctx.beginPath();
    ctx.ellipse(mx, my - r, r, r * 0.75, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 240, 214, 0.5)';
    ellipse(ctx, mx - r * 0.35, my - r * 1.4, r * 0.3, r * 0.18);
    ctx.fill();
  }
}

/** A branch long dead and bleached, with what is left of its twigs. */
function deadBranch(ctx: Ctx, rnd: Rnd, x: number, y: number, length: number, cast: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rnd() - 0.5) * 1.4);
  ctx.lineCap = 'round';
  const bow = (rnd() - 0.5) * length * 0.3;
  const forks: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) forks.push([-length * 0.3 + rnd() * length * 0.7, (rnd() < 0.5 ? -1 : 1) * (3 + rnd() * 4), 2 + rnd() * 4]);
  for (const [dx, dy, colour, width] of [[1.2, 1.6, cast, 2], [0, 0, '#8a7350', 1.7], [-0.2, -0.5, 'rgba(244, 232, 200, 0.6)', 0.6]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(-length / 2 + dx, dy);
    ctx.quadraticCurveTo(dx, bow + dy, length / 2 + dx, dy);
    for (const [at, out, on] of forks) {
      ctx.moveTo(at + dx, bow * 0.5 + dy);
      ctx.lineTo(at + on + dx, bow * 0.5 + out + dy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Snow the wind has heaped against nothing in particular, lit from the upper left. */
function snowMound(ctx: Ctx, x: number, y: number, size: number, cast: string) {
  ctx.fillStyle = cast;
  ellipse(ctx, x + size * 0.2, y + size * 0.14, size, size * 0.4, WIND);
  ctx.fill();
  ctx.fillStyle = '#c9dbea';
  ellipse(ctx, x, y, size, size * 0.4, WIND);
  ctx.fill();
  ctx.fillStyle = '#fcfeff';
  ellipse(ctx, x - size * 0.1, y - size * 0.07, size * 0.8, size * 0.28, WIND);
  ctx.fill();
}

/** A few stones lying together, as they do where one has split or a wall has gone. */
function rubble(ctx: Ctx, rnd: Rnd, x: number, y: number, size: number, tones: readonly string[], cast: string) {
  const stones = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < stones; i++) {
    stone(ctx, rnd, x + (i - (stones - 1) / 2) * size * 1.3 + (rnd() - 0.5) * size, y + (i % 2) * size * 0.5, size * (0.5 + rnd() * 0.6), tones, cast);
  }
}

// Where things may lie.

function nearTrail(g: Ground, x: number, y: number, room: number): boolean {
  return g.trail.some((t) => Math.hypot(t.x - x, t.y - y) < t.half + room);
}

function free(g: Ground, x: number, y: number, room: number): boolean {
  if (nearTrail(g, x, y, room)) return false;
  // A hut stands above its site, so what it hides is a shape taller than it is wide.
  if (g.map.sites.some((site) => Math.hypot(site.x - x, (site.y - 14 - y) * 0.8) < 56 + room)) return false;
  if (riverGap(g.rivers, x, y) < room + 8) return false;
  return g.rings.length === 0 || !onWall(g, x, y);
}

/** How thickly things grow at a place, 0 to 1: thick in the groves and along the edge of the board, thin between. */
function lush(g: Ground, x: number, y: number): number {
  let most = Math.max(0, 1 - Math.min(x, y, g.map.w - x, g.map.h - y) / 55);
  for (const grove of g.groves) most = Math.max(most, 1 - Math.hypot(grove.x - x, (grove.y - y) / 0.7) / grove.r);
  return most;
}

/** `stray` is the share that may stand anywhere: the rest keep to where growth is thick. */
function scatter(g: Ground, count: number, room: number, stray: number, paint: (x: number, y: number) => void) {
  for (let made = 0, tries = 0; made < count * g.area && tries < count * g.area * 80; tries++) {
    const x = g.rnd() * g.map.w;
    const y = g.rnd() * g.map.h;
    if (g.rnd() > stray + (1 - stray) * lush(g, x, y) || !free(g, x, y, room)) continue;
    g.props.push({ y, paint: () => paint(x, y) });
    made++;
  }
}

// The paths.

function offsetPoint(map: SwarmMap, path: Path, f: number, off: number) {
  const p = pathPoint(map, path.a, path.b, f);
  return { x: p.x - Math.sin(p.angle) * off, y: p.y + Math.cos(p.angle) * off, angle: p.angle };
}

/** A line beside the path's middle, `off` to one side, between two shares of its length. */
function traceAlong(ctx: Ctx, map: SwarmMap, path: Path, off: number, f0: number, f1: number) {
  ctx.beginPath();
  for (let i = 0; i <= 24; i++) {
    const p = offsetPoint(map, path, f0 + ((f1 - f0) * i) / 24, off);
    ctx.lineTo(p.x, p.y);
  }
}

/** The path stays clear of its two huts for this far, so nothing built on it is hidden behind one. */
const DOOR_ROOM = 56;

/** Rows of sharpened stakes set across the short cut, each pair crossed. */
function paintStakes(g: Ground, path: Path, length: number) {
  const { ctx, rnd, map } = g;
  const spike = PALETTE[map.scene].spike;
  const w = PATH_W.spikes;
  const stakes: { x: number; y: number; lean: number }[] = [];
  const rows = Math.max(1, Math.floor((length - DOOR_ROOM * 2) / 20) + 1);
  for (let row = 0; row < rows; row++) {
    const d = rows === 1 ? length / 2 : DOOR_ROOM + (row * (length - DOOR_ROOM * 2)) / (rows - 1);
    for (let k = 0; k < 4; k++) {
      const p = offsetPoint(map, path, d / length + (rnd() - 0.5) * 0.008, ((k - 1.5) * (w + 9)) / 3 + (rnd() - 0.5) * 1.5);
      stakes.push({ x: p.x, y: p.y, lean: k % 2 === 0 ? -1 : 1 });
    }
  }
  stakes.sort((p, q) => p.y - q.y);
  ctx.lineCap = 'round';
  for (const { x, y, lean } of stakes) {
    const tipX = x + lean * (4 + rnd() * 2);
    const tipY = y - 12 - rnd() * 3;
    ctx.strokeStyle = 'rgba(20, 16, 10, 0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 7, y + 2.6);
    ctx.stroke();
    ctx.fillStyle = spike.shaft;
    ctx.beginPath();
    ctx.moveTo(x - 1.9, y);
    ctx.lineTo(x + 1.9, y);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();
    // The point is fresh cut, paler than the weathered shaft.
    const mx = x + (tipX - x) * 0.6;
    const my = y + (tipY - y) * 0.6;
    ctx.fillStyle = spike.tip;
    ctx.beginPath();
    ctx.moveTo(mx - 0.85, my);
    ctx.lineTo(mx + 0.85, my);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 244, 214, 0.4)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(x - 1.9, y);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  }
}

/** Stone steps up a slope. Each is a chevron with its point uphill, and its riser in shadow on the downhill side. */
function paintSteps(g: Ground, path: Path, length: number) {
  const { ctx, rnd, map } = g;
  const stoneTones = PALETTE[map.scene].stone;
  const half = PATH_W.climb / 2 + 1;
  const rise = path.up === undefined ? 0 : path.up === path.b ? 1 : -1;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (let d = DOOR_ROOM - 6; d <= length - DOOR_ROOM + 6; d += 14) {
    const p = pathPoint(map, path.a, path.b, d / length);
    const ux = Math.cos(p.angle) * rise;
    const uy = Math.sin(p.angle) * rise;
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    // With no top named the steps lie flat across, and the riser is the side nearer the viewer.
    const downX = rise === 0 ? 0 : -ux;
    const downY = rise === 0 ? 1 : -uy;
    const step = (shift: number) => {
      ctx.beginPath();
      ctx.moveTo(p.x + nx * half - ux * 3 + downX * shift, p.y + ny * half - uy * 3 + downY * shift);
      ctx.lineTo(p.x + ux * 3 + downX * shift, p.y + uy * 3 + downY * shift);
      ctx.lineTo(p.x - nx * half - ux * 3 + downX * shift, p.y - ny * half - uy * 3 + downY * shift);
    };
    ctx.strokeStyle = 'rgba(36, 28, 16, 0.3)';
    ctx.lineWidth = 2.6;
    step(2.2);
    ctx.stroke();
    ctx.strokeStyle = pickTone(rnd, stoneTones);
    ctx.lineWidth = 3;
    step(0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 250, 232, 0.28)';
    ctx.lineWidth = 0.8;
    step(-1.2);
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function dressPath(g: Ground, path: Path) {
  const { ctx, rnd, map } = g;
  const pal = PALETTE[map.scene];
  const length = pathLength(map, path.a, path.b);
  const w = PATH_W[path.kind];

  for (let i = 0; i < length * w * 0.036; i++) {
    const p = offsetPoint(map, path, rnd(), (rnd() - 0.5) * (w - 3));
    ctx.fillStyle = rnd() < 0.5 ? pal.path.dark : pal.path.light;
    ellipse(ctx, p.x, p.y, 0.5 + rnd() * 1.1, 0.4 + rnd() * 0.7, rnd() * 3);
    ctx.fill();
  }
  // Scuffs lying the way everything goes, which is what makes it a way and not a strip of colour.
  ctx.lineCap = 'round';
  for (let i = 0; i < length * w * 0.011; i++) {
    const p = offsetPoint(map, path, 0.06 + rnd() * 0.88, (rnd() - 0.5) * (w - 4));
    const reach = 2 + rnd() * 5;
    ctx.strokeStyle = rnd() < 0.5 ? pal.path.dark : pal.path.light;
    ctx.lineWidth = 0.5 + rnd() * 0.6;
    ctx.beginPath();
    ctx.moveTo(p.x - Math.cos(p.angle) * reach, p.y - Math.sin(p.angle) * reach);
    ctx.lineTo(p.x + Math.cos(p.angle) * reach, p.y + Math.sin(p.angle) * reach);
    ctx.stroke();
  }

  if (path.kind === 'road' || path.kind === 'wide') {
    // Two ruts worn by everything that has gone this way, each with the ridge it threw up beside it.
    const deep = path.kind === 'wide';
    for (const side of [-1, 1]) {
      ctx.strokeStyle = pal.path.dark;
      ctx.lineWidth = deep ? 2.4 : 1.5;
      traceAlong(ctx, map, path, side * w * 0.2, 0.14, 0.86);
      ctx.stroke();
      ctx.strokeStyle = pal.path.light;
      ctx.lineWidth = 0.8;
      traceAlong(ctx, map, path, side * (w * 0.2 + (deep ? 2.2 : 1.6)), 0.14, 0.86);
      ctx.stroke();
    }
  }
  if (path.kind === 'wide') {
    // A highway is kept: stones are set along its edge.
    for (let d = DOOR_ROOM; d < length - DOOR_ROOM; d += 12 + rnd() * 10) {
      const p = offsetPoint(map, path, d / length, (rnd() < 0.5 ? -1 : 1) * (w / 2 + 1.5));
      stone(ctx, rnd, p.x, p.y, 2.2 + rnd() * 1.6, pal.stone, pal.cast);
    }
  }
  if (path.kind === 'narrow') {
    // Little used: what grows beside it is growing on it.
    for (let d = DOOR_ROOM - 10; d < length - DOOR_ROOM + 10; d += 13 + rnd() * 12) {
      const p = offsetPoint(map, path, d / length, (rnd() - 0.5) * w);
      if (pal.blades) tuft(ctx, rnd, p.x, p.y, 5 + rnd() * 3, pal.blades);
      else stone(ctx, rnd, p.x, p.y, 1.6 + rnd() * 1.4, pal.stone, pal.cast);
    }
  }
  if (path.kind === 'spikes') {
    ctx.strokeStyle = pal.path.dark;
    ctx.lineWidth = w;
    traceAlong(ctx, map, path, 0, 0.1, 0.9);
    ctx.stroke();
    paintStakes(g, path, length);
  }
  if (path.kind === 'climb') paintSteps(g, path, length);

  if (path.kind === 'road' || path.kind === 'wide') {
    // A pebble here and there that the traffic has not yet kicked off.
    for (let i = 0; i < length / 40; i++) {
      const p = offsetPoint(map, path, 0.12 + rnd() * 0.76, (rnd() - 0.5) * (w - 6));
      stone(ctx, rnd, p.x, p.y, 0.9 + rnd() * 0.9, pal.stone, pal.path.dark);
    }
  }

  if (map.scene === 'meadow' && path.kind === 'road') {
    // Between the ruts nothing treads, and the grass is coming back.
    ctx.lineWidth = 0.8;
    for (let i = 0; i < length * 0.16; i++) {
      const p = offsetPoint(map, path, 0.16 + rnd() * 0.68, (rnd() - 0.5) * 3.5);
      blade(ctx, rnd, p.x, p.y, 2 + rnd() * 2.5, pal.blades!);
    }
    ctx.globalAlpha = 1;
  }
  if (map.scene === 'scrub' && path.kind !== 'spikes') {
    // The road is the same hardpan as the pans, and has cracked the same way.
    for (let i = 0; i < length / 15; i++) {
      let f = 0.1 + rnd() * 0.8;
      let off = (rnd() - 0.5) * (w - 6);
      const legs: Point[] = [];
      for (let leg = 0; leg < 3 + rnd() * 4; leg++) {
        legs.push(offsetPoint(map, path, f, off));
        f += ((rnd() - 0.5) * 13) / length;
        off = Math.max(2 - w / 2, Math.min(w / 2 - 2, off + (rnd() - 0.5) * 10));
      }
      for (const [dx, dy, colour, width] of [[0.7, 0.8, 'rgba(250, 240, 212, 0.5)', 0.7], [0, 0, 'rgba(96, 66, 32, 0.5)', 0.8]] as const) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (const p of legs) ctx.lineTo(p.x + dx, p.y + dy);
        ctx.stroke();
      }
    }
  }
  if (map.scene === 'ice') {
    // Where the wind has the snow off the road the ice under it shows, glazed.
    for (let i = 0; i < length / 60; i++) {
      const p = offsetPoint(map, path, 0.14 + rnd() * 0.72, (rnd() - 0.5) * (w - 12));
      const rx = 8 + rnd() * 12;
      const ry = Math.min(w / 2 - 2.5, rx * 0.4);
      ctx.fillStyle = 'rgba(132, 174, 206, 0.5)';
      ellipse(ctx, p.x, p.y, rx, ry, p.angle);
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.lineWidth = 0.9;
      for (let k = 0; k < 4; k++) {
        const sx = p.x + (rnd() - 0.5) * rx * 1.8;
        const sy = p.y + (rnd() - 0.5) * rx * 1.8;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + Math.cos(WIND + 0.9) * rx, sy - Math.sin(WIND + 0.9) * rx);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Feet have packed the snow in lines.
    ctx.fillStyle = 'rgba(96, 128, 166, 0.4)';
    for (let line = 0; line < (path.kind === 'narrow' ? 1 : 3); line++) {
      const off = (rnd() - 0.5) * (w - 8);
      for (let d = 30, foot = 0; d < length - 30; d += 5, foot++) {
        const p = offsetPoint(map, path, d / length, off + (foot % 2 === 0 ? 1.6 : -1.6));
        ellipse(ctx, p.x, p.y, 1.5, 0.9, p.angle);
        ctx.fill();
      }
    }
    // And tongues of it blow back across from the edges, all the one way.
    for (let i = 0; i < length / 36; i++) {
      const p = offsetPoint(map, path, 0.08 + rnd() * 0.84, (rnd() < 0.5 ? -1 : 1) * (w / 2 - rnd() * 3));
      const rx = 5 + rnd() * 9;
      const ry = 1.1 + rnd() * 1.5;
      ctx.fillStyle = 'rgba(96, 130, 178, 0.22)';
      ellipse(ctx, p.x + rx * 0.5 + 1, p.y + 1.3, rx, ry, WIND);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ellipse(ctx, p.x + rx * 0.5, p.y, rx, ry, WIND);
      ctx.fill();
    }
  }
  if (map.scene === 'valley' && (path.kind === 'road' || path.kind === 'wide')) {
    // Rain stands in the low places: wet earth round each, and the sky in it.
    for (let i = 0; i < length / 120; i++) {
      const p = offsetPoint(map, path, 0.2 + rnd() * 0.6, (rnd() - 0.5) * (w - 13));
      const rx = 4 + rnd() * 4.5;
      const lobes: [number, number, number][] = [[0, 0, 1], [(rnd() - 0.5) * rx * 1.4, (rnd() - 0.5) * 1.6, 0.5 + rnd() * 0.3], [(rnd() - 0.5) * rx * 1.4, (rnd() - 0.5) * 1.6, 0.4 + rnd() * 0.3]];
      for (const [grow, colour] of [[2.2, 'rgba(40, 28, 16, 0.3)'], [0.7, 'rgba(22, 30, 30, 0.6)'], [0, '#55686a']] as const) {
        ctx.fillStyle = colour;
        for (const [dx, dy, share] of lobes) {
          ellipse(ctx, p.x + Math.cos(p.angle) * dx, p.y + Math.sin(p.angle) * dx + dy, rx * share + grow, rx * share * 0.42 + grow * 0.6, p.angle);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(206, 226, 226, 0.4)';
      ellipse(ctx, p.x - rx * 0.2, p.y - rx * 0.1, rx * 0.45, rx * 0.1, p.angle);
      ctx.fill();
    }
  }
  if (map.scene === 'terrace' && (path.kind === 'road' || path.kind === 'wide')) {
    // The roads of the hill are kerbed with the stone its walls are built of.
    for (const side of [-1, 1]) {
      for (let d = DOOR_ROOM - 8; d < length - DOOR_ROOM + 8; d += 4.5 + rnd() * 3) {
        if (rnd() < 0.18) continue;
        const p = offsetPoint(map, path, d / length, side * (w / 2 + 0.5));
        ctx.fillStyle = 'rgba(40, 34, 14, 0.35)';
        ellipse(ctx, p.x + 0.8, p.y + 1, 2.3, 1.4, p.angle);
        ctx.fill();
        ctx.fillStyle = pickTone(rnd, pal.stone);
        ellipse(ctx, p.x, p.y, 1.8 + rnd() * 0.7, 1.2 + rnd() * 0.3, p.angle);
        ctx.fill();
      }
    }
  }

  ctx.lineCap = 'round';
  ctx.lineWidth = 0.9;
  // Nothing leans in near a hut: there the paths run into each other, and an edge is the middle of the next one.
  const clear = DOOR_ROOM / length;
  for (let i = 0; i < length * 0.7; i++) {
    const p = offsetPoint(map, path, clear + rnd() * (1 - clear * 2), (rnd() < 0.5 ? -1 : 1) * (w / 2 - 1.5 + rnd() * 5));
    if (pal.blades) {
      // Leaning in over the edges, so the path sits in the ground and not on it.
      blade(ctx, rnd, p.x, p.y + 2, 3 + rnd() * 5, pal.blades);
    } else if (i % 3 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ellipse(ctx, p.x, p.y, 1.5 + rnd() * 2.5, 0.8 + rnd() * 0.7);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function paintPaths(g: Ground) {
  const { ctx, rnd, map } = g;
  const tone = PALETTE[map.scene].path;
  // An edge that is trodden out further in some places than others, so it is not ruled.
  const frays = map.paths.map((path) => {
    const length = pathLength(map, path.a, path.b);
    const fray: { x: number; y: number; rx: number; ry: number; angle: number }[] = [];
    for (const side of [-1, 1]) {
      for (let d = 20; d < length - 20; d += 4 + rnd() * 7) {
        const rx = 2.5 + rnd() * 4;
        const p = offsetPoint(map, path, d / length, side * (PATH_W[path.kind] / 2 - 1.2 + rnd() * 1.6));
        fray.push({ x: p.x, y: p.y, rx, ry: 1.6 + rnd() * 1.4, angle: p.angle });
      }
    }
    return fray;
  });
  const lay = (to: Ctx, index: number, grow: number) => {
    const path = map.paths[index];
    to.lineWidth = Math.max(3, PATH_W[path.kind] + grow);
    tracePath(to, map, path.a, path.b);
    to.stroke();
    if (grow < 0) return;
    for (const { x, y, rx, ry, angle } of frays[index]) {
      ellipse(to, x, y, rx + grow / 2, ry + grow / 2, angle);
      to.fill();
    }
  };

  // The two outer coats are see-through, and where paths meet one would lie on another and show
  // the join. Each is laid on a sheet of its own, every path rubbing out what is under it first.
  const sheet = document.createElement('canvas');
  sheet.width = ctx.canvas.width;
  sheet.height = ctx.canvas.height;
  const coat = sheet.getContext('2d')!;
  coat.setTransform(ctx.getTransform());
  coat.lineCap = 'round';
  // Thinned growth at the verge, then a dark worn edge.
  for (const [grow, colour] of [[16, tone.verge], [6, tone.edge]] as const) {
    coat.clearRect(0, 0, g.map.w, g.map.h);
    map.paths.forEach((_, index) => {
      coat.globalCompositeOperation = 'destination-out';
      coat.strokeStyle = coat.fillStyle = '#000';
      lay(coat, index, grow);
      coat.globalCompositeOperation = 'source-over';
      coat.strokeStyle = coat.fillStyle = colour;
      lay(coat, index, grow);
    });
    ctx.save();
    ctx.resetTransform();
    ctx.drawImage(sheet, 0, 0);
    ctx.restore();
  }
  // The packed surface, and a paler crown where the most feet go.
  ctx.lineCap = 'round';
  for (const [grow, colour] of [[0, tone.body], [-10, tone.crown]] as const) {
    ctx.strokeStyle = ctx.fillStyle = colour;
    map.paths.forEach((_, index) => lay(ctx, index, grow));
  }
  for (const path of map.paths) dressPath(g, path);
}

// The river.

function traceBand(ctx: Ctx, river: River, share: number, extra: number) {
  ctx.beginPath();
  for (let i = 0; i < river.pts.length; i++) {
    const d = riverDir(river, i);
    const half = river.half[i] * share + extra;
    ctx.lineTo(river.pts[i].x - d.y * half, river.pts[i].y + d.x * half);
  }
  for (let i = river.pts.length - 1; i >= 0; i--) {
    const d = riverDir(river, i);
    const half = river.half[i] * share + extra;
    ctx.lineTo(river.pts[i].x + d.y * half, river.pts[i].y - d.x * half);
  }
  ctx.closePath();
}

function paintRiver(g: Ground, river: River) {
  const { ctx, rnd, map } = g;
  const pal = PALETTE[map.scene];
  const count = river.pts.length;

  // The ground is dark with damp for a way back from the bank.
  for (const [extra, alpha] of [[20, 0.1], [14, 0.14]] as const) {
    traceBand(ctx, river, 1, extra);
    ctx.fillStyle = `rgba(${pal.edge}, ${alpha})`;
    ctx.fill();
  }
  traceBand(ctx, river, 1, 9);
  ctx.fillStyle = pal.water.bank;
  ctx.fill();
  // Wet mud at the foot of the bank, darker than the sand the water has washed.
  traceBand(ctx, river, 1, 5.5);
  ctx.fillStyle = 'rgba(30, 22, 12, 0.3)';
  ctx.fill();
  traceBand(ctx, river, 1, 3.5);
  ctx.fillStyle = pal.water.sand;
  ctx.fill();
  traceBand(ctx, river, 1, 0);
  ctx.fillStyle = pal.water.shallow;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Deepening by small steps to the middle, so the bed is seen to shelve and not to be striped.
  for (const [share, colour, alpha] of [[0.88, pal.water.mid, 0.4], [0.74, pal.water.mid, 0.6], [0.6, pal.water.deep, 0.35], [0.46, pal.water.deep, 0.5], [0.3, pal.water.deep, 0.6]] as const) {
    traceBand(ctx, river, share, 0);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = colour;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Still water under an overcast sky takes its colour from the bed and the banks more than from the sky.
  traceBand(ctx, river, 1, 0);
  ctx.fillStyle = 'rgba(38, 50, 46, 0.36)';
  ctx.fill();
  // The bank stands over the water, and the one towards the light shades it.
  ctx.translate(2, 3.5);
  traceBand(ctx, river, 1, 0);
  ctx.strokeStyle = 'rgba(10, 28, 40, 0.3)';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
  // Where the water laps the sand it leaves a broken line of foam.
  ctx.save();
  ctx.setLineDash([5, 8, 2, 11, 8, 14]);
  ctx.strokeStyle = 'rgba(236, 240, 232, 0.24)';
  ctx.lineWidth = 1.1;
  traceBand(ctx, river, 1, -1.2);
  ctx.stroke();
  ctx.restore();

  // Lines of current, where the surface catches the light.
  ctx.strokeStyle = 'rgba(236, 240, 232, 0.1)';
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (const lane of [-0.5, 0.08, 0.55]) {
    for (let i = Math.floor(rnd() * 12); i < count - 8; i += 9 + Math.floor(rnd() * 14)) {
      ctx.beginPath();
      for (let j = 0; j < 3 + Math.floor(rnd() * 4); j++) {
        const d = riverDir(river, i + j);
        ctx.lineTo(river.pts[i + j].x - d.y * lane * river.half[i + j], river.pts[i + j].y + d.x * lane * river.half[i + j]);
      }
      ctx.stroke();
    }
  }

  const inStream = (i: number, share: number) => {
    const d = riverDir(river, i);
    const off = (rnd() < 0.5 ? -1 : 1) * river.half[i] * share;
    return { x: river.pts[i].x - d.y * off, y: river.pts[i].y + d.x * off, d };
  };
  for (let i = 10 + Math.floor(rnd() * 16); i < count - 8; i += 20 + Math.floor(rnd() * 26)) {
    const p = inStream(i, rnd() * 0.6);
    if (nearTrail(g, p.x, p.y, 16)) continue;
    // The water parts round a stone and closes white behind it.
    ctx.strokeStyle = 'rgba(236, 240, 232, 0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(p.x + p.d.x * 3, p.y + p.d.y * 3, 5.5, 3.2, Math.atan2(p.d.y, p.d.x), -1.2, 1.2);
    ctx.stroke();
    stone(ctx, rnd, p.x, p.y, 2.6 + rnd() * 2.2, pal.stone, 'rgba(10, 28, 40, 0.4)');
  }

  if (map.scene === 'valley' || map.scene === 'ice') {
    for (let i = 6 + Math.floor(rnd() * 10); i < count - 6; i += 9 + Math.floor(rnd() * 14)) {
      const p = inStream(i, 0.5 + rnd() * 0.3);
      if (nearTrail(g, p.x, p.y, 18)) continue;
      if (map.scene === 'ice') floe(ctx, rnd, p.x, p.y, 3 + rnd() * 4);
      else lilyPad(ctx, rnd, p.x, p.y, 2.6 + rnd() * 2);
    }
  }

  // What stands on the banks. Further up the board first, so the nearer overlaps it.
  const every = { meadow: 14, scrub: 24, valley: 8, ice: 9, terrace: 14 }[map.scene];
  const bank: { x: number; y: number }[] = [];
  for (let i = 2; i < count - 2; i += Math.max(1, Math.round((every * (0.5 + rnd())) / 5))) {
    const d = riverDir(river, i);
    const off = (rnd() < 0.5 ? -1 : 1) * (river.half[i] + 1 + rnd() * 7);
    const x = river.pts[i].x - d.y * off;
    const y = river.pts[i].y + d.x * off;
    if (!nearTrail(g, x, y, 8)) bank.push({ x, y });
  }
  bank.sort((p, q) => p.y - q.y);
  for (const { x, y } of bank) {
    if (map.scene === 'ice') {
      ctx.fillStyle = 'rgba(120, 150, 190, 0.3)';
      ellipse(ctx, x + 1, y + 1.4, 5, 2.2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ellipse(ctx, x, y, 3 + rnd() * 3, 1.6 + rnd());
      ctx.fill();
    } else if (rnd() < 0.3) {
      stone(ctx, rnd, x, y, 1.6 + rnd() * 2.4, pal.stone, pal.cast);
    } else {
      // The reeds themselves stand in swarmFeel, where the wind can move them.
      tuft(ctx, rnd, x, y, 6 + rnd() * 5, pal.blades!);
    }
  }
}

/** A pool painted under a bridge or a ford that the map gives no river to cross. */
function paintPool(g: Ground, x: number, y: number, angle: number) {
  const { ctx, map } = g;
  const water = PALETTE[map.scene].water;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  for (const [share, extra, colour] of [[1, 8, water.bank], [1, 3, water.sand], [1, 0, water.shallow], [0.68, 0, water.mid], [0.36, 0, water.deep]] as const) {
    ctx.fillStyle = colour;
    ellipse(ctx, 0, 0, 22 * share + extra, 44 * share + extra);
    ctx.fill();
  }
  ctx.restore();
}

const PLANK = ['#a07a48', '#8e6a3c', '#b08a56', '#7c5a32', '#98733f'];

function paintBridge(g: Ground, crossing: Crossing) {
  const { ctx, rnd, map } = g;
  const { path } = crossing;
  const pal = PALETTE[map.scene];
  const mid = pathPoint(map, path.a, path.b, (crossing.f0 + crossing.f1) / 2);
  const span = Math.max(50, (crossing.f1 - crossing.f0) * pathLength(map, path.a, path.b) + 22);
  const half = PATH_W.bridge / 2 + 1;

  ctx.save();
  ctx.translate(mid.x + 5, mid.y + 8);
  ctx.rotate(mid.angle);
  ctx.fillStyle = 'rgba(8, 22, 30, 0.36)';
  ctx.fillRect(-span / 2 + 5, -half, span - 10, half * 2);
  ctx.restore();

  ctx.save();
  ctx.translate(mid.x, mid.y);
  ctx.rotate(mid.angle);
  // A stone footing on each bank for the timbers to bear on.
  for (const end of [-1, 1]) {
    ctx.fillStyle = 'rgba(20, 16, 10, 0.45)';
    ctx.fillRect(end * (span / 2) - 6, -half - 3, 12, half * 2 + 7);
    for (let k = -1; k <= 1; k++) {
      ctx.fillStyle = pickTone(rnd, pal.stone);
      ctx.beginPath();
      ctx.roundRect(end * (span / 2) - 5.5, k * (half * 0.74) - half * 0.37 - 0.6, 11, half * 0.74 - 0.8, 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#33210f';
  ctx.fillRect(-span / 2, -half, span, half * 2);
  for (let x = -span / 2; x < span / 2 - 0.5; x += 4.4) {
    ctx.fillStyle = pickTone(rnd, PLANK);
    ctx.fillRect(x + 0.35, -half + 0.4 + rnd() * 0.8, 3.7, half * 2 - 1.2 - rnd() * 0.8);
  }
  ctx.fillStyle = 'rgba(52, 34, 14, 0.16)';
  ctx.fillRect(-span / 2, -half * 0.5, span, half);
  ctx.fillStyle = '#5c4024';
  ctx.fillRect(-span / 2, -half, span, 1.8);
  ctx.fillRect(-span / 2, half - 1.8, span, 1.8);
  ctx.restore();

  // The rails stand up from the deck, so they are drawn in the board's frame and not the bridge's.
  const cos = Math.cos(mid.angle);
  const sin = Math.sin(mid.angle);
  const sides = cos >= 0 ? [-1, 1] : [1, -1];
  ctx.lineCap = 'round';
  for (const side of sides) {
    const edge = (t: number) => ({ x: mid.x + cos * t - sin * side * half, y: mid.y + sin * t + cos * side * half });
    const reach = span / 2 - 3;
    const posts = Math.max(2, Math.round(span / 18));
    for (let i = 0; i <= posts; i++) {
      const p = edge(-reach + (i / posts) * reach * 2);
      ctx.strokeStyle = '#3d2913';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x, p.y - 7.5);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(222, 188, 134, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(p.x - 0.8, p.y - 0.5);
      ctx.lineTo(p.x - 0.8, p.y - 7.5);
      ctx.stroke();
    }
    const from = edge(-reach);
    const to = edge(reach);
    ctx.strokeStyle = '#6b4a28';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 7);
    ctx.lineTo(to.x, to.y - 7);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232, 204, 154, 0.6)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y - 7.8);
    ctx.lineTo(to.x, to.y - 7.8);
    ctx.stroke();
  }
}

function paintFord(g: Ground, crossing: Crossing) {
  const { ctx, rnd, map, rivers } = g;
  const { path, f0, f1 } = crossing;
  const pal = PALETTE[map.scene];
  const length = pathLength(map, path.a, path.b);
  const mid = pathPoint(map, path.a, path.b, (f0 + f1) / 2);
  const reach = ((f1 - f0) * length) / 2 + 8;
  const breadth = PATH_W.ford / 2 + 17;

  ctx.save();
  // A pool lies across its path. A river runs the way its own line does, which the bar and its ripples follow.
  let flow = mid.angle + Math.PI / 2;
  if (crossing.river) {
    let nearest = Infinity;
    let under = rivers[0];
    for (const river of rivers) {
      river.pts.forEach((p, i) => {
        const gap = Math.hypot(p.x - mid.x, p.y - mid.y);
        if (gap >= nearest) return;
        nearest = gap;
        under = river;
        const d = riverDir(river, i);
        flow = Math.atan2(d.y, d.x);
      });
    }
    // Out to the sand and no further, so the bar comes up to both banks and stops there.
    traceBand(ctx, under, 1, 3.5);
    ctx.clip();
  } else {
    ctx.translate(mid.x, mid.y);
    ctx.rotate(mid.angle);
    ellipse(ctx, 0, 0, 25, 47);
    ctx.clip();
    ctx.rotate(-mid.angle);
    ctx.translate(-mid.x, -mid.y);
  }

  // A bar of gravel lies across the bed here, and the water over it is thin enough to see it through.
  ctx.save();
  ctx.translate(mid.x, mid.y);
  ctx.rotate(mid.angle);
  ctx.scale(1, breadth / reach);
  const bar = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * 1.2);
  bar.addColorStop(0, pal.water.sand + 'f0');
  bar.addColorStop(0.6, pal.water.sand + 'c0');
  bar.addColorStop(1, pal.water.sand + '00');
  ctx.fillStyle = bar;
  ctx.fillRect(-reach * 1.2, -reach * 1.2, reach * 2.4, reach * 2.4);
  ctx.restore();
  for (let i = 0; i < 70; i++) {
    const p = offsetPoint(map, path, f0 + (f1 - f0) * (rnd() * 1.2 - 0.1), (rnd() + rnd() - 1) * breadth);
    ctx.fillStyle = pickTone(rnd, pal.stone) + '90';
    ellipse(ctx, p.x, p.y, 0.8 + rnd() * 1.5, 0.6 + rnd() * 0.9, rnd() * 3);
    ctx.fill();
  }
  ctx.save();
  ctx.translate(mid.x, mid.y);
  ctx.rotate(mid.angle);
  ctx.scale(1, breadth / reach);
  const film = ctx.createRadialGradient(0, 0, 0, 0, 0, reach * 1.2);
  film.addColorStop(0, pal.water.shallow + '30');
  film.addColorStop(0.5, pal.water.shallow + '58');
  film.addColorStop(1, pal.water.shallow + '00');
  ctx.fillStyle = film;
  ctx.fillRect(-reach * 1.2, -reach * 1.2, reach * 2.4, reach * 2.4);
  ctx.restore();

  // The water breaks as it comes off the bar, in little curls that open downstream.
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 16; i++) {
    const p = offsetPoint(map, path, f0 + rnd() * (f1 - f0), (rnd() - 0.5) * breadth * 1.7);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, 2.5 + rnd() * 3, 2 + rnd() * 2, flow, -1.1, 1.1);
    ctx.stroke();
  }
  ctx.restore();

  for (let d = f0 * length - 6, k = 0; d <= f1 * length + 6; d += 8.5, k++) {
    const p = offsetPoint(map, path, d / length, (k % 2 === 0 ? -4.6 : 4.6) + (rnd() - 0.5) * 2);
    const rx = 4 + rnd() * 1.4;
    ctx.fillStyle = 'rgba(8, 28, 40, 0.42)';
    ellipse(ctx, p.x + 1, p.y + 1.8, rx + 0.8, rx * 0.62);
    ctx.fill();
    if (riverGap(rivers, p.x, p.y) < 0 || !crossing.river) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(p.x + Math.cos(flow) * 2, p.y + Math.sin(flow) * 2, rx + 2.4, rx * 0.7 + 1.2, flow, -1.3, 1.3);
      ctx.stroke();
    }
    ctx.fillStyle = pickTone(rnd, pal.stone);
    ellipse(ctx, p.x, p.y, rx, rx * 0.6, (rnd() - 0.5) * 0.6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 250, 0.35)';
    ellipse(ctx, p.x - rx * 0.25, p.y - rx * 0.18, rx * 0.5, rx * 0.22);
    ctx.fill();
  }
}

// What is under the paths in each place.

/** Fine grain: specks a little darker and a little lighter than the ground they lie on. */
function speckle(g: Ground, count: number, dark: string, light: string) {
  const { ctx, rnd } = g;
  for (let i = 0; i < count * g.area; i++) {
    ctx.fillStyle = rnd() < 0.5 ? dark : light;
    ellipse(ctx, rnd() * g.map.w, rnd() * g.map.h, 0.5 + rnd() * 1.2, 0.4 + rnd() * 0.7, rnd() * 3);
    ctx.fill();
  }
}

function blotches(g: Ground, count: number, tones: readonly string[], alpha: string, least: number, most: number) {
  const { ctx, rnd } = g;
  for (let i = 0; i < count * g.area; i++) {
    const x = rnd() * g.map.w;
    const y = rnd() * g.map.h;
    const r = least + rnd() * (most - least);
    const tone = ctx.createRadialGradient(x, y, 0, x, y, r);
    const colour = pickTone(rnd, tones);
    tone.addColorStop(0, colour + alpha);
    tone.addColorStop(1, colour + '00');
    ctx.fillStyle = tone;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

function scrubGround(g: Ground) {
  const { ctx, rnd } = g;
  speckle(g, 2600, 'rgba(110, 80, 44, 0.3)', 'rgba(244, 230, 196, 0.35)');
  // Pans where water stood and the mud dried into plates.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let pan = 0; pan < 10; pan++) {
    const px = rnd() * g.map.w;
    const py = rnd() * g.map.h;
    const reach = 55 + rnd() * 70;
    const glaze = ctx.createRadialGradient(px, py, 0, px, py, reach);
    glaze.addColorStop(0, 'rgba(226, 204, 160, 0.5)');
    glaze.addColorStop(1, 'rgba(226, 204, 160, 0)');
    ctx.fillStyle = glaze;
    ctx.fillRect(px - reach, py - reach, reach * 2, reach * 2);
    const cell = 15;
    const span = Math.ceil(reach / cell);
    const corner = (i: number, j: number) => {
      const jitter = mulberry32(Math.imul(pan * 4099 + (i + 64) * 131 + (j + 64), 0x9e3779b1));
      return { x: px + i * cell + (jitter() - 0.5) * 11, y: py + (j * cell + (jitter() - 0.5) * 11) * 0.7 };
    };
    const inside = (p: Point) => Math.hypot(p.x - px, (p.y - py) / 0.7) < reach * (0.75 + 0.2 * Math.sin(p.x * 0.07 + p.y * 0.05));
    for (const [dx, dy, colour, width] of [[0.8, 0.9, 'rgba(246, 232, 198, 0.4)', 0.8], [0, 0, 'rgba(84, 56, 26, 0.5)', 1]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = -span; i < span; i++) {
        for (let j = -span; j < span; j++) {
          const p = corner(i, j);
          if (!inside(p)) continue;
          for (const q of [corner(i + 1, j), corner(i, j + 1)]) {
            if (!inside(q)) continue;
            ctx.moveTo(p.x + dx, p.y + dy);
            ctx.lineTo(q.x + dx, q.y + dy);
          }
        }
      }
      ctx.stroke();
    }
  }
  // And long cracks across the open ground.
  for (let i = 0; i < 46; i++) {
    let x = rnd() * g.map.w;
    let y = rnd() * g.map.h;
    let angle = rnd() * Math.PI * 2;
    ctx.strokeStyle = 'rgba(84, 56, 26, 0.42)';
    ctx.lineWidth = 0.7 + rnd() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let leg = 0; leg < 5 + rnd() * 7; leg++) {
      angle += (rnd() - 0.5) * 1.3;
      x += Math.cos(angle) * (6 + rnd() * 11);
      y += Math.sin(angle) * (6 + rnd() * 11) * 0.7;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  turf(g, 1500, 3, 8, PALETTE.scrub.blades!);
}

function iceGround(g: Ground) {
  const { ctx, rnd } = g;
  // Sheets of bare ice where the wind has scoured the snow off.
  for (let sheet = 0; sheet < 7; sheet++) {
    const x = rnd() * g.map.w;
    const y = rnd() * g.map.h;
    const reach = 34 + rnd() * 46;
    const corners: Point[] = [];
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2;
      const r = reach * (0.7 + rnd() * 0.45);
      corners.push({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r * 0.55 });
    }
    const trace = () => {
      ctx.beginPath();
      for (const p of corners) ctx.lineTo(p.x, p.y);
      ctx.closePath();
    };
    trace();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const glaze = ctx.createLinearGradient(x - reach, y - reach * 0.5, x + reach, y + reach * 0.5);
    glaze.addColorStop(0, '#c4dceb');
    glaze.addColorStop(1, '#93b6d0');
    ctx.fillStyle = glaze;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const sx = x - reach + rnd() * reach * 1.4;
      ctx.beginPath();
      ctx.moveTo(sx, y + reach);
      ctx.lineTo(sx + reach * 0.9, y - reach);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(244, 251, 255, 0.85)';
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 4; i++) {
      let cx = x + (rnd() - 0.5) * reach;
      let cy = y + (rnd() - 0.5) * reach * 0.5;
      let angle = rnd() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      for (let leg = 0; leg < 5; leg++) {
        angle += (rnd() - 0.5) * 1.2;
        cx += Math.cos(angle) * 9;
        cy += Math.sin(angle) * 6;
        ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  // Drifts all lying the way the wind left them, each with its blue lee side.
  // They gather in a few fields with bare crust between, as snow does behind whatever broke the wind.
  for (let field = 0; field < 9; field++) {
    const fx = rnd() * g.map.w;
    const fy = rnd() * g.map.h;
    for (let i = 0; i < 4; i++) {
      const x = fx + (rnd() - 0.5) * 150;
      const y = fy + (rnd() - 0.5) * 60;
      const rx = 16 + rnd() * 40;
      const ry = rx * (0.16 + rnd() * 0.1);
      ctx.fillStyle = 'rgba(112, 146, 190, 0.22)';
      ellipse(ctx, x + 2.5, y + 3, rx, ry, WIND);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ellipse(ctx, x, y, rx, ry, WIND);
      ctx.fill();
    }
  }
  // Between the drifts the wind has cut the crust into fine ridges, all one way.
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = rnd() * g.map.w;
    const y = rnd() * g.map.h;
    const reach = 4 + rnd() * 10;
    for (const [drop, colour] of [[0.9, 'rgba(112, 146, 190, 0.3)'], [0, 'rgba(255, 255, 255, 0.7)']] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y + drop);
      ctx.lineTo(x + Math.cos(WIND) * reach, y + Math.sin(WIND) * reach + drop);
      ctx.stroke();
    }
  }
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = 'rgba(140, 168, 200, 0.28)';
    ellipse(ctx, rnd() * g.map.w, rnd() * g.map.h, 0.6 + rnd() * 1.2, 0.4 + rnd() * 0.5);
    ctx.fill();
  }
}

const TERRACE_LOW = [112, 130, 60];
const TERRACE_HIGH = [190, 196, 122];
const VINE = ['#34521f', '#456a2a', '#5d8436'];

/** The trodden ground a hut stands on. */
function wornGround(g: Ground, site: Site) {
  const { ctx, map } = g;
  const pal = PALETTE[map.scene];
  const worn = ctx.createRadialGradient(site.x, site.y, 14, site.x, site.y, 122);
  worn.addColorStop(0, `rgba(${pal.worn}, 0.85)`);
  worn.addColorStop(0.55, `rgba(${pal.worn}, 0.4)`);
  worn.addColorStop(1, `rgba(${pal.worn}, 0)`);
  ctx.fillStyle = worn;
  ctx.save();
  ctx.translate(site.x, site.y);
  ctx.scale(1, 0.62);
  ctx.translate(-site.x, -site.y);
  ctx.fillRect(site.x - 125, site.y - 125, 250, 250);
  ctx.restore();
}

function terraceGround(g: Ground) {
  const { ctx, rnd, map, rings, summit } = g;
  const pal = PALETTE.terrace;
  const own = map.sites.map((site) => levelAt(g, site.x, site.y));
  map.sites.forEach((site, i) => {
    if (own[i] === 0) wornGround(g, site);
  });
  rings.forEach((ring, at) => {
    const level = at + 1;
    const reach = Math.max(...ring.r);
    // The wall throws its shadow down the hill and away from the light, soft at its far edge.
    for (const [shift, drop, alpha] of [[5, WALL_H + 9, 0.12], [3, WALL_H + 5, 0.16], [1, WALL_H + 2, 0.2]] as const) {
      ctx.save();
      ctx.translate(shift, 0);
      traceRing(ctx, summit, ring, 1, drop);
      ctx.fillStyle = `rgba(30, 34, 12, ${alpha})`;
      ctx.fill();
      ctx.restore();
    }
    // The wall is the ring carried straight down to the terrace below.
    ctx.fillStyle = '#6a5c40';
    for (let drop = WALL_H; drop > 0; drop -= 2) {
      traceRing(ctx, summit, ring, 1, drop);
      ctx.fill();
    }
    ctx.save();
    traceRing(ctx, summit, ring, 1, WALL_H);
    ctx.clip();
    const course = 3.8;
    for (let y = Math.max(0, summit.y - reach * RING_SQUASH), row = 0; y < Math.min(g.map.h, summit.y + reach * RING_SQUASH) + WALL_H + course; y += course, row++) {
      for (let x = Math.max(0, summit.x - reach) - (row % 2) * 4; x < Math.min(g.map.w, summit.x + reach); ) {
        const length = 5 + rnd() * 6;
        // Only the stones below the ring's edge are ever seen: the terrace's own turf covers the rest.
        if (!inRing(summit, ring, x + length / 2, y - course)) {
          ctx.fillStyle = pickTone(rnd, pal.stone);
          ctx.beginPath();
          ctx.roundRect(x + 0.3, y - course + 0.3, length - 0.6, course - 0.6, 1.1);
          ctx.fill();
        }
        x += length;
      }
    }
    // The light comes from the left, so a wall is darker the further round to the right it faces, and darkest at its foot.
    const side = ctx.createLinearGradient(summit.x - reach, 0, summit.x + reach, 0);
    side.addColorStop(0, 'rgba(255, 244, 206, 0.12)');
    side.addColorStop(0.45, 'rgba(30, 22, 8, 0.04)');
    side.addColorStop(1, 'rgba(30, 22, 8, 0.4)');
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, g.map.w, g.map.h);
    ctx.translate(0, -3);
    traceRing(ctx, summit, ring, 1, WALL_H + 3);
    ctx.strokeStyle = 'rgba(30, 22, 8, 0.3)';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.restore();

    traceRing(ctx, summit, ring);
    const share = level / rings.length;
    ctx.fillStyle = `rgb(${TERRACE_LOW.map((low, i) => Math.round(low + (TERRACE_HIGH[i] - low) * share)).join(', ')})`;
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (let i = 0; i < 14; i++) {
      const angle = rnd() * Math.PI * 2;
      const r = rnd() * reach;
      const x = summit.x + Math.cos(angle) * r;
      const y = summit.y + Math.sin(angle) * r * RING_SQUASH;
      const size = 40 + rnd() * 90;
      const tone = ctx.createRadialGradient(x, y, 0, x, y, size);
      const colour = pickTone(rnd, pal.tones);
      tone.addColorStop(0, colour + '30');
      tone.addColorStop(1, colour + '00');
      ctx.fillStyle = tone;
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
    }
    // A hut's trodden ground stops at the edge of the terrace it stands on: the next ring in covers what runs uphill.
    map.sites.forEach((site, i) => {
      if (own[i] === level) wornGround(g, site);
    });
    ctx.restore();

    // Coping stones catch the light along the top of a wall we can see the face of; a far edge only falls away.
    for (const [front, colour, width] of [[true, 'rgba(244, 234, 198, 0.75)', 1.7], [false, 'rgba(40, 46, 16, 0.3)', 1.2]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < RING_STEPS; i++) {
        const from = (i / RING_STEPS) * Math.PI * 2;
        const to = ((i + 1) / RING_STEPS) * Math.PI * 2;
        const next = ring.r[(i + 1) % RING_STEPS];
        const fx = summit.x + Math.cos(from) * ring.r[i];
        const tx = summit.x + Math.cos(to) * next;
        // Going round this way the outside is on the left, so the edge faces us where it runs to the left.
        if (tx < fx !== front) continue;
        ctx.moveTo(fx, summit.y + Math.sin(from) * ring.r[i] * RING_SQUASH);
        ctx.lineTo(tx, summit.y + Math.sin(to) * next * RING_SQUASH);
      }
      ctx.stroke();
    }

    // Every other terrace is planted in rows that follow the wall round, where it is broad enough to plant.
    const inner = rings[at + 1];
    if (!inner || at % 2 === 1) return;
    for (const row of [0.3, 0.58, 0.84]) {
      const steps = Math.floor(reach * 0.62);
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const depth = ringAt(ring, angle) - ringAt(inner, angle);
        const r = ringAt(inner, angle) + depth * row;
        const x = summit.x + Math.cos(angle) * r;
        const y = summit.y + Math.sin(angle) * r * RING_SQUASH;
        // The rows stop short of a road's verge and of the ground a hut stands on.
        if (depth < 60 || nearTrail(g, x, y, 12) || onWall(g, x, y)) continue;
        if (map.sites.some((site) => Math.hypot(site.x - x, (site.y - y) / RING_SQUASH) < siteRadius(site, 3) + PAD_ROOM)) continue;
        ctx.fillStyle = 'rgba(30, 34, 12, 0.28)';
        ellipse(ctx, x + 1.2, y + 1.4, 3.4, 2);
        ctx.fill();
        ctx.fillStyle = VINE[0];
        ellipse(ctx, x, y, 3.2, 2.5);
        ctx.fill();
        ctx.fillStyle = VINE[1 + Math.floor(rnd() * 2)];
        ellipse(ctx, x - 0.8, y - 0.9, 2, 1.5);
        ctx.fill();
      }
    }
  });
  speckle(g, 1500, 'rgba(52, 60, 22, 0.3)', 'rgba(214, 216, 150, 0.3)');
  turf(g, 4600, 3, 8, pal.blades!);
}

const RAMP = 22;

/** Where a path goes from one terrace to the next the wall is opened for it, and the path goes up a ramp between two posts. */
function paintRamps(g: Ground) {
  const { ctx, rnd, map } = g;
  const pal = PALETTE.terrace;
  for (const path of map.paths) {
    const length = pathLength(map, path.a, path.b);
    const w = PATH_W[path.kind];
    let was = levelAt(g, map.sites[path.a].x, map.sites[path.a].y);
    for (let d = 3; d <= length; d += 3) {
      const here = pathPoint(map, path.a, path.b, d / length);
      const level = levelAt(g, here.x, here.y);
      if (level === was) continue;
      const rise = level > was ? 1 : -1;
      was = level;
      const lip = pathPoint(map, path.a, path.b, (d - 1.5) / length);
      const ux = Math.cos(lip.angle) * rise;
      const uy = Math.sin(lip.angle) * rise;

      ctx.save();
      ctx.translate(lip.x, lip.y);
      ctx.rotate(Math.atan2(uy, ux));
      // The foot of the ramp is in the wall's shadow and its head is in the light.
      const slope = ctx.createLinearGradient(-RAMP, 0, 6, 0);
      slope.addColorStop(0, 'rgba(40, 30, 12, 0)');
      slope.addColorStop(0.25, 'rgba(40, 30, 12, 0.32)');
      slope.addColorStop(0.7, 'rgba(255, 246, 214, 0.1)');
      slope.addColorStop(1, 'rgba(255, 246, 214, 0.42)');
      ctx.fillStyle = slope;
      ctx.fillRect(-RAMP, -w / 2, RAMP + 6, w);
      if (path.kind !== 'climb') {
        // A climb has its steps all the way. Any other path is given a few here, each with its riser dark and its tread lit.
        ctx.lineCap = 'butt';
        for (const x of [-RAMP * 0.72, -RAMP * 0.4, -RAMP * 0.08]) {
          for (const [shift, colour, width] of [[0, 'rgba(46, 34, 16, 0.5)', 1.5], [1.5, 'rgba(255, 248, 222, 0.5)', 1]] as const) {
            ctx.strokeStyle = colour;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(x + shift, -w / 2 + 1);
            ctx.lineTo(x + shift, w / 2 - 1);
            ctx.stroke();
          }
        }
        ctx.lineCap = 'round';
      }
      ctx.restore();

      for (const side of [-1, 1]) {
        const reach = side * (w / 2 + 4.5);
        const x = lip.x - uy * reach;
        const y = lip.y + ux * reach;
        g.props.push({
          y,
          paint: () => {
            ctx.fillStyle = pal.cast;
            ellipse(ctx, x + 3.5, y + 1.6, 6.5, 2.6);
            ctx.fill();
            ctx.fillStyle = pal.wall[1];
            ctx.fillRect(x - 4.2, y - 7, 8.4, 9);
            ctx.fillStyle = pal.wall[2];
            ctx.globalAlpha = 0.5;
            ctx.fillRect(x + 1.4, y - 7, 2.8, 9);
            ctx.globalAlpha = 1;
            ctx.fillStyle = pal.wall[0];
            ctx.beginPath();
            ctx.roundRect(x - 4.9, y - 10.4, 9.8, 4.6, 1.4);
            ctx.fill();
          },
        });
        // Smaller stones run down beside the ramp to hold its edge.
        for (const [back, size] of [[0.45, 3.6], [0.9, 2.6]] as const) {
          const sx = x - ux * RAMP * back;
          const sy = y - uy * RAMP * back;
          g.props.push({ y: sy, paint: () => stone(ctx, rnd, sx, sy, size, pal.stone, pal.cast) });
        }
      }
    }
  }
}

// What lies about on top.

function meadowScatter(g: Ground) {
  const { ctx, rnd } = g;
  const pal = PALETTE.meadow;
  scatter(g, 24, 4, 0.5, (x, y) => stone(ctx, rnd, x, y, 2.5 + rnd() * 4.5, pal.stone, 'rgba(30, 38, 18, 0.3)'));
  scatter(g, 5, 8, 0.4, (x, y) => rubble(ctx, rnd, x, y, 7 + rnd() * 5, pal.stone, 'rgba(30, 38, 18, 0.3)'));
  scatter(g, 12, 4, 0.2, (x, y) => deadLeaf(ctx, rnd, x, y));
  scatter(g, 64, 3, 0.25, (x, y) => tuft(ctx, rnd, x, y, 6 + rnd() * 5, pal.blades!));
  scatter(g, 30, 2, 0.12, (x, y) => flower(ctx, x, y, 1.5 + rnd() * 1.1, '#f4f1e4', '#e0a81f'));
  scatter(g, 14, 2, 0.1, (x, y) => flower(ctx, x, y, 1.2 + rnd() * 0.7, '#f1cf3a', '#c98a12'));
  scatter(g, 8, 16, 0.05, (x, y) => bush(ctx, rnd, x, y, 11 + rnd() * 6, ['#3c5a2a', '#4f7236', '#6a8e45'], pal.cast));
  scatter(g, 2, 20, 0.3, (x, y) => fallenLog(ctx, rnd, x, y, 30 + rnd() * 14, pal.cast, true));
}

function scrubScatter(g: Ground) {
  const { ctx, rnd } = g;
  const pal = PALETTE.scrub;
  scatter(g, 30, 4, 0.5, (x, y) => stone(ctx, rnd, x, y, 2.5 + rnd() * 5, pal.stone, pal.cast));
  scatter(g, 6, 8, 0.4, (x, y) => rubble(ctx, rnd, x, y, 7 + rnd() * 6, pal.stone, pal.cast));
  scatter(g, 70, 3, 0.3, (x, y) => tuft(ctx, rnd, x, y, 6 + rnd() * 6, pal.blades!));
  scatter(g, 5, 12, 0.35, (x, y) => deadBranch(ctx, rnd, x, y, 16 + rnd() * 12, pal.cast));
  scatter(g, 6, 16, 0.1, (x, y) => rock(ctx, rnd, x, y, 11 + rnd() * 9, ['#dccba2', '#b99f70', '#8a6e44'], pal.cast, false));
  scatter(g, 10, 14, 0.1, (x, y) => thornBush(ctx, rnd, x, y, 13 + rnd() * 8, pal.cast));
  scatter(g, 11, 20, 0.15, (x, y) => bramble(ctx, rnd, x, y, 15 + rnd() * 10, pal.cast));
}

function valleyScatter(g: Ground) {
  const { ctx, rnd } = g;
  const pal = PALETTE.valley;
  scatter(g, 20, 4, 0.4, (x, y) => {
    const rx = 3 + rnd() * 5;
    stone(ctx, rnd, x, y, rx, pal.stone, pal.cast);
    ctx.fillStyle = 'rgba(84, 118, 50, 0.8)';
    ellipse(ctx, x - rx * 0.1, y - rx * 0.25, rx * 0.6, rx * 0.25);
    ctx.fill();
  });
  scatter(g, 60, 3, 0.25, (x, y) => tuft(ctx, rnd, x, y, 7 + rnd() * 6, pal.blades!));
  scatter(g, 22, 2, 0.1, (x, y) => flower(ctx, x, y, 1.4 + rnd() * 0.9, '#f4f1e4', '#e0a81f'));
  scatter(g, 14, 2, 0.1, (x, y) => flower(ctx, x, y, 1.1 + rnd() * 0.6, '#c6d6f2', '#f1e08a'));
  scatter(g, 5, 5, 0, (x, y) => mushrooms(ctx, rnd, x, y, pal.cast));
  scatter(g, 26, 10, 0.06, (x, y) => fern(ctx, rnd, x, y, 10 + rnd() * 7, pal.cast));
  scatter(g, 11, 16, 0.05, (x, y) => bush(ctx, rnd, x, y, 11 + rnd() * 8, ['#24481f', '#34632a', '#4d8238', '#6a9c46'], pal.cast));
  scatter(g, 2, 20, 0.2, (x, y) => fallenLog(ctx, rnd, x, y, 30 + rnd() * 16, pal.cast, true));
}

function iceScatter(g: Ground) {
  const { ctx, rnd } = g;
  const pal = PALETTE.ice;
  scatter(g, 14, 4, 0.5, (x, y) => stone(ctx, rnd, x, y, 2 + rnd() * 3.5, pal.stone, pal.cast));
  scatter(g, 5, 8, 0.3, (x, y) => rubble(ctx, rnd, x, y, 6 + rnd() * 5, pal.stone, pal.cast));
  scatter(g, 16, 8, 0.5, (x, y) => snowMound(ctx, x, y, 8 + rnd() * 9, pal.cast));
  scatter(g, 10, 3, 0.3, (x, y) => tuft(ctx, rnd, x, y, 5 + rnd() * 4, ['#b7a878', '#9c8e60', '#cdbf92']));
  scatter(g, 10, 16, 0.12, (x, y) => rock(ctx, rnd, x, y, 10 + rnd() * 11, ['#8a939c', '#636c76', '#434b54'], pal.cast, true));
  scatter(g, 13, 12, 0.15, (x, y) => shards(ctx, rnd, x, y, 12 + rnd() * 12, pal.cast));
}

function terraceScatter(g: Ground) {
  const { ctx, rnd } = g;
  const pal = PALETTE.terrace;
  scatter(g, 24, 4, 0.5, (x, y) => stone(ctx, rnd, x, y, 2.2 + rnd() * 3.6, pal.stone, pal.cast));
  scatter(g, 5, 8, 0.4, (x, y) => rubble(ctx, rnd, x, y, 6 + rnd() * 5, pal.stone, pal.cast));
  scatter(g, 50, 3, 0.3, (x, y) => tuft(ctx, rnd, x, y, 6 + rnd() * 5, pal.blades!));
  scatter(g, 18, 2, 0.12, (x, y) => flower(ctx, x, y, 1.3 + rnd() * 0.8, '#f4f1e4', '#e0a81f'));
  scatter(g, 10, 14, 0.08, (x, y) => bush(ctx, rnd, x, y, 10 + rnd() * 6, ['#2c4a22', '#3e6430', '#587f3c'], pal.cast));
}

export function paintGround(ctx: Ctx, map: SwarmMap, seed: number, rivers: River[]) {
  const rnd = mulberry32(seed ^ 0x51ab);
  const pal = PALETTE[map.scene];
  const trail: Ground['trail'] = [];
  for (const path of map.paths) {
    const samples = Math.ceil(pathLength(map, path.a, path.b) / 8);
    for (let i = 0; i <= samples; i++) {
      const p = pathPoint(map, path.a, path.b, i / samples);
      trail.push({ x: p.x, y: p.y, half: PATH_W[path.kind] / 2 });
    }
  }
  const groves: Ground['groves'] = [];
  const area = areaOf(map);
  for (let i = 0; i < 6 * area; i++) groves.push({ x: rnd() * map.w, y: rnd() * map.h, r: 70 + rnd() * 60 });
  const g: Ground = { ctx, rnd, map, rivers, trail, rings: map.scene === 'terrace' ? ringsOf(map, seed) : [], summit: summitOf(map), area, groves, props: [] };

  ctx.fillStyle = pal.base;
  ctx.fillRect(0, 0, map.w, map.h);
  // Uneven tone at two sizes, so the ground is not one flat colour from far off or from close to.
  blotches(g, 110, pal.tones, '3d', 50, 200);
  blotches(g, 240, pal.tones, '2e', 9, 36);

  if (map.scene === 'meadow') {
    // Dry patches, and a few places worn to the earth.
    blotches(g, 40, ['#8f9450', '#a39c5a'], '3a', 14, 46);
    blotches(g, 9, ['#86704a'], '55', 10, 26);
    speckle(g, 1800, 'rgba(40, 56, 22, 0.3)', 'rgba(204, 216, 136, 0.3)');
    turf(g, 6500, 3, 9, pal.blades!);
  }
  if (map.scene === 'valley') {
    blotches(g, 60, ['#2f5a26', '#3d6e2a'], '50', 12, 44);
    speckle(g, 1800, 'rgba(18, 40, 16, 0.32)', 'rgba(150, 190, 100, 0.28)');
    turf(g, 7200, 4, 11, pal.blades!);
  }
  if (map.scene === 'scrub') scrubGround(g);
  if (map.scene === 'ice') iceGround(g);
  if (map.scene === 'terrace') terraceGround(g);

  if (pal.blades && g.rings.length === 0) {
    // Under thick growth the ground is in shade.
    for (const grove of groves) {
      ctx.save();
      ctx.translate(grove.x, grove.y);
      ctx.scale(1, 0.7);
      const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, grove.r);
      shade.addColorStop(0, `rgba(${pal.edge}, 0.26)`);
      shade.addColorStop(1, `rgba(${pal.edge}, 0)`);
      ctx.fillStyle = shade;
      ctx.fillRect(-grove.r, -grove.r, grove.r * 2, grove.r * 2);
      ctx.restore();
    }
  }

  for (const site of map.sites) {
    if (map.scene !== 'terrace') wornGround(g, site);
    if (!site.tower) continue;
    // A tower's footing is dug out to the ice, and what was dug lies in a bank round the far side of it.
    const reach = siteRadius(site, site.level);
    ctx.fillStyle = 'rgba(96, 128, 166, 0.5)';
    ellipse(ctx, site.x, site.y, reach * 0.95, reach * 0.5);
    ctx.fill();
    ctx.fillStyle = '#b4c8da';
    ellipse(ctx, site.x, site.y - 1, reach * 0.88, reach * 0.45);
    ctx.fill();
    ctx.lineCap = 'round';
    for (const [drop, colour, width] of [[2.2, 'rgba(96, 130, 178, 0.4)', 6], [0, '#ffffff', 5.5]] as const) {
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.ellipse(site.x, site.y + drop, reach * 1.02, reach * 0.56, 0, Math.PI * 0.95, Math.PI * 2.05);
      ctx.stroke();
    }
  }

  paintPaths(g);
  if (map.scene === 'terrace') paintRamps(g);
  // The river goes over the paths, so a path that meets it ends at the bank and is carried over by what is built there.
  for (const river of rivers) paintRiver(g, river);
  for (const crossing of crossingsOf(map, rivers)) {
    if (!crossing.river) {
      const mid = pathPoint(map, crossing.path.a, crossing.path.b, 0.5);
      paintPool(g, mid.x, mid.y, mid.angle);
    }
    if (crossing.path.kind === 'bridge') paintBridge(g, crossing);
    else paintFord(g, crossing);
  }

  if (map.scene === 'meadow') meadowScatter(g);
  if (map.scene === 'scrub') scrubScatter(g);
  if (map.scene === 'valley') valleyScatter(g);
  if (map.scene === 'ice') iceScatter(g);
  if (map.scene === 'terrace') terraceScatter(g);
  g.props.sort((p, q) => p.y - q.y);
  for (const prop of g.props) prop.paint();

  // Everything is taken a third of the way to grey together, so the scene keeps one quiet key and what little colour is left (a flower, the water) is the accent.
  ctx.globalCompositeOperation = 'saturation';
  ctx.fillStyle = 'rgba(128, 128, 128, 0.32)';
  ctx.fillRect(0, 0, map.w, map.h);
  ctx.globalCompositeOperation = 'source-over';

  // The corners fall away a little, which keeps the eye on the middle of the board.
  const edge = ctx.createRadialGradient(map.w / 2, map.h / 2, map.h * 0.45, map.w / 2, map.h / 2, map.w * 0.68);
  edge.addColorStop(0, `rgba(${pal.edge}, 0)`);
  edge.addColorStop(1, `rgba(${pal.edge}, ${map.scene === 'ice' ? 0.26 : 0.38})`);
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, map.w, map.h);
}
