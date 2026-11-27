// Explosions, impacts, muzzle flashes, trails and splashes for the battlefield.
// Everything here is picture: it reads the rules' state and events and never
// writes to them, so it may use Math.random freely.
//
// Particles are plain images from a fixed pool per layer, moved here each frame
// rather than by Phaser's emitters: each effect needs its own colour ramp, size
// curve, wind drift and landing on the ground, and a pool with a hard cap keeps
// several big blasts at once inside the frame budget.

import type * as Phaser from 'phaser';
import { KEY, ONE, SLUG_HALF_H, cosDeg, px, sinDeg, solidAt } from '../../slugsGameLogic';
import type { BoomSource, ObjKind, ProjKind, Slug, SlugEvent, SlugsState, WeaponId } from '../../slugsGameLogic';
import { heldMuzzle, SLUG_COLOURS } from './slugArt';
import { THEMES } from './slugThemes';
import type { ThemeId } from './slugThemes';

/**
 * What set a blast off: the rules' own `src` on the boom, or, for a boom without one, the screen's
 * guess from what vanished on the frame it happened ('shot' being any gun's hit).
 */
export type BlastSource = BoomSource | 'shot';

/**
 * fire: the standard fireball. big: dynamite, the jar, the snail. bomblet: cluster and mortar bits.
 * barrel: a burning drum. stone: the millstone's crushing dust. bullet and pellet: gun hits. pop: a slug's own end.
 */
export type BlastStyle = 'fire' | 'big' | 'bomblet' | 'barrel' | 'stone' | 'bullet' | 'pellet' | 'pop';

export function blastStyle(r: number, source: BlastSource | null): BlastStyle {
  switch (source) {
    case 'barrel':
    case 'stone':
    case 'pop':
      return source;
    case 'shot':
      return r >= 10 ? 'pellet' : 'bullet';
    case 'shotgun':
      return 'pellet';
    case 'handgun':
    case 'machinegun':
    case 'minigun':
    case 'longshot':
      return 'bullet';
    case 'bit':
    case 'mortar':
      return 'bomblet';
    case 'dynamite':
    case 'jar':
    case 'snail':
      return 'big';
    default:
      break;
  }
  // The source was missed (several ticks ran in one frame): the rules' crater sizes tell most weapons apart.
  if (r >= 70) return 'big';
  if (r <= 8) return 'bullet';
  if (r <= 14) return 'pellet';
  if (r <= 24) return 'bomblet';
  return 'fire';
}

export interface BlastRecipe {
  /** World px across the first-frame flash; 0 for none. */
  flash: number;
  fire: number;
  fireLife: number;
  /** World px the shock ring reaches; 0 for none. */
  ring: number;
  ringMs: number;
  chunks: number;
  smoke: number;
  smokeLife: number;
  sparks: number;
  /** Rays of light thrown straight out from the centre in the first few frames. */
  streaks: number;
  /** Slow glowing bits that rise and drift on the wind after the fireball has gone. */
  embers: number;
  /** Ground-hugging dust puffs, for blasts that crush rather than burn. */
  dust: number;
  /** Droplets of slug, for a slug's pop. */
  goo: number;
  /** How long flames keep licking the crater floor after the blast, ms. */
  burnMs: number;
  shake: { ms: number; intensity: number } | null;
}

/**
 * How much of everything a blast throws, scaled by its crater so a bigger blast is bigger
 * on screen in proportion. `reduced` (prefers-reduced-motion) halves the particles and drops the shake;
 * `lean` (a machine that cannot keep up) halves the particles and keeps the shake.
 */
export function blastRecipe(style: BlastStyle, r: number, reduced: boolean, lean = false): BlastRecipe {
  const base: BlastRecipe = {
    flash: r * 1.3, fire: 5 + r / 12, fireLife: 520, ring: r * 1.5, ringMs: 240, chunks: 6 + r / 3,
    smoke: 4 + r / 6, smokeLife: 2200, sparks: 4 + r / 8, streaks: 6 + r / 8, embers: 3 + r / 12, dust: 0, goo: 0, burnMs: 900,
    shake: r >= 25 ? { ms: 100 + r * 2, intensity: (0.0028 * r) / 48 } : null,
  };
  const recipe: BlastRecipe = (() => {
    switch (style) {
      case 'big':
        return {
          ...base, flash: r * 1.4, fire: 6 + r / 10, fireLife: 900, ring: r * 1.7, ringMs: 380, chunks: 10 + r / 2.5,
          smoke: 8 + r / 5, smokeLife: 3800, sparks: 10 + r / 6, streaks: 10 + r / 8, embers: 6 + r / 10, dust: 6, burnMs: 1600,
          shake: { ms: 260 + r * 2, intensity: (0.0045 * r) / 73 },
        };
      case 'bomblet':
        return {
          ...base, flash: r * 1.2, fire: 3 + r / 8, fireLife: 360, ring: r * 1.4, ringMs: 180, chunks: 4 + r / 4, smoke: 2 + r / 8, smokeLife: 1400,
          sparks: 4, streaks: 5, embers: 2, burnMs: 0, shake: null,
        };
      case 'barrel':
        return { ...base, fire: 8 + r / 5, fireLife: 700, smoke: 6 + r / 5, smokeLife: 3200, sparks: 8 + r / 5, embers: 8 + r / 8, burnMs: 1800 };
      case 'stone':
        return {
          ...base, flash: 0, fire: 0, ring: r * 1.3, ringMs: 300, chunks: 10 + r / 2.5, smoke: 0, sparks: 0, streaks: 0, embers: 0, dust: 10 + r / 4, burnMs: 0,
          shake: { ms: 200, intensity: 0.004 },
        };
      case 'pellet':
        return {
          ...base, flash: r * 1.6, fire: 2, fireLife: 200, ring: 0, chunks: 6, smoke: 3, smokeLife: 900, sparks: 5, streaks: 3, embers: 0, burnMs: 0, shake: null,
        };
      case 'bullet':
        return { ...base, flash: 6, fire: 0, ring: 0, chunks: 3, smoke: 1, smokeLife: 700, sparks: 4, streaks: 0, embers: 0, burnMs: 0, shake: null };
      case 'pop':
        return {
          ...base, flash: r * 1.6, fire: 3, fireLife: 320, ring: r * 1.4, ringMs: 200, chunks: 6, smoke: 4, smokeLife: 1400, sparks: 0, streaks: 0, embers: 0,
          goo: 12, burnMs: 0, shake: null,
        };
      default:
        return base;
    }
  })();
  const n = (v: number) => (v <= 0 ? 0 : reduced || lean ? Math.max(1, Math.round(v / 2)) : Math.round(v));
  return {
    ...recipe,
    fire: n(recipe.fire), chunks: n(recipe.chunks), smoke: n(recipe.smoke), sparks: n(recipe.sparks), streaks: n(recipe.streaks), embers: n(recipe.embers),
    dust: n(recipe.dust), goo: n(recipe.goo),
    shake: reduced ? null : recipe.shake,
  };
}

// --- The atlas ---

type FrameName = 'blob' | 'puff' | 'burst' | 'ring' | 'chunk0' | 'chunk1' | 'chunk2' | 'chunk3' | 'spark' | 'drop' | 'line' | 'dot' | 'bubble';
const CHUNKS = ['chunk0', 'chunk1', 'chunk2', 'chunk3'] as const;

/** Frame boxes in the atlas at scale 1: x, y, w, h. A sharper atlas multiplies them all. */
const FRAMES: Record<FrameName, readonly [number, number, number, number]> = {
  blob: [0, 0, 64, 64],
  puff: [64, 0, 64, 64],
  ring: [128, 0, 64, 64],
  burst: [0, 64, 128, 128],
  chunk0: [128, 64, 16, 16],
  chunk1: [144, 64, 16, 16],
  chunk2: [160, 64, 16, 16],
  dot: [176, 64, 16, 16],
  bubble: [128, 80, 16, 16],
  chunk3: [176, 80, 16, 16],
  drop: [144, 80, 24, 12],
  spark: [128, 96, 32, 8],
  line: [128, 112, 64, 6],
};

/**
 * Most frames are white with grey outlines so a multiply tint gives a colour and
 * a darker outline of the same colour: one drawing serves fire, smoke, dirt and
 * water. The burst is painted in its own colours and never tinted. `scale` is
 * canvas px per atlas px, so the same drawing can be painted sharp for a close zoom.
 */
export function paintFxAtlas(canvas: HTMLCanvasElement, scale = 1): void {
  canvas.width = 192 * scale;
  canvas.height = 192 * scale;
  const c = canvas.getContext('2d')!;
  c.scale(scale, scale);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const at = (name: FrameName, draw: (w: number, h: number) => void) => {
    const [x, y, w, h] = FRAMES[name];
    c.save();
    c.translate(x, y);
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    draw(w, h);
    c.restore();
  };
  // A cloud of overlapping lobes. Every lobe is stroked first at twice the line and then all are
  // filled over it, so the outline is left only round the silhouette, not between the lobes.
  // The shade is radial: a lit core going darker to the rim, so a fireball reads as a ball.
  const LOBES = [[0.5, 0.52, 0.4], [0.28, 0.38, 0.22], [0.7, 0.34, 0.24], [0.3, 0.7, 0.22], [0.72, 0.68, 0.22]] as const;
  const cloud = (stops: readonly (readonly [number, string])[], outline: string, line: number) => (w: number) => {
    const lobes = () => {
      c.beginPath();
      for (const [lx, ly, lr] of LOBES) {
        c.moveTo(lx * w + lr * w, ly * w);
        c.arc(lx * w, ly * w, lr * w, 0, Math.PI * 2);
      }
    };
    lobes();
    c.strokeStyle = outline;
    c.lineWidth = line * 2;
    c.stroke();
    const g = c.createRadialGradient(w * 0.42, w * 0.4, 0, w * 0.5, w * 0.5, w * 0.5);
    for (const [t, col] of stops) g.addColorStop(t, col);
    lobes();
    c.fillStyle = g;
    c.fill('nonzero');
  };
  at('blob', cloud([[0, '#fff'], [0.4, '#f4f4f4'], [0.78, '#c8c8c8'], [1, '#a8a8a8']], '#6e6e6e', 2.5));
  at('puff', cloud([[0, '#fff'], [0.55, '#eeeeee'], [1, '#bdbdbd']], '#9a9a9a', 1.5));
  at('ring', (w) => {
    c.strokeStyle = '#fff';
    c.lineWidth = 5;
    c.beginPath();
    c.arc(w / 2, w / 2, w / 2 - 4, 0, Math.PI * 2);
    c.stroke();
  });
  // The first frame of a blast: a hard-edged scalloped disc, white at the heart going to gold.
  // Flat paint, no glow; the streaks thrown out with it are separate sparks.
  at('burst', (w) => {
    const R = w / 2 - 3;
    c.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      // Two rows of bumps out of step, so no two scallops are the same size.
      const rr = R * (0.8 + 0.12 * Math.abs(Math.sin(a * 4.5 + 0.4)) + 0.08 * Math.abs(Math.sin(a * 7 + 1.7)));
      c.lineTo(w / 2 + Math.cos(a) * rr, w / 2 + Math.sin(a) * rr);
    }
    c.closePath();
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, R);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.34, '#fff8d6');
    g.addColorStop(0.62, '#ffd24a');
    g.addColorStop(1, '#ffad33');
    c.fillStyle = g;
    c.fill();
    c.strokeStyle = '#d8702a';
    c.lineWidth = 3;
    c.stroke();
  });
  // Four different pieces of ground: a rock, a long shard, a rounded stone and a lumpy clod,
  // each with the face away from the light shaded.
  const chunks: [number, number][][] = [
    [[2, 6], [6, 2], [12, 3], [14, 8], [11, 13], [5, 14], [2, 10]],
    [[2, 12], [5, 5], [9, 2], [14, 4], [11, 9], [5, 14]],
    [[5, 3], [10, 2.5], [13.5, 6], [13.5, 10.5], [10, 13.5], [5.5, 13.5], [2.5, 10], [2.5, 6]],
    [[3, 5], [7, 3], [9, 4.5], [13, 3.5], [14, 9], [12, 13], [8, 11.5], [3.5, 13], [2, 9]],
  ];
  chunks.forEach((pts, i) => at(CHUNKS[i], () => {
    const shape = () => {
      c.beginPath();
      for (const [x, y] of pts) c.lineTo(x, y);
      c.closePath();
    };
    shape();
    c.fillStyle = '#fff';
    c.fill();
    c.save();
    shape();
    c.clip();
    c.fillStyle = '#bcbcbc';
    c.beginPath();
    c.moveTo(16, 3);
    c.lineTo(16, 16);
    c.lineTo(3, 16);
    c.lineTo(9.5, 8.5);
    c.closePath();
    c.fill();
    c.restore();
    shape();
    c.strokeStyle = '#4a4a4a';
    c.lineWidth = 1.4;
    c.stroke();
  }));
  at('dot', () => {
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(8, 8, 6.5, 0, Math.PI * 2);
    c.fill();
  });
  at('bubble', () => {
    c.strokeStyle = '#fff';
    c.lineWidth = 1.6;
    c.beginPath();
    c.arc(8, 8, 5.5, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#fff';
    c.beginPath();
    c.arc(6, 6, 1.4, 0, Math.PI * 2);
    c.fill();
  });
  at('drop', () => {
    // Pointing right: the round head leads, the tail trails.
    c.beginPath();
    c.moveTo(1, 6);
    c.quadraticCurveTo(10, 1.5, 17, 2);
    c.arc(17, 6, 4, -Math.PI / 2, Math.PI / 2);
    c.quadraticCurveTo(10, 10.5, 1, 6);
    c.closePath();
    c.fillStyle = '#fff';
    c.fill();
    c.strokeStyle = '#7a7a7a';
    c.lineWidth = 1.2;
    c.stroke();
  });
  at('spark', () => {
    const g = c.createLinearGradient(0, 0, 32, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.9)');
    g.addColorStop(1, '#fff');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 4);
    c.lineTo(26, 1);
    c.arc(28, 4, 3, -Math.PI / 2, Math.PI / 2);
    c.lineTo(26, 7);
    c.closePath();
    c.fill();
  });
  at('line', () => {
    const g = c.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, '#fff');
    g.addColorStop(1, '#fff');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, 3);
    c.lineTo(62, 0.8);
    c.arc(62, 3, 2.2, -Math.PI / 2, Math.PI / 2);
    c.closePath();
    c.fill();
  });
}

// --- Colours ---

/** Hot to cold: a fireball's life from white heat to the smoke it becomes. */
const FIRE = [0xfff6d8, 0xffdc5e, 0xffa438, 0xe0602a, 0x9a3c22, 0x5e4a40, 0x6f6863] as const;
const SPARK = [0xfff3c4, 0xffc040, 0xe0702a] as const;
const SMOKE = [0x5f5852, 0x8a837c] as const;
/** A blast's smoke: darker than a gun's and greying as it thins, so it hangs over the crater as a stain. */
const BLAST_SMOKE = [0x3f3a37, 0x5e5853, 0x86807a] as const;
const OILY = [0x3a3330, 0x5a524c] as const;
const BRASS = 0xd8b048;
const WHITE = 0xffffff;

const hex = (css: string) => parseInt(css.slice(1), 16);

function mix(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

function rampAt(ramp: readonly number[], t: number): number {
  const f = Math.min(0.999, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.floor(f);
  return mix(ramp[i], ramp[i + 1], f - i);
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

// --- Particles ---

type Layer = 'smoke' | 'debris' | 'fire' | 'flash' | 'wet';

/** Depths against the scene's own: terrain 10, slugs 30, projectiles 40, water front 60. */
const LAYERS: Record<Layer, { depth: number; cap: number }> = {
  smoke: { depth: 48, cap: 420 },
  debris: { depth: 50, cap: 420 },
  fire: { depth: 52, cap: 300 },
  flash: { depth: 53, cap: 60 },
  wet: { depth: 61, cap: 260 },
};

interface Spawn {
  frame: FrameName;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  /** px/s². */
  g?: number;
  /** Share of speed lost per second, as a rate. */
  drag?: number;
  /** How strongly the wind carries it, px/s² per wind step. */
  wind?: number;
  life: number;
  /** ms before it appears. */
  delay?: number;
  /** World px across: at birth, at `grow` of its life, and at death. */
  s0: number;
  s1?: number;
  s2?: number;
  grow?: number;
  a0?: number;
  a1?: number;
  /** Share of its life it stays at a0 before fading. */
  hold?: number;
  rot?: number;
  vr?: number;
  /** Turned to its heading each frame and drawn `stretch` times as long as wide. */
  align?: boolean;
  stretch?: number;
  squash?: number;
  tint?: number;
  ramp?: readonly number[];
  /** Stops where it meets land, then fades. */
  land?: boolean;
  /** Vanishes once it falls back into the water. */
  water?: boolean;
}

interface Part extends Required<Omit<Spawn, 'ramp' | 'delay'>> {
  img: Phaser.GameObjects.Image;
  /** Scale of the atlas it was spawned from. */
  k: number;
  live: boolean;
  age: number;
  ramp: readonly number[] | null;
  landed: number;
}

class Pool {
  readonly parts: Part[] = [];
  private free: Part[] = [];
  private oldest = 0;
  private cap: number;
  // Every image is made up front: making them on the first blast cost a dropped frame.
  constructor(make: () => Phaser.GameObjects.Image, cap: number) {
    this.cap = cap;
    for (let i = 0; i < cap; i++) {
      const part = { img: make(), live: false } as Part;
      this.parts.push(part);
      this.free.push(part);
    }
  }

  take(): Part {
    const free = this.free.pop();
    if (free) return free;
    // Full: the oldest-made slot is reused, which under a pile of blasts drops the longest-lived smoke first.
    const part = this.parts[this.oldest];
    this.oldest = (this.oldest + 1) % this.cap;
    return part;
  }

  release(part: Part) {
    part.live = false;
    part.img.setVisible(false);
    this.free.push(part);
  }

  get alive() {
    let n = 0;
    for (const p of this.parts) if (p.live) n++;
    return n;
  }
}

/** Something that keeps making particles for a while: a burning crater, drowning bubbles, speed lines on a struck slug. */
interface Emitter {
  until: number;
  every: number;
  next: number;
  emit(now: number): void;
}

export interface FxHost {
  scene: Phaser.Scene;
  theme: ThemeId;
  /** Registers a game object with the world camera only. */
  world<T extends Phaser.GameObjects.GameObject>(obj: T): T;
  shake(ms: number, intensity: number): void;
  reduced: boolean;
  /** Canvas px per world px the view wants now, so the atlas can be painted that sharp. */
  res(): number;
  /** Radians the picture of the slug at this index in state.slugs leans with the ground, turned about its foot. */
  leanOf(slug: number): number;
}

/** Most a slug's picture leans with the ground; steeper than this it read as falling over. */
const MAX_TILT = (35 * Math.PI) / 180;
/** World px either side of a slug's foot where the ground's slope is read. */
const TILT_REACH = 6;

/** World y of the first ground in column x from y0 down to y1, or null over a gap. */
function groundIn(t: Uint8Array, x: number, y0: number, y1: number): number | null {
  for (let y = y0; y <= y1; y++) if (solidAt(t, x, y)) return y;
  return null;
}

/**
 * The lean of the ground under a foot at (x, fy), from the ground found a few px
 * either side of it. Over an edge only the side with ground counts, measured
 * against the foot, so a slug on a ledge's tip stays level rather than nosing
 * into the gap.
 */
export function groundTilt(t: Uint8Array, x: number, fy: number): number {
  const look = TILT_REACH * 2;
  const l = groundIn(t, x - TILT_REACH, fy - look, fy + look);
  const r = groundIn(t, x + TILT_REACH, fy - look, fy + look);
  let a = 0;
  if (l !== null && r !== null) a = Math.atan2(r - l, TILT_REACH * 2);
  else if (l !== null) a = Math.atan2(fy - l, TILT_REACH);
  else if (r !== null) a = Math.atan2(r - fy, TILT_REACH);
  return Math.max(-MAX_TILT, Math.min(MAX_TILT, a));
}

/**
 * Where a slug's picture sits when it leans r radians with the ground: turned about
 * its foot, so it stays standing on the slope, with the weapon painted turned back by
 * the lean (in whole degrees, as the rules aim) so it still points where the rules shoot.
 */
export function leanedPicture(slug: Pick<Slug, 'x' | 'y' | 'aim' | 'facing'>, r: number): { x: number; y: number; aim: number } {
  return {
    x: px(slug.x) + Math.sin(r) * SLUG_HALF_H,
    y: px(slug.y) + SLUG_HALF_H - Math.cos(r) * SLUG_HALF_H,
    aim: slug.aim + Math.round((slug.facing * r * 180) / Math.PI),
  };
}

const FX_TEXTURE = 'slugfx';
/**
 * Sharpest atlas painted: 768 px square, 2.4 MB. Particles are mostly drawn at or below their
 * frame's size, so past zoom 4 the magnification left is small.
 */
const MAX_ATLAS_SCALE = 4;
const TRAIL: Partial<Record<ProjKind, { every: number; size: number; life: number; tint: number; alpha: number }>> = {
  shell: { every: 5, size: 3.2, life: 650, tint: 0xe6e0d6, alpha: 0.7 },
  missile: { every: 5, size: 3, life: 600, tint: 0xe6e0d6, alpha: 0.7 },
  // Thicker and longer-lived, so the curve it steered along stays on screen.
  homing: { every: 4, size: 3.6, life: 1300, tint: 0xf0ece4, alpha: 0.8 },
  borer: { every: 6, size: 2.6, life: 500, tint: 0xd8d2c8, alpha: 0.6 },
  mortar: { every: 7, size: 2.4, life: 450, tint: 0xd8d2c8, alpha: 0.55 },
};
const GUNS: Partial<Record<WeaponId, { flash: number; smoke: number; casing: boolean; tracer: number }>> = {
  shotgun: { flash: 11, smoke: 4, casing: true, tracer: 1.6 },
  handgun: { flash: 7, smoke: 1, casing: true, tracer: 1 },
  machinegun: { flash: 7, smoke: 1, casing: true, tracer: 1 },
  minigun: { flash: 6, smoke: 1, casing: true, tracer: 0.9 },
  longshot: { flash: 13, smoke: 3, casing: false, tracer: 2 },
};

export class SlugFx {
  private pools: Record<Layer, Pool>;
  private emitters: Emitter[] = [];
  private state: SlugsState | null = null;
  private soil: number[];
  private water: number;
  private host: FxHost;
  /** Where each projectile and object was on the last frame drawn, to tell what a blast came from and to lay trails. */
  private lastProjs = new Map<number, { kind: ProjKind; x: number; y: number; carry: number }>();
  private lastObjs = new Map<number, { kind: ObjKind; x: number; y: number }>();
  private lastShot: { x: number; y: number } | null = null;
  private pops: { x: number; y: number }[] = [];
  /** Set by the scene when this machine cannot keep up: half the particles, the shake kept. */
  lean = false;
  private digCarry = 0;
  private jetCarry = 0;
  /** Canvas px per atlas px of the atlas new particles are drawn from, and its texture key. */
  private k = 0;
  private atlas = FX_TEXTURE;

  constructor(host: FxHost) {
    this.host = host;
    const theme = THEMES[host.theme];
    this.soil = theme.soil.map(hex);
    this.water = hex(theme.water);
    this.sharpen();
    const pool = (layer: Layer) => new Pool(
      () => host.world(host.scene.add.image(0, 0, this.atlas, 'dot').setDepth(LAYERS[layer].depth).setVisible(false)),
      LAYERS[layer].cap,
    );
    this.pools = { smoke: pool('smoke'), debris: pool('debris'), fire: pool('fire'), flash: pool('flash'), wet: pool('wet') };
  }

  /**
   * Use an atlas painted at the zoom's resolution, painting it the first time that zoom is seen.
   * Each is kept once painted: particles alive from the last one go on using it, and zooming
   * back and forth costs nothing after the first time.
   */
  private sharpen() {
    const k = Math.min(MAX_ATLAS_SCALE, Math.max(1, Math.ceil(this.host.res())));
    if (k === this.k) return;
    this.k = k;
    this.atlas = `${FX_TEXTURE}@${k}`;
    const textures = this.host.scene.textures;
    if (textures.exists(this.atlas)) return;
    const canvas = document.createElement('canvas');
    paintFxAtlas(canvas, k);
    const tex = textures.addCanvas(this.atlas, canvas)!;
    for (const [name, [x, y, w, h]] of Object.entries(FRAMES)) tex.add(name, 0, x * k, y * k, w * k, h * k);
  }

  /** Particles alive now, for the preview's stress readout. */
  count(): number {
    return Object.values(this.pools).reduce((n, p) => n + p.alive, 0);
  }

  private get thin() {
    return this.host.reduced || this.lean;
  }

  private n(v: number) {
    return this.thin ? Math.max(1, Math.round(v / 2)) : Math.round(v);
  }

  private spawn(layer: Layer, o: Spawn) {
    const part = this.pools[layer].take();
    const s1 = o.s1 ?? o.s0;
    Object.assign(part, {
      live: true, frame: o.frame, x: o.x, y: o.y, vx: o.vx ?? 0, vy: o.vy ?? 0, g: o.g ?? 0, drag: o.drag ?? 0, wind: o.wind ?? 0,
      life: o.life, age: -(o.delay ?? 0), s0: o.s0, s1, s2: o.s2 ?? s1, grow: o.grow ?? 1, a0: o.a0 ?? 1, a1: o.a1 ?? 0,
      hold: o.hold ?? 0, rot: o.rot ?? Math.random() * Math.PI * 2, vr: o.vr ?? 0, align: o.align ?? false, stretch: o.stretch ?? 1,
      squash: o.squash ?? 1, tint: o.tint ?? WHITE, ramp: o.ramp ?? null, land: o.land ?? false, water: o.water ?? false, landed: -1,
      k: this.k,
    });
    part.img.setTexture(this.atlas, o.frame).setTint(o.ramp ? o.ramp[0] : part.tint).setVisible(false);
  }

  // --- Events ---

  /**
   * One event from the rules. `ground` is the colours of the land a 'boom' dug out, read by the
   * scene before it repaints the hole; empty when it dug only air.
   */
  event(e: SlugEvent, s: SlugsState, now: number, ground: number[] = []) {
    this.state = s;
    switch (e.k) {
      case 'boom':
        this.boom(e.x, e.y, e.r, e.src ?? this.sourceOf(e.x, e.y, e.r), ground, now);
        break;
      case 'fire':
        this.fired(e.w, e.x, e.y, s);
        break;
      case 'shot':
        this.shot(e.x0, e.y0, e.x1, e.y1, s);
        break;
      case 'splash':
        this.splash(e.x, s.water, e.big);
        break;
      case 'bounce':
        this.bounce(e.x, e.y);
        break;
      case 'blow':
        this.blow(e.w, e.id, now);
        break;
      case 'teleport':
        this.teleport(e.x0, e.y0, e.x1, e.y1);
        break;
      case 'girder':
        this.girder(e.x0, e.y0, e.x1, e.y1);
        break;
      case 'mine': {
        const o = s.objs.find((obj) => obj.id === e.id);
        if (o) this.ping(px(o.x), px(o.y));
        break;
      }
      case 'dud':
        this.dud(e.x, e.y);
        break;
      case 'rope':
        if (e.hit) this.bounce(e.x, e.y);
        break;
      case 'die': {
        // The rules' pop for this slug follows on the same tick.
        const slug = s.slugs[e.id];
        this.pops.push({ x: px(slug.x), y: px(slug.y) });
        break;
      }
      case 'drown': {
        const slug = s.slugs[e.id];
        this.drownBubbles(px(slug.x), now);
        break;
      }
      default:
        break;
    }
  }

  private sourceOf(x: number, y: number, r: number): BlastSource | null {
    const pop = this.pops.findIndex((p) => Math.abs(p.x - x) <= 2 && Math.abs(p.y - y) <= 2);
    if (pop >= 0) {
      this.pops.splice(pop, 1);
      return 'pop';
    }
    if (this.lastShot && Math.abs(this.lastShot.x - x) <= 1 && Math.abs(this.lastShot.y - y) <= 1) {
      this.lastShot = null;
      return 'shot';
    }
    const s = this.state!;
    // The millstone stays in play while it bursts through each layer.
    if (s.projs.some((p) => p.kind === 'stone' && Math.abs(px(p.x) - x) <= 2 && Math.abs(px(p.y) - y) <= 12)) return 'stone';
    let best: BlastSource | null = null;
    let bestD = r + 40;
    const alive = new Set(s.projs.map((p) => p.id));
    for (const [id, p] of this.lastProjs) {
      if (alive.has(id)) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p.kind;
      }
    }
    const objs = new Set(s.objs.map((o) => o.id));
    for (const [id, o] of this.lastObjs) {
      if (objs.has(id)) continue;
      const d = Math.hypot(o.x - x, o.y - y);
      if (d < bestD) {
        bestD = d;
        best = o.kind;
      }
    }
    return best;
  }

  /** A blast of the given style; public so the preview can set off any of them by hand. */
  boom(x: number, y: number, r: number, source: BlastSource | null, ground: number[], now: number) {
    const style = blastStyle(r, source);
    const k = blastRecipe(style, r, this.host.reduced, this.lean);
    const soil = ground.length ? ground : this.soil;
    const wind = this.windStep();
    if (k.flash) {
      // Smaller than the fireball it starts, so the fireball is what stays in the eye.
      this.spawn('flash', { frame: 'burst', x, y, life: style === 'big' ? 110 : 60, s0: k.flash * 0.6, s1: k.flash, grow: 0.4, a0: 1, a1: 0, hold: 0.5 });
    }
    // Rays thrown straight out with the flash, gone before the fireball has filled out.
    for (let i = 0; i < k.streaks; i++) {
      const a = ((i + rand(-0.3, 0.3)) / k.streaks) * Math.PI * 2;
      const v = rand(5, 8) * r;
      this.spawn('flash', {
        frame: 'spark', x: x + Math.cos(a) * r * 0.2, y: y + Math.sin(a) * r * 0.2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: 4,
        life: rand(90, 150), s0: rand(2.2, 3.2) + r / 30, a0: 1, a1: 0, hold: 0.4, align: true, stretch: 3 + r / 16, tint: 0xfff0b0,
      });
    }
    if (k.ring) {
      this.spawn('flash', {
        frame: 'ring', x, y, life: k.ringMs, s0: r * 0.5, s1: k.ring, grow: 1, a0: 0.75, a1: 0, rot: 0,
        tint: style === 'stone' ? mix(pick(soil), WHITE, 0.5) : 0xfff1d0,
      });
    }
    for (let i = 0; i < k.fire; i++) {
      // The first puff is the ball's heart, sat on the centre; the rest bulge out of it.
      const core = i === 0;
      const a = Math.random() * Math.PI * 2;
      const d = core ? 0 : rand(0.1, 0.35) * r;
      const out = core ? 0 : rand(1.1, 2.4) * r;
      const size = core ? 0.85 * r : rand(0.45, 0.75) * r;
      this.spawn('fire', {
        frame: 'blob', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: Math.cos(a) * out, vy: Math.sin(a) * out - r * 0.4,
        drag: 5, g: -r * 1.2, wind: wind * 2, life: k.fireLife * (core ? 0.8 : rand(0.75, 1.15)), delay: i < 3 ? 0 : rand(0, 60),
        s0: size * 0.5, s1: size, s2: size * 0.75, grow: 0.3, a0: 1, a1: 0, hold: 0.7, ramp: FIRE, vr: rand(-2, 2),
      });
    }
    // Barrel: the fire is the fuel's, so it climbs higher in a column and leaves oily smoke.
    if (style === 'barrel') {
      for (let i = 0; i < k.fire / 2; i++) {
        const size = rand(0.35, 0.55) * r;
        this.spawn('fire', {
          frame: 'blob', x: x + rand(-r, r) * 0.3, y, vx: rand(-20, 20), vy: -rand(1.6, 2.6) * r, drag: 1.6, wind: wind * 3,
          life: rand(700, 1000), delay: rand(40, 160), s0: size * 0.4, s1: size, s2: size * 0.6, grow: 0.25, hold: 0.6, ramp: FIRE,
        });
      }
    }
    for (let i = 0; i < k.smoke; i++) {
      const size = rand(0.45, 0.8) * r;
      this.spawn('smoke', {
        frame: 'puff', x: x + rand(-r, r) * 0.4, y: y + rand(-r, r) * 0.3, vx: rand(-r, r) * 0.6, vy: -rand(0.3, 0.8) * r,
        drag: 1.2, g: -6, wind: wind * 6, life: k.smokeLife * rand(0.7, 1.2), delay: rand(k.fireLife * 0.3, k.fireLife * 0.8),
        s0: size * 0.6, s1: size * 1.5, grow: 1, a0: style === 'barrel' ? 0.8 : 0.6, a1: 0, hold: 0.3,
        ramp: style === 'barrel' ? OILY : BLAST_SMOKE, vr: rand(-0.6, 0.6),
      });
    }
    // Big blasts send up a second, slower column that hangs over the crater.
    if (style === 'big') {
      for (let i = 0; i < this.n(6); i++) {
        const size = rand(0.4, 0.6) * r;
        this.spawn('smoke', {
          frame: 'puff', x: x + rand(-0.2, 0.2) * r, y: y - i * r * 0.15, vx: rand(-8, 8), vy: -rand(0.5, 0.9) * r, drag: 0.6, wind: wind * 5,
          life: rand(3000, 4200), delay: 250 + i * 80, s0: size * 0.5, s1: size * 1.6, a0: 0.6, a1: 0, hold: 0.35, ramp: BLAST_SMOKE,
        });
      }
    }
    for (let i = 0; i < k.chunks; i++) {
      // Mostly up and out: a cone above the horizontal, wider for the millstone's sideways crush.
      const spread = style === 'stone' ? 1.25 : 1.05;
      const a = -Math.PI / 2 + rand(-spread, spread);
      const v = rand(120, 180 + r * 4);
      // Mostly crumbs, a few lumps: one size for all read as a sprinkle, not ground thrown up.
      const lump = (style === 'big' || style === 'stone') && i % 5 === 0 ? 1.6 : 1;
      this.spawn('debris', {
        frame: pick(CHUNKS), x: x + rand(-r, r) * 0.3, y: y + rand(-r, r) * 0.2, vx: Math.cos(a) * v,
        vy: Math.sin(a) * v, g: 640, drag: 0.3, life: rand(1300, 2000), s0: (rand(1.4, 3.6) + r / 24) * lump, a0: 1, a1: 0, hold: 0.8,
        vr: rand(-12, 12), tint: pick(soil), land: true, water: true,
      });
    }
    for (let i = 0; i < k.sparks; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(200, 360 + r * 2);
      this.spawn('fire', {
        frame: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, g: 380, drag: 1.5, life: rand(200, 420),
        s0: rand(1.6, 2.4), a0: 1, a1: 0.2, align: true, stretch: 4, ramp: SPARK,
      });
    }
    for (let i = 0; i < k.embers; i++) {
      const a = -Math.PI / 2 + rand(-1.2, 1.2);
      const v = rand(0.8, 2.2) * r;
      this.spawn('fire', {
        frame: 'dot', x: x + rand(-0.3, 0.3) * r, y: y + rand(-0.3, 0.2) * r, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: -30, drag: 1.8,
        wind: wind * 6, life: rand(900, 1600), delay: rand(60, 240), s0: rand(1, 1.8), a0: 1, a1: 0, hold: 0.5, ramp: SPARK,
      });
    }
    for (let i = 0; i < k.dust; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const size = rand(0.35, 0.6) * r;
      this.spawn('smoke', {
        frame: 'puff', x: x + dir * rand(0, 0.4) * r, y: y + r * 0.3, vx: dir * rand(0.8, 2.2) * r, vy: -rand(0.1, 0.5) * r,
        drag: 2.5, wind: wind * 4, life: rand(1200, 2000), s0: size * 0.6, s1: size * 1.3, a0: 0.75, a1: 0, hold: 0.3,
        tint: mix(pick(soil), WHITE, 0.45),
      });
    }
    for (let i = 0; i < k.goo; i++) {
      const a = -Math.PI / 2 + rand(-1.3, 1.3);
      const v = rand(90, 220);
      this.spawn('debris', {
        frame: 'drop', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 520, life: rand(700, 1100), s0: rand(2.2, 3.4),
        align: true, stretch: 0.5, tint: hex(i % 3 === 0 ? SLUG_COLOURS.light : SLUG_COLOURS.body), land: true, water: true, a1: 0.3, hold: 0.7,
      });
    }
    if (k.burnMs) this.burn(x, y + r * 0.5, r, now + k.burnMs, now);
    if (k.shake) this.host.shake(k.shake.ms, k.shake.intensity);
  }

  /** Flames licking the floor of a crater after the blast; a flame with no floor under it is not lit. */
  private burn(x: number, y: number, r: number, until: number, now: number) {
    this.emitters.push({
      until, every: this.thin ? 120 : 60, next: now,
      emit: () => {
        const t = this.state?.terrain;
        if (!t) return;
        const fx = x + rand(-0.5, 0.5) * r;
        const floor = groundIn(t, Math.round(fx), Math.round(y), Math.round(y + r));
        if (floor === null) return;
        const fy = floor - 1;
        const size = rand(0.09, 0.15) * r + 1.5;
        this.spawn('fire', {
          frame: 'blob', x: fx, y: fy, vx: rand(-6, 6), vy: -rand(30, 60), wind: this.windStep() * 4, life: rand(400, 650),
          s0: size, s1: size * 1.2, s2: size * 0.3, grow: 0.3, hold: 0.6, ramp: FIRE,
        });
      },
    });
  }

  private fired(w: WeaponId, x: number, y: number, s: SlugsState) {
    const slug = s.slugs[s.active];
    if (!slug) return;
    const dx = (slug.facing * cosDeg(slug.aim)) / ONE;
    const dy = -sinDeg(slug.aim) / ONE;
    const wind = this.windStep();
    switch (w) {
      case 'bazooka':
      case 'homing':
      case 'borer':
      case 'mortar': {
        const muzzle = this.muzzle(s);
        const mx = muzzle ? muzzle.x : x + dx * 15;
        const my = muzzle ? muzzle.y : y + dy * 15;
        const big = w === 'mortar';
        this.spawn('flash', { frame: 'burst', x: mx, y: my, life: 70, s0: big ? 12 : 9, s1: big ? 15 : 11, a1: 0.5, hold: 0.5 });
        // Smoke out of the front with the shell, and the back-blast out of the tube's rear end.
        for (let i = 0; i < this.n(big ? 7 : 4); i++) {
          const v = rand(40, 110);
          this.spawn('smoke', {
            frame: 'puff', x: mx, y: my, vx: dx * v + rand(-15, 15), vy: dy * v + rand(-15, 15), drag: 3, wind: wind * 5, life: rand(600, 1000),
            s0: 3, s1: rand(7, 10), a0: 0.7, ramp: SMOKE,
          });
        }
        if (!big) {
          for (let i = 0; i < this.n(4); i++) {
            const v = rand(50, 120);
            this.spawn('smoke', {
              frame: 'puff', x: x - dx * 10, y: y - dy * 10, vx: -dx * v + rand(-20, 20), vy: -dy * v + rand(-20, 20), drag: 3.5, wind: wind * 5,
              life: rand(500, 800), s0: 3, s1: rand(6, 9), a0: 0.6, ramp: SMOKE,
            });
          }
        }
        break;
      }
      case 'dynamite':
      case 'mine':
      case 'snail':
        this.groundPuff(x + slug.facing * 7, y + 9, 3);
        break;
      case 'uppercut':
      case 'spade':
      case 'prod': {
        // The swing itself: a few lines along it, whether or not it lands.
        const ax = w === 'uppercut' ? 0 : w === 'spade' ? dx : slug.facing;
        const ay = w === 'uppercut' ? -1 : w === 'spade' ? dy : 0;
        for (let i = 0; i < this.n(3); i++) {
          const off = (i - 1) * 4;
          this.spawn('flash', {
            frame: 'line', x: x + ax * 10 - ay * off, y: y + ay * 10 + ax * off, vx: ax * 160, vy: ay * 160, life: 140, delay: i * 20,
            s0: 2, align: true, stretch: 7, a0: 0.9, tint: 0xfffaf0,
          });
        }
        break;
      }
      case 'jetpack':
        this.groundPuff(x - slug.facing * 5.5, y + 12, 4);
        break;
      default:
        break;
    }
  }

  /** The world point of the active slug's held bore as drawn, leaning with the ground; null without one. */
  private muzzle(s: SlugsState): { x: number; y: number } | null {
    const slug = s.slugs[s.active];
    const r = this.host.leanOf(s.active);
    const pic = leanedPicture(slug, r);
    const m = heldMuzzle(s.weapon, pic.aim, slug.facing);
    if (!m) return null;
    return { x: pic.x + m.x * Math.cos(r) - m.y * Math.sin(r), y: pic.y + m.x * Math.sin(r) + m.y * Math.cos(r) };
  }

  private shot(x0: number, y0: number, x1: number, y1: number, s: SlugsState) {
    const gun = GUNS[s.weapon] ?? GUNS.handgun!;
    this.lastShot = { x: x1, y: y1 };
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < 1) return;
    const ux = (x1 - x0) / len;
    const uy = (y1 - y0) / len;
    // The rules shoot from the slug's middle; the flash and tracer start at the barrel's end as drawn.
    const muzzle = this.muzzle(s);
    const mx = muzzle ? muzzle.x : x0 + ux * 8;
    const my = muzzle ? muzzle.y : y0 + uy * 8;
    this.spawn('flash', { frame: 'burst', x: mx, y: my, life: 60, s0: gun.flash * 0.7, s1: gun.flash, grow: 0.3, a1: 0.4, hold: 0.4 });
    // The tracer: a streak laid along the shot, bright at the far end, gone in a few frames.
    const trace = Math.hypot(x1 - mx, y1 - my);
    if (trace > 4) {
      const tx = (x1 - mx) / trace;
      const ty = (y1 - my) / trace;
      this.spawn('flash', {
        frame: 'line', x: (mx + x1) / 2, y: (my + y1) / 2, vx: tx * 0.001, vy: ty * 0.001, life: 150, s0: gun.tracer,
        align: true, stretch: trace / gun.tracer, a0: 0.9, a1: 0, tint: 0xffd25e,
      });
    }
    for (let i = 0; i < this.n(gun.smoke); i++) {
      const v = rand(20, 60);
      this.spawn('smoke', {
        frame: 'puff', x: mx, y: my, vx: ux * v, vy: uy * v - 10, drag: 2, wind: this.windStep() * 5, life: rand(500, 900),
        s0: 2, s1: rand(4, 7), a0: 0.55, ramp: SMOKE,
      });
    }
    if (gun.casing) {
      // A spent case kicks out of the side and back, and tinkles to the ground.
      const side = ux >= 0 ? -1 : 1;
      this.spawn('debris', {
        frame: 'chunk1', x: (x0 + mx) / 2, y: (y0 + my) / 2 - 1, vx: side * rand(40, 80), vy: -rand(90, 150), g: 600, life: 900, s0: 1.6,
        vr: rand(-20, 20), tint: BRASS, land: true, water: true, hold: 0.7,
      });
    }
  }

  private splash(x: number, level: number, big: boolean) {
    const n = this.n(big ? 30 : 12);
    const top = level - 2;
    const light = mix(this.water, WHITE, 0.55);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rand(-0.5, 0.5);
      const v = rand(110, big ? 330 : 230);
      this.spawn('wet', {
        frame: 'drop', x: x + rand(-4, 4), y: top, vx: Math.cos(a) * v, vy: Math.sin(a) * v, g: 620, life: 1400,
        s0: rand(2, big ? 3.6 : 2.8), align: true, stretch: 0.5, tint: i % 3 === 0 ? WHITE : light, water: true, a1: 0.6, hold: 0.8,
      });
    }
    // The crown of foam that stands up and falls back, and the rings left on the surface.
    for (let i = 0; i < this.n(big ? 5 : 2); i++) {
      const size = rand(5, 8) * (big ? 1.4 : 1);
      this.spawn('wet', {
        frame: 'puff', x: x + rand(-5, 5), y: top - i * (big ? 6 : 3), vx: rand(-10, 10), vy: -rand(40, big ? 140 : 70), g: 260, life: rand(500, 800),
        s0: size * 0.5, s1: size, s2: size * 0.4, grow: 0.3, a0: 0.95, hold: 0.5, tint: mix(this.water, WHITE, 0.8),
      });
    }
    for (let i = 0; i < (big ? 2 : 1); i++) {
      this.spawn('wet', {
        frame: 'ring', x, y: top + 1, life: 700, delay: i * 180, s0: 6, s1: big ? 46 : 24, squash: 0.25, rot: 0, a0: 0.8, tint: mix(this.water, WHITE, 0.6),
      });
    }
  }

  private drownBubbles(x: number, now: number) {
    this.emitters.push({
      until: now + 1400, every: this.thin ? 160 : 80, next: now + 200,
      emit: () => {
        const s = this.state;
        if (!s) return;
        this.spawn('wet', {
          frame: 'bubble', x: x + rand(-5, 5), y: s.water + rand(10, 26), vx: rand(-8, 8), vy: -rand(30, 50), life: 500,
          s0: rand(2, 3.5), a0: 0.9, a1: 0.4, hold: 0.7, tint: mix(this.water, WHITE, 0.7), rot: 0,
        });
      },
    });
  }

  private bounce(x: number, y: number) {
    this.groundPuff(x, y, 3);
    for (let i = 0; i < this.n(3); i++) {
      this.spawn('debris', {
        frame: 'chunk2', x, y, vx: rand(-60, 60), vy: -rand(60, 120), g: 600, life: 600, s0: rand(1.4, 2), vr: rand(-10, 10),
        tint: pick(this.soil), land: true, hold: 0.6,
      });
    }
  }

  private groundPuff(x: number, y: number, count: number) {
    for (let i = 0; i < this.n(count); i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      this.spawn('smoke', {
        frame: 'puff', x: x + dir * rand(0, 3), y: y - 1, vx: dir * rand(20, 50), vy: -rand(5, 20), drag: 3, life: rand(450, 700),
        s0: 2.5, s1: rand(5, 7), a0: 0.65, hold: 0.2, tint: mix(pick(this.soil), WHITE, 0.5),
      });
    }
  }

  private blow(w: WeaponId, id: number, now: number) {
    const s = this.state!;
    const slug = s.slugs[id];
    const x = px(slug.x);
    const y = px(slug.y);
    const hard = w !== 'prod';
    this.spawn('flash', { frame: 'burst', x, y: y - 2, life: hard ? 110 : 80, s0: hard ? 12 : 7, s1: hard ? 17 : 9, grow: 0.3, a1: 0.6, hold: 0.5 });
    for (let i = 0; i < this.n(hard ? 6 : 3); i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn('flash', {
        frame: 'dot', x, y: y - 2, vx: Math.cos(a) * 140, vy: Math.sin(a) * 140, drag: 6, life: 220, s0: 2.2, s2: 0.6, tint: 0xfff4cf,
      });
    }
    // Speed lines trail the struck slug while it is thrown, streaming back from where it is heading.
    this.emitters.push({
      until: now + (hard ? 600 : 300), every: this.thin ? 70 : 35, next: now,
      emit: () => {
        const cur = this.state!.slugs[id];
        const vx = cur.vx / ONE;
        const vy = cur.vy / ONE;
        const sp = Math.hypot(vx, vy);
        if (sp < 1) return;
        const ux = vx / sp;
        const uy = vy / sp;
        const off = rand(-6, 6);
        const cx = px(cur.x) - ux * 10 - uy * off;
        const cy = px(cur.y) - uy * 10 + ux * off;
        this.spawn('flash', {
          frame: 'line', x: cx, y: cy, vx: ux * 0.001, vy: uy * 0.001, life: 160, s0: 1.4, align: true, stretch: rand(6, 10),
          a0: 0.85, tint: 0xfffaf0,
        });
      },
    });
  }

  private teleport(x0: number, y0: number, x1: number, y1: number) {
    // Out: the slug's place draws in on itself; in: it opens out where it arrives.
    for (const [x, y, inward] of [[x0, y0, true], [x1, y1, false]] as const) {
      this.spawn('flash', {
        frame: 'ring', x, y, life: 320, delay: inward ? 0 : 120, s0: inward ? 26 : 4, s1: inward ? 4 : 26, rot: 0, squash: 1.6, a0: 0.8,
        a1: 0.1, tint: 0xf4f0e0,
      });
      for (let i = 0; i < this.n(10); i++) {
        const ox = rand(-7, 7);
        const oy = rand(-10, 10);
        this.spawn('flash', {
          frame: 'line', x: x + ox, y: y + oy, vx: 0.001, vy: inward ? -rand(40, 90) : rand(40, 90), life: rand(250, 420),
          delay: (inward ? 0 : 120) + rand(0, 100), s0: 1.2, align: true, stretch: rand(3, 6), a0: 0.9, tint: i % 2 ? 0xf4f0e0 : 0xcfe6ec,
        });
      }
    }
  }

  private girder(x0: number, y0: number, x1: number, y1: number) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(2, Math.round(len / 9));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      if (i % (this.thin ? 2 : 1) === 0) {
        this.spawn('smoke', {
          frame: 'puff', x, y: y + 3, vx: rand(-15, 15), vy: rand(-12, 4), drag: 2, life: rand(500, 800), delay: rand(0, 80),
          s0: 3, s1: rand(6, 9), a0: 0.55, hold: 0.2, tint: 0xd9d4c8,
        });
      }
      this.spawn('debris', {
        frame: 'dot', x: x + rand(-2, 2), y: y + 3, vx: rand(-10, 10), vy: rand(10, 40), g: 400, life: rand(500, 800), s0: rand(0.9, 1.4),
        tint: 0x8a8378, land: true, hold: 0.6,
      });
    }
  }

  private ping(x: number, y: number) {
    this.spawn('flash', { frame: 'ring', x, y: y - 2, life: 360, s0: 4, s1: 22, rot: 0, a0: 0.9, tint: 0xf05a3a });
  }

  private dud(x: number, y: number) {
    for (let i = 0; i < this.n(4); i++) {
      this.spawn('smoke', {
        frame: 'puff', x, y: y - 2, vx: rand(-12, 12), vy: -rand(15, 35), life: rand(800, 1200), s0: 2.5, s1: rand(6, 9), a0: 0.6,
        wind: this.windStep() * 5, ramp: SMOKE,
      });
    }
    for (let i = 0; i < this.n(4); i++) {
      this.spawn('fire', {
        frame: 'spark', x, y: y - 3, vx: rand(-50, 50), vy: -rand(40, 90), g: 300, life: rand(250, 400), s0: 1.4, align: true,
        stretch: 3, ramp: SPARK,
      });
    }
  }

  // --- Every frame ---

  private windStep() {
    return this.state ? this.state.wind * this.state.opts.windScale / 100 : 0;
  }

  /** Continuous effects, then move every particle. `dt` in ms. */
  update(s: SlugsState, now: number, dt: number) {
    this.state = s;
    this.sharpen();
    this.trails(s);
    this.tools(s, dt);
    this.emitters = this.emitters.filter((e) => {
      while (e.next <= now && e.next < e.until) {
        e.emit(now);
        e.next += e.every;
      }
      return now < e.until;
    });
    this.lastObjs.clear();
    for (const o of s.objs) this.lastObjs.set(o.id, { kind: o.kind, x: px(o.x), y: px(o.y) });
    this.lastShot = null;
    this.pops.length = 0;
    this.step(dt / 1000, s);
  }

  private trails(s: SlugsState) {
    const seen = new Map<number, { kind: ProjKind; x: number; y: number; carry: number }>();
    for (const p of s.projs) {
      const x = p.x / ONE;
      const y = p.y / ONE;
      const was = this.lastProjs.get(p.id);
      const now = { kind: p.kind, x, y, carry: was?.carry ?? 0 };
      seen.set(p.id, now);
      if (!was) continue;
      const trail = TRAIL[p.kind];
      const dist = Math.hypot(x - was.x, y - was.y);
      if (trail && !(p.kind === 'borer' && p.dig > 0) && dist < 80) {
        // Puffs laid at even spacing along the path, carrying the remainder over to the next frame.
        const every = trail.every * (this.thin ? 2 : 1);
        let d = every - now.carry;
        while (d <= dist) {
          const t = d / dist;
          const size = trail.size * rand(0.8, 1.2);
          this.spawn('smoke', {
            frame: 'puff', x: was.x + (x - was.x) * t + rand(-0.6, 0.6), y: was.y + (y - was.y) * t + rand(-0.6, 0.6), vy: -rand(3, 10),
            drag: 1, wind: this.windStep() * 3, life: trail.life * rand(0.8, 1.2), s0: size * 0.6, s1: size * 2.2, a0: trail.alpha, hold: 0.15,
            tint: trail.tint,
          });
          d += every;
        }
        now.carry = (now.carry + dist) % every;
      }
      if (p.kind === 'borer' && p.dig > 0 && Math.random() < (this.thin ? 0.25 : 0.5)) {
        // Spoil spat back out of the tunnel mouth.
        this.spawn('debris', {
          frame: pick(CHUNKS), x, y, vx: -p.vx / ONE * 30 + rand(-30, 30), vy: -rand(80, 140), g: 600,
          life: 900, s0: rand(1.4, 2.2), vr: rand(-10, 10), tint: pick(this.soil), land: true, hold: 0.7,
        });
      }
      // A lit fuse fizzes at the stick's top; the stick lies on its side once it has come to rest.
      if (p.kind === 'dynamite' && Math.random() < (this.thin ? 0.3 : 0.6)) {
        const tipX = p.rest ? x + 7 : x;
        const tipY = p.rest ? y - 1 : y - 7;
        this.spawn('fire', {
          frame: 'spark', x: tipX, y: tipY, vx: rand(-50, 50), vy: -rand(30, 80), g: 260, life: rand(120, 260), s0: 1, align: true,
          stretch: 3, ramp: SPARK,
        });
      }
    }
    this.lastProjs = seen;
  }

  /** Drill and blowtorch spray while they work; a jetpack puffs while it burns fuel. */
  private tools(s: SlugsState, dt: number) {
    const slug = s.slugs[s.active];
    if (!slug || !slug.alive) return;
    const thrust = slug.mode === 'jet' ? slug.thrust ?? 0 : 0;
    const x = px(slug.x);
    const y = px(slug.y);
    if (thrust) {
      // The smoke leaves along the flames drawJetpack draws: down for up, back behind the slug for a side thruster.
      const up = (thrust & KEY.up) !== 0;
      const back = thrust & (KEY.left | KEY.right) ? -slug.facing * (up ? 35 : 70) : 0;
      this.jetCarry += dt;
      const every = this.thin ? 80 : 40;
      for (; this.jetCarry >= every; this.jetCarry -= every) {
        this.spawn('smoke', {
          frame: 'puff', x: x - slug.facing * 5.5 + rand(-1, 1), y: y + 12, vx: rand(-10, 10) + back + slug.vx / ONE * 20, vy: up ? rand(40, 80) : rand(15, 35), drag: 3,
          wind: this.windStep() * 4, life: rand(350, 550), s0: 2, s1: rand(5, 7), a0: 0.55, ramp: SMOKE,
        });
      }
    } else this.jetCarry = 0;
    const w = s.using?.w;
    if (w !== 'drill' && w !== 'blowtorch') {
      this.digCarry = 0;
      return;
    }
    this.digCarry += dt;
    const every = this.thin ? 50 : 25;
    for (; this.digCarry >= every; this.digCarry -= every) {
      if (w === 'drill') {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.spawn('debris', {
          frame: pick(CHUNKS), x: x + side * 4, y: y + 8, vx: side * rand(40, 110), vy: -rand(90, 170), g: 620,
          life: 900, s0: rand(1.3, 2.2), vr: rand(-12, 12), tint: pick(this.soil), land: true, hold: 0.7,
        });
        if (Math.random() < 0.35) {
          this.spawn('smoke', {
            frame: 'puff', x: x + side * 5, y: y + 6, vx: side * rand(10, 30), vy: -rand(10, 30), drag: 2, life: 600, s0: 2.5, s1: 6, a0: 0.5,
            tint: mix(pick(this.soil), WHITE, 0.5),
          });
        }
        if (Math.random() < 0.3) {
          this.spawn('fire', {
            frame: 'spark', x, y: y + 9, vx: rand(-90, 90), vy: -rand(40, 120), g: 400, life: 200, s0: 1, align: true, stretch: 3, ramp: SPARK,
          });
        }
      } else {
        const fx = x + slug.facing * 8;
        const fy = y + rand(-3, 3);
        this.spawn('fire', {
          frame: 'blob', x: fx, y: fy, vx: slug.facing * rand(30, 60), vy: rand(-10, 10), drag: 4, g: -40, life: rand(160, 260),
          s0: 2.5, s1: 4.5, s2: 1.5, grow: 0.3, ramp: FIRE,
        });
        this.spawn('fire', {
          frame: 'spark', x: fx, y: fy, vx: -slug.facing * rand(30, 120), vy: -rand(40, 130), g: 420, life: rand(220, 380), s0: 1.1,
          align: true, stretch: 3.5, ramp: SPARK,
        });
        if (Math.random() < 0.3) {
          this.spawn('smoke', {
            frame: 'puff', x: fx, y: fy - 3, vx: rand(-10, 10), vy: -rand(20, 40), wind: this.windStep() * 4, life: 700, s0: 2, s1: 6, a0: 0.45,
            ramp: SMOKE,
          });
        }
      }
    }
  }

  private step(dt: number, s: SlugsState) {
    const t = s.terrain;
    const water = s.water;
    const windAcc = this.windStep();
    for (const pool of Object.values(this.pools)) {
      for (const p of pool.parts) {
        if (!p.live) continue;
        if (p.age < 0) {
          p.age += dt * 1000;
          continue;
        }
        // Shown from its first step, once it has been placed, never at the last owner's spot.
        if (!p.img.visible) p.img.setVisible(true);
        p.age += dt * 1000;
        if (p.age >= p.life) {
          pool.release(p);
          continue;
        }
        if (p.landed < 0) {
          const damp = Math.exp(-p.drag * dt);
          p.vx = p.vx * damp + p.wind * windAcc * dt;
          p.vy = p.vy * damp + p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          if (p.land && p.vy > 0 && solidAt(t, Math.round(p.x), Math.round(p.y))) {
            p.landed = p.age;
            // Land on the surface, not inside it, and lie there for the rest of its fade.
            for (let k = 0; k < 4 && solidAt(t, Math.round(p.x), Math.round(p.y) - 1); k++) p.y -= 1;
          }
          if (p.water && p.vy > 0 && p.y > water) {
            pool.release(p);
            continue;
          }
        }
        const f = p.age / p.life;
        const size = f < p.grow ? p.s0 + (p.s1 - p.s0) * (1 - (1 - f / p.grow) ** 2) : p.s1 + (p.s2 - p.s1) * ((f - p.grow) / (1 - p.grow || 1));
        const alpha = f < p.hold ? p.a0 : p.a0 + (p.a1 - p.a0) * ((f - p.hold) / (1 - p.hold));
        const frameW = FRAMES[p.frame][2];
        const sc = size / (frameW * p.k);
        const img = p.img;
        if (p.ramp) img.setTint(rampAt(p.ramp, f));
        img.setPosition(p.x, p.y).setAlpha(alpha);
        if (p.align) {
          if (p.landed < 0) img.setRotation(Math.atan2(p.vy, p.vx));
          img.setScale(sc * p.stretch * (FRAMES[p.frame][3] / frameW) * (frameW / FRAMES[p.frame][3]), sc * (frameW / FRAMES[p.frame][3]));
        } else {
          img.setRotation(p.rot).setScale(sc, sc * p.squash);
        }
      }
    }
  }

  destroy() {
    for (const pool of Object.values(this.pools)) for (const p of pool.parts) p.img.destroy();
    this.emitters = [];
  }
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
