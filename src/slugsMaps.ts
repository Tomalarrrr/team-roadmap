// Slugs map designs. Each design is its own landscape family (a cavern, sky
// islands, two castles...) and the seed only varies the details, so a match on
// "Twin forts" is always two castles across a moat, never a different shape.
//
// Like the rest of the rules this is a pure function of the seed: integer
// arithmetic and seeded hashing only, because both online players build the
// land from the same seed and must get the same bytes. Imports from the rules
// are only used inside functions, so the rules can import this file back.

import type { ThemeId } from './components/slugs/slugThemes';
import { buildTerrain, H, randInt, STEP_PX, W, WATER_START } from './slugsGameLogic';

export type MapDesignId =
  | 'classic'
  | 'cavern'
  | 'sky'
  | 'forts'
  | 'canyon'
  | 'hive'
  | 'spires'
  | 'arch'
  | 'toadstools'
  | 'wreck'
  | 'volcano'
  | 'archipelago';

export const MAP_DESIGNS: Record<MapDesignId, { name: string; blurb: string; theme: ThemeId }> = {
  classic: { name: 'Islands', blurb: 'One to three rolling islands with a few holes and floating rocks.', theme: 'tropical' },
  cavern: { name: 'Drowned cavern', blurb: 'A rock roof over the whole map with stalactites, pillars and a lake floor; shots go under the roof.', theme: 'caves' },
  sky: { name: 'Sky islands', blurb: 'Islands floating at two heights with open drops between them, and caves cut into the bigger ones.', theme: 'floating' },
  forts: { name: 'Twin forts', blurb: 'Two castles with towers, battlements, rooms and a cellar tunnel, facing each other over a moat.', theme: 'snow' },
  canyon: { name: 'Canyon', blurb: 'Two high plateaus split by a deep gorge with overhanging lips, alcoves in the walls and a stone bridge.', theme: 'canyon' },
  hive: { name: 'Hive mountain', blurb: 'One mountain bored through with rooms and tunnels, opening onto both slopes.', theme: 'countryside' },
  spires: { name: 'Spires', blurb: 'Tall rock needles of different heights rising from the sea, with ledges and thin bridges.', theme: 'fantasy' },
  arch: { name: 'Sea arch', blurb: 'Two headlands joined by a huge stone arch over open water, with sea caves and stacks below.', theme: 'coast' },
  toadstools: { name: 'Toadstool wood', blurb: 'Giant mushrooms at three heights over low ground; stand on the caps, shelter under them.', theme: 'fantasy' },
  wreck: { name: 'Shipwreck', blurb: 'A steel ship broken in two on the sandbanks, with decks and holds to fight through.', theme: 'tropical' },
  volcano: { name: 'Volcano', blurb: 'A tall cone with a crater, lava tubes running through it and shelves on the flanks.', theme: 'volcano' },
  archipelago: { name: 'Archipelago', blurb: 'A long chain of small islets and sea stacks with water between every one.', theme: 'tropical' },
};

export const MAP_DESIGN_IDS = Object.keys(MAP_DESIGNS) as MapDesignId[];

const BUILDERS: Record<MapDesignId, (seed: number) => Uint8Array> = {
  classic: (seed) => buildTerrain(seed),
  cavern,
  sky,
  forts,
  canyon,
  hive,
  spires,
  arch,
  toadstools,
  wreck,
  volcano,
  archipelago,
};

/** The land for a design and seed, one byte a pixel, W by H: 0 air, 1 land, 2 girder steel. */
export function buildMap(design: MapDesignId, seed: number): Uint8Array {
  return BUILDERS[design](seed >>> 0);
}

/** Girder: solid and destructible like soil, painted as steel plate. */
const GIRDER = 2;

type Rng = { rng: number };

const rng = (seed: number, salt: number): Rng => ({ rng: (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0 });
/** A whole number in a..b inclusive. */
const pick = (g: Rng, a: number, b: number) => a + randInt(g, b - a + 1);

function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smooth 1D noise in -amp..amp, on a grid of `cell` px. */
function wave(x: number, cell: number, amp: number, seed: number): number {
  const i = Math.floor(x / cell);
  const f = x - i * cell;
  const a = hash(i, 0, seed) & 1023;
  const b = hash(i + 1, 0, seed) & 1023;
  const s = Math.trunc((f * f * (3 * cell - 2 * f)) / (cell * cell));
  const v = a + Math.trunc(((b - a) * s) / cell);
  return Math.trunc(((2 * v - 1023) * amp) / 1023);
}

// --- Drawing on the mask. Everything clips to the map. ---

function rect(t: Uint8Array, x0: number, y0: number, x1: number, y1: number, v: number): void {
  const ax = Math.max(0, Math.min(x0, x1));
  const bx = Math.min(W - 1, Math.max(x0, x1));
  if (bx < ax) return;
  for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(H - 1, Math.max(y0, y1)); y++) t.fill(v, y * W + ax, y * W + bx + 1);
}

function column(t: Uint8Array, x: number, y0: number, y1: number, v: number): void {
  if (x < 0 || x >= W) return;
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) t[y * W + x] = v;
}

function ellipse(t: Uint8Array, cx: number, cy: number, rx: number, ry: number, v: number): void {
  for (let dy = -ry; dy <= ry; dy++) {
    const hw = Math.trunc((rx * isqrt(ry * ry - dy * dy)) / ry);
    rect(t, cx - hw, cy + dy, cx + hw, cy + dy, v);
  }
}

/** A round-ended stroke of radius r from one point to another. */
function tube(t: Uint8Array, x0: number, y0: number, x1: number, y1: number, r: number, v: number): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / Math.max(1, r >> 1)));
  for (let i = 0; i <= n; i++) ellipse(t, x0 + Math.trunc(((x1 - x0) * i) / n), y0 + Math.trunc(((y1 - y0) * i) / n), r, r, v);
}

const solid = (t: Uint8Array, x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && t[y * W + x] !== 0;

/** First solid row in a column from `from` down, or H if none. */
function surface(t: Uint8Array, x: number, from = 0): number {
  for (let y = from; y < H; y++) if (t[y * W + x] !== 0) return y;
  return H;
}

/**
 * Push every pixel by a smooth random offset of up to `amp` px, so ruled and
 * round shapes come out weathered. Offsets are kept on a coarse grid and
 * interpolated, which is far cheaper than noise per pixel.
 */
function warp(t: Uint8Array, amp: number, cell: number, seed: number): Uint8Array {
  const gw = Math.floor(W / cell) + 2;
  const gh = Math.floor(H / cell) + 2;
  const ox = new Int32Array(gw * gh);
  const oy = new Int32Array(gw * gh);
  for (let i = 0; i < gw * gh; i++) {
    ox[i] = (hash(i, 1, seed) % (2 * amp + 1)) - amp;
    oy[i] = (hash(i, 2, seed) % (2 * amp + 1)) - amp;
  }
  const out = new Uint8Array(W * H);
  const cc = cell * cell;
  for (let y = 0; y < H; y++) {
    const iy = Math.floor(y / cell);
    const fy = y - iy * cell;
    for (let x = 0; x < W; x++) {
      const ix = Math.floor(x / cell);
      const fx = x - ix * cell;
      const k = iy * gw + ix;
      const lerp = (o: Int32Array) => {
        const top = o[k] * cell + (o[k + 1] - o[k]) * fx;
        const bottom = o[k + gw] * cell + (o[k + gw + 1] - o[k + gw]) * fx;
        return Math.trunc((top * cell + (bottom - top) * fy) / cc);
      };
      const sx = Math.min(W - 1, Math.max(0, x + lerp(ox)));
      const sy = Math.min(H - 1, Math.max(0, y + lerp(oy)));
      out[y * W + x] = t[sy * W + sx];
    }
  }
  return out;
}

/** One 3x3 majority pass to rub off single-pixel spikes and pits. The outer frame is left as it is. */
function smooth(t: Uint8Array): Uint8Array {
  const out = t.slice();
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      let n = 0;
      for (let dy = -W; dy <= W; dy += W) n += (t[i + dy - 1] !== 0 ? 1 : 0) + (t[i + dy] !== 0 ? 1 : 0) + (t[i + dy + 1] !== 0 ? 1 : 0);
      out[i] = n >= 5 ? t[i] || 1 : 0;
    }
  }
  return out;
}

/**
 * Fill every pocket of air above the water that reaches neither an open edge
 * of the map (top, left, right) nor the water, so the land has no sealed
 * bubbles in it. Air over water, such as the space under a bridge, is kept:
 * it is open to the sea, and the rules will not seat a slug there unless it
 * also reaches open air. A map whose edges are all rock (the cavern) keeps
 * its largest pocket.
 */
function seal(t: Uint8Array): Uint8Array {
  const rows = WATER_START;
  const label = new Int32Array(W * rows).fill(-1);
  const stack = new Int32Array(W * rows);
  const sizes: number[] = [];
  const open: boolean[] = [];
  for (let start = 0; start < W * rows; start++) {
    if (t[start] !== 0 || label[start] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    let edge = false;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const i = stack[--top];
      size++;
      const x = i % W;
      if (i < W || x === 0 || x === W - 1 || i >= W * (rows - 1)) edge = true;
      if (x > 0 && t[i - 1] === 0 && label[i - 1] < 0) { label[i - 1] = id; stack[top++] = i - 1; }
      if (x < W - 1 && t[i + 1] === 0 && label[i + 1] < 0) { label[i + 1] = id; stack[top++] = i + 1; }
      if (i >= W && t[i - W] === 0 && label[i - W] < 0) { label[i - W] = id; stack[top++] = i - W; }
      if (i + W < W * rows && t[i + W] === 0 && label[i + W] < 0) { label[i + W] = id; stack[top++] = i + W; }
    }
    sizes.push(size);
    open.push(edge);
  }
  const keep = open.slice();
  if (!open.includes(true) && sizes.length > 0) keep[sizes.indexOf(Math.max(...sizes))] = true;
  for (let i = 0; i < W * rows; i++) if (label[i] >= 0 && !keep[label[i]]) t[i] = 1;
  return t;
}

/** Merlons along the top of a wall: teeth a slug can step over (so the wall walk is not a row of pits) with 20 px gaps it can stand in. */
function battlements(t: Uint8Array, x0: number, x1: number, top: number, v: number): void {
  for (let x = x0; x + 9 <= x1; x += 30) rect(t, x, top - STEP_PX, x + 9, top - 1, v);
  rect(t, x1 - 9, top - STEP_PX, x1, top - 1, v);
}

// --- Designs ---

/**
 * A closed cave: rock roof and walls to the water, so nothing can be lobbed
 * over the top. Pillars carry the roof and each has a window, or the cave
 * would be split into rooms that only meet underwater.
 */
function cavern(seed: number): Uint8Array {
  const g = rng(seed, 1);
  const t = new Uint8Array(W * H);
  const roof = new Int32Array(W);
  for (let x = 0; x < W; x++) roof[x] = 78 + wave(x, 170, 30, seed) + wave(x, 41, 10, seed + 1);
  const wallL = pick(g, 34, 60);
  const wallR = pick(g, 34, 60);
  for (let y = 0; y < H; y++) {
    const foot = y > 380 ? Math.trunc((y - 380) / 3) : 0;
    rect(t, 0, y, wallL + wave(y, 60, 14, seed + 2) + foot, y, 1);
    rect(t, W - 1 - wallR - wave(y, 60, 14, seed + 3) - foot, y, W - 1, y, 1);
  }
  for (let x = 0; x < W; x++) column(t, x, 0, roof[x], 1);

  // Lake floor: flat-topped mounds with water between them.
  const floor = new Int32Array(W).fill(H);
  for (let x = wallL + 90 + pick(g, 0, 60); x < W - wallR - 160; ) {
    const hw = pick(g, 80, 170);
    const cx = x + hw;
    const ty = pick(g, 470, 545);
    for (let dx = -2 * hw; dx <= 2 * hw; dx++) {
      const d = Math.max(0, Math.abs(dx) - (hw >> 1));
      const y = ty + Math.trunc((d * d * 150) / (hw * hw)) + wave(cx + dx, 29, 6, seed + 4);
      if (cx + dx >= 0 && cx + dx < W) floor[cx + dx] = Math.min(floor[cx + dx], y);
    }
    x = cx + hw + pick(g, 70, 170);
  }
  for (let x = 0; x < W; x++) column(t, x, floor[x], H - 1, 1);

  const pillars: number[] = [];
  const nPillars = pick(g, 2, 3);
  for (let k = 0; k < nPillars; k++) {
    const px = Math.trunc((W * (k + 1)) / (nPillars + 1)) + pick(g, -90, 90);
    pillars.push(px);
    const mid = pick(g, 260, 380);
    for (let y = 0; y < H; y++) {
      const hw = 20 + Math.trunc((Math.abs(y - mid) * 34) / 300) + wave(y, 50, 5, seed + 10 + k);
      rect(t, px - hw, y, px + hw, y, 1);
    }
    ellipse(t, px + pick(g, -6, 6), pick(g, 250, 420), pick(g, 34, 44), pick(g, 26, 36), 0);
  }

  const stalactites = pick(g, 16, 24);
  for (let k = 0; k < stalactites; k++) {
    const x = pick(g, wallL + 40, W - wallR - 40);
    if (pillars.some((p) => Math.abs(p - x) < 70)) continue;
    const room = surface(t, x, roof[x] + 2) - roof[x];
    const len = Math.min(pick(g, 40, 200), room - 110);
    const base = pick(g, 9, 24);
    for (let dy = 0; dy < len; dy++) {
      const hw = Math.trunc((base * (len - dy)) / len) + (dy < 14 ? (14 - dy) >> 1 : 0);
      const xc = x + wave(dy + k * 97, 34, 3, seed + 5);
      rect(t, xc - hw, roof[x] - 4 + dy, xc + hw, roof[x] - 4 + dy, 1);
    }
  }

  // Shelves out of the side walls, at heights that differ between the sides.
  for (const side of [-1, 1]) {
    const levels = side < 0 ? [pick(g, 240, 300), pick(g, 380, 440)] : [pick(g, 300, 350), pick(g, 420, 460)];
    for (const y of levels) {
      const len = pick(g, 110, 210);
      const th = pick(g, 22, 32);
      const wall = side < 0 ? wallL + 20 : W - 1 - wallR - 20;
      for (let u = -30; u <= len; u++) {
        const depth = th + Math.trunc(((len - Math.max(0, u)) * th) / len);
        const x = wall - side * u;
        column(t, x, y, y + depth - (u > len - 12 ? (u - len + 12) * 2 : 0), 1);
      }
    }
  }

  // Shelves hung from the roof on a rock stem, in the open middle of the cave.
  const shelves = pick(g, 2, 3);
  for (let k = 0; k < shelves; k++) {
    const x = Math.trunc((W * (2 * k + 1)) / (2 * shelves)) + pick(g, -60, 60);
    if (pillars.some((p) => Math.abs(p - x) < 170)) continue;
    const y = Math.min(pick(g, 250, 340), surface(t, x, roof[x] + 2) - 120);
    tube(t, x, roof[x], x + pick(g, -10, 10), y, pick(g, 12, 18), 1);
    const hw = pick(g, 60, 100);
    for (let dx = -hw; dx <= hw; dx++) column(t, x + dx, y, y + 14 + Math.trunc(((hw - Math.abs(dx)) * 16) / hw), 1);
  }

  const mites = pick(g, 6, 10);
  for (let k = 0; k < mites; k++) {
    const x = pick(g, wallL + 60, W - wallR - 60);
    const y = surface(t, x, 200);
    if (y > WATER_START - 30) continue;
    const len = pick(g, 18, 50);
    const base = pick(g, 7, 13);
    for (let dy = 0; dy < len; dy++) {
      const hw = Math.trunc((base * (len - dy)) / len);
      rect(t, x - hw, y + 6 - dy, x + hw, y + 6 - dy, 1);
    }
  }
  return seal(smooth(warp(t, 5, 22, seed + 9)));
}

/** A floating island: a domed top and a ragged hanging keel. */
function island(t: Uint8Array, cx: number, ty: number, hw: number, depth: number, seed: number): void {
  for (let x = cx - hw; x <= cx + hw; x++) {
    const d = Math.abs(x - cx);
    const shoulder = d > hw - 28 ? Math.trunc(((d - hw + 28) * (d - hw + 28)) / 14) : 0;
    const top = ty + wave(x, 37, 4, seed) + shoulder;
    const keel = ty + 16 + Math.trunc((depth * (hw * hw - d * d)) / (hw * hw)) + wave(x, 13, 9, seed + 1) + wave(x, 41, 12, seed + 2);
    if (keel > top) column(t, x, top, keel, 1);
  }
}

/** Islands at two heights in five or six slots, with stepping stones in the gaps and nothing to fall onto but water. */
function sky(seed: number): Uint8Array {
  const g = rng(seed, 2);
  const t = new Uint8Array(W * H);
  const cols = pick(g, 5, 6);
  const slot = Math.trunc((W - 80) / cols);
  const caves: [number, number, number, number][] = [];
  for (let c = 0; c < cols; c++) {
    const mid = 40 + c * slot + (slot >> 1);
    const most = (slot >> 1) - 24;
    if (randInt(g, 3) > 0) {
      const lean = randInt(g, 2) ? 1 : -1;
      const hw1 = pick(g, 70, Math.min(130, most));
      const ty1 = pick(g, 110, 230);
      const d1 = pick(g, 50, 90);
      const cx1 = mid + lean * pick(g, 0, Math.max(0, most - hw1));
      island(t, cx1, ty1, hw1, d1, seed + c * 16);
      const hw2 = pick(g, 80, most);
      const ty2 = Math.max(ty1 + d1 + 100, pick(g, 340, 450));
      const d2 = Math.min(pick(g, 60, 110), WATER_START - 70 - ty2);
      const cx2 = mid - lean * pick(g, 0, Math.max(0, most - hw2));
      island(t, cx2, ty2, hw2, d2, seed + c * 16 + 5);
      if (hw2 >= 110) caves.push([cx2, ty2, hw2, -lean]);
    } else {
      const hw = pick(g, 110, most);
      const ty = pick(g, 230, 380);
      island(t, mid + pick(g, -20, 20), ty, hw, Math.min(pick(g, 90, 150), WATER_START - 70 - ty), seed + c * 16 + 9);
      caves.push([mid, ty, hw, randInt(g, 2) ? 1 : -1]);
    }
  }

  const stones = pick(g, 8, 12);
  for (let k = 0, tries = 0; k < stones && tries < 200; tries++) {
    const x = pick(g, 60, W - 60);
    const y = pick(g, 110, 520);
    const rx = pick(g, 16, 30);
    let clear = true;
    for (let yy = y - 60; yy <= y + 60 && clear; yy += 6) for (let xx = x - rx - 50; xx <= x + rx + 50 && clear; xx += 6) if (solid(t, xx, yy)) clear = false;
    if (!clear) continue;
    island(t, x, y, rx, pick(g, 8, 18), seed + 400 + k);
    k++;
  }

  const stacks = pick(g, 1, 3);
  for (let k = 0; k < stacks; k++) {
    const x = pick(g, 100, W - 100);
    const top = pick(g, 540, 575);
    if (solid(t, x, top - 60) || solid(t, x, top - 140)) continue;
    const hw = pick(g, 18, 32);
    for (let y = top; y < H; y++) rect(t, x - hw - Math.trunc((y - top) / 6), y, x + hw + Math.trunc((y - top) / 6), y, 1);
  }

  const out = smooth(warp(t, 4, 18, seed + 7));
  // Caves after the warp, so their floors stay flat enough to stand on.
  for (const [cx, ty, hw, side] of caves) {
    const y = ty + 40;
    if (surface(out, cx, ty - 10) > ty + 12) continue;
    ellipse(out, cx, y, Math.trunc(hw / 3), 20, 0);
    rect(out, cx - Math.trunc(hw / 3), y, cx + Math.trunc(hw / 3), y + 6, 1);
    tube(out, cx, y - 4, cx + side * (hw + 30), y - 4, 15, 0);
  }
  return seal(out);
}

/**
 * One castle facing the enemy. Drawn through `px`, which mirrors it for the
 * right-hand side, so both castles are the same shape and neither side has
 * the better fort.
 */
function castle(t: Uint8Array, g: Rng, gy: number, x0: number, mirror: boolean): number {
  const R = (a: number, y0: number, b: number, y1: number, v: number) => (mirror ? rect(t, W - 1 - a, y0, W - 1 - b, y1, v) : rect(t, a, y0, b, y1, v));
  const crenels = (a: number, b: number, top: number) => {
    for (let x = a; x + 9 <= b; x += 30) R(x, top - STEP_PX, x + 9, top - 1, 1);
    R(b - 9, top - STEP_PX, b, top - 1, 1);
  };
  // Rooms one above another, each with a doorway on the enemy side at floor level.
  const rooms = (a: number, b: number, top: number, from: number) => {
    let k = 0;
    for (let floor = gy - from; floor - 50 > top + 20; floor -= 64, k++) {
      R(a + 12, floor - 50, b - 12, floor - 1, 0);
      R(b - 12, floor - 32, b + 1, floor - 1, 0);
      if (k > 0) R(k % 2 ? a + 12 : b - 40, floor, k % 2 ? a + 40 : b - 12, floor + 14, 0);
    }
  };
  const rearW = pick(g, 50, 62);
  const rearTop = gy - pick(g, 150, 190);
  const wallA = pick(g, 70, 100);
  const keepW = pick(g, 100, 120);
  const keepTop = gy - pick(g, 260, 310);
  const wallB = pick(g, 90, 120);
  const wallTop = gy - pick(g, 105, 125);
  const frontW = pick(g, 64, 76);
  const frontTop = gy - pick(g, 180, 220);
  const k0 = x0 + rearW + wallA;
  const k1 = k0 + keepW;
  const f0 = k1 + wallB;
  const f1 = f0 + frontW;

  R(x0, gy, f1, H - 1, 1);
  R(x0, rearTop, x0 + rearW, gy, 1);
  crenels(x0, x0 + rearW, rearTop);
  R(x0 + rearW, wallTop + 15, k0, gy, 1);
  crenels(x0 + rearW, k0, wallTop + 15);
  R(k0, keepTop, k1, gy, 1);
  crenels(k0, k1, keepTop);
  R(k1, wallTop, f0, gy, 1);
  crenels(k1, f0, wallTop);
  R(f0, frontTop, f1, gy, 1);
  crenels(f0, f1, frontTop);

  rooms(k0, k1, keepTop, 14);
  rooms(f0, f1, frontTop, 14);
  rooms(x0, x0 + rearW, rearTop, 80);
  // Gate passage at ground level from the keep, under the front wall, into the front tower.
  R(k1 - 12, gy - 40, f0 + 12, gy - 14, 0);
  // Gallery inside the back wall, opening into the keep.
  R(x0 + rearW + 10, wallTop + 40, k0 + 12, wallTop + 80, 0);
  // Cellar under the keep, with a hatch up into it and a tunnel out toward the moat.
  R(k0 + 12, gy + 16, k1 - 12, gy + 60, 0);
  R(k0 + 40, gy - 14, k0 + 66, gy + 16, 0);
  return mirror ? W - 1 - f1 : f1;
}

function forts(seed: number): Uint8Array {
  const g = rng(seed, 3);
  const t = new Uint8Array(W * H);
  const gy = pick(g, 450, 490);
  const x0 = pick(g, 50, 110);
  const moat = pick(g, 150, 230);
  const bank = W / 2 - moat;
  for (let x = 0; x < W; x++) {
    const d = Math.abs(x - W / 2);
    const s = x < W / 2 ? seed + 1 : seed + 2;
    let top = gy + 4 + wave(x, 90, 14, s) + wave(x, 23, 4, s + 9);
    if (d < moat + 160) top += Math.trunc(((moat + 160 - d) * (moat + 160 - d)) / 140);
    column(t, x, top, H - 1, 1);
  }
  // Islet in the moat with the stump of an old tower on it.
  const isle = pick(g, 40, 60);
  const isleTop = pick(g, 520, 560);
  for (let dx = -isle - 40; dx <= isle + 40; dx++) {
    const d = Math.max(0, Math.abs(dx) - isle);
    column(t, W / 2 + dx, isleTop + Math.trunc((d * d) / 12) + wave(dx, 17, 4, seed + 3), H - 1, 1);
  }
  const stump = pick(g, 60, 110);
  for (let dx = -22; dx <= 22; dx++) column(t, W / 2 + dx, isleTop - stump + (hash(dx >> 2, 7, seed) & 15), isleTop, 1);
  const land = seal(smooth(warp(t, 4, 20, seed + 4)));

  // Mirrored castles from one copy of the generator.
  const cg = { rng: g.rng };
  castle(land, { rng: cg.rng }, gy, x0, false);
  const front = castle(land, { rng: cg.rng }, gy, x0, true);
  const frontL = W - 1 - front;
  // A broken bridge reaching out from each bank, on a pier.
  const reach = pick(g, 90, Math.max(90, moat - 70));
  for (const side of [-1, 1]) {
    const a = side < 0 ? Math.min(frontL + 30, bank - 40) : W - 1 - Math.min(frontL + 30, bank - 40);
    const b = side < 0 ? bank + reach : W - 1 - bank - reach;
    rect(land, a, gy - 6, b, gy + 10, 1);
    rect(land, b + side * 6, gy + 10, b + side * 30, H - 1, 1);
    battlements(land, Math.min(a, b), Math.max(a, b), gy - 6, 1);
    // A tunnel from the castle cellar to the bank, coming out under the bridge.
    const cellar = side < 0 ? x0 + 140 : W - 1 - x0 - 140;
    tube(land, cellar, gy + 46, side < 0 ? bank - 10 : W - 1 - bank + 10, gy + 60, 14, 0);
  }
  return seal(land);
}

/** Two plateaus with a gorge between; the gorge walls narrow toward the water and are undercut, so the lips overhang. */
function canyon(seed: number): Uint8Array {
  const g = rng(seed, 4);
  const t = new Uint8Array(W * H);
  const mid = (W >> 1) + pick(g, -80, 80);
  const half = pick(g, 130, 190);
  const base = [pick(g, 150, 200), pick(g, 150, 200)];
  const outer = [pick(g, 40, 110), pick(g, 40, 110)];
  const top = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const s = x < mid ? 0 : 1;
    top[x] = base[s] + 38 * Math.trunc((wave(x, 240, 55, seed + 5 + s) + 55) / 38) + wave(x, 23, 3, seed + 7);
  }
  const edgeOf = (side: number, y: number) => {
    const s = seed + 20 + side;
    const lip = y < base[side] + 46 ? 46 : 0;
    const depth = y - base[side];
    const narrowing = Math.trunc((Math.max(0, depth) * 12) / 100);
    const c = base[side] + 230;
    const u = Math.abs(y - c);
    const bulge = u < 130 ? Math.trunc((60 * (130 * 130 - u * u)) / (130 * 130)) : 0;
    return half - narrowing + bulge - lip + wave(y, 60, 16, s);
  };
  for (let y = 0; y < H; y++) {
    const eL = mid - edgeOf(0, y);
    const eR = mid + edgeOf(1, y);
    const oL = outer[0] + wave(y, 70, 14, seed + 30) + (y > WATER_START - 90 ? -Math.trunc((y - WATER_START + 90) / 2) : 0);
    const oR = W - 1 - outer[1] - wave(y, 70, 14, seed + 31) - (y > WATER_START - 90 ? -Math.trunc((y - WATER_START + 90) / 2) : 0);
    for (let x = Math.max(0, oL); x <= eL; x++) if (y >= top[x]) t[y * W + x] = 1;
    for (let x = eR; x <= Math.min(W - 1, oR); x++) if (y >= top[x]) t[y * W + x] = 1;
  }
  // Sea caves at the foot of the outer cliffs.
  ellipse(t, outer[0] + pick(g, 20, 50), WATER_START - 20, pick(g, 50, 80), pick(g, 36, 52), 0);
  ellipse(t, W - 1 - outer[1] - pick(g, 20, 50), WATER_START - 20, pick(g, 50, 80), pick(g, 36, 52), 0);

  const land = smooth(warp(t, 4, 20, seed + 8));
  const wallAt = (side: number, y: number) => {
    if (side < 0) {
      for (let x = mid; x > 0; x--) if (solid(land, x, y)) return x;
      return 0;
    }
    for (let x = mid; x < W - 1; x++) if (solid(land, x, y)) return x;
    return W - 1;
  };

  // Alcoves cut into the gorge walls, staggered so the two sides look at each other across the drop.
  const alcoves: [number, number, number][] = [];
  for (const side of [-1, 1]) {
    const b = base[side < 0 ? 0 : 1];
    for (let k = 0; k < 3; k++) {
      const floor = b + 120 + k * 115 + (side > 0 ? 55 : 0) + pick(g, -15, 15);
      if (floor > WATER_START - 50) continue;
      const e = wallAt(side, floor - 20);
      const depth = pick(g, 70, 120);
      const back = e - side * depth;
      rect(land, back, floor - 40, e + side * 6, floor - 1, 0);
      ellipse(land, back, floor - 22, 18, 18, 0);
      rect(land, back - 20, floor, back + 20, floor + 8, 1);
      alcoves.push([side, back, floor]);
    }
    // A shelf jutting out between the alcoves.
    const sy = b + 175 + (side > 0 ? -55 : 55) + pick(g, -10, 10);
    const se = wallAt(side, sy + 8);
    const len = pick(g, 50, 80);
    for (let u = -12; u <= len; u++) column(land, se + side * u, sy, sy + 16 + Math.trunc(((len - Math.max(0, u)) * 16) / len), 1);
  }

  // A stone bridge across the gorge, sometimes broken; else a pillar standing in the water.
  if (randInt(g, 100) < 60) {
    const yb = Math.max(base[0], base[1]) + pick(g, 90, 150);
    const a = wallAt(-1, yb) - 20;
    const b = wallAt(1, yb) + 20;
    const sag = pick(g, 18, 36);
    const hl = (b - a) >> 1;
    for (let x = a; x <= b; x++) {
      const u = x - a - hl;
      const y = yb + Math.trunc((sag * (hl * hl - u * u)) / (hl * hl));
      column(land, x, y, y + 20 + Math.trunc((u * u * 20) / (hl * hl)), 1);
    }
    if (randInt(g, 100) < 45) {
      const gap = pick(g, 45, 80);
      const at = a + hl + pick(g, -hl >> 1, hl >> 1);
      rect(land, at - (gap >> 1), yb - 10, at + (gap >> 1), yb + sag + 50, 0);
    }
  } else {
    const x = mid + pick(g, -30, 30);
    const yh = Math.max(base[0], base[1]) + pick(g, 200, 270);
    for (let y = yh; y < H; y++) {
      const hw = 28 + wave(y, 40, 6, seed + 40) + (y > WATER_START - 40 ? (y - WATER_START + 40) >> 1 : 0);
      rect(land, x - hw, y, x + hw, y, 1);
    }
    for (let dx = -60; dx <= 60; dx++) column(land, x + dx, yh - 6, yh + 10 + ((60 - Math.abs(dx)) >> 2), 1);
  }

  // A shaft from each plateau down to its top alcove: a way to drop into the wall unseen.
  for (const side of [-1, 1]) {
    const first = alcoves.find(([s]) => s === side);
    if (!first) continue;
    const [, back, floor] = first;
    const sx = back - side * pick(g, 90, 160);
    tube(land, sx, surface(land, sx) - 10, back, floor - 18, 14, 0);
  }

  // Rocks on each plateau to hide behind.
  for (const side of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const x = side < 0 ? pick(g, outer[0] + 80, mid - half - 120) : pick(g, mid + half + 120, W - 1 - outer[1] - 80);
      const y = surface(land, x);
      const h = pick(g, 40, 90);
      for (let dy = 0; dy < h; dy++) {
        const hw = 10 + wave(dy, 20, 3, seed + 50 + k) + (dy > h - 14 ? 14 : 0);
        rect(land, x - hw, y - dy, x + hw, y - dy, 1);
      }
    }
  }
  return seal(land);
}

/** A mountain bored through with rooms on a staggered lattice, joined by a spanning tree of tunnels so every room has a way out. */
function hive(seed: number): Uint8Array {
  const g = rng(seed, 5);
  const t = new Uint8Array(W * H);
  const peak = (W >> 1) + pick(g, -140, 140);
  const peakY = pick(g, 100, 140);
  const spanL = peak - pick(g, 60, 110);
  const spanR = W - 1 - pick(g, 60, 110) - peak;
  const top = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const d = x < peak ? peak - x : x - peak;
    const span = x < peak ? spanL : spanR;
    top[x] = peakY + Math.trunc((d * (WATER_START + 30 - peakY)) / span) - Math.trunc((d * (span - d) * 110) / (span * span)) + wave(x, 110, 26, seed) + wave(x, 31, 7, seed + 1);
    column(t, x, top[x], H - 1, 1);
  }
  const land = smooth(warp(t, 4, 20, seed + 2));

  const rooms: [number, number][] = [];
  for (let r = 0, cy = pick(g, 230, 260); cy < WATER_START - 50; r++, cy += 78) {
    for (let cx = 120 + (r % 2 ? 64 : 0) + pick(g, -10, 10); cx < W - 120; cx += 128) {
      if (Math.max(top[cx - 60], top[cx + 60], top[cx]) > cy - 64) continue;
      if (randInt(g, 100) < 22) continue;
      rooms.push([cx, cy]);
    }
  }
  const floorOf = (i: number) => rooms[i][1] + 20;
  for (const [cx, cy] of rooms) {
    const rx = pick(g, 40, 54);
    ellipse(land, cx, cy, rx, 30, 0);
    rect(land, cx - rx, cy + 21, cx + rx, cy + 30, 1);
  }

  const edges: [number, number][] = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const dx = Math.abs(rooms[i][0] - rooms[j][0]);
      const dy = rooms[j][1] - rooms[i][1];
      if ((dy === 0 && dx <= 140) || (dy === 78 && dx <= 80)) edges.push([i, j]);
    }
  }
  for (let i = edges.length - 1; i > 0; i--) {
    const j = randInt(g, i + 1);
    [edges[i], edges[j]] = [edges[j], edges[i]];
  }
  const parent = rooms.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [i, j] of edges) {
    const joins = find(i) !== find(j);
    if (!joins && randInt(g, 100) >= 30) continue;
    parent[find(i)] = find(j);
    const [ax, ay] = rooms[i];
    const [bx, by] = rooms[j];
    if (ay === by) rect(land, Math.min(ax, bx), floorOf(i) - 30, Math.max(ax, bx), floorOf(i), 0);
    else tube(land, ax, ay, bx, by, 13, 0);
  }

  // Doors onto the slopes: in each row the outermost rooms tunnel out sideways.
  const rows = [...new Set(rooms.map(([, cy]) => cy))];
  for (const cy of rows) {
    const inRow = rooms.map((r, i) => [r[0], i] as const).filter(([, i]) => rooms[i][1] === cy);
    for (const [cx, i] of [inRow[0], inRow[inRow.length - 1]]) {
      const dir = cx < peak ? -1 : 1;
      let x = cx + dir * 60;
      while (x > 0 && x < W - 1 && solid(land, x, floorOf(i) - 15)) x += dir;
      rect(land, Math.min(cx, x), floorOf(i) - 30, Math.max(cx, x), floorOf(i), 0);
    }
  }
  // Chimneys from the top row to the summit.
  const topRow = Math.min(...rows);
  for (const [cx, cy] of rooms) if (cy === topRow && randInt(g, 2)) tube(land, cx, cy, cx + pick(g, -20, 20), top[cx] - 20, 12, 0);
  return seal(land);
}

/** Rock needles from the sea, each with a flat cap and ledges; some pairs joined by a thin sagging bridge. */
function spires(seed: number): Uint8Array {
  const g = rng(seed, 6);
  const t = new Uint8Array(W * H);
  const n = pick(g, 9, 12);
  const slot = Math.trunc((W - 160) / n);
  const tips: [number, number, number][] = [];
  let last = 0;
  for (let i = 0; i < n; i++) {
    const cx = 80 + slot * i + (slot >> 1) + pick(g, -Math.trunc(slot / 5), Math.trunc(slot / 5));
    let ty = pick(g, 130, 440);
    if (Math.abs(ty - last) < 70) ty = ty > 285 ? ty - 110 : ty + 110;
    last = ty;
    const hw = pick(g, 20, 34);
    for (let y = ty; y < H; y++) {
      const flare = y > WATER_START - 70 ? (y - WATER_START + 70) >> 1 : 0;
      const w = hw + wave(y, 60, 7, seed + i) + flare;
      const lean = wave(y, 140, 12, seed + 50 + i);
      rect(t, cx + lean - w, y, cx + lean + w, y, 1);
    }
    const cap = hw + pick(g, 22, 44);
    const capTh = pick(g, 16, 24);
    const lean = wave(ty, 140, 12, seed + 50 + i);
    for (let dx = -cap; dx <= cap; dx++) column(t, cx + lean + dx, ty - 4, ty + capTh - Math.trunc((Math.abs(dx) * capTh) / (cap * 2)), 1);
    const ledges = pick(g, 1, 3);
    for (let k = 0, side = randInt(g, 2) ? 1 : -1; k < ledges; k++, side = -side) {
      const y = pick(g, ty + 70, WATER_START - 80);
      const len = pick(g, 30, 60);
      const at = cx + wave(y, 140, 12, seed + 50 + i) + side * (hw - 4);
      for (let u = 0; u <= len; u++) column(t, at + side * u, y, y + 14 + Math.trunc(((len - u) * 10) / len), 1);
    }
    tips.push([cx, ty, hw]);
  }
  const out = smooth(warp(t, 3, 16, seed + 3));
  for (let i = 0; i + 1 < tips.length; i++) {
    if (randInt(g, 100) >= 40) continue;
    const [ax, aty, ahw] = tips[i];
    const [bx, bty, bhw] = tips[i + 1];
    const y = Math.max(aty, bty) + pick(g, 40, 100);
    if (y > WATER_START - 90) continue;
    const a = ax + ahw - 10;
    const b = bx - bhw + 10;
    const hl = (b - a) >> 1;
    if (hl <= 0) continue;
    const sag = pick(g, 10, 26);
    for (let x = a; x <= b; x++) {
      const u = x - a - hl;
      const yy = y + Math.trunc((sag * (hl * hl - u * u)) / (hl * hl));
      column(out, x, yy, yy + 12 + Math.trunc((u * u * 6) / (hl * hl)), 1);
    }
  }
  // Windows through the thicker needles, low down: shots pass, slugs shelter.
  for (const [cx, ty, hw] of tips) if (hw > 26 && WATER_START - ty > 260 && randInt(g, 2)) tube(out, cx - 60, ty + 150, cx + 60, ty + 150, 13, 0);
  return seal(out);
}

/** Two headlands and one great arch between them, its underside a half-round from the water to the crown. */
function arch(seed: number): Uint8Array {
  const g = rng(seed, 7);
  const t = new Uint8Array(W * H);
  const hl = pick(g, 340, 460);
  const hr = pick(g, 340, 460);
  const topL = pick(g, 290, 350);
  const topR = pick(g, 290, 350);
  for (let x = 0; x < W; x++) {
    const left = x < W / 2;
    const s = left ? seed : seed + 1;
    const cliff = left ? hl - x : x - (W - 1 - hr);
    if (cliff < 0) continue;
    const head = (left ? topL : topR) + wave(x, 120, 22, s) + wave(x, 29, 5, s + 2);
    const outerEdge = left ? x : W - 1 - x;
    const drop = outerEdge < 70 ? Math.trunc(((70 - outerEdge) * (70 - outerEdge)) / 10) : 0;
    column(t, x, head + drop, H - 1, 1);
  }
  const a = hl - 80;
  const b = W - 1 - hr + 80;
  const half = (b - a) >> 1;
  const m = a + half;
  const deck = Math.min(topL, topR) - pick(g, 10, 40);
  const thick = pick(g, 50, 75);
  const rise = WATER_START + 30 - (deck + thick);
  for (let x = a; x <= b; x++) {
    const u = x - m;
    const crown = Math.trunc((26 * (half * half - u * u)) / (half * half));
    const upper = deck - crown + wave(x, 70, 10, seed + 3);
    const lower = WATER_START + 30 - Math.trunc((rise * isqrt(half * half - u * u)) / half);
    if (lower > upper) column(t, x, upper, lower, 1);
  }
  // A smaller window through the arch's shoulder.
  if (randInt(g, 2)) ellipse(t, m + (randInt(g, 2) ? 1 : -1) * Math.trunc((half * 2) / 3), deck + 40, pick(g, 22, 34), pick(g, 18, 26), 0);

  const stacks = pick(g, 2, 3);
  for (let k = 0; k < stacks; k++) {
    const x = a + 120 + Math.trunc(((b - a - 240) * (2 * k + 1)) / (2 * stacks)) + pick(g, -40, 40);
    const top = pick(g, 470, 560);
    const hw = pick(g, 20, 34);
    for (let y = top; y < H; y++) rect(t, x - hw - ((y - top) >> 3), y, x + hw + ((y - top) >> 3), y, 1);
  }
  // Sea caves in each headland's cliff, with a blowhole up to the top.
  for (const side of [-1, 1]) {
    const face = side < 0 ? hl : W - 1 - hr;
    const cy = pick(g, 470, 540);
    const depth = pick(g, 140, 220);
    tube(t, face + side * 20, cy, face - side * depth, cy - pick(g, 0, 40), pick(g, 26, 34), 0);
    const bx = face - side * (depth - 10);
    tube(t, bx, cy - 20, bx - side * pick(g, 10, 40), 200, 12, 0);
  }
  const land = smooth(warp(t, 5, 22, seed + 4));
  for (const side of [-1, 1]) {
    for (let k = 0; k < 2; k++) {
      const x = side < 0 ? pick(g, 90, hl - 140) : W - 1 - pick(g, 90, hr - 140);
      const y = surface(land, x);
      ellipse(land, x, y - 6, pick(g, 18, 30), pick(g, 14, 22), 1);
    }
  }
  return seal(land);
}

/** Low ground with ponds, and toadstools whose caps sit at three heights so there is always a roof or a perch near. */
function toadstools(seed: number): Uint8Array {
  const g = rng(seed, 8);
  const t = new Uint8Array(W * H);
  const ground = new Int32Array(W);
  const ponds = [pick(g, 380, 700), pick(g, 1220, 1540)];
  for (let x = 0; x < W; x++) {
    let y = 545 + wave(x, 150, 28, seed) + wave(x, 37, 6, seed + 1);
    for (const p of ponds) {
      const d = Math.abs(x - p);
      if (d < 110) y += Math.trunc(((110 - d) * (110 - d)) / 90);
    }
    const edge = Math.min(x, W - 1 - x);
    if (edge < 60) y += Math.trunc(((60 - edge) * (60 - edge)) / 20);
    ground[x] = y;
    column(t, x, y, H - 1, 1);
  }
  const n = pick(g, 8, 11);
  const slot = Math.trunc((W - 120) / n);
  const tiers = [[170, 240], [280, 350], [390, 450]];
  const caps: [number, number, number][] = [];
  let prevTier = -1;
  for (let i = 0; i < n; i++) {
    let tier = randInt(g, 3);
    if (tier === prevTier) tier = (tier + 1 + randInt(g, 2)) % 3;
    prevTier = tier;
    const bx = 60 + slot * i + (slot >> 1) + pick(g, -Math.trunc(slot / 4), Math.trunc(slot / 4));
    if (ponds.some((p) => Math.abs(bx - p) < 90)) continue;
    const capY = pick(g, tiers[tier][0], tiers[tier][1]);
    const gy = ground[bx];
    const lean = pick(g, -40, 40);
    const sw = pick(g, 9, 15);
    for (let y = capY; y <= gy + 10; y++) {
      const up = gy - y;
      const span = Math.max(1, gy - capY);
      const x = bx + Math.trunc((lean * up * up) / (span * span));
      const flare = up < 30 ? (30 - up) >> 1 : 0;
      rect(t, x - sw - flare, y, x + sw + flare, y, 1);
    }
    const cx = bx + lean;
    const r = pick(g, 60, 120);
    const dome = pick(g, 22, 38);
    for (let dx = -r; dx <= r; dx++) {
      const q = isqrt(r * r - dx * dx);
      const top = capY - Math.trunc((dome * q) / r);
      const bottom = capY + 10 - Math.trunc((8 * q) / r) + (r - q > r - 8 ? 4 : 0);
      column(t, cx + dx, top, bottom, 1);
    }
    caps.push([cx, capY, r]);
    // Bracket fungi on taller stalks, as steps up.
    if (gy - capY > 170) {
      const y = capY + pick(g, 70, gy - capY - 60);
      const up = gy - y;
      const at = bx + Math.trunc((lean * up * up) / ((gy - capY) * (gy - capY)));
      const side = randInt(g, 2) ? 1 : -1;
      const len = pick(g, 26, 44);
      for (let u = 0; u <= len; u++) column(t, at + side * (sw - 2 + u), y, y + 6 + Math.trunc(((len - u) * 8) / len), 1);
    }
  }
  const small = pick(g, 5, 9);
  for (let k = 0; k < small; k++) {
    const x = pick(g, 80, W - 80);
    if (ponds.some((p) => Math.abs(x - p) < 120)) continue;
    const h = pick(g, 24, 56);
    const gy = ground[x];
    rect(t, x - 5, gy - h, x + 5, gy + 4, 1);
    const r = pick(g, 18, 32);
    for (let dx = -r; dx <= r; dx++) {
      const q = isqrt(r * r - dx * dx);
      column(t, x + dx, gy - h - Math.trunc((12 * q) / r), gy - h + 6, 1);
    }
  }
  return seal(smooth(warp(t, 2, 18, seed + 2)));
}

/**
 * The hull is a cut-away in side view: a steel shell with decks and
 * bulkheads inside, so its holds are rooms to stand in. Tilt is a vertical
 * shear, which reads as a ship listing without any rotation.
 */
function hull(t: Uint8Array, g: Rng, x0: number, len: number, keelY: number, tilt: number, bowRight: boolean, seed: number): void {
  const at = (u: number) => (bowRight ? x0 + u : x0 + len - u);
  const shear = (u: number) => Math.trunc((u * tilt) / 100);
  const depth = pick(g, 120, 150);
  const bowRun = pick(g, 120, 170);
  const decks = [0, pick(g, 50, 64)];
  for (let u = 0; u <= len; u++) {
    const x = at(u);
    const s = shear(u);
    const toBow = Math.max(0, u - (len - bowRun));
    const keel = keelY + s - Math.trunc((toBow * toBow * (depth - 30)) / (bowRun * bowRun));
    const deck = keelY - depth + s - Math.trunc((u * u * 30) / (len * len));
    // Ragged teeth where the ship broke.
    const broken = u < 20 ? hash(u >> 2, 3, seed) % 60 : 0;
    if (keel - deck < 20) continue;
    column(t, x, deck + broken, keel, GIRDER);
    if (u > 6 && u < len - 8 && keel - 9 > deck + 7) {
      column(t, x, deck + 7 + broken, keel - 9, 0);
      // Sand washed into the bottom of the hold gives the lower deck a floor to fight on.
      column(t, x, keel - 9 - Math.trunc(((keel - deck) * 22) / 100) - wave(u, 40, 8, seed + 2), keel - 9, 1);
    }
    for (const d of decks.slice(1)) if (deck + d + 6 < keel - 12 && u > 10) column(t, x, deck + d, deck + d + 5, GIRDER);
  }
  // Bulkheads with doorways at floor level, and portholes in the shell.
  for (let u = 110; u < len - bowRun; u += pick(g, 100, 130)) {
    const x = at(u);
    const deck = keelY - depth + shear(u) - Math.trunc((u * u * 30) / (len * len));
    rect(t, x - 3, deck, x + 3, keelY + shear(u) - 6, GIRDER);
    rect(t, x - 3, deck + decks[1] - 32, x + 3, deck + decks[1] - 1, 0);
    rect(t, x - 3, keelY + shear(u) - 40, x + 3, keelY + shear(u) - 10, 0);
  }
  for (let u = 40; u < len - 40; u += 58) {
    const x = at(u);
    const deck = keelY - depth + shear(u) - Math.trunc((u * u * 30) / (len * len));
    ellipse(t, x, deck + decks[1] - 20, 9, 9, 0);
  }
}

function wreck(seed: number): Uint8Array {
  const g = rng(seed, 9);
  const t = new Uint8Array(W * H);
  const bankL = pick(g, 380, 480);
  const bankR = pick(g, 380, 480);
  for (let x = 0; x < W; x++) {
    const fromL = bankL - x;
    const fromR = x - (W - 1 - bankR);
    let y = H;
    if (fromL > -180) y = 520 + wave(x, 90, 16, seed) + (fromL < 0 ? Math.trunc((fromL * fromL) / 220) : 0);
    if (fromR > -180) y = Math.min(y, 505 + wave(x, 90, 16, seed + 1) + (fromR < 0 ? Math.trunc((fromR * fromR) / 220) : 0));
    const edge = Math.min(x, W - 1 - x);
    if (edge < 50) y += Math.trunc(((50 - edge) * (50 - edge)) / 12);
    // Reef rocks the hulls rest on, just under the surface.
    const reef = WATER_START - 20 + wave(x, 60, 30, seed + 2);
    column(t, x, Math.min(y, reef + 30), H - 1, 1);
  }
  const land = smooth(warp(t, 4, 20, seed + 3));

  const gap = pick(g, 60, 110);
  const bowLen = pick(g, 460, 560);
  const sternLen = pick(g, 420, 500);
  const bowX = bankL - pick(g, 60, 130);
  const sternX = bowX + bowLen + gap;
  // The bow half lies on the left bank, nose up; the stern half has settled lower to the right.
  hull(land, g, bowX, bowLen, pick(g, 560, 590), pick(g, -14, -8), false, seed + 10);
  hull(land, g, sternX, sternLen, pick(g, 600, 640), pick(g, 4, 9), true, seed + 11);

  // Deckhouse and funnel on the stern half, the mast and crow's nest on the bow half.
  const hx = sternX + pick(g, 120, 220);
  const deckAt = (x: number) => surface(land, x, 300);
  const hy = deckAt(hx);
  const hw = pick(g, 90, 120);
  rect(land, hx, hy - 70, hx + hw, hy, GIRDER);
  rect(land, hx + 6, hy - 64, hx + hw - 6, hy - 6, 0);
  for (let wx = hx + 14; wx + 18 < hx + hw; wx += 30) rect(land, wx, hy - 52, wx + 14, hy - 40, 0);
  rect(land, hx + hw - 6, hy - 30, hx + hw, hy - 6, 0);
  rect(land, hx - 4, hy - 76, hx + hw + 4, hy - 70, GIRDER);
  const fx = hx + (hw >> 1);
  rect(land, fx - 16, hy - 150, fx + 16, hy - 76, GIRDER);
  rect(land, fx - 10, hy - 144, fx + 10, hy - 76, 0);

  const mx = bowX + Math.trunc(bowLen / 3);
  const my = deckAt(mx);
  const mastH = pick(g, 170, 230);
  rect(land, mx - 3, my - mastH, mx + 3, my, GIRDER);
  rect(land, mx - 26, my - mastH + 40, mx + 26, my - mastH + 45, GIRDER);
  rect(land, mx - 26, my - mastH + 26, mx - 22, my - mastH + 40, GIRDER);
  rect(land, mx + 22, my - mastH + 26, mx + 26, my - mastH + 40, GIRDER);
  rect(land, mx - 50, my - mastH + 100, mx + 50, my - mastH + 104, GIRDER);

  // Rocks on the banks to hide behind.
  for (let k = 0; k < 4; k++) {
    const x = k < 2 ? pick(g, 70, bankL - 120) : W - 1 - pick(g, 70, bankR - 60);
    if (solid(land, x, 380)) continue;
    const y = surface(land, x, 300);
    ellipse(land, x, y - 4, pick(g, 18, 34), pick(g, 14, 24), 1);
  }
  return seal(land);
}

/** A cone with a crater. Lava tubes wander down from the crater floor and come out on the flanks. */
function volcano(seed: number): Uint8Array {
  const g = rng(seed, 10);
  const t = new Uint8Array(W * H);
  const c = (W >> 1) + pick(g, -120, 120);
  const rim = pick(g, 150, 195);
  const crater = pick(g, 120, 160);
  const floorY = rim + pick(g, 120, 160);
  const reachL = c - pick(g, 80, 140);
  const reachR = W - 1 - pick(g, 80, 140) - c;
  for (let x = 0; x < W; x++) {
    const d = Math.abs(x - c);
    const reach = x < c ? reachL : reachR;
    let top: number;
    if (d < crater) {
      top = floorY - Math.trunc(((floorY - rim) * d * d) / (crater * crater));
    } else {
      const u = d - crater;
      const span = reach - crater;
      // Concave flanks: steep near the rim, flattening toward the sea.
      top = rim + Math.trunc((u * (WATER_START + 40 - rim)) / span) - Math.trunc((u * (span - u) * 220) / (span * span));
    }
    top += wave(x, 80, 12, seed + 1) + wave(x, 21, 4, seed + 2);
    column(t, x, top, H - 1, 1);
  }
  // A plug of cooled lava in the crater.
  if (randInt(g, 2)) ellipse(t, c, floorY, pick(g, 22, 34), pick(g, 26, 44), 1);

  // Each tube runs down and out, then carries on level until it breaks out of the flank, so none ends blind.
  const tubes = pick(g, 3, 4);
  for (let k = 0; k < tubes; k++) {
    const dir = k % 2 ? 1 : -1;
    let x = c + dir * pick(g, 50, crater - 30);
    let y = floorY - 10;
    const steps = pick(g, 2, 4);
    for (let step = 0; step < steps; step++) {
      const nx = x + dir * pick(g, 70, 130);
      const ny = Math.min(WATER_START - 70, y + pick(g, 40, 90));
      tube(t, x, y, nx, ny, 16, 0);
      if (step === 1) {
        ellipse(t, nx, ny, pick(g, 44, 60), 28, 0);
        rect(t, nx - 44, ny + 18, nx + 44, ny + 28, 1);
      }
      x = nx;
      y = ny;
    }
    // Scan from past the chamber's widest edge, or a tube ending in its chamber stops at once and is sealed.
    let out = x + dir * 64;
    while (out > 0 && out < W - 1 && solid(t, out, y - 20)) out += dir;
    rect(t, Math.min(x, out), y - 30, Math.max(x, out), y + 2, 0);
  }
  // Hardened flows jutting out of the flanks.
  const flows = pick(g, 3, 5);
  for (let k = 0; k < flows; k++) {
    const dir = k % 2 ? 1 : -1;
    const y = pick(g, 300, 520);
    let x = c;
    while (x > 0 && x < W - 1 && solid(t, x, y)) x += dir;
    const len = pick(g, 40, 80);
    for (let u = -20; u <= len; u++) column(t, x + dir * u, y, y + 12 + Math.trunc(((len - Math.max(0, u)) * 18) / len), 1);
  }
  // Cinder islets off the shore.
  for (const side of [-1, 1]) {
    if (!randInt(g, 3)) continue;
    const x = side < 0 ? pick(g, 60, Math.max(61, c - reachL + 30)) : W - 1 - pick(g, 60, Math.max(61, W - 1 - c - reachR + 30));
    const top = pick(g, 500, 560);
    const r = pick(g, 40, 60);
    for (let dx = -r - 50; dx <= r + 50; dx++) column(t, x + dx, top + Math.trunc((Math.max(0, Math.abs(dx) - (r >> 1)) * 100) / r), H - 1, 1);
  }
  return seal(smooth(warp(t, 4, 20, seed + 3)));
}

/** A chain of small islets, undercut by the waves, with the odd tall stack and one or two natural arches. */
function archipelago(seed: number): Uint8Array {
  const g = rng(seed, 11);
  const t = new Uint8Array(W * H);
  const isles: [number, number, number][] = [];
  for (let x = pick(g, 40, 90); x < W - 80; ) {
    const tall = randInt(g, 100) < 22;
    const hw = tall ? pick(g, 20, 34) : pick(g, 40, 90);
    const cx = x + hw;
    if (cx + hw > W - 30) break;
    const top = tall ? pick(g, 290, 400) : pick(g, 440, 555);
    // Rounded shoulders so the islets read as rocks, not blocks, over a flat
    // top a whole team can stand on. Each leans a little so the chain is not a
    // row of pillars.
    const r = tall ? 10 : pick(g, 14, 22);
    const lean = pick(g, -24, 24);
    const middleAt = (y: number) => cx + Math.trunc((lean * Math.max(0, WATER_START - y)) / 300);
    for (let y = top; y < H; y++) {
      const d = r - (y - top);
      const round = d > 0 ? r - isqrt(r * r - d * d) : 0;
      // The wave notch: narrowest just above the waterline, then the foot spreads out underwater.
      const notch = y > WATER_START - 34 && y < WATER_START + 6 ? Math.trunc((14 * (20 - Math.abs(y - WATER_START + 14))) / 20) : 0;
      const foot = y > WATER_START + 6 ? (y - WATER_START - 6) >> 1 : 0;
      const w = hw - round - notch + foot + wave(y, 30, 5, seed + cx);
      if (w > 0) rect(t, middleAt(y) - w, y, middleAt(y) + w, y, 1);
    }
    if (tall || WATER_START - top > 110) {
      // A shelf halfway down a stack or a high islet: a second floor to fight from.
      const y = top + ((WATER_START - top) >> 1);
      const side = randInt(g, 2) ? 1 : -1;
      const len = pick(g, 26, 44);
      const from = middleAt(y) + side * (hw - 6);
      rect(t, Math.min(from, from + side * len), y, Math.max(from, from + side * len), y + 12, 1);
    }
    isles.push([middleAt(top), top, hw]);
    x = cx + hw + pick(g, 34, 80);
  }
  const arches = pick(g, 1, 2);
  for (let k = 0; k < arches; k++) {
    const i = pick(g, 0, isles.length - 2);
    const [ax, at, ahw] = isles[i];
    const [bx, bt, bhw] = isles[i + 1];
    const y = Math.max(at, bt) + 10;
    if (y > WATER_START - 60) continue;
    const a = ax + ahw - 8;
    const b = bx - bhw + 8;
    const hl = (b - a) >> 1;
    if (hl <= 0) continue;
    for (let x = a; x <= b; x++) {
      const u = x - a - hl;
      column(t, x, y - Math.trunc((10 * (hl * hl - u * u)) / (hl * hl)), y + 14 + Math.trunc((u * u * 30) / (hl * hl)), 1);
    }
  }
  return seal(smooth(warp(t, 6, 22, seed + 2)));
}
