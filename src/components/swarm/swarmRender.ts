// Swarm's painting. Everything is drawn in code: the ground and paths once per
// map and size into an offscreen canvas, each hut once per look into a sprite,
// and the units, badges and effects every frame on top.
//
// Ants build earth mounds, bees build coiled straw skeps, and a hut nobody
// holds is a grey dry-stone dome. The three differ in outline as well as in
// colour, so the sides can be told apart without relying on hue.

import {
  SPEED,
  TOWER_RANGE,
  WORLD_H,
  WORLD_W,
  mulberry32,
  nextHop,
  pathLength,
  sendSize,
  upgradeCost,
  type Owner,
  type Seat,
  type SwarmEvent,
  type SwarmMap,
  type SwarmState,
} from '../../swarmGameLogic';

/** Half-width of a hut on the ground in world units, by level. */
const HUT_R = [42, 50, 58];
/** How far the hut stands above its base, as a multiple of its half-width, by level. */
const HUT_RISE = [1, 1.14, 1.28];
/** How far a holder's flagpole stands above the roof, as a multiple of the half-width. */
const FLAG_RISE = 0.5;

const BADGE: Record<'a' | 'b' | 'none', { fill: string; text: string }> = {
  a: { fill: '#8f2f1a', text: '#ffffff' },
  b: { fill: '#f0b429', text: '#2a1c00' },
  none: { fill: '#5f5f5a', text: '#ffffff' },
};

type Rnd = () => number;

interface Fx {
  kind: 'capture' | 'clash' | 'upgrade' | 'shot';
  x: number;
  y: number;
  at: number;
  seat: Owner;
  /** The tower a shot was fired from. */
  tower?: number;
}

const FX_MS = { capture: 700, clash: 360, upgrade: 600, shot: 420 };
/** How much of a shot's time the ball is in the air before it bursts. */
const SHOT_FLIGHT = 0.4;
/** Burn marks kept on the ground; the oldest goes when another lands. */
const SCORCH_MAX = 70;

export interface Scene {
  map: SwarmMap;
  seed: number;
  ground: HTMLCanvasElement | null;
  sprites: Map<string, HTMLCanvasElement>;
  /** Pixels per world unit the ground and sprites were painted at. */
  scale: number;
  fx: Fx[];
  /** When each hut's garrison last took a hit, for the badge to jolt. */
  hitAt: number[];
  /** Where cannon balls have landed, burnt into the ground. */
  scorches: { x: number; y: number }[];
}

export function newScene(map: SwarmMap, seed: number): Scene {
  return { map, seed, ground: null, sprites: new Map(), scale: 0, fx: [], hitAt: map.sites.map(() => -Infinity), scorches: [] };
}

export interface View {
  seat: Seat;
  /** How far into the next tick the frame is, 0 to 1 and a little over. */
  alpha: number;
  now: number;
  selected: number | null;
  /** Shift is held: a send takes everything and not half. */
  sendAll: boolean;
  /** Every hut the drag has swept up, the pointer, and the hut under it. */
  drag: { sources: number[]; x: number; y: number; target: number | null } | null;
  /** 0 to 1: how long the pointer has rested on the target, towards sending everything. */
  hold: number;
  /** A press that could not be acted on, for that hut's count to shake its head. */
  refused: { hut: number; at: number } | null;
  /** The order just given, shown at once because its units leave some ticks later. */
  sent: { from: number[]; at: number } | null;
}

function bendOf(a: number, b: number): number {
  let h = Math.imul(Math.min(a, b) * 64 + Math.max(a, b) + 1, 0x9e3779b1) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return ((h % 201) - 100) / 100 * 0.12;
}

/** The control point that gives the path between two huts its curve. */
function controlOf(map: SwarmMap, a: number, b: number): { x: number; y: number } {
  const low = map.sites[Math.min(a, b)];
  const high = map.sites[Math.max(a, b)];
  const bend = bendOf(a, b);
  return {
    x: (low.x + high.x) / 2 - (high.y - low.y) * bend,
    y: (low.y + high.y) / 2 + (high.x - low.x) * bend,
  };
}

/** Where a unit is `f` of the way from one hut to another, and which way it faces. */
export function pathPoint(map: SwarmMap, from: number, to: number, f: number): { x: number; y: number; angle: number } {
  const p0 = map.sites[from];
  const p2 = map.sites[to];
  const c = controlOf(map, from, to);
  const g = 1 - f;
  return {
    x: g * g * p0.x + 2 * g * f * c.x + f * f * p2.x,
    y: g * g * p0.y + 2 * g * f * c.y + f * f * p2.y,
    angle: Math.atan2(g * (c.y - p0.y) + f * (p2.y - c.y), g * (c.x - p0.x) + f * (p2.x - c.x)),
  };
}

export function hutAt(map: SwarmMap, state: SwarmState, x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  map.sites.forEach((site, index) => {
    const r = HUT_R[state.huts[index].level - 1];
    // The hut stands above its base, so the middle of what is seen is higher than the site.
    const dx = x - site.x;
    const dy = y - (site.y - r * 0.45);
    const d = dx * dx + dy * dy;
    if (d < r * r * 1.9 && d < bestD) {
      best = index;
      bestD = d;
    }
  });
  return best;
}

export type UpgradeKind = 'hut' | 'speed' | 'strength';
const UPGRADE_KINDS: UpgradeKind[] = ['hut', 'speed', 'strength'];
export const TOKEN_R = 17;

/** Where the three upgrade tokens of the hut in hand sit: in a row under it. */
export function upgradeSpots(map: SwarmMap, hut: number): { kind: UpgradeKind; x: number; y: number }[] {
  const site = map.sites[hut];
  const x = Math.min(Math.max(site.x, 60), WORLD_W - 60);
  return UPGRADE_KINDS.map((kind, index) => ({ kind, x: x + (index - 1) * 42, y: site.y + 54 }));
}

export function addEvents(scene: Scene, state: SwarmState, events: SwarmEvent[], now: number): void {
  for (const shot of state.shots) {
    scene.fx.push({ kind: 'shot', x: shot.x, y: shot.y, at: now, seat: shot.seat, tower: shot.tower });
    scene.scorches.push({ x: shot.x, y: shot.y });
    if (scene.scorches.length > SCORCH_MAX) scene.scorches.shift();
    const ground = scene.ground?.getContext('2d');
    if (ground) paintScorch(ground, shot.x, shot.y);
  }
  for (const event of events) {
    if (event.kind === 'hit') {
      scene.hitAt[event.hut] = now;
    } else if (event.kind === 'clash') {
      const p = pathPoint(scene.map, event.from, event.to, event.d / pathLength(scene.map, event.from, event.to));
      scene.fx.push({ kind: 'clash', x: p.x, y: p.y, at: now, seat: null });
    } else {
      const site = scene.map.sites[event.hut];
      scene.fx.push({ kind: event.kind, x: site.x, y: site.y, at: now, seat: state.huts[event.hut].owner });
    }
  }
}

// --- The ground ---

const GRASS = ['#4f6f37', '#5d7c40', '#6c8a48', '#86a257', '#93ad62', '#a3b96c'];

function ellipse(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

function tracePath(ctx: CanvasRenderingContext2D, map: SwarmMap, a: number, b: number) {
  const c = controlOf(map, a, b);
  ctx.beginPath();
  ctx.moveTo(map.sites[a].x, map.sites[a].y);
  ctx.quadraticCurveTo(c.x, c.y, map.sites[b].x, map.sites[b].y);
}

function paintGround(ctx: CanvasRenderingContext2D, map: SwarmMap, seed: number) {
  const rnd = mulberry32(seed ^ 0x51ab);
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];

  ctx.fillStyle = '#718d4c';
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Broad uneven tone, so the meadow is not one flat green.
  for (let i = 0; i < 110; i++) {
    const x = rnd() * WORLD_W;
    const y = rnd() * WORLD_H;
    const r = 50 + rnd() * 150;
    const tone = ctx.createRadialGradient(x, y, 0, x, y, r);
    const colour = pick(GRASS);
    tone.addColorStop(0, colour + '3d');
    tone.addColorStop(1, colour + '00');
    ctx.fillStyle = tone;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Trodden earth around every hut.
  for (const site of map.sites) {
    const worn = ctx.createRadialGradient(site.x, site.y, 14, site.x, site.y, 122);
    worn.addColorStop(0, 'rgba(134, 106, 68, 0.85)');
    worn.addColorStop(0.55, 'rgba(126, 108, 66, 0.4)');
    worn.addColorStop(1, 'rgba(120, 110, 64, 0)');
    ctx.fillStyle = worn;
    ctx.save();
    ctx.translate(site.x, site.y);
    ctx.scale(1, 0.62);
    ctx.translate(-site.x, -site.y);
    ctx.fillRect(site.x - 125, site.y - 125, 250, 250);
    ctx.restore();
  }

  const blade = (x: number, y: number, length: number) => {
    const lean = (rnd() - 0.5) * 1.1;
    ctx.strokeStyle = pick(GRASS);
    ctx.globalAlpha = 0.35 + rnd() * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + lean * length * 0.3, y - length * 0.6, x + lean * length, y - length);
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < 6500; i++) blade(rnd() * WORLD_W, rnd() * WORLD_H, 3 + rnd() * 6);
  ctx.globalAlpha = 1;

  // The paths: thinned grass at the verge, a dark worn edge, the packed earth, and a paler crown.
  ctx.lineCap = 'round';
  const links: [number, number][] = [];
  map.links.forEach((list, a) => list.forEach((b) => a < b && links.push([a, b])));
  for (const [width, colour] of [[41, 'rgba(120, 108, 62, 0.2)'], [31, 'rgba(70, 56, 34, 0.42)'], [25, '#9c8358'], [15, '#b39a6c']] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    for (const [a, b] of links) {
      tracePath(ctx, map, a, b);
      ctx.stroke();
    }
  }
  for (const [a, b] of links) {
    const length = pathLength(map, a, b);
    for (let i = 0; i < length * 0.9; i++) {
      const p = pathPoint(map, a, b, rnd());
      const off = (rnd() - 0.5) * 22;
      const x = p.x - Math.sin(p.angle) * off;
      const y = p.y + Math.cos(p.angle) * off;
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(74, 58, 36, 0.35)' : 'rgba(222, 204, 160, 0.4)';
      ellipse(ctx, x, y, 0.5 + rnd() * 1.1, 0.4 + rnd() * 0.7, rnd() * 3);
      ctx.fill();
    }
    // Grass leaning in over the edges, so the path sits in the meadow and not on it.
    ctx.lineWidth = 0.9;
    for (let i = 0; i < length * 0.7; i++) {
      const p = pathPoint(map, a, b, rnd());
      const off = (rnd() < 0.5 ? -1 : 1) * (11 + rnd() * 5);
      blade(p.x - Math.sin(p.angle) * off, p.y + Math.cos(p.angle) * off + 2, 3 + rnd() * 5);
    }
    ctx.globalAlpha = 1;
  }

  const offPath = (x: number, y: number) =>
    links.every(([a, b]) => {
      for (let f = 0; f <= 1; f += 0.05) {
        const p = pathPoint(map, a, b, f);
        if ((p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) < 22 * 22) return false;
      }
      return true;
    });
  const scatter = (count: number, paint: (x: number, y: number) => void) => {
    for (let made = 0, tries = 0; made < count && tries < count * 6; tries++) {
      const x = rnd() * WORLD_W;
      const y = rnd() * WORLD_H;
      if (!offPath(x, y)) continue;
      paint(x, y);
      made++;
    }
  };

  scatter(46, (x, y) => {
    const rx = 2.5 + rnd() * 4.5;
    const ry = rx * (0.55 + rnd() * 0.25);
    const rot = rnd() * 3;
    ctx.fillStyle = 'rgba(30, 38, 18, 0.3)';
    ellipse(ctx, x + 1.2, y + 1.6, rx, ry, rot);
    ctx.fill();
    ctx.fillStyle = pick(['#8d8c84', '#a19f95', '#77766f']);
    ellipse(ctx, x, y, rx, ry, rot);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 250, 0.3)';
    ellipse(ctx, x - rx * 0.25, y - ry * 0.3, rx * 0.5, ry * 0.4, rot);
    ctx.fill();
  });

  scatter(22, (x, y) => {
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
    ctx.fillStyle = pick(['#a9772f', '#8e5a26', '#b88a3a', '#7d6a2c']);
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
  });

  scatter(38, (x, y) => {
    const r = 1.5 + rnd() * 1.1;
    ctx.fillStyle = '#f4f1e4';
    for (let petal = 0; petal < 6; petal++) {
      const angle = (petal / 6) * Math.PI * 2;
      ellipse(ctx, x + Math.cos(angle) * r, y + Math.sin(angle) * r, r * 0.75, r * 0.45, angle);
      ctx.fill();
    }
    ctx.fillStyle = '#e0a81f';
    ellipse(ctx, x, y, r * 0.6, r * 0.6);
    ctx.fill();
  });

  // The corners fall away a little, which keeps the eye on the middle of the board.
  const edge = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.45, WORLD_W / 2, WORLD_H / 2, WORLD_W * 0.68);
  edge.addColorStop(0, 'rgba(24, 34, 14, 0)');
  edge.addColorStop(1, 'rgba(24, 34, 14, 0.38)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
}

// --- The huts ---

/** Light falls from the upper left: every hut is shaded the same way. */
function shade(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const light = ctx.createLinearGradient(-w, -h, w, 0);
  light.addColorStop(0, 'rgba(255, 244, 214, 0.34)');
  light.addColorStop(0.45, 'rgba(255, 244, 214, 0)');
  light.addColorStop(1, 'rgba(22, 14, 6, 0.46)');
  ctx.fillStyle = light;
  ctx.fillRect(-w * 1.2, -h * 1.2, w * 2.4, h * 1.6);
}

function castShadow(ctx: CanvasRenderingContext2D, w: number) {
  ctx.fillStyle = 'rgba(22, 30, 12, 0.34)';
  ellipse(ctx, w * 0.1, w * 0.1, w * 1.1, w * 0.4);
  ctx.fill();
}

function doorway(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rim: string) {
  ctx.fillStyle = '#150d07';
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.bezierCurveTo(x - w, y - h * 1.3, x + w, y - h * 1.3, x + w, y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = rim;
  ctx.lineWidth = Math.max(1, w * 0.22);
  ctx.beginPath();
  ctx.moveTo(x - w, y);
  ctx.bezierCurveTo(x - w, y - h * 1.3, x + w, y - h * 1.3, x + w, y);
  ctx.stroke();
}

/** The holder's colours on a pole at the top of the roof, as the huts of the old game flew them. */
function paintFlag(ctx: CanvasRenderingContext2D, y: number, size: number, colour: string) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#33210f';
  ctx.lineWidth = Math.max(1.2, size * 0.1);
  ctx.beginPath();
  ctx.moveTo(0, y + size * 0.2);
  ctx.lineTo(0, y - size);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, y - size);
  ctx.quadraticCurveTo(size * 0.5, y - size * 1.12, size * 1.05, y - size * 0.7);
  ctx.quadraticCurveTo(size * 0.5, y - size * 0.58, 0, y - size * 0.4);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.strokeStyle = 'rgba(34, 20, 8, 0.75)';
  ctx.lineWidth = Math.max(0.8, size * 0.05);
  ctx.lineJoin = 'round';
  ctx.stroke();
  // The cloth hangs in a fold, darker underneath.
  ctx.fillStyle = 'rgba(34, 20, 8, 0.2)';
  ctx.beginPath();
  ctx.moveTo(0, y - size * 0.66);
  ctx.quadraticCurveTo(size * 0.5, y - size * 0.8, size * 1.05, y - size * 0.7);
  ctx.quadraticCurveTo(size * 0.5, y - size * 0.58, 0, y - size * 0.4);
  ctx.closePath();
  ctx.fill();
}

function conePath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w * 0.72, -h * 0.3, -w * 0.3, -h * 0.98, -w * 0.13, -h);
  ctx.lineTo(w * 0.13, -h);
  ctx.bezierCurveTo(w * 0.3, -h * 0.98, w * 0.72, -h * 0.3, w, 0);
  ctx.bezierCurveTo(w, w * 0.34, -w, w * 0.34, -w, 0);
  ctx.closePath();
}

function domePath(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.beginPath();
  ctx.moveTo(-w, 0);
  ctx.bezierCurveTo(-w, -h * 0.78, -w * 0.56, -h, 0, -h);
  ctx.bezierCurveTo(w * 0.56, -h, w, -h * 0.78, w, 0);
  ctx.bezierCurveTo(w, w * 0.34, -w, w * 0.34, -w, 0);
  ctx.closePath();
}

/** One cone of an ant mound: packed soil in layers, a crater on top. */
function paintCone(ctx: CanvasRenderingContext2D, rnd: Rnd, x: number, w: number, h: number) {
  ctx.save();
  ctx.translate(x, 0);
  conePath(ctx, w, h);
  ctx.fillStyle = '#9a6a42';
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Each rain leaves a line where the ants built the next layer on.
  ctx.lineWidth = Math.max(0.8, w * 0.03);
  for (let y = -h * 0.12; y > -h; y -= h * 0.13) {
    ctx.strokeStyle = 'rgba(64, 36, 16, 0.3)';
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.quadraticCurveTo(0, y + w * 0.3 + (rnd() - 0.5) * w * 0.08, w, y);
    ctx.stroke();
  }
  for (let i = 0; i < w * h * 0.16; i++) {
    ctx.fillStyle = rnd() < 0.55 ? 'rgba(58, 32, 14, 0.42)' : 'rgba(226, 178, 122, 0.5)';
    const size = Math.max(0.5, w * (0.012 + rnd() * 0.024));
    ellipse(ctx, (rnd() - 0.5) * 2 * w, -rnd() * h + w * 0.2, size, size * 0.8);
    ctx.fill();
  }
  shade(ctx, w, h);
  ctx.restore();
  ctx.fillStyle = '#1b100a';
  ellipse(ctx, 0, -h, w * 0.14, w * 0.06);
  ctx.fill();
  ctx.strokeStyle = 'rgba(232, 186, 132, 0.7)';
  ctx.lineWidth = Math.max(0.8, w * 0.03);
  ctx.beginPath();
  ctx.ellipse(0, -h, w * 0.14, w * 0.06, 0, Math.PI * 0.9, Math.PI * 2.1);
  ctx.stroke();
  ctx.restore();
}

function paintAntHill(ctx: CanvasRenderingContext2D, rnd: Rnd, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  castShadow(ctx, r);

  if (level >= 2) {
    // A grown colony spreads: the cones stand on a low bank of packed earth.
    ctx.fillStyle = '#5f3e22';
    ellipse(ctx, 0, r * 0.1, r * 1.12, r * 0.37);
    ctx.fill();
    ctx.fillStyle = '#8c5e38';
    ellipse(ctx, 0, r * 0.03, r * 1.12, r * 0.37);
    ctx.fill();
  }

  // Spoil carried out and dropped around the foot.
  for (let i = 0; i < 70 + level * 30; i++) {
    const angle = rnd() * Math.PI * 2;
    const reach = r * (0.8 + rnd() * 0.36);
    ctx.fillStyle = pickTone(rnd, ['#7c5532', '#a87548', '#5f3e22', '#c08e5c']);
    const size = r * (0.02 + rnd() * 0.035);
    ellipse(ctx, Math.cos(angle) * reach, Math.sin(angle) * reach * 0.34, size, size * 0.75);
    ctx.fill();
  }

  if (level === 2) {
    paintCone(ctx, rnd, -r * 0.6, r * 0.5, h * 0.56);
    paintCone(ctx, rnd, r * 0.64, r * 0.36, h * 0.36);
  }
  if (level >= 3) {
    paintCone(ctx, rnd, r * 0.38, r * 0.42, h * 0.84);
    paintCone(ctx, rnd, -r * 0.62, r * 0.54, h * 0.62);
    paintCone(ctx, rnd, r * 0.7, r * 0.42, h * 0.46);
  }
  paintCone(ctx, rnd, 0, r * [0.94, 0.8, 0.74][level - 1], h);

  doorway(ctx, 0, r * 0.2, r * 0.2, r * 0.26, 'rgba(226, 178, 122, 0.55)');
  if (level >= 2) {
    ctx.fillStyle = '#1b100a';
    ellipse(ctx, r * 0.3, -h * 0.42, r * 0.07, r * 0.06);
    ctx.fill();
    ellipse(ctx, -r * 0.26, -h * 0.62, r * 0.055, r * 0.05);
    ctx.fill();
  }

  if (level >= 3) {
    // Twigs worked into the tallest mound to hold it up.
    ctx.lineCap = 'round';
    for (const [x0, y0, x1, y1] of [[-0.5, -0.34, -0.9, -0.7], [0.5, -0.5, 0.92, -0.8], [-0.12, -0.8, -0.44, -1.04]]) {
      ctx.strokeStyle = '#4a321a';
      ctx.lineWidth = r * 0.055;
      ctx.beginPath();
      ctx.moveTo(x0 * r, y0 * h);
      ctx.lineTo(x1 * r, y1 * h);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(210, 170, 110, 0.6)';
      ctx.lineWidth = r * 0.018;
      ctx.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const angle = Math.PI * (0.08 + (i / 8) * 0.84);
      const x = Math.cos(angle) * r * 1.06;
      const y = Math.sin(angle) * r * 0.36;
      ctx.fillStyle = pickTone(rnd, ['#8d8c84', '#a19f95', '#6f6e68']);
      ellipse(ctx, x, y, r * 0.075, r * 0.05, rnd());
      ctx.fill();
    }
  }

  paintFlag(ctx, -h, r * FLAG_RISE, BADGE.a.fill);
}

function pickTone(rnd: Rnd, tones: string[]): string {
  return tones[Math.floor(rnd() * tones.length)];
}

/** One skep: a rope of straw coiled into a dome and stitched to the coil below. */
function paintSkep(ctx: CanvasRenderingContext2D, rnd: Rnd, x: number, w: number, h: number, coils: number) {
  ctx.save();
  ctx.translate(x, 0);
  const coilH = h / coils;
  for (let i = 0; i < coils; i++) {
    const y = -i * coilH;
    const half = w * Math.sqrt(1 - Math.pow(i / coils, 2.2));
    const band = ctx.createLinearGradient(0, y - coilH, 0, y + coilH * 0.2);
    band.addColorStop(0, '#f6d27a');
    band.addColorStop(0.5, '#e0a93a');
    band.addColorStop(1, '#9a6a1a');
    ctx.fillStyle = band;
    ellipse(ctx, 0, y - coilH * 0.42, half, coilH * 0.72);
    ctx.fill();
    ctx.strokeStyle = 'rgba(98, 62, 12, 0.7)';
    ctx.lineWidth = Math.max(0.7, w * 0.022);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(92, 56, 10, 0.55)';
    ctx.lineWidth = Math.max(0.6, w * 0.02);
    const stitches = Math.max(4, Math.round(half / (w * 0.13)));
    for (let s = 0; s <= stitches; s++) {
      const sx = -half * 0.92 + (s / stitches) * half * 1.84 + (rnd() - 0.5) * w * 0.02;
      const drop = Math.sqrt(Math.max(0, 1 - (sx / half) * (sx / half))) * coilH * 0.5;
      ctx.beginPath();
      ctx.moveTo(sx - w * 0.03, y - coilH * 0.5 + drop * 0.55);
      ctx.lineTo(sx + w * 0.03, y - coilH * 0.5 + drop * 1.35);
      ctx.stroke();
    }
  }
  ctx.fillStyle = '#c98f2a';
  ellipse(ctx, 0, -h - coilH * 0.05, w * 0.12, coilH * 0.34);
  ctx.fill();
  ctx.strokeStyle = 'rgba(98, 62, 12, 0.7)';
  ctx.stroke();
  ctx.save();
  domePath(ctx, w, h + coilH * 0.3);
  ctx.clip();
  shade(ctx, w, h + coilH);
  ctx.restore();
  ctx.restore();
}

function paintBeeHive(ctx: CanvasRenderingContext2D, rnd: Rnd, r: number, level: number) {
  // The largest hive is lifted off the damp ground on a stand.
  const stand = level === 3 ? r * 0.24 : 0;
  const h = r * HUT_RISE[level - 1] - stand;
  castShadow(ctx, r);

  if (stand > 0) {
    for (const [x, foot] of [[-0.74, 0.38], [0.74, 0.38], [0, 0.48]]) {
      ctx.fillStyle = '#3d2913';
      ctx.fillRect((x - 0.08) * r, -stand, r * 0.16, stand + foot * r);
      ctx.fillStyle = '#7a5630';
      ctx.fillRect((x - 0.08) * r, -stand, r * 0.07, stand + foot * r);
    }
    ctx.strokeStyle = '#3d2913';
    ctx.lineWidth = r * 0.06;
    ctx.beginPath();
    ctx.moveTo(-r * 0.74, r * 0.3);
    ctx.quadraticCurveTo(0, r * 0.5, r * 0.74, r * 0.3);
    ctx.stroke();
  }

  ctx.save();
  ctx.translate(0, -stand);

  // The board the skep stands on, with its landing lip at the front.
  ctx.fillStyle = '#4e351c';
  ellipse(ctx, 0, r * 0.12, r * 1.08, r * 0.36);
  ctx.fill();
  ctx.fillStyle = '#8a6238';
  ellipse(ctx, 0, r * 0.04, r * 1.08, r * 0.36);
  ctx.fill();
  ctx.strokeStyle = 'rgba(54, 34, 14, 0.5)';
  ctx.lineWidth = Math.max(0.6, r * 0.018);
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.04, r * 1.08, r * 0.36, 0, Math.PI * 0.5 + i * 0.3 - 0.04, Math.PI * 0.5 + i * 0.3 + 0.04);
    ctx.lineTo(i * r * 0.2, -r * 0.1);
    ctx.stroke();
  }

  const rim = 'rgba(98, 62, 12, 0.9)';
  const small = (x: number, w: number, rise: number, coils: number) => {
    paintSkep(ctx, rnd, x * r, w * r, h * rise, coils);
    doorway(ctx, x * r, r * 0.07, r * 0.08, r * 0.1, rim);
  };
  if (level === 2) small(0.66, 0.4, 0.5, 4);
  if (level >= 3) {
    small(-0.66, 0.4, 0.56, 5);
    small(0.68, 0.37, 0.46, 4);
  }
  const x = level === 2 ? -r * 0.14 : 0;
  const w = r * [0.86, 0.78, 0.72][level - 1];
  paintSkep(ctx, rnd, x, w, h, 3 + level * 2);
  doorway(ctx, x, r * 0.1, r * 0.17, r * 0.2, rim);

  // A band of darker straw for each time the skep has been built up again.
  ctx.strokeStyle = 'rgba(120, 70, 14, 0.85)';
  ctx.lineWidth = r * 0.07;
  for (const f of [[], [0.5], [0.36, 0.68]][level - 1]) {
    const half = w * Math.sqrt(1 - Math.pow(f, 2.2)) * 0.94;
    ctx.beginPath();
    ctx.ellipse(x, -h * f, half, half * 0.26, 0, Math.PI * 0.08, Math.PI * 0.92);
    ctx.stroke();
  }

  paintFlag(ctx, -h, r * FLAG_RISE, BADGE.b.fill);
  ctx.restore();
}

const STONE = ['#a4a39b', '#8f8e86', '#b3b2a9', '#7c7b74', '#9a9990'];

/** Fills the clipped shape with courses of stone from the ground up to `top`, then weathers it. */
function layStone(ctx: CanvasRenderingContext2D, rnd: Rnd, w: number, top: number, course: number, moss: number) {
  for (let row = 0, y = w * 0.3; y > -top - course; y -= course, row++) {
    for (let x = -w - (row % 2) * course * 0.7; x < w; ) {
      const length = course * (1.1 + rnd() * 0.9);
      ctx.fillStyle = pickTone(rnd, STONE);
      const gap = Math.max(0.8, course * 0.1);
      ctx.beginPath();
      ctx.roundRect(x + gap / 2, y - course + gap / 2, length - gap, course - gap, course * 0.28);
      ctx.fill();
      x += length;
    }
  }
  for (let i = 0; i < moss; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(84, 108, 50, 0.72)' : 'rgba(112, 130, 60, 0.62)';
    ellipse(ctx, (rnd() - 0.5) * 1.7 * w, -rnd() * top * 0.75 + w * 0.1, w * (0.06 + rnd() * 0.1), w * (0.035 + rnd() * 0.05), rnd() * 3);
    ctx.fill();
  }
  shade(ctx, w, top);
}

function paintStoneDome(ctx: CanvasRenderingContext2D, rnd: Rnd, w: number, h: number, course: number, moss: number) {
  domePath(ctx, w, h);
  ctx.fillStyle = '#56554f';
  ctx.fill();
  ctx.save();
  ctx.clip();
  layStone(ctx, rnd, w, h, course, moss);
  ctx.restore();
}

/** The flat top of a course that stands out from the dome built on it. */
function paintLedge(ctx: CanvasRenderingContext2D, y: number, w: number) {
  ctx.fillStyle = '#4c4b46';
  ellipse(ctx, 0, y + w * 0.05, w, w * 0.255);
  ctx.fill();
  ctx.fillStyle = '#a3a299';
  ellipse(ctx, 0, y, w, w * 0.255);
  ctx.fill();
}

/** A hut nobody holds: grey stone laid dry, the door dark, moss in the joints. */
function paintStoneHut(ctx: CanvasRenderingContext2D, rnd: Rnd, r: number, level: number) {
  const h = r * HUT_RISE[level - 1];
  const course = r * 0.15;
  castShadow(ctx, r);
  if (level === 1) {
    paintStoneDome(ctx, rnd, r * 0.9, h * 0.9, course, 4);
  } else {
    // A larger hut is raised on a wall wider than its dome, and the biggest carries a second dome.
    const wall = r * 0.32;
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(-r, -wall);
    ctx.lineTo(r, -wall);
    ctx.lineTo(r, 0);
    ctx.bezierCurveTo(r, r * 0.34, -r, r * 0.34, -r, 0);
    ctx.closePath();
    ctx.fillStyle = '#56554f';
    ctx.fill();
    ctx.save();
    ctx.clip();
    layStone(ctx, rnd, r, wall, course * 1.1, 3);
    ctx.restore();
    paintLedge(ctx, -wall, r);

    const dome = (h - wall) * (level === 2 ? 1 : 0.7);
    ctx.save();
    ctx.translate(0, -wall);
    paintStoneDome(ctx, rnd, r * 0.84, dome, course, level * 6);
    if (level >= 3) {
      ctx.translate(0, -dome * 0.66);
      paintLedge(ctx, 0, r * 0.56);
      paintStoneDome(ctx, rnd, r * 0.46, h - wall - dome * 0.66, course * 0.85, 5);
    }
    ctx.restore();

    for (let i = 0; i < level * 5; i++) {
      const angle = Math.PI * (0.05 + rnd() * 0.9);
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(84, 108, 50, 0.9)' : 'rgba(112, 130, 60, 0.85)';
      ellipse(ctx, Math.cos(angle) * r * 0.95, -wall + Math.sin(angle) * r * 0.24, r * (0.05 + rnd() * 0.07), r * (0.03 + rnd() * 0.03));
      ctx.fill();
    }
  }
  doorway(ctx, 0, r * 0.2, r * 0.18, r * 0.25, 'rgba(60, 60, 55, 0.9)');
}

const TOWER_H = 64;
const TOWER_BALL = 15;
/** From a tower's foot to the top of its cannon ball. */
const TOWER_TOP = TOWER_H + TOWER_BALL * 1.8;

function towerHalf(y: number): number {
  return 21 + (y / TOWER_H) * 8;
}

/** A stone tower with an iron ball on top and a band in its holder's colour. */
function paintTower(ctx: CanvasRenderingContext2D, owner: Owner) {
  castShadow(ctx, 24);
  const stone = ctx.createLinearGradient(-21, 0, 21, 0);
  stone.addColorStop(0, '#9a9c96');
  stone.addColorStop(0.45, '#73766f');
  stone.addColorStop(1, '#3d403c');
  const body = (top: number, bottom: number) => {
    ctx.beginPath();
    ctx.moveTo(-towerHalf(bottom), bottom);
    ctx.lineTo(-towerHalf(top), top);
    ctx.quadraticCurveTo(0, top + 5, towerHalf(top), top);
    ctx.lineTo(towerHalf(bottom), bottom);
    ctx.quadraticCurveTo(0, bottom + 8, -towerHalf(bottom), bottom);
    ctx.closePath();
  };
  body(-TOWER_H, 0);
  ctx.fillStyle = stone;
  ctx.fill();
  ctx.strokeStyle = 'rgba(24, 26, 24, 0.5)';
  ctx.lineWidth = 1;
  for (const y of [-12, -38, -51]) {
    ctx.beginPath();
    ctx.moveTo(-towerHalf(y), y);
    ctx.quadraticCurveTo(0, y + 6, towerHalf(y), y);
    ctx.stroke();
  }
  // The band is the only colour on it, so whose tower it is reads from across the board.
  body(-30, -17);
  ctx.fillStyle = owner ? BADGE[owner].fill : '#b9bab2';
  ctx.fill();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.beginPath();
  ctx.moveTo(4, -29);
  ctx.lineTo(towerHalf(-30), -30);
  ctx.lineTo(towerHalf(-17), -17);
  ctx.lineTo(4, -12.5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#16181a';
  ctx.fillRect(-2, -47, 4, 9);

  ctx.fillStyle = '#2a2d2b';
  ellipse(ctx, 0, -TOWER_H + 1, towerHalf(-TOWER_H) + 3, 5.5);
  ctx.fill();
  const iron = ctx.createRadialGradient(-5, -TOWER_H - TOWER_BALL - 5, 1, 0, -TOWER_H - TOWER_BALL * 0.8, TOWER_BALL);
  iron.addColorStop(0, '#7b8086');
  iron.addColorStop(0.35, '#2e3134');
  iron.addColorStop(1, '#0b0c0d');
  ctx.fillStyle = iron;
  ellipse(ctx, 0, -TOWER_H - TOWER_BALL * 0.8, TOWER_BALL, TOWER_BALL);
  ctx.fill();
}

function paintScorch(ctx: CanvasRenderingContext2D, x: number, y: number) {
  const burn = ctx.createRadialGradient(x, y, 0, x, y, 15);
  burn.addColorStop(0, 'rgba(24, 20, 14, 0.5)');
  burn.addColorStop(0.6, 'rgba(24, 20, 14, 0.2)');
  burn.addColorStop(1, 'rgba(24, 20, 14, 0)');
  ctx.fillStyle = burn;
  ellipse(ctx, x, y, 15, 8);
  ctx.fill();
}

function spriteOf(scene: Scene, index: number, owner: Owner, level: number): HTMLCanvasElement {
  const tower = scene.map.sites[index].tower;
  const key = `${index}|${owner}|${level}`;
  const cached = scene.sprites.get(key);
  if (cached) return cached;
  const r = HUT_R[level - 1];
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(r * 3.4 * scene.scale);
  canvas.height = Math.ceil(r * 3.6 * scene.scale);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(scene.scale, scene.scale);
    ctx.translate(r * 1.7, r * 2.9);
    const rnd = mulberry32(scene.seed ^ Math.imul(index + 1, 0x85ebca6b));
    if (tower) paintTower(ctx, owner);
    else if (owner === 'a') paintAntHill(ctx, rnd, r, level);
    else if (owner === 'b') paintBeeHive(ctx, rnd, r, level);
    else paintStoneHut(ctx, rnd, r, level);
  }
  scene.sprites.set(key, canvas);
  return canvas;
}

// --- The units ---

/** The insects are drawn in their own small units and then enlarged to stand beside the huts. */
const UNIT_SCALE = 1.7;

function drawAnt(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, stride: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(UNIT_SCALE, UNIT_SCALE);
  ctx.strokeStyle = '#2a120b';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (let leg = -1; leg <= 1; leg++) {
    const swing = Math.sin(stride + leg * 2.1) * 1.3;
    ctx.moveTo(leg * 1.1, 0);
    ctx.lineTo(leg * 1.7 + swing, -3.3);
    ctx.moveTo(leg * 1.1, 0);
    ctx.lineTo(leg * 1.7 - swing, 3.3);
  }
  ctx.moveTo(3.4, -0.4);
  ctx.lineTo(5.3, -1.9);
  ctx.moveTo(3.4, 0.4);
  ctx.lineTo(5.3, 1.9);
  ctx.stroke();
  ctx.fillStyle = '#4a1d10';
  ellipse(ctx, -3.3, 0, 2.6, 1.9);
  ctx.fill();
  ctx.fillStyle = '#b4472a';
  ellipse(ctx, -3.5, -0.4, 1.5, 0.9);
  ctx.fill();
  ctx.fillStyle = '#3a160c';
  ellipse(ctx, 0, 0, 1.6, 1.25);
  ctx.fill();
  ellipse(ctx, 2.7, 0, 1.5, 1.4);
  ctx.fill();
  ctx.restore();
}

function drawBee(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, beat: number) {
  // A bee flies, so its shadow is on the ground below and it is drawn above it.
  ctx.fillStyle = 'rgba(22, 30, 12, 0.26)';
  ellipse(ctx, x + 3, y + 1.5, 3.4 * UNIT_SCALE, 1.8 * UNIT_SCALE, angle);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y - 11 + Math.sin(beat * 0.21) * 1.2);
  ctx.rotate(angle);
  ctx.scale(UNIT_SCALE, UNIT_SCALE);
  const flap = 0.55 + Math.abs(Math.sin(beat)) * 0.45;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ellipse(ctx, -0.4, -2.9 * flap, 2.3, 2.6 * flap, -0.5);
  ctx.fill();
  ellipse(ctx, -0.4, 2.9 * flap, 2.3, 2.6 * flap, 0.5);
  ctx.fill();
  ctx.fillStyle = '#f0b429';
  ellipse(ctx, -0.8, 0, 3.7, 2.4);
  ctx.fill();
  ctx.fillStyle = '#231a10';
  ctx.fillRect(-2.8, -2.1, 1.2, 4.2);
  ctx.fillRect(-0.5, -2.4, 1.2, 4.8);
  ellipse(ctx, 3.1, 0, 1.6, 1.6);
  ctx.fill();
  ctx.restore();
}

// --- The frame ---

/** A rest shorter than this share of the hold is a pointer passing by, and draws nothing. */
const HOLD_SHOWN = 0.25;
const SENT_MS = 320;
const REFUSED_MS = 260;

/** From the middle of a hut's number down to the point of its bubble's tail. */
const BADGE_TAIL = 8;
const BADGE_DROP = 16 + BADGE_TAIL;
/** The least height a bubble's tail can point from and the whole bubble still be on the board. */
const BADGE_ROOM = BADGE_DROP + 15;

function hutTop(level: number, owner: Owner, tower: boolean | undefined): number {
  if (tower) return TOWER_TOP;
  return HUT_R[level - 1] * (HUT_RISE[level - 1] + (owner ? FLAG_RISE : 0));
}

/**
 * A count in a speech bubble. A hut's bubble has a tail to the point given and a
 * pip per level (a tower has no levels, so none); `aside` puts it up and to the left of that point, not over it.
 */
function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, n: number, owner: Owner, level: number, jolt: number, aside = false, pips = level) {
  const tone = BADGE[owner ?? 'none'];
  const text = String(n);
  ctx.font = `700 16px ${getComputedStyle(document.body).fontFamily}`;
  const width = Math.max(32, ctx.measureText(text).width + 18);
  const half = width / 2;
  const root = aside ? half - 16 : 0;
  const tip = aside ? half : 0;
  // A hut's bubble is deeper than a plain count, to carry the pips under the number.
  const foot = level > 0 ? 16 : 12;
  const bubble = (drop: number) => {
    ctx.beginPath();
    ctx.roundRect(-half, drop - 12, width, 12 + foot, 9);
    if (level > 0) {
      ctx.moveTo(root - 7, drop + foot - 1);
      ctx.lineTo(tip, drop + BADGE_DROP);
      ctx.lineTo(root + 7, drop + foot - 1);
      ctx.closePath();
    }
  };
  ctx.save();
  ctx.translate(x - tip, y);
  ctx.scale(1 + jolt * 0.22, 1 + jolt * 0.22);
  ctx.fillStyle = 'rgba(20, 16, 10, 0.4)';
  bubble(2);
  ctx.fill();
  // Outlined before it is filled, so the join of body and tail is painted over.
  bubble(0);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = tone.fill;
  ctx.fill();
  ctx.fillStyle = tone.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, level > 0 ? -1 : 0.5);
  // One pip per level, so a grown hut reads as grown without counting cones.
  for (let pip = 0; pip < pips; pip++) {
    ellipse(ctx, (pip - (pips - 1) / 2) * 6.5, 10.5, 2, 2);
    ctx.fill();
  }
  ctx.restore();
}

function groundRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.strokeStyle = 'rgba(20, 16, 10, 0.45)';
  ctx.lineWidth = 5;
  ellipse(ctx, x, y + 2, r * 1.3, r * 0.5);
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.4;
  ctx.stroke();
}

function drawToken(ctx: CanvasRenderingContext2D, kind: UpgradeKind, x: number, y: number, cost: number, affordable: boolean) {
  ctx.save();
  ctx.translate(x, y);
  // One that cannot be paid for yet stays in place, faded, so its price can still be read.
  ctx.globalAlpha = affordable ? 1 : 0.55;
  ctx.fillStyle = 'rgba(20, 16, 10, 0.4)';
  ellipse(ctx, 0, 2, TOKEN_R, TOKEN_R);
  ctx.fill();
  ctx.fillStyle = '#fbf7ee';
  ellipse(ctx, 0, 0, TOKEN_R, TOKEN_R);
  ctx.fill();
  ctx.strokeStyle = '#2b241a';
  ctx.fillStyle = '#2b241a';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (kind === 'hut') {
    // A dome with a storey going on top.
    ctx.arc(0, 3, 8, Math.PI, 0);
    ctx.closePath();
    ctx.moveTo(0, -11);
    ctx.lineTo(0, -6);
    ctx.moveTo(-2.5, -8.5);
    ctx.lineTo(2.5, -8.5);
  } else if (kind === 'speed') {
    for (const dx of [-5, 2]) {
      ctx.moveTo(dx - 2, -8);
      ctx.lineTo(dx + 4, -2);
      ctx.lineTo(dx - 2, 4);
    }
  } else {
    ctx.moveTo(-7, -9);
    ctx.lineTo(7, -9);
    ctx.lineTo(7, -2);
    ctx.quadraticCurveTo(6, 4, 0, 6);
    ctx.quadraticCurveTo(-6, 4, -7, -2);
    ctx.closePath();
  }
  ctx.stroke();
  ctx.font = `700 10px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(cost), 0, 12);
  ctx.restore();
}

function drawFx(ctx: CanvasRenderingContext2D, scene: Scene, now: number) {
  scene.fx = scene.fx.filter((fx) => now - fx.at < FX_MS[fx.kind]);
  for (const fx of scene.fx) {
    const t = (now - fx.at) / FX_MS[fx.kind];
    if (fx.kind === 'clash') {
      // A scuffle kicks up dust where the two columns met.
      ctx.fillStyle = `rgba(226, 208, 170, ${0.7 * (1 - t)})`;
      for (let puff = 0; puff < 3; puff++) {
        const angle = puff * 2.1 + fx.at;
        ellipse(ctx, fx.x + Math.cos(angle) * t * 9, fx.y + Math.sin(angle) * t * 6 - t * 4, 2 + t * 3, 1.6 + t * 2.4);
        ctx.fill();
      }
      continue;
    }
    if (fx.kind === 'shot') {
      const from = scene.map.sites[fx.tower!];
      const topY = from.y - TOWER_H - TOWER_BALL;
      if (t < SHOT_FLIGHT) {
        const f = t / SHOT_FLIGHT;
        // The ball is lobbed: it rises off the straight line and comes down on its mark.
        ctx.fillStyle = '#121314';
        ellipse(ctx, from.x + (fx.x - from.x) * f, topY + (fx.y - topY) * f - Math.sin(Math.PI * f) * 26, 4.5, 4.5);
        ctx.fill();
        continue;
      }
      const burst = (t - SHOT_FLIGHT) / (1 - SHOT_FLIGHT);
      ctx.fillStyle = `rgba(52, 46, 38, ${0.8 * (1 - burst)})`;
      for (let puff = 0; puff < 6; puff++) {
        const angle = puff * 1.05 + fx.at;
        ellipse(ctx, fx.x + Math.cos(angle) * burst * 16, fx.y + Math.sin(angle) * burst * 8 - burst * 9, 3 + burst * 5, 2.4 + burst * 4);
        ctx.fill();
      }
      continue;
    }
    const colour = fx.seat ? BADGE[fx.seat].fill : '#ffffff';
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 4 * (1 - t) + 1;
    ellipse(ctx, fx.x, fx.y, 42 + t * (fx.kind === 'capture' ? 60 : 34), (42 + t * (fx.kind === 'capture' ? 60 : 34)) * 0.4);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (fx.kind === 'capture') {
      ctx.fillStyle = `rgba(226, 208, 170, ${0.75 * (1 - t)})`;
      for (let puff = 0; puff < 10; puff++) {
        const angle = (puff / 10) * Math.PI * 2;
        ellipse(ctx, fx.x + Math.cos(angle) * (38 + t * 34), fx.y + Math.sin(angle) * (14 + t * 13) - t * 10, 3 + t * 5, 2.4 + t * 4);
        ctx.fill();
      }
    }
  }
}

export function drawScene(canvas: HTMLCanvasElement, scene: Scene, state: SwarmState, view: View): void {
  const width = Math.round(canvas.clientWidth * window.devicePixelRatio);
  if (width === 0) return;
  if (canvas.width !== width) {
    canvas.width = width;
    canvas.height = Math.round((width * WORLD_H) / WORLD_W);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const scale = canvas.width / WORLD_W;
  const { map } = scene;

  if (!scene.ground || scene.scale !== scale) {
    scene.scale = scale;
    scene.sprites.clear();
    scene.ground = document.createElement('canvas');
    scene.ground.width = canvas.width;
    scene.ground.height = canvas.height;
    const ground = scene.ground.getContext('2d');
    if (ground) {
      ground.scale(scale, scale);
      paintGround(ground, map, scene.seed);
      for (const scorch of scene.scorches) paintScorch(ground, scorch.x, scorch.y);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scene.ground, 0, 0);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const ringed = view.drag ? [...view.drag.sources] : view.selected !== null ? [view.selected] : [];
  if (view.drag && view.drag.target !== null && !ringed.includes(view.drag.target)) ringed.push(view.drag.target);
  for (const hut of ringed) groundRing(ctx, map.sites[hut].x, map.sites[hut].y, HUT_R[state.huts[hut].level - 1]);
  if (view.drag && view.drag.target !== null && view.hold > HOLD_SHOWN) {
    // The ring round the target closes in the player's colour as the rest turns half into all.
    const site = map.sites[view.drag.target];
    const r = HUT_R[state.huts[view.drag.target].level - 1];
    ctx.strokeStyle = BADGE[view.seat].fill;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(site.x, site.y + 2, r * 1.3, r * 0.5, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((view.hold - HOLD_SHOWN) / (1 - HOLD_SHOWN)));
    ctx.stroke();
  }
  if (view.sent && view.now - view.sent.at < SENT_MS) {
    const t = (view.now - view.sent.at) / SENT_MS;
    ctx.strokeStyle = BADGE[view.seat].fill;
    ctx.globalAlpha = 1 - t;
    ctx.lineWidth = 3;
    for (const hut of view.sent.from) {
      const r = HUT_R[state.huts[hut].level - 1] * (1.3 + t * 0.5);
      ellipse(ctx, map.sites[hut].x, map.sites[hut].y + 2, r, r * 0.38);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // While a send is being aimed, every tower that would fire on it shows how far it reaches.
  if (view.drag) {
    ctx.setLineDash([7, 7]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    state.huts.forEach((hut, index) => {
      if (!map.sites[index].tower || hut.owner === view.seat) return;
      ellipse(ctx, map.sites[index].x, map.sites[index].y, TOWER_RANGE, TOWER_RANGE);
      ctx.stroke();
    });
    ctx.setLineDash([]);
  }

  // Ants walk the ground between the huts, so they and the huts are drawn
  // back to front together. Bees fly over everything.
  const bees: { x: number; y: number; angle: number; id: number }[] = [];
  const standing: { y: number; paint: () => void }[] = [];
  for (const unit of state.units) {
    const length = pathLength(map, unit.from, unit.to);
    const f = Math.min(1, (unit.d + SPEED[state.army[unit.seat].speed] * view.alpha) / length);
    const p = pathPoint(map, unit.from, unit.to, f);
    // Each unit keeps its own line in the column, closing up at the two doors.
    const lane = ((Math.imul(unit.id, 0x9e3779b1) >>> 0) % 15 - 7) * 1.4 * Math.sin(Math.PI * f);
    const x = p.x - Math.sin(p.angle) * lane;
    const y = p.y + Math.cos(p.angle) * lane;
    if (unit.seat === 'b') bees.push({ x, y, angle: p.angle, id: unit.id });
    else standing.push({ y, paint: () => drawAnt(ctx, x, y, p.angle, f * length * 0.55 + unit.id) });
  }
  state.huts.forEach((hut, index) => {
    const site = map.sites[index];
    const r = HUT_R[hut.level - 1];
    standing.push({
      y: site.y,
      paint: () => {
        const sprite = spriteOf(scene, index, hut.owner, hut.level);
        ctx.drawImage(sprite, site.x - r * 1.7, site.y - r * 2.9, r * 3.4, r * 3.6);
      },
    });
  });
  standing.sort((p, q) => p.y - q.y);
  for (const item of standing) item.paint();
  for (const bee of bees) drawBee(ctx, bee.x, bee.y, bee.angle, view.now * 0.05 + bee.id);

  drawFx(ctx, scene, view.now);

  state.huts.forEach((hut, index) => {
    const site = map.sites[index];
    const jolt = Math.max(0, 1 - (view.now - scene.hitAt[index]) / 220);
    const tipY = site.y - hutTop(hut.level, hut.owner, site.tower) - 2;
    // A tall hut by the top edge leaves no room over its roof, so its bubble stands beside the peak.
    const aside = tipY < BADGE_ROOM;
    const no = view.refused?.hut === index ? (view.now - view.refused.at) / REFUSED_MS : 1;
    const shake = no < 1 ? Math.sin(no * Math.PI * 5) * 6 * (1 - no) : 0;
    const x = (aside ? site.x - HUT_R[hut.level - 1] * 0.34 : site.x) + shake;
    drawBadge(ctx, x, Math.max(BADGE_ROOM, tipY) - BADGE_DROP, hut.n, hut.owner, hut.level, jolt, aside, site.tower ? 0 : hut.level);
  });

  if (view.selected !== null && !view.drag) {
    const hut = state.huts[view.selected];
    for (const spot of upgradeSpots(map, view.selected)) {
      const cost = upgradeCost(state, view.selected, spot.kind);
      if (cost !== null) drawToken(ctx, spot.kind, spot.x, spot.y, cost, sendSize(hut, 'all') >= cost);
    }
  }

  // One arrow from every hut the drag has gathered. With a hut under the pointer
  // it lies along the road the column will walk, so the route is seen before it is ordered.
  const drag = view.drag;
  if (!drag) return;
  const arrows: { trace: () => void; tipX: number; tipY: number; angle: number }[] = [];
  for (const source of drag.sources) {
    if (source === drag.target) continue;
    const start = map.sites[source];
    if (drag.target === null || nextHop(map, source, drag.target) === -1) {
      const angle = Math.atan2(drag.y - start.y, drag.x - start.x);
      arrows.push({
        trace: () => {
          ctx.moveTo(start.x, start.y);
          ctx.lineTo(drag.x - Math.cos(angle) * 10, drag.y - Math.sin(angle) * 10);
        },
        tipX: drag.x,
        tipY: drag.y,
        angle,
      });
      continue;
    }
    const target = drag.target;
    const legs: number[] = [source];
    while (legs[legs.length - 1] !== target) legs.push(nextHop(map, legs[legs.length - 1], target));
    const last = legs[legs.length - 2];
    // The head stops short of the door, clear of the hut it points at.
    const f = Math.max(0.2, 1 - 40 / pathLength(map, last, target));
    const tip = pathPoint(map, last, target, f);
    arrows.push({
      trace: () => {
        ctx.moveTo(start.x, start.y);
        for (let leg = 1; leg < legs.length - 1; leg++) {
          const c = controlOf(map, legs[leg - 1], legs[leg]);
          ctx.quadraticCurveTo(c.x, c.y, map.sites[legs[leg]].x, map.sites[legs[leg]].y);
        }
        const from = map.sites[last];
        const c = controlOf(map, last, target);
        const stop = pathPoint(map, last, target, f - 10 / pathLength(map, last, target));
        ctx.quadraticCurveTo(from.x + (c.x - from.x) * f, from.y + (c.y - from.y) * f, stop.x, stop.y);
      },
      tipX: tip.x,
      tipY: tip.y,
      angle: tip.angle,
    });
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Every outline before any line, so arrows that share a road join into one.
  for (const [lineWidth, colour] of [[10, 'rgba(20, 16, 10, 0.45)'], [5, '#ffffff']] as const) {
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;
    for (const arrow of arrows) {
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      arrow.trace();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(arrow.tipX, arrow.tipY);
      ctx.lineTo(arrow.tipX - Math.cos(arrow.angle - 0.5) * 18, arrow.tipY - Math.sin(arrow.angle - 0.5) * 18);
      ctx.lineTo(arrow.tipX - Math.cos(arrow.angle + 0.5) * 18, arrow.tipY - Math.sin(arrow.angle + 0.5) * 18);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = lineWidth - 5;
      if (lineWidth > 5) ctx.stroke();
    }
  }
  if (drag.target === null) return;
  for (const source of drag.sources) {
    const hop = source === drag.target ? -1 : nextHop(map, source, drag.target);
    const count = sendSize(state.huts[source], view.sendAll ? 'all' : 'half');
    if (hop === -1 || count === 0) continue;
    const p = pathPoint(map, source, hop, 0.5);
    drawBadge(ctx, p.x, p.y, count, view.seat, 0, 0);
  }
}
