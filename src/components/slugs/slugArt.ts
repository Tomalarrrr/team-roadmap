// Everything Slugs draws that is not text or UI: the slugs, the land, the sky
// behind it, the things that fly. Plain Canvas 2D so the screen can turn the
// results into textures for whatever engine it uses.
//
// The land is computed per pixel from the mask by pure integer-hash noise, so
// the same seed gives the same picture on every machine (online players see one
// battlefield) and the colouring can be tested without a real canvas.

import type { CrateKind, Obj } from '../../slugsGameLogic';
import { THEMES, type DetailKind, type Theme, type ThemeId } from './slugThemes';

// Noise

export function hash3(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Smooth value noise in [0, 1] on a grid of `cell` px. */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell;
  const gy = y / cell;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  let fx = gx - ix;
  let fy = gy - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash3(ix, iy, seed) & 1023;
  const b = hash3(ix + 1, iy, seed) & 1023;
  const c = hash3(ix, iy + 1, seed) & 1023;
  const d = hash3(ix + 1, iy + 1, seed) & 1023;
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return (top + (bottom - top) * fy) / 1023;
}

interface NoiseCols {
  /** Lattice column of each px. */
  jx: Int32Array;
  /** Its smoothed fraction across that cell. */
  fx: Float64Array;
}

/** The column half of valueNoise for x = (X0 + i) / k, i < n: the same for every row, so worked out once. */
function noiseCols(X0: number, k: number, n: number, cell: number): NoiseCols {
  const jx = new Int32Array(n);
  const fx = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const gx = (X0 + i) / k / cell;
    jx[i] = Math.floor(gx);
    const f = gx - jx[i];
    fx[i] = f * f * (3 - 2 * f);
  }
  return { jx, fx };
}

/**
 * valueNoise(x, y, cell, seed) for the columns of `cols` (from noiseCols with the same
 * cell): the same numbers as calling it per pixel, with the lattice hashes worked out
 * once per cell rather than four times a pixel. The land at 2 px per world px leaned
 * on it to paint in time.
 */
function noiseRow(out: Float32Array, cols: NoiseCols, y: number, cell: number, seed: number): void {
  const gy = y / cell;
  const iy = Math.floor(gy);
  let fy = gy - iy;
  fy = fy * fy * (3 - 2 * fy);
  const { jx, fx } = cols;
  let ix = NaN;
  let top0 = 0;
  let top1 = 0;
  let bottom0 = 0;
  let bottom1 = 0;
  for (let i = 0; i < out.length; i++) {
    if (jx[i] !== ix) {
      ix = jx[i];
      top0 = hash3(ix, iy, seed) & 1023;
      top1 = hash3(ix + 1, iy, seed) & 1023;
      bottom0 = hash3(ix, iy + 1, seed) & 1023;
      bottom1 = hash3(ix + 1, iy + 1, seed) & 1023;
    }
    const top = top0 + (top1 - top0) * fx[i];
    const bottom = bottom0 + (bottom1 - bottom0) * fx[i];
    out[i] = (top + (bottom - top) * fy) / 1023;
  }
}

// Colour

type RGB = readonly [number, number, number];

const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

interface Palette {
  soil: readonly RGB[];
  speck: RGB;
  outline: RGB;
  crust: RGB;
  crustLight: RGB;
  crustDark: RGB;
  hang: RGB | null;
  accent: RGB;
  scorch: RGB;
  /** Body, shade and light of the pebbles in 'blotch' earth. */
  pebble: readonly [RGB, RGB, RGB];
  /** What soil facing the sun leans toward. */
  lit: RGB;
  details: { kind: DetailKind; weight: number; colors: readonly RGB[] }[];
  weightSum: number;
}

const toward = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];

/** Pebbles are the soil's own light tone drawn halfway to grey, so each theme's stones belong to its earth. */
function pebbleOf(soil: RGB[], outline: RGB): readonly [RGB, RGB, RGB] {
  const body = toward(soil[2], [150, 144, 134], 0.45);
  return [body, toward(soil[0], outline, 0.45), toward(body, [255, 250, 240], 0.35)];
}

const palettes = new Map<ThemeId, Palette>();

function paletteOf(id: ThemeId): Palette {
  let p = palettes.get(id);
  if (p) return p;
  const t: Theme = THEMES[id];
  p = {
    soil: t.soil.map(rgb),
    speck: rgb(t.speck),
    outline: rgb(t.outline),
    crust: rgb(t.crust),
    crustLight: rgb(t.crustLight),
    crustDark: rgb(t.crustDark),
    hang: t.hang ? rgb(t.hang) : null,
    accent: rgb(t.accent),
    scorch: rgb(t.scorch),
    pebble: pebbleOf(t.soil.map(rgb), rgb(t.outline)),
    lit: toward(rgb(t.soil[2]), [255, 246, 225], 0.5),
    details: t.details.map((d) => ({ kind: d.kind, weight: d.weight, colors: d.colors.map(rgb) })),
    weightSum: t.details.reduce((s, d) => s + d.weight, 0),
  };
  palettes.set(id, p);
  return p;
}

/** Girders and anything else the rules add to the land are steel, whatever the theme. The menus' wrecks are painted in it too. */
export const STEEL_BODY = '#7f878e';
const STEEL = { body: rgb(STEEL_BODY), light: rgb('#adb4ba'), dark: rgb('#4b5157'), outline: rgb('#1f2226') };

// Edge distance

/** Chamfer steps in thirds of a pixel; distances stop growing at CAP (11 px). */
const CAP = 33;
/** How far outside a rectangle the land must be read to get its edge distances right. */
const MARGIN = 12;

/** Two-pass 3-4 chamfer, in place: solid cells start at the cap, air at 0, and the grid's outer ring is never written. */
export function chamfer(g: Uint8Array, gw: number, gh: number): void {
  for (let gy = 1; gy < gh - 1; gy++) {
    for (let gx = 1; gx < gw - 1; gx++) {
      const i = gy * gw + gx;
      let v = g[i];
      if (v === 0) continue;
      v = Math.min(v, g[i - 1] + 3, g[i - gw] + 3, g[i - gw - 1] + 4, g[i - gw + 1] + 4);
      g[i] = v;
    }
  }
  for (let gy = gh - 2; gy >= 1; gy--) {
    for (let gx = gw - 2; gx >= 1; gx--) {
      const i = gy * gw + gx;
      let v = g[i];
      if (v === 0) continue;
      v = Math.min(v, g[i + 1] + 3, g[i + gw] + 3, g[i + gw + 1] + 4, g[i + gw - 1] + 4);
      g[i] = v;
    }
  }
}

// Buried details

interface Detail {
  kind: DetailKind;
  x: number;
  y: number;
  /** Half-length along the detail's own axis (roots: full length from the base). */
  len: number;
  /** Half-thickness. */
  r: number;
  cos: number;
  sin: number;
  phase: number;
  colors: readonly RGB[];
}

interface DetailGrid {
  bw: number;
  cells: (Detail[] | undefined)[];
}

const DETAIL_CELL = 34;
const BUCKET = 32;
const detailCache = new Map<string, DetailGrid>();

function frac(h: number, shift: number): number {
  return ((h >>> shift) & 255) / 255;
}

function detailsFor(theme: ThemeId, seed: number, w: number, h: number): DetailGrid {
  const key = `${theme}|${seed}|${w}|${h}`;
  const hit = detailCache.get(key);
  if (hit) return hit;
  const pal = paletteOf(theme);
  const chance = THEMES[theme].detailChance;
  const bw = Math.ceil(w / BUCKET);
  const grid: DetailGrid = { bw, cells: new Array(bw * Math.ceil(h / BUCKET)) };
  const add = (d: Detail) => {
    const reach = d.kind === 'root' ? d.len + d.r + 1 : Math.max(d.len, d.r) + 1;
    const bx0 = Math.max(0, Math.floor((d.x - reach) / BUCKET));
    const bx1 = Math.min(bw - 1, Math.floor((d.x + reach) / BUCKET));
    const by0 = Math.max(0, Math.floor((d.y - reach) / BUCKET));
    const by1 = Math.min(Math.ceil(h / BUCKET) - 1, Math.floor((d.y + reach) / BUCKET));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const i = by * bw + bx;
        (grid.cells[i] ??= []).push(d);
      }
    }
  };
  const crystal = pal.details.find((d) => d.kind === 'crystal');
  for (let cy = 0; cy * DETAIL_CELL < h; cy++) {
    for (let cx = 0; cx * DETAIL_CELL < w; cx++) {
      const a = hash3(cx, cy, seed ^ 0x51ed);
      // Crystals grow in veins, a wandering line a cell or so wide, and nowhere else:
      // scattered evenly they read as noise.
      const vein = crystal !== undefined && Math.abs(valueNoise(cx * DETAIL_CELL, cy * DETAIL_CELL, 170, seed + 31) - 0.5) < 0.045;
      if (!vein && a % 100 >= chance) continue;
      const b = hash3(cx, cy, seed + 77);
      let pick = (a >>> 8) % pal.weightSum;
      let spec = pal.details[0];
      for (const d of pal.details) {
        if (pick < d.weight) {
          spec = d;
          break;
        }
        pick -= d.weight;
      }
      if (vein) {
        if (a % 100 >= 70) continue;
        spec = crystal;
      } else if (spec === crystal) continue;
      const x = cx * DETAIL_CELL + 4 + (b % (DETAIL_CELL - 8));
      const y = cy * DETAIL_CELL + 4 + ((b >>> 10) % (DETAIL_CELL - 8));
      const u = frac(b, 20);
      const v = frac(a, 16);
      const base = { kind: spec.kind, x, y, phase: v * 6.28, colors: spec.colors };
      const at = (angle: number) => ({ cos: Math.cos(angle), sin: Math.sin(angle) });
      switch (spec.kind) {
        case 'stone':
          add({ ...base, len: 2.6 + u * 3.6, r: 2 + v * 2.4, ...at((u - 0.5) * 0.8) });
          break;
        case 'crystal': {
          const n = 2 + (b & 1);
          const tilt = -Math.PI / 2 + (u - 0.5) * 1.4;
          for (let k = 0; k < n; k++) {
            const angle = tilt + (k - (n - 1) / 2) * 0.55;
            const len = 3.4 + frac(hash3(cx, cy + k, seed + 9), 4) * 3.4;
            add({ ...base, x: x + Math.cos(angle) * len * 0.8, y: y + Math.sin(angle) * len * 0.8, len, r: 1.4 + v * 0.9, ...at(angle) });
          }
          break;
        }
        case 'bone':
          add({ ...base, len: 3 + u * 2.6, r: 2 + v * 0.7, ...at(u * 6.28) });
          break;
        case 'root':
          add({ ...base, len: 10 + u * 13, r: 1.2 + v * 0.9, ...at(Math.PI / 2 + (u - 0.5) * 1.5) });
          break;
        case 'pipe':
          add({ ...base, len: 9 + u * 16, r: 2 + v * 1.2, ...at(b & 4 ? Math.PI / 2 : 0) });
          break;
        case 'shell':
          add({ ...base, len: 3 + u * 2.6, r: 3 + u * 2.6, ...at(v * 6.28) });
          break;
        case 'ember':
          add({ ...base, len: 3 + u * 4, r: 2 + v * 2, ...at((u - 0.5) * 0.6) });
          break;
        case 'gear':
          add({ ...base, len: 4 + u * 3, r: 4 + u * 3, ...at(v * 6.28) });
          break;
      }
    }
  }
  if (detailCache.size > 6) detailCache.delete(detailCache.keys().next().value!);
  detailCache.set(key, grid);
  return grid;
}

/** 0 for outside the detail, else 1 fill, 2 outline/shade, 3 highlight. */
function detailTone(d: Detail, x: number, y: number): number {
  const wx = x - d.x;
  const wy = y - d.y;
  const lx = wx * d.cos + wy * d.sin;
  const ly = -wx * d.sin + wy * d.cos;
  switch (d.kind) {
    case 'stone': {
      const e = (lx * lx) / (d.len * d.len) + (ly * ly) / (d.r * d.r);
      if (e > 1) return 0;
      if ((1 - Math.sqrt(e)) * Math.min(d.len, d.r) < 0.9) return 2;
      const hx = (wx + d.len * 0.3) / (d.len * 0.5);
      const hy = (wy + d.r * 0.35) / (d.r * 0.42);
      return hx * hx + hy * hy < 1 ? 3 : 1;
    }
    case 'crystal': {
      const ay = Math.abs(ly);
      const room = d.len - Math.abs(lx) - ay * 0.9;
      if (ay > d.r || room < 0) return 0;
      if (d.r - ay < 0.8 || room < 0.9) return 2;
      return ly < 0 ? 3 : 1;
    }
    case 'bone': {
      const shaft = Math.max(Math.abs(lx) - d.len, Math.abs(ly) - d.r * 0.5);
      const kx = Math.abs(lx) - d.len;
      const ky = Math.abs(ly) - d.r * 0.55;
      const knob = Math.sqrt(kx * kx + ky * ky) - d.r * 0.6;
      const sd = Math.min(shaft, knob);
      if (sd > 0) return 0;
      if (sd > -0.85) return 2;
      return ly < -d.r * 0.1 ? 3 : 1;
    }
    case 'root': {
      if (lx < 0 || lx > d.len) return 0;
      const off = Math.sin(lx * 0.33 + d.phase) * 1.5;
      const dy = Math.abs(ly - off);
      const t = d.r * (1 - (lx / d.len) * 0.7);
      if (dy > t) return 0;
      return dy > t - 0.8 ? 2 : 1;
    }
    case 'pipe': {
      const ay = Math.abs(ly);
      if (ay > d.r || Math.abs(lx) > d.len) return 0;
      if (d.r - ay < 0.9 || d.len - Math.abs(lx) < 1.4) return 2;
      if ((lx + d.len) % 9 < 1.3) return 2;
      return ly < -d.r + 2 ? 3 : 1;
    }
    case 'shell': {
      const rho = Math.sqrt(lx * lx + ly * ly);
      if (rho > d.r) return 0;
      if (rho > d.r - 0.9) return 2;
      const s = (rho / d.r) * 2.4 - Math.atan2(ly, lx) / (2 * Math.PI);
      if (s - Math.floor(s) < 0.24) return 2;
      return wy < 0 && rho < d.r * 0.6 ? 3 : 1;
    }
    case 'ember': {
      const e = (lx * lx) / (d.len * d.len) + (ly * ly) / (d.r * d.r) + ((hash3(x, y, 3) & 7) - 3.5) * 0.03;
      if (e > 1) return 0;
      if (e > 0.62) return 2;
      return e < 0.22 ? 3 : 1;
    }
    case 'gear': {
      const rho = Math.sqrt(lx * lx + ly * ly);
      const a = Math.atan2(ly, lx);
      const rim = Math.cos(a * 8) > 0.15 ? d.r : d.r * 0.76;
      if (rho > rim) return 0;
      const hole = d.r * 0.28;
      if (rho < hole) return 0;
      if (rim - rho < 0.9 || rho - hole < 0.9) return 2;
      return wy < -d.r * 0.2 ? 3 : 1;
    }
  }
}

// Land colouring

/** Pebbles in 'blotch' earth: at most one per cell of this many world px. */
const PEBBLE = 8;

/** Solid run lengths counted above and below a pixel stop at this, which is past any crust or shadow depth. */
const RUN_CAP = 18;

/** Radius, world px, of the box the land is averaged over to find which way its surface faces. */
const FACE_R = 5;
/** Where the light comes from: up and to the left, as a unit vector pointing at the sun. */
const SUN_X = -0.6;
const SUN_Y = -0.8;
/** Grass grows in tufts this many world px apart, each splaying out from its middle. */
const TUFT = 6;
/** Fine px a blade can lean sideways at its tip, so the land rectangle reads this far past its sides for grass. */
const LEAN = 4;

/**
 * RGBA for the rectangle [x0, x1) × [y0, y1) of the painted land, at k canvas px per
 * world px, so (x1 - x0) * k wide. Pure: no canvas, no randomness beyond the seed.
 * `scorch` (0 none, 1 bare, 2..255 burn strength, one per world px) comes from earlier
 * repaints; pass null for a first paint. Mask values: 0 air, 1 land, 2 girder (painted
 * as steel).
 *
 * Sizes (crust, grass, shading, outline, burn) are in world px whatever k is; the
 * grit, specks and grass tips use the finer pixel. At k = 2 the edge is also given
 * partial cover where the smooth outline of the mask (the half-way line of its
 * bilinear blend) cuts a canvas px, so the land's silhouette is antialiased rather
 * than stepped: each world px is several device px at the playing zooms.
 */
export function terrainPixels(
  mask: Uint8Array,
  w: number,
  h: number,
  theme: ThemeId,
  seed: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  scorch: Uint8Array | null,
  k: 1 | 2 = 1,
): Uint8ClampedArray<ArrayBuffer> {
  const th = THEMES[theme];
  const pal = paletteOf(theme);
  const rw = (x1 - x0) * k;
  const rh = (y1 - y0) * k;
  const out = new Uint8ClampedArray(rw * rh * 4);
  const details = detailsFor(theme, seed, w, h);

  // The fine mask covers the rectangle plus everything any pixel in it looks at: edge
  // distance reads MARGIN round it, runs RUN_CAP up and down, hangs and grass their length.
  const padY = Math.max(MARGIN, RUN_CAP + 1, th.hangLength, th.blades);
  const ex0 = Math.max(0, x0 - MARGIN);
  const ex1 = Math.min(w, x1 + MARGIN);
  const ey0 = Math.max(0, y0 - padY);
  const ey1 = Math.min(h, y1 + padY);
  const ew = ex1 - ex0;
  const eh = ey1 - ey0;
  const fw = ew * k;
  const fh = eh * k;
  const ox = (x0 - ex0) * k;
  const oy = (y0 - ey0) * k;
  const m = new Uint8Array(fw * fh);
  const field = k === 2 ? outlineField(mask, w, h, ex0, ey0, ew, eh) : null;
  if (field === null) {
    for (let fy = 0; fy < fh; fy++) m.set(mask.subarray((ey0 + fy) * w + ex0, (ey0 + fy) * w + ex1), fy * fw);
  } else {
    // Land where the smoothed field says so, so the outline, crust and shading all follow
    // the smooth edge rather than the mask's steps. A strand or spike one px thick, which
    // the blur would wipe out, is kept as the mask has it: a slug can stand on it.
    const air = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 0;
    for (let j = 0; j < eh; j++) {
      const y = ey0 + j;
      for (let i = 0; i < ew; i++) {
        const x = ex0 + i;
        const own = mask[y * w + x];
        const whole = field[(j + 1) * (ew + 2) + i + 1];
        const at = 2 * j * fw + 2 * i;
        // All land or all air for a px round: no edge near enough to move.
        if (whole === 0 || whole === 1) {
          m[at] = m[at + 1] = m[at + fw] = m[at + fw + 1] = own;
          continue;
        }
        const thin = own !== 0 && ((air(x, y - 1) && air(x, y + 1)) || (air(x - 1, y) && air(x + 1, y)));
        for (let q = 0; q < 4; q++) {
          const fx = 2 * i + (q & 1);
          const fy = 2 * j + (q >> 1);
          let v = thin ? own : 0;
          if (fineField(field, ew, fx, fy) >= 0.5) {
            const nx = Math.min(w - 1, Math.max(0, q & 1 ? x + 1 : x - 1));
            const ny = Math.min(h - 1, Math.max(0, q >> 1 ? y + 1 : y - 1));
            v = own || mask[y * w + nx] || mask[ny * w + x] || mask[ny * w + nx];
          }
          m[fy * fw + fx] = v;
        }
      }
    }
  }
  /** The world px under fine px (fx, fy) of the grid, for its burn. */
  const worldOf = (fx: number, fy: number) => (ey0 + Math.floor(fy / k)) * w + ex0 + Math.floor(fx / k);

  // Edge distance in thirds of a fine px over the whole fine grid, ringed with air.
  // The ring sits past MARGIN, so it is never nearer than the cap and changes nothing.
  const gw = fw + 2;
  const g = new Uint8Array(gw * (fh + 2));
  const cap = CAP * k;
  for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) if (m[fy * fw + fx] !== 0) g[(fy + 1) * gw + fx + 1] = cap;
  chamfer(g, gw, fh + 2);

  // Solid run above (up) and below (down) each pixel, in fine px, so top edges get a
  // crust and undersides a shadow; for air, how far up the nearest land is (255 for
  // none), so hangs need no search from every pixel of sky. Row by row, for the cache.
  const up = new Uint8Array(rw * rh);
  const down = new Uint8Array(rw * rh);
  const landAbove = new Uint8Array(rw * rh);
  {
    const run = new Uint8Array(rw);
    const gap = new Uint8Array(rw).fill(255);
    for (let fy = 0; fy < oy + rh; fy++) {
      const base = fy * fw + ox;
      const at = (fy - oy) * rw;
      for (let c = 0; c < rw; c++) {
        const solid = m[base + c] !== 0;
        run[c] = solid ? Math.min(run[c] + 1, 255) : 0;
        if (fy >= oy) {
          up[at + c] = run[c];
          landAbove[at + c] = gap[c];
        }
        gap[c] = solid ? 1 : Math.min(gap[c] + 1, 255);
      }
    }
    run.fill(0);
    for (let fy = fh - 1; fy >= oy; fy--) {
      const base = fy * fw + ox;
      const at = (fy - oy) * rw;
      for (let c = 0; c < rw; c++) {
        run[c] = m[base + c] !== 0 ? Math.min(run[c] + 1, 255) : 0;
        if (fy < oy + rh) down[at + c] = run[c];
      }
    }
  }

  // Which way the surface faces, per world px: the land averaged over a box round each
  // px (a summed-area table over the grid), differenced across it. Off the map the land
  // carries on, so the map's own edges get no false face.
  const sat = new Int32Array((ew + 1) * (eh + 1));
  for (let y = 0; y < eh; y++) {
    let rowSum = 0;
    for (let x = 0; x < ew; x++) {
      rowSum += mask[(ey0 + y) * w + ex0 + x] !== 0 ? 1 : 0;
      sat[(y + 1) * (ew + 1) + x + 1] = sat[y * (ew + 1) + x + 1] + rowSum;
    }
  }
  // Density over the rectangle and a one px ring, for the differences across it.
  const wrw = x1 - x0;
  const dw = wrw + 2;
  const dens = new Float32Array(dw * (y1 - y0 + 2));
  for (let y = y0 - 1; y <= y1; y++) {
    const ay = Math.max(0, y - FACE_R - ey0);
    const by = Math.min(eh, y + FACE_R + 1 - ey0);
    for (let x = x0 - 1; x <= x1; x++) {
      const ax = Math.max(0, x - FACE_R - ex0);
      const bx = Math.min(ew, x + FACE_R + 1 - ex0);
      const s = sat[by * (ew + 1) + bx] - sat[ay * (ew + 1) + bx] - sat[by * (ew + 1) + ax] + sat[ay * (ew + 1) + ax];
      dens[(y - y0 + 1) * dw + x - x0 + 1] = s / ((bx - ax) * (by - ay));
    }
  }
  const lit = new Float32Array(wrw * (y1 - y0));
  for (let y = 0; y < y1 - y0; y++) {
    for (let x = 0; x < wrw; x++) {
      const at = (y + 1) * dw + x + 1;
      // An outward normal is down the density slope; a straight edge gives a slope of 2 / (2 FACE_R + 1) across two px.
      const nx = -(dens[at + 1] - dens[at - 1]) * (FACE_R + 0.5);
      const ny = -(dens[at + dw] - dens[at - dw]) * (FACE_R + 0.5);
      lit[y * wrw + x] = nx * SUN_X + ny * SUN_Y;
    }
  }

  const s1 = seed + 101;
  const s2 = seed + 202;
  const s3 = seed + 303;
  const [o0, o1, o2] = pal.outline;
  const X0 = x0 * k;
  const Y0 = y0 * k;

  // Per-column shapes, worked out once per fine column rather than per pixel; lengths in fine px.
  const crustCol = new Int16Array(rw);
  const hangCol = new Int16Array(rw);
  const strataCol = new Float32Array(rw);
  for (let c = 0; c < rw; c++) {
    const X = X0 + c;
    const x = X / k;
    const xi = Math.floor(x);
    crustCol[c] = (th.crustDepth + ((hash3(xi, 3, seed) % 3) - 1)) * k + Math.round((valueNoise(x, 0, 17, seed + 5) - 0.5) * 3 * k);
    if (pal.hang) {
      const kk = hash3(X >> 1, 7, seed);
      if (kk % 100 < 20) hangCol[c] = (2 + ((kk >>> 8) % (th.hangLength - 1))) * k - (X & 1) * 2;
    }
    strataCol[c] = valueNoise(x, 0, 25, s2) * 0.8;
  }

  // The soil noise for one row at a time; which layers depends on the pattern.
  const nA = new Float32Array(rw);
  const nB = new Float32Array(rw);
  const nC = new Float32Array(rw);
  const cols = new Map<number, NoiseCols>();
  const colsOf = (cell: number) => {
    let c = cols.get(cell);
    if (!c) cols.set(cell, (c = noiseCols(X0, k, rw, cell)));
    return c;
  };
  // Hashes that stay the same along a stretch of the row (one soil layer, one pebble
  // cell, one cobble neighbourhood, a speck two fine px wide) are kept until it changes.
  let band = NaN;
  let bandTone = 0;
  let pcKey = NaN;
  let pebbleAt = false;
  let pebbleX = 0;
  let pebbleY = 0;
  let pebbleR = 0;
  let speckX = NaN;
  let speck = false;
  let cobKey = NaN;
  const cobX = new Float64Array(9);
  const cobY = new Float64Array(9);
  const cobH = new Uint32Array(9);
  for (let r = 0; r < rh; r++) {
    const Y = Y0 + r;
    const y = Y / k;
    const yi = Math.floor(y);
    if (th.pattern === 'blotch') {
      noiseRow(nA, colsOf(46), y, 46, s1);
      noiseRow(nB, colsOf(19), y, 19, s1 + 7);
      noiseRow(nC, colsOf(6), y, 6, s2);
    } else if (th.pattern === 'strata') {
      noiseRow(nA, colsOf(60), y, 60, s1);
      noiseRow(nB, colsOf(7), y, 7, s2);
    } else if (th.pattern === 'plates') {
      noiseRow(nA, colsOf(40), y, 40, s2);
      noiseRow(nB, colsOf(9), y, 9, s1);
    }
    for (let c = 0; c < rw; c++) {
      const X = X0 + c;
      const x = X / k;
      const xi = Math.floor(x);
      const f = (oy + r) * fw + ox + c;
      if (c === 0) {
        pcKey = NaN;
        speckX = NaN;
        cobKey = NaN;
      }
      const j = r * rw + c;
      const o = j * 4;
      const v0 = m[f];

      if (v0 === 0) {
        // Icicles, roots and drips under an overhang; grass is laid over the air afterwards.
        const ka = landAbove[j];
        if (pal.hang && ka <= hangCol[c]) {
          const above = f - ka * fw;
          if (!(scorch && scorch[worldOf(ox + c, oy + r - ka)] > 0) && m[above] !== 2) {
            const col = ka === hangCol[c] ? pal.outline : pal.hang;
            out[o] = col[0];
            out[o + 1] = col[1];
            out[o + 2] = col[2];
            out[o + 3] = 255;
          }
        }
        continue;
      }

      // Distances and runs back in world units: thirds of a world px, world px.
      const d = g[(oy + r + 1) * gw + ox + c + 1] / k;
      const uf = up[j];
      const dn = down[j] / k;
      out[o + 3] = 255;
      if (d <= 4) {
        const col = v0 === 2 ? STEEL.outline : pal.outline;
        out[o] = col[0];
        out[o + 1] = col[1];
        out[o + 2] = col[2];
        continue;
      }

      let red: number;
      let grn: number;
      let blu: number;
      if (v0 === 2) {
        const col = uf <= 2 * k ? STEEL.light : dn <= 2 ? STEEL.dark : (X + Y) % (11 * k) === 0 ? STEEL.dark : STEEL.body;
        out[o] = col[0];
        out[o + 1] = col[1];
        out[o + 2] = col[2];
        continue;
      }

      const burn = scorch === null ? 0 : scorch[yi * w + xi];
      const bare = burn > 0;
      const crust = !bare && uf <= crustCol[c];
      const face = lit[(yi - y0) * wrw + xi - x0];
      const sunny = face > 0 ? Math.min(1, face) : 0;
      let shadow = 0;
      if (crust) {
        const col = uf <= 3 * k ? pal.crustLight : uf === crustCol[c] ? pal.crustDark : pal.crust;
        red = col[0];
        grn = col[1];
        blu = col[2];
        if (d < 21) shadow = ((21 - d) / 21) * 0.12;
      } else {
        let col: RGB;
        let mix = 0;
        let mixTo: RGB = pal.accent;
        switch (th.pattern) {
          case 'blotch': {
            // Earth: soft layers that bend with the ground, blotched within each layer, thin
            // seams between them, pebbles lying flat and grit, so it reads as soil, not camouflage.
            const lay = y / 15 + nA[c] * 2.6 + strataCol[c] * 0.6;
            if (Math.floor(lay) !== band) {
              band = Math.floor(lay);
              bandTone = (hash3(band, 1, s3) % 3) * 0.17;
            }
            const n = bandTone + nB[c] * 0.5 + nC[c] * 0.16 + ((hash3(X, Y, s3) & 63) / 63 - 0.5) * 0.1;
            col = n < 0.4 ? pal.soil[0] : n < 0.6 ? pal.soil[1] : pal.soil[2];
            // A short ramp at each tone boundary, so the blotches read as soil rather than camouflage.
            const edge = n < 0.5 ? n - 0.4 : n - 0.6;
            if (edge > -0.035 && edge < 0.035) {
              mixTo = edge < 0 ? (n < 0.5 ? pal.soil[1] : pal.soil[2]) : n < 0.5 ? pal.soil[0] : pal.soil[1];
              mix = 0.5 - Math.abs(edge) / 0.07;
            }
            if (lay - band < 0.07) {
              mixTo = pal.accent;
              mix = 0.35;
            }
            const pcx = Math.floor(x / PEBBLE);
            if (pcx !== pcKey) {
              pcKey = pcx;
              const pcy = Math.floor(y / PEBBLE);
              const ph = hash3(pcx, pcy, s1 + 33);
              pebbleAt = ph % 100 < 30;
              pebbleR = 0.9 + frac(ph, 24) * 1.5;
              pebbleX = pcx * PEBBLE + 2 + frac(ph, 8) * (PEBBLE - 4);
              pebbleY = pcy * PEBBLE + 2 + frac(ph, 16) * (PEBBLE - 4);
            }
            if (pebbleAt) {
              const dx = (x - pebbleX) / (pebbleR * 1.4);
              const dy = (y - pebbleY) / pebbleR;
              const e = dx * dx + dy * dy;
              if (e < 1) {
                col = dy > 0 && e > 0.45 ? pal.pebble[1] : dy < -0.2 && e < 0.4 ? pal.pebble[2] : pal.pebble[0];
                mix = 0;
              }
            }
            break;
          }
          case 'strata': {
            const v = y / 9 + nA[c] * 2.2 + strataCol[c];
            const band = Math.floor(v);
            const tone = hash3(band, 0, s3) % 3;
            col = pal.soil[Math.min(2, tone + (nB[c] > 0.72 ? 1 : 0))];
            if (v - band < 0.13) mix = 0.45;
            break;
          }
          case 'cobble': {
            const C = 13;
            const gx = x / C;
            const gy = y / C;
            const cx = Math.floor(gx);
            const cy = Math.floor(gy);
            if (cx !== cobKey) {
              cobKey = cx;
              for (let i = 0; i < 9; i++) {
                const ccx = cx + (i % 3) - 1;
                const ccy = cy + Math.floor(i / 3) - 1;
                const hh = hash3(ccx, ccy, s1);
                cobH[i] = hh;
                cobX[i] = ccx + 0.1 + frac(hh, 0) * 0.8;
                cobY[i] = ccy + 0.1 + frac(hh, 8) * 0.8;
              }
            }
            let d1 = 9;
            let d2 = 9;
            let fy = 0;
            let cell = 0;
            for (let i = 0; i < 9; i++) {
              const px = cobX[i];
              const py = cobY[i];
              const dd = (px - gx) * (px - gx) + (py - gy) * (py - gy);
              if (dd < d1) {
                d2 = d1;
                d1 = dd;
                fy = py;
                cell = cobH[i];
              } else if (dd < d2) d2 = dd;
            }
            const seam = (Math.sqrt(d2) - Math.sqrt(d1)) * C;
            if (seam < 1.2) {
              col = pal.soil[0];
              mix = 0.25;
              mixTo = pal.outline;
            } else if ((gy - fy) * C < -C * 0.2 && seam > 2) col = pal.soil[2];
            else col = cell & 0x10000 ? pal.soil[1] : pal.soil[0];
            break;
          }
          case 'plates': {
            // Poured concrete: lifts a little wavy where each pour settled, form-tie holes
            // with rust run down from them, stains and grit. No vertical joints, so it
            // reads as cast, not bricks, whatever the island's outline.
            const PH = 26;
            const TIE = 34;
            const lift = (y + strataCol[c] * 4) / PH;
            const row = Math.floor(lift);
            const ly = (lift - row) * PH;
            const n = nA[c] * 0.7 + nB[c] * 0.3 + ((hash3(row, 3, s3) % 5) - 2) * 0.03;
            col = pal.soil[1];
            mixTo = n < 0.5 ? pal.soil[0] : pal.soil[2];
            mix = Math.min(0.85, Math.abs(n - 0.5) * 2.2);
            const tx = x + (row & 1) * (TIE / 2);
            const lx = tx - Math.floor(tx / TIE) * TIE - TIE / 2;
            const hy = ly - PH * 0.45;
            const hole = lx * lx + hy * hy;
            const grit = hash3(Math.floor(x), Math.floor(y), s3) % 100;
            if (ly < 1) {
              col = pal.soil[0];
              mixTo = pal.outline;
              mix = 0.4;
            } else if (ly < 2) {
              col = pal.soil[2];
              mix = 0;
            } else if (hole < 1.1) {
              col = pal.speck;
              mix = 0;
            } else if (hole < 2.6) {
              col = pal.soil[0];
              mix = 0;
            } else if (Math.abs(lx) < 0.9 && hy > 0) {
              const run = 3 + (hash3(Math.floor(tx / TIE), row, s1) % 9);
              if (hy < run) {
                mixTo = pal.accent;
                mix = 0.45 * (1 - hy / run);
              }
            } else if (grit < 3) {
              col = pal.speck;
              mix = 0.3;
              mixTo = pal.soil[0];
            } else if (grit < 5) {
              col = pal.soil[2];
              mix = 0;
            }
            break;
          }
        }
        red = col[0];
        grn = col[1];
        blu = col[2];
        if (mix > 0) {
          red += (mixTo[0] - red) * mix;
          grn += (mixTo[1] - grn) * mix;
          blu += (mixTo[2] - blu) * mix;
        }
        if (X >> 1 !== speckX) {
          speckX = X >> 1;
          speck = th.pattern !== 'plates' && hash3(speckX, Y, s2) % 1000 < 7;
        }
        if (speck) {
          red = pal.speck[0];
          grn = pal.speck[1];
          blu = pal.speck[2];
        }
        if (d >= 9) {
          const list = details.cells[(yi >> 5) * details.bw + (xi >> 5)];
          if (list) {
            for (const det of list) {
              const tone = detailTone(det, x, y);
              if (tone === 0) continue;
              const dc = det.colors[tone - 1];
              red = dc[0];
              grn = dc[1];
              blu = dc[2];
              break;
            }
          }
        }
        // Faces turned to the sun keep their colour up to the edge; the rest darken into it.
        if (d < 22) shadow = ((22 - d) / 22) * 0.42 * (1 - 0.8 * sunny);
        // The soil just under a grass crust sits in its shade.
        const under = uf - crustCol[c];
        if (!bare && under > 0 && under <= 3 * k) shadow += (1 - under / (3 * k + 1)) * 0.3;
      }
      if (d <= 8) shadow = Math.max(shadow, 0.5 * (1 - 0.6 * sunny));
      if (dn <= 6) shadow += ((7 - dn) / 7) * 0.3;
      if (face < 0) shadow += Math.min(1, -face) * 0.38;
      else if (face > 0) {
        const s = sunny * 0.3;
        red += (pal.lit[0] - red) * s;
        grn += (pal.lit[1] - grn) * s;
        blu += (pal.lit[2] - blu) * s;
      }
      if (shadow > 0) {
        if (shadow > 0.9) shadow = 0.9;
        red += (o0 - red) * shadow;
        grn += (o1 - grn) * shadow;
        blu += (o2 - blu) * shadow;
      }
      if (burn > 1) {
        // Solid char nearest the cut, then breaking up into flecks: a smooth fade read as
        // ordinary edge shading, and the crater as a clean bite rather than a blast.
        const s = burn > 150 ? 0.92 : (hash3(X, Y, s1 + 505) & 255) < burn ? 0.8 : (burn / 255) * 0.3;
        red += (pal.scorch[0] - red) * s;
        grn += (pal.scorch[1] - grn) * s;
        blu += (pal.scorch[2] - blu) * s;
      }
      out[o] = red;
      out[o + 1] = grn;
      out[o + 2] = blu;
    }
  }

  if (th.blades > 0) grass(out, m, fw, fh, ox, oy, rw, rh, X0, k, th.blades, pal, seed, scorch, worldOf);
  if (field !== null) smoothEdge(out, m, field, ew, fw, ox, oy, rw, rh, pal);
  return out;
}

/**
 * Lay grass over the air above every unburnt top edge, painted from each surface px up
 * rather than searched for from every px of sky. Blades come in tufts: long in the
 * middle of a tuft, short between, leaning out from its middle, so a tuft at a drop
 * hangs out over the edge. Columns up to LEAN past the rectangle are read, so a blade
 * leaning in from outside it is drawn the same in a repaint as in a full paint.
 */
function grass(
  out: Uint8ClampedArray,
  m: Uint8Array,
  fw: number,
  fh: number,
  ox: number,
  oy: number,
  rw: number,
  rh: number,
  X0: number,
  k: number,
  blades: number,
  pal: Palette,
  seed: number,
  scorch: Uint8Array | null,
  worldOf: (fx: number, fy: number) => number,
): void {
  const s3 = seed + 303;
  const most = blades * k + k;
  const c0 = Math.max(0, ox - LEAN);
  const c1 = Math.min(fw, ox + rw + LEAN);
  // Each fine column's blade, worked out once; then the grid is walked row by row, in memory order.
  const lenOf = new Uint8Array(c1 - c0);
  const leanOf = new Float32Array(c1 - c0);
  const shadeOf: RGB[] = [];
  for (let fx = c0; fx < c1; fx++) {
    const X = X0 + fx - ox;
    const x = X / k;
    const tuft = Math.floor(x / TUFT);
    const t = hash3(tuft, 5, seed + 11);
    const mid = (tuft + 0.25 + frac(t, 0) * 0.5) * TUFT;
    const along = (x - mid) / (TUFT * 0.5);
    // Long where the tuft is full, stubble between tufts; a hair of variation per fine column.
    const full = Math.max(0, 1 - along * along) * (0.55 + frac(t, 8) * 0.6);
    lenOf[fx - c0] = Math.max(0, Math.min(most, Math.round((0.6 + full) * blades * k * 0.8) + (hash3(X, 1, seed) & 1)));
    leanOf[fx - c0] = Math.max(-1, Math.min(1, along)) * 0.55;
    shadeOf.push(hash3(X, 1, s3) % 4 === 0 ? pal.crustDark : pal.crust);
  }
  for (let fy = Math.max(1, oy); fy < Math.min(fh, oy + rh + most + 1); fy++) {
    for (let fx = c0; fx < c1; fx++) {
      const base = fy * fw + fx;
      if (m[base] === 0 || m[base] === 2 || m[base - fw] !== 0) continue;
      const len = lenOf[fx - c0];
      if (len === 0) continue;
      if (scorch && scorch[worldOf(fx, fy)] > 0) continue;
      const lean = leanOf[fx - c0];
      const shade = shadeOf[fx - c0];
      for (let kk = 1; kk <= len; kk++) {
        const tx = fx + Math.round((lean * kk * kk) / len) - ox;
        const ty = fy - kk - oy;
        if (tx < 0 || tx >= rw || ty < 0 || ty >= rh) continue;
        if (m[(ty + oy) * fw + tx + ox] !== 0) break;
        const o = (ty * rw + tx) * 4;
        const col = kk === len ? pal.crustLight : shade;
        out[o] = col[0];
        out[o + 1] = col[1];
        out[o + 2] = col[2];
        out[o + 3] = 255;
      }
    }
  }
}

/**
 * The land's solid/air mask (1 for any solid) averaged over 3 × 3 world px, for the
 * world px [ex0 - 1, ex0 + ew + 1) × [ey0 - 1, ey0 + eh + 1), row by row. Off the map
 * the land carries on as it is at the edge. Its half-way line is the outline the land
 * is drawn to at 2 canvas px per world px: a slope's stair steps become a straight
 * edge, a straight edge stays where it was, a corner is rounded by about a px.
 */
function outlineField(mask: Uint8Array, w: number, h: number, ex0: number, ey0: number, ew: number, eh: number): Float32Array {
  const bw = ew + 2;
  const bh = eh + 2;
  const xs = new Int32Array(bw + 2);
  for (let i = 0; i < bw + 2; i++) xs[i] = Math.min(w - 1, Math.max(0, ex0 - 2 + i));
  const rows = new Uint8Array(bw * (bh + 2));
  for (let j = 0; j < bh + 2; j++) {
    const at = Math.min(h - 1, Math.max(0, ey0 - 2 + j)) * w;
    let a = mask[at + xs[0]] !== 0 ? 1 : 0;
    let b = mask[at + xs[1]] !== 0 ? 1 : 0;
    for (let i = 0; i < bw; i++) {
      const c = mask[at + xs[i + 2]] !== 0 ? 1 : 0;
      rows[j * bw + i] = a + b + c;
      a = b;
      b = c;
    }
  }
  const field = new Float32Array(bw * bh);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) field[j * bw + i] = (rows[j * bw + i] + rows[(j + 1) * bw + i] + rows[(j + 2) * bw + i]) / 9;
  return field;
}

/**
 * The field at fine px (fx, fy) of the grid at 2 canvas px per world px: the bilinear
 * blend of the four world px round its centre, a quarter px from its own.
 */
function fineField(field: Float32Array, ew: number, fx: number, fy: number): number {
  const bw = ew + 2;
  const at = ((fy >> 1) + 1) * bw + (fx >> 1) + 1;
  const sx = fx & 1 ? 1 : -1;
  const sy = fy & 1 ? bw : -bw;
  return (field[at] * 0.75 + field[at + sy] * 0.25) * 0.75 + (field[at + sx] * 0.75 + field[at + sx + sy] * 0.25) * 0.25;
}

/**
 * Partial cover for the canvas px the smooth outline cuts: each one's signed distance
 * to the field's half-way line, in canvas px, plus a half, clamped. Land px keep their
 * colour and lose a little alpha; air px that nothing else painted take the outline
 * colour at their cover. Px a canvas px and a half or more from the line are left alone, so
 * it costs the edge, not the area.
 */
function smoothEdge(out: Uint8ClampedArray, m: Uint8Array, field: Float32Array, ew: number, fw: number, ox: number, oy: number, rw: number, rh: number, pal: Palette): void {
  // Three rows of the field at fine px, one px wider each side, rolled down the region;
  // each is blended down from two world rows first, the same sums fineField makes.
  const sw = rw + 2;
  const rows = [new Float32Array(sw), new Float32Array(sw), new Float32Array(sw)];
  const bw = ew + 2;
  const wx0 = (ox - 1) >> 1;
  const across = new Float64Array(((ox + rw) >> 1) - wx0 + 3);
  const fill = (row: Float32Array, fy: number) => {
    const at = ((fy >> 1) + 1) * bw + 1;
    const sy = fy & 1 ? bw : -bw;
    for (let i = 0; i < across.length; i++) {
      const x = at + wx0 - 1 + i;
      across[i] = field[x] * 0.75 + field[x + sy] * 0.25;
    }
    for (let i = 0; i < sw; i++) {
      const fx = ox - 1 + i;
      const j = (fx >> 1) - wx0 + 1;
      row[i] = across[j] * 0.75 + across[fx & 1 ? j + 1 : j - 1] * 0.25;
    }
  };
  fill(rows[1], oy - 1);
  fill(rows[2], oy);
  for (let r = 0; r < rh; r++) {
    const fy = oy + r;
    const [above, here, below] = [rows[1], rows[2], rows[0]];
    fill(below, fy + 1);
    rows[0] = above;
    rows[1] = here;
    rows[2] = below;
    for (let c = 0; c < rw; c++) {
      const fx = ox + c;
      const f = here[c + 1];
      if (f === 0 || f === 1) continue;
      const gx = (here[c + 2] - here[c]) / 2;
      const gy = (below[c + 1] - above[c + 1]) / 2;
      const slope = Math.hypot(gx, gy);
      const off = f - 0.5;
      if (slope === 0 || Math.abs(off) >= slope * 1.5) continue;
      const cover = Math.max(0, Math.min(1, 0.5 + off / slope));
      const o = (r * rw + c) * 4;
      if (m[fy * fw + fx] !== 0) {
        // A one-px strand kept off the field stays solid.
        if (off >= 0 && out[o + 3] === 255) out[o + 3] = Math.round(255 * cover);
      } else if (out[o + 3] === 0 && cover > 0) {
        out[o] = pal.outline[0];
        out[o + 1] = pal.outline[1];
        out[o + 2] = pal.outline[2];
        out[o + 3] = Math.round(255 * cover);
      }
    }
  }
}

// Land canvases

/**
 * Canvas px per world px for the land: 2 so its outline and grit stay sharp at the
 * playing zooms, where the screen shows 3 to 8 device px per world px. The screen
 * passes 1 on its lean tier (an old laptop), a quarter of the pixels to fill.
 */
export const LAND_RES = 2;

interface LandMemory {
  /** The mask as last painted, so a repaint can tell what a blast just removed. */
  prev: Uint8Array;
  /** One per world px, whatever the canvas resolution. */
  scorch: Uint8Array;
  k: 1 | 2;
}

const land = new WeakMap<HTMLCanvasElement, LandMemory>();

/**
 * Paint the whole battlefield at k canvas px per world px. The returned canvas
 * remembers its mask for repaintArea. `before`, a canvas painted earlier for the
 * same map, carries its burns over and burns whatever has been cut since: a match
 * run again from the start hands over a new mask, and painted from nothing its
 * craters would grow grass.
 */
export function paintTerrain(mask: Uint8Array, w: number, h: number, theme: ThemeId, seed: number, before?: HTMLCanvasElement, k: 1 | 2 = 1): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = w * k;
  canvas.height = h * k;
  const old = before && land.get(before);
  const mem: LandMemory = old ? { prev: old.prev, scorch: old.scorch.slice(), k } : { prev: mask, scorch: new Uint8Array(w * h), k };
  if (old) markCuts(mem, mask, w, h, seed, 0, 0, w, h);
  const pixels = terrainPixels(mask, w, h, theme, seed, 0, 0, w, h, old ? mem.scorch : null, k);
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, w * k, h * k), 0, 0);
  land.set(canvas, { prev: mask.slice(), scorch: mem.scorch, k });
  return canvas;
}

/**
 * The land as it stood when the mask was `mask`, made from `from`, a canvas painted
 * for the same map since: a copy with only the box where the two masks differ painted
 * again. Burns within reach of land the later mask lost are dropped, so none shows
 * where a crater is still to come; an older burn in that reach goes with them. Much
 * cheaper than paintTerrain when little has changed, which is the replay's case.
 */
export function rewindTerrain(from: HTMLCanvasElement, mask: Uint8Array, w: number, h: number, theme: ThemeId, seed: number): HTMLCanvasElement {
  const old = land.get(from);
  if (!old) throw new Error('rewindTerrain: this canvas was not made by paintTerrain');
  const canvas = document.createElement('canvas');
  canvas.width = from.width;
  canvas.height = from.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(from, 0, 0);
  const mem: LandMemory = { prev: mask.slice(), scorch: old.scorch.slice(), k: old.k };
  land.set(canvas, mem);
  let bx0 = w;
  let by0 = h;
  let bx1 = 0;
  let by1 = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (old.prev[y * w + x] === mask[y * w + x]) continue;
      if (x < bx0) bx0 = x;
      if (x >= bx1) bx1 = x + 1;
      if (y < by0) by0 = y;
      by1 = y + 1;
    }
  }
  if (bx1 === 0) return canvas;
  // Cut later = solid in `mask`, gone from the painted one: the same test as markCuts with the two swapped.
  const reach = cutReach(mask, old.prev, w, h, bx0, by0, bx1, by1);
  if (reach) {
    const { g, ex0, ey0, ex1, ey1, ew } = reach;
    for (let y = ey0; y < ey1; y++) for (let x = ex0; x < ex1; x++) if (g[(y - ey0) * ew + x - ex0] <= RIM * 3) mem.scorch[y * w + x] = 0;
  }
  const rx0 = Math.max(0, bx0 - RIM);
  const ry0 = Math.max(0, by0 - RIM);
  const rx1 = Math.min(w, bx1 + RIM);
  const ry1 = Math.min(h, by1 + RIM);
  const k = old.k;
  ctx.putImageData(new ImageData(terrainPixels(mask, w, h, theme, seed, rx0, ry0, rx1, ry1, mem.scorch, k), (rx1 - rx0) * k, (ry1 - ry0) * k), rx0 * k, ry0 * k);
  return canvas;
}

/** A repaint grows the changed box by this much: the burnt rim, the edge shading and any grass all reach past the hole. */
const RIM = 12;
/** Burn fades out over this many px from a fresh cut; beyond it, up to RIM, the soil is only left bare (no grass regrows). */
const BURN = 9;

/**
 * Repaint after the mask changed inside the box (x0, y0)–(x1, y1), e.g. a crater's
 * bounding box. Pixels the mask lost since the last paint leave a burnt rim on the
 * land around them. Returns the world px box painted, for the screen to send on, or
 * null when the box is off the map.
 */
export function repaintArea(
  canvas: HTMLCanvasElement,
  mask: Uint8Array,
  w: number,
  h: number,
  theme: ThemeId,
  seed: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  const mem = land.get(canvas);
  if (!mem) throw new Error('repaintArea: this canvas was not made by paintTerrain');
  const rx0 = Math.max(0, Math.floor(Math.min(x0, x1)) - RIM);
  const ry0 = Math.max(0, Math.floor(Math.min(y0, y1)) - RIM);
  const rx1 = Math.min(w, Math.ceil(Math.max(x0, x1)) + RIM + 1);
  const ry1 = Math.min(h, Math.ceil(Math.max(y0, y1)) + RIM + 1);
  if (rx1 <= rx0 || ry1 <= ry0) return null;
  markCuts(mem, mask, w, h, seed, rx0, ry0, rx1, ry1);
  const k = mem.k;
  const pixels = terrainPixels(mask, w, h, theme, seed, rx0, ry0, rx1, ry1, mem.scorch, k);
  canvas.getContext('2d')!.putImageData(new ImageData(pixels, (rx1 - rx0) * k, (ry1 - ry0) * k), rx0 * k, ry0 * k);
  for (let y = ry0; y < ry1; y++) mem.prev.set(mask.subarray(y * w + rx0, y * w + rx1), y * w + rx0);
  return { x0: rx0, y0: ry0, x1: rx1, y1: ry1 };
}

/**
 * Up to `tries` colours (0xRRGGBB) of the land inside the circle (x, y, r) as it was
 * last painted, for the clods a blast throws. Worked out from the remembered mask, not
 * read back off the canvas: the first getImageData on the land canvas took 92 ms in
 * Chrome (measured on the effects bench), as it pulls the canvas off the GPU. Always
 * at one px per world px: a clod is a few px and only needs the soil's colour.
 */
export function dugColours(canvas: HTMLCanvasElement, w: number, h: number, theme: ThemeId, seed: number, x: number, y: number, r: number, tries: number): number[] {
  const mem = land.get(canvas);
  if (!mem) throw new Error('dugColours: this canvas was not made by paintTerrain');
  const out: number[] = [];
  for (let k = 0; k < tries; k++) {
    const a = Math.random() * TAU;
    const d = Math.sqrt(Math.random()) * r;
    const px = Math.round(x + Math.cos(a) * d);
    const py = Math.round(y + Math.sin(a) * d);
    if (px < 0 || py < 0 || px >= w || py >= h || mem.prev[py * w + px] === 0) continue;
    const c = terrainPixels(mem.prev, w, h, theme, seed, px, py, px + 1, py + 1, mem.scorch);
    out.push((c[0] << 16) | (c[1] << 8) | c[2]);
  }
  return out;
}

/**
 * Chamfer distance, in thirds of a px, from the pixels solid in `prev` and air in
 * `mask`, over the box grown by RIM; RIM * 3 + 3 means further than RIM. Null when
 * the box holds no such pixel.
 */
function cutReach(prev: Uint8Array, mask: Uint8Array, w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const reach = RIM;
  const ex0 = Math.max(0, x0 - reach);
  const ey0 = Math.max(0, y0 - reach);
  const ex1 = Math.min(w, x1 + reach);
  const ey1 = Math.min(h, y1 + reach);
  const ew = ex1 - ex0;
  const eh = ey1 - ey0;
  const far = reach * 3 + 3;
  const g = new Uint8Array(ew * eh).fill(far);
  let any = false;
  for (let y = ey0; y < ey1; y++) {
    for (let x = ex0; x < ex1; x++) {
      const i = y * w + x;
      if (prev[i] !== 0 && mask[i] === 0) {
        g[(y - ey0) * ew + x - ex0] = 0;
        any = true;
      }
    }
  }
  if (!any) return null;
  for (let y = 0; y < eh; y++) {
    for (let x = 0; x < ew; x++) {
      const i = y * ew + x;
      let v = g[i];
      if (x > 0) v = Math.min(v, g[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, g[i - ew] + 3);
        if (x > 0) v = Math.min(v, g[i - ew - 1] + 4);
        if (x < ew - 1) v = Math.min(v, g[i - ew + 1] + 4);
      }
      g[i] = v;
    }
  }
  for (let y = eh - 1; y >= 0; y--) {
    for (let x = ew - 1; x >= 0; x--) {
      const i = y * ew + x;
      let v = g[i];
      if (x < ew - 1) v = Math.min(v, g[i + 1] + 3);
      if (y < eh - 1) {
        v = Math.min(v, g[i + ew] + 3);
        if (x < ew - 1) v = Math.min(v, g[i + ew + 1] + 4);
        if (x > 0) v = Math.min(v, g[i + ew - 1] + 4);
      }
      g[i] = v;
    }
  }
  return { g, ex0, ey0, ex1, ey1, ew };
}

/** Burn the land next to pixels the mask lost. Girders do not burn. */
function markCuts(mem: LandMemory, mask: Uint8Array, w: number, h: number, seed: number, x0: number, y0: number, x1: number, y1: number): void {
  const reach = cutReach(mem.prev, mask, w, h, x0, y0, x1, y1);
  if (!reach) return;
  const { g, ex0, ey0, ew } = reach;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      // Air burns too: at 2 canvas px per world px the drawn edge rounds out a little into it.
      if (mask[i] === 2 || mask[i] === 3) continue;
      const dc = g[(y - ey0) * ew + x - ex0] / 3;
      if (dc > RIM) continue;
      let v = 1;
      if (dc < BURN) {
        const ragged = ((hash3(x, y, seed + 404) & 63) - 32) * 0.9;
        v = Math.max(2, Math.min(255, Math.round(255 * (1 - dc / BURN) + ragged)));
      }
      if (v > mem.scorch[i]) mem.scorch[i] = v;
    }
  }
}

export { paintBackground } from './slugBackdrop';

const TAU = Math.PI * 2;

// Slugs

export type SlugAnim = 'idle' | 'crawl' | 'jump' | 'fall' | 'hurt' | 'win' | 'dead' | 'drown' | 'aim';

export interface SlugPose {
  facing: 1 | -1;
  /** Degrees above horizontal, -90..90. */
  aim: number;
  /** ms, for idle motion and blinking. Offset it per slug so a team does not blink in step. */
  t: number;
  anim: SlugAnim;
  /** Walk cycle counter: one full stretch and squeeze every 18 counts (the rules' WALK_CYCLE length). */
  crawl: number;
  hat?: string;
  /** The team's colour, worn as a band round the neck. */
  band?: string;
  /** WeaponId. While set and the slug is idle or aiming, its lower feelers are left for drawHeldWeapon to draw round the grip. */
  weapon?: string;
}

/** One natural palette for every slug: teams are told apart by the neck band (SlugPose.band), hat and label. */
export const SLUG_COLOURS = {
  body: '#cf9d40',
  shade: '#a6772a',
  light: '#ecc874',
  mantle: '#c29a45',
  mantleShade: '#9c7530',
  fringe: '#f0dca6',
  speck: '#7a5620',
  outline: '#3a2814',
  eye: '#fffaf0',
  pupil: '#1b130a',
  mouth: '#5a2814',
} as const;

const C = SLUG_COLOURS;
const LINE = 0.95;

type EyeState = 'open' | 'blink' | 'shut' | 'happy' | 'wide' | 'sad';
type Mouth = 'smile' | 'open' | 'frown' | 'o';

interface Form {
  sy: number;
  sx: number;
  /** Sideways shift of the head, px, fading to nothing at the foot. */
  lean: number;
  tail: number;
  lift: number;
  dy: number;
  stalk: number;
  frontA: number;
  backA: number;
  eyes: EyeState;
  mouth: Mouth;
  lookX: number;
  lookY: number;
  breath: number;
  /** Under about 2.5 device px per world px the face is a few pixels wide: bigger eyes, no glint. */
  small: boolean;
}

const BLINK_EVERY = 3700;
const BLINK_MS = 130;

function formOf(p: SlugPose): Form {
  const t = p.t;
  const a = (p.aim * Math.PI) / 180;
  const blink = t % BLINK_EVERY < BLINK_MS || (t % (BLINK_EVERY * 3) > BLINK_MS * 2 && t % (BLINK_EVERY * 3) < BLINK_MS * 3);
  const breath = 0.5 + 0.5 * Math.sin(t / 700);
  const f: Form = {
    sy: 1 + 0.025 * breath,
    sx: 1,
    lean: 0,
    tail: 9.5,
    lift: 0,
    dy: 0,
    stalk: 4.7,
    frontA: 0.32 + 0.12 * Math.sin(t / 530),
    backA: 0.02 + 0.12 * Math.sin(t / 610 + 1),
    eyes: blink ? 'blink' : 'open',
    mouth: 'smile',
    lookX: Math.cos(a),
    lookY: -Math.sin(a),
    breath,
    small: false,
  };
  switch (p.anim) {
    case 'idle':
      break;
    case 'aim':
      f.lean = 0.3 - (p.aim / 90) * 0.9;
      f.frontA = 0.55 - (p.aim / 90) * 0.5 + 0.05 * Math.sin(t / 530);
      f.backA = 0.25 - (p.aim / 90) * 0.4 + 0.05 * Math.sin(t / 610);
      break;
    case 'crawl': {
      const ph = (p.crawl / 18) * TAU;
      const wv = Math.sin(ph);
      f.sy = 1 + 0.07 * wv;
      f.sx = 1 - 0.04 * wv;
      f.tail = 9.5 * (1 - 0.1 * wv);
      f.lean = 0.7 * Math.cos(ph);
      f.frontA = 0.4 + 0.15 * Math.sin(ph + 1);
      f.backA = 0.12 + 0.15 * Math.sin(ph + 1.6);
      f.lookX = 1;
      f.lookY = 0;
      break;
    }
    case 'jump':
      f.sy = 1.17;
      f.sx = 0.86;
      f.tail = 7;
      f.lift = 2;
      f.frontA = -0.35;
      f.backA = -0.6;
      f.stalk = 5;
      f.eyes = 'wide';
      f.mouth = 'o';
      f.lookX = 0.4;
      f.lookY = -0.9;
      break;
    case 'fall':
      f.eyes = 'wide';
      f.mouth = 'o';
      f.stalk = 2.4;
      f.lookX = 0;
      f.lookY = -1;
      break;
    case 'hurt':
      f.sy = 0.82;
      f.sx = 1.12;
      f.lean = -1;
      f.stalk = 1.6;
      f.frontA = 0.5;
      f.backA = 0.1;
      f.eyes = 'shut';
      f.mouth = 'frown';
      break;
    case 'win':
      f.lean = 1.3 * Math.sin(t / 140);
      f.sy = 1 + 0.05 * Math.sin(t / 70);
      f.frontA = 0.3 + 0.35 * Math.sin(t / 140 + 0.6);
      f.backA = -0.1 - 0.35 * Math.sin(t / 140 + 0.6);
      f.stalk = 5;
      f.eyes = 'happy';
      f.mouth = 'open';
      break;
    case 'dead':
      f.sy = 0.42;
      f.sx = 1.2;
      f.tail = 11;
      f.frontA = 2.0;
      f.backA = 1.75;
      f.stalk = 4.2;
      f.eyes = 'sad';
      f.mouth = 'frown';
      break;
    case 'drown':
      f.sy = 1.08;
      f.sx = 0.95;
      f.tail = 8;
      f.lift = 1.5;
      f.dy = Math.sin(t / 300) * 0.6;
      f.frontA = 0.06 + Math.sin(t / 45) * 0.06;
      f.backA = -0.06 - Math.sin(t / 45) * 0.06;
      f.stalk = 5.6;
      f.eyes = 'wide';
      f.mouth = 'o';
      f.lookX = 0;
      f.lookY = -1;
      break;
  }
  return f;
}

function strokeTwice(ctx: CanvasRenderingContext2D, path: Path2D, colour: string, inner: number): void {
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = inner + LINE * 1.7;
  ctx.stroke(path);
  ctx.strokeStyle = colour;
  ctx.lineWidth = inner;
  ctx.stroke(path);
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, f: Form): void {
  const r = (f.eyes === 'wide' ? 1.55 : 1.38) * (f.small ? 1.3 : 1);
  ctx.lineWidth = f.small ? 0.55 : 0.7;
  ctx.strokeStyle = C.outline;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  if (f.eyes === 'open' || f.eyes === 'wide') {
    ctx.fillStyle = C.eye;
    ctx.fill();
    ctx.stroke();
    const pr = (f.eyes === 'wide' ? 0.55 : 0.74) * (f.small ? 1.35 : 1);
    const px = x + f.lookX * (r - pr - 0.12);
    const py = y + f.lookY * (r - pr - 0.12);
    ctx.fillStyle = C.pupil;
    ctx.beginPath();
    ctx.arc(px, py, pr, 0, TAU);
    ctx.fill();
    if (f.small) return;
    ctx.fillStyle = C.eye;
    ctx.beginPath();
    ctx.arc(px - pr * 0.35, py - pr * 0.4, pr * 0.36, 0, TAU);
    ctx.fill();
    return;
  }
  ctx.fillStyle = C.light;
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  if (f.eyes === 'blink') {
    ctx.moveTo(x - r * 0.75, y + 0.1);
    ctx.lineTo(x + r * 0.75, y + 0.1);
  } else if (f.eyes === 'happy') {
    ctx.moveTo(x - r * 0.65, y + 0.35);
    ctx.quadraticCurveTo(x, y - 0.75, x + r * 0.65, y + 0.35);
  } else if (f.eyes === 'sad') {
    ctx.moveTo(x - r * 0.65, y - 0.2);
    ctx.quadraticCurveTo(x, y + 0.7, x + r * 0.65, y - 0.2);
  } else {
    ctx.moveTo(x - r * 0.6, y - 0.55);
    ctx.lineTo(x + r * 0.35, y);
    ctx.lineTo(x - r * 0.6, y + 0.55);
  }
  ctx.stroke();
}

function drawStalk(ctx: CanvasRenderingContext2D, bx: number, by: number, angle: number, f: Form, back: boolean): void {
  const tx = bx + Math.sin(angle) * f.stalk;
  const ty = by - Math.cos(angle) * f.stalk;
  const path = new Path2D();
  path.moveTo(bx, by + 0.6);
  path.quadraticCurveTo(bx + Math.sin(angle * 0.4) * f.stalk * 0.55, by - Math.cos(angle * 0.4) * f.stalk * 0.55, tx, ty);
  strokeTwice(ctx, path, back ? C.shade : C.body, 1.05);
  drawEye(ctx, tx, ty, f);
}

function drawMouth(ctx: CanvasRenderingContext2D, x: number, y: number, mouth: Mouth): void {
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  switch (mouth) {
    case 'smile':
      ctx.moveTo(x - 0.75, y - 0.25);
      ctx.quadraticCurveTo(x, y + 0.55, x + 0.7, y - 0.35);
      ctx.stroke();
      break;
    case 'frown':
      ctx.moveTo(x - 0.75, y + 0.3);
      ctx.quadraticCurveTo(x, y - 0.4, x + 0.7, y + 0.3);
      ctx.stroke();
      break;
    case 'open':
      ctx.moveTo(x - 0.95, y - 0.35);
      ctx.quadraticCurveTo(x, y - 0.15, x + 0.85, y - 0.45);
      ctx.quadraticCurveTo(x + 0.2, y + 1.3, x - 0.95, y - 0.35);
      ctx.fillStyle = C.mouth;
      ctx.fill();
      ctx.stroke();
      break;
    case 'o':
      ctx.ellipse(x, y, 0.45, 0.6, 0, 0, TAU);
      ctx.fillStyle = C.mouth;
      ctx.fill();
      break;
  }
}

/** Tapered and only a little longer than it is wide at the root, so it reads as a tentacle rather than an arm. */
function drawFeeler(ctx: CanvasRenderingContext2D, bx: number, by: number, tx: number, ty: number): void {
  const dx = tx - bx;
  const dy = ty - by;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const path = new Path2D();
  path.moveTo(bx + nx * 0.6, by + ny * 0.6);
  path.quadraticCurveTo(bx + dx * 0.55 + nx * 0.4, by + dy * 0.55 + ny * 0.4, tx + nx * 0.22, ty + ny * 0.22);
  path.arc(tx, ty, 0.22, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI, true);
  path.quadraticCurveTo(bx + dx * 0.55 - nx * 0.4, by + dy * 0.55 - ny * 0.4, bx - nx * 0.6, by - ny * 0.6);
  ctx.fillStyle = C.body;
  ctx.fill(path);
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.45;
  ctx.stroke(path);
}

const SPECKS: readonly (readonly [number, number, number])[] = [
  [-6.2, 6.4, 0.42],
  [-4.2, 5.5, 0.5],
  [-1.2, 6.6, 0.38],
  [2.6, 1.6, 0.42],
  [3.4, -2.6, 0.34],
  [1.2, 4.4, 0.48],
  [0.2, -4.6, 0.36],
];

/** Lower feelers are left off while a weapon is held; drawHeldWeapon draws them gripping it. */
const holding = (p: SlugPose) => p.weapon !== undefined && (p.anim === 'aim' || p.anim === 'idle');

/**
 * One slug centred on the origin, feet at y = +8, in world px (the rules' box is
 * 9 × 16). Vector drawing, so the caller may scale the context for zoom.
 */
export function drawSlug(ctx: CanvasRenderingContext2D, pose: SlugPose): void {
  const f = formOf(pose);
  const m = ctx.getTransform();
  f.small = Math.hypot(m.a, m.b) < 2.5;
  ctx.save();
  ctx.scale(pose.facing, 1);
  ctx.translate(0, f.dy);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (pose.anim === 'fall') drawCurled(ctx, pose, f);
  else drawUpright(ctx, pose, f);
  ctx.restore();
}

function drawUpright(ctx: CanvasRenderingContext2D, pose: SlugPose, f: Form): void {
  const X = (x: number, y: number) => x * f.sx + (f.lean * (8 - y)) / 14.7;
  const Y = (y: number) => 8 - (8 - y) * f.sy;
  const P = (x: number, y: number): [number, number] => [X(x, y), Y(y)];
  const tl = f.tail;
  const lift = f.lift;

  // One line from the tail tip up the back and over the head, then a chest that bellies a little and a foot that
  // spreads where it meets the ground: a straight back and a straight front made it read as a boot.
  const body = new Path2D();
  body.moveTo(-tl * f.sx, 7.5 - lift);
  body.bezierCurveTo(-tl * 0.7 * f.sx, 7.2 - lift * 0.8, ...P(-6.2, 6.3), ...P(-4.9, 3.9));
  body.bezierCurveTo(...P(-4.1, 2.3), ...P(-4.7, -4.4), ...P(-2.2, -6.2));
  body.bezierCurveTo(...P(-0.4, -7.5), ...P(3.4, -7.4), ...P(4.6, -4.6));
  body.bezierCurveTo(...P(5.3, -3.0), ...P(5.2, 0.8), ...P(4.8, 3.4));
  body.bezierCurveTo(...P(4.6, 5.0), ...P(4.8, 7.0), 5.2 * f.sx, 8);
  body.lineTo(-tl * 0.55 * f.sx, 8);
  body.quadraticCurveTo(-tl * 0.95 * f.sx, 8, -tl * f.sx, 7.5 - lift);
  body.closePath();

  const frontBase = P(1.9, -6.5);
  const backBase = P(0.2, -6.6);

  drawStalk(ctx, backBase[0], backBase[1], f.backA, f, true);

  ctx.fillStyle = C.shade;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.translate(0.75, -0.65);
  ctx.fillStyle = C.body;
  ctx.fill(body);
  ctx.translate(-0.75, 0.65);
  // Roundness: light pooling where the head turns to the light, and the underside dimming toward the ground.
  const [lx, ly] = P(2.4, -4.4);
  const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 7.5);
  glow.addColorStop(0, 'rgba(255,236,176,0.6)');
  glow.addColorStop(1, 'rgba(255,236,176,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-tl - 2, -10, tl + 10, 20);
  const under = ctx.createLinearGradient(0, 3, 0, 8);
  under.addColorStop(0, 'rgba(58,40,20,0)');
  under.addColorStop(1, 'rgba(58,40,20,0.22)');
  ctx.fillStyle = under;
  ctx.fillRect(-tl - 2, 3, tl + 10, 5);
  ctx.fillStyle = C.speck;
  ctx.globalAlpha = 0.55;
  for (const [sx, sy, sr] of SPECKS) {
    const [x, y] = P(sx * (sx < -3 ? tl / 9.5 : 1), sy);
    ctx.beginPath();
    ctx.ellipse(x, y, sr * f.sx, sr * f.sy, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Mantle: the saddle over the back behind the head. Cut by the body's own outline, it lies on the back
  // rather than sitting on the side as a shield.
  const [mx, my] = P(-3.4, -2.4);
  const mantle = new Path2D();
  mantle.ellipse(mx, my, 3.7 * f.sx, 4.0 * f.sy, -0.2, 0, TAU);
  ctx.save();
  ctx.clip(mantle);
  ctx.fillStyle = C.mantleShade;
  ctx.fill(mantle);
  ctx.fillStyle = C.mantle;
  ctx.beginPath();
  ctx.ellipse(mx + 0.55, my - 0.5, 3.7 * f.sx, 4.0 * f.sy, -0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = glow;
  ctx.fillRect(mx - 4, my - 5, 8, 10);
  // One fine ridge following the front edge, as a real mantle has: more of them made it a snail's shell.
  ctx.strokeStyle = C.mantleShade;
  ctx.lineWidth = 0.3;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  ctx.ellipse(mx + 0.2, my, 3.7 * 0.7 * f.sx, 4.0 * 0.7 * f.sy, -0.2, -1.2, 1.1);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
  // A fold of skin, not a separate part: a lighter line than the body's.
  ctx.strokeStyle = C.outline;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = LINE * 0.45;
  ctx.stroke(mantle);
  ctx.globalAlpha = 1;
  // The breathing pore sits on the mantle's rim, as a slug's does: inside it, it read as a third eye.
  const pore = 0.2 + 0.22 * f.breath;
  ctx.fillStyle = C.outline;
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.ellipse(mx + 2.7 * f.sx, my + 2.5 * f.sy, pore, pore * 0.75, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = C.fringe;
  ctx.fillRect(-tl - 2, 8 - 1.15 * Math.min(1, f.sy + 0.2), tl + 9, 2);
  ctx.strokeStyle = C.shade;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 0.3;
  const ripple = pose.anim === 'crawl' ? (pose.crawl / 18) * 1.4 : 0;
  ctx.beginPath();
  for (let x = -tl + ((ripple % 1.4) + 1.4) % 1.4; x < 6; x += 1.4) {
    ctx.moveTo(x, 7.05);
    ctx.lineTo(x - 0.3, 8);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (pose.band) {
    // Below the mouth and feelers, dipping a little toward the back as a collar round a rounded neck would.
    const band = new Path2D();
    band.moveTo(...P(-6, 1.5));
    band.lineTo(...P(6, 0.6));
    band.lineTo(...P(6, 2.5));
    band.lineTo(...P(-6, 3.4));
    band.closePath();
    ctx.fillStyle = pose.band;
    ctx.fill(band);
    ctx.fillStyle = 'rgba(42,28,18,0.28)';
    ctx.beginPath();
    ctx.moveTo(...P(-6, 2.7));
    ctx.lineTo(...P(6, 1.8));
    ctx.lineTo(...P(6, 2.5));
    ctx.lineTo(...P(-6, 3.4));
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 0.45;
    ctx.stroke(band);
  }
  ctx.strokeStyle = 'rgba(255,250,235,0.7)';
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  ctx.moveTo(-tl * 0.72 * f.sx, 6.6 - lift * 0.8);
  ctx.bezierCurveTo(-tl * 0.5 * f.sx, 6.1 - lift * 0.6, ...P(-4.9, 4.7), ...P(-4.0, 3.2));
  ctx.stroke();
  // Wet skin: a hard highlight on the crown where the light catches it, and a thinner one down the chest.
  ctx.fillStyle = 'rgba(255,253,245,0.9)';
  const [gx, gy] = P(3.55, -4.55);
  ctx.beginPath();
  ctx.ellipse(gx, gy, 0.95 * f.sx, 0.45 * f.sy, 1.05, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(...P(4.05, -3.1), 0.24, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,253,245,0.5)';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(...P(4.15, -1.9));
  ctx.quadraticCurveTo(...P(4.4, -0.3), ...P(4.0, 1.2));
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = LINE;
  ctx.stroke(body);

  drawMouth(ctx, ...P(3.8, 0.3), f.mouth);
  if (!holding(pose)) {
    // Short and pointing down at the ground, as a slug's lower feelers do: level, they read as a beak.
    drawFeeler(ctx, ...P(4.8, -2.7), ...P(6.5, -2.1));
    drawFeeler(ctx, ...P(4.7, -1.9), ...P(6.1, -1.0));
  }
  if (pose.hat) {
    const [hx, hy] = P(0.3, -6.7);
    drawHat(ctx, pose.hat, hx, hy, f.lean * 0.1 + (pose.anim === 'dead' ? 0.25 : 0), pose.t);
  }
  drawStalk(ctx, frontBase[0], frontBase[1], f.frontA, f, false);
}

function drawCurled(ctx: CanvasRenderingContext2D, pose: SlugPose, f: Form): void {
  ctx.translate(0, 2);
  ctx.rotate(Math.sin(pose.t / 110) * 0.25);
  const ball = new Path2D();
  ball.arc(0, 0, 5.3, 0, TAU);
  drawStalk(ctx, -0.4, -4.4, -0.5, f, true);
  ctx.fillStyle = C.shade;
  ctx.fill(ball);
  ctx.save();
  ctx.clip(ball);
  ctx.fillStyle = C.body;
  ctx.beginPath();
  ctx.arc(0.7, -0.7, 5.3, 0, TAU);
  ctx.fill();
  const glow = ctx.createRadialGradient(1.6, -2.4, 0, 1.6, -2.4, 4.6);
  glow.addColorStop(0, 'rgba(255,236,176,0.6)');
  glow.addColorStop(1, 'rgba(255,236,176,0)');
  ctx.fillStyle = glow;
  ctx.fill(ball);
  ctx.restore();
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = LINE;
  ctx.stroke(ball);

  // Tail wrapped across the front, foot side out.
  const tail = new Path2D();
  tail.arc(0, 0, 5.3, 0.15, 2.7);
  tail.quadraticCurveTo(-3.6, 1.2, -2.6, 2.3);
  tail.arc(0, 0, 3.1, 2.4, 0.5, true);
  tail.closePath();
  ctx.fillStyle = C.fringe;
  ctx.fill(tail);
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = LINE * 0.8;
  ctx.stroke(tail);
  if (pose.band) {
    // Curled up, the neck band shows as a stripe across the ball between head and tail.
    ctx.save();
    ctx.clip(ball);
    ctx.fillStyle = pose.band;
    ctx.beginPath();
    ctx.moveTo(0.45, -1.7);
    ctx.lineTo(3.75, -4.8);
    ctx.lineTo(5.05, -3.4);
    ctx.lineTo(1.75, -0.3);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 0.45;
    ctx.stroke();
    ctx.restore();
  }

  // Drawn as the upright mantle is: shaded under a lit offset, and outlined lighter than the body.
  const mantle = new Path2D();
  mantle.ellipse(-1.8, -1.5, 2.6, 2.3, -0.4, 0, TAU);
  ctx.fillStyle = C.mantleShade;
  ctx.fill(mantle);
  ctx.save();
  ctx.clip(mantle);
  ctx.fillStyle = C.mantle;
  ctx.beginPath();
  ctx.ellipse(-1.4, -1.9, 2.6, 2.3, -0.4, 0, TAU);
  ctx.fill();
  ctx.fillStyle = glow;
  ctx.fill(mantle);
  ctx.restore();
  ctx.strokeStyle = C.outline;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = LINE * 0.45;
  ctx.stroke(mantle);
  ctx.fillStyle = C.speck;
  ctx.globalAlpha = 0.55;
  for (const [sx, sy, sr] of [[2.2, -2.6, 0.4], [-3.6, 1.2, 0.36], [3.4, -0.4, 0.34]] as const) {
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,253,245,0.9)';
  ctx.beginPath();
  ctx.ellipse(2.6, -3.9, 0.95, 0.42, 0.7, 0, TAU);
  ctx.fill();
  drawMouth(ctx, 3.0, 0.4, f.mouth);
  if (pose.hat) drawHat(ctx, pose.hat, 0.6, -5.1, 0.2, pose.t);
  drawStalk(ctx, 1.4, -4.3, 0.7, f, false);
}

// Hats

export interface Hat {
  name: string;
  /** Drawn with the origin on top of the head, +x towards the face, before the front eye stalk. */
  draw(ctx: CanvasRenderingContext2D, t: number): void;
}

function shape(ctx: CanvasRenderingContext2D, fill: string, build: (p: Path2D) => void, line = 0.7): void {
  const p = new Path2D();
  build(p);
  ctx.fillStyle = fill;
  ctx.fill(p);
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = line;
  ctx.stroke(p);
}

export const HATS: Record<string, Hat> = {
  beanie: {
    name: 'Knitted beanie',
    draw(ctx) {
      shape(ctx, '#c4533e', (p) => {
        p.moveTo(-3.2, 0.9);
        p.bezierCurveTo(-3.3, -3.4, 3.3, -3.6, 3.2, 0.7);
        p.closePath();
      });
      ctx.strokeStyle = '#9a3a2a';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      for (const x of [-1.6, 0, 1.6]) {
        ctx.moveTo(x * 0.9, -2.1);
        ctx.lineTo(x, 0.2);
      }
      ctx.stroke();
      shape(ctx, '#ebe2cf', (p) => p.roundRect(-3.5, -0.2, 7, 1.5, 0.6));
      shape(ctx, '#ebe2cf', (p) => p.arc(-0.2, -3.6, 1.05, 0, TAU));
    },
  },
  leaf: {
    name: 'Leaf parasol',
    draw(ctx, t) {
      ctx.save();
      ctx.rotate(-0.35 + Math.sin(t / 900) * 0.06);
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, 0.5);
      ctx.lineTo(0, -3.4);
      ctx.stroke();
      shape(ctx, '#6aa64a', (p) => {
        p.moveTo(-5.2, -3);
        p.quadraticCurveTo(0, -7.8, 5.4, -3.6);
        p.quadraticCurveTo(0, -2.2, -5.2, -3);
      });
      ctx.strokeStyle = '#3f7a2e';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.moveTo(-4.4, -3.3);
      ctx.quadraticCurveTo(0, -5, 4.8, -3.7);
      ctx.stroke();
      ctx.restore();
    },
  },
  acorn: {
    name: 'Acorn cap',
    draw(ctx) {
      shape(ctx, '#8a5a2b', (p) => {
        p.moveTo(-3.4, 0.6);
        p.bezierCurveTo(-3.4, -2.9, 3.4, -2.9, 3.4, 0.6);
        p.quadraticCurveTo(0, 1.4, -3.4, 0.6);
      });
      ctx.strokeStyle = '#5e3a18';
      ctx.lineWidth = 0.32;
      ctx.beginPath();
      for (let k = -2; k <= 2; k++) {
        ctx.moveTo(k * 1.2 - 1, 0.6);
        ctx.lineTo(k * 1.2 + 0.6, -1.9);
        ctx.moveTo(k * 1.2 + 1, 0.6);
        ctx.lineTo(k * 1.2 - 0.6, -1.9);
      }
      ctx.stroke();
      shape(ctx, '#6e4520', (p) => p.roundRect(-0.45, -3.9, 0.9, 1.9, 0.4), 0.55);
    },
  },
  tophat: {
    name: 'Little top hat',
    draw(ctx) {
      shape(ctx, '#2f2b2e', (p) => p.ellipse(0, 0.3, 3.6, 0.85, 0, 0, TAU));
      shape(ctx, '#2f2b2e', (p) => {
        p.moveTo(-2.2, 0.2);
        p.lineTo(-2.4, -4.6);
        p.lineTo(2.4, -4.6);
        p.lineTo(2.2, 0.2);
        p.closePath();
      });
      ctx.fillStyle = '#b4483a';
      ctx.fillRect(-2.25, -1.2, 4.5, 1.0);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(-1.7, -4.2, 0.6, 2.8);
    },
  },
  bandana: {
    name: 'Headband',
    draw(ctx, t) {
      const flap = Math.sin(t / 160) * 0.5;
      shape(ctx, '#3f72b4', (p) => {
        p.moveTo(-3.5, 1.4);
        p.lineTo(-5.9, 0.4 + flap);
        p.lineTo(-5.4, 2.0 + flap);
        p.closePath();
        p.moveTo(-3.5, 1.6);
        p.lineTo(-5.6, 2.9 - flap);
        p.lineTo(-4.4, 3.4 - flap);
        p.closePath();
      }, 0.55);
      shape(ctx, '#3f72b4', (p) => {
        p.moveTo(-3.7, 0.6);
        p.quadraticCurveTo(0, -0.6, 3.9, 0.9);
        p.lineTo(3.8, 2.3);
        p.quadraticCurveTo(0, 0.9, -3.6, 2.1);
        p.closePath();
      }, 0.6);
      ctx.fillStyle = '#e9eef6';
      for (const x of [-2.2, -0.4, 1.4, 3.0]) {
        ctx.beginPath();
        ctx.arc(x, 1.0 + Math.abs(x) * 0.08, 0.28, 0, TAU);
        ctx.fill();
      }
    },
  },
  shell: {
    name: 'Borrowed shell',
    draw(ctx) {
      shape(ctx, '#d6a35a', (p) => {
        p.moveTo(-3.6, 0.8);
        p.bezierCurveTo(-4.4, -4.8, 3.6, -5.6, 3.4, -1.2);
        p.quadraticCurveTo(3.2, 0.8, 1.2, 1.0);
        p.closePath();
      });
      ctx.strokeStyle = '#8a5e2a';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0.3, -0.7);
      ctx.arc(0, -1.6, 0.9, 0.3, 4.8);
      ctx.arc(-0.1, -1.4, 2.0, 4.8, 3.0, false);
      ctx.stroke();
    },
  },
  daisy: {
    name: 'Daisy',
    draw(ctx, t) {
      const sway = Math.sin(t / 700) * 0.4;
      ctx.strokeStyle = '#3e7a30';
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(-0.6, 0.6);
      ctx.quadraticCurveTo(-1.6, -2.6, -1.2 + sway, -5.2);
      ctx.stroke();
      ctx.save();
      ctx.translate(-1.2 + sway, -5.4);
      for (let k = 0; k < 7; k++) {
        ctx.rotate(TAU / 7);
        shape(ctx, '#fbf7ec', (p) => p.ellipse(1.25, 0, 1.05, 0.5, 0, 0, TAU), 0.4);
      }
      shape(ctx, '#e8b93a', (p) => p.arc(0, 0, 0.8, 0, TAU), 0.45);
      ctx.restore();
    },
  },
  miner: {
    name: 'Miner’s helmet',
    draw(ctx) {
      shape(ctx, '#e0b23c', (p) => {
        p.moveTo(-3.8, 1);
        p.bezierCurveTo(-3.6, -3.8, 3.6, -3.8, 3.8, 1);
        p.closePath();
      });
      shape(ctx, '#e0b23c', (p) => p.roundRect(-4.3, 0.3, 8.6, 1.1, 0.5), 0.6);
      shape(ctx, '#d9dcdf', (p) => p.roundRect(1.8, -2.1, 1.6, 1.6, 0.4), 0.5);
      ctx.fillStyle = '#fff4c4';
      ctx.beginPath();
      ctx.arc(2.6, -1.3, 0.5, 0, TAU);
      ctx.fill();
    },
  },
};

export const HAT_IDS = Object.keys(HATS);

function drawHat(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, tilt: number, t: number): void {
  const hat = HATS[id];
  if (!hat) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  hat.draw(ctx, t);
  ctx.restore();
}

// Held weapons

interface HeldArt {
  /** Where along the aim line the feelers take hold, px from the grip point. */
  grips: readonly [number, number];
  /** Half-thickness at the grips, so the feeler loops sit on the surface. */
  girth: number;
  /** The bore's open end of a gun or launcher, along and across the aim line from the grip point: where a shot leaves. */
  muzzle?: readonly [number, number];
  draw(ctx: CanvasRenderingContext2D): void;
}

const STEEL_DARK = '#3b4045';
const OLIVE = '#6b7d46';
const OLIVE_DARK = '#4a5a2f';

/**
 * A shoulder tube: exhaust cone behind, flared bell in front, sight on top. It starts just behind
 * the grip, so at any aim it lies across the front of the body and never through the far side.
 */
function launcher(body: string, band: string, length: number): (ctx: CanvasRenderingContext2D) => void {
  return (ctx) => {
    shape(ctx, band, (p) => {
      p.moveTo(-1.6, -1.35);
      p.lineTo(-2.8, -1.95);
      p.lineTo(-2.8, 1.95);
      p.lineTo(-1.6, 1.35);
      p.closePath();
    }, 0.65);
    shape(ctx, body, (p) => p.roundRect(-1.9, -1.35, length + 1.9, 2.7, 0.6), 0.75);
    shape(ctx, band, (p) => {
      p.moveTo(length - 0.5, -1.35);
      p.lineTo(length + 1.2, -2.05);
      p.lineTo(length + 1.2, 2.05);
      p.lineTo(length - 0.5, 1.35);
      p.closePath();
    }, 0.65);
    ctx.fillStyle = C.outline;
    ctx.beginPath();
    ctx.ellipse(length + 1.2, 0, 0.4, 1.55, 0, 0, TAU);
    ctx.fill();
    shape(ctx, band, (p) => p.roundRect(0.9, -2.75, 1.9, 1.4, 0.3), 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(-1.2, -1.0, length + 0.6, 0.6);
  };
}

/** Slimmer than the bazooka, with the seeker box on top and the missile's nose showing at the mouth. */
function homingArt(ctx: CanvasRenderingContext2D, length: number): void {
  shape(ctx, '#3f72b4', (p) => p.roundRect(-2.6, -1.4, 1.2, 2.8, 0.4), 0.6);
  shape(ctx, '#d9d4c4', (p) => p.roundRect(-1.8, -1.15, length + 1.8, 2.3, 0.6), 0.75);
  shape(ctx, '#3f72b4', (p) => {
    p.moveTo(length - 0.2, -1.0);
    p.quadraticCurveTo(length + 2.2, -0.9, length + 2.4, 0);
    p.quadraticCurveTo(length + 2.2, 0.9, length - 0.2, 1.0);
    p.closePath();
  }, 0.6);
  shape(ctx, '#3f72b4', (p) => p.roundRect(length - 1.2, -1.4, 1.2, 2.8, 0.4), 0.6);
  shape(ctx, STEEL_DARK, (p) => p.roundRect(0.2, -3.7, 3.6, 2.4, 0.5), 0.6);
  ctx.fillStyle = '#9cc4ee';
  ctx.beginPath();
  ctx.arc(3.0, -2.5, 0.65, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(2.7, -2.85, 0.35, 0.35);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(-1.2, -0.85, length, 0.5);
}

function grenadeArt(ctx: CanvasRenderingContext2D, body: string, x: number): void {
  shape(ctx, body, (p) => p.ellipse(x, 0, 2.1, 2.3, 0, 0, TAU), 0.75);
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  ctx.moveTo(x - 2, 0);
  ctx.lineTo(x + 2, 0);
  ctx.moveTo(x, -2.2);
  ctx.lineTo(x, 2.2);
  ctx.stroke();
  shape(ctx, '#9aa0a5', (p) => p.roundRect(x - 0.8, -3.2, 1.6, 1.1, 0.3), 0.5);
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.arc(x + 1.3, -3.0, 0.7, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x - 0.8, -0.9, 0.55, 0, TAU);
  ctx.fill();
}

function clusterArt(ctx: CanvasRenderingContext2D, x: number): void {
  shape(ctx, '#b4532f', (p) => p.arc(x, 0, 2.3, 0, TAU), 0.75);
  ctx.fillStyle = '#6e2c18';
  for (const [dx, dy] of [[-1, -0.9], [0.9, -0.6], [0.1, 0.9], [-1.2, 0.8], [1.3, 1.0]] as const) {
    ctx.beginPath();
    ctx.arc(x + dx, dy, 0.38, 0, TAU);
    ctx.fill();
  }
  shape(ctx, '#9aa0a5', (p) => p.roundRect(x - 0.7, -3.2, 1.4, 1.0, 0.3), 0.5);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.arc(x - 0.9, -1.0, 0.6, 0, TAU);
  ctx.fill();
}


function dynamiteArt(ctx: CanvasRenderingContext2D, x: number, lit: boolean, t: number): void {
  shape(ctx, '#c7432f', (p) => p.roundRect(x - 1.1, -3.2, 2.2, 6.4, 0.5), 0.7);
  ctx.fillStyle = '#e9d9b8';
  ctx.fillRect(x - 1.1, -0.7, 2.2, 1.4);
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(x, -3.2);
  ctx.quadraticCurveTo(x + 0.9, -4.2, x + 0.4, -5.0);
  ctx.stroke();
  if (lit) {
    const k = 0.7 + 0.4 * Math.abs(Math.sin(t / 45));
    ctx.fillStyle = '#ffb648';
    ctx.beginPath();
    ctx.arc(x + 0.4, -5.1, 0.8 * k, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fff2c0';
    ctx.beginPath();
    ctx.arc(x + 0.4, -5.1, 0.35 * k, 0, TAU);
    ctx.fill();
  }
}

function rocketArt(ctx: CanvasRenderingContext2D, body: string, nose: string, t: number): void {
  const flame = 1 + 0.35 * Math.sin(t / 30);
  ctx.fillStyle = '#f29a3a';
  ctx.beginPath();
  ctx.moveTo(-3.6, -0.9);
  ctx.quadraticCurveTo(-3.6 - 3 * flame, 0, -3.6, 0.9);
  ctx.fill();
  ctx.fillStyle = '#ffe2a0';
  ctx.beginPath();
  ctx.moveTo(-3.6, -0.45);
  ctx.quadraticCurveTo(-3.6 - 1.6 * flame, 0, -3.6, 0.45);
  ctx.fill();
  shape(ctx, nose, (p) => {
    p.moveTo(-3.6, -1.1);
    p.lineTo(-4.4, -2.3);
    p.lineTo(-2.4, -1.1);
    p.moveTo(-3.6, 1.1);
    p.lineTo(-4.4, 2.3);
    p.lineTo(-2.4, 1.1);
  }, 0.55);
  shape(ctx, body, (p) => {
    p.moveTo(-3.8, -1.25);
    p.lineTo(1.6, -1.25);
    p.quadraticCurveTo(4.4, -1.1, 4.6, 0);
    p.quadraticCurveTo(4.4, 1.1, 1.6, 1.25);
    p.lineTo(-3.8, 1.25);
    p.closePath();
  }, 0.7);
  ctx.fillStyle = nose;
  ctx.fillRect(1.2, -1.25, 0.9, 2.5);
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.fillRect(-3, -0.95, 4.4, 0.45);
}

/** A screw point facing +x from `x`; it turns with `t`. */
function drillTip(ctx: CanvasRenderingContext2D, x: number, t: number): void {
  shape(ctx, '#b9bec3', (p) => {
    p.moveTo(x - 0.4, -1.3);
    p.lineTo(x + 3.2, 0);
    p.lineTo(x - 0.4, 1.3);
    p.closePath();
  }, 0.6);
  const turn = (t / 60) % 1.2;
  ctx.strokeStyle = STEEL_DARK;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const sx = x + turn + k * 1.0 - 0.6;
    if (sx > x + 2.6 || sx < x - 0.2) continue;
    const half = 1.3 * (1 - (sx - x + 0.4) / 3.6);
    ctx.moveTo(sx - 0.35, -half);
    ctx.lineTo(sx + 0.35, half);
  }
  ctx.stroke();
}

function mortarShell(ctx: CanvasRenderingContext2D): void {
  shape(ctx, OLIVE_DARK, (p) => {
    p.moveTo(-3, -0.9);
    p.lineTo(-3.8, -1.9);
    p.lineTo(-3.8, 1.9);
    p.lineTo(-3, 0.9);
    p.closePath();
  }, 0.55);
  shape(ctx, '#5b6440', (p) => {
    p.moveTo(-3.2, -1.1);
    p.quadraticCurveTo(-0.6, -2.2, 1.6, -1.6);
    p.quadraticCurveTo(3.6, -0.9, 3.6, 0);
    p.quadraticCurveTo(3.6, 0.9, 1.6, 1.6);
    p.quadraticCurveTo(-0.6, 2.2, -3.2, 1.1);
    p.closePath();
  }, 0.7);
  ctx.fillStyle = '#d9c25a';
  ctx.fillRect(0.6, -1.85, 0.7, 3.7);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(-2.2, -1.2, 3, 0.45);
}

function podArt(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = '#3e6a2a';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  ctx.moveTo(x, y - 2.6);
  ctx.quadraticCurveTo(x + 0.4, y - 3.8, x + 1.4, y - 4.0);
  ctx.stroke();
  shape(ctx, '#86b04e', (p) => p.ellipse(x, y, 2.0, 2.8, 0, 0, TAU), 0.75);
  ctx.strokeStyle = '#557d34';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(x, y - 2.7);
  ctx.quadraticCurveTo(x + 0.7, y, x, y + 2.7);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.ellipse(x - 0.9, y - 0.9, 0.45, 0.9, 0.2, 0, TAU);
  ctx.fill();
}

function seedArt(ctx: CanvasRenderingContext2D): void {
  shape(ctx, '#8a5a2e', (p) => {
    p.moveTo(-1.8, 0);
    p.quadraticCurveTo(-0.4, -1.5, 1.8, -0.2);
    p.quadraticCurveTo(0.2, 1.5, -1.8, 0);
  }, 0.6);
  ctx.fillStyle = '#c99a5e';
  ctx.fillRect(-0.8, -0.5, 1.2, 0.35);
}

function jarArt(ctx: CanvasRenderingContext2D, x: number): void {
  const glass = new Path2D();
  glass.roundRect(x - 2.6, -2.4, 5.2, 6.0, 1.3);
  ctx.fillStyle = '#b9cf8a';
  ctx.fill(glass);
  ctx.save();
  ctx.clip(glass);
  ctx.fillStyle = '#6f8f3a';
  ctx.beginPath();
  ctx.ellipse(x - 1.0, 1.0, 0.85, 2.4, 0.15, 0, TAU);
  ctx.ellipse(x + 1.1, 1.4, 0.85, 2.2, -0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillRect(x - 2.0, -1.8, 0.6, 4.4);
  ctx.restore();
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.75;
  ctx.stroke(glass);
  shape(ctx, '#c4473a', (p) => p.roundRect(x - 2.2, -3.6, 4.4, 1.4, 0.4), 0.65);
}

function snailArt(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  const reach = 0.4 * Math.sin(t / 120);
  shape(ctx, '#b9a888', (p) => {
    p.moveTo(x - 3.6, y + 2);
    p.lineTo(x + 3.2 + reach, y + 2);
    p.quadraticCurveTo(x + 4.4 + reach, y + 1.6, x + 3.6 + reach, y - 0.6);
    p.quadraticCurveTo(x + 2.8, y - 0.8, x + 2, y + 0.4);
    p.lineTo(x - 3.2, y + 0.9);
    p.closePath();
  }, 0.6);
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(x + 3.4 + reach, y - 0.4);
  ctx.lineTo(x + 3.9 + reach, y - 2.0);
  ctx.moveTo(x + 3.0 + reach, y - 0.4);
  ctx.lineTo(x + 3.0 + reach, y - 1.8);
  ctx.stroke();
  shape(ctx, '#c4783a', (p) => p.arc(x - 0.4, y - 1.1, 2.6, 0, TAU), 0.65);
  ctx.strokeStyle = '#7e4420';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.arc(x - 0.4, y - 1.1, 1.6, 0.4, 5.6);
  ctx.arc(x - 0.6, y - 1.0, 0.7, 5.6, 2.8, false);
  ctx.stroke();
}

function millstoneArt(ctx: CanvasRenderingContext2D): void {
  shape(ctx, '#9a978d', (p) => {
    p.arc(0, 0, 4.4, 0, TAU);
    p.moveTo(1.1, 0);
    p.arc(0, 0, 1.1, 0, TAU, true);
  }, 0.8);
  ctx.strokeStyle = '#6f6c64';
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  for (let k = 0; k < 6; k++) {
    const a = (k * TAU) / 6;
    ctx.moveTo(Math.cos(a) * 1.7, Math.sin(a) * 1.7);
    ctx.lineTo(Math.cos(a + 0.35) * 3.8, Math.sin(a + 0.35) * 3.8);
  }
  ctx.stroke();
}

function mineArt(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean): void {
  shape(ctx, '#3b4045', (p) => p.roundRect(x - 3, y + 0.6, 6, 1.3, 0.4), 0.6);
  shape(ctx, '#58606a', (p) => {
    p.moveTo(x - 2.6, y + 0.7);
    p.quadraticCurveTo(x, y - 2.8, x + 2.6, y + 0.7);
    p.closePath();
  }, 0.7);
  // Lit, the lamp carries a glow several times its size: the mine itself is a few px across, and the glow is what
  // finds it on a zoomed-out map.
  if (lit) {
    const glow = ctx.createRadialGradient(x, y - 1.1, 0, x, y - 1.1, 5);
    glow.addColorStop(0, 'rgba(255, 70, 50, 0.6)');
    glow.addColorStop(1, 'rgba(255, 70, 50, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y - 1.1, 5, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = lit ? '#ff3b2a' : '#7a2a20';
  ctx.beginPath();
  ctx.arc(x, y - 1.1, 0.8, 0, TAU);
  ctx.fill();
  if (lit) {
    ctx.fillStyle = '#ffd0c0';
    ctx.beginPath();
    ctx.arc(x - 0.2, y - 1.3, 0.3, 0, TAU);
    ctx.fill();
  }
}

function radioArt(ctx: CanvasRenderingContext2D, body: string, lamp: string): void {
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(2.6, -1.8);
  ctx.lineTo(3.4, -6.2);
  ctx.stroke();
  ctx.fillStyle = C.outline;
  ctx.beginPath();
  ctx.arc(3.4, -6.2, 0.45, 0, TAU);
  ctx.fill();
  shape(ctx, body, (p) => p.roundRect(-0.6, -2.2, 4, 4.4, 0.8), 0.7);
  ctx.fillStyle = lamp;
  ctx.beginPath();
  ctx.arc(1.4, -0.9, 0.55, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#c8d0c0';
  ctx.fillRect(0.2, 0.3, 2.4, 1.0);
}

/** Short and fat, with a base plate behind and a flared crown: a mortar reads by its bore, not its length. */
function mortarArt(ctx: CanvasRenderingContext2D, length: number): void {
  shape(ctx, STEEL_DARK, (p) => p.roundRect(-2.7, -3.0, 1.3, 6.0, 0.45), 0.6);
  shape(ctx, OLIVE, (p) => {
    p.moveTo(-1.6, -2.0);
    p.lineTo(length, -1.7);
    p.lineTo(length, 1.7);
    p.lineTo(-1.6, 2.0);
    p.closePath();
  }, 0.75);
  ctx.fillStyle = OLIVE_DARK;
  ctx.fillRect(length * 0.45, -1.85, 0.8, 3.7);
  shape(ctx, OLIVE_DARK, (p) => {
    p.moveTo(length - 0.4, -1.7);
    p.lineTo(length + 1.0, -2.45);
    p.lineTo(length + 1.0, 2.45);
    p.lineTo(length - 0.4, 1.7);
    p.closePath();
  }, 0.65);
  ctx.fillStyle = C.outline;
  ctx.beginPath();
  ctx.ellipse(length + 1.0, 0, 0.45, 1.95, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-1.0, -1.5, length * 0.4, 0.55);
}

function shotgunArt(ctx: CanvasRenderingContext2D, barrel: number): void {
  shape(ctx, '#8a5a2e', (p) => {
    p.moveTo(-5.2, -0.3);
    p.lineTo(-0.4, -0.9);
    p.lineTo(-0.4, 0.9);
    p.lineTo(-5.2, 2.0);
    p.closePath();
  }, 0.7);
  shape(ctx, STEEL_DARK, (p) => p.roundRect(-0.8, -1.25, barrel, 1.25, 0.4), 0.6);
  shape(ctx, STEEL_DARK, (p) => p.roundRect(-0.8, 0, barrel, 1.25, 0.4), 0.6);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(0, -1.0, barrel - 1.4, 0.35);
}

function machinegunArt(ctx: CanvasRenderingContext2D, length: number): void {
  gunArt(ctx, length, (c) => {
    shape(c, '#4b5157', (p) => p.roundRect(1.4, 0.4, 1.4, 2.6, 0.3), 0.55);
    shape(c, STEEL_DARK, (p) => p.roundRect(length - 2.2, -1.4, 2.4, 2.4, 0.4), 0.5);
  });
}

function minigunArt(ctx: CanvasRenderingContext2D, barrel: number): void {
  shape(ctx, '#4b5157', (p) => p.roundRect(-3.2, -1.8, 4.6, 3.6, 0.8), 0.7);
  for (const y of [-1.2, 0, 1.2]) shape(ctx, STEEL_DARK, (p) => p.roundRect(1.2, y - 0.5, barrel, 1.0, 0.4), 0.5);
  shape(ctx, '#8a9096', (p) => p.roundRect(barrel - 0.6, -1.9, 0.9, 3.8, 0.3), 0.5);
}

function longshotArt(ctx: CanvasRenderingContext2D, length: number): void {
  gunArt(ctx, length, (c) => {
    shape(c, '#2f2b2e', (p) => p.roundRect(-0.4, -2.6, 4.4, 1.4, 0.6), 0.55);
    c.fillStyle = '#9ec7e0';
    c.fillRect(3.5, -2.3, 0.4, 0.8);
    shape(c, '#8a5a2e', (p) => {
      p.moveTo(-2.2, -0.9);
      p.lineTo(-6.0, -0.4);
      p.lineTo(-6.0, 2.2);
      p.lineTo(-2.2, 0.6);
      p.closePath();
    }, 0.6);
  });
}

/** `end` is where the shaft meets the blade. */
function spadeArt(ctx: CanvasRenderingContext2D, end: number): void {
  shape(ctx, '#9b6b3a', (p) => p.roundRect(-4.2, -0.5, end + 4.2, 1.0, 0.4), 0.55);
  shape(ctx, '#b9bec3', (p) => {
    p.moveTo(end - 0.2, -1.9);
    p.lineTo(end + 2.4, -1.6);
    p.quadraticCurveTo(end + 4.2, 0, end + 2.4, 1.6);
    p.lineTo(end - 0.2, 1.9);
    p.closePath();
  }, 0.65);
  shape(ctx, '#9b6b3a', (p) => p.roundRect(-5.2, -1.0, 1.2, 2.0, 0.4), 0.5);
}

function prodArt(ctx: CanvasRenderingContext2D, length: number, half: number, knob: number): void {
  shape(ctx, '#c9a46a', (p) => p.roundRect(-4.4, -half, length, half * 2, 0.4), 0.5);
  shape(ctx, '#c4473a', (p) => p.arc(length - 4.2, 0, knob, 0, TAU), 0.55);
}

/** `bays` is how many lattice triangles long, 2 px each. */
function girderArt(ctx: CanvasRenderingContext2D, bays: number): void {
  shape(ctx, '#7f878e', (p) => p.rect(-3.6, -1.2, bays * 2, 2.4), 0.6);
  ctx.strokeStyle = '#4b5157';
  ctx.lineWidth = 0.35;
  ctx.beginPath();
  for (let k = 0; k < bays; k++) {
    const x = -3.6 + k * 2;
    ctx.moveTo(x, 1.2);
    ctx.lineTo(x + 1, -1.2);
    ctx.lineTo(x + 2, 1.2);
  }
  ctx.stroke();
}

function blowtorchArt(ctx: CanvasRenderingContext2D, nozzle: number): void {
  shape(ctx, '#c4473a', (p) => p.roundRect(-2.4, -1.6, 4.2, 3.2, 1.2), 0.7);
  shape(ctx, '#b9bec3', (p) => p.roundRect(1.6, -0.5, nozzle, 1.0, 0.3), 0.55);
  shape(ctx, STEEL_DARK, (p) => p.roundRect(nozzle + 1.2, -0.8, 1.2, 1.6, 0.3), 0.5);
}

/** A gun along +x from the grip, with any extras drawn over the barrel. */
function gunArt(ctx: CanvasRenderingContext2D, length: number, extra?: (ctx: CanvasRenderingContext2D) => void): void {
  shape(ctx, '#6b4a2a', (p) => {
    p.moveTo(-1.6, 0.2);
    p.lineTo(-0.2, 0.2);
    p.lineTo(-0.6, 3.0);
    p.lineTo(-2.0, 3.0);
    p.closePath();
  }, 0.6);
  shape(ctx, STEEL_DARK, (p) => p.roundRect(-2.2, -1.0, length + 2.2, 1.6, 0.4), 0.6);
  extra?.(ctx);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(-1.6, -0.75, length + 0.8, 0.35);
}

const HELD: Record<string, HeldArt> = {
  bazooka: { grips: [-1.0, 1.0], girth: 1.35, muzzle: [8.2, 0], draw: launcher(OLIVE, OLIVE_DARK, 7) },
  // Held by the near edge, so the loops do not hide what is being thrown.
  grenade: { grips: [0.4, 1.1], girth: 1.7, draw: (ctx) => grenadeArt(ctx, '#7a9548', 2.6) },
  cluster: { grips: [0.4, 1.1], girth: 1.8, draw: (ctx) => clusterArt(ctx, 2.7) },
  shotgun: {
    grips: [-1.2, 1.4],
    girth: 1.2,
    muzzle: [9.2, 0],
    draw: (ctx) => shotgunArt(ctx, 10),
  },
  dynamite: { grips: [1.4, 2.8], girth: 1.1, draw: (ctx) => dynamiteArt(ctx, 2.1, false, 0) },
  airstrike: { grips: [0.4, 2.0], girth: 2.2, draw: (ctx) => radioArt(ctx, '#4f5d47', '#c4473a') },
  millstone: { grips: [0.4, 2.0], girth: 2.2, draw: (ctx) => radioArt(ctx, '#7a6a52', '#e0b23c') },
  teleport: {
    grips: [0.2, 1.8],
    girth: 1.5,
    draw(ctx) {
      shape(ctx, '#3f72b4', (p) => p.roundRect(-0.6, -1.5, 3.4, 3.0, 0.7), 0.65);
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      ctx.moveTo(2.2, -1.5);
      ctx.lineTo(2.6, -3.4);
      ctx.stroke();
      ctx.strokeStyle = '#e9eef6';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(2.7, -4.3, 0.9, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#e9eef6';
      ctx.fillRect(0.0, -0.6, 1.6, 0.9);
    },
  },
  homing: { grips: [-1.0, 1.0], girth: 1.15, muzzle: [9.4, 0], draw: (ctx) => homingArt(ctx, 7) },
  borer: {
    grips: [-1.0, 1.0],
    girth: 1.35,
    muzzle: [7.2, 0],
    draw(ctx) {
      launcher('#8a6a3a', '#5a4022', 6)(ctx);
      drillTip(ctx, 7.0, 0);
    },
  },
  mortar: {
    grips: [-0.6, 1.4],
    girth: 1.95,
    muzzle: [6.6, 0],
    draw: (ctx) => mortarArt(ctx, 5.6),
  },
  seedpod: { grips: [1.4, 3.2], girth: 2.0, draw: (ctx) => podArt(ctx, 2.4, 0) },
  jar: { grips: [1.2, 3.6], girth: 2.4, draw: (ctx) => jarArt(ctx, 2.4) },
  mine: { grips: [1.0, 3.6], girth: 1.6, draw: (ctx) => mineArt(ctx, 2.4, 0.4, false) },
  snail: { grips: [0.8, 3.0], girth: 1.4, draw: (ctx) => snailArt(ctx, 2.2, -0.4, 0) },
  handgun: { grips: [-0.9, 0.3], girth: 0.9, muzzle: [4.2, -0.2], draw: (ctx) => gunArt(ctx, 4.2) },
  machinegun: {
    grips: [-1.2, 1.6],
    girth: 0.9,
    muzzle: [7.6, -0.2],
    draw: (ctx) => machinegunArt(ctx, 7.4),
  },
  minigun: {
    grips: [-1.4, 1.8],
    girth: 1.6,
    muzzle: [8.8, 0],
    draw: (ctx) => minigunArt(ctx, 7.6),
  },
  longshot: {
    grips: [-1.4, 2.0],
    girth: 0.9,
    muzzle: [11.5, -0.2],
    draw: (ctx) => longshotArt(ctx, 11.5),
  },
  uppercut: {
    grips: [0.4, 2.4],
    girth: 1.9,
    draw(ctx) {
      shape(ctx, '#c4473a', (p) => {
        p.moveTo(-0.6, -1.4);
        p.quadraticCurveTo(1.0, -2.4, 3.4, -1.9);
        p.quadraticCurveTo(5.0, -1.2, 4.6, 0.6);
        p.quadraticCurveTo(4.0, 2.2, 1.6, 2.0);
        p.lineTo(-0.6, 1.6);
        p.closePath();
      }, 0.7);
      shape(ctx, '#ebe2cf', (p) => p.roundRect(-1.6, -1.6, 1.4, 3.4, 0.4), 0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.ellipse(2.6, -1.1, 1.1, 0.4, -0.1, 0, TAU);
      ctx.fill();
    },
  },
  spade: {
    grips: [-1.0, 1.8],
    girth: 0.6,
    draw: (ctx) => spadeArt(ctx, 6.2),
  },
  prod: {
    grips: [-1.0, 1.8],
    girth: 0.5,
    draw: (ctx) => prodArt(ctx, 13.2, 0.45, 0.95),
  },
  rope: {
    grips: [0.6, 2.8],
    girth: 1.8,
    draw(ctx) {
      shape(ctx, '#c9a46a', (p) => {
        p.ellipse(1.7, 0, 2.2, 1.8, 0, 0, TAU);
        p.moveTo(2.6, 0);
        p.ellipse(1.7, 0, 0.9, 0.7, 0, 0, TAU, true);
      }, 0.65);
      ctx.strokeStyle = '#9b7a44';
      ctx.lineWidth = 0.3;
      ctx.beginPath();
      ctx.ellipse(1.7, 0, 1.55, 1.25, 0, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(3.8, -0.4);
      ctx.lineTo(5.6, -0.4);
      ctx.moveTo(5.6, -0.4);
      ctx.quadraticCurveTo(6.8, -0.6, 6.6, -1.9);
      ctx.moveTo(5.6, -0.4);
      ctx.quadraticCurveTo(6.8, -0.2, 6.6, 1.1);
      ctx.stroke();
    },
  },
  jetpack: {
    grips: [0.4, 2.6],
    girth: 2.0,
    draw(ctx) {
      for (const x of [0.3, 2.5]) shape(ctx, '#b4483a', (p) => p.roundRect(x - 1.0, -2.6, 2.0, 5.0, 1.0), 0.65);
      shape(ctx, STEEL_DARK, (p) => p.roundRect(-0.9, 2.2, 4.6, 1.0, 0.3), 0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-0.3, -1.9, 0.4, 3.4);
      ctx.fillRect(1.9, -1.9, 0.4, 3.4);
    },
  },
  parachute: {
    grips: [0.4, 2.6],
    girth: 1.9,
    draw(ctx) {
      shape(ctx, '#d6a35a', (p) => p.roundRect(-0.8, -2.0, 4.4, 4.0, 1.0), 0.7);
      ctx.strokeStyle = '#8a5e2a';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(-0.6, 0);
      ctx.lineTo(3.4, 0);
      ctx.stroke();
      ctx.strokeStyle = '#c4473a';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(4.4, 0.6, 0.7, 0, TAU);
      ctx.stroke();
    },
  },
  // Utilities are held out to be switched on, each as a small thing that says what it does.
  lowgrav: {
    grips: [0.2, 2.2],
    girth: 1.2,
    draw(ctx) {
      shape(ctx, '#e9e2d0', (p) => p.ellipse(2.4, 0, 3.6, 1.3, -0.25, 0, TAU), 0.6);
      ctx.strokeStyle = '#8a8370';
      ctx.lineWidth = 0.35;
      ctx.beginPath();
      ctx.moveTo(-1.6, 1.0);
      ctx.lineTo(5.8, -0.9);
      ctx.stroke();
    },
  },
  fastwalk: {
    grips: [0.2, 2.4],
    girth: 1.6,
    draw(ctx) {
      shape(ctx, '#d9b44a', (p) => p.roundRect(-0.8, -1.6, 4.8, 3.2, 0.8), 0.6);
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      for (const x of [0.4, 2.0]) {
        ctx.moveTo(x, -0.9);
        ctx.lineTo(x + 1.0, 0);
        ctx.lineTo(x, 0.9);
      }
      ctx.stroke();
    },
  },
  laser: {
    grips: [-0.4, 1.8],
    girth: 0.9,
    draw(ctx) {
      shape(ctx, STEEL_DARK, (p) => p.roundRect(-1.4, -0.8, 5.4, 1.6, 0.6), 0.55);
      shape(ctx, '#d8433a', (p) => p.arc(4.3, 0, 0.6, 0, TAU), 0.4);
    },
  },
  double: {
    grips: [0.2, 2.4],
    girth: 1.8,
    draw(ctx) {
      for (const x of [0.4, 2.6]) shape(ctx, '#4b5157', (p) => p.arc(x, 0.2, 1.5, 0, TAU), 0.6);
      ctx.fillStyle = '#e0b23c';
      ctx.fillRect(0.1, -1.9, 0.6, 0.8);
      ctx.fillRect(2.3, -1.9, 0.6, 0.8);
    },
  },
  girder: {
    grips: [-1.2, 1.6],
    girth: 1.2,
    draw: (ctx) => girderArt(ctx, 5),
  },
  blowtorch: {
    grips: [-0.6, 1.4],
    girth: 1.6,
    draw: (ctx) => blowtorchArt(ctx, 4.4),
  },
  drill: {
    grips: [-0.8, 1.2],
    girth: 1.6,
    draw(ctx) {
      shape(ctx, '#e0b23c', (p) => p.roundRect(-2.6, -1.6, 4.8, 3.2, 0.8), 0.7);
      shape(ctx, '#4b5157', (p) => p.roundRect(2.0, -0.9, 1.2, 1.8, 0.3), 0.55);
      drillTip(ctx, 3.0, 0);
    },
  },
};

const FALLBACK_HELD: HeldArt = { grips: [-1.0, 1.0], girth: 1.35, draw: launcher('#8a9096', STEEL_DARK, 6) };

/**
 * The weapon a slug is holding, drawn after drawSlug in the same transform.
 * Slugs have no hands: the two lower feelers reach out and loop round the
 * weapon, which sits against the front of the body and turns to the aim.
 */
/** Where drawHeldWeapon holds a weapon: the grip point, in px from the slug's centre, before facing. */
const GRIP_X = 3.4;
const GRIP_Y = -1.4;

/**
 * Where a held gun's or launcher's shot leaves, in px from the slug's centre, so a muzzle flash sits on
 * the barrel drawn. Null for anything without a bore.
 */
export function heldMuzzle(weapon: string, aim: number, facing: 1 | -1): { x: number; y: number } | null {
  const muzzle = HELD[weapon]?.muzzle;
  if (!muzzle) return null;
  const a = (-aim * Math.PI) / 180;
  const [along, across] = muzzle;
  return {
    x: facing * (GRIP_X + along * Math.cos(a) - across * Math.sin(a)),
    y: GRIP_Y + along * Math.sin(a) + across * Math.cos(a),
  };
}

export function drawHeldWeapon(ctx: CanvasRenderingContext2D, weapon: string, aim: number, facing: 1 | -1): void {
  const art = HELD[weapon] ?? FALLBACK_HELD;
  const a = (-aim * Math.PI) / 180;
  const px = GRIP_X;
  const py = GRIP_Y;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  ctx.save();
  ctx.scale(facing, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(a);
  art.draw(ctx);
  ctx.restore();
  const bases: readonly (readonly [number, number])[] = [
    [4.2, -3.3],
    [4.0, -2.6],
  ];
  for (let k = 0; k < 2; k++) {
    const g = art.grips[k];
    const top = -art.girth - 0.2;
    const gx = px + g * cos - top * sin;
    const gy = py + g * sin + top * cos;
    const path = new Path2D();
    path.moveTo(bases[k][0], bases[k][1]);
    path.quadraticCurveTo((bases[k][0] + gx) / 2, Math.min(bases[k][1], gy) - 0.8, gx, gy);
    strokeTwice(ctx, path, C.body, 0.8);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a);
    const loop = new Path2D();
    loop.roundRect(g - 0.45, -art.girth - 0.3, 0.9, art.girth * 2 + 0.6, 0.45);
    ctx.fillStyle = C.body;
    ctx.fill(loop);
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 0.55;
    ctx.stroke(loop);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The weapon menu's 24 px square has no room for a long, thin drawing: fitted by its
 * length, a bazooka or prod comes out a sliver a pixel or two thick. These weapons get
 * a shorter build of the same drawing for their icon, and `stretch` thickens what is
 * still slight. Every other weapon's icon is its held drawing as it is.
 */
interface IconArt {
  draw?: (ctx: CanvasRenderingContext2D) => void;
  /** Scale along x and y before fitting. */
  stretch?: readonly [number, number];
}

const ICON: Record<string, IconArt> = {
  bazooka: { draw: launcher(OLIVE, OLIVE_DARK, 3), stretch: [1, 1.2] },
  homing: { draw: (ctx) => homingArt(ctx, 3), stretch: [1, 1.1] },
  mortar: { draw: (ctx) => mortarArt(ctx, 2.4), stretch: [1, 1.15] },
  borer: {
    draw(ctx) {
      launcher('#8a6a3a', '#5a4022', 2.4)(ctx);
      drillTip(ctx, 3.4, 0);
    },
    stretch: [1, 1.3],
  },
  dynamite: { stretch: [1.4, 1] },
  shotgun: { draw: (ctx) => shotgunArt(ctx, 4), stretch: [1, 1.6] },
  machinegun: { draw: (ctx) => machinegunArt(ctx, 5.2), stretch: [1, 1.15] },
  minigun: { draw: (ctx) => minigunArt(ctx, 3.6), stretch: [1, 1.1] },
  longshot: { draw: (ctx) => longshotArt(ctx, 5), stretch: [1, 1.35] },
  spade: { draw: (ctx) => spadeArt(ctx, 1), stretch: [1, 1.4] },
  prod: { draw: (ctx) => prodArt(ctx, 5.4, 1, 2.1) },
  girder: { draw: (ctx) => girderArt(ctx, 3), stretch: [1, 1.2] },
  blowtorch: { draw: (ctx) => blowtorchArt(ctx, 2.2) },
  drill: { stretch: [1, 1.2] },
};

function drawIconArt(ctx: CanvasRenderingContext2D, weapon: string): void {
  const icon = ICON[weapon];
  if (icon?.stretch) ctx.scale(icon.stretch[0], icon.stretch[1]);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  (icon?.draw ?? (HELD[weapon] ?? FALLBACK_HELD).draw)(ctx);
}

const iconBounds = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();

/**
 * The box a weapon's icon drawing covers, in its own units, found once by drawing
 * it and reading back the pixels: the drawings differ too much in reach (a grenade
 * against a rifle) for one fixed frame to suit every icon.
 */
function iconBox(weapon: string) {
  const known = iconBounds.get(weapon);
  if (known) return known;
  const scale = 8;
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 200;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(scale, 0, 0, scale, c.width / 2, c.height / 2);
  drawIconArt(ctx, weapon);
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = c.width;
  let y0 = c.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] === 0) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  if (x1 < 0) throw new Error(`The icon drawing for ${weapon} drew nothing`);
  const box = {
    x0: (x0 - c.width / 2) / scale, y0: (y0 - c.height / 2) / scale,
    x1: (x1 - c.width / 2) / scale, y1: (y1 - c.height / 2) / scale,
  };
  iconBounds.set(weapon, box);
  return box;
}

/**
 * A weapon as the slug holds it, without the slug, fitted and centred in a size × size
 * square whose top-left corner is the context's current origin. For the weapon menu.
 */
export function drawWeaponIcon(ctx: CanvasRenderingContext2D, weapon: string, size: number): void {
  const b = iconBox(weapon);
  // A little margin, so outlines are not clipped against the square's edge.
  const fit = (size * 0.88) / Math.max(b.x1 - b.x0, b.y1 - b.y0);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(fit, fit);
  ctx.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
  drawIconArt(ctx, weapon);
  ctx.restore();
}

// Things in flight

/**
 * The turn drawProjectile gives a projectile, in radians: along its heading for
 * what flies nose first, a tumble with `t` (ms) for what is thrown, none for the
 * snail, which crawls level. `angleDeg` is as for drawProjectile.
 */
export function projectileSpin(kind: string, angleDeg: number, t: number): number {
  const heading = (angleDeg * Math.PI) / 180;
  switch (kind) {
    case 'shell':
    case 'missile':
    case 'homing':
    case 'borer':
    case 'mortar':
      return heading;
    case 'pod': return t / 110;
    case 'seed': return t / 80;
    case 'jar': return Math.sin(t / 200) * 0.35;
    case 'stone': return t / 260;
    case 'grenade':
    case 'cluster': return t / 90;
    case 'bit': return t / 70;
    case 'dynamite': return Math.sin(t / 160) * 0.5;
    default: return 0;
  }
}

/**
 * Whether a projectile's picture changes with time apart from its turn: a rocket's
 * flame, a lit fuse, a drill's thread, a snail's head. The rest can be painted once
 * and turned as an image.
 */
export function projectileFlickers(kind: string): boolean {
  return kind === 'shell' || kind === 'missile' || kind === 'homing' || kind === 'borer' || kind === 'snail' || kind === 'dynamite';
}

/**
 * A projectile at the origin. `angleDeg` is its direction of travel in screen
 * terms (0 = right, 90 = down, i.e. atan2(vy, vx) in degrees). Thrown things
 * tumble with `t` (ms) instead. Unknown kinds draw as a plain round shell.
 */
export function drawProjectile(ctx: CanvasRenderingContext2D, kind: string, angleDeg: number, t: number): void {
  ctx.save();
  ctx.rotate(projectileSpin(kind, angleDeg, t));
  drawProjectileBody(ctx, kind, Math.cos((angleDeg * Math.PI) / 180) < 0 ? -1 : 1, t);
  ctx.restore();
}

/**
 * A projectile at the origin without its turn (see projectileSpin), so a caller can
 * paint it once and turn the image. `dir` is the snail's way of travel.
 */
export function drawProjectileBody(ctx: CanvasRenderingContext2D, kind: string, dir: 1 | -1, t: number): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (kind) {
    case 'shell':
      rocketArt(ctx, OLIVE, OLIVE_DARK, t);
      break;
    case 'missile':
      rocketArt(ctx, '#9aa0a5', '#c4473a', t);
      break;
    case 'homing':
      rocketArt(ctx, '#d9d4c4', '#3f72b4', t);
      ctx.fillStyle = '#ffe9a0';
      ctx.beginPath();
      ctx.arc(3.3, 0, 0.55, 0, TAU);
      ctx.fill();
      break;
    case 'borer':
      rocketArt(ctx, '#8a6a3a', '#5a4022', t);
      drillTip(ctx, 4.2, t);
      break;
    case 'mortar':
      mortarShell(ctx);
      break;
    case 'pod':
      podArt(ctx, 0, 0);
      break;
    case 'seed':
      seedArt(ctx);
      break;
    case 'jar':
      jarArt(ctx, 0);
      break;
    case 'snail':
      ctx.scale(dir, 1);
      snailArt(ctx, 0, 1.5, t);
      break;
    case 'stone':
      millstoneArt(ctx);
      break;
    case 'mine':
    case 'barrel':
      drawObject(ctx, kind, t, false);
      break;
    case 'grenade':
      grenadeArt(ctx, '#7a9548', 0);
      break;
    case 'cluster':
      clusterArt(ctx, 0);
      break;
    case 'bit':
      shape(ctx, '#5a3a24', (p) => {
        p.moveTo(-1.4, -0.6);
        p.lineTo(0.2, -1.4);
        p.lineTo(1.4, -0.2);
        p.lineTo(0.6, 1.3);
        p.lineTo(-1.1, 0.9);
        p.closePath();
      }, 0.6);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-0.6, -0.8, 0.8, 0.5);
      break;
    case 'dynamite':
      dynamiteArt(ctx, 0, true, t);
      break;
    default:
      shape(ctx, '#4b5157', (p) => p.arc(0, 0, 1.8, 0, TAU), 0.7);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(-0.6, -0.6, 0.6, 0, TAU);
      ctx.fill();
  }
  ctx.restore();
}

/**
 * Whether a mine's lamp is lit at `now` (ms). Once armed it flashes briefly every second, so a mine can be found on
 * the map; tripped, it blinks fast until it goes off; a dud is dark. Each mine's flash is offset by its id, so a
 * field of them does not pulse as one. A mine still arming is dark: the light says it can now be set off.
 */
export function mineLit(o: Pick<Obj, 'id' | 'fuse' | 'dud' | 'arm'>, now: number): boolean {
  if (o.dud) return false;
  if (o.fuse >= 0) return Math.floor(now / 150) % 2 === 0;
  return o.arm === 0 && (now + o.id * 337) % 1000 < 180;
}

/**
 * Mines and barrels lying on the land, base on y = +2. `armed` blinks a mine's
 * lamp on `t` at the tripped rate. Any other kind draws as a barrel.
 */
export function drawObject(ctx: CanvasRenderingContext2D, kind: string, t: number, armed: boolean): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === 'mine') mineArt(ctx, 0, 0.2, armed && Math.floor(t / 150) % 2 === 0);
  else {
    const drum = new Path2D();
    drum.roundRect(-3, -5.6, 6, 7.6, 1.0);
    ctx.fillStyle = '#b4532f';
    ctx.fill(drum);
    ctx.save();
    ctx.clip(drum);
    ctx.fillStyle = '#8a3a20';
    ctx.fillRect(-3, -3.4, 6, 0.8);
    ctx.fillRect(-3, -0.2, 6, 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(-2.2, -5.2, 0.8, 7);
    ctx.restore();
    ctx.strokeStyle = C.outline;
    ctx.lineWidth = 0.75;
    ctx.stroke(drum);
    // A drop on the side says what is inside.
    ctx.fillStyle = '#f1d27a';
    ctx.beginPath();
    ctx.moveTo(0.6, -2.6);
    ctx.quadraticCurveTo(1.6, -1.2, 0.6, -0.9);
    ctx.quadraticCurveTo(-0.4, -1.2, 0.6, -2.6);
    ctx.fill();
  }
  ctx.restore();
}

const CRATE_LOOK: Record<CrateKind, { wood: string; edge: string }> = {
  weapon: { wood: '#a87a45', edge: '#6f4c26' },
  health: { wood: '#e6e1d4', edge: '#9d978a' },
  utility: { wood: '#7d8f9e', edge: '#4f5f6c' },
};

/**
 * A crate in world px, centred on the box the rules collide with (12 x 12), with
 * its parachute above while `chute` is open. The mark on the side says what is in it.
 */
export function drawCrate(ctx: CanvasRenderingContext2D, kind: CrateKind, chute: boolean, t: number): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (chute) drawParachute(ctx, t);
  const look = CRATE_LOOK[kind];
  shape(ctx, look.wood, (p) => p.rect(-6, -6, 12, 12), 0.8);
  ctx.strokeStyle = look.edge;
  ctx.lineWidth = 1.1;
  ctx.strokeRect(-5.1, -5.1, 10.2, 10.2);
  if (kind === 'health') {
    ctx.fillStyle = '#c4473a';
    ctx.fillRect(-1.1, -3.6, 2.2, 7.2);
    ctx.fillRect(-3.6, -1.1, 7.2, 2.2);
  } else if (kind === 'weapon') {
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-4.6, 4.6);
    ctx.lineTo(4.6, -4.6);
    ctx.stroke();
  } else {
    ctx.strokeStyle = '#e6e1d4';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const x of [-2.4, 0.2]) {
      ctx.moveTo(x, -2.2);
      ctx.lineTo(x + 2.2, 0);
      ctx.lineTo(x, 2.2);
    }
    ctx.stroke();
  }
  ctx.restore();
}

// Gravestone

/** Where a slug was: a headstone with a slug carved in it, base on y = +8 like a slug's feet. */
export function drawGravestone(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  shape(ctx, '#6b5a48', (p) => p.ellipse(0, 8, 6.4, 1.6, 0, Math.PI, TAU), 0.7);
  const stone = new Path2D();
  stone.moveTo(-4.4, 8);
  stone.lineTo(-4.4, -1.6);
  stone.arc(0, -1.6, 4.4, Math.PI, TAU);
  stone.lineTo(4.4, 8);
  stone.closePath();
  ctx.fillStyle = '#7f827d';
  ctx.fill(stone);
  ctx.save();
  ctx.clip(stone);
  ctx.fillStyle = '#a9aca6';
  ctx.beginPath();
  ctx.arc(-0.8, -2.4, 4.6, 0, TAU);
  ctx.rect(-5.2, -2.4, 4.4, 11);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#2e2f2c';
  ctx.lineWidth = 0.85;
  ctx.stroke(stone);
  // A little slug carved in, so the stone says whose it is.
  ctx.strokeStyle = '#5f625d';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-2.6, 3.2);
  ctx.lineTo(1.4, 3.2);
  ctx.quadraticCurveTo(2.4, 3.1, 2.3, 1.4);
  ctx.quadraticCurveTo(2.0, -0.2, 0.9, 0.4);
  ctx.quadraticCurveTo(0.4, 1.6, 0.2, 2.4);
  ctx.quadraticCurveTo(-1.2, 2.9, -2.6, 3.2);
  ctx.moveTo(1.4, 0.5);
  ctx.lineTo(1.6, -1.1);
  ctx.moveTo(2.0, 0.7);
  ctx.lineTo(2.7, -0.7);
  ctx.stroke();
  ctx.strokeStyle = '#4e514c';
  ctx.lineWidth = 0.45;
  ctx.beginPath();
  ctx.moveTo(3.2, -3.4);
  ctx.lineTo(2.3, -2.0);
  ctx.lineTo(2.8, -1.0);
  ctx.stroke();
  ctx.restore();
}

// Movement gear

/**
 * A jetpack strapped to the slug's back, in the slug's own frame (origin at its
 * centre, feet at y = +8). Draw it after drawSlug with the same transform.
 * `up` fires both nozzles straight down, to about y = +12; `side` (the rules turn
 * the slug to face the way it pushes) swings the flames back behind it, and with
 * both they lean halfway, so each key shows as the push it gives.
 */
export function drawJetpack(ctx: CanvasRenderingContext2D, facing: 1 | -1, up: boolean, side: boolean, t: number): void {
  ctx.save();
  ctx.scale(facing, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(-3.6, -3.2);
  ctx.quadraticCurveTo(0.5, -4.6, 3.9, -3.0);
  ctx.stroke();
  ctx.strokeStyle = '#5a4630';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  if (up || side) {
    const swing = up ? (side ? 0.5 : 0) : 1.05;
    const reach = up ? (side ? 6 : 5.5) : 4.5;
    for (const nx of [-6.6, -4.4]) {
      const len = reach + Math.sin(t / 37 + nx) * 1.2 + Math.sin(t / 23) * 0.6;
      ctx.save();
      ctx.translate(nx, 4.4);
      ctx.rotate(swing);
      shape(ctx, '#ec7f2a', (p) => {
        p.moveTo(-0.85, 0);
        p.quadraticCurveTo(-0.6, len * 0.7, 0, len);
        p.quadraticCurveTo(0.6, len * 0.7, 0.85, 0);
        p.closePath();
      }, 0.45);
      ctx.fillStyle = '#fff1b8';
      ctx.beginPath();
      ctx.ellipse(0, 0.5 + len * 0.2, 0.4, len * 0.3, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }
  for (const nx of [-6.6, -4.4]) {
    shape(ctx, STEEL_DARK, (p) => {
      p.moveTo(nx - 0.6, 3.0);
      p.lineTo(nx + 0.6, 3.0);
      p.lineTo(nx + 0.85, 4.5);
      p.lineTo(nx - 0.85, 4.5);
      p.closePath();
    }, 0.5);
    shape(ctx, '#b8423a', (p) => p.roundRect(nx - 1.1, -4.2, 2.2, 7.4, 1.1), 0.7);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(nx - 0.6, -3.4, 0.5, 5.6);
  }
  shape(ctx, '#9aa0a5', (p) => p.roundRect(-7.4, -1.0, 3.8, 1.3, 0.3), 0.5);
  ctx.restore();
}

/**
 * A parachute over the slug, in the slug's frame: the canopy spans about
 * x ±12, y −28 to −15, and the lines meet the head at y ≈ −6. Draw it
 * before drawSlug so the lines go behind the body. It sways with `t`.
 */
export function drawParachute(ctx: CanvasRenderingContext2D, t: number): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const sway = Math.sin(t / 420) * 0.08;
  ctx.translate(0, -6);
  ctx.rotate(sway);
  const R = 11.5;
  const cy = -11;
  const panels = 5;
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  for (let k = 0; k <= panels; k++) {
    const a = Math.PI + (k / panels) * Math.PI;
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * R, cy + Math.sin(a) * R * 0.25 + 1.2);
  }
  ctx.stroke();
  for (let k = 0; k < panels; k++) {
    const a0 = Math.PI + (k / panels) * Math.PI;
    const a1 = Math.PI + ((k + 1) / panels) * Math.PI;
    shape(ctx, k % 2 === 0 ? '#e9e2d0' : '#c4553f', (p) => {
      p.moveTo(Math.cos(a0) * R, cy + Math.sin(a0) * R * 0.25 + 1.2);
      p.ellipse(0, cy, R, R * 0.9, 0, a0, a1);
      p.lineTo(Math.cos(a1) * R, cy + Math.sin(a1) * R * 0.25 + 1.2);
      p.quadraticCurveTo(
        Math.cos((a0 + a1) / 2) * R * 0.95,
        cy + Math.sin((a0 + a1) / 2) * R * 0.25 + 0.4,
        Math.cos(a0) * R,
        cy + Math.sin(a0) * R * 0.25 + 1.2,
      );
      p.closePath();
    }, 0.7);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(0, cy, R * 0.72, R * 0.66, 0, Math.PI * 1.2, Math.PI * 1.45);
  ctx.stroke();
  ctx.restore();
}

/** One straight run of rope between two points, in whatever frame the caller is drawing (e.g. world px). */
export function drawRope(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = '#b48a4f';
  ctx.lineWidth = 0.85;
  ctx.stroke();
  // The twist marks step along the rope at a fixed pitch so it reads as laid strands at any length.
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  ctx.strokeStyle = '#7d5a2e';
  ctx.lineWidth = 0.3;
  ctx.beginPath();
  for (let d = 0.8; d < len; d += 1.6) {
    const cx = x0 + ux * d;
    const cy = y0 + uy * d;
    ctx.moveTo(cx - ux * 0.35 - uy * 0.4, cy - uy * 0.35 + ux * 0.4);
    ctx.lineTo(cx + ux * 0.35 + uy * 0.4, cy + uy * 0.35 - ux * 0.4);
  }
  ctx.stroke();
  ctx.restore();
}

// Zip lines

const TIMBER = { body: '#8a6236', light: '#a87c4a', dark: '#6b4a28', grain: '#5a3d20' };

/**
 * A zip line's post, origin at the eye the cable is tied to and its foot on the ground at
 * y = +24 (the rules' ZIP_POST). `toward` is the way its cable runs. The timber stands just
 * behind the eye so the cable leaves it clean, and a guy rope runs back to a peg, which is what
 * keeps a post upright with a cable pulling on it. Lit from the upper left whichever way it faces.
 */
export function drawZipPost(ctx: CanvasRenderingContext2D, toward: 1 | -1): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const px0 = -toward * 2.2;
  const pegX = px0 - toward * 9.5;
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(px0 - toward * 1.2, -1.2);
  ctx.lineTo(pegX, 22.6);
  ctx.stroke();
  ctx.strokeStyle = '#b48a4f';
  ctx.lineWidth = 0.5;
  ctx.stroke();
  shape(ctx, TIMBER.body, (p) => {
    p.moveTo(pegX - 0.7, 21.6);
    p.lineTo(pegX + 0.7, 21.6);
    p.lineTo(pegX + 0.5, 24.4);
    p.lineTo(pegX - 0.5, 24.4);
    p.closePath();
  }, 0.5);

  const post = new Path2D();
  post.moveTo(px0 - 1.5, 24.6);
  post.lineTo(px0 - 1.5, -2.2);
  post.lineTo(px0, -3.2);
  post.lineTo(px0 + 1.5, -2.2);
  post.lineTo(px0 + 1.5, 24.6);
  post.closePath();
  ctx.fillStyle = TIMBER.body;
  ctx.fill(post);
  ctx.save();
  ctx.clip(post);
  ctx.fillStyle = TIMBER.light;
  ctx.fillRect(px0 - 1.5, -3.2, 0.8, 28);
  ctx.beginPath();
  ctx.moveTo(px0 - 1.5, -2.2);
  ctx.lineTo(px0, -3.2);
  ctx.lineTo(px0, -2.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = TIMBER.dark;
  ctx.fillRect(px0 + 0.6, -3.2, 0.9, 28);
  // Grain runs the length of the post and bends round one knot.
  ctx.strokeStyle = TIMBER.grain;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 0.25;
  ctx.beginPath();
  ctx.moveTo(px0 - 0.4, -1.6);
  ctx.bezierCurveTo(px0 - 0.5, 6, px0 - 0.9, 10, px0 - 0.6, 14.2);
  ctx.bezierCurveTo(px0 - 0.3, 18, px0 - 0.4, 21, px0 - 0.5, 24.6);
  ctx.moveTo(px0 + 0.5, 3);
  ctx.bezierCurveTo(px0 + 0.3, 9.4, px0 + 0.9, 11, px0 + 0.4, 14.6);
  ctx.lineTo(px0 + 0.4, 22);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = TIMBER.grain;
  ctx.beginPath();
  ctx.ellipse(px0 + 0.05, 12.4, 0.45, 0.8, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.75;
  ctx.stroke(post);

  // An iron band holds the eye's bracket to the top of the post.
  shape(ctx, STEEL_DARK, (p) => p.rect(px0 - 1.8, -1.0, 3.6, 1.3), 0.5);
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 0.95, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = '#9aa0a5';
  ctx.lineWidth = 0.55;
  ctx.stroke();

  // Two stones packed round the foot.
  shape(ctx, '#8a8378', (p) => p.ellipse(px0 - 2.4, 24.1, 1.6, 1.1, 0, 0, TAU), 0.5);
  shape(ctx, '#7a7369', (p) => p.ellipse(px0 + 2.3, 24.4, 1.3, 0.9, 0, 0, TAU), 0.5);
  ctx.restore();
}

/**
 * The pulley a rider hangs from, origin on the cable. `slope` is the cable's angle there
 * (radians, positive running down to the right) and `spin` the wheel's turn. `blur` drops the
 * spokes: drawn at speed they strobe against the frame rate and seem to turn backwards. The
 * strap hangs straight down to y = +10, behind where the slug's head is when this is drawn
 * first, at ZIP_HANG above its centre.
 */
export function drawZipTrolley(ctx: CanvasRenderingContext2D, slope: number, spin: number, blur: boolean): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(0, 2.4);
  ctx.lineTo(0, 10);
  ctx.stroke();
  ctx.strokeStyle = '#c9b48a';
  ctx.lineWidth = 0.9;
  ctx.stroke();
  ctx.rotate(slope);
  shape(ctx, blur ? '#8b9298' : '#6f767c', (p) => p.arc(0, -1.75, 1.8, 0, TAU), 0.6);
  if (!blur) {
    ctx.strokeStyle = STEEL_DARK;
    ctx.lineWidth = 0.35;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * TAU) / 3;
      ctx.moveTo(0, -1.75);
      ctx.lineTo(Math.cos(a) * 1.45, -1.75 + Math.sin(a) * 1.45);
    }
    ctx.stroke();
  } else {
    ctx.strokeStyle = 'rgba(42,28,18,0.35)';
    ctx.lineWidth = 0.3;
    ctx.beginPath();
    ctx.arc(0, -1.75, 1.1, 0, TAU);
    ctx.stroke();
  }
  const plate = new Path2D();
  plate.moveTo(-0.7, -2.3);
  plate.lineTo(0.7, -2.3);
  plate.lineTo(0.9, -0.5);
  plate.lineTo(2.6, -0.5);
  plate.quadraticCurveTo(2.7, 1.9, 0.8, 2.1);
  plate.lineTo(-0.8, 2.1);
  plate.quadraticCurveTo(-2.7, 1.9, -2.6, -0.5);
  plate.lineTo(-0.9, -0.5);
  plate.closePath();
  ctx.fillStyle = STEEL_BODY;
  ctx.fill(plate);
  ctx.save();
  ctx.clip(plate);
  ctx.fillStyle = '#adb4ba';
  ctx.fillRect(-2.8, -0.5, 5.6, 0.6);
  ctx.fillStyle = '#5c6369';
  ctx.fillRect(-2.8, 1.3, 5.6, 1.0);
  ctx.restore();
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 0.6;
  ctx.stroke(plate);
  ctx.fillStyle = STEEL_DARK;
  ctx.beginPath();
  ctx.arc(0, -1.75, 0.5, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(0, 2.5, 0.6, 0, TAU);
  ctx.stroke();
  ctx.strokeStyle = '#9aa0a5';
  ctx.lineWidth = 0.45;
  ctx.stroke();
  ctx.restore();
}

/**
 * One straight run of a zip line's steel cable, like drawRope but finer and grey: thinner than
 * the rope so the two never read as the same thing, with its lay marked at a fixed pitch.
 */
export function drawZipCable(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): void {
  const len = Math.hypot(x1 - x0, y1 - y0);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.outline;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = '#a3aab0';
  ctx.lineWidth = 0.55;
  ctx.stroke();
  const ux = (x1 - x0) / len;
  const uy = (y1 - y0) / len;
  ctx.strokeStyle = '#646b71';
  ctx.lineWidth = 0.18;
  ctx.beginPath();
  for (let d = 0.5; d < len; d += 1) {
    const cx = x0 + ux * d;
    const cy = y0 + uy * d;
    ctx.moveTo(cx - ux * 0.2 - uy * 0.26, cy - uy * 0.2 + ux * 0.26);
    ctx.lineTo(cx + ux * 0.2 + uy * 0.26, cy + uy * 0.2 - ux * 0.26);
  }
  ctx.stroke();
  ctx.restore();
}
