// What every part of Swarm's painting shares: the sizes of things on the
// board, the line a path takes, the course of a river, and the colours of
// each of the five places a map can be set in.

import { centreOf, pathOf, type Path, type PathKind, type SceneId, type Seat, type Site, type SwarmMap } from '../../swarmGameLogic';

export type Rnd = () => number;
export type Ctx = CanvasRenderingContext2D;
export interface Point {
  x: number;
  y: number;
}

/** Half-width of a hut on the ground in world units, by level. */
const HUT_R = [42, 50, 58];
/** How far the hut stands above its base, as a multiple of its half-width, by level. */
export const HUT_RISE = [1, 1.14, 1.28];
/** How far the mast stands above the highest roof or stone, in world units, by level: room for a pennant for each. */
const MAST_RISE = [21, 32, 44];
/** A fort is this much wider than a hut of its level. */
const FORT_SCALE = 1.3;
/** To the top of a fort's highest stonework, as a multiple of its half-width, by level. */
export const FORT_RISE = [0.96, 1.2, 1.6];

export const TOWER_H = 64;
export const TOWER_BALL = 15;
/** From a tower's foot to the top of its cannon ball. */
const TOWER_TOP = TOWER_H + TOWER_BALL * 1.8;

export const BADGE: Record<Seat | 'none', { fill: string; text: string }> = {
  a: { fill: '#8f2f1a', text: '#ffffff' },
  b: { fill: '#f0b429', text: '#2a1c00' },
  c: { fill: '#2c5b8c', text: '#ffffff' },
  // Darker and bluer than the valley's turf, which a mid green would vanish into.
  d: { fill: '#2f6b3f', text: '#ffffff' },
  none: { fill: '#5f5f5a', text: '#ffffff' },
};

export function siteRadius(site: Site, level: number): number {
  return HUT_R[level - 1] * (site.fort ? FORT_SCALE : 1);
}

/** From a site's foot to the highest thing drawn on it: the ball of a tower, and the top of the mast on anything else, held or not. */
export function siteTop(site: Site, level: number): number {
  if (site.tower) return TOWER_TOP;
  return siteRadius(site, level) * (site.fort ? FORT_RISE : HUT_RISE)[level - 1] + MAST_RISE[level - 1];
}

/** How many worlds of the standard size, 1000 by 660, a map's would cover. */
export function areaOf(map: SwarmMap): number {
  return (map.w * map.h) / (1000 * 660);
}

export function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

let family = '';

/** A CSS font in the page's own typeface, which is asked for once: a frame has dozens of labels, and the style system is slow to answer each. */
export function fontOf(weight: number, size: number): string {
  if (family === '') family = getComputedStyle(document.body).fontFamily;
  return `${weight} ${size}px ${family}`;
}

/**
 * How much larger than its world size a label is drawn so that `size` world
 * units of it are never under `least` CSS px. `px` is world units to a CSS
 * pixel: 1 on a standard board at full width, 2.8 on the same board on a phone.
 */
export function growOf(size: number, least: number, px: number): number {
  return Math.max(1, (least * px) / size);
}

export function pickTone(rnd: Rnd, tones: readonly string[]): string {
  return tones[Math.floor(rnd() * tones.length)];
}

/** The width of the trodden surface, in world units. */
export const PATH_W: Record<PathKind, number> = { road: 25, wide: 38, narrow: 13, spikes: 19, bridge: 22, ford: 22, climb: 26 };
/** A seventh of how far to either side of the middle of its path a column walks. */
export const LANE: Record<PathKind, number> = { road: 1.4, wide: 2.3, narrow: 0.7, spikes: 0.9, bridge: 0.9, ford: 1, climb: 1.3 };

/**
 * Where across its column a unit walks, -1 to 1, from its place in the order the
 * column left the door. Each step of the golden ratio lands well clear of the
 * one before and of the one before that, so the unit ahead and the unit behind
 * are never on the same line, and no line of units forms that the eye can follow.
 */
export function fileOf(slot: number): number {
  const turn = slot * 0.6180339887;
  return (turn - Math.floor(turn)) * 2 - 1;
}

/** How far from a door a column has opened to its full width. */
const DOOR_REACH = 60;

/** How much of its width a column has at a point on its path: none in a doorway, all of it on the open road. */
export function spreadAt(d: number, length: number): number {
  const t = Math.min(1, Math.max(0, Math.min(d, length - d) / Math.min(DOOR_REACH, length / 2)));
  return t * t * (3 - 2 * t);
}

/** How far out from the middle of a hut its doorway is, as a share of the hut's radius. */
const DOOR_AT = 0.45;
/** The ground a unit covers coming through a doorway, from all inside to all out. */
const DOOR_STEP = 10;

/**
 * How much of a unit is out of doors, 0 to 1. A path runs from the middle of one
 * hut to the middle of the next, so a unit at either end of it is indoors, and
 * drawn there it would be walking across the front of the building.
 */
export function outOfDoors(d: number, length: number, fromRadius: number, toRadius: number): number {
  return Math.min(1, Math.max(0, Math.min(d - fromRadius * DOOR_AT, length - d - toRadius * DOOR_AT) / DOOR_STEP));
}

function bendOf(a: number, b: number): number {
  let h = Math.imul(Math.min(a, b) * 64 + Math.max(a, b) + 1, 0x9e3779b1) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return ((h % 201) - 100) / 100 * 0.12;
}

/** The control point that gives the path between two huts its curve. */
export function controlOf(map: SwarmMap, a: number, b: number): Point {
  const low = map.sites[Math.min(a, b)];
  const high = map.sites[Math.max(a, b)];
  // Any two huts can be asked about, as they could before paths had kinds: a pair no path joins bends as a road would.
  const kind = pathOf(map, a, b)?.kind;
  // A short cut through the stakes is cut straight, and a bridge is built straight.
  const bend = kind === 'spikes' || kind === 'bridge' ? 0 : bendOf(a, b);
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

export function tracePath(ctx: Ctx, map: SwarmMap, a: number, b: number) {
  const c = controlOf(map, a, b);
  ctx.beginPath();
  ctx.moveTo(map.sites[a].x, map.sites[a].y);
  ctx.quadraticCurveTo(c.x, c.y, map.sites[b].x, map.sites[b].y);
}

/** A river as closely spaced points down its middle, with half its width at each. */
export interface River {
  pts: Point[];
  half: number[];
}

const RIVER_STEP = 5;

/** The curve through the points the map gives, which a path over the river was laid out against. */
export function riverOf(line: Point[]): River {
  const pts: Point[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const p0 = line[Math.max(0, i - 1)];
    const p1 = line[i];
    const p2 = line[i + 1];
    const p3 = line[Math.min(line.length - 1, i + 2)];
    const steps = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / RIVER_STEP));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      pts.push({
        x: 0.5 * (2 * p1.x + (p2.x - p0.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (p2.y - p0.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  if (line.length > 0) pts.push(line[line.length - 1]);
  // It widens and narrows a little as it goes, as a stream does between pools.
  return { pts, half: pts.map((_, i) => 21 + 4 * Math.sin(i * 0.11) + 2 * Math.sin(i * 0.37 + 1)) };
}

/** How far x, y is from the water of the nearest river: negative when it is in it. */
export function riverGap(rivers: River[], x: number, y: number): number {
  let gap = Infinity;
  for (const river of rivers) {
    for (let i = 0; i < river.pts.length; i++) {
      const d = Math.hypot(river.pts[i].x - x, river.pts[i].y - y) - river.half[i];
      if (d < gap) gap = d;
    }
  }
  return gap;
}

/** Which way the river runs at one of its points. */
export function riverDir(river: River, i: number): Point {
  const p = river.pts[Math.max(0, i - 1)];
  const q = river.pts[Math.min(river.pts.length - 1, i + 1)];
  const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: (q.x - p.x) / d, y: (q.y - p.y) / d };
}

/** The stretch of a bridge or a ford that is over water, as shares of the path, and whether a river is there at all. */
export interface Crossing {
  path: Path;
  f0: number;
  f1: number;
  river: boolean;
}

export function crossingsOf(map: SwarmMap, rivers: River[]): Crossing[] {
  return map.paths
    .filter((path) => path.kind === 'bridge' || path.kind === 'ford')
    .map((path) => {
      let nearest = Infinity;
      let at = 0;
      const wet: boolean[] = [];
      for (let i = 0; i <= 100; i++) {
        const p = pathPoint(map, path.a, path.b, i / 100);
        const gap = riverGap(rivers, p.x, p.y);
        wet.push(gap < 4);
        if (gap < nearest) {
          nearest = gap;
          at = i;
        }
      }
      if (!wet[at]) {
        // No river under it: it crosses a pool of its own, painted at the middle of the path.
        const dx = map.sites[path.a].x - map.sites[path.b].x;
        const dy = map.sites[path.a].y - map.sites[path.b].y;
        const reach = 22 / Math.hypot(dx, dy);
        return { path, f0: 0.5 - reach, f1: 0.5 + reach, river: false };
      }
      let first = at;
      let last = at;
      while (first > 0 && wet[first - 1]) first--;
      while (last < 100 && wet[last + 1]) last++;
      return { path, f0: first / 100, f1: last / 100, river: true };
    });
}

interface Palette {
  base: string;
  /** Broad patches of tone laid over the base. */
  tones: string[];
  /** The trodden ground round a hut, as r, g, b. */
  worn: string;
  path: { verge: string; edge: string; body: string; crown: string; dark: string; light: string };
  /** What grows at the edge of a path, or null where nothing does. */
  blades: string[] | null;
  water: { bank: string; sand: string; shallow: string; mid: string; deep: string };
  /** The shadow a building throws on the ground. */
  cast: string;
  /** The unlit side of a building. */
  shade: string;
  /** What the corners of the board darken towards, as r, g, b. */
  edge: string;
  stone: string[];
  /** A tower's or a fort's stone, from its lit side to its dark one. */
  wall: [string, string, string];
  spike: { shaft: string; tip: string };
  /** A tower's footing: the hole, the floor of it, and the bank of what was dug with its shadow under. */
  dig: { hole: string; floor: string; under: string; bank: string };
}

const WOOD_SPIKE = { shaft: '#5a3d22', tip: '#ead9ae' };

export const PALETTE: Record<SceneId, Palette> = {
  meadow: {
    base: '#718d4c',
    tones: ['#4f6f37', '#5d7c40', '#6c8a48', '#86a257', '#93ad62', '#a3b96c'],
    worn: '134, 106, 68',
    path: { verge: 'rgba(120, 108, 62, 0.2)', edge: 'rgba(70, 56, 34, 0.42)', body: '#9c8358', crown: '#b39a6c', dark: 'rgba(74, 58, 36, 0.35)', light: 'rgba(222, 204, 160, 0.4)' },
    blades: ['#4f6f37', '#5d7c40', '#6c8a48', '#86a257', '#93ad62', '#a3b96c'],
    water: { bank: '#6b5a3a', sand: '#b9a878', shallow: '#74aaa4', mid: '#4d8a94', deep: '#2f6677' },
    cast: 'rgba(22, 30, 12, 0.34)',
    shade: 'rgba(22, 14, 6, 0.46)',
    edge: '24, 34, 14',
    stone: ['#a4a39b', '#8f8e86', '#b3b2a9', '#7c7b74', '#9a9990'],
    wall: ['#9a9c96', '#73766f', '#3d403c'],
    spike: WOOD_SPIKE,
    dig: { hole: 'rgba(70, 56, 34, 0.5)', floor: '#8a7350', under: 'rgba(52, 40, 22, 0.4)', bank: '#a68d62' },
  },
  scrub: {
    base: '#b89a68',
    tones: ['#c9ad78', '#a98652', '#d4bb88', '#b08a55', '#9c7a4a', '#c2a06a'],
    worn: '150, 116, 74',
    path: { verge: 'rgba(222, 200, 152, 0.3)', edge: 'rgba(110, 78, 42, 0.38)', body: '#cdb383', crown: '#dcc79a', dark: 'rgba(104, 74, 40, 0.35)', light: 'rgba(246, 234, 204, 0.5)' },
    blades: ['#d9c98e', '#c4b070', '#e6d8a4', '#a89858'],
    water: { bank: '#8a6a40', sand: '#d2bb86', shallow: '#8fb0a0', mid: '#6a9692', deep: '#477478' },
    cast: 'rgba(60, 36, 14, 0.38)',
    shade: 'rgba(40, 20, 6, 0.46)',
    edge: '70, 44, 18',
    stone: ['#d8ccb0', '#c7b995', '#e6dcc4', '#b5a684'],
    wall: ['#d6bd8e', '#a88a5c', '#5e4628'],
    spike: { shaft: '#4a3320', tip: '#dccca2' },
    dig: { hole: 'rgba(110, 78, 42, 0.45)', floor: '#c4a776', under: 'rgba(104, 74, 40, 0.4)', bank: '#dcc79a' },
  },
  valley: {
    base: '#4f7d3a',
    tones: ['#3f6a2e', '#5a8a40', '#6a9a48', '#447432', '#7aa652', '#356028'],
    worn: '104, 82, 52',
    path: { verge: 'rgba(52, 62, 30, 0.26)', edge: 'rgba(46, 34, 20, 0.5)', body: '#7a5f3e', crown: '#8f7450', dark: 'rgba(40, 28, 16, 0.4)', light: 'rgba(190, 164, 120, 0.35)' },
    blades: ['#3f6a2e', '#5a8a40', '#6a9a48', '#86b05a', '#2f5a26'],
    water: { bank: '#4e4028', sand: '#8a7a52', shallow: '#62a6a0', mid: '#3d8590', deep: '#1f5f74' },
    cast: 'rgba(14, 30, 14, 0.38)',
    shade: 'rgba(14, 16, 8, 0.48)',
    edge: '12, 30, 16',
    stone: ['#8a8c80', '#74776c', '#9c9e90', '#666a5e'],
    wall: ['#8f9488', '#666c60', '#343a32'],
    spike: WOOD_SPIKE,
    dig: { hole: 'rgba(46, 34, 20, 0.55)', floor: '#6e5538', under: 'rgba(30, 22, 12, 0.4)', bank: '#8f7450' },
  },
  ice: {
    base: '#e4ecf2',
    tones: ['#f6fafc', '#d2deea', '#c2d2e2', '#ffffff', '#dbe6ef', '#b8cadc'],
    worn: '170, 188, 206',
    path: { verge: 'rgba(150, 176, 204, 0.25)', edge: 'rgba(96, 128, 166, 0.45)', body: '#c6d4e1', crown: '#dbe5ee', dark: 'rgba(90, 118, 152, 0.4)', light: 'rgba(255, 255, 255, 0.6)' },
    blades: null,
    water: { bank: '#f4f8fb', sand: '#bcd6e6', shallow: '#8fbcd2', mid: '#3f7896', deep: '#1d4a66' },
    cast: 'rgba(50, 80, 124, 0.34)',
    shade: 'rgba(30, 54, 92, 0.42)',
    edge: '40, 66, 104',
    stone: ['#6e7780', '#5a636c', '#828b94', '#4a525a'],
    wall: ['#aab2ba', '#7a848e', '#3e4852'],
    spike: { shaft: '#9fc3d9', tip: '#f4fbff' },
    dig: { hole: 'rgba(96, 128, 166, 0.5)', floor: '#b4c8da', under: 'rgba(96, 130, 178, 0.4)', bank: '#ffffff' },
  },
  terrace: {
    base: '#76873f',
    tones: ['#8c9a52', '#73843f', '#99a55c', '#6a7a3a', '#a4ad66'],
    worn: '150, 126, 84',
    path: { verge: 'rgba(130, 120, 70, 0.22)', edge: 'rgba(84, 68, 40, 0.42)', body: '#b5a27a', crown: '#cabb94', dark: 'rgba(84, 66, 40, 0.35)', light: 'rgba(236, 224, 190, 0.45)' },
    blades: ['#73843f', '#8c9a52', '#a4ad66', '#5f7036'],
    water: { bank: '#6b5a3a', sand: '#b9a878', shallow: '#74aaa4', mid: '#4d8a94', deep: '#2f6677' },
    cast: 'rgba(34, 32, 12, 0.36)',
    shade: 'rgba(30, 20, 6, 0.46)',
    edge: '36, 34, 12',
    stone: ['#c9b88f', '#b5a37a', '#d6c7a0', '#a39168', '#bfae84'],
    wall: ['#d4c49c', '#a4946c', '#58492e'],
    spike: WOOD_SPIKE,
    dig: { hole: 'rgba(84, 68, 40, 0.5)', floor: '#a8956e', under: 'rgba(70, 54, 30, 0.4)', bank: '#cabb94' },
  },
};

/** The hilltop of a terraced map: its fort, or the middle of the board when it has none. */
export function summitOf(map: SwarmMap): Point {
  const fort = map.sites.find((site) => site.fort);
  return fort ? { x: fort.x, y: fort.y } : centreOf(map);
}
