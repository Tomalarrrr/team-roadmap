// The zip lines as the player sees them: each post, the cable, the pulley under a rider, and a cut cable swinging
// down from the post that still holds it. Drawing only: the rules decide where the cables are, who rides them and
// when one is cut (slugsGameLogic's zip section); nothing here feeds back into them.

import type * as Phaser from 'phaser';
import { GRAVITY, H, ONE, ZIP_POST, solidAt, zipWhole } from '../../slugsGameLogic';
import type { SlugEvent, SlugsState, Zip } from '../../slugsGameLogic';
import { drawZipCable, drawZipPost, drawZipTrolley } from './slugArt';

/** The cable strip's tile, px, and its texture px per px: as the rope's (slugsScene ROPE_RUN, ROPE_RES). */
const CABLE_RUN = 64;
const CABLE_RES = 8;
// Under the posts, so each post's eye ring is drawn over the end of its cable; the posts stand in front of the land
// (10) and behind mines, barrels and crates (15); the pulley hangs behind its rider (30).
const CABLE_DEPTH = 13.9;
const POST_DEPTH = 14;
const TROLLEY_DEPTH = 29;
/** The post picture, px, with the eye the cable is tied to at (POST_EYE_X, POST_EYE_Y). drawZipPost reaches 12.4 px back from the eye and 25.5 below it. */
const POST_W = 28;
const POST_H = 34;
const POST_EYE_X = 14;
const POST_EYE_Y = 6;
/** The pulley picture, px, with the point that runs on the cable at (TROLLEY_EYE_X, TROLLEY_EYE_Y). */
const TROLLEY_W = 16;
const TROLLEY_H = 20;
const TROLLEY_EYE_X = 8;
const TROLLEY_EYE_Y = 6;
/** drawZipTrolley's wheel radius, px, so the wheel turns as far as it rolls. */
const WHEEL_R = 1.8;
/** Faster than this along the cable, a tick, the spokes are dropped: at 60 frames a second they turn 27° a frame here, and nearer 60° they seem to turn backwards. */
const BLUR_SPEED = ONE;
/** A whole cable is laid as straight runs this long, px: at the rules' sag of a px per 25 of span, each bends from the next by under a degree. */
const WHOLE_RUN = 16;
/** A cut cable's links, px. */
const LINK = 6;
/** The chain's step, ms, and its fall a step, px: the rules' tick and gravity, so a cut cable drops as a slug does. */
const STEP_MS = 20;
const FALL = GRAVITY / ONE;
/** Of its speed, a link keeps this much a step. */
const DAMP = 0.98;
/** Times a step each link is pulled back to its length. Hanging at rest, a 280 px length is stretched 2% by its own weight at 40 and 6% at 10. */
const PASSES = 40;
/** Moving less than this a step, px, for STILL_STEPS steps running, a chain is left as it lies until a blast. */
const STILL = 0.02;
const STILL_STEPS = 50;
/** Steps a chain is given to come to rest at once, for reduced motion: a 560 px cable cut in half rests after about 620. */
const SETTLE_MOST = 1000;
/** Steps run in one frame at most, so a stalled tab catches up without a burst of work. */
const STEPS_MOST = 5;
/** A blast this many of its radii away still swings a chain, by up to KICK px a step at its centre. */
const KICK_REACH = 1.6;
const KICK = 2;
/** A post whose ground goes tumbles into the hole for this long and is gone. */
const TUMBLE_MS = 700;
/** Strips drawn into each other at a joint, px, so the outside of a bend shows no notch. */
const OVERLAP = 0.5;

/** The cable's point `u` of the way along (0..1), in px: the rules' zipPoint, unrounded. */
export function cableAt(z: Zip, u: number) {
  return { x: z.ax + (z.bx - z.ax) * u, y: z.ay + (z.by - z.ay) * u + 4 * z.sag * u * (1 - u) };
}

/** The cable's angle at `u`, radians, positive where it runs down to the right. */
export function cableSlope(z: Zip, u: number) {
  return Math.atan(((z.by - z.ay) + 4 * z.sag * (1 - 2 * u)) / (z.bx - z.ax));
}

/** The cable's length from `u0` to `u1`, px, measured along WHOLE_RUN-long runs. */
export function cableLength(z: Zip, u0: number, u1: number) {
  const n = Math.max(1, Math.ceil((Math.abs(u1 - u0) * (z.bx - z.ax)) / WHOLE_RUN));
  let len = 0;
  let a = cableAt(z, u0);
  for (let k = 1; k <= n; k++) {
    const b = cableAt(z, u0 + ((u1 - u0) * k) / n);
    len += Math.hypot(b.x - a.x, b.y - a.y);
    a = b;
  }
  return len;
}

/** A length of cable as links of equal length; with `pinned`, its first point is held where it is. */
export interface Chain {
  xs: Float64Array;
  ys: Float64Array;
  /** Each point a step ago: its speed is how far it has come since. */
  ox: Float64Array;
  oy: Float64Array;
  link: number;
  pinned: boolean;
  /** Steps running it has moved less than STILL. */
  still: number;
}

/** The cable from `u0` (where it is held, when `pinned`) to `u1`, lying where it hung. */
export function chainAlong(z: Zip, u0: number, u1: number, pinned: boolean): Chain {
  const len = cableLength(z, u0, u1);
  const n = Math.max(1, Math.round(len / LINK));
  const xs = new Float64Array(n + 1);
  const ys = new Float64Array(n + 1);
  for (let k = 0; k <= n; k++) {
    const p = cableAt(z, u0 + ((u1 - u0) * k) / n);
    xs[k] = p.x;
    ys[k] = p.y;
  }
  return { xs, ys, ox: xs.slice(), oy: ys.slice(), link: len / n, pinned, still: 0 };
}

/** One step: each point carries on, falls, is pulled back to its links' lengths, and stops short of the land. Returns the most any point moved, px. */
export function stepChain(c: Chain, t: Uint8Array): number {
  const n = c.xs.length;
  const first = c.pinned ? 1 : 0;
  for (let i = first; i < n; i++) {
    const x = c.xs[i];
    const y = c.ys[i];
    c.xs[i] = x + (x - c.ox[i]) * DAMP;
    c.ys[i] = y + (y - c.oy[i]) * DAMP + FALL;
    c.ox[i] = x;
    c.oy[i] = y;
  }
  for (let pass = 0; pass < PASSES; pass++) {
    for (let i = 0; i < n - 1; i++) {
      const dx = c.xs[i + 1] - c.xs[i];
      const dy = c.ys[i + 1] - c.ys[i];
      const d = Math.hypot(dx, dy);
      if (d === 0) continue;
      const k = (d - c.link) / d;
      if (i === 0 && c.pinned) {
        c.xs[1] -= dx * k;
        c.ys[1] -= dy * k;
      } else {
        c.xs[i] += (dx * k) / 2;
        c.ys[i] += (dy * k) / 2;
        c.xs[i + 1] -= (dx * k) / 2;
        c.ys[i + 1] -= (dy * k) / 2;
      }
    }
  }
  let moved = 0;
  for (let i = first; i < n; i++) {
    // Into the land, a point stays where it was: the cable comes to rest on the ground with no slide.
    if (solidAt(t, Math.round(c.xs[i]), Math.round(c.ys[i]))) {
      c.xs[i] = c.ox[i];
      c.ys[i] = c.oy[i];
    }
    moved = Math.max(moved, Math.abs(c.xs[i] - c.ox[i]) + Math.abs(c.ys[i] - c.oy[i]));
  }
  c.still = moved < STILL ? c.still + 1 : 0;
  return moved;
}

/** A blast swings a chain's points near it away from its centre, harder the nearer. */
export function kickChain(c: Chain, x: number, y: number, r: number) {
  const reach = r * KICK_REACH;
  for (let i = c.pinned ? 1 : 0; i < c.xs.length; i++) {
    const dx = c.xs[i] - x;
    const dy = c.ys[i] - y;
    const d = Math.hypot(dx, dy);
    if (d >= reach || d === 0) continue;
    const push = (KICK * (1 - d / reach)) / d;
    c.ox[i] -= dx * push;
    c.oy[i] -= dy * push;
  }
  c.still = 0;
}

/** Rock under a post's foot, tested as the rules test it when a blast lands. */
function footed(t: Uint8Array, x: number, foot: number) {
  for (let dx = -2; dx <= 2; dx++) for (let dy = 0; dy < 4; dy++) if (solidAt(t, x + dx, foot + dy)) return true;
  return false;
}

export interface ZipHost {
  scene: Phaser.Scene;
  world: <T extends Phaser.GameObjects.GameObject>(obj: T) => T;
  paintable: (prefix: string, width: number, height: number) => Phaser.Textures.CanvasTexture;
  /** Texture px per world px for small pictures at the current zoom. */
  res: () => number;
  reduced: boolean;
  /** Where a slug's picture is drawn this frame, world px, or null when it is not. */
  drawnAt: (slug: number) => { x: number; y: number } | null;
}

interface PostView {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  toward: 1 | -1;
  standing: boolean;
  /** When it began to tumble, or null while standing or once gone. */
  fellAt: number | null;
}

interface LinkedChain {
  chain: Chain;
  /** The post holding it: 0 the left, 1 the right. */
  post: 0 | 1;
  segs: Phaser.GameObjects.TileSprite[];
}

interface ZipView {
  posts: [PostView, PostView];
  whole: Phaser.GameObjects.TileSprite[];
  chains: LinkedChain[];
  /** 'whole', or the cut and the fallen posts the chains were built for. */
  shape: string;
}

export class ZipLayer {
  private host: ZipHost;
  private views: ZipView[] = [];
  /** The seed and cables the views were built for. */
  private built = '';
  private postTex: [Phaser.Textures.CanvasTexture, Phaser.Textures.CanvasTexture];
  private postRes = 0;
  private trolleyTex: Phaser.Textures.CanvasTexture;
  private trolley: Phaser.GameObjects.Image;
  private trolleyDrawn = '';
  private acc = 0;

  constructor(host: ZipHost) {
    this.host = host;
    const cable = host.scene.textures.createCanvas('slugzip', CABLE_RUN * CABLE_RES, 3 * CABLE_RES)!;
    cable.context.setTransform(CABLE_RES, 0, 0, CABLE_RES, 0, 1.5 * CABLE_RES);
    drawZipCable(cable.context, -4, 0, CABLE_RUN + 4, 0);
    cable.refresh();
    this.postTex = [host.paintable('zippost', POST_W, POST_H), host.paintable('zippost', POST_W, POST_H)];
    this.trolleyTex = host.paintable('ziptrolley', TROLLEY_W, TROLLEY_H);
    this.trolley = host.world(host.scene.add.image(0, 0, this.trolleyTex)
      .setOrigin(TROLLEY_EYE_X / TROLLEY_W, TROLLEY_EYE_Y / TROLLEY_H).setDepth(TROLLEY_DEPTH).setVisible(false));
  }

  /** A blast sets resting chains moving again: it may have swung them, or taken the ground they lay on. */
  event(e: SlugEvent) {
    if (e.k !== 'boom') return;
    for (const view of this.views) {
      for (const { chain } of view.chains) {
        if (this.host.reduced) chain.still = 0;
        else kickChain(chain, e.x, e.y, e.r);
      }
    }
  }

  draw(s: SlugsState, now: number, dt: number) {
    const sig = `${s.seed}|${s.zips.map((z) => `${z.ax},${z.ay},${z.bx},${z.by},${z.sag}`).join(';')}`;
    if (sig !== this.built) this.build(s, sig);
    this.paintPosts();
    this.acc = Math.min(this.acc + dt, STEP_MS * STEPS_MOST);
    let steps = 0;
    for (; this.acc >= STEP_MS; this.acc -= STEP_MS) steps++;
    s.zips.forEach((z, i) => this.drawZip(s, z, this.views[i], now, steps));
    this.drawTrolley(s);
  }

  private build(s: SlugsState, sig: string) {
    for (const view of this.views) {
      for (const post of view.posts) post.img.destroy();
      for (const seg of view.whole) seg.destroy();
      for (const c of view.chains) for (const seg of c.segs) seg.destroy();
    }
    this.built = sig;
    this.views = s.zips.map((z) => {
      const post = (x: number, y: number, toward: 1 | -1, tex: Phaser.Textures.CanvasTexture): PostView => ({
        img: this.host.world(this.host.scene.add.image(x, y, tex)
          .setOrigin(POST_EYE_X / POST_W, POST_EYE_Y / POST_H).setDepth(POST_DEPTH)),
        x, y, toward, standing: true, fellAt: null,
      });
      const n = Math.ceil((z.bx - z.ax) / WHOLE_RUN);
      const pts = Array.from({ length: n + 1 }, (_, k) => cableAt(z, k / n));
      const whole = pts.slice(1).map((b, k) => this.strip(pts[k].x, pts[k].y, b.x, b.y));
      return { posts: [post(z.ax, z.ay, 1, this.postTex[0]), post(z.bx, z.by, -1, this.postTex[1])], whole, chains: [], shape: 'whole' };
    });
  }

  private strip(x0: number, y0: number, x1: number, y1: number, seg?: Phaser.GameObjects.TileSprite) {
    const s = seg ?? this.host.world(this.host.scene.add.tileSprite(0, 0, 1, 3, 'slugzip')
      .setDepth(CABLE_DEPTH).setTileScale(1 / CABLE_RES, 1 / CABLE_RES));
    // The origin is set after the size: Phaser keeps the origin's place in px, so set before, a strip turns about where its middle was.
    return s.setSize(Math.hypot(x1 - x0, y1 - y0) + OVERLAP, 3).setOrigin(0, 0.5).setPosition(x0, y0).setRotation(Math.atan2(y1 - y0, x1 - x0));
  }

  private paintPosts() {
    const res = this.host.res();
    if (res === this.postRes) return;
    this.postRes = res;
    this.postTex.forEach((tex, i) => {
      tex.setSize(POST_W * res, POST_H * res);
      const ctx = tex.context;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, tex.width, tex.height);
      ctx.setTransform(res, 0, 0, res, POST_EYE_X * res, POST_EYE_Y * res);
      drawZipPost(ctx, i === 0 ? 1 : -1);
      tex.refresh();
    });
    // An image places its origin by the size its texture had when it was made; the posts take the new size, or each
    // would stand off its eye by the change in resolution.
    for (const view of this.views) for (const post of view.posts) post.img.setSizeToFrame(post.img.texture.get()).updateDisplayOrigin();
    this.trolleyDrawn = '';
  }

  private drawZip(s: SlugsState, z: Zip, view: ZipView, now: number, steps: number) {
    const whole = zipWhole(z);
    // A post the rules have felled, or, once its cable is broken and the rules stop watching it, one whose ground a
    // later blast took.
    view.posts.forEach((post, i) => {
      const standing = (z.down & (1 << i)) === 0 && (whole || footed(s.terrain, post.x, post.y + ZIP_POST));
      if (post.standing && !standing) {
        post.fellAt = this.host.reduced ? null : now;
        for (const c of view.chains) if (c.post === i) c.chain.pinned = false;
      } else if (standing && !post.standing) post.fellAt = null;
      post.standing = standing;
      this.drawPost(post, now);
    });

    const shape = whole ? 'whole' : `${z.cut}|${z.down}`;
    if (shape !== view.shape) {
      view.shape = shape;
      for (const c of view.chains) for (const seg of c.segs) seg.destroy();
      view.chains = [];
      if (!whole) {
        // A cut leaves a length hanging from each post; a fallen post leaves the whole cable hanging from the other.
        const cut = z.cut >= 0 ? z.cut / ONE : z.down & 1 ? 0 : 1;
        if (cut > 0) view.chains.push({ chain: chainAlong(z, 0, cut, view.posts[0].standing), post: 0, segs: [] });
        if (cut < 1) view.chains.push({ chain: chainAlong(z, 1, cut, view.posts[1].standing), post: 1, segs: [] });
      }
    }
    for (const seg of view.whole) seg.setVisible(whole);

    for (const c of view.chains) {
      const { chain } = c;
      const gone = chain.ys.every((y) => y > H);
      if (this.host.reduced && !gone && chain.still < STILL_STEPS) {
        for (let k = 0; k < SETTLE_MOST && chain.still < STILL_STEPS && !chain.ys.every((y) => y > H); k++) stepChain(chain, s.terrain);
      } else if (!gone) {
        for (let k = 0; k < steps && chain.still < STILL_STEPS; k++) stepChain(chain, s.terrain);
      }
      this.drawChain(c);
    }
  }

  private drawPost(post: PostView, now: number) {
    if (post.standing) {
      // Sized every frame: the texture is redrawn larger as the camera zooms in.
      post.img.setVisible(true).setPosition(post.x, post.y).setRotation(0).setDisplaySize(POST_W, POST_H);
      return;
    }
    const t = post.fellAt === null ? TUMBLE_MS : now - post.fellAt;
    if (t >= TUMBLE_MS) {
      post.img.setVisible(false);
      return;
    }
    // Falling from rest as everything does, its top pulled over towards the cable that was tied to it.
    const steps = t / STEP_MS;
    post.img.setVisible(true).setDisplaySize(POST_W, POST_H)
      .setPosition(post.x + post.toward * steps * 0.4, post.y + 0.5 * FALL * steps * steps)
      .setRotation(post.toward * 1.6 * (t / TUMBLE_MS));
  }

  private drawChain(c: LinkedChain) {
    const { xs, ys } = c.chain;
    const n = xs.length - 1;
    while (c.segs.length < n) c.segs.push(this.strip(0, 0, 1, 0));
    for (let i = 0; i < n; i++) this.strip(xs[i], ys[i], xs[i + 1], ys[i + 1], c.segs[i]).setVisible(ys[i] <= H || ys[i + 1] <= H);
  }

  private drawTrolley(s: SlugsState) {
    const ride = s.ride;
    const at = ride && this.host.drawnAt(ride.slug);
    if (!ride || !at) {
      this.trolley.setVisible(false);
      return;
    }
    const z = s.zips[ride.zip];
    const u = Math.max(0, Math.min(1, (at.x - z.ax) / (z.bx - z.ax)));
    const p = cableAt(z, u);
    const slope = cableSlope(z, u);
    const blur = Math.abs(ride.v) > BLUR_SPEED;
    // Three spokes look the same a third of a turn on, so only that much of the turn is drawn.
    const spin = ((cableLength(z, 0, u) / WHEEL_R) % ((2 * Math.PI) / 3));
    const res = this.host.res();
    const sig = `${res}|${slope.toFixed(2)}|${blur ? 'blur' : spin.toFixed(2)}`;
    if (sig !== this.trolleyDrawn) {
      this.trolleyDrawn = sig;
      const tex = this.trolleyTex;
      if (tex.width !== TROLLEY_W * res) this.trolley.setSizeToFrame(tex.setSize(TROLLEY_W * res, TROLLEY_H * res).get()).updateDisplayOrigin();
      const ctx = tex.context;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, tex.width, tex.height);
      ctx.setTransform(res, 0, 0, res, TROLLEY_EYE_X * res, TROLLEY_EYE_Y * res);
      drawZipTrolley(ctx, slope, spin, blur);
      tex.refresh();
    }
    this.trolley.setVisible(true).setPosition(p.x, p.y).setDisplaySize(TROLLEY_W, TROLLEY_H);
  }
}
