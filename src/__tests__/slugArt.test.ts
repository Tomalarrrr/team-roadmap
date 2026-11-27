import { afterEach, describe, it, expect, vi } from 'vitest';
import { drawProjectile, edgeDistance, hash3, paintTerrain, repaintArea, terrainPixels, valueNoise } from '../components/slugs/slugArt';
import { THEME_IDS } from '../components/slugs/slugThemes';
import { buildTerrain, H, W, type ProjKind } from '../slugsGameLogic';

describe('noise', () => {
  it('hash3 is a pure unsigned 32-bit function of its inputs', () => {
    expect(hash3(5, 9, 7)).toBe(hash3(5, 9, 7));
    expect(hash3(5, 9, 7)).not.toBe(hash3(5, 9, 8));
    expect(hash3(5, 9, 7)).not.toBe(hash3(9, 5, 7));
    for (let i = -50; i < 50; i++) {
      const v = hash3(i, i * 3, 11);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('valueNoise stays in [0, 1], is continuous, and matches the lattice at grid points', () => {
    let min = 1;
    let max = 0;
    for (let y = 0; y < 200; y += 3) {
      for (let x = 0; x < 200; x += 3) {
        const v = valueNoise(x, y, 20, 4);
        min = Math.min(min, v);
        max = Math.max(max, v);
        expect(Math.abs(valueNoise(x + 0.5, y, 20, 4) - v)).toBeLessThan(0.08);
      }
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);
    expect(max - min).toBeGreaterThan(0.5);
    expect(valueNoise(40, 60, 20, 4)).toBeCloseTo((hash3(2, 3, 4) & 1023) / 1023, 10);
  });
});

describe('edgeDistance', () => {
  // A 30-wide, 7-tall strip of land in the middle of a 40×20 map.
  const w = 40;
  const h = 20;
  const mask = new Uint8Array(w * h);
  for (let y = 6; y < 13; y++) for (let x = 5; x < 35; x++) mask[y * w + x] = 1;

  it('is 0 in air, 3 on the edge and grows by 3 per pixel inward', () => {
    const d = edgeDistance(mask, w, h, 0, 0, w, h);
    expect(d[0]).toBe(0);
    expect(d[5 * w + 20]).toBe(0);
    expect(d[6 * w + 20]).toBe(3);
    expect(d[7 * w + 20]).toBe(6);
    expect(d[9 * w + 20]).toBe(12);
    expect(d[12 * w + 20]).toBe(3);
    expect(d[7 * w + 6]).toBe(6);
  });

  it('charges 4 for a diagonal step to air', () => {
    const m = new Uint8Array(60 * 60).fill(1);
    m[30 * 60 + 30] = 0;
    const d = edgeDistance(m, 60, 60, 0, 0, 60, 60);
    expect(d[30 * 60 + 31]).toBe(3);
    expect(d[31 * 60 + 31]).toBe(4);
    expect(d[32 * 60 + 32]).toBe(8);
  });

  it('caps at 33 and treats off-map as air', () => {
    const full = new Uint8Array(60 * 60).fill(1);
    const d = edgeDistance(full, 60, 60, 0, 0, 60, 60);
    expect(d[0]).toBe(3);
    expect(d[10 * 60 + 10]).toBe(33);
    expect(d[30 * 60 + 30]).toBe(33);
  });

  it('gives the same values for a sub-rectangle as for the whole map', () => {
    const whole = edgeDistance(mask, w, h, 0, 0, w, h);
    const part = edgeDistance(mask, w, h, 10, 4, 25, 15);
    for (let y = 4; y < 15; y++) for (let x = 10; x < 25; x++) expect(part[(y - 4) * 15 + x - 10]).toBe(whole[y * w + x]);
  });
});

describe('terrainPixels', () => {
  const mask = buildTerrain(3);
  const box = [700, 420, 900, 620] as const;

  it('paints the same pixels for the same seed', () => {
    const a = terrainPixels(mask, W, H, 'tropical', 3, ...box, null);
    const b = terrainPixels(mask, W, H, 'tropical', 3, ...box, null);
    expect(a.length).toBe(200 * 200 * 4);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('paints different pixels for a different seed on the same land', () => {
    const a = terrainPixels(mask, W, H, 'tropical', 3, ...box, null);
    const b = terrainPixels(mask, W, H, 'tropical', 4, ...box, null);
    let land = 0;
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (a[i + 3] === 0) continue;
      land++;
      if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) diff++;
    }
    expect(land).toBeGreaterThan(5000);
    expect(diff).toBeGreaterThan(land / 4);
  });

  it('agrees with a full paint when asked for a sub-rectangle', () => {
    const big = terrainPixels(mask, W, H, 'canyon', 3, 600, 370, 1000, 670, null);
    const part = terrainPixels(mask, W, H, 'canyon', 3, ...box, null);
    for (let y = 420; y < 620; y += 7) {
      for (let x = 700; x < 900; x += 5) {
        const p = ((y - 420) * 200 + x - 700) * 4;
        const q = ((y - 370) * 400 + x - 600) * 4;
        expect([part[p], part[p + 1], part[p + 2], part[p + 3]]).toEqual([big[q], big[q + 1], big[q + 2], big[q + 3]]);
      }
    }
  });

  it('leaves air transparent and land opaque away from the surface, in every theme', () => {
    const w = 60;
    const h = 60;
    const m = new Uint8Array(w * h);
    for (let y = 30; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = 1;
    for (const id of THEME_IDS) {
      const px = terrainPixels(m, w, h, id, 1, 0, 0, w, h, null);
      expect(px[(5 * w + 30) * 4 + 3]).toBe(0);
      expect(px[(50 * w + 30) * 4 + 3]).toBe(255);
    }
  });

  it('paints girders (mask 2) in steel, not soil', () => {
    const w = 60;
    const h = 40;
    const m = new Uint8Array(w * h);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 50; x++) m[y * w + x] = 2;
    const px = terrainPixels(m, w, h, 'tropical', 1, 0, 0, w, h, null);
    const at = (x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 3));
    expect(at(10, 20)).toEqual([0x1f, 0x22, 0x26]);
    expect(at(30, 11)).toEqual([0xad, 0xb4, 0xba]);
    // (31 + 20) % 11 !== 0, so this is plain plate.
    expect(at(31, 20)).toEqual([0x7f, 0x87, 0x8e]);
  });

  it('grows no grass over bare (scorched) ground', () => {
    const w = 120;
    const h = 60;
    const m = new Uint8Array(w * h);
    for (let y = 30; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = 1;
    const grassAbove = (px: Uint8ClampedArray) => {
      let n = 0;
      for (let x = 0; x < w; x++) if (px[(29 * w + x) * 4 + 3] > 0) n++;
      return n;
    };
    expect(grassAbove(terrainPixels(m, w, h, 'tropical', 1, 0, 0, w, h, null))).toBeGreaterThan(20);
    const scorch = new Uint8Array(w * h);
    for (let y = 30; y < 42; y++) scorch.fill(1, y * w, y * w + w);
    expect(grassAbove(terrainPixels(m, w, h, 'tropical', 1, 0, 0, w, h, scorch))).toBe(0);
  });

  it('darkens burnt ground towards the theme scorch colour', () => {
    const w = 40;
    const h = 40;
    const m = new Uint8Array(w * h).fill(1);
    const plain = terrainPixels(m, w, h, 'countryside', 2, 0, 0, w, h, null);
    const scorch = new Uint8Array(w * h).fill(255);
    const burnt = terrainPixels(m, w, h, 'countryside', 2, 0, 0, w, h, scorch);
    const i = (20 * w + 20) * 4;
    const lum = (p: Uint8ClampedArray) => p[i] + p[i + 1] + p[i + 2];
    expect(lum(burnt)).toBeLessThan(lum(plain) * 0.6);
  });
});

describe('terrainPixels at 2 canvas px per world px', () => {
  const w = 60;
  const h = 60;
  const alpha = (px: Uint8ClampedArray, fw: number, fx: number, fy: number) => px[(fy * fw + fx) * 4 + 3];
  const partial = (px: Uint8ClampedArray) => {
    let n = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0 && px[i] < 255) n++;
    return n;
  };

  it('paints twice the size each way and agrees with a bigger paint over the same box', () => {
    const mask = buildTerrain(3);
    const big = terrainPixels(mask, W, H, 'canyon', 3, 600, 370, 1000, 670, null, 2);
    const part = terrainPixels(mask, W, H, 'canyon', 3, 700, 420, 900, 620, null, 2);
    expect(part.length).toBe(400 * 400 * 4);
    let land = 0;
    for (let y = 0; y < 400; y += 3) {
      for (let x = 0; x < 400; x += 3) {
        const p = (y * 400 + x) * 4;
        const q = ((y + 100) * 800 + x + 200) * 4;
        if (part[p + 3] > 0) land++;
        expect([part[p], part[p + 1], part[p + 2], part[p + 3]]).toEqual([big[q], big[q + 1], big[q + 2], big[q + 3]]);
      }
    }
    expect(land).toBeGreaterThan(1000);
  });

  it('gives a slanted edge partial cover, and none at 1 px per world px', () => {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x + y * 0.5 > 40) m[y * w + x] = 1;
    expect(partial(terrainPixels(m, w, h, 'canyon', 1, 0, 0, w, h, null, 1))).toBe(0);
    // About one partly covered px per canvas row the edge crosses (120 rows).
    expect(partial(terrainPixels(m, w, h, 'canyon', 1, 0, 0, w, h, null, 2))).toBeGreaterThan(80);
  });

  it('keeps a straight side exactly where the mask has it, with no soft px', () => {
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 30; x < w; x++) m[y * w + x] = 1;
    const px = terrainPixels(m, w, h, 'canyon', 1, 0, 0, w, h, null, 2);
    for (let fy = 20; fy < 100; fy += 9) {
      expect(alpha(px, 120, 59, fy)).toBe(0);
      expect(alpha(px, 120, 60, fy)).toBe(255);
    }
    expect(partial(px.subarray(20 * 120 * 4, 100 * 120 * 4))).toBe(0);
  });

  it('rounds off a square corner', () => {
    const m = new Uint8Array(w * h);
    for (let y = 30; y < h; y++) for (let x = 30; x < w; x++) m[y * w + x] = 1;
    const px = terrainPixels(m, w, h, 'canyon', 1, 0, 0, w, h, null, 2);
    // The mask's corner px is land; its outermost canvas px falls outside the smoothed outline.
    expect(alpha(px, 120, 60, 60)).toBe(0);
    expect(alpha(px, 120, 61, 61)).toBeGreaterThan(0);
    expect(alpha(px, 120, 61, 61)).toBeLessThan(255);
    expect(alpha(px, 120, 62, 62)).toBe(255);
  });

  it('keeps a strand one world px thick, which the smoothing alone would wipe out', () => {
    const m = new Uint8Array(w * h);
    for (let x = 10; x < 50; x++) m[30 * w + x] = 1;
    const px = terrainPixels(m, w, h, 'canyon', 1, 0, 0, w, h, null, 2);
    for (let fx = 30; fx < 90; fx += 7) {
      expect(alpha(px, 120, fx, 60)).toBe(255);
      expect(alpha(px, 120, fx, 61)).toBe(255);
    }
  });

  it('lights the top of a slab and shades its underside', () => {
    const m = new Uint8Array(w * h);
    for (let y = 15; y < 45; y++) for (let x = 0; x < w; x++) m[y * w + x] = 1;
    for (const k of [1, 2] as const) {
      const px = terrainPixels(m, w, h, 'canyon', 1, 0, 0, w, h, null, k);
      const lum = (y0: number, y1: number) => {
        let s = 0;
        for (let fy = y0 * k; fy < y1 * k; fy++) for (let fx = 5 * k; fx < 55 * k; fx++) s += px[(fy * w * k + fx) * 4] + px[(fy * w * k + fx) * 4 + 1] + px[(fy * w * k + fx) * 4 + 2];
        return s / ((y1 - y0) * k * 50 * k);
      };
      const middle = lum(28, 32);
      expect(lum(16, 19)).toBeGreaterThan(middle * 1.2);
      expect(lum(41, 45)).toBeLessThan(middle * 0.75);
    }
  });
});

const jsdomImageData = globalThis.ImageData;

describe('repaintArea', () => {
  afterEach(() => {
    globalThis.ImageData = jsdomImageData;
    vi.restoreAllMocks();
  });

  /** jsdom has no 2D canvas: this keeps what each putImageData was given. */
  function catchPuts() {
    const puts: { data: Uint8ClampedArray; w: number; h: number; x: number; y: number }[] = [];
    globalThis.ImageData = class {
      data: Uint8ClampedArray;
      width: number;
      height: number;
      constructor(data: Uint8ClampedArray, width: number, height: number) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    } as never;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      putImageData: (img: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number) => puts.push({ data: img.data, w: img.width, h: img.height, x, y }),
    }) as never);
    return puts;
  }

  it('repaints the crater box grown by its rim, in canvas px, and grows no grass inside the crater', () => {
    const puts = catchPuts();
    const mask = buildTerrain(3);
    const canvas = paintTerrain(mask, W, H, 'tropical', 3, undefined, 2);
    expect([canvas.width, canvas.height, puts[0].w, puts[0].h]).toEqual([W * 2, H * 2, W * 2, H * 2]);
    let cy = 0;
    while (mask[cy * W + 800] === 0) cy++;
    cy += 10;
    const cx = 800;
    const r = 25;
    const cut = mask.slice();
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) cut[y * W + x] = 0;
    const box = repaintArea(canvas, cut, W, H, 'tropical', 3, cx - r, cy - r, cx + r, cy + r)!;
    expect(box).toEqual({ x0: cx - r - 12, y0: cy - r - 12, x1: cx + r + 13, y1: cy + r + 13 });
    const put = puts[1];
    expect([put.x, put.y, put.w, put.h]).toEqual([box.x0 * 2, box.y0 * 2, (box.x1 - box.x0) * 2, (box.y1 - box.y0) * 2]);
    // Anything drawn well inside the hole is grass grown off the crater floor: the
    // floor's edge rounds out into air world px, and those are burnt too.
    let drawn = 0;
    for (let fy = 0; fy < put.h; fy++) {
      for (let fx = 0; fx < put.w; fx++) {
        const x = box.x0 + fx / 2;
        const y = box.y0 + fy / 2;
        if ((x - cx) ** 2 + (y - cy) ** 2 < (r - 2) ** 2 && put.data[(fy * put.w + fx) * 4 + 3] > 0) drawn++;
      }
    }
    expect(drawn).toBe(0);
  });

  it('returns null for a box off the map', () => {
    catchPuts();
    const mask = buildTerrain(3);
    const canvas = paintTerrain(mask, W, H, 'tropical', 3, undefined, 2);
    expect(repaintArea(canvas, mask, W, H, 'tropical', 3, W + 40, 10, W + 60, 30)).toBeNull();
  });
});

/**
 * jsdom has no 2D canvas, so this context only records what is drawn: method
 * names with their numeric arguments, and every style that is set.
 */
let log: string[] = [];
const record = (key: string, args: unknown[]) => log.push(`${key}(${args.filter((a) => typeof a === 'number').join(',')})`);

/** Path2D is missing from jsdom too; paths built with it record into the same log. */
class RecordingPath {
  constructor() {
    return new Proxy(this, { get: (_, key: string) => (...args: unknown[]) => record(`path.${key}`, args) });
  }
}
vi.stubGlobal('Path2D', RecordingPath);

function recorder(): { ctx: CanvasRenderingContext2D; log: string[] } {
  log = [];
  const target: Record<string, unknown> = {};
  const ctx = new Proxy(target, {
    get(_, key: string) {
      if (key in target) return target[key];
      return (...args: unknown[]) => record(key, args);
    },
    set(_, key: string, value) {
      target[key] = value;
      log.push(`${key}=${String(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

// Typed as a Record so tsc fails here when the rules add a kind this list lacks.
const PROJ_KINDS: Record<ProjKind, true> = {
  shell: true, grenade: true, cluster: true, bit: true, dynamite: true, missile: true, homing: true,
  mortar: true, pod: true, seed: true, jar: true, borer: true, snail: true, stone: true,
};

describe('drawProjectile', () => {
  const drawn = (kind: string) => {
    const r = recorder();
    drawProjectile(r.ctx, kind, 30, 500);
    return r.log.join(';');
  };

  it('has its own drawing for every kind the rules fire, not the fallback ball', () => {
    const fallback = drawn('not-a-kind');
    const seen = new Set<string>([fallback]);
    for (const kind of Object.keys(PROJ_KINDS)) {
      const d = drawn(kind);
      expect(d, kind).not.toBe(fallback);
      expect(seen.has(d), `${kind} draws the same as another kind`).toBe(false);
      seen.add(d);
    }
    expect(seen.size).toBe(Object.keys(PROJ_KINDS).length + 1);
  });
});
