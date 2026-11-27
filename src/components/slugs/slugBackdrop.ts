// The sky and skyline behind the battlefield, and the look of the water in
// front of it. Painted once per view size into canvases the screen tiles
// sideways; nothing here runs per frame except drawWaterInto, which only
// sends a few shapes to the engine's own vector drawing.
//
// Depth comes from aerial perspective: each layer is laid over with the
// theme's horizon haze, more the further back it is, so far shapes are paler,
// bluer and flatter. The sun sits high on the left, as on the land: faces
// turned left are lit, faces turned right fall into shade.

import { hash3 } from './slugArt';
import { THEMES, type Theme, type ThemeId } from './slugThemes';

const TAU = Math.PI * 2;

// Colour

type RGB = readonly [number, number, number];

const rgbOf = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1): string =>
  a >= 1 ? `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})` : `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a.toFixed(3)})`;
const toInt = (c: RGB): number => (Math.round(c[0]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[2]);

/** Relative luminance, 0 to 1. */
export function luminance(c: RGB): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG-style contrast ratio between two colours. */
export function contrast(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const WHITE: RGB = [255, 255, 255];

export interface LayerTone {
  body: RGB;
  /** Faces turned to the sun. */
  lit: RGB;
  /** Faces turned away; shadow out of doors takes the sky's colour. */
  shade: RGB;
}

/** How much of the horizon haze is laid over the far, middle and near skyline. */
export const HAZE = [0.68, 0.5, 0.36] as const;

/** Far, middle and near skyline colours: the theme's hills with the haze over them, and less light-and-shade the further back. */
export function layerTones(theme: ThemeId): LayerTone[] {
  const th = THEMES[theme];
  const haze = rgbOf(th.haze);
  const sky = rgbOf(th.skyTop);
  return th.hills.map((hex, i) => {
    const body = mix(rgbOf(hex), haze, HAZE[i]);
    const relief = 1 - HAZE[i];
    return {
      body,
      lit: mix(body, mix(haze, WHITE, 0.5), 0.3 * relief),
      shade: mix(body, mix(sky, [0, 0, 0], 0.55), 0.32 * relief),
    };
  });
}

// Noise that repeats every view width, so the layers tile

function loop(x: number, w: number, cells: number, seed: number): number {
  const u = ((((x / w) % 1) + 1) % 1) * cells;
  const i = Math.floor(u);
  let f = u - i;
  f = f * f * (3 - 2 * f);
  const a = hash3(i % cells, 0, seed) & 1023;
  const b = hash3((i + 1) % cells, 0, seed) & 1023;
  return (a + (b - a) * f) / 1023;
}

/** Octaves of loop noise in [0, 1]; ridged folds each octave into sharp crests, for rock. */
export function fbm(x: number, w: number, cells: number, octaves: number, seed: number, ridged = false): number {
  let v = 0;
  let amp = 1;
  let sum = 0;
  for (let o = 0; o < octaves; o++) {
    let n = loop(x, w, cells << o, seed + o * 101);
    if (ridged) n = (1 - Math.abs(2 * n - 1)) ** 2;
    v += n * amp;
    sum += amp;
    amp *= 0.5;
  }
  return v / sum;
}

/** A height line sampled across one period: ys[n] equals ys[0]. */
export interface Line {
  ys: Float32Array;
  step: number;
}

export function sampleLine(w: number, f: (x: number) => number): Line {
  const n = Math.max(8, Math.round(w / 4));
  const step = w / n;
  const ys = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) ys[i] = f(i * step);
  ys[n] = ys[0];
  return { ys, step };
}

/** Distance between two x positions on a loop `w` wide. */
function apart(a: number, b: number, w: number): number {
  const d = (((a - b) % w) + w) % w;
  return Math.min(d, w - d);
}

function yAt(l: Line, w: number, x: number): number {
  const u = (((x % w) + w) % w) / l.step;
  const i = Math.min(l.ys.length - 2, Math.floor(u));
  return l.ys[i] + (l.ys[i + 1] - l.ys[i]) * (u - i);
}

// Painting

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Draw at x and at x ± w so shapes crossing the seam tile cleanly. */
function wrapped(w: number, x: number, draw: (x: number) => void): void {
  draw(x);
  draw(x - w);
  draw(x + w);
}

/**
 * Fill from the line down to `bottom`, lighter at the crests where the high
 * sun reaches and settling to the body colour lower down. A rim of light
 * along the top keeps a silhouette crisp without an outline.
 */
function land(ctx: CanvasRenderingContext2D, w: number, l: Line, bottom: number, tone: LayerTone, light: number, rim = 0): void {
  const { ys, step } = l;
  const n = ys.length - 1;
  let top = bottom;
  for (let i = 0; i <= n; i++) top = Math.min(top, ys[i]);
  const g = ctx.createLinearGradient(0, top, 0, top + (bottom - top) * 0.7);
  g.addColorStop(0, css(mix(tone.body, tone.lit, light)));
  g.addColorStop(1, css(tone.body));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  for (let i = 0; i <= n; i++) ctx.lineTo(i * step, ys[i]);
  ctx.lineTo(w, bottom);
  ctx.closePath();
  ctx.fill();
  relief(ctx, w, l, top, bottom, tone);
  if (rim > 0) {
    ctx.strokeStyle = css(tone.lit, rim);
    ctx.lineWidth = Math.max(1, step * 0.4);
    ctx.beginPath();
    for (let i = 0; i <= n; i++) ctx.lineTo(i * step, ys[i]);
    ctx.stroke();
  }
}

/** 0 to 1: how far apart a layer's lit and shade tones are, so hazier layers get gentler modelling. */
function reliefOf(tone: LayerTone): number {
  return Math.min(1, Math.hypot(tone.lit[0] - tone.shade[0], tone.lit[1] - tone.shade[1], tone.lit[2] - tone.shade[2]) / 90);
}

/**
 * Model a filled skyline as a lit form, over what is already painted only.
 * A stretch climbing to the right faces the sun and takes light; one falling
 * away takes shade; each fades down into the body over a depth that grows
 * with the slope. Then brush dabs in the same tones, longer than tall, so the
 * face reads as painted rather than flat-filled.
 */
function relief(ctx: CanvasRenderingContext2D, w: number, l: Line, top: number, bottom: number, tone: LayerTone): void {
  const { ys, step } = l;
  const n = ys.length - 1;
  const strength = reliefOf(tone);
  if (strength < 0.05 || bottom - top < 4) return;
  const reach = Math.max(step * 8, (bottom - top) * 0.55);
  const span = 4;
  const raw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // Slope over a few samples either side, so roughness in the line doesn't flicker the light.
    const facing = (ys[(i - span + n) % n] - ys[(i + span) % n]) / (step * span * 2);
    raw[i] = Math.max(-1, Math.min(1, facing * 1.6));
  }
  // The light is laid as a small map, one column a sample, scaled up smoothly: shading column by column left a
  // vertical streak wherever neighbours read the slope differently, and a hard line under every summit.
  const rows = 48;
  const band = (bottom - top) / rows;
  const [map, mc] = makeCanvas(n, rows);
  const img = mc.createImageData(n, rows);
  const blur = 3;
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = -blur; j <= blur; j++) k += raw[(i + j + n) % n];
    k /= blur * 2 + 1;
    const a = Math.abs(k);
    const c = k > 0 ? tone.lit : tone.shade;
    const surface = Math.min(ys[i], ys[i + 1]);
    const deep = reach * (0.35 + 0.65 * a);
    for (let r = 0; r < rows; r++) {
      const below = top + (r + 0.5) * band - surface;
      const fade = below < 0 ? 1 : Math.max(0, 1 - below / deep);
      if (fade <= 0) continue;
      const p = (r * n + i) * 4;
      img.data[p] = c[0];
      img.data[p + 1] = c[1];
      img.data[p + 2] = c[2];
      img.data[p + 3] = Math.round(255 * a * 0.7 * strength * fade);
    }
  }
  mc.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(map, 0, top, w, bottom - top);

  const unit = ctx.canvas.height * 0.0055;
  const count = Math.min(5000, Math.round((w * (bottom - top)) / (unit * unit * 26)));
  const salt = Math.round(top * 7 + bottom);
  for (let d = 0; d < count; d++) {
    const r = (k: number) => ((hash3(d, k, salt) >>> 4) & 1023) / 1023;
    const x = r(1) * w;
    const surface = yAt(l, w, x);
    const y = surface + 2 + r(2) ** 1.6 * (bottom - surface);
    const len = unit * (0.8 + r(3) * 1.8);
    const pick = r(4);
    // Lit dabs gather near the crest, shade dabs lower down: the form's own light, broken up.
    const nearTop = 1 - (y - surface) / Math.max(1, bottom - surface);
    const c = pick < 0.3 + nearTop * 0.35 ? tone.lit : pick < 0.8 ? tone.shade : tone.body;
    ctx.fillStyle = css(c, (0.1 + r(5) * 0.14) * strength);
    ctx.beginPath();
    ctx.ellipse(x, y, len, len * (0.3 + r(6) * 0.25), (r(7) - 0.5) * 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export interface Peak {
  x: number;
  height: number;
  /** Drop per px across. */
  slope: number;
}

/** Summits spaced unevenly along the loop, a few standing well above the rest. */
function peaksAlong(w: number, count: number, low: number, high: number, rnd: Rnd, k: number): Peak[] {
  return Array.from({ length: count }, (_, i) => ({
    x: ((i + rnd(i, k) * 0.8) * w) / count,
    height: low + (high - low) * rnd(i, k + 1) ** 1.8,
    slope: 0.55 + rnd(i, k + 2) * 0.5,
  }));
}

/** A range from its summits, broken up by rock: rougher the higher it climbs. */
function rangeLine(w: number, base: number, peaks: readonly Peak[], rough: number, seed: number): Line {
  return sampleLine(w, (x) => {
    let lift = 0;
    for (const p of peaks) lift = Math.max(lift, p.height - apart(x, p.x, w) * p.slope);
    return base - lift - rough * fbm(x, w, 48, 3, seed, true) * (0.3 + Math.min(1, lift / (rough * 6)));
  });
}

/**
 * The shadowed east side of each summit: from the top, down its right flank
 * to the next valley, and back up a ragged spine. Laid only over the range
 * already painted.
 */
function flanks(ctx: CanvasRenderingContext2D, w: number, l: Line, peaks: readonly Peak[], bottom: number, tone: LayerTone, alpha: number, rnd: Rnd, k: number): void {
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = css(tone.shade, alpha);
  peaks.forEach((p, i) => {
    let sx = p.x;
    let sy = yAt(l, w, sx);
    // The noise moves the true top a little; find it.
    for (let dx = -p.height * 0.3; dx <= p.height * 0.3; dx += l.step) {
      const y = yAt(l, w, p.x + dx);
      if (y < sy) {
        sy = y;
        sx = p.x + dx;
      }
    }
    // Still climbing at the edge of the search: this summit is only a shoulder on a taller
    // neighbour's slope, and a shadow started there cuts straight down through that face.
    if (Math.abs(sx - p.x) > p.height * 0.3 - l.step * 1.5) return;
    const fall = bottom - sy;
    wrapped(w, sx, (x) => {
      ctx.beginPath();
      ctx.moveTo(x, sy);
      let ex = x;
      let last = sy;
      for (let d = l.step; d < p.height * 3; d += l.step) {
        const y = yAt(l, w, x + d);
        if (y < last - 1.5 && d > p.height * 0.2) break;
        ex = x + d;
        last = y;
        ctx.lineTo(ex, y);
      }
      const foot = x + fall * (0.15 + rnd(i, k) * 0.2);
      // The shadow closes as a wedge: from the valley the next spur's toe slants back west
      // until it meets the spine. A straight drop from the valley reads as a cut through the face.
      const lean = (foot - x) / fall;
      const meet = Math.min(bottom, (ex - x + lean * sy + 0.5 * last) / (lean + 0.5));
      for (let j = 1; j <= 4; j++) {
        const y = last + (meet - last) * (j / 4);
        ctx.lineTo(ex - (y - last) * 0.5 + (j < 4 ? (rnd(i * 8 + j, k + 2) - 0.5) * fall * 0.04 : 0), y);
      }
      if (meet >= bottom) ctx.lineTo(foot, bottom);
      for (let j = 5; j > 0; j--) {
        const t = (j / 6) * ((meet - sy) / fall);
        ctx.lineTo(x + (foot - x) * t + (rnd(i * 8 + j, k + 1) - 0.5) * fall * 0.08, sy + fall * t);
      }
      ctx.closePath();
      ctx.fill();
    });
  });
  ctx.globalCompositeOperation = 'source-over';
}

/** Mist pooling low down: over what is already painted only, fading in from `top`. */
function mist(ctx: CanvasRenderingContext2D, w: number, top: number, bottom: number, haze: RGB, alpha: number): void {
  const g = ctx.createLinearGradient(0, top, 0, bottom);
  g.addColorStop(0, css(haze, 0));
  g.addColorStop(1, css(haze, alpha));
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = g;
  ctx.fillRect(0, top, w, ctx.canvas.height - top);
  ctx.globalCompositeOperation = 'source-over';
}

type Rnd = (i: number, k: number) => number;

function disc(p: Path2D, x: number, y: number, r: number): void {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

/**
 * A leaf clump painted in three goes: its whole shape in shade, the body
 * shifted toward the sun so the shade is left only on the underside, and a
 * lit patch on top when it faces the sun (`sun` -1 to 1).
 */
function clump(shade: Path2D, body: Path2D, lit: Path2D, x: number, y: number, r: number, sun: number): void {
  disc(shade, x, y, r);
  disc(body, x - r * 0.13, y - r * 0.17, r * 0.8);
  if (sun > -0.25) disc(lit, x - r * 0.32, y - r * 0.36, r * (0.3 + 0.22 * Math.max(0, sun)));
}

function fillClumps(ctx: CanvasRenderingContext2D, tone: LayerTone, shade: Path2D, body: Path2D, lit: Path2D): void {
  ctx.fillStyle = css(tone.shade);
  ctx.fill(shade);
  ctx.fillStyle = css(tone.body);
  ctx.fill(body);
  ctx.fillStyle = css(tone.lit, 0.7);
  ctx.fill(lit);
}

/**
 * A broadleaf tree: a dome of leaf clumps on a tapering trunk, each clump
 * darker underneath, those on the upper left catching the sun. Crowns vary
 * in width and lean so a row of them never repeats.
 */
function tree(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tone: LayerTone, rnd: Rnd, i: number): void {
  const top = y - r * 1.45;
  const lean = (rnd(i, 2) - 0.5) * 0.35 * r;
  ctx.fillStyle = css(tone.shade);
  ctx.beginPath();
  ctx.moveTo(x - r * 0.13, y);
  ctx.lineTo(x - r * 0.05 + lean * 0.5, top + r * 0.3);
  ctx.lineTo(x + r * 0.05 + lean * 0.5, top + r * 0.3);
  ctx.lineTo(x + r * 0.13, y);
  ctx.fill();
  const shade = new Path2D();
  const body = new Path2D();
  const lit = new Path2D();
  const cx = x + lean;
  const wide = 0.85 + rnd(i, 3) * 0.45;
  clump(shade, body, lit, cx + r * 0.1, top + r * 0.35, r * 0.62, -1);
  const clumps = 5 + Math.floor(rnd(i, 1) * 4);
  for (let k = 0; k < clumps; k++) {
    // Round the upper half of the crown, left to right.
    const a = Math.PI * (0.95 + (k / (clumps - 1)) * 1.1) + (rnd(i, 10 + k) - 0.5) * 0.4;
    const d = r * (0.38 + rnd(i, 20 + k) * 0.3);
    const lx = cx + Math.cos(a) * d * wide;
    const ly = top + Math.sin(a) * d * 0.85 + r * 0.1;
    clump(shade, body, lit, lx, ly, r * (0.34 + rnd(i, 30 + k) * 0.22), -Math.cos(a) * 0.7 - Math.sin(a) * 0.7);
  }
  clump(shade, body, lit, cx - r * 0.12, top - r * 0.05, r * 0.42, 0.6);
  fillClumps(ctx, tone, shade, body, lit);
}

/**
 * Trees bunched as a copse: sizes and spacing vary, a few stand further down
 * the slope in front, and the rest are drawn back to front. `tall` is the
 * share of poplars among them.
 */
function copse(ctx: CanvasRenderingContext2D, w: number, l: Line, cx: number, spread: number, count: number, r: number, tone: LayerTone, rnd: Rnd, k: number, tall: number): void {
  const trees = Array.from({ length: count }, (_, j) => {
    const i = k * 31 + j;
    const x = cx + (rnd(i, 200) - 0.5) * spread;
    const size = r * (0.55 + rnd(i, 201) ** 1.5 * 0.8);
    return { i, x, size, y: yAt(l, w, x) + size * 0.3 + rnd(i, 202) ** 2 * r * 0.9, poplar: rnd(i, 203) < tall };
  }).sort((a, b) => a.y - b.y);
  for (const t of trees) {
    wrapped(w, t.x, (x) => {
      if (t.poplar) poplar(ctx, x, t.y, t.size * 2.8, tone);
      else tree(ctx, x, t.y, t.size, tone, rnd, t.i);
    });
  }
}

/**
 * A hedgerow along the polyline `pts` (x, y pairs, left to right): one
 * merged mass with a lumpy top, rounded off where it breaks for a gate or a
 * gap (where the noise falls under `gaps`). Lit along its top, dark along its
 * foot, and casting a little shadow down-right onto the field.
 */
function hedge(ctx: CanvasRenderingContext2D, w: number, pts: readonly number[], size: number, tone: LayerTone, seed: number, gaps: number): void {
  const step = Math.max(3, size * 0.5);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let p = 0; p + 3 < pts.length; p += 2) {
    const dx = pts[p + 2] - pts[p];
    const dy = pts[p + 3] - pts[p + 1];
    const len = Math.hypot(dx, dy);
    for (let d = 0; d < len; d += step) {
      xs.push(pts[p] + (dx * d) / len);
      ys.push(pts[p + 1] + (dy * d) / len);
    }
  }
  const mass = new Path2D();
  const lit = new Path2D();
  const foot = new Path2D();
  const cast = new Path2D();
  const lumps = Math.max(8, Math.round(w / (size * 2.5)));
  const round = Math.max(1, (size * 2.5) / step);
  const open = xs.map((x, j) => fbm(x + ys[j] * 2, w, 24, 2, seed) >= gaps);
  let a = 0;
  while (a < xs.length) {
    if (!open[a]) {
      a++;
      continue;
    }
    let b = a;
    while (b + 1 < xs.length && open[b + 1]) b++;
    if (b - a >= 2) {
      const tops: number[] = [];
      const ends: number[] = [];
      for (let j = a; j <= b; j++) {
        const end = Math.min(1, (j - a) / round, (b - j) / round);
        ends.push(end);
        tops.push(size * (1.3 + 2 * fbm(xs[j], w, lumps, 3, seed + 1) ** 1.5) * Math.sqrt(end));
      }
      const band = (p: Path2D, upper: (j: number) => number, lower: (j: number) => number, shift = 0) => {
        p.moveTo(xs[a] + shift, upper(a));
        for (let j = a + 1; j <= b; j++) p.lineTo(xs[j] + shift, upper(j));
        for (let j = b; j >= a; j--) p.lineTo(xs[j] + shift, lower(j));
        p.closePath();
      };
      const base = (j: number) => ys[j] + size * 0.15 * ends[j - a];
      band(cast, base, (j) => base(j) + tops[j - a] * 0.35, size * 0.4);
      band(mass, (j) => ys[j] - tops[j - a], base);
      band(foot, (j) => ys[j] - tops[j - a] * 0.25, base);
      band(lit, (j) => ys[j] - tops[j - a], (j) => ys[j] - tops[j - a] * 0.55);
    }
    a = b + 1;
  }
  ctx.fillStyle = css(tone.shade, 0.3);
  ctx.fill(cast);
  ctx.fillStyle = css(tone.body);
  ctx.fill(mass);
  ctx.fillStyle = css(tone.shade, 0.55);
  ctx.fill(foot);
  ctx.fillStyle = css(tone.lit, 0.5);
  ctx.fill(lit);
}

/** Points along `l` from x0 to x1, `down` below it, as a hedge() polyline. */
function along(l: Line, w: number, x0: number, x1: number, down: (x: number) => number): number[] {
  const pts: number[] = [];
  const n = Math.max(1, Math.ceil((x1 - x0) / 12));
  for (let j = 0; j <= n; j++) {
    const x = x0 + ((x1 - x0) * j) / n;
    pts.push(x, yAt(l, w, x) + down(x));
  }
  return pts;
}

/** A tall, narrow tree; country lanes and fantasy groves both have them. */
function poplar(ctx: CanvasRenderingContext2D, x: number, y: number, hgt: number, tone: LayerTone): void {
  // No rnd here: callers place poplars by position, so the position seeds the shape.
  const seed = Math.round(x * 3 + hgt * 7);
  const r = (k: number) => ((hash3(k, seed, 91) >>> 4) & 1023) / 1023;
  ctx.fillStyle = css(tone.shade);
  ctx.fillRect(x - hgt * 0.015, y - hgt * 0.2, hgt * 0.03, hgt * 0.2);
  const shade = new Path2D();
  const body = new Path2D();
  const lit = new Path2D();
  const n = 7;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    // Widest a third of the way up, closing to a point.
    const half = hgt * 0.13 * Math.sin(Math.PI * Math.min(1, 0.2 + t * 0.95)) ** 0.8 * (0.85 + r(k) * 0.3);
    const cy = y - hgt * (0.12 + t * 0.74);
    const lx = x + (r(k + 10) - 0.5) * half * 0.5;
    // A floor on the size keeps the narrowing tip joined to the lobe below it.
    const lr = Math.max(hgt * 0.04, half);
    shade.moveTo(lx + lr, cy);
    shade.ellipse(lx, cy, lr, lr * 1.6, 0, 0, TAU);
    body.moveTo(lx - lr * 0.15 + lr * 0.78, cy - lr * 0.2);
    body.ellipse(lx - lr * 0.15, cy - lr * 0.2, lr * 0.78, lr * 1.4, 0, 0, TAU);
    lit.moveTo(lx - lr * 0.42 + lr * 0.32, cy - lr * 0.4);
    lit.ellipse(lx - lr * 0.42, cy - lr * 0.4, lr * 0.32, lr * 1.0, 0, 0, TAU);
  }
  fillClumps(ctx, tone, shade, body, lit);
}

/**
 * A fir in drooping tiers with ragged hems, the left of each tier lit and the
 * right in shade. With `snow`, it lies along the outer reach of each bough,
 * brighter on the sunny side, where the tier above doesn't cover it.
 */
function conifer(ctx: CanvasRenderingContext2D, x: number, y: number, hgt: number, tone: LayerTone, snow: RGB | null, rnd: Rnd, i: number): void {
  const tiers = 4 + Math.floor(rnd(i, 3) * 3);
  const wide = hgt * (0.22 + rnd(i, 4) * 0.1);
  const sway = (rnd(i, 5) - 0.5) * hgt * 0.04;
  ctx.fillStyle = css(tone.shade);
  ctx.fillRect(x - hgt * 0.025, y - hgt * 0.14, hgt * 0.05, hgt * 0.15);
  const body = new Path2D();
  const dark = new Path2D();
  const lit = new Path2D();
  const sunSnow = new Path2D();
  const shadeSnow = new Path2D();
  const at = (p: Path2D, pts: readonly number[]) => {
    p.moveTo(pts[0], pts[1]);
    for (let j = 2; j < pts.length; j += 2) p.lineTo(pts[j], pts[j + 1]);
    p.closePath();
  };
  for (let k = 0; k < tiers; k++) {
    const t = k / tiers;
    const base = y - hgt * (0.1 + t * 0.8);
    const apex = k === tiers - 1 ? y - hgt : base - hgt * (0.3 - t * 0.12);
    const half = wide * (1 - t * 0.72) * (0.85 + rnd(i, 40 + k) * 0.3);
    const droop = half * 0.3;
    const ax = x + sway * t;
    const lx = x - half;
    const rx = x + half;
    const hy = base + droop;
    // The hem, right to left: boughs hang in points with notches between.
    const hem: number[] = [];
    for (let j = 1; j < 5; j++) hem.push(rx - (2 * half * j) / 5, base + (j % 2 ? droop * 0.25 : droop * 0.85));
    at(body, [lx, hy, ax, apex, rx, hy, ...hem]);
    at(dark, [ax, apex, rx, hy, hem[0], hem[1], hem[2], hem[3], x + half * 0.05, base]);
    at(lit, [lx, hy, lx + (ax - lx) * 0.6, hy + (apex - hy) * 0.6, x - half * 0.35, base]);
    if (snow) {
      const thick = Math.max(1, hgt * 0.035);
      const reach = k === tiers - 1 ? 0.8 : 0.6;
      at(sunSnow, [lx - thick * 0.3, hy, lx + (ax - lx) * reach, hy + (apex - hy) * reach, lx + (ax - lx) * reach, hy + (apex - hy) * reach + thick, lx + thick, hy + thick * 0.6]);
      at(shadeSnow, [rx + thick * 0.3, hy, rx + (ax - rx) * reach * 0.8, hy + (apex - hy) * reach * 0.8, rx + (ax - rx) * reach * 0.8, hy + (apex - hy) * reach * 0.8 + thick * 0.8, rx - thick, hy + thick * 0.5]);
    }
  }
  ctx.fillStyle = css(tone.body);
  ctx.fill(body);
  ctx.fillStyle = css(tone.shade, 0.85);
  ctx.fill(dark);
  ctx.fillStyle = css(tone.lit, 0.5);
  ctx.fill(lit);
  if (snow) {
    ctx.fillStyle = css(snow);
    ctx.fill(sunSnow);
    ctx.fillStyle = css(mix(snow, tone.shade, 0.4));
    ctx.fill(shadeSnow);
  }
}

/**
 * A palm: a ringed trunk curving up to a crown of feathered fronds. Fronds
 * reaching up catch the sun and those hanging under the crown sit in its
 * shade, with the coconuts bunched between. `leaf` and `bark` come already
 * hazed for the layer.
 */
function palm(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, lean: number, leaf: LayerTone, bark: RGB, rnd: Rnd, i: number): void {
  const tx = x + lean * s * 0.5;
  const ty = y - s;
  const qx = x + lean * s * 0.05;
  const qy = y - s * 0.6;
  const steps = 14;
  const left: number[] = [];
  const mid: number[] = [];
  const right: number[] = [];
  const rings = new Path2D();
  const ringTops = new Path2D();
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const u = 1 - t;
    const px = u * u * x + 2 * u * t * qx + t * t * tx;
    const py = u * u * y + 2 * u * t * qy + t * t * ty;
    const dx = 2 * u * (qx - x) + 2 * t * (tx - qx);
    const dy = 2 * u * (qy - y) + 2 * t * (ty - qy);
    const len = Math.hypot(dx, dy);
    // Wider at the foot, where the trunk swells into its root ball.
    const half = s * (0.034 - t * 0.012 + Math.max(0, 0.15 - t) * 0.12);
    const nx = (-dy / len) * half;
    const ny = (dx / len) * half;
    left.push(px - nx, py - ny);
    mid.push(px - nx * 0.25, py - ny * 0.25);
    right.push(px + nx, py + ny);
  }
  const ringCount = Math.min(26, Math.max(5, Math.round(s / 10)));
  for (let k = 1; k < ringCount; k++) {
    const t = k / ringCount;
    const j = Math.min(steps - 1, Math.floor(t * steps));
    const f = t * steps - j;
    const lx = left[j * 2] + (left[j * 2 + 2] - left[j * 2]) * f;
    const ly = left[j * 2 + 1] + (left[j * 2 + 3] - left[j * 2 + 1]) * f;
    const rx = right[j * 2] + (right[j * 2 + 2] - right[j * 2]) * f;
    const ry = right[j * 2 + 1] + (right[j * 2 + 3] - right[j * 2 + 1]) * f;
    const sag = Math.abs(rx - lx) * 0.35;
    rings.moveTo(lx, ly);
    rings.quadraticCurveTo((lx + rx) / 2, (ly + ry) / 2 + sag, rx, ry);
    ringTops.moveTo(lx, ly - sag * 0.6);
    ringTops.lineTo(lx + (rx - lx) * 0.45, ly + (ry - ly) * 0.45 - sag * 0.2);
  }
  const band = (a: number[], b: number[], fill: string) => {
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let k = 0; k < a.length; k += 2) ctx.lineTo(a[k], a[k + 1]);
    for (let k = b.length - 2; k >= 0; k -= 2) ctx.lineTo(b[k], b[k + 1]);
    ctx.fill();
  };
  band(left, right, css(bark));
  band(mid, right, css(mix(bark, leaf.shade, 0.55), 0.75));
  band(left, mid, css(mix(bark, leaf.lit, 0.4), 0.55));
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, s * 0.007);
  ctx.strokeStyle = css(mix(bark, leaf.shade, 0.7), 0.7);
  ctx.stroke(rings);
  ctx.strokeStyle = css(mix(bark, leaf.lit, 0.6), 0.5);
  ctx.stroke(ringTops);

  const fronds = 8 + Math.floor(rnd(i, 5) * 4);
  const list: { ex: number; ey: number; mx: number; my: number; len: number; light: number }[] = [];
  for (let k = 0; k < fronds; k++) {
    const a = Math.PI * (0.88 + (k / (fronds - 1)) * 1.24) + (rnd(i, 20 + k) - 0.5) * 0.25;
    const len = s * (0.38 + rnd(i, 30 + k) * 0.22);
    const up = -Math.sin(a);
    const side = Math.cos(a);
    // The further out a frond reaches sideways, the more its own weight bends the tip down.
    list.push({
      ex: tx + side * len * 0.92,
      ey: ty - up * len * 0.3 + len * (0.18 + Math.abs(side) * 0.42),
      mx: tx + side * len * 0.55,
      my: ty - up * len * 0.55 - len * 0.1,
      len,
      light: Math.max(0, Math.min(1, 0.45 + up * 0.5 - side * 0.25)),
    });
  }
  list.sort((a, b) => a.light - b.light);
  let nuts = false;
  for (const f of list) {
    if (!nuts && f.light >= 0.5) {
      nuts = true;
      const r = s * 0.022;
      for (let k = 0; k < 4; k++) {
        const nx = tx + (rnd(i, 50 + k) - 0.5) * s * 0.07;
        const ny = ty + s * 0.015 + rnd(i, 55 + k) * s * 0.025;
        ctx.fillStyle = css(mix(bark, leaf.shade, 0.5));
        ctx.beginPath();
        ctx.arc(nx, ny, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = css(mix(bark, leaf.lit, 0.5), 0.8);
        ctx.beginPath();
        ctx.arc(nx - r * 0.3, ny - r * 0.3, r * 0.45, 0, TAU);
        ctx.fill();
      }
    }
    const c = f.light < 0.5 ? mix(leaf.shade, leaf.body, f.light * 2) : mix(leaf.body, leaf.lit, f.light * 2 - 1);
    const top = new Path2D();
    const low = new Path2D();
    const n = Math.min(18, Math.max(6, Math.round(f.len / 7)));
    for (let j = 1; j <= n; j++) {
      const t = j / (n + 0.5);
      const u = 1 - t;
      const px = u * u * tx + 2 * u * t * f.mx + t * t * f.ex;
      const py = u * u * ty + 2 * u * t * f.my + t * t * f.ey;
      let gx = 2 * u * (f.mx - tx) + 2 * t * (f.ex - f.mx);
      let gy = 2 * u * (f.my - ty) + 2 * t * (f.ey - f.my);
      const gl = Math.hypot(gx, gy);
      gx /= gl;
      gy /= gl;
      const reach = f.len * 0.24 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) ** 0.7;
      for (const side of [-1, 1]) {
        // Leaflets sweep forward along the rib and hang down under their own weight.
        let lx = -gy * side * 0.6 + gx * 0.55;
        let ly = gx * side * 0.6 + gy * 0.55 + 0.8;
        const ll = Math.hypot(lx, ly);
        lx /= ll;
        ly /= ll;
        const path = gx * side < 0 ? top : low;
        path.moveTo(px, py);
        path.quadraticCurveTo(px + lx * reach * 0.55, py + ly * reach * 0.35, px + lx * reach, py + ly * reach);
      }
    }
    ctx.lineWidth = Math.max(1, f.len * 0.028);
    ctx.strokeStyle = css(mix(c, leaf.shade, 0.45));
    ctx.stroke(low);
    ctx.strokeStyle = css(c);
    ctx.stroke(top);
    ctx.lineWidth = Math.max(1, f.len * 0.018);
    ctx.strokeStyle = css(mix(c, leaf.lit, 0.5));
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(f.mx, f.my, f.ex, f.ey);
    ctx.stroke();
  }
}

/** A layer's tones pulled toward the theme's own green, so foliage reads as leaves at any depth. */
function greened(tone: LayerTone, grass: RGB, t: number): LayerTone {
  return { body: mix(tone.body, grass, t), lit: mix(tone.lit, grass, t * 0.6), shade: mix(tone.shade, grass, t * 0.45) };
}

/**
 * Bushes on the ground between x0 and x1, each a heap of leaf masses: a dark
 * underside, the body, then light on the upper-left lumps. `ground` gives
 * null where there is no land to grow on. All of them share three fills.
 */
function bushes(ctx: CanvasRenderingContext2D, w: number, ground: (x: number) => number | null, x0: number, x1: number, r: number, tone: LayerTone, rnd: Rnd, k: number): void {
  const dark = new Path2D();
  const body = new Path2D();
  const lit = new Path2D();
  const blob = (p: Path2D, cx: number, cy: number, cr: number) => {
    p.moveTo(cx + cr, cy);
    p.arc(cx, cy, cr, 0, TAU);
  };
  let x = x0;
  for (let j = 0; x < x1; j++) {
    const rr = r * (0.5 + rnd(j, k) * 0.9);
    const y = ground(x);
    if (y !== null) {
      const lumps = 3 + Math.floor(rnd(j, k + 1) * 3);
      for (let m = 0; m < lumps; m++) {
        const q = j * 8 + m;
        const t = m / (lumps - 1) - 0.5;
        const lr = rr * (0.38 + rnd(q, k + 2) * 0.3) * (1 - Math.abs(t) * 0.5);
        const lx = x + t * rr * 1.7 + (rnd(q, k + 3) - 0.5) * rr * 0.3;
        const ly = y - lr * 0.6 - rr * 0.6 * (1 - Math.abs(t) * 1.6) * rnd(q, k + 4);
        blob(dark, lx + lr * 0.12, ly + lr * 0.22, lr);
        blob(body, lx, ly, lr * 0.88);
        // Leaf clusters break the outline and catch the light on the sun side.
        for (let f = 0; f < 6; f++) {
          const a = Math.PI * (0.95 + f * 0.24) + (rnd(q * 6 + f, k + 6) - 0.5) * 0.5;
          const fr = lr * (0.28 + rnd(q * 6 + f, k + 7) * 0.18);
          const fx = lx + Math.cos(a) * lr * 0.78;
          const fy = ly + Math.sin(a) * lr * 0.7;
          blob(body, fx, fy, fr);
          if (Math.cos(a) < 0.4) blob(lit, fx - fr * 0.2, fy - fr * 0.25, fr * 0.7);
        }
        if (t < 0.3) blob(lit, lx - lr * 0.3, ly - lr * 0.3, lr * 0.32);
      }
    }
    x += rr * (0.8 + rnd(j, k + 5) * 1.8);
  }
  wrapped(w, 0, (o) => {
    ctx.save();
    ctx.translate(o, 0);
    ctx.fillStyle = css(tone.shade);
    ctx.fill(dark);
    ctx.fillStyle = css(tone.body);
    ctx.fill(body);
    ctx.fillStyle = css(tone.lit, 0.6);
    ctx.fill(lit);
    ctx.restore();
  });
}

/**
 * Rock structure laid over a face already painted: broken ledges, each a lit
 * lip over a shaded undercut, and fissures running down, their shaded wall
 * on the left and a lit edge on the right where the far wall turns to the sun.
 */
function rockFace(ctx: CanvasRenderingContext2D, x0: number, x1: number, top: number, bottom: number, tone: LayerTone, gap: number, strength: number, rnd: Rnd, k: number): void {
  const shade = new Path2D();
  const lit = new Path2D();
  const rows = Math.floor((bottom - top) / gap);
  let j = 0;
  for (let r = 0; r < rows; r++) {
    let x = x0 + rnd(r, k) * gap * 3;
    while (x < x1) {
      j++;
      const len = gap * (1.2 + rnd(j, k + 1) * 4.5);
      const y = top + (r + 0.5 + (rnd(j, k + 2) - 0.5) * 0.7) * gap;
      const tilt = (rnd(j, k + 3) - 0.5) * gap * 0.4;
      lit.moveTo(x, y);
      lit.lineTo(x + len, y + tilt);
      shade.moveTo(x + gap * 0.05, y + gap * 0.16);
      shade.lineTo(x + len * 0.95, y + tilt + gap * 0.16);
      x += len + gap * (0.6 + rnd(j, k + 4) * 3.5);
    }
  }
  const cracks = Math.round((x1 - x0) / (gap * 3.5));
  for (let c = 0; c < cracks; c++) {
    let fx = x0 + rnd(c, k + 5) * (x1 - x0);
    let fy = top + rnd(c, k + 6) * (bottom - top) * 0.3;
    const end = fy + (bottom - top) * (0.25 + rnd(c, k + 7) * 0.7);
    shade.moveTo(fx, fy);
    lit.moveTo(fx + gap * 0.14, fy);
    for (let d = 1; fy < end; d++) {
      fx += (rnd(c * 40 + d, k + 8) - 0.5) * gap * 0.7;
      fy += gap * (0.5 + rnd(c * 40 + d, k + 9) * 0.7);
      shade.lineTo(fx, fy);
      lit.lineTo(fx + gap * 0.14, fy);
    }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, gap * 0.2);
  ctx.strokeStyle = css(tone.shade, 0.5 * strength);
  ctx.stroke(shade);
  ctx.lineWidth = Math.max(1, gap * 0.09);
  ctx.strokeStyle = css(tone.lit, 0.55 * strength);
  ctx.stroke(lit);
  ctx.restore();
}

// Clouds

interface CloudTone {
  lit: RGB;
  body: RGB;
  shade: RGB;
}

/**
 * A heaped cloud: puffs bunched toward the middle, tall ones at the back and
 * low, wider ones in front. Each puff is shaded as its own round form, lit on
 * the sun's side, so the lobes stand out from the ones behind them the way a
 * painted cumulus does. The base is flattened where the air below is too
 * warm to hold it, and darkens there, but fades rather than being cut off.
 * Painted opaque; the caller sets how much it shows through.
 */
function cumulus(ctx: CanvasRenderingContext2D, x: number, base: number, cw: number, tone: CloudTone, fromBelow: boolean, rnd: Rnd, i: number): void {
  const puffs: [number, number, number, number][] = [];
  const tops = 2 + Math.floor(rnd(i, 99) * 3);
  for (let k = 0; k < tops; k++) {
    const r = cw * (0.1 + rnd(i, 100 + k) * 0.08);
    puffs.push([x + (rnd(i, 110 + k) - 0.5) * cw * 0.5, base - cw * (0.2 + rnd(i, 120 + k) * 0.1) - r * 0.3, r, 1]);
  }
  const n = 6 + Math.floor(rnd(i, 40) * 5);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const dome = 1 - (2 * t - 1) ** 2;
    const r = cw * (0.07 + dome * (0.1 + rnd(i, 41 + k) * 0.08));
    puffs.push([x + (t - 0.5) * cw * 0.92 + (rnd(i, 60 + k) - 0.5) * cw * 0.06, base - r * (0.42 + rnd(i, 80 + k) * 0.25), r, 1]);
  }
  // A skirt of flattened puffs along the bottom gives the level base without a ruled edge.
  const skirt = 4 + Math.floor(rnd(i, 130) * 3);
  for (let k = 0; k < skirt; k++) {
    const t = (k + 0.5) / skirt;
    const r = cw * (0.08 + rnd(i, 131 + k) * 0.05) * (1 - Math.abs(2 * t - 1) * 0.45);
    puffs.push([x + (t - 0.5) * cw * 0.8, base - r * 0.5, r, 0.5]);
  }
  let top = base;
  for (const [, py, r] of puffs) top = Math.min(top, py - r);
  const lift = fromBelow ? 0.45 : -0.45;
  for (const [px, py, r, squash] of puffs) {
    // The gradient's outer circle sits toward the light, so a puff's sunward
    // edge stays lit and only its far side turns to shade: lobes, not bubbles.
    const g = ctx.createRadialGradient(px - r * 0.45, py + r * lift * 1.1, r * 0.05, px - r * 0.3, py + r * lift * 0.75, r * 1.5);
    g.addColorStop(0, css(tone.lit));
    g.addColorStop(0.5, css(mix(tone.lit, tone.body, 0.5)));
    g.addColorStop(0.8, css(tone.body));
    g.addColorStop(1, css(tone.shade));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * squash, 0, 0, TAU);
    ctx.fill();
  }
  // The underside sits in the cloud's own shadow (or in the glow, lit from below).
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const belly = ctx.createLinearGradient(0, top + (base - top) * 0.45, 0, base + cw * 0.04);
  belly.addColorStop(0, css(fromBelow ? tone.lit : tone.shade, 0));
  belly.addColorStop(1, css(fromBelow ? tone.lit : tone.shade, 0.75));
  ctx.fillStyle = belly;
  ctx.fillRect(x - cw, top, cw * 2, base - top + cw * 0.1);
  ctx.restore();
}

/** A soft streak of cloud: overlapping long ellipses, each a touch offset, fading out at the ends. */
function feathered(ctx: CanvasRenderingContext2D, w: number, x: number, y: number, len: number, thick: number, c: RGB, alpha: number, rnd: Rnd, i: number): void {
  for (let k = 0; k < 6; k++) {
    const l = len * (0.35 + rnd(i, 170 + k) * 0.65) / 2;
    const dx = (rnd(i, 180 + k) - 0.5) * len * 0.5;
    const dy = (rnd(i, 190 + k) - 0.5) * thick * 2.5;
    const t = thick * (0.6 + rnd(i, 200 + k) * 0.8);
    wrapped(w, x + dx, (cx) => {
      const g = ctx.createRadialGradient(cx, y + dy, 0, cx, y + dy, l);
      g.addColorStop(0, css(c, alpha));
      g.addColorStop(1, css(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, y + dy, l, t, 0, 0, TAU);
      ctx.fill();
    });
  }
}

/** Clouds go on their own half-size canvas and are scaled up onto the sky: the edges come out soft for free. */
function paintClouds(sky: CanvasRenderingContext2D, th: Theme, w: number, h: number, horizon: number, rnd: Rnd): void {
  if (!th.cloud) return;
  const cw = Math.ceil(w / 2);
  const ch = Math.ceil(h / 2);
  const [half, ctx] = makeCanvas(cw, ch);
  ctx.scale(cw / w, ch / h);
  const haze = rgbOf(th.haze);
  const skyTop = rgbOf(th.skyTop);
  const lit = rgbOf(th.cloud);
  const shade = mix(rgbOf(th.cloudShade), skyTop, 0.3);
  const fromBelow = th.horizon === 'volcano';
  const warm = fromBelow ? mix(lit, rgbOf(th.accent), 0.5) : lit;
  const smog = th.horizon === 'city';

  // Long soft bands low down, cloud seen edge-on from far away: each built from
  // overlapping feathered ellipses so it has no ruled edge.
  const bands = smog ? 7 : 3;
  for (let i = 0; i < bands; i++) {
    const y = horizon * (0.62 + rnd(i, 50) * 0.3);
    const len = w * (0.2 + rnd(i, 51) * 0.3);
    const thick = h * (0.008 + rnd(i, 52) * (smog ? 0.024 : 0.01));
    feathered(ctx, w, rnd(i, 53) * w, y, len, thick, mix(lit, haze, 0.45), smog ? 0.22 : 0.16, rnd, i);
  }
  if (smog) {
    sky.drawImage(half, 0, 0, w, h);
    return;
  }

  // High thin cloud, nearly lost in the blue: the sky has height above the heaps.
  for (let i = 0; i < 4; i++) {
    feathered(ctx, w, rnd(i, 144) * w, horizon * (0.1 + rnd(i, 140) * 0.3), w * (0.12 + rnd(i, 141) * 0.14), h * 0.006, mix(lit, haze, 0.2), 0.12, rnd, 40 + i);
  }

  // Each cloud is painted opaque on a scratch canvas, then laid on with its
  // distance fade, so overlapping puffs inside one cloud don't stack up alpha.
  const [scratch, sx] = makeCanvas(cw, ch);
  sx.scale(cw / w, ch / h);
  const lay = (alpha: number, paint: (x: number) => void, at: number) => {
    sx.clearRect(0, 0, w, h);
    wrapped(w, at, paint);
    ctx.globalAlpha = alpha;
    ctx.drawImage(scratch, 0, 0, w, h);
    ctx.globalAlpha = 1;
  };
  const toneAt = (fade: number): CloudTone => ({ lit: mix(warm, haze, fade * 0.6), body: mix(mix(lit, shade, 0.22), haze, fade), shade: mix(shade, haze, fade) });

  // A low bank of small heaps along the horizon, far off and deep in the haze.
  for (let i = 0; i < 9; i++) {
    const width = h * (0.07 + rnd(i, 150) * 0.07);
    lay(0.55, (x) => cumulus(sx, x, horizon * (0.9 + rnd(i, 151) * 0.06), width, toneAt(0.7), fromBelow, rnd, 200 + i), ((i + rnd(i, 152)) * w) / 9);
  }

  // Two big heaps with smaller ones gathered near them, back to front, the nearest highest and largest.
  const groups = 2;
  const clouds: [number, number, number, number][] = [];
  for (let g = 0; g < groups; g++) {
    const gx = ((g + 0.15 + rnd(g, 160) * 0.7) * w) / groups;
    const gDepth = 0.42 + rnd(g, 161) * 0.25;
    clouds.push([gx, gDepth, h * (0.3 + rnd(g, 162) * 0.1), g]);
    const more = 2 + Math.floor(rnd(g, 163) * 2);
    for (let k = 0; k < more; k++) {
      const depth = Math.min(0.88, gDepth + 0.08 + rnd(g * 8 + k, 164) * 0.35);
      clouds.push([gx + (rnd(g * 8 + k, 165) - 0.5) * w * 0.4, depth, h * (0.1 + rnd(g * 8 + k, 166) * 0.12) * (1.1 - depth), 10 + g * 8 + k]);
    }
  }
  clouds.sort((a, b) => b[1] - a[1]);
  for (const [cx, depth, width, i] of clouds) {
    lay(1 - depth * 0.18, (x) => cumulus(sx, x, horizon * depth, width, toneAt(depth * 0.55), fromBelow, rnd, i), cx);
  }
  sky.drawImage(half, 0, 0, w, h);
}

// The skyline, theme by theme

interface Scene {
  w: number;
  h: number;
  th: Theme;
  seed: number;
  rnd: Rnd;
  tones: LayerTone[];
  haze: RGB;
  far: CanvasRenderingContext2D;
  mid: CanvasRenderingContext2D;
  near: CanvasRenderingContext2D;
}

/** Open sea from the horizon down, deepening toward the viewer, with a bright line where it meets the sky. */
function sea(s: Scene, top: number): void {
  const { far: ctx, w, h, th, haze } = s;
  const water = rgbOf(th.water);
  const g = ctx.createLinearGradient(0, top, 0, h);
  g.addColorStop(0, css(mix(water, haze, 0.62)));
  g.addColorStop(0.35, css(mix(water, haze, 0.38)));
  g.addColorStop(1, css(mix(rgbOf(th.waterDeep), haze, 0.2)));
  ctx.fillStyle = g;
  ctx.fillRect(0, top, w, h - top);
  // A soft glare band rather than a crisp stripe: it shows through holes in the battlefield and must not read as an edge.
  const band = Math.max(4, h * 0.006);
  const glare = ctx.createLinearGradient(0, top - band * 0.3, 0, top + band);
  glare.addColorStop(0, css(mix(haze, WHITE, 0.35), 0));
  glare.addColorStop(0.3, css(mix(haze, WHITE, 0.35), 0.4));
  glare.addColorStop(1, css(mix(haze, WHITE, 0.35), 0));
  ctx.fillStyle = glare;
  ctx.fillRect(0, top - band * 0.3, w, band * 1.3);
}

interface Isle {
  x: number;
  half: number;
  height: number;
  /** 0 a low rounded hump, 1 a sharp central peak. */
  peak: number;
  /** 0 smooth, 1 broken into crags. */
  rock: number;
  /** Sheer sides and a flat top: a stack the sea has cut free. */
  sheer?: boolean;
}

/** Island humps on a waterline; the land is filled only above the water. */
function islandLine(w: number, water: number, isles: readonly Isle[], seed: number): Line {
  return sampleLine(w, (x) => {
    let lift = 0;
    for (const s of isles) {
      const d = apart(x, s.x, w) / s.half;
      if (d >= 1) continue;
      const shape = s.sheer ? Math.min(1, (1 - d ** 6) * 1.8) : (1 - d * d) ** 1.6 * (1 - s.peak) + Math.max(0, 1 - d * 2.2) ** 1.3 * s.peak;
      const crag = 1 + s.rock * (fbm(x, w, 90, 3, seed + 5, true) - 0.35) * 0.55;
      lift = Math.max(lift, s.height * shape * crag * (0.9 + fbm(x, w, 40, 2, seed) * 0.2));
    }
    return water - lift;
  });
}

/**
 * Shadow or glare cast on the water below a landform, fading out sideways and
 * downward so it never ends in an edge across the open sea.
 */
function pool(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, depth: number, colour: RGB, alpha: number): void {
  const rx = (x1 - x0) / 2 + depth;
  ctx.save();
  ctx.translate((x0 + x1) / 2, y);
  ctx.scale(rx / depth, 1);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, depth);
  g.addColorStop(0, css(colour, alpha));
  g.addColorStop(0.6, css(colour, alpha * 0.55));
  g.addColorStop(1, css(colour, 0));
  ctx.fillStyle = g;
  ctx.fillRect(-depth, 0, depth * 2, depth);
  ctx.restore();
}

/** A lit rim along the land only, lifted off wherever the line lies flat on the water. */
function crest(ctx: CanvasRenderingContext2D, l: Line, water: number, tone: LayerTone, alpha: number): void {
  const { ys, step } = l;
  ctx.strokeStyle = css(tone.lit, alpha);
  ctx.lineWidth = Math.max(1, step * 0.4);
  ctx.beginPath();
  let on = false;
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] > water - 1) {
      on = false;
      continue;
    }
    if (on) ctx.lineTo(i * step, ys[i]);
    else ctx.moveTo(i * step, ys[i]);
    on = true;
  }
  ctx.stroke();
}

/**
 * Where island meets sea: a strip of beach or wet rock along the foot of the
 * land, surf breaking along it, and the land's darker reflection just below.
 */
function shoreline(ctx: CanvasRenderingContext2D, w: number, l: Line, isle: Isle, water: number, beach: RGB, tone: LayerTone, foam: RGB, h: number, rnd: Rnd, k: number): void {
  const band = h * (0.006 + isle.height / h * 0.06);
  const strip = new Path2D();
  const surf = new Path2D();
  let from = Infinity;
  let to = -Infinity;
  const x0 = isle.x - isle.half;
  const steps = Math.ceil((isle.half * 2) / l.step);
  for (let j = 0; j <= steps; j++) {
    const x = x0 + j * l.step;
    if (yAt(l, w, x) > water - 1) continue;
    from = Math.min(from, x);
    to = Math.max(to, x);
  }
  if (from > to) return;
  strip.moveTo(from - l.step, water + 1);
  for (let x = from - l.step; x <= to + l.step; x += l.step) strip.lineTo(x, water - band * (0.55 + fbm(x, w, 70, 2, k) * 0.7));
  strip.lineTo(to + l.step, water + 1);
  strip.closePath();
  // Surf: long thin wash hugging the shore, broken where the waves are between breaks.
  for (let x = from, j = 0; x < to - band; j++) {
    const len = Math.min(band * (2 + rnd(j, k) * 6), to - x);
    const y = water + h * 0.0008 + rnd(j, k + 3) * h * 0.0016;
    const th = h * (0.0006 + rnd(j, k + 1) * 0.0009);
    surf.moveTo(x, y);
    surf.quadraticCurveTo(x + len / 2, y - th * 2.2, x + len, y);
    surf.quadraticCurveTo(x + len / 2, y + th * 0.6, x, y);
    x += len + band * rnd(j, k + 2) * 0.5;
  }
  wrapped(w, 0, (o) => {
    ctx.save();
    ctx.translate(o, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = css(beach);
    ctx.fill(strip);
    ctx.fillStyle = css(tone.shade, 0.35);
    ctx.fillRect(from - l.step, water - h * 0.0025, to - from + l.step * 2, h * 0.0025);
    ctx.globalCompositeOperation = 'source-over';
    pool(ctx, from, to, water, band * 2.5, tone.shade, 0.3);
    ctx.fillStyle = css(foam, 0.75);
    ctx.fill(surf);
    ctx.restore();
  });
}

function paintIslands(s: Scene): void {
  const { w, h, rnd, tones, haze, seed, th } = s;
  const horizon = h * 0.7;
  sea(s, horizon);
  const foam = mix(haze, WHITE, 0.6);
  const sand = rgbOf(th.soil[2]);
  const grass = rgbOf(th.crust);
  const bark = rgbOf(th.accent);
  const farIsles: Isle[] = Array.from({ length: 6 }, (_, i) => {
    const size = rnd(i, 2);
    return { x: ((i + rnd(i, 1) * 0.7) * w) / 6, half: w * (0.012 + size ** 1.5 * 0.075), height: h * (0.006 + size * 0.025 + rnd(i, 3) * 0.02), peak: rnd(i, 15) < 0.35 ? 0.75 : 0.1, rock: 0.3 };
  });
  land(s.far, w, islandLine(w, horizon, farIsles, seed), horizon, tones[0], 0.35);

  // The middle distance: one tall rocky headland with a stack cut off beside it, low sandy cays, and a craggy islet.
  const midLine = h * 0.79;
  const mt = tones[1];
  const head = rnd(0, 4) * w;
  const midIsles: Isle[] = [
    { x: head, half: w * 0.085, height: h * 0.18, peak: 0.6, rock: 1 },
    { x: head + w * 0.115, half: w * 0.014, height: h * 0.085, peak: 0, rock: 0.6, sheer: true },
    { x: head + w * (0.3 + rnd(1, 4) * 0.08), half: w * 0.085, height: h * 0.032, peak: 0.15, rock: 0 },
    { x: head + w * (0.52 + rnd(2, 4) * 0.08), half: w * 0.04, height: h * 0.02, peak: 0, rock: 0 },
    { x: head + w * (0.72 + rnd(3, 4) * 0.08), half: w * 0.045, height: h * 0.06, peak: 0.45, rock: 0.7 },
  ];
  const ml = islandLine(w, midLine, midIsles, seed + 1);
  land(s.mid, w, ml, midLine, mt, 0.4);
  crest(s.mid, ml, midLine, mt, 0.35);
  const midLeaf = greened(mt, mix(grass, haze, HAZE[1]), 0.45);
  const midBark = mix(bark, haze, HAZE[1]);
  flanks(s.mid, w, ml, [{ x: head, height: midIsles[0].height, slope: midIsles[0].height / midIsles[0].half }], midLine, mt, 0.3, rnd, 210);
  midIsles.forEach((isle, i) => {
    if (isle.rock > 0.5) wrapped(w, isle.x, (x) => rockFace(s.mid, x - isle.half, x + isle.half, midLine - isle.height * 1.1, midLine, mt, h * 0.011, 0.8, rnd, 200 + i * 20));
  });
  midIsles.forEach((isle, i) => shoreline(s.mid, w, ml, isle, midLine, isle.rock > 0.5 ? mix(mt.shade, mt.body, 0.4) : mix(sand, haze, 0.45), mt, foam, h, rnd, 300 + i * 10));
  const midGround = (x: number) => (yAt(ml, w, x) < midLine - h * 0.012 ? yAt(ml, w, x) + h * 0.004 : null);
  midIsles.forEach((isle, i) => {
    if (isle.sheer) return;
    bushes(s.mid, w, midGround, isle.x - isle.half * 0.8, isle.x + isle.half * 0.8, h * 0.011, midLeaf, rnd, 400 + i * 10);
    const count = isle.rock > 0.5 ? 1 + Math.floor(rnd(i, 7) * 2) : 2 + Math.floor(rnd(i, 7) * 4);
    for (let k = 0; k < count; k++) {
      const px = isle.x + (rnd(i * 7 + k, 8) - 0.5) * isle.half * 1.1;
      const sz = h * (0.045 + rnd(i * 7 + k, 9) * 0.05);
      const lean = (rnd(i * 7 + k, 10) - 0.45) * 0.9;
      wrapped(w, px, (x) => {
        if (yAt(ml, w, x) < midLine - h * 0.008) palm(s.mid, x, yAt(ml, w, x) + sz * 0.04, sz, lean, midLeaf, midBark, rnd, i * 7 + k);
      });
    }
  });

  const nearLine = h * 0.9;
  const nt = tones[2];
  const near = rnd(9, 11) * w;
  const nearIsles: Isle[] = [
    { x: near, half: w * 0.2, height: h * 0.085, peak: 0.05, rock: 0.15 },
    { x: near + w * 0.5, half: w * 0.06, height: h * 0.03, peak: 0, rock: 0.4 },
  ];
  const nl = islandLine(w, nearLine, nearIsles, seed + 2);
  land(s.near, w, nl, nearLine, nt, 0.45);
  crest(s.near, nl, nearLine, nt, 0.3);
  nearIsles.forEach((isle, i) => shoreline(s.near, w, nl, isle, nearLine, mix(sand, haze, 0.3), nt, foam, h, rnd, 500 + i * 10));
  const nearLeaf = greened(nt, mix(grass, haze, HAZE[2]), 0.4);
  const nearGround = (x: number) => (yAt(nl, w, x) < nearLine - h * 0.018 ? yAt(nl, w, x) + h * 0.006 : null);
  nearIsles.forEach((isle, i) => bushes(s.near, w, nearGround, isle.x - isle.half * 0.85, isle.x + isle.half * 0.85, h * 0.02, nearLeaf, rnd, 600 + i * 10));
  const nearBark = mix(bark, haze, HAZE[2]);
  for (let k = 0; k < 8; k++) {
    const px = near + (rnd(k, 12) - 0.5) * w * 0.3;
    const sz = h * (0.08 + rnd(k, 13) ** 1.5 * 0.12);
    wrapped(w, px, (x) => {
      if (yAt(nl, w, x) < nearLine - h * 0.02) palm(s.near, x, yAt(nl, w, x) + sz * 0.04, sz, (rnd(k, 14) - 0.5) * 1.1, nearLeaf, nearBark, rnd, 50 + k);
    });
  }
  mist(s.near, w, nearLine - h * 0.1, nearLine, haze, 0.3);
}

function paintHills(s: Scene): void {
  const { w, h, rnd, tones, haze, seed, th } = s;
  // Two bands of far downs, the nearer a step out of the haze, each crest lined with trees.
  const fl = sampleLine(w, (x) => h * 0.6 - h * 0.1 * fbm(x, w, 3, 4, seed));
  land(s.far, w, fl, h, tones[0], 0.3);
  hedge(s.far, w, along(fl, w, 0, w, () => h * 0.003), h * 0.0028, tones[0], seed + 4, 0.55);
  const step: LayerTone = { body: mix(tones[0].body, tones[1].body, 0.3), lit: mix(tones[0].lit, tones[1].lit, 0.3), shade: mix(tones[0].shade, tones[1].shade, 0.3) };
  const fl2 = sampleLine(w, (x) => h * 0.665 - h * 0.06 * fbm(x, w, 5, 3, seed + 3));
  land(s.far, w, fl2, h, step, 0.35);
  hedge(s.far, w, along(fl2, w, 0, w, () => h * 0.004), h * 0.0035, step, seed + 5, 0.5);
  for (let c = 0; c < 4; c++) copse(s.far, w, fl2, ((c + rnd(c, 19)) * w) / 4, h * 0.05, 3 + Math.floor(rnd(c, 18) * 4), h * 0.009, step, rnd, 40 + c, 0);
  mist(s.far, w, h * 0.6, h * 0.78, haze, 0.6);

  const ml = sampleLine(w, (x) => h * 0.765 - h * 0.1 * fbm(x, w, 4, 4, seed + 7));
  const mc = s.mid;
  land(mc, w, ml, h, tones[1], 0.4, 0.3);
  // A patchwork of fields down the slope. Field boundaries run toward the
  // viewer at a slant and wander a little; each column is cut into its own
  // rows, tilted, and deeper nearer the viewer.
  const t1 = tones[1];
  const crops = [t1.lit, mix(t1.body, t1.shade, 0.8), mix(t1.body, mix(rgbOf(th.crustLight), haze, 0.25), 0.75), mix(t1.body, mix(rgbOf(th.crust), haze, 0.2), 0.6), mix(t1.body, t1.lit, 0.4)];
  const cols: number[] = [];
  for (let x = 0, c = 0; x < w - h * 0.08; c++) {
    cols.push(x);
    x += h * (0.14 + rnd(c, 20) * 0.2);
  }
  const n = cols.length;
  cols.push(w);
  // Boundary n is boundary 0 a loop later, so it leans and wanders the same way.
  const edge = (c: number, d: number) => cols[c] + d * (rnd(c % n, 37) - 0.5) * 1.2 + h * 0.014 * (fbm(d * 4 + (c % n) * h * 0.4, w, 30, 2, seed + 50) - 0.5);
  const edgeLine = (c: number, da: number, db: number, i: number) => {
    const x0 = edge(c, da);
    const x1 = edge(c + 1, db);
    return along(ml, w, x0, x1, (x) => da + ((db - da) * (x - x0)) / (x1 - x0) + h * 0.004 * (fbm(x, w, 60, 2, seed + i) - 0.5));
  };
  const shifts = (pts: readonly number[]) => [0, ...(pts[pts.length - 2] > w ? [-w] : []), ...(pts[0] < 0 ? [w] : [])];
  const rows: number[][] = [];
  mc.globalCompositeOperation = 'source-atop';
  for (let c = 0; c < n; c++) {
    let da = h * (0.006 + rnd(c, 21) * 0.01);
    let db = da + (rnd(c, 22) - 0.5) * h * 0.012;
    let upper = edgeLine(c, da, db, c * 16);
    if (rnd(c, 38) < 0.7) rows.push(upper);
    for (let r = 0; da < h * 0.13; r++) {
      const i = c * 16 + r;
      const deep = h * (0.014 + rnd(i, 23) * 0.022) * (1 + da / (h * 0.06));
      const na = da + deep;
      const nb = Math.max(db + deep * 0.5, na + (rnd(i, 24) - 0.5) * h * 0.016);
      const lower = edgeLine(c, na, nb, i + 1);
      mc.fillStyle = css(crops[Math.floor(rnd(i, 25) * crops.length)], 0.7);
      mc.beginPath();
      for (const ox of shifts(upper)) {
        mc.moveTo(upper[0] + ox, upper[1]);
        for (let p = 2; p < upper.length; p += 2) mc.lineTo(upper[p] + ox, upper[p + 1]);
        for (let p = lower.length - 2; p >= 0; p -= 2) mc.lineTo(lower[p] + ox, lower[p + 1]);
        mc.closePath();
      }
      mc.fill();
      // Plough or crop lines in some, following the slope like the field's edges.
      if (rnd(i, 26) < 0.4) {
        mc.strokeStyle = css(t1.shade, 0.18);
        mc.lineWidth = Math.max(1, h * 0.0012);
        mc.beginPath();
        for (let f = 0.2; f < 1; f += 0.16) {
          const fa = da + (na - da) * f;
          const fb = db + (nb - db) * f;
          const x0 = edge(c, fa);
          const x1 = edge(c + 1, fb);
          const line = along(ml, w, x0, x1, (x) => fa + ((fb - fa) * (x - x0)) / (x1 - x0));
          for (const ox of shifts(line)) {
            mc.moveTo(line[0] + ox, line[1]);
            for (let p = 2; p < line.length; p += 2) mc.lineTo(line[p] + ox, line[p + 1]);
          }
        }
        mc.stroke();
      }
      if (rnd(i, 39) < 0.45) rows.push(lower);
      upper = lower;
      da = na;
      db = nb;
    }
  }
  mc.globalCompositeOperation = 'source-over';
  rows.forEach((pts, j) => {
    for (const ox of shifts(pts)) hedge(mc, w, ox ? pts.map((v, q) => (q % 2 ? v : v + ox)) : pts, h * 0.0055, t1, seed + 30 + j, 0.3);
  });
  // Woods stand in a few big clumps where the fields left them.
  for (let c = 0; c < 4; c++) {
    if (rnd(c, 27) < 0.15) continue;
    const down = rnd(c, 28) < 0.4 ? h * (0.02 + rnd(c, 29) * 0.07) : 0;
    const shifted = { ys: ml.ys.map((v) => v + down), step: ml.step };
    copse(mc, w, shifted, ((c + rnd(c, 30)) * w) / 4, h * (0.06 + rnd(c, 31) * 0.12), 7 + Math.floor(rnd(c, 32) * 10), h * (0.018 + rnd(c, 40) * 0.012), t1, rnd, c, 0.12);
  }
  mist(mc, w, h * 0.76, h * 0.92, haze, 0.3);

  const nl = sampleLine(w, (x) => h * 0.86 - h * 0.06 * fbm(x, w, 3, 3, seed + 13));
  const nc = s.near;
  land(nc, w, nl, h, tones[2], 0.45, 0.3);
  // The hedge wanders down the slope and back, as field boundaries do.
  hedge(nc, w, along(nl, w, 0, w, (x) => h * (0.012 + 0.05 * fbm(x, w, 5, 2, seed + 41) ** 2)), h * 0.013, tones[2], seed + 40, 0.36);
  for (let c = 0; c < 3; c++) {
    copse(nc, w, nl, ((c + rnd(c, 34)) * w) / 3, h * (0.07 + rnd(c, 35) * 0.14), 5 + Math.floor(rnd(c, 36) * 9), h * (0.03 + rnd(c, 37) * 0.016), tones[2], rnd, 20 + c, 0.2);
  }
}

/** Flat-topped rock in steps: noise pushed through steep terraces. */
function terraced(x: number, w: number, cells: number, levels: number, seed: number): number {
  const v = fbm(x, w, cells, 3, seed) * levels;
  const f = v - Math.floor(v);
  return (Math.floor(v) + Math.min(1, Math.max(0, (f - 0.72) / 0.28))) / levels;
}

/**
 * Sediment beds across rock already painted, counted down from `top` so every
 * butte in a layer shows the same beds at the same heights. A hard bed stands
 * proud as a ledge, lit along its top and shadowed under its lip. Returns the
 * ledges, for scrub to grow on.
 */
function strata(ctx: CanvasRenderingContext2D, w: number, top: number, bottom: number, tone: LayerTone, beds: readonly RGB[], gap: number, alpha: number, seed: number): number[] {
  const ledges: number[] = [];
  const lip = Math.max(1, gap * 0.14);
  ctx.globalCompositeOperation = 'source-atop';
  for (let y = top, k = 0; y < bottom; k++) {
    const r = (j: number) => ((hash3(k, j, seed) >>> 4) & 1023) / 1023;
    const t = gap * (0.45 + r(1) * 1.3);
    ctx.fillStyle = css(beds[Math.floor(r(2) * beds.length) % beds.length],alpha * (0.45 + r(3) * 0.7));
    ctx.fillRect(0, y, w, t * (0.55 + r(4) * 0.45));
    if (r(5) < 0.35) {
      ctx.fillStyle = css(tone.lit, Math.min(1, alpha * 2));
      ctx.fillRect(0, y - lip, w, lip);
      ctx.fillStyle = css(tone.shade, Math.min(1, alpha * 2.4));
      ctx.fillRect(0, y, w, lip * 1.8);
      ledges.push(y);
    }
    y += t;
  }
  ctx.globalCompositeOperation = 'source-over';
  return ledges;
}

interface Butte {
  x: number;
  /** Half the flat top. */
  half: number;
  height: number;
  /** Share of the height buried in its own fallen scree. */
  scree: number;
}

/** Height of a butte above the plain at `d` from its middle: flat cap, a cliff with a slight batter, then a concave scree apron. */
function butteLift(b: Butte, d: number): number {
  const a = Math.abs(d);
  if (a <= b.half) return b.height;
  const face = b.height * (1 - b.scree);
  const batter = face * 0.1;
  if (a <= b.half + batter) return b.height - (face * (a - b.half)) / batter;
  const u = Math.min(1, (a - b.half - batter) / (b.height * b.scree * 1.6));
  return b.height * b.scree * (1 - u) ** 2.4;
}

/** Buttes standing on a plain that rolls a little; the caprock breaks away in small bites. */
function buttesLine(w: number, h: number, ground: number, buttes: readonly Butte[], seed: number): Line {
  return sampleLine(w, (x) => {
    let lift = 0;
    for (const b of buttes) lift = Math.max(lift, butteLift(b, apart(x, b.x, w)));
    return ground - lift * (1 - 0.035 * fbm(x, w, 160, 2, seed, true)) - h * 0.008 * fbm(x, w, 12, 2, seed + 1);
  });
}

/** Buttes of uneven size and spacing, enough to fill the width whatever its shape. */
function buttesAlong(w: number, h: number, scale: number, rnd: Rnd, k: number): Butte[] {
  const count = Math.max(2, Math.round((w / h) * 2.6));
  return Array.from({ length: count }, (_, i) => ({
    x: ((i + rnd(i, k) * 0.7) * w) / count,
    half: h * scale * (0.02 + rnd(i, k + 1) ** 1.5 * 0.13),
    height: h * scale * (0.09 + rnd(i, k + 2) * 0.13),
    scree: 0.12 + rnd(i, k + 3) * 0.16,
  }));
}

interface Beds {
  top: number;
  colours: readonly RGB[];
  gap: number;
  alpha: number;
  seed: number;
}

/**
 * Give a butte already filled into its layer a form: a darker caprock with a
 * shadow under its lip, the cliff lit on the left and turning into shade past
 * a ragged crease, rain gullies down the face, the layer's beds across the
 * cliff, rubble on the scree and scrub on the ledges. `detail` thins the small
 * things out for far layers.
 */
function modelButte(ctx: CanvasRenderingContext2D, w: number, l: Line, ground: number, b: Butte, tone: LayerTone, beds: Beds, scrub: RGB, rnd: Rnd, i: number, detail: number): void {
  const top = ground - b.height;
  const foot = ground - b.height * b.scree;
  const edge = b.half + b.height * (1 - b.scree) * 0.1;
  const apron = b.height * b.scree * 1.6;
  const cap = b.height * (0.06 + rnd(i, 1) * 0.06);
  const unit = ctx.canvas.height * 0.0035;
  const bite = b.height * 0.04 + unit;
  // Even a hazy butte keeps some modelling, or it flattens back into a cut-out.
  const strength = 0.35 + 0.65 * reliefOf(tone);
  const crease = b.half * (0.05 + rnd(i, 2) * 0.45);
  wrapped(w, b.x, (x) => {
    if (x + edge + apron * 1.4 < 0 || x - edge - apron * 1.4 > w) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - edge, top + cap, edge * 2, foot - top - cap);
    ctx.clip();
    const ledges = strata(ctx, w, beds.top, foot, tone, beds.colours, beds.gap, beds.alpha, beds.seed).filter((y) => y > top + cap && y < foot);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    // The caprock is harder and darker than the beds under it, and overhangs them.
    ctx.fillStyle = css(tone.shade, 0.35 * strength);
    ctx.fillRect(x - edge - 1, top - bite, edge * 2 + 2, cap + bite);
    ctx.fillStyle = css(tone.lit, 0.65 * strength);
    ctx.fillRect(x - edge - 1, top - bite, edge * 2 + 2, bite + unit * 0.5);
    ctx.fillStyle = css(tone.shade, 0.6 * strength);
    ctx.fillRect(x - edge, top + cap, edge * 2, unit * 0.9);

    const lit = ctx.createLinearGradient(x - edge, 0, x + crease, 0);
    lit.addColorStop(0, css(tone.lit, 0.5 * strength));
    lit.addColorStop(1, css(tone.lit, 0));
    ctx.fillStyle = lit;
    ctx.fillRect(x - edge, top + cap, edge + crease, foot - top - cap);

    for (let g = Math.round((3 + rnd(i, 3) * 5) * detail); g > 0; g--) {
      const gx = x + (rnd(i * 16 + g, 4) * 2 - 1) * edge * 0.9;
      const len = (foot - top - cap) * (0.35 + rnd(i * 16 + g, 5) * 0.65);
      const gw = Math.max(1, b.half * 0.016 + unit * 0.3);
      ctx.beginPath();
      ctx.moveTo(gx, top + cap);
      for (let j = 1; j <= 4; j++) ctx.lineTo(gx + (rnd(i * 64 + g * 4 + j, 6) - 0.5) * gw * 3, top + cap + (len * j) / 4);
      ctx.lineWidth = gw;
      ctx.strokeStyle = css(tone.shade, 0.45 * strength);
      ctx.stroke();
      ctx.translate(gw, 0);
      ctx.strokeStyle = css(tone.lit, 0.3 * strength);
      ctx.lineWidth = gw * 0.5;
      ctx.stroke();
      ctx.translate(-gw, 0);
    }

    // Past the crease the face turns from the sun; light bounced off the plain lifts its foot a little.
    const shade = ctx.createLinearGradient(0, top, 0, ground);
    shade.addColorStop(0, css(tone.shade, 0.15 + 0.5 * strength));
    shade.addColorStop(1, css(tone.shade, 0.1 + 0.3 * strength));
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(x + crease, top - bite);
    for (let j = 1; j <= 6; j++) ctx.lineTo(x + crease + (rnd(i * 8 + j, 7) - 0.3) * b.half * 0.14, top + ((foot - top) * j) / 6);
    ctx.lineTo(x + edge + apron * 0.4, ground);
    ctx.lineTo(x + edge + apron * 0.4, ground + unit * 2);
    ctx.lineTo(x + edge + unit, ground + unit * 2);
    ctx.lineTo(x + edge + unit, top - bite);
    ctx.closePath();
    ctx.fill();

    for (let r = Math.round(40 * detail); r > 0; r--) {
      const side = r % 2 ? 1 : -1;
      const px = x + side * (edge + rnd(i * 97 + r, 8) ** 0.8 * apron * 0.9);
      const py = yAt(l, w, px) + unit * (0.6 + rnd(i * 97 + r, 9) * 2.5);
      const rr = unit * (0.3 + rnd(i * 97 + r, 10) ** 3 * 1.4);
      ctx.fillStyle = css(tone.shade, 0.55 * strength);
      ctx.beginPath();
      ctx.ellipse(px + rr * 0.25, py + rr * 0.2, rr, rr * 0.7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = css(tone.lit, 0.55 * strength);
      ctx.beginPath();
      ctx.ellipse(px - rr * 0.2, py - rr * 0.2, rr * 0.6, rr * 0.4, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    ledges.forEach((y, j) => {
      if (rnd(i * 31 + j, 11) > 0.6 * detail) return;
      bush(ctx, x + (rnd(i * 31 + j, 12) * 2 - 1) * edge * 0.8, y, unit * (0.5 + rnd(i * 31 + j, 13) * 0.6), tone, scrub);
    });
    for (let j = Math.round(4 * detail); j > 0; j--) {
      const px = x + (rnd(i * 7 + j, 14) * 2 - 1) * (edge + apron * 1.3);
      bush(ctx, px, yAt(l, w, px) + unit, unit * (0.9 + rnd(i * 7 + j, 15) * 0.8), tone, scrub);
    }
  });
}

/** Desert scrub: a low clump, darker than the rock, the top of each tuft catching the sun. */
function bush(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, tone: LayerTone, scrub: RGB): void {
  ctx.fillStyle = css(scrub, 0.85);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.7, y - r * 0.35, r * 0.75, r * 0.55, 0, 0, TAU);
  ctx.ellipse(x + r * 0.15, y - r * 0.6, r, r * 0.75, 0, 0, TAU);
  ctx.ellipse(x + r * 0.95, y - r * 0.3, r * 0.6, r * 0.45, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = css(mix(scrub, tone.lit, 0.45), 0.8);
  ctx.beginPath();
  ctx.ellipse(x - r * 0.1, y - r * 0.95, r * 0.55, r * 0.3, -0.3, 0, TAU);
  ctx.fill();
}

/** A hoodoo: a column of soft rock pinched in and out by its beds, under the hard cap that keeps it standing. */
function hoodoo(ctx: CanvasRenderingContext2D, x: number, foot: number, hw: number, hh: number, tone: LayerTone, cap: RGB, rnd: Rnd, i: number): void {
  const waves = 4 + rnd(i, 1) * 5;
  const phase = rnd(i, 2) * 6;
  const width = (t: number, side: number) => hw * (1.2 - t * 0.4 + 0.22 * Math.sin(t * waves + phase + side));
  const body = new Path2D();
  body.moveTo(x - hw * 1.8, foot);
  for (let j = 0; j <= 10; j++) body.lineTo(x - width(j / 10, 0), foot - (hh * j) / 10);
  for (let j = 10; j >= 0; j--) body.lineTo(x + width(j / 10, 0.8), foot - (hh * j) / 10);
  body.lineTo(x + hw * 1.8, foot);
  body.closePath();
  const g = ctx.createLinearGradient(x - hw * 1.2, 0, x + hw * 1.2, 0);
  g.addColorStop(0, css(tone.lit));
  g.addColorStop(0.45, css(tone.body));
  g.addColorStop(1, css(tone.shade));
  ctx.fillStyle = g;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = css(tone.shade, 0.4);
  for (let j = 1; j < 5; j++) ctx.fillRect(x - hw * 2, foot - hh * (j / 5 + (rnd(i, 3 + j) - 0.5) * 0.08), hw * 4, Math.max(1, hh * 0.015));
  ctx.restore();
  const cw = hw * (1.3 + rnd(i, 9) * 0.5);
  const ch = hw * 0.5;
  ctx.fillStyle = css(cap);
  ctx.beginPath();
  ctx.ellipse(x + hw * 0.1, foot - hh - ch * 0.3, cw, ch, (rnd(i, 10) - 0.5) * 0.3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = css(tone.lit, 0.7);
  ctx.beginPath();
  ctx.ellipse(x - cw * 0.2, foot - hh - ch * 0.7, cw * 0.65, ch * 0.4, 0, 0, TAU);
  ctx.fill();
}

/** Wind and frost have worn a hole through the lower cliff; the sky behind shows through it. */
function arch(ctx: CanvasRenderingContext2D, w: number, ground: number, b: Butte, tone: LayerTone, unit: number): void {
  const top = ground - b.height;
  const foot = ground - b.height * b.scree;
  const sill = foot - (foot - top) * 0.12;
  const rise = (sill - top) * 0.62;
  const aw = Math.min(b.half * 0.5, rise * 0.75);
  wrapped(w, b.x + b.half * 0.15, (x) => {
    if (x + aw < 0 || x - aw > w) return;
    // A window with a low flat sill of fallen blocks, the span thinning to its crown.
    const spring = sill - rise + aw * 0.8;
    const hole = new Path2D();
    hole.moveTo(x - aw, sill);
    hole.lineTo(x - aw * 0.92, spring);
    hole.ellipse(x, spring, aw * 0.92, aw * 0.8, 0, Math.PI, TAU);
    hole.lineTo(x + aw, sill);
    hole.closePath();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fill(hole);
    ctx.globalCompositeOperation = 'source-atop';
    // The underside of the span and its left jamb face away from the sun; the right jamb faces into it.
    const under = ctx.createLinearGradient(0, spring - aw * 0.8 - unit * 3, 0, spring - aw * 0.8 + unit);
    under.addColorStop(0, css(tone.shade, 0));
    under.addColorStop(1, css(tone.shade, 0.55));
    ctx.fillStyle = under;
    ctx.fillRect(x - aw * 1.2, spring - aw * 0.8 - unit * 3, aw * 2.4, aw * 0.8);
    ctx.fillStyle = css(tone.shade, 0.45);
    ctx.fillRect(x - aw - unit * 1.5, spring, unit * 1.5, sill - spring);
    ctx.fillStyle = css(tone.lit, 0.45);
    ctx.fillRect(x + aw, spring, unit * 1.2, sill - spring);
    ctx.fillStyle = css(tone.lit, 0.5);
    ctx.fillRect(x - aw, sill, aw * 2, unit * 0.8);
    ctx.restore();
  });
}

function paintMesas(s: Scene): void {
  const { w, h, rnd, tones, haze, seed, th } = s;
  const unit = h * 0.0035;
  const tint = (hex: string, i: number) => mix(rgbOf(hex), haze, HAZE[i]);
  const bedsOf = (i: number, top: number, gap: number, alpha: number): Beds => ({
    top,
    colours: [tint(th.accent, i), tint(th.crustLight, i), tint(th.crustDark, i), tones[i].shade, tones[i].lit, tint(th.soil[1], i)],
    gap,
    alpha,
    seed: seed + i * 13,
  });
  const scrubOf = (i: number) => mix(mix(tones[i].shade, rgbOf(th.outline), 0.2), haze, HAZE[i] * 0.6);

  // Far: tablelands stepping back, with a few buttes stood off their edge.
  const fb = buttesAlong(w, h, 0.7, rnd, 200).filter((_, i) => rnd(i, 205) < 0.6);
  const fground = h * 0.7;
  const fl = sampleLine(w, (x) => {
    let lift = h * 0.16 * terraced(x, w, 6, 3, seed);
    for (const b of fb) lift = Math.max(lift, butteLift(b, apart(x, b.x, w)));
    return fground - lift;
  });
  land(s.far, w, fl, h, tones[0], 0.4);
  const farBeds = bedsOf(0, h * 0.46, h * 0.011, 0.22);
  strata(s.far, w, farBeds.top, fground, tones[0], farBeds.colours, farBeds.gap, farBeds.alpha, farBeds.seed);
  fb.forEach((b, i) => modelButte(s.far, w, fl, fground, b, tones[0], farBeds, scrubOf(0), rnd, 210 + i, 0.25));
  mist(s.far, w, h * 0.6, h * 0.74, haze, 0.65);

  // Middle: buttes and mesas, one worn through into an arch, and stands of hoodoos between.
  const mground = h * 0.81;
  const mb = buttesAlong(w, h, 1, rnd, 220);
  const ml = buttesLine(w, h, mground, mb, seed + 3);
  land(s.mid, w, ml, h, tones[1], 0.55, 0.2);
  const midBeds = bedsOf(1, h * 0.5, h * 0.014, 0.24);
  mb.forEach((b, i) => modelButte(s.mid, w, ml, mground, b, tones[1], midBeds, scrubOf(1), rnd, 230 + i, 0.8));
  const widest = mb.reduce((a, b) => (b.half > a.half ? b : a));
  if (widest.half > widest.height * 0.3) arch(s.mid, w, mground, widest, tones[1], unit);
  const capRock = mix(tones[1].shade, tint(th.accent, 1), 0.4);
  for (let c = 0; c < 2; c++) {
    const cx = mb[c].x + (mb[(c + 1) % mb.length].x - mb[c].x + (c + 1 === mb.length ? w : 0)) * (0.4 + rnd(c, 240) * 0.2);
    const n = 2 + Math.floor(rnd(c, 241) * 4);
    for (let k = 0; k < n; k++) {
      const hx = cx + (k - n / 2) * h * 0.016 + rnd(c * 8 + k, 242) * h * 0.01;
      const hh = h * (0.03 + rnd(c * 8 + k, 243) ** 1.5 * 0.07);
      const hw = h * (0.005 + rnd(c * 8 + k, 244) * 0.004);
      wrapped(w, hx, (x) => hoodoo(s.mid, x, yAt(ml, w, x) + unit, hw, hh, tones[1], capRock, rnd, c * 8 + k));
    }
  }
  mist(s.mid, w, h * 0.77, h * 0.9, haze, 0.4);

  // Near: broken ledges of the canyon rim, and one big butte rising out of them.
  const nground = h * 0.92;
  const nb: Butte = { x: rnd(0, 250) * w, half: h * (0.06 + rnd(0, 251) * 0.05), height: h * (0.15 + rnd(0, 252) * 0.06), scree: 0.3 };
  const nl = sampleLine(w, (x) => Math.min(
    nground - h * 0.11 * terraced(x, w, 7, 3, seed + 9) - h * 0.012 * fbm(x, w, 30, 2, seed + 10),
    nground - butteLift(nb, apart(x, nb.x, w)) * (1 - 0.03 * fbm(x, w, 160, 2, seed + 11, true)),
  ));
  land(s.near, w, nl, h, tones[2], 0.6, 0.3);
  const nearBeds = bedsOf(2, h * 0.6, h * 0.018, 0.2);
  strata(s.near, w, nearBeds.top, h, tones[2], nearBeds.colours, nearBeds.gap, nearBeds.alpha, nearBeds.seed);
  modelButte(s.near, w, nl, nground, nb, tones[2], nearBeds, scrubOf(2), rnd, 260, 1);
  const scrub = scrubOf(2);
  const clumps = Math.round(w / (h * 0.05));
  for (let k = 0; k < clumps; k++) {
    if (rnd(k, 261) < 0.45) continue;
    const bx = ((k + rnd(k, 262)) * w) / clumps;
    wrapped(w, bx, (x) => bush(s.near, x, yAt(nl, w, x) + unit * 1.5, unit * (1.2 + rnd(k, 263) * 1.4), tones[2], scrub));
  }
  // Blocks fallen off the rim lie where they landed, part sunk in the sand.
  const blocks = Math.round(w / (h * 0.12));
  for (let k = 0; k < blocks; k++) {
    const bx = rnd(k, 264) * w;
    const bw = h * (0.006 + rnd(k, 265) ** 2 * 0.014);
    wrapped(w, bx, (x) => {
      const by = yAt(nl, w, x) + bw * 0.35;
      if (by < nground - h * 0.12) return;
      const tilt = (rnd(k, 266) - 0.5) * 0.5;
      s.near.save();
      s.near.translate(x, by);
      s.near.rotate(tilt);
      s.near.fillStyle = css(tones[2].body);
      s.near.fillRect(-bw, -bw * 1.2, bw * 2, bw * 1.2);
      s.near.fillStyle = css(tones[2].shade, 0.8);
      s.near.fillRect(bw * 0.25, -bw * 1.2, bw * 0.75, bw * 1.2);
      s.near.fillStyle = css(tones[2].lit, 0.8);
      s.near.fillRect(-bw, -bw * 1.2, bw * 2, bw * 0.22);
      s.near.restore();
    });
  }
  const hx = nb.x + w * 0.5 + (rnd(1, 267) - 0.5) * w * 0.2;
  for (let k = 0; k < 3; k++) {
    const x0 = hx + k * h * 0.024 + rnd(k, 268) * h * 0.01;
    wrapped(w, x0, (x) => hoodoo(s.near, x, yAt(nl, w, x) + unit * 2, h * (0.006 + rnd(k, 269) * 0.004), h * (0.05 + rnd(k, 270) * 0.06), tones[2], mix(tones[2].shade, tint(th.accent, 2), 0.4), rnd, 300 + k));
  }
}

/** Where a peak's top really is once the line's noise has moved it a little. */
function summit(l: Line, w: number, p: Peak): [number, number] {
  let sx = p.x;
  let sy = yAt(l, w, sx);
  for (let dx = -p.height * 0.3; dx <= p.height * 0.3; dx += l.step) {
    const y = yAt(l, w, p.x + dx);
    if (y < sy) {
      sy = y;
      sx = p.x + dx;
    }
  }
  return [sx, sy];
}

interface Rib {
  /** x, y pairs from the ridge down to the foot. */
  pts: number[];
  wide: number;
}

/**
 * Buttresses running down from each summit, fanning out as they fall, so a
 * range reads as spurs with gullies between them rather than one flat face.
 * Grouped by peak, left to right, for the gullies between neighbours.
 */
function ribsOf(w: number, l: Line, peaks: readonly Peak[], bottom: number, rnd: Rnd, k: number): Rib[][] {
  return peaks.map((p, i) => {
    const [sx, sy] = summit(l, w, p);
    const n = 3 + Math.floor(rnd(i, k) * 4);
    return Array.from({ length: n }, (_, j) => {
      const q = i * 12 + j;
      const u = ((j + 0.5) / n) * 2 - 1 + (rnd(q, k + 1) - 0.5) * 0.3;
      const x0 = sx + u * p.height * 0.4;
      const y0 = yAt(l, w, x0) + 2;
      const x1 = sx + u * p.height * (0.85 + rnd(q, k + 2) * 0.5);
      const y1 = Math.min(bottom, sy + p.height * (0.6 + rnd(q, k + 3) * 0.5));
      const pts: number[] = [];
      for (let t = 0; t <= 8; t++) {
        const f = t / 8;
        pts.push(x0 + (x1 - x0) * f + (t ? (rnd(q * 9 + t, k + 4) - 0.5) * p.height * 0.05 : 0), y0 + (y1 - y0) * f);
      }
      return { pts, wide: p.height * (0.05 + rnd(q, k + 5) * 0.07) };
    });
  });
}

/**
 * Light down the left of each rib and shade down its right, widening as it
 * falls; `broken` leaves out that share of the steps, for rock showing
 * through snow. Laid only over the range already painted.
 */
function paintRibs(ctx: CanvasRenderingContext2D, w: number, ribs: readonly Rib[][], lit: string, shade: string, scale: number, broken: number, rnd: Rnd, k: number): void {
  const lp = new Path2D();
  const sp = new Path2D();
  ribs.flat().forEach((rib, q) => {
    const { pts } = rib;
    for (let t = 0; t + 3 < pts.length; t += 2) {
      if (broken > 0 && rnd(q * 9 + t, k) < broken) continue;
      const a = rib.wide * scale * (0.25 + (t / pts.length) * 0.9);
      const b = rib.wide * scale * (0.25 + ((t + 2) / pts.length) * 0.9);
      for (const ox of [0, -w, w]) {
        sp.moveTo(pts[t] + ox, pts[t + 1]);
        sp.lineTo(pts[t + 2] + ox, pts[t + 3]);
        sp.lineTo(pts[t + 2] + ox + b, pts[t + 3] + b * 0.3);
        sp.lineTo(pts[t] + ox + a, pts[t + 1] + a * 0.3);
        sp.closePath();
        lp.moveTo(pts[t] + ox, pts[t + 1]);
        lp.lineTo(pts[t] + ox - a * 0.4, pts[t + 1] + a * 0.1);
        lp.lineTo(pts[t + 2] + ox - b * 0.4, pts[t + 3] + b * 0.1);
        lp.lineTo(pts[t + 2] + ox, pts[t + 3]);
        lp.closePath();
      }
    }
  });
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = shade;
  ctx.fill(sp);
  ctx.fillStyle = lit;
  ctx.fill(lp);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Snow above a ragged line, laid only over rock already painted, then
 * tongues of it down the gullies between ribs: further on the sunny west
 * faces, where it shows brightest, than on the east.
 */
function snowcap(ctx: CanvasRenderingContext2D, w: number, ribs: readonly Rib[][], line: number, snow: RGB, seed: number, h: number, rnd: Rnd, k: number): void {
  const p = new Path2D();
  p.moveTo(0, 0);
  for (let x = 0; x <= w; x += 3) {
    p.lineTo(x, line + h * 0.07 * (fbm(x, w, 9, 3, seed) - 0.5) + h * 0.025 * fbm(x, w, 40, 2, seed + 1, true) ** 2);
  }
  p.lineTo(w, 0);
  p.closePath();
  ribs.forEach((group, i) => {
    for (let j = 0; j + 1 < group.length; j++) {
      const a = group[j].pts;
      const b = group[j + 1].pts;
      const west = j + 1 < group.length / 2;
      const steps = Math.min(a.length / 2 - 1, Math.round(3 + rnd(i * 12 + j, k) * 3 + (west ? 2 : 0)));
      const left: number[] = [];
      const right: number[] = [];
      for (let t = 0; t <= steps; t++) {
        const mx = (a[t * 2] + b[t * 2]) / 2;
        const my = (a[t * 2 + 1] + b[t * 2 + 1]) / 2;
        const half = Math.abs(b[t * 2] - a[t * 2]) * 0.32 * (1 - t / (steps + 1)) * (0.8 + rnd(i * 99 + j * 9 + t, k + 1) * 0.4);
        left.push(mx - half, my);
        right.push(mx + half, my);
      }
      const tip = steps * 2;
      for (const ox of [0, -w, w]) {
        p.moveTo(left[0] + ox, left[1]);
        for (let q = 2; q < left.length; q += 2) p.lineTo(left[q] + ox, left[q + 1]);
        p.lineTo((left[tip] + right[tip]) / 2 + ox, left[tip + 1] + h * 0.012);
        for (let q = right.length - 2; q >= 0; q -= 2) p.lineTo(right[q] + ox, right[q + 1]);
        p.closePath();
      }
    }
  });
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = css(snow);
  ctx.fill(p);
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * Firs in stands of a few to a dozen, each stand its own height, spilling a
 * little way down the slope, with strays between; drawn back to front. None
 * grow where the ground rises above `treeline`.
 */
function forest(ctx: CanvasRenderingContext2D, w: number, l: Line, size: number, down: number, treeline: number, tone: LayerTone, snow: RGB, rnd: Rnd, k: number): void {
  const firs: { x: number; y: number; hgt: number; i: number }[] = [];
  const stands = Math.max(3, Math.round(w / (size * 2.2)));
  for (let c = 0; c < stands; c++) {
    if (rnd(c, k) < 0.2) continue;
    const cx = ((c + rnd(c, k + 1) * 0.8) * w) / stands;
    const count = 3 + Math.floor(rnd(c, k + 2) * 11);
    const spread = size * (0.8 + rnd(c, k + 3) * 2.5);
    const scale = 0.75 + rnd(c, k + 4) * 0.6;
    for (let j = 0; j < count; j++) {
      const i = c * 16 + j;
      const x = cx + (rnd(i, k + 5) - 0.5) * spread;
      firs.push({ x, y: yAt(l, w, x) + size * 0.12 + rnd(i, k + 6) ** 1.7 * down, hgt: size * scale * (0.55 + rnd(i, k + 7) ** 2 * 0.9), i });
    }
  }
  for (let j = 0; j < stands; j++) {
    if (rnd(j, k + 8) < 0.5) continue;
    const x = rnd(j, k + 9) * w;
    firs.push({ x, y: yAt(l, w, x) + size * 0.12 + rnd(j, k + 10) * down, hgt: size * (0.4 + rnd(j, k + 11) * 0.4), i: 900 + j });
  }
  firs.sort((a, b) => a.y - b.y);
  for (const f of firs) if (yAt(l, w, f.x) > treeline) wrapped(w, f.x, (x) => conifer(ctx, x, f.y, f.hgt, tone, snow, rnd, f.i));
}

function paintPeaks(s: Scene): void {
  const { w, h, rnd, tones, haze, seed } = s;
  const snow = mix(WHITE, haze, 0.25);
  const rock = (t: LayerTone, a: number) => css(mix(t.shade, t.body, 0.3), a);
  const fp = peaksAlong(w, 6, h * 0.08, h * 0.3, rnd, 140);
  const fl = rangeLine(w, h * 0.7, fp, h * 0.03, seed);
  land(s.far, w, fl, h, tones[0], 0.45);
  const fr = ribsOf(w, fl, fp, h * 0.72, rnd, 180);
  paintRibs(s.far, w, fr, css(tones[0].lit, 0.2), css(tones[0].shade, 0.3), 1, 0, rnd, 190);
  snowcap(s.far, w, fr, h * 0.5, mix(snow, haze, 0.35), seed + 1, h, rnd, 200);
  paintRibs(s.far, w, fr, css(mix(snow, haze, 0.2), 0.5), rock(tones[0], 0.4), 0.45, 0.45, rnd, 210);
  flanks(s.far, w, fl, fp, h, tones[0], 0.35, rnd, 150);
  mist(s.far, w, h * 0.56, h * 0.72, haze, 0.7);

  const mp = peaksAlong(w, 5, h * 0.05, h * 0.17, rnd, 160);
  const ml = rangeLine(w, h * 0.8, mp, h * 0.025, seed + 5);
  land(s.mid, w, ml, h, tones[1], 0.55, 0.2);
  const mr = ribsOf(w, ml, mp, h * 0.84, rnd, 220);
  paintRibs(s.mid, w, mr, css(tones[1].lit, 0.25), css(tones[1].shade, 0.4), 1, 0, rnd, 230);
  snowcap(s.mid, w, mr, h * 0.68, mix(snow, haze, 0.15), seed + 6, h, rnd, 240);
  paintRibs(s.mid, w, mr, css(snow, 0.55), rock(tones[1], 0.55), 0.45, 0.4, rnd, 250);
  flanks(s.mid, w, ml, mp, h, tones[1], 0.4, rnd, 170);
  forest(s.mid, w, ml, h * 0.024, h * 0.05, h * 0.74, tones[1], mix(snow, haze, 0.2), rnd, 260);
  mist(s.mid, w, h * 0.7, h * 0.86, haze, 0.5);

  const nl = sampleLine(w, (x) => h * 0.875 - h * 0.07 * fbm(x, w, 4, 3, seed + 11));
  const nc = s.near;
  land(nc, w, nl, h, tones[2], 0.3);
  // Snow lying on the open ground, deeper in some places than others.
  const drift = along(nl, w, 0, w, (x) => h * (0.002 + 0.07 * fbm(x, w, 11, 3, seed + 12) ** 2.5));
  nc.globalCompositeOperation = 'source-atop';
  nc.fillStyle = css(mix(snow, tones[2].lit, 0.25));
  nc.beginPath();
  nc.moveTo(0, 0);
  for (let j = 0; j < drift.length; j += 2) nc.lineTo(drift[j], drift[j + 1]);
  nc.lineTo(w, 0);
  nc.fill();
  nc.globalCompositeOperation = 'source-over';
  forest(nc, w, nl, h * 0.065, h * 0.05, 0, tones[2], mix(snow, tones[2].body, 0.2), rnd, 270);
  mist(nc, w, h * 0.86, h, haze, 0.3);
}

/** One mass of an ash column: puffs merged into a billow, dark ash on top and the lava's light on its underside. */
function billow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ash: RGB, under: RGB, alpha: number, rnd: Rnd, i: number): void {
  const mass = new Path2D();
  const puffs: [number, number, number][] = [];
  const n = 5 + Math.floor(rnd(i, 1) * 4);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rnd(i, 2 + k) * 0.8;
    const d = r * (0.2 + rnd(i, 12 + k) * 0.45);
    const pr = r * (0.38 + rnd(i, 22 + k) * 0.32);
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d * 0.7;
    mass.moveTo(px + pr, py);
    mass.arc(px, py, pr, 0, TAU);
    puffs.push([px, py, pr]);
  }
  const g = ctx.createLinearGradient(0, y - r * 1.1, 0, y + r);
  g.addColorStop(0, css(ash, alpha));
  g.addColorStop(0.55, css(ash, alpha));
  g.addColorStop(1, css(under, alpha));
  ctx.fillStyle = g;
  ctx.fill(mass);
  ctx.save();
  ctx.clip(mass);
  for (const [px, py, pr] of puffs) {
    const lo = ctx.createRadialGradient(px, py + pr * 0.85, 0, px, py + pr * 0.85, pr * 0.9);
    lo.addColorStop(0, css(under, alpha * 0.6));
    lo.addColorStop(1, css(under, 0));
    ctx.fillStyle = lo;
    ctx.fillRect(px - pr, py, pr * 2, pr * 1.8);
  }
  ctx.restore();
}

/** A glowing line of lava: a wide soft glow, then the flow, then its white-hot core. */
function lavaStroke(ctx: CanvasRenderingContext2D, pts: readonly (readonly [number, number])[], glow: RGB, width: number): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const passes: [number, RGB, number][] = [
    [width * 4, glow, 0.14],
    [width * 1.8, glow, 0.5],
    [width * 0.6, mix(glow, WHITE, 0.5), 0.9],
  ];
  for (const [lw, c, a] of passes) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = css(c, a);
    ctx.beginPath();
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.stroke();
  }
}

function paintVolcano(s: Scene): void {
  const { w, h, rnd, tones, haze, seed, th } = s;
  const glow = rgbOf(th.accent);
  const cx = w * (0.55 + rnd(0, 40) * 0.2);
  const base = h * 0.72;
  const peak = h * 0.32;
  const crater = h * 0.045;
  const spread = peak * 2.6;
  const top = base - peak;
  const side = (rnd(0, 45) < 0.5 ? -1 : 1) * peak * 1.25;
  // A stratovolcano's flanks are concave, steepest near the top; a parasitic cone sits on one of them.
  const fl = sampleLine(w, (x) => {
    const d = apart(x, cx, w);
    const u = Math.min(1, Math.max(0, d - crater) / spread);
    const lean = x > cx ? 0.012 : 0;
    const notch = d < crater ? h * (0.022 + lean) * (1 - (d / crater) ** 2) : 0;
    const vent = h * 0.035 * Math.max(0, 1 - apart(x, cx + side, w) / (h * 0.06)) ** 1.4;
    return base - Math.max(peak * (1 - u) ** 1.9 - notch, vent * (1 - u) + peak * (1 - u) ** 1.9) - h * 0.025 * fbm(x, w, 9, 3, seed) - h * 0.008 * fbm(x, w, 60, 2, seed + 1, true);
  });

  // The ash column leans downwind and spreads as it rises; the crater lights the undersides of its lower billows.
  const ashTop = rgbOf(th.cloudShade);
  for (let k = 9; k >= 0; k--) {
    const t = k / 9;
    const r = h * (0.035 + t * 0.075);
    const px = cx + t ** 1.6 * w * 0.16 + (rnd(k, 41) - 0.5) * r * 0.5;
    const py = top - h * 0.035 - t * h * 0.3;
    const ash = mix(ashTop, haze, 0.1 + t * 0.45);
    billow(s.far, px, py, r, ash, mix(glow, ash, 0.2 + t * 0.7), 1 - t * 0.25, rnd, 400 + k);
  }
  // The cone is the subject; hazed like the rest of the far layer it washes out against the plume.
  const cone: LayerTone = { body: mix(tones[0].body, tones[1].body, 0.6), lit: mix(tones[0].lit, tones[1].lit, 0.6), shade: mix(tones[0].shade, tones[1].shade, 0.6) };
  land(s.far, w, fl, h, cone, 0.35);
  flanks(s.far, w, fl, [{ x: cx, height: peak, slope: peak / spread }], h, cone, 0.35, rnd, 195);

  // Ribs worn down the cone, fanning out from the summit: each gully's left wall in shade, its right wall lit.
  const ctx = s.far;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const rib = Math.max(1, h * 0.0018);
  for (let j = 0; j < 26; j++) {
    const e = (j / 25 - 0.5) * 2 * spread * (0.85 + rnd(j, 46) * 0.2);
    const x0 = cx + e * 0.06;
    const y0 = yAt(fl, w, x0) + h * 0.012;
    const reach = 0.35 + rnd(j, 47) * 0.6;
    const x1 = cx + e * reach;
    const y1 = yAt(fl, w, x1) + (base - yAt(fl, w, x1)) * 0.35 + h * 0.01;
    const bend = e * 0.12;
    for (const [dx, c, a] of [[0, cone.shade, 0.5], [rib * 1.4, cone.lit, 0.35]] as const) {
      ctx.strokeStyle = css(c, a);
      ctx.lineWidth = rib;
      ctx.beginPath();
      ctx.moveTo(x0 + dx, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2 + bend + dx, (y0 + y1) / 2, x1 + dx, y1);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Lava spills over the low side of the rim and finds its way down, wandering between the ribs.
  for (let k = 0; k < 4; k++) {
    const dir = k % 2 ? 1 : -1;
    let x = cx + dir * crater * (0.5 + rnd(k, 42) * 0.4);
    const pts: [number, number][] = [];
    const steps = 10 + Math.floor(rnd(k, 43) * 10);
    for (let j = 0; j <= steps; j++) {
      const y = yAt(fl, w, x) + h * 0.004 + j * h * 0.0035 * (0.4 + rnd(k, 44));
      pts.push([x, y]);
      x += dir * h * (0.006 + rnd(k * 40 + j, 48) * 0.01) + (rnd(k * 40 + j, 49) - 0.5) * h * 0.008;
    }
    lavaStroke(ctx, pts, glow, Math.max(1, h * (0.0016 + rnd(k, 50) * 0.0014)));
  }
  // The rim lit from inside the crater, and the light it throws up into the bottom of the plume.
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.strokeStyle = css(mix(glow, WHITE, 0.35), 0.8);
  ctx.lineWidth = Math.max(1, h * 0.003);
  ctx.beginPath();
  for (let x = cx - crater * 1.4; x <= cx + crater * 1.4; x += fl.step) ctx.lineTo(x, yAt(fl, w, x) + h * 0.002);
  ctx.stroke();
  ctx.restore();
  const lip = ctx.createRadialGradient(cx, top + h * 0.01, 0, cx, top + h * 0.01, crater * 2.4);
  lip.addColorStop(0, css(mix(glow, WHITE, 0.3), 0.75));
  lip.addColorStop(1, css(glow, 0));
  ctx.fillStyle = lip;
  ctx.fillRect(cx - crater * 2.4, top - crater * 2.4, crater * 4.8, crater * 4.8);
  mist(ctx, w, h * 0.6, h * 0.78, mix(haze, glow, 0.25), 0.4);

  // Middle: broken ridges, lit from below where lava runs out of sight behind the near rocks.
  const mp = peaksAlong(w, Math.max(5, Math.round((w / h) * 4.5)), h * 0.05, h * 0.15, rnd, 180);
  for (const p of mp) p.slope *= 0.75;
  const ml = rangeLine(w, h * 0.86, mp, h * 0.03, seed + 4);
  land(s.mid, w, ml, h, tones[1], 0.4, 0.15);
  flanks(s.mid, w, ml, mp, h, tones[1], 0.4, rnd, 190);
  lavaGlow(s.mid, w, ml, h * 0.8, h, glow, 0.4, h);

  // Near: jagged black rock against the glow, its crests rim-lit and cracks showing the heat inside.
  const np = peaksAlong(w, Math.max(6, Math.round((w / h) * 7)), h * 0.04, h * 0.13, rnd, 470);
  const nl = rangeLine(w, h * 0.97, np, h * 0.035, seed + 8);
  land(s.near, w, nl, h, tones[2], 0.2);
  flanks(s.near, w, nl, np, h, tones[2], 0.45, rnd, 480);
  lavaGlow(s.near, w, nl, h * 0.9, h, glow, 0.6, h);
  np.forEach((p, i) => {
    if (rnd(i, 481) < 0.5) return;
    wrapped(w, p.x + (rnd(i, 482) - 0.5) * p.height, (x) => {
      const pts: [number, number][] = [];
      let fx = x;
      for (let y = yAt(nl, w, x) + h * 0.015; y < h; y += h * 0.012) {
        pts.push([fx, y]);
        fx += (rnd(i * 50 + pts.length, 483) - 0.5) * h * 0.014;
      }
      s.near.save();
      s.near.globalCompositeOperation = 'source-atop';
      lavaStroke(s.near, pts, glow, Math.max(1, h * 0.0012));
      s.near.restore();
    });
  });
  mist(s.near, w, h * 0.9, h, mix(haze, glow, 0.4), 0.25);
}

/**
 * Light from lava out of sight below: a rim along every crest, as the glow
 * behind the rock catches its edge, and the rock's foot warmed from `low`
 * down. Over rock already painted only.
 */
function lavaGlow(ctx: CanvasRenderingContext2D, w: number, l: Line, low: number, bottom: number, glow: RGB, alpha: number, h: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineJoin = 'round';
  for (const [lw, a] of [[h * 0.007, alpha * 0.3], [h * 0.0025, alpha]] as const) {
    ctx.strokeStyle = css(mix(glow, WHITE, 0.15), a);
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i < l.ys.length; i++) ctx.lineTo(i * l.step, l.ys[i]);
    ctx.stroke();
  }
  const g = ctx.createLinearGradient(0, low, 0, bottom);
  g.addColorStop(0, css(glow, 0));
  g.addColorStop(1, css(glow, alpha * 0.6));
  ctx.fillStyle = g;
  ctx.fillRect(0, low, w, bottom - low);
  ctx.restore();
}

/**
 * A stalactite (`dir` 1, hanging from `y0`) or stalagmite (`dir` -1, rising
 * from it): a tapered cone rounded across, its sunward side lit and the other
 * in shade, with a wet glint near the tip where the water runs off.
 */
function drip(ctx: CanvasRenderingContext2D, x: number, y0: number, len: number, sw: number, tone: LayerTone, dir: 1 | -1, wet: RGB): void {
  const tip = y0 + len * dir;
  const g = ctx.createLinearGradient(x - sw, 0, x + sw, 0);
  g.addColorStop(0, css(tone.lit));
  g.addColorStop(0.4, css(tone.body));
  g.addColorStop(1, css(tone.shade));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - sw, y0 - dir * sw * 0.3);
  ctx.quadraticCurveTo(x - sw * 0.25, y0 + len * 0.55 * dir, x, tip);
  ctx.quadraticCurveTo(x + sw * 0.3, y0 + len * 0.5 * dir, x + sw, y0 - dir * sw * 0.3);
  ctx.fill();
  ctx.fillStyle = css(wet, 0.55);
  ctx.beginPath();
  ctx.ellipse(x - sw * 0.12, tip - dir * len * 0.12, Math.max(0.8, sw * 0.08), Math.max(1, len * 0.06), 0, 0, TAU);
  ctx.fill();
}

/**
 * Rock hanging from the roof: a ragged edge, its lip lit by light coming up
 * off the floor, with drips of very different sizes off it, small ones
 * gathered round the big. Returns the roof line.
 */
function ceiling(ctx: CanvasRenderingContext2D, w: number, depth: number, tone: LayerTone, count: number, rnd: Rnd, k: number, seed: number, wet: RGB): Line {
  const l = sampleLine(w, (x) => depth * (0.35 + 0.4 * fbm(x, w, 7, 3, seed) + 0.1 * fbm(x, w, 40, 2, seed + 9, true)));
  const g = ctx.createLinearGradient(0, 0, 0, depth);
  // One flat colour down to above the highest the roof line reaches (35% of depth): a lowered layer uncovers more of its own top, which then matches.
  g.addColorStop(0, css(tone.shade));
  g.addColorStop(0.25, css(tone.shade));
  g.addColorStop(1, css(tone.body));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 0; i < l.ys.length; i++) ctx.lineTo(i * l.step, l.ys[i]);
  ctx.lineTo(w, 0);
  ctx.fill();
  ctx.strokeStyle = css(tone.lit, 0.7);
  ctx.lineWidth = Math.max(1, depth * 0.02);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < l.ys.length; i++) ctx.lineTo(i * l.step, l.ys[i] - ctx.lineWidth * 0.4);
  ctx.stroke();
  for (let i = 0; i < count; i++) {
    const sx = ((i + rnd(i, k)) * w) / count;
    const len = depth * (0.3 + rnd(i, k + 1) ** 2.2 * 1.9);
    const sw = len * (0.1 + rnd(i, k + 2) * 0.08);
    const small = rnd(i, k + 3) < 0.55 ? 1 + Math.floor(rnd(i, k + 4) * 3) : 0;
    wrapped(w, sx, (x) => {
      for (let j = 0; j < small; j++) {
        const ox = x + (rnd(i * 8 + j, k + 5) - 0.5) * sw * 7;
        const sl = len * (0.12 + rnd(i * 8 + j, k + 6) * 0.3);
        drip(ctx, ox, yAt(l, w, ox), sl, sl * 0.14, tone, 1, wet);
      }
      drip(ctx, x, yAt(l, w, x), len, sw, tone, 1, wet);
    });
  }
  return l;
}

/** Stalagmites standing on a floor, where drips from the roof landed for long enough. */
function stalagmites(ctx: CanvasRenderingContext2D, w: number, floor: Line, high: number, tone: LayerTone, count: number, rnd: Rnd, k: number, wet: RGB): void {
  for (let i = 0; i < count; i++) {
    const sx = ((i + rnd(i, k)) * w) / count;
    const len = high * (0.15 + rnd(i, k + 1) ** 1.8 * 0.85);
    const sw = len * (0.24 + rnd(i, k + 2) * 0.2);
    wrapped(w, sx, (x) => {
      if (rnd(i, k + 3) < 0.5) {
        const ox = x + sw * (1.2 + rnd(i, k + 4));
        const sl = len * (0.25 + rnd(i, k + 5) * 0.3);
        drip(ctx, ox, yAt(floor, w, ox) + sl * 0.1, sl, sl * 0.2, tone, -1, wet);
      }
      drip(ctx, x, yAt(floor, w, x) + len * 0.08, len, sw, tone, -1, wet);
    });
  }
}

/** A clump of crystal shards growing out of rock, each a lit face and a shaded face, glowing faintly into the dark. */
function crystals(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, colours: readonly RGB[], rnd: Rnd, i: number): void {
  const [body, dark, light] = colours;
  const halo = ctx.createRadialGradient(x, y - size * 0.4, 0, x, y - size * 0.4, size * 1.6);
  halo.addColorStop(0, css(body, 0.28));
  halo.addColorStop(1, css(body, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(x - size * 1.6, y - size * 2, size * 3.2, size * 3.2);
  const n = 3 + Math.floor(rnd(i, 1) * 3);
  for (let j = 0; j < n; j++) {
    const a = -Math.PI / 2 + (rnd(i, 2 + j) - 0.5) * 1.3;
    const len = size * (0.5 + rnd(i, 10 + j) * 0.7);
    const hw = len * 0.16;
    const bx = x + (rnd(i, 20 + j) - 0.5) * size * 0.6;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const tx = bx + ca * len;
    const ty = y + sa * len;
    const nx = -sa * hw;
    const ny = ca * hw;
    const shoulder = 0.75;
    const ex = bx + ca * len * shoulder;
    const ey = y + sa * len * shoulder;
    for (const [side, c] of [[-1, light], [1, dark]] as const) {
      ctx.fillStyle = css(c);
      ctx.beginPath();
      ctx.moveTo(bx, y);
      ctx.lineTo(bx + nx * side, y + ny * side);
      ctx.lineTo(ex + nx * side, ey + ny * side);
      ctx.lineTo(tx, ty);
      ctx.lineTo(ex, ey);
      ctx.fill();
    }
    ctx.strokeStyle = css(mix(light, WHITE, 0.5), 0.8);
    ctx.lineWidth = Math.max(0.8, hw * 0.25);
    ctx.beginPath();
    ctx.moveTo(bx, y);
    ctx.lineTo(ex, ey);
    ctx.lineTo(tx, ty);
    ctx.stroke();
  }
}

function paintCave(s: Scene): void {
  const { w, h, rnd, tones, seed, th } = s;
  // Cool damp air, a blue-grey from the cave's own water. The rock behind is
  // lifted toward it so the battlefield's soil stays the darkest thing on
  // screen and slugs and shots read against what is behind them.
  const cool = mix(rgbOf(th.haze), rgbOf(th.water), 0.55);
  const air = (a: number) => mix(cool, WHITE, a);
  const outline = rgbOf(th.outline);
  // Daylight from cracks in the roof, warmer than the air it falls through.
  const day = mix(rgbOf(th.soil[2]), WHITE, 0.65);
  const lifted = (t: LayerTone, to: RGB, a: number): LayerTone => {
    const body = mix(t.body, to, a);
    return { body, lit: mix(body, day, 0.35), shade: mix(body, outline, 0.3) };
  };
  const rock = [lifted(tones[0], air(0.3), 0.8), lifted(tones[1], air(0.26), 0.74), lifted(tones[2], air(0.24), 0.72)];
  const wet = mix(rgbOf(th.water), WHITE, 0.6);
  const crystal = th.details.find((d) => d.kind === 'crystal');
  const shards = (i: number) => crystal?.colors.map((c) => mix(rgbOf(c), air(0.4), [0.55, 0.3, 0.1][i]));

  const sky = s.far.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, css(air(0)));
  sky.addColorStop(0.55, css(air(0.16)));
  sky.addColorStop(0.85, css(air(0.3)));
  s.far.fillStyle = sky;
  s.far.fillRect(0, 0, w, h);

  // The shafts fall the same way the sun falls outside.
  const shafts: [number, number][] = [];
  for (let i = 0; i < 3; i++) shafts.push([((i + rnd(i, 60) * 0.6) * w) / 3, w * (0.012 + rnd(i, 61) * 0.02)]);
  const shaft = (ctx: CanvasRenderingContext2D, alpha: number, reach: number) => {
    for (const [sx, wid] of shafts) {
      // Faded in from the layer's top edge: the screen lowers the layer, and a shaft at full strength there ends square.
      const g = ctx.createLinearGradient(0, 0, 0, h * reach);
      g.addColorStop(0, css(day, 0));
      g.addColorStop(0.18, css(day, alpha));
      g.addColorStop(1, css(day, 0));
      ctx.fillStyle = g;
      wrapped(w, sx, (x) => {
        ctx.beginPath();
        ctx.moveTo(x - wid, 0);
        ctx.lineTo(x + wid, 0);
        ctx.lineTo(x + wid * 2.5 + h * 0.2 * reach, h * reach);
        ctx.lineTo(x - wid * 2 + h * 0.2 * reach, h * reach);
        ctx.fill();
      });
    }
  };
  shaft(s.far, 0.3, 0.85);
  // Where each shaft lands it lights a pool on the floor.
  for (const [sx, wid] of shafts) {
    wrapped(w, sx + h * 0.17, (x) => {
      const pool = s.far.createRadialGradient(x, h * 0.78, 0, x, h * 0.78, wid * 6);
      pool.addColorStop(0, css(day, 0.35));
      pool.addColorStop(1, css(day, 0));
      s.far.fillStyle = pool;
      s.far.fillRect(x - wid * 6, h * 0.78 - wid * 6, wid * 12, wid * 12);
    });
  }

  // Drip sizes follow the view height, so their number follows its width or a phone's roof turns into a comb.
  const many = (perHeight: number) => Math.max(2, Math.round((perHeight * w) / h));
  ceiling(s.far, w, h * 0.14, rock[0], many(17), rnd, 62, seed, wet);
  const ff = sampleLine(w, (x) => h * 0.76 - h * 0.07 * fbm(x, w, 5, 4, seed + 2));
  land(s.far, w, ff, h, rock[0], 0.3, 0.3);
  stalagmites(s.far, w, ff, h * 0.09, rock[0], many(10), rnd, 300, wet);
  mist(s.far, w, h * 0.72, h, air(0.3), 0.4);

  // Pillars where a drip from the roof met the mound under it.
  for (let i = 0; i < 3; i++) {
    const px = ((i + 0.2 + rnd(i, 63) * 0.6) * w) / 3;
    const top = w * (0.012 + rnd(i, 64) * 0.016);
    const waist = top * (0.35 + rnd(i, 65) * 0.25);
    wrapped(w, px, (x) => {
      const g = s.mid.createLinearGradient(x - top * 1.6, 0, x + top * 1.6, 0);
      g.addColorStop(0, css(rock[1].lit));
      g.addColorStop(0.45, css(rock[1].body));
      g.addColorStop(1, css(rock[1].shade));
      s.mid.fillStyle = g;
      s.mid.beginPath();
      s.mid.moveTo(x - top * 1.6, 0);
      s.mid.quadraticCurveTo(x - waist, h * 0.45, x - top * 1.9, h);
      s.mid.lineTo(x + top * 1.9, h);
      s.mid.quadraticCurveTo(x + waist, h * 0.5, x + top * 1.6, 0);
      s.mid.fill();
      // Water runs down the column's lit side and leaves it glistening.
      s.mid.strokeStyle = css(wet, 0.35);
      s.mid.lineWidth = Math.max(1, top * 0.12);
      s.mid.beginPath();
      s.mid.moveTo(x - top * 1.1, 0);
      s.mid.quadraticCurveTo(x - waist * 0.7, h * 0.45, x - top * 1.3, h);
      s.mid.stroke();
    });
  }
  ceiling(s.mid, w, h * 0.2, rock[1], many(8), rnd, 66, seed + 3, wet);
  const mf = sampleLine(w, (x) => h * 0.86 - h * 0.07 * fbm(x, w, 6, 3, seed + 4));
  land(s.mid, w, mf, h, rock[1], 0.35, 0.35);
  stalagmites(s.mid, w, mf, h * 0.13, rock[1], many(5.7), rnd, 310, wet);
  floorGlints(s.mid, w, mf, h, wet, shards(1), rnd, 320);
  mist(s.mid, w, h * 0.75, h, air(0.26), 0.25);
  // The shafts pass in front of the farther rock, so the middle layer carries them too.
  shaft(s.mid, 0.12, 0.9);

  ceiling(s.near, w, h * 0.27, rock[2], many(4.5), rnd, 67, seed + 5, wet);
  const nf = sampleLine(w, (x) => h * 0.94 - h * 0.05 * fbm(x, w, 5, 3, seed + 6));
  land(s.near, w, nf, h, rock[2], 0.35, 0.4);
  stalagmites(s.near, w, nf, h * 0.12, rock[2], many(3.4), rnd, 330, wet);
  floorGlints(s.near, w, nf, h, wet, shards(2), rnd, 340);

  // The screen lowers the middle and near layers by up to a tenth of the height; their tops fade out over that,
  // so the roof behind shows through with no edge.
  for (const ctx of [s.mid, s.near]) {
    const fade = ctx.createLinearGradient(0, 0, 0, h * 0.1);
    fade.addColorStop(0, 'rgba(0,0,0,1)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, w, h * 0.1);
    ctx.restore();
  }
}

/** Wet patches catching the light along a cave floor, and here and there a crystal clump. */
function floorGlints(ctx: CanvasRenderingContext2D, w: number, floor: Line, h: number, wet: RGB, shards: RGB[] | undefined, rnd: Rnd, k: number): void {
  const n = Math.round((w / h) * 4);
  for (let i = 0; i < n; i++) {
    const sx = rnd(i, k) * w;
    wrapped(w, sx, (x) => {
      const y = yAt(floor, w, x) + h * (0.01 + rnd(i, k + 1) * 0.04);
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = css(wet, 0.1 + rnd(i, k + 2) * 0.15);
      ctx.beginPath();
      ctx.ellipse(x, y, h * (0.006 + rnd(i, k + 3) * 0.02), h * 0.0025, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    });
  }
  if (!shards) return;
  const c = Math.max(2, Math.round((w / h) * 2));
  for (let i = 0; i < c; i++) {
    const sx = ((i + rnd(i, k + 4)) * w) / c;
    const size = h * (0.022 + rnd(i, k + 5) * 0.03);
    wrapped(w, sx, (x) => crystals(ctx, x, yAt(floor, w, x) + size * 0.25, size, shards, rnd, k * 10 + i));
  }
}

/**
 * A run of works along `base`: saw-tooth halls, office blocks, gas holders
 * and cooling towers, each lit on its left and shaded on its right, tied
 * together by pipe runs and gantries, with banded chimneys whose smoke rolls
 * away downwind.
 */
function works(s: Scene, ctx: CanvasRenderingContext2D, base: number, scale: number, tone: LayerTone, smoke: RGB, k: number): void {
  const { w, h, rnd, th } = s;
  const lamp = mix(rgbOf(th.accent), WHITE, 0.6);
  const dark = mix(tone.shade, rgbOf(th.outline), 0.25);
  const band = mix(rgbOf(th.accent), tone.body, 0.4);
  const win = h * 0.006 * scale;
  const panes = new Path2D();
  const lamps = new Path2D();
  const stacks: [number, number, number][] = [];
  const steam: [number, number, number][] = [];
  const roofs: [number, number, number][] = [];
  // Round things take the light across them: lit edge, body, then shade on the far side.
  const across = (x0: number, x1: number) => {
    const g = ctx.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, css(tone.lit));
    g.addColorStop(0.35, css(tone.body));
    g.addColorStop(1, css(tone.shade));
    return g;
  };
  const grid = (x0: number, x1: number, y0: number, y1: number, i: number) => {
    let n = 0;
    for (let y = y0 + win * 1.4; y < y1 - win * 1.6; y += win * 2.6) {
      for (let wx = x0 + win; wx < x1 - win * 1.6; wx += win * 2.2) {
        (rnd(i * 97 + n++, k + 9) < 0.1 ? lamps : panes).rect(wx, y, win, win * 1.4);
      }
    }
  };
  ctx.fillStyle = css(tone.body);
  ctx.fillRect(0, base, w, h - base);
  let x = 0;
  let i = 0;
  while (x < w) {
    const bw = h * (0.05 + rnd(i, k) * 0.09) * scale;
    const bh = h * (0.03 + rnd(i, k + 1) ** 1.5 * 0.1) * scale;
    const kind = Math.floor(rnd(i, k + 2) * 6) % 6;
    if (kind === 0) {
      const teeth = 3 + Math.floor(rnd(i, k + 3) * 3);
      const tw = bw / teeth;
      const eave = base - bh * 0.7;
      ctx.fillStyle = css(tone.body);
      ctx.fillRect(x, eave, bw, base - eave);
      ctx.fillStyle = css(tone.shade);
      ctx.fillRect(x + bw * 0.88, eave, bw * 0.12, base - eave);
      // Each roof tooth's slope faces up toward the sun; its upright glazed face looks the other way.
      for (let t = 0; t < teeth; t++) {
        ctx.fillStyle = css(tone.lit);
        ctx.beginPath();
        ctx.moveTo(x + t * tw, eave);
        ctx.lineTo(x + (t + 1) * tw, base - bh);
        ctx.lineTo(x + (t + 1) * tw, eave);
        ctx.fill();
        ctx.fillStyle = css(dark);
        ctx.fillRect(x + (t + 1) * tw - Math.max(1, win * 0.5), base - bh, Math.max(1, win * 0.5), bh * 0.3);
      }
      grid(x, x + bw * 0.86, eave + win, base, i);
      roofs.push([x, x + bw, eave]);
    } else if (kind === 1) {
      const r = bw * 0.4;
      const cx = x + bw * 0.5;
      const top = base - bh * 1.3;
      ctx.fillStyle = across(cx - r, cx + r);
      ctx.fillRect(cx - r, top, r * 2, base - top);
      ctx.fillStyle = css(tone.lit);
      ctx.beginPath();
      ctx.ellipse(cx, top, r, r * 0.14, 0, Math.PI, TAU);
      ctx.fill();
      // The guide frame the holder's lift rises inside.
      ctx.strokeStyle = css(dark, 0.7);
      ctx.lineWidth = Math.max(1, win * 0.35);
      ctx.beginPath();
      for (const f of [-1.06, -0.5, 0.5, 1.06]) {
        ctx.moveTo(cx + r * f, base);
        ctx.lineTo(cx + r * f, top - r * 0.2);
      }
      for (let y = base - (base - top) / 3; y > top - r * 0.2; y -= (base - top) / 3) {
        ctx.moveTo(cx - r * 1.06, y);
        ctx.lineTo(cx + r * 1.06, y);
      }
      ctx.stroke();
    } else if (kind === 2 && rnd(i, k + 8) < 0.25) {
      // Cooling tower: a waisted shell, round so its light rolls round it, steam out of the mouth.
      const r = bw * 0.46;
      const cx = x + bw * 0.5;
      const top = base - Math.max(bh * 1.8, r * 2.2);
      ctx.fillStyle = across(cx - r, cx + r);
      ctx.beginPath();
      ctx.moveTo(cx - r, base);
      ctx.quadraticCurveTo(cx - r * 0.42, base - (base - top) * 0.7, cx - r * 0.62, top);
      ctx.lineTo(cx + r * 0.62, top);
      ctx.quadraticCurveTo(cx + r * 0.42, base - (base - top) * 0.7, cx + r, base);
      ctx.fill();
      ctx.fillStyle = css(dark);
      ctx.beginPath();
      ctx.ellipse(cx, top, r * 0.62, r * 0.07, 0, 0, TAU);
      ctx.fill();
      steam.push([cx, top, r * 0.62]);
    } else {
      const front = bw * 0.82;
      ctx.fillStyle = css(tone.body);
      ctx.fillRect(x, base - bh, front, bh);
      ctx.fillStyle = css(tone.shade);
      ctx.fillRect(x + front, base - bh, bw - front, bh);
      ctx.fillStyle = css(tone.lit);
      ctx.fillRect(x, base - bh, front, Math.max(1, win * 0.5));
      ctx.fillRect(x, base - bh, Math.max(1, win * 0.4), bh);
      grid(x, x + front, base - bh, base, i);
      roofs.push([x, x + bw, base - bh]);
    }
    if (rnd(i, k + 4) < 0.4) stacks.push([x + bw * (0.3 + rnd(i, k + 5) * 0.4), base - bh, bh * (1 + rnd(i, k + 6) * 1.4)]);
    x += bw + h * 0.004 * scale;
    i++;
  }
  ctx.fillStyle = css(dark);
  ctx.fill(panes);
  ctx.fillStyle = css(lamp);
  ctx.fill(lamps);

  // Pipe runs and gantries between neighbours, at the lower of the two roofs.
  roofs.forEach(([, a1, ay], j) => {
    const next = roofs[j + 1];
    if (!next || next[0] - a1 > h * 0.05 * scale) return;
    const y = Math.max(ay, next[2]) + win * 2;
    const x0 = a1 - win * 3;
    const x1 = next[0] + win * 3;
    const pick = rnd(j, k + 7);
    if (pick < 0.4) {
      for (const [lw, c, dy] of [[win * 1.1, tone.shade, 0], [win * 0.35, tone.lit, -win * 0.3]] as const) {
        ctx.strokeStyle = css(c);
        ctx.lineWidth = Math.max(1, lw);
        ctx.beginPath();
        ctx.moveTo(x0, y + dy);
        ctx.lineTo(x1, y + dy);
        ctx.stroke();
      }
    } else if (pick < 0.65) {
      const deep = win * 2;
      ctx.strokeStyle = css(dark);
      ctx.lineWidth = Math.max(1, win * 0.3);
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.moveTo(x0, y + deep);
      ctx.lineTo(x1, y + deep);
      for (let gx = x0, up = true; gx < x1; gx += deep, up = !up) {
        ctx.moveTo(gx, up ? y : y + deep);
        ctx.lineTo(Math.min(x1, gx + deep), up ? y + deep : y);
      }
      ctx.stroke();
    }
  });

  for (const [sx, sy, sh] of stacks) {
    const cw = h * 0.008 * scale;
    ctx.fillStyle = across(sx - cw / 2, sx + cw / 2);
    ctx.fillRect(sx - cw / 2, sy - sh, cw, sh + 1);
    ctx.fillStyle = css(band);
    for (const b of [0.05, 0.16]) ctx.fillRect(sx - cw / 2, sy - sh + sh * b, cw, sh * 0.05);
  }
  // Smoke leaves each stack and is carried right, the way the clouds drift; lit on top, its underside in shadow.
  const puff = mix(smoke, WHITE, 0.25);
  stacks.forEach(([sx, sy, sh], j) => {
    const cw = h * 0.008 * scale;
    for (let p = 0; p < 5; p++) {
      const t = p / 4;
      billow(ctx, sx + t * t * h * 0.12 * scale, sy - sh - cw * 2 - t * h * 0.05 * scale, cw * (1.4 + t * 3.5), puff, smoke, 0.7 * (1 - t * 0.6), rnd, k * 100 + j * 8 + p);
    }
  });
  const vapour = mix(smoke, WHITE, 0.5);
  steam.forEach(([sx, sy, r], j) => {
    for (let p = 0; p < 4; p++) {
      const t = p / 3;
      billow(ctx, sx + t * t * r * 2.5, sy - r * (0.5 + t * 1.6), r * (0.9 + t * 0.9), vapour, puff, 0.8 * (1 - t * 0.55), rnd, k * 100 + 60 + j * 8 + p);
    }
  });
}

function paintCity(s: Scene): void {
  const { w, h, rnd, tones, haze, th } = s;
  const smoke = mix(rgbOf(th.cloudShade), haze, 0.4);
  works(s, s.far, h * 0.72, 0.9, tones[0], mix(smoke, haze, 0.4), 30);
  mist(s.far, w, h * 0.62, h * 0.76, haze, 0.6);
  works(s, s.mid, h * 0.82, 1.4, tones[1], smoke, 40);
  mist(s.mid, w, h * 0.72, h * 0.86, haze, 0.45);

  // Dockside cranes: lattice towers with a jib, each set at its own angle.
  const nc = s.near;
  const base = h * 0.92;
  nc.fillStyle = css(tones[2].body);
  nc.fillRect(0, base, w, h - base);
  nc.strokeStyle = css(tones[2].body);
  const cranes = Math.max(1, Math.round((w / h) * 1.7));
  for (let i = 0; i < cranes; i++) {
    const cx = ((i + 0.15 + rnd(i, 50) * 0.7) * w) / cranes;
    const tall = h * (0.2 + rnd(i, 51) * 0.1);
    const jib = h * (0.16 + rnd(i, 52) * 0.1);
    const ang = -0.05 - rnd(i, 53) * 0.35;
    const tw = h * 0.016;
    wrapped(w, cx, (x) => {
      nc.lineWidth = Math.max(1, h * 0.0025);
      nc.beginPath();
      nc.moveTo(x - tw, base);
      nc.lineTo(x - tw * 0.7, base - tall);
      nc.moveTo(x + tw, base);
      nc.lineTo(x + tw * 0.7, base - tall);
      for (let y = base; y > base - tall; y -= tw * 1.6) {
        nc.moveTo(x - tw * 0.85, y);
        nc.lineTo(x + tw * 0.85, y - tw * 1.6);
      }
      const tipX = x + Math.cos(ang) * jib;
      const tipY = base - tall + Math.sin(ang) * jib;
      nc.moveTo(x - jib * 0.25, base - tall + 2);
      nc.lineTo(tipX, tipY);
      nc.moveTo(x, base - tall - h * 0.03);
      nc.lineTo(tipX, tipY);
      nc.moveTo(x, base - tall - h * 0.03);
      nc.lineTo(x - jib * 0.25, base - tall + 2);
      nc.moveTo(tipX - jib * 0.05, tipY);
      nc.lineTo(tipX - jib * 0.05, tipY + h * 0.08);
      nc.stroke();
      nc.fillStyle = css(tones[2].body);
      nc.fillRect(x - tw * 1.2, base - tall - h * 0.012, tw * 2.4, h * 0.02);
    });
  }
  works(s, nc, base, 1.1, tones[2], smoke, 55);
  mist(nc, w, h * 0.85, h, haze, 0.3);
}

/**
 * A floating rock: a turf cap over a band of earth, and under it layered rock
 * tapering to a ragged point, lit on its west face and darkening toward the
 * tip, with roots hanging out of the underside.
 */
function floater(ctx: CanvasRenderingContext2D, x: number, y: number, rw: number, tone: LayerTone, grass: LayerTone, soil: RGB, rnd: Rnd, i: number, falls: RGB | null): void {
  const under = rw * (0.75 + rnd(i, 70) * 0.75);
  const lean = (rnd(i, 69) - 0.5) * rw * 0.5;
  const steps = 12;
  const rim: [number, number][] = [];
  for (let k = 1; k < steps; k++) {
    const a = (k / steps) * 2 - 1;
    const depth = (1 - Math.abs(a)) ** 0.85 * under * (0.55 + 0.45 * rnd(i, 71 + k));
    rim.push([x + a * rw * (0.94 - (1 - Math.abs(a)) * 0.08) + lean * (1 - Math.abs(a)) + (rnd(i, 90 + k) - 0.5) * rw * 0.2, y + rw * 0.05 + depth]);
  }
  const body = new Path2D();
  body.moveTo(x - rw, y);
  for (const [px, py] of rim) body.lineTo(px, py);
  body.lineTo(x + rw, y);
  body.closePath();
  ctx.fillStyle = css(tone.body);
  ctx.fill(body);

  ctx.save();
  ctx.clip(body);
  const side = ctx.createLinearGradient(x - rw, 0, x + rw, 0);
  side.addColorStop(0, css(tone.lit, 0.85));
  side.addColorStop(0.4, css(tone.lit, 0));
  side.addColorStop(0.6, css(tone.shade, 0));
  side.addColorStop(1, css(tone.shade, 0.85));
  ctx.fillStyle = side;
  ctx.fillRect(x - rw, y, rw * 2, under * 1.1 + rw * 0.1);
  // Facets: the rock broke away in planes; those whose edge falls to the right face the sun.
  const tipY = y + under;
  for (let k = 0; k + 1 < rim.length; k++) {
    const [px, py] = rim[k];
    const [qx, qy] = rim[k + 1];
    const facing = qy > py;
    ctx.fillStyle = facing ? css(tone.lit, 0.15 + rnd(i, 100 + k) * 0.3) : css(tone.shade, 0.2 + rnd(i, 100 + k) * 0.3);
    ctx.beginPath();
    ctx.moveTo(px, py + 1);
    ctx.lineTo(qx, qy + 1);
    ctx.lineTo(x + ((px + qx) / 2 - x) * (0.5 + rnd(i, 160 + k) * 0.3), y + rw * 0.12 + (Math.min(py, qy) - y) * rnd(i, 170 + k) * 0.5);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  for (let k = 1; k <= 4; k++) {
    const ry = y + rw * 0.12 + k * under * 0.17;
    ctx.setLineDash([rw * (0.2 + rnd(i, 110 + k) * 0.4), rw * (0.06 + rnd(i, 115 + k) * 0.15)]);
    ctx.lineDashOffset = rnd(i, 120 + k) * rw;
    ctx.lineWidth = Math.max(1, rw * 0.03);
    ctx.strokeStyle = css(tone.shade, 0.45);
    ctx.beginPath();
    ctx.moveTo(x - rw, ry + rw * 0.025);
    ctx.quadraticCurveTo(x + lean * 0.5, ry + under * 0.12 + rw * 0.025, x + rw, ry + rw * 0.025);
    ctx.stroke();
    ctx.lineWidth = Math.max(1, rw * 0.014);
    ctx.strokeStyle = css(tone.lit, 0.4);
    ctx.beginPath();
    ctx.moveTo(x - rw, ry);
    ctx.quadraticCurveTo(x + lean * 0.5, ry + under * 0.12, x + rw, ry);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  const dark = ctx.createLinearGradient(0, y + under * 0.3, 0, tipY);
  dark.addColorStop(0, css(tone.shade, 0));
  dark.addColorStop(1, css(tone.shade, 0.6));
  ctx.fillStyle = dark;
  ctx.fillRect(x - rw, y + under * 0.3, rw * 2, under);
  ctx.fillStyle = css(soil);
  ctx.beginPath();
  ctx.moveTo(x - rw, y);
  for (let k = 0; k <= 10; k++) ctx.lineTo(x - rw + (k / 10) * rw * 2, y + rw * (0.15 + rnd(i, 125 + k) * 0.1));
  ctx.lineTo(x + rw, y);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = css(mix(soil, tone.shade, 0.4));
  for (let k = 0; k < 6; k++) {
    const [rx, ry] = rim[1 + Math.floor(rnd(i, 80 + k) * (rim.length - 2))];
    const len = rw * (0.2 + rnd(i, 86 + k) ** 1.5 * 0.9);
    const sway = (rnd(i, 92 + k) - 0.5) * rw * 0.2;
    ctx.lineWidth = Math.max(1, rw * 0.02);
    ctx.beginPath();
    ctx.moveTo(rx, ry - rw * 0.05);
    ctx.bezierCurveTo(rx + sway, ry + len * 0.3, rx - sway, ry + len * 0.6, rx + sway * 0.5, ry + len);
    ctx.stroke();
  }
  ctx.lineWidth = Math.max(1, rw * 0.01);
  for (const end of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const rx = x + end * rw * (0.75 + rnd(i, 130 + k + end) * 0.22);
      ctx.beginPath();
      ctx.moveTo(rx, y + rw * 0.08);
      ctx.quadraticCurveTo(rx + end * rw * 0.04, y + rw * 0.2, rx + end * rw * 0.02, y + rw * (0.18 + rnd(i, 135 + k + end) * 0.25));
      ctx.stroke();
    }
  }

  // The turf cap, domed a little and lipping over the edge, its sunward crown lit.
  const capH = rw * 0.07;
  const top = (t: number) => y - capH * (1 - t * t) * 1.3 - capH * 0.5 * rnd(i, 140 + Math.round((t + 1) * 5));
  const cap = new Path2D();
  const lit = new Path2D();
  cap.moveTo(x - rw * 1.05, y + capH * 0.7);
  lit.moveTo(x - rw * 1.0, y);
  for (let k = 0; k <= 10; k++) {
    const t = k / 5 - 1;
    cap.lineTo(x + t * rw * 1.04, top(t));
    if (t < 0.4) lit.lineTo(x + t * rw * 1.0, top(t) + capH * 0.15);
  }
  cap.lineTo(x + rw * 1.05, y + capH * 0.8);
  for (let k = 10; k >= 0; k--) cap.lineTo(x + (k / 5 - 1) * rw, y + capH * (0.6 + rnd(i, 150 + k) * 1.1));
  cap.closePath();
  lit.lineTo(x + rw * 0.35, y - capH * 0.2);
  lit.closePath();
  ctx.save();
  ctx.translate(0, capH * 0.6);
  ctx.fillStyle = css(grass.shade);
  ctx.fill(cap);
  ctx.restore();
  ctx.fillStyle = css(grass.body);
  ctx.fill(cap);
  ctx.fillStyle = css(grass.lit, 0.4);
  ctx.fill(lit);

  if (falls) {
    const fx = x + rw * (0.2 + rnd(i, 86) * 0.5);
    const fg = ctx.createLinearGradient(0, y, 0, y + rw * 3);
    fg.addColorStop(0, css(falls, 0.75));
    fg.addColorStop(1, css(falls, 0));
    ctx.fillStyle = fg;
    ctx.fillRect(fx, y - 1, rw * 0.06, rw * 3);
  }
}

/**
 * A sea of cloud seen from above: rows of billows, each row further forward
 * set lower and larger, lit on their crowns and shading into their own mass,
 * their rims fading so they melt into the air.
 */
function cloudSea(ctx: CanvasRenderingContext2D, w: number, h: number, top: number, tone: CloudTone, r: number, rnd: Rnd, k: number): void {
  const deep = mix(tone.body, tone.shade, 0.55);
  for (let row = 0; row < 3; row++) {
    const y = top + row * r * 0.75;
    const rr = r * (1 + row * 0.3);
    const mass = new Path2D();
    const glows: [number, number, number][] = [];
    for (let x = 0, j = 0; x < w; j++) {
      const q = j * 3 + row * 997;
      const pr = rr * (0.6 + rnd(q, k) * 0.8);
      const py = y - pr * (0.1 + rnd(q, k + 1) * 0.4);
      for (const o of x < pr ? [0, w] : x > w - pr ? [0, -w] : [0]) {
        mass.moveTo(x + o + pr, py);
        mass.arc(x + o, py, pr, 0, TAU);
        if (rnd(q, k + 3) < 0.45) glows.push([x + o - pr * 0.3, py - pr * 0.45, pr * 0.8]);
      }
      x += pr * (1 + rnd(q, k + 2) * 0.7);
    }
    mass.rect(0, y, w, h - y);
    const g = ctx.createLinearGradient(0, y - rr * 1.2, 0, y + rr * 0.8);
    g.addColorStop(0, css(tone.lit));
    g.addColorStop(0.45, css(tone.body));
    g.addColorStop(1, css(deep));
    ctx.fillStyle = g;
    ctx.fill(mass);
    // Billow crowns turned to the sun, as soft glows rather than hard balls.
    for (const [gx, gy, gr] of glows) {
      const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      glow.addColorStop(0, css(tone.lit, 0.7));
      glow.addColorStop(1, css(tone.lit, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
  }
}

function paintFloaters(s: Scene): void {
  const { w, h, rnd, tones, haze, th } = s;
  const grass = { body: rgbOf(th.crust), lit: rgbOf(th.crustLight), shade: rgbOf(th.crustDark) };
  const hazed = (t: LayerTone, a: number): LayerTone => ({ body: mix(t.body, haze, a), lit: mix(t.lit, haze, a), shade: mix(t.shade, haze, a) });
  const soil = rgbOf(th.soil[1]);
  const falls = mix(rgbOf(th.water), WHITE, 0.6);
  const cloud = rgbOf(th.cloud ?? th.haze);
  const cloudShade = mix(rgbOf(th.cloudShade), rgbOf(th.skyTop), 0.3);
  const sea = (fade: number): CloudTone => ({ lit: mix(cloud, haze, fade), body: mix(mix(cloud, cloudShade, 0.35), haze, fade), shade: mix(cloudShade, haze, fade) });
  const turfOn = (cx: number, cy: number, rw: number) => (px: number) => {
    const d = ((((px - cx) % w) + w * 1.5) % w) - w / 2;
    return Math.abs(d) < rw * 0.85 ? cy - rw * 0.07 * (1 - (d / rw) ** 2) : null;
  };

  // Far: many small rocks low over the cloud; middle: a handful; near: two big ones. Size falls off with distance.
  for (let i = 0; i < 10; i++) {
    const cx = ((i + rnd(i, 90)) * w) / 10;
    const cy = h * (0.42 + rnd(i, 91) * 0.3);
    const rw = h * (0.008 + rnd(i, 92) ** 2 * 0.028);
    wrapped(w, cx, (x) => floater(s.far, x, cy, rw, tones[0], hazed(grass, HAZE[0]), mix(soil, haze, HAZE[0]), rnd, i, null));
  }
  cloudSea(s.far, w, h, h * 0.78, sea(0.45), h * 0.03, rnd, 1);

  for (let i = 0; i < 5; i++) {
    const cx = ((i + 0.2 + rnd(i, 93) * 0.6) * w) / 5;
    const cy = h * (0.42 + rnd(i, 94) * 0.25);
    const rw = h * (i === 2 ? 0.022 : 0.035 + rnd(i, 95) * 0.045);
    wrapped(w, cx, (x) => floater(s.mid, x, cy, rw, tones[1], hazed(grass, HAZE[1]), mix(soil, haze, HAZE[1]), rnd, 20 + i, i % 2 ? mix(falls, haze, 0.3) : null));
    if (rw > h * 0.04) bushes(s.mid, w, turfOn(cx, cy, rw), cx - rw, cx + rw, rw * 0.12, greened(tones[1], mix(grass.body, haze, HAZE[1]), 0.6), rnd, 700 + i * 10);
  }
  cloudSea(s.mid, w, h, h * 0.86, sea(0.25), h * 0.042, rnd, 2);

  for (let i = 0; i < 2; i++) {
    const cx = ((i + 0.3 + rnd(i, 96) * 0.4) * w) / 2;
    const cy = h * (0.58 + rnd(i, 97) * 0.12);
    const rw = h * (0.1 + rnd(i, 98) * 0.07);
    const leaf = greened(tones[2], mix(grass.body, haze, HAZE[2]), 0.6);
    wrapped(w, cx, (x) => {
      floater(s.near, x, cy, rw, tones[2], hazed(grass, HAZE[2]), mix(soil, haze, HAZE[2]), rnd, 40 + i, null);
      for (let k = 0; k < 1 + i; k++) tree(s.near, x + (rnd(k, 99 + i) - 0.5) * rw * 1.2, cy - rw * 0.06, rw * (0.16 + rnd(k, 100 + i) * 0.1), leaf, rnd, 90 + k);
    });
    bushes(s.near, w, turfOn(cx, cy, rw), cx - rw, cx + rw, rw * 0.09, leaf, rnd, 800 + i * 10);
  }
  cloudSea(s.near, w, h, h * 0.94, sea(0.08), h * 0.055, rnd, 3);
}

function paintCliffs(s: Scene): void {
  const { w, h, rnd, tones, haze, seed, th } = s;
  const horizon = h * 0.72;
  sea(s, horizon);
  const headland = rnd(0, 110) * w;
  land(s.far, w, islandLine(w, horizon, [{ x: headland, half: w * 0.22, height: h * 0.06, peak: 0, rock: 0, sheer: true }, { x: headland + w * 0.55, half: w * 0.1, height: h * 0.025, peak: 0, rock: 0 }], seed), horizon, tones[0], 0.35);
  const foam = mix(haze, WHITE, 0.65);
  const grass = mix(rgbOf(th.crust), haze, HAZE[1]);
  const grassLit = mix(rgbOf(th.crustLight), haze, HAZE[1]);
  const grassDark = mix(rgbOf(th.crustDark), haze, HAZE[1]);

  // Chalk standing sheer out of the sea, stepping down once toward its eastern end.
  const mc = s.mid;
  const mt = tones[1];
  const water = h * 0.86;
  const cliffTop = h * 0.6;
  const cx = rnd(0, 111) * w;
  const reach = w * 0.3;
  const ml = sampleLine(w, (x) => {
    const u = ((((x - cx) % w) + w * 1.5) % w) - w / 2;
    const d = Math.abs(u) / reach;
    if (d >= 1) return water;
    const rise = Math.min(1, (1 - d) * 12);
    const step = u > 0 ? 1 - 0.35 * Math.min(1, Math.max(0, (d - 0.5) * 14)) : 1;
    const top = water - (water - cliffTop) * step * (0.88 + 0.12 * fbm(x, w, 9, 2, seed + 2)) - h * 0.008 * fbm(x, w, 60, 2, seed + 3);
    return water + (top - water) * rise;
  });
  land(mc, w, ml, water, mt, 0.7);

  // The face: buttresses lit on their left and shaded on their right, soft chalk beds, flint ledges and fissures.
  const face = cliffTop - h * 0.03;
  const lit = new Path2D();
  const shade = new Path2D();
  for (let bx = cx - reach, j = 0; bx < cx + reach; j++) {
    const bw = h * (0.025 + rnd(j, 120) * 0.06);
    const jag = (k: number) => (rnd(j * 6 + k, 121) - 0.5) * bw * 0.25;
    lit.moveTo(bx, face);
    lit.lineTo(bx + bw * 0.24, face);
    lit.lineTo(bx + bw * 0.2 + jag(0), face + (water - face) * 0.5);
    lit.lineTo(bx + bw * 0.12 + jag(1), water);
    lit.lineTo(bx - bw * 0.04, water);
    lit.closePath();
    shade.moveTo(bx + bw * 0.62, face);
    shade.lineTo(bx + bw, face);
    shade.lineTo(bx + bw * 0.96 + jag(2), face + (water - face) * 0.55);
    shade.lineTo(bx + bw * 0.9, water);
    shade.lineTo(bx + bw * 0.76 + jag(3), water);
    shade.lineTo(bx + bw * 0.7 + jag(4), face + (water - face) * 0.4);
    shade.closePath();
    bx += bw;
  }
  wrapped(w, 0, (o) => {
    mc.save();
    mc.translate(o, 0);
    mc.globalCompositeOperation = 'source-atop';
    mc.fillStyle = css(mt.lit, 0.4);
    mc.fill(lit);
    mc.fillStyle = css(mt.shade, 0.45);
    mc.fill(shade);
    for (let k = 0, y = face; y < water; k++) {
      const bed = h * (0.006 + rnd(k, 122) * 0.012);
      mc.fillStyle = css(k % 2 ? mt.shade : mt.lit, 0.08);
      mc.fillRect(cx - reach, y, reach * 2, bed);
      y += bed + h * (0.008 + rnd(k, 123) * 0.02);
    }
    const foot = mc.createLinearGradient(0, water - h * 0.07, 0, water);
    foot.addColorStop(0, css(mt.shade, 0));
    foot.addColorStop(1, css(mt.shade, 0.4));
    mc.fillStyle = foot;
    mc.fillRect(cx - reach, water - h * 0.07, reach * 2, h * 0.07);
    mc.restore();
    rockFace(mc, o + cx - reach, o + cx + reach, face, water, mt, h * 0.024, 0.65, rnd, 124);
  });
  mist(mc, w, h * 0.7, water, haze, 0.3);

  // Turf along the top, thick enough to overhang the edge, with tufts hanging over the face.
  const turf = new Path2D();
  const turfLit = new Path2D();
  const tufts = new Path2D();
  const { ys, step } = ml;
  const n = ys.length - 1;
  const gentle = (i: number) => ys[(i + n) % n] < water - h * 0.04 && Math.abs(ys[(i + 1) % n] - ys[(i + n) % n]) < step * 1.2;
  const lift = h * 0.003;
  for (let i = 0; i < n; i++) {
    if (!gentle(i)) continue;
    const x = i * step;
    const y0 = ys[i];
    const y1 = ys[i + 1];
    const thick = h * (0.006 + fbm(x, w, 40, 2, seed + 9) * 0.009);
    turf.moveTo(x - 0.5, y0 - lift);
    turf.lineTo(x + step + 0.5, y1 - lift);
    turf.lineTo(x + step + 0.5, y1 + thick);
    turf.lineTo(x - 0.5, y0 + thick);
    turf.closePath();
    turfLit.moveTo(x - 0.5, y0 - lift);
    turfLit.lineTo(x + step + 0.5, y1 - lift);
    turfLit.lineTo(x + step + 0.5, y1 + thick * 0.3);
    turfLit.lineTo(x - 0.5, y0 + thick * 0.3);
    turfLit.closePath();
    if (rnd(i, 130) < 0.16) {
      const len = h * (0.004 + rnd(i, 131) ** 2 * 0.03);
      tufts.moveTo(x - step * 1.2, y0 + thick * 0.7);
      tufts.lineTo(x + (rnd(i, 132) - 0.5) * step * 2, y0 + thick + len);
      tufts.lineTo(x + step * 1.6, y0 + thick * 0.7);
      tufts.closePath();
    }
    // Where the top meets a sheer end, the turf lip pushes out over the drop.
    if (!gentle(i + 1)) {
      turf.moveTo(x + step * 4.5, y1 + thick * 0.4);
      turf.ellipse(x + step * 2, y1 + thick * 0.4, step * 2.5, thick * 0.8, 0, 0, TAU);
    }
    if (!gentle(i - 1)) {
      turf.moveTo(x + step * 1, y0 + thick * 0.4);
      turf.ellipse(x - step * 1.5, y0 + thick * 0.4, step * 2.5, thick * 0.8, 0, 0, TAU);
    }
  }
  mc.save();
  mc.translate(0, h * 0.006);
  mc.globalCompositeOperation = 'source-atop';
  mc.fillStyle = css(mt.shade, 0.45);
  mc.fill(turf);
  mc.restore();
  mc.fillStyle = css(grassDark);
  mc.fill(tufts);
  mc.fillStyle = css(grass);
  mc.fill(turf);
  mc.fillStyle = css(grassLit, 0.7);
  mc.fill(turfLit);

  // A lighthouse with its keeper's cottage on the high, sunlit end of the cliff.
  const lx = cx - reach * 0.45;
  const lt = yAt(ml, w, lx) + h * 0.004;
  const lw = h * 0.013;
  const lh = h * 0.1;
  const white = mix(WHITE, haze, 0.3);
  const band = mix(rgbOf(th.accent), haze, 0.2);
  wrapped(w, lx, (x) => {
    const cw = lw * 2.8;
    const ch = lh * 0.17;
    mc.fillStyle = css(white);
    mc.fillRect(x + lw * 0.5, lt - ch, cw, ch);
    mc.fillStyle = css(mt.shade, 0.5);
    mc.fillRect(x + lw * 0.5 + cw * 0.7, lt - ch, cw * 0.3, ch);
    mc.fillStyle = css(mix(mt.shade, band, 0.4));
    mc.beginPath();
    mc.moveTo(x + lw * 0.3, lt - ch);
    mc.lineTo(x + lw * 0.5 + cw * 0.5, lt - ch * 1.8);
    mc.lineTo(x + lw * 0.7 + cw, lt - ch);
    mc.fill();
    mc.fillStyle = css(mix(band, WHITE, 0.2), 0.6);
    mc.beginPath();
    mc.moveTo(x + lw * 0.3, lt - ch);
    mc.lineTo(x + lw * 0.5 + cw * 0.5, lt - ch * 1.8);
    mc.lineTo(x + lw * 0.5 + cw * 0.5, lt - ch);
    mc.fill();

    const tower = new Path2D();
    tower.moveTo(x - lw, lt + 2);
    tower.lineTo(x - lw * 0.68, lt - lh);
    tower.lineTo(x + lw * 0.68, lt - lh);
    tower.lineTo(x + lw, lt + 2);
    tower.closePath();
    mc.fillStyle = css(white);
    mc.fill(tower);
    mc.fillStyle = css(band);
    for (const at of [0.3, 0.68]) mc.fillRect(x - lw, lt - lh * at, lw * 2, lh * 0.13);
    const round = mc.createLinearGradient(x - lw, 0, x + lw, 0);
    round.addColorStop(0, css(mix(mt.lit, WHITE, 0.4), 0.5));
    round.addColorStop(0.3, css(WHITE, 0));
    round.addColorStop(0.55, css(mt.shade, 0.1));
    round.addColorStop(1, css(mt.shade, 0.6));
    mc.save();
    mc.clip(tower);
    mc.fillStyle = round;
    mc.fillRect(x - lw, lt - lh, lw * 2, lh + 2);
    mc.restore();

    const gallery = lt - lh;
    const glass = h * 0.017;
    mc.fillStyle = css(mt.shade);
    mc.fillRect(x - lw * 0.95, gallery - h * 0.004, lw * 1.9, h * 0.005);
    mc.fillStyle = css(mix(haze, WHITE, 0.7));
    mc.fillRect(x - lw * 0.5, gallery - h * 0.004 - glass, lw, glass);
    mc.fillStyle = css(mt.shade, 0.7);
    mc.fillRect(x - lw * 0.08, gallery - h * 0.004 - glass, lw * 0.16, glass);
    mc.fillRect(x + lw * 0.3, gallery - h * 0.004 - glass, lw * 0.2, glass);
    const dome = gallery - h * 0.004 - glass;
    mc.fillStyle = css(mt.shade);
    mc.beginPath();
    mc.moveTo(x - lw * 0.65, dome);
    mc.quadraticCurveTo(x - lw * 0.5, dome - h * 0.016, x, dome - h * 0.019);
    mc.quadraticCurveTo(x + lw * 0.5, dome - h * 0.016, x + lw * 0.65, dome);
    mc.fill();
    mc.fillStyle = css(mt.lit, 0.6);
    mc.beginPath();
    mc.ellipse(x - lw * 0.25, dome - h * 0.008, lw * 0.18, h * 0.005, -0.5, 0, TAU);
    mc.fill();
  });

  // Surf at the foot: a pale wash on the water and broken foam where the swell hits.
  const spume = new Path2D();
  let from = Infinity;
  let to = -Infinity;
  for (let x = cx - reach, j = 0; x < cx + reach; j++) {
    const rx = h * (0.006 + rnd(j, 125) * 0.018);
    if (yAt(ml, w, x) < water - h * 0.01) {
      from = Math.min(from, x);
      to = Math.max(to, x);
      const ry = h * (0.0012 + rnd(j, 126) ** 2 * 0.006);
      const y = water - ry * 0.3 + rnd(j, 127) * h * 0.005;
      spume.moveTo(x + rx * 2, y);
      spume.ellipse(x + rx, y, rx, ry, 0, 0, TAU);
    }
    x += rx * (0.7 + rnd(j, 128) * 1.1);
  }
  wrapped(w, 0, (o) => {
    mc.save();
    mc.translate(o, 0);
    pool(mc, from, to, water, h * 0.03, mt.shade, 0.35);
    pool(mc, from, to, water, h * 0.012, foam, 0.45);
    mc.fillStyle = css(foam, 0.85);
    mc.fill(spume);
    mc.restore();
  });

  // Sea stacks and one arch, each a different shape, wave-cut at the foot and capped with turf.
  const base = h * 0.92;
  const nc = s.near;
  const nt = tones[2];
  const ngrass = mix(rgbOf(th.crust), haze, HAZE[2]);
  const ngrassLit = mix(rgbOf(th.crustLight), haze, HAZE[2]);
  const ngrassDark = mix(rgbOf(th.crustDark), haze, HAZE[2]);
  const stacks = new Path2D();
  const caps = new Path2D();
  const capLit = new Path2D();
  const spray = new Path2D();
  for (let i = 0; i < 4; i++) {
    const sx = ((i + rnd(i, 112)) * w) / 4;
    const sw = h * (0.025 + rnd(i, 113) * 0.04);
    const sh = h * (0.06 + rnd(i, 114) * 0.1);
    const arch = i === 1;
    const right = arch ? 2.9 : 1;
    const j = (k: number) => (rnd(i * 12 + k, 115) - 0.5) * sw * 0.25;
    wrapped(w, sx, (x) => {
      const top = base - sh;
      stacks.moveTo(x - sw * 1.2, base);
      stacks.lineTo(x - sw * 0.95, base - sh * 0.07);
      stacks.lineTo(x - sw * 1.05 + j(0), base - sh * 0.22);
      stacks.lineTo(x - sw * 0.95 + j(1), base - sh * 0.5);
      stacks.lineTo(x - sw * 0.82 + j(2), base - sh * 0.8);
      stacks.lineTo(x - sw * 0.62, top);
      stacks.lineTo(x - sw * 0.1 + j(3), top - sh * 0.02);
      stacks.lineTo(x + sw * (right - 0.55), top + sh * 0.04);
      stacks.lineTo(x + sw * (right - 0.15) + j(4), base - sh * 0.7);
      stacks.lineTo(x + sw * right + j(5), base - sh * 0.35);
      stacks.lineTo(x + sw * (right - 0.1), base - sh * 0.08);
      stacks.lineTo(x + sw * (right + 0.15), base);
      if (arch) {
        stacks.lineTo(x + sw * 2.1, base);
        stacks.quadraticCurveTo(x + sw * 1.95, base - sh * 0.62, x + sw * 1.3, base - sh * 0.64);
        stacks.quadraticCurveTo(x + sw * 0.55, base - sh * 0.6, x + sw * 0.35, base);
      }
      stacks.closePath();
      const thick = h * 0.008;
      caps.moveTo(x - sw * 0.72, top + thick);
      caps.quadraticCurveTo(x - sw * 0.75, top - thick * 0.6, x - sw * 0.5, top - thick * 0.5);
      caps.lineTo(x + sw * (right - 0.6), top + sh * 0.04 - thick * 0.5);
      caps.quadraticCurveTo(x + sw * (right - 0.42), top + sh * 0.04, x + sw * (right - 0.45), top + sh * 0.04 + thick * 1.2);
      caps.lineTo(x - sw * 0.1, top + thick * 1.3);
      caps.closePath();
      capLit.moveTo(x - sw * 0.7, top + thick * 0.2);
      capLit.quadraticCurveTo(x - sw * 0.72, top - thick * 0.5, x - sw * 0.5, top - thick * 0.45);
      capLit.lineTo(x + sw * (right - 0.8), top + sh * 0.035 - thick * 0.45);
      capLit.lineTo(x + sw * (right - 0.85), top + sh * 0.035);
      capLit.closePath();
      for (let k = 0; k < 6; k++) {
        const px = x - sw * 1.4 + (rnd(i * 6 + k, 116) * (right + 1.6)) * sw;
        const rx = sw * (0.15 + rnd(i * 6 + k, 117) * 0.35);
        spray.moveTo(px + rx, base);
        spray.ellipse(px, base, rx, h * (0.002 + rnd(i * 6 + k, 118) * 0.003), 0, 0, TAU);
      }
    });
  }
  const sg = nc.createLinearGradient(0, base - h * 0.16, 0, base);
  sg.addColorStop(0, css(nt.body));
  sg.addColorStop(1, css(mix(nt.body, nt.shade, 0.5)));
  nc.fillStyle = sg;
  nc.fill(stacks);
  for (let i = 0; i < 4; i++) {
    const sx = ((i + rnd(i, 112)) * w) / 4;
    const sw = h * (0.025 + rnd(i, 113) * 0.04);
    const sh = h * (0.06 + rnd(i, 114) * 0.1);
    const right = i === 1 ? 2.9 : 1;
    wrapped(w, sx, (x) => {
      // Lit west face and shaded east face, laid over the stack's own shape only.
      nc.save();
      nc.globalCompositeOperation = 'source-atop';
      const g = nc.createLinearGradient(x - sw * 1.1, 0, x + sw * (right + 0.1), 0);
      g.addColorStop(0, css(nt.lit, 0.75));
      g.addColorStop(0.35, css(nt.lit, 0));
      g.addColorStop(0.6, css(nt.shade, 0));
      g.addColorStop(1, css(nt.shade, 0.8));
      nc.fillStyle = g;
      nc.fillRect(x - sw * 1.3, base - sh * 1.1, sw * (right + 1.6), sh * 1.1);
      nc.restore();
      rockFace(nc, x - sw * 1.2, x + sw * (right + 0.2), base - sh, base, nt, h * 0.015, 0.75, rnd, 140 + i * 10);
      pool(nc, x - sw * 1.2, x + sw * (right + 0.15), base, h * 0.03, nt.shade, 0.4);
      pool(nc, x - sw * 1.2, x + sw * (right + 0.15), base, h * 0.008, foam, 0.5);
    });
  }
  nc.save();
  nc.translate(0, h * 0.005);
  nc.globalCompositeOperation = 'source-atop';
  nc.fillStyle = css(nt.shade, 0.5);
  nc.fill(caps);
  nc.restore();
  nc.fillStyle = css(ngrassDark);
  nc.fill(caps);
  nc.save();
  nc.translate(0, -h * 0.002);
  nc.fillStyle = css(ngrass);
  nc.fill(caps);
  nc.restore();
  nc.fillStyle = css(ngrassLit, 0.7);
  nc.fill(capLit);

  nc.fillStyle = css(foam, 0.8);
  nc.fill(spray);
}

/**
 * A wind-cut stone pinnacle in stacked blocks, each narrower than the one
 * below so it leaves a ledge, leaning further the higher it goes. Each block
 * is lit down its left and shaded down its right, with a bright lip on every
 * ledge; `leaf` grows clumps on the ledges and the crown, and `falls` sends
 * a thread of water off one ledge.
 */
function pinnacle(ctx: CanvasRenderingContext2D, x: number, y: number, pw: number, ph: number, lean: number, tone: LayerTone, leaf: LayerTone | null, falls: RGB | null, rnd: Rnd, i: number): void {
  const n = 3 + Math.floor(rnd(i, 1) * 3);
  const parts = Array.from({ length: n }, (_, j) => 0.6 + rnd(i * 8 + j, 2) * (j === n - 1 ? 0.5 : 1));
  const total = parts.reduce((a, b) => a + b, 0);
  const body = new Path2D();
  const lit = new Path2D();
  const dark = new Path2D();
  const lips = new Path2D();
  const cracks = new Path2D();
  const ls = new Path2D();
  const lb = new Path2D();
  const ll = new Path2D();
  const poly = (p: Path2D, pts: readonly number[]) => {
    p.moveTo(pts[0], pts[1]);
    for (let q = 2; q < pts.length; q += 2) p.lineTo(pts[q], pts[q + 1]);
    p.closePath();
  };
  let fb = 0;
  let wb = pw * 1.1;
  let water: number[] | null = null;
  for (let j = 0; j < n; j++) {
    const q = i * 8 + j;
    const ft = fb + parts[j] / total;
    const yb = y - ph * fb;
    const yt = y - ph * ft;
    const cb = x + lean * fb ** 1.5;
    const ct = x + lean * ft ** 1.5;
    const wt = wb * (0.78 + rnd(q, 3) * 0.14);
    const bulge = wb * 0.1 * (rnd(q, 4) - 0.3);
    const my = (yb + yt) / 2;
    const mxl = (cb + ct) / 2 - (wb + wt) / 2 - bulge;
    const mxr = (cb + ct) / 2 + (wb + wt) / 2 + bulge;
    const crown = j === n - 1 ? [ct - wt * 0.35, yt - pw * (0.4 + rnd(q, 5) * 0.5), ct + wt * 0.05, yt - pw * (0.7 + rnd(q, 6) * 0.6), ct + wt * 0.5, yt - pw * 0.25] : [];
    poly(body, [cb - wb, yb, mxl, my, ct - wt, yt, ...crown, ct + wt, yt, mxr, my, cb + wb, yb]);
    poly(lit, [cb - wb, yb, mxl, my, ct - wt, yt, ...crown.slice(0, 4), ct - wt * 0.3, yt + pw * 0.1, cb - wb * 0.4, yb]);
    poly(dark, [ct + wt * 0.25, yt, ct + wt, yt, mxr, my, cb + wb, yb, cb + wb * 0.2, yb]);
    // Bedding lines: rock that splits in layers.
    for (let c = 0; c < 2; c++) {
      if (rnd(q, 7 + c) < 0.4) continue;
      const f = 0.25 + rnd(q, 9 + c) * 0.5;
      const cy = yb + (yt - yb) * f;
      const half = wb + (wt - wb) * f;
      const cx = cb + (ct - cb) * f;
      poly(cracks, [cx - half, cy, cx + half * 0.9, cy - pw * 0.04, cx + half * 0.9, cy - pw * 0.04 + Math.max(1, pw * 0.04), cx - half, cy + Math.max(1, pw * 0.04)]);
    }
    if (j < n - 1) {
      poly(lips, [ct - wt, yt, ct + wt * 0.4, yt, ct + wt * 0.4, yt + pw * 0.08, ct - wt, yt + pw * 0.1]);
      if (leaf) {
        // A fringe hugging part of the ledge, not a row of balls along all of it.
        const from = ct - wt + rnd(q, 11) * wt * 0.6;
        const tufts = 3 + Math.floor(rnd(q, 10) * 4);
        for (let t = 0; t < tufts; t++) {
          const r = pw * (0.06 + rnd(q * 7 + t, 12) * 0.08);
          clump(ls, lb, ll, from + t * r * 1.3, yt - r * 0.2 + rnd(q * 7 + t, 13) * r * 0.5, r, 0.5);
        }
      }
      if (falls && !water && j >= 1) water = [ct - wt * 0.5, yt + pw * 0.06];
    } else if (leaf && rnd(q, 14) < 0.7) {
      for (let t = 0; t < 3; t++) clump(ls, lb, ll, ct + (t - 1) * wt * 0.45, yt - pw * 0.15 - (t === 1 ? pw * 0.2 : 0), pw * (0.12 + rnd(q * 5 + t, 15) * 0.08), t === 2 ? -0.2 : 0.6);
    }
    fb = ft;
    wb = Math.min(wt * 0.86, pw * (1 - ft * 0.5) * (0.9 + rnd(q, 16) * 0.2));
  }
  ctx.fillStyle = css(tone.body);
  ctx.fill(body);
  ctx.fillStyle = css(tone.lit, 0.6);
  ctx.fill(lit);
  ctx.fillStyle = css(tone.shade, 0.75);
  ctx.fill(dark);
  ctx.fillStyle = css(tone.shade, 0.55);
  ctx.fill(cracks);
  ctx.fillStyle = css(tone.lit, 0.85);
  ctx.fill(lips);
  if (falls && water) {
    const [wx, wy] = water;
    const fw = pw * 0.14;
    ctx.fillStyle = css(falls, 0.8);
    ctx.beginPath();
    ctx.moveTo(wx - fw, wy);
    ctx.lineTo(wx + fw, wy);
    ctx.lineTo(wx + fw * 2.2, y);
    ctx.lineTo(wx - fw * 2.2, y);
    ctx.fill();
    ctx.strokeStyle = css(mix(falls, WHITE, 0.6), 0.7);
    ctx.lineWidth = Math.max(1, fw * 0.35);
    ctx.beginPath();
    for (const o of [-0.5, 0.4]) {
      ctx.moveTo(wx + fw * o, wy);
      ctx.lineTo(wx + fw * o * 2.2, y);
    }
    ctx.stroke();
  }
  if (leaf) fillClumps(ctx, leaf, ls, lb, ll);
}

/**
 * A castle: a crenellated curtain wall, a square keep and round towers with
 * pointed roofs, each tower its own height and width. Lit on the left, shaded
 * on the right, with dark slits for windows.
 */
function castle(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, tone: LayerTone, rnd: Rnd, k: number): void {
  const body = new Path2D();
  const lit = new Path2D();
  const dark = new Path2D();
  const roofLit = new Path2D();
  const roofDark = new Path2D();
  const slits = new Path2D();
  const half = s * 0.6;
  const battlements = (p: Path2D, x0: number, x1: number, top: number) => {
    const m = s * 0.03;
    for (let mx = x0; mx < x1 - m * 0.5; mx += m * 2) p.rect(mx, top - m * 1.1, m, m * 1.1);
  };
  const wallTop = y - s * 0.3;
  body.rect(x - half, wallTop, half * 2, y - wallTop);
  battlements(body, x - half, x + half, wallTop);
  dark.rect(x - half, wallTop, half * 2, s * 0.025);
  slits.moveTo(x - s * 0.06, y);
  slits.lineTo(x - s * 0.06, y - s * 0.1);
  slits.arc(x, y - s * 0.1, s * 0.06, Math.PI, 0);
  slits.lineTo(x + s * 0.06, y);
  slits.closePath();

  const kx = x + (rnd(0, k) - 0.5) * half * 0.5;
  const kw = s * 0.16;
  const kTop = y - s * 0.68;
  body.rect(kx - kw, kTop, kw * 2, y - kTop);
  battlements(body, kx - kw, kx + kw, kTop);
  lit.rect(kx - kw, kTop, kw * 0.5, y - kTop);
  dark.rect(kx + kw * 0.4, kTop, kw * 0.6, y - kTop);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) slits.rect(kx + (c ? 0.2 : -0.45) * kw, kTop + s * (0.1 + r * 0.16), kw * 0.22, s * 0.06);

  const tallest = Math.floor(rnd(1, k) * 4);
  [-1, -0.42, 0.45, 1].forEach((u, j) => {
    const tx = x + u * half + (rnd(j, k + 1) - 0.5) * s * 0.06;
    const tw = s * (0.06 + rnd(j, k + 2) * 0.035);
    const top = y - s * (j === tallest ? 0.95 + rnd(j, k + 3) * 0.15 : 0.45 + rnd(j, k + 3) * 0.35);
    body.rect(tx - tw, top, tw * 2, y - top);
    lit.rect(tx - tw, top, tw * 0.55, y - top);
    dark.rect(tx + tw * 0.3, top, tw * 0.7, y - top);
    slits.rect(tx - tw * 0.15, top + s * 0.12, tw * 0.3, s * 0.07);
    const peak = top - tw * (2.4 + rnd(j, k + 4) * 1.4);
    roofLit.moveTo(tx - tw * 1.3, top);
    roofLit.lineTo(tx, peak);
    roofLit.lineTo(tx - tw * 0.1, top);
    roofLit.closePath();
    roofDark.moveTo(tx - tw * 0.1, top);
    roofDark.lineTo(tx, peak);
    roofDark.lineTo(tx + tw * 1.3, top);
    roofDark.closePath();
  });
  ctx.fillStyle = css(tone.body);
  ctx.fill(body);
  ctx.fillStyle = css(tone.lit, 0.65);
  ctx.fill(lit);
  ctx.fillStyle = css(tone.shade, 0.8);
  ctx.fill(dark);
  ctx.fillStyle = css(mix(tone.shade, tone.lit, 0.55));
  ctx.fill(roofLit);
  ctx.fillStyle = css(tone.shade);
  ctx.fill(roofDark);
  ctx.fill(slits);
}

function paintSpires(s: Scene): void {
  const { w, h, rnd, tones, haze, seed, th } = s;
  // Distant needles stand behind the far range, paler for the haze.
  for (let i = 0; i < 6; i++) {
    if (rnd(i, 119) < 0.3) continue;
    const ph = h * (0.12 + rnd(i, 118) * 0.14);
    wrapped(w, ((i + rnd(i, 117)) * w) / 6, (x) => pinnacle(s.far, x, h * 0.66, h * (0.012 + rnd(i, 116) * 0.01), ph, h * 0.012, tones[0], null, null, rnd, 300 + i));
  }
  const fl = sampleLine(w, (x) => h * 0.66 - h * 0.12 * fbm(x, w, 4, 4, seed, true));
  land(s.far, w, fl, h, tones[0], 0.4);
  mist(s.far, w, h * 0.56, h * 0.74, haze, 0.65);

  // The castle holds a rise of its own in the middle distance.
  const cx = rnd(0, 133) * w;
  const ml = sampleLine(w, (x) => h * 0.79 - h * 0.05 * fbm(x, w, 4, 3, seed + 2) - h * 0.06 * Math.max(0, 1 - (apart(x, cx, w) / (h * 0.2)) ** 2));
  const t1 = tones[1];
  const grown = (t: LayerTone, a: number): LayerTone => ({
    body: mix(t.body, mix(rgbOf(th.crust), haze, 0.35), a),
    lit: mix(t.lit, mix(rgbOf(th.crustLight), haze, 0.35), a),
    shade: mix(t.shade, mix(rgbOf(th.crustDark), haze, 0.35), a * 0.7),
  });
  const falls = mix(mix(rgbOf(th.water), WHITE, 0.55), haze, 0.25);
  // Pinnacles lean the same way, as wind-cut stone does; the tallest carries the waterfall.
  const spires = Array.from({ length: 8 }, (_, i) => ({ i, x: ((i + rnd(i, 125)) * w) / 8, ph: h * (0.12 + rnd(i, 127) ** 1.3 * 0.2) })).filter(
    (p) => rnd(p.i, 124) > 0.25 && apart(p.x, cx, w) > h * 0.16,
  );
  const tallest = spires.reduce((a, b) => (b.ph > a.ph ? b : a), spires[0]);
  for (const p of spires) {
    const pw = h * (0.018 + rnd(p.i, 126) * 0.02);
    wrapped(w, p.x, (x) => pinnacle(s.mid, x, yAt(ml, w, x) + h * 0.02, pw, p.ph, h * (0.01 + rnd(p.i, 128) * 0.03), t1, grown(t1, 0.45), p === tallest ? falls : null, rnd, p.i));
  }
  wrapped(w, cx, (x) => castle(s.mid, x, yAt(ml, w, cx) + h * 0.012, h * 0.12, t1, rnd, 134));
  land(s.mid, w, ml, h, t1, 0.4, 0.25);
  copse(s.mid, w, ml, cx + h * 0.12, h * 0.1, 5, h * 0.014, grown(t1, 0.25), rnd, 60, 0.3);
  copse(s.mid, w, ml, cx - h * 0.14, h * 0.08, 4, h * 0.013, grown(t1, 0.25), rnd, 61, 0.3);
  mist(s.mid, w, h * 0.72, h * 0.88, haze, 0.45);

  // Groves in two ranks: the back one higher up the rise and a step into the haze.
  const nl = sampleLine(w, (x) => h * 0.88 - h * 0.05 * fbm(x, w, 3, 3, seed + 5));
  const nc = s.near;
  land(nc, w, nl, h, tones[2], 0.4, 0.25);
  const back: LayerTone = { body: mix(tones[2].body, t1.body, 0.45), lit: mix(tones[2].lit, t1.lit, 0.45), shade: mix(tones[2].shade, t1.shade, 0.45) };
  const higher = { ys: nl.ys.map((v) => v - h * 0.006), step: nl.step };
  for (let c = 0; c < 9; c++) {
    if (rnd(c, 129) < 0.15) continue;
    copse(nc, w, higher, ((c + rnd(c, 130)) * w) / 9, h * (0.04 + rnd(c, 131) * 0.1), 5 + Math.floor(rnd(c, 132) * 8), h * 0.022, back, rnd, 70 + c, 0.35);
  }
  for (let c = 0; c < 7; c++) {
    if (rnd(c, 135) < 0.2) continue;
    copse(nc, w, nl, ((c + rnd(c, 136)) * w) / 7, h * (0.02 + rnd(c, 137) * 0.08), 2 + Math.floor(rnd(c, 138) * 6), h * 0.034, tones[2], rnd, 80 + c, 0.3);
  }
  mist(nc, w, h * 0.86, h, haze, 0.3);
}

const PAINTERS: Record<Theme['horizon'], (s: Scene) => void> = {
  islands: paintIslands,
  hills: paintHills,
  mesas: paintMesas,
  peaks: paintPeaks,
  volcano: paintVolcano,
  cave: paintCave,
  city: paintCity,
  floaters: paintFloaters,
  cliffs: paintCliffs,
  spires: paintSpires,
};

/** Where the haze is brightest: the far skyline's foot. */
const HORIZON = 0.68;

export function themeSeed(theme: ThemeId): number {
  return hash3(theme.length, theme.charCodeAt(0), theme.charCodeAt(1));
}

/**
 * Parallax layers, far to near, each viewW × viewH and tiling sideways with
 * period viewW: [sky with clouds, far skyline, middle skyline, near skyline].
 * No outlines, soft colours and the haze over all of it, so the outlined
 * battlefield stays in front. The sky is the same all the way across apart
 * from its clouds, so sliding layer 0 sideways moves only the clouds.
 */
export function paintBackground(theme: ThemeId, viewW: number, viewH: number, seed = themeSeed(theme)): HTMLCanvasElement[] {
  const th = THEMES[theme];
  const w = viewW;
  const h = viewH;
  const rnd: Rnd = (i, k) => ((hash3(i, k, seed) >>> 4) & 1023) / 1023;
  const haze = rgbOf(th.haze);

  const [sky, sc] = makeCanvas(w, h);
  const top = rgbOf(th.skyTop);
  const bottom = rgbOf(th.skyBottom);
  const grad = sc.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, css(top));
  grad.addColorStop(0.42, css(mix(top, bottom, 0.5)));
  grad.addColorStop(HORIZON - 0.12, css(bottom));
  grad.addColorStop(HORIZON, css(haze));
  grad.addColorStop(1, css(mix(haze, bottom, 0.5)));
  sc.fillStyle = grad;
  sc.fillRect(0, 0, w, h);

  // Every painter sizes its shapes from the height. On a phone held upright that turns hills into needles and
  // makes a cloud wider than the view, so the scenery is painted for a landscape view and set with its horizon on
  // this one's; its top and bottom rows are drawn out to fill the rest.
  const tall = Math.min(h, Math.round(w * 0.75));
  const lift = Math.round(HORIZON * (h - tall));
  if (tall === h) {
    paintClouds(sc, th, w, h, h * HORIZON, rnd);
    const [far, fc] = makeCanvas(w, h);
    const [mid, mc] = makeCanvas(w, h);
    const [near, nc] = makeCanvas(w, h);
    PAINTERS[th.horizon]({ w, h, th, seed, rnd, tones: layerTones(theme), haze, far: fc, mid: mc, near: nc });
    return roofed(th, sc, [sky, far, mid, near]);
  }
  const [clouds, cc] = makeCanvas(w, tall);
  paintClouds(cc, th, w, tall, tall * HORIZON, rnd);
  sc.drawImage(clouds, 0, lift);
  const scenery = [makeCanvas(w, tall), makeCanvas(w, tall), makeCanvas(w, tall)];
  const [[, fc], [, mc], [, nc]] = scenery;
  PAINTERS[th.horizon]({ w, h: tall, th, seed, rnd, tones: layerTones(theme), haze, far: fc, mid: mc, near: nc });
  // A drawn-out row keeps every speck of texture in it as a streak to the edge of the screen, so it is
  // shrunk across first and spread back, which leaves only its broad colour.
  // Halved five times rather than shrunk once: one big shrink only samples a few pixels, a halving averages each pair.
  const strips = [1, 2, 4, 8, 16, 32].map((d) => makeCanvas(Math.max(1, Math.round(w / d)), 1));
  const spread = (oc: CanvasRenderingContext2D, src: HTMLCanvasElement, row: number, y: number, height: number) => {
    strips[0][1].clearRect(0, 0, w, 1);
    strips[0][1].drawImage(src, 0, row, w, 1, 0, 0, w, 1);
    for (let i = 1; i < strips.length; i++) {
      const [to, tc] = strips[i];
      tc.clearRect(0, 0, to.width, 1);
      tc.drawImage(strips[i - 1][0], 0, 0, to.width, 1);
    }
    const [last] = strips[strips.length - 1];
    oc.drawImage(last, 0, 0, last.width, 1, 0, y, w, height);
  };
  const layers = scenery.map(([src]) => {
    const [out, oc] = makeCanvas(w, h);
    spread(oc, src, 0, 0, lift + 1);
    oc.drawImage(src, 0, lift);
    spread(oc, src, tall - 1, lift + tall - 1, h - lift - tall + 1);
    return out;
  });
  return roofed(th, sc, [sky, ...layers]);
}

/**
 * The screen lowers the far, middle and near layers as the camera rises, which uncovers the sky above them. Under
 * a cave roof there is no sky, so the far layer's top row, flat roof rock, is drawn down the sky layer and what
 * shows above the far layer is more of the same roof.
 */
function roofed(th: Theme, sky: CanvasRenderingContext2D, layers: HTMLCanvasElement[]): HTMLCanvasElement[] {
  const [back, far] = layers;
  if (th.horizon === 'cave') sky.drawImage(far, 0, 0, far.width, 1, 0, 0, back.width, back.height);
  return layers;
}

/** View widths per ms the sky layer drifts by, for the screen to add to its tile offset; 0 under a cave roof. */
export function skyDrift(theme: ThemeId): number {
  return THEMES[theme].cloud ? 0.0000025 : 0;
}

// Water

/** The part of a Phaser Graphics drawWaterInto uses, so it can be drawn without an engine. */
export interface WaterPen {
  clear(): unknown;
  fillStyle(colour: number, alpha?: number): unknown;
  fillGradientStyle(topLeft: number, topRight: number, bottomLeft: number, bottomRight: number, alpha?: number): unknown;
  lineStyle(width: number, colour: number, alpha?: number): unknown;
  beginPath(): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  closePath(): unknown;
  fillPath(): unknown;
  strokePath(): unknown;
  fillRect(x: number, y: number, w: number, h: number): unknown;
  fillEllipse(x: number, y: number, width: number, height: number, smoothness?: number): unknown;
}

export interface WaterView {
  /** The water line in world px. */
  level: number;
  /** World x range to cover. */
  x0: number;
  x1: number;
  /** World y the water reaches down to. */
  bottom: number;
  now: number;
  /** The slow-machine picture: a coarser line, no crest and one flat body. */
  lean: boolean;
}

/**
 * World px under the crest where the water is still a little see-through, so the land
 * just under the line shows faintly, as a reflection would. Below it the water is
 * opaque: the land's lower edge and the holes in it are hidden, as in deep water.
 */
const SURFACE = 4;
/** World px over which it deepens from the surface colour to its darkest. */
const DEEPEN = 70;
/** World px between the slow light patches in the deep. */
const PATCH = 230;

export interface WaterLook {
  back: number;
  surface: number;
  crest: number;
  deep: number;
  /** The light patches drifting in the deep. */
  patch: number;
}

/** Push a colour away from its own grey, by `t` (0 none, 1 twice as far). */
const saturate = (c: RGB, t: number): RGB => {
  const grey = (c[0] + c[1] + c[2]) / 3;
  const away = (v: number) => Math.max(0, Math.min(255, grey + (v - grey) * (1 + t)));
  return [away(c[0]), away(c[1]), away(c[2])];
};

/** Colours for the water: the surface catches the sky, and it darkens to a deep, saturated body. */
export function waterLook(theme: ThemeId): WaterLook {
  const th = THEMES[theme];
  const water = rgbOf(th.water);
  const deep = saturate(rgbOf(th.waterDeep), 0.3);
  return {
    back: toInt(deep),
    surface: toInt(mix(water, rgbOf(th.haze), 0.12)),
    crest: toInt(mix(water, mix(rgbOf(th.haze), WHITE, 0.6), 0.8)),
    deep: toInt(deep),
    patch: toInt(saturate(mix(deep, water, 0.45), 0.2)),
  };
}

function waveY(x: number, v: WaterView, offset: number, amp: number, speed: number): number {
  return v.level + offset + Math.sin(x / 38 + v.now * speed) * amp + Math.sin(x / 13 - v.now * speed * 1.7) * amp * 0.35;
}

/**
 * The water, each frame: a deep swell behind the land, and in front a body that is lit
 * at the top, deepens smoothly (a vertex-coloured gradient, which WebGL draws for the
 * cost of one rect) and is opaque a few px down, with slow soft light patches in the
 * deep and a thin bright line where the surface meets the air.
 */
export function drawWaterInto(back: WaterPen, front: WaterPen, look: WaterLook, v: WaterView): void {
  const step = v.lean ? 12 : 6;
  const start = Math.floor(v.x0 / step) * step;
  const end = v.x1 + step;

  back.clear();
  back.fillStyle(look.back, 1);
  back.beginPath();
  back.moveTo(start, v.bottom);
  for (let x = start; x <= end; x += step) back.lineTo(x, waveY(x, v, -5, 2.4, 0.0011));
  back.lineTo(end, v.bottom);
  back.closePath();
  back.fillPath();

  front.clear();
  const band = v.level + SURFACE;
  front.fillStyle(look.surface, 0.85);
  front.beginPath();
  front.moveTo(start, band);
  for (let x = start; x <= end; x += step) front.lineTo(x, waveY(x, v, 0, 2.8, 0.0014));
  front.lineTo(end, band);
  front.closePath();
  front.fillPath();
  front.fillGradientStyle(look.surface, look.surface, look.deep, look.deep, 1);
  front.fillRect(start, band, end - start, DEEPEN);
  front.fillStyle(look.deep, 1);
  front.fillRect(start, band + DEEPEN, end - start, v.bottom - band - DEEPEN);
  if (v.lean) return;

  // Each patch is five nested ellipses, faint each, so its edge is soft. They sit
  // on a world grid so they stay put as the camera pans, and drift slowly.
  const drift = v.now * 0.004;
  for (let n = Math.floor((v.x0 - drift) / PATCH) - 1; n * PATCH + drift <= v.x1 + PATCH; n++) {
    const h = hash3(n, 0, 991);
    const cx = n * PATCH + drift + ((h & 255) / 255) * PATCH * 0.5;
    const cy = band + DEEPEN * (0.7 + ((h >>> 8) & 255) / 255) + Math.sin(v.now * 0.0004 + n) * 6;
    const rx = 70 + ((h >>> 16) & 63);
    const ry = 16 + ((h >>> 22) & 15);
    for (let ring = 0; ring < 5; ring++) {
      const t = 1 - ring * 0.19;
      front.fillStyle(look.patch, 0.07);
      front.fillEllipse(cx, cy, rx * 2 * t, ry * 2 * t, 24);
    }
  }

  front.lineStyle(0.8, look.crest, 0.95);
  front.beginPath();
  for (let x = start; x <= end; x += step) {
    const y = waveY(x, v, 0, 2.8, 0.0014);
    if (x === start) front.moveTo(x, y);
    else front.lineTo(x, y);
  }
  front.strokePath();
}
