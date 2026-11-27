// The battlefield, drawn with Phaser. It draws whatever state the driver hands
// back each frame and runs none of the rules: no Phaser physics, no timers that
// change the match. Everything here is picture: the ground's texture, the
// water, the slugs, what flies, and the camera.
//
// Three cameras share one canvas: one for the sky behind (fixed to the screen,
// with its own parallax), one for the world (zoomed and panned), and one for
// the labels and numbers over it, kept at screen size so they stay legible at
// any zoom.

import * as Phaser from 'phaser';
import {
  BOOST, CHARGE_TICKS, GIRDER_HALF, GIRDER_REACH, H, KEY, ONE, SLUG_HALF_H, TEAM_COLORS, TICK_MS, W, WEAPON, cosDeg, crateKind, placeSpot, px,
  shotEnd, shotRange, sinDeg, solidAt,
} from '../../slugsGameLogic';
import type { Act, Input, Slug, SlugEvent, SlugsState } from '../../slugsGameLogic';
import type { GameDriver } from './driver';
import {
  drawCrate, drawGravestone, drawHeldWeapon, dugColours, drawJetpack, drawObject, drawParachute, mineLit, drawProjectileBody, drawRope, drawSlug, LAND_RES, paintBackground, paintTerrain, repaintArea, rewindTerrain,
  projectileFlickers, projectileSpin,
} from './slugArt';
import type { SlugPose } from './slugArt';
import { drawWaterInto, skyDrift, waterLook } from './slugBackdrop';
import type { WaterLook } from './slugBackdrop';
import { SlugFx, groundTilt, leanedPicture, prefersReducedMotion } from './slugFx';
import { LandLayer } from './slugLand';
import { REPLAY_RATE, noteFrame, planReplay, startLog, stepReplay } from './slugsReplay';
import type { Replay, TurnLog } from './slugsReplay';
import { THEMES } from './slugThemes';
import type { ThemeId } from './slugThemes';
import { drawMotes, easeWind, stepMotes } from './slugWind';
import type { Mote } from './slugWind';
import { ZipLayer } from './slugZipLayer';

export interface SceneHooks {
  driver: GameDriver;
  theme: ThemeId;
  /** What this machine is pressing, read once a frame. */
  input(): Input;
  /** Called after a frame that ran at least one tick, so the screen can drop presses it has delivered. */
  delivered(): void;
  /** A one-off action from the battlefield itself: a target clicked on the map. */
  act(act: Act): void;
  /** Right-click on the battlefield. */
  menu(): void;
  frame(state: SlugsState): void;
  /**
   * CSS px of the canvas the screen's own HUD covers along the top and bottom edges, 0 where nothing does.
   * Read every frame; labels and the followed slug are kept out of it.
   */
  hudCover(): { top: number; bottom: number };
  /**
   * Whether a shot that kills or hurts badly is shown again before the tally. Read every
   * frame. Left out, it never is: a replay holds this screen's match still while it plays,
   * which only a match on this machine can do.
   */
  replays?(): boolean;
}

export interface Battlefield {
  /** Frames drawn in the last second, as Phaser counts them. */
  fps(): number;
  zoomBy(factor: number): void;
  /** CSS px per world px now. */
  zoom(): number;
  destroy(): void;
}

/** Mean frame time (ms) over SLOW_SPAN (ms) above which a span counts as slow; SLOW_RUNS slow spans in a row drop the picture to its cheaper tier. */
const SLOW_FRAME_MS = 22;
const SLOW_SPAN = 2000;
const SLOW_RUNS = 2;
/** World px of empty space the camera may show left and right of the map, and of sky above it for high shots. */
const SIDE = 160;
const SKY = 520;
/** World px of ground and sky between the HUD strips at the playing zoom: see fitView. */
const PLAY_SPAN = 300;
/** Radians a slug's picture leans at most with the ground under it. */
const LEAN_MOST = (15 * Math.PI) / 180;
/** Seconds the camera takes, roughly, to settle on a new goal. */
const CAMERA_SETTLE = 0.25;
/** World px a second the camera is ever taken to be moving at: about a shell's top speed. */
const CAMERA_PACE = 1500;
/** ms a slug takes to turn round, and to spring back from a landing's squash. */
const TURN_MS = 110;
/** The laser sight's line. It is drawn over a dark line, which keeps it readable against the red team and red ground. */
const LASER = 0xd8433a;
const SQUASH_MS = 180;
/** A hat per team, in team-colour order, so a team reads by its heads as well as its neck bands. */
const TEAM_HATS = ['beanie', 'tophat', 'leaf', 'miner', 'bandana', 'acorn'];
/** World px a slug's picture is drawn in, centred on its middle: room for a raised weapon and a hat. */
const CELL = 48;
/** Slug textures are taller than wide, the slug's centre FEET px down, to leave room for a parachute overhead. */
const TALL = 64;
const FEET = 40;
/** World px of rope per repeat of the rope strip texture, and texture px per world px in it. */
const ROPE_RUN = 64;
const ROPE_RES = 8;

const hex = (css: string) => parseInt(css.slice(1), 16);

/** What a slug wears over its pose: a jetpack, lit or not, or a parachute. */
type Gear = 'none' | 'jet' | 'chute';

interface Grave {
  x: number;
  y: number;
  vy: number;
  img: Phaser.GameObjects.Image;
  tex: Phaser.Textures.CanvasTexture;
}

interface Sinking {
  x: number;
  y: number;
  born: number;
  img: Phaser.GameObjects.Image;
  tex: Phaser.Textures.CanvasTexture;
  pose: SlugPose;
}

interface Popup {
  text: Phaser.GameObjects.Text;
  x: number;
  y: number;
  born: number;
}

interface SlugView {
  img: Phaser.GameObjects.Image;
  tex: Phaser.Textures.CanvasTexture;
  label: Phaser.GameObjects.Text;
  labelText: string;
  drawn: string;
  hurtAt: number;
  /** Radians the picture leans to follow the ground under it, eased toward groundTilt. */
  tilt: number;
  /** Where the picture is drawn, in world px, and where it set off from when the rules last moved the slug. */
  drawX: number;
  drawY: number;
  fromX: number;
  fromY: number;
  /** The way the picture faces, which trails the rules' facing through a short turn starting at turnAt. */
  facing: 1 | -1;
  turnAt: number;
  /** Squash (+) or stretch (-) given at squashAt, as a share of height, on landing and take-off. */
  squash: number;
  squashAt: number;
  /** The slug's mode and vertical speed when last drawn, to tell a landing from a take-off. */
  mode: Slug['mode'];
  vy: number;
  kickAt: number;
}

class SlugsScene extends Phaser.Scene {
  private hooks: SceneHooks;
  private dpr: number;
  private lowerRes: () => void;
  /** Dropped to once, for good, when frames stay slow: see watchPace. */
  private lean = false;
  /** prefers-reduced-motion, read once when the match starts. */
  private reduced = prefersReducedMotion();
  private zips!: ZipLayer;
  private pace = { from: -1, frames: 0, after: -1, slow: 0 };
  private bgCam!: Phaser.Cameras.Scene2D.Camera;
  private worldCam!: Phaser.Cameras.Scene2D.Camera;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;

  // The camera, kept here rather than in Phaser's follow: its centre in world px and its canvas px per world px.
  private cx = W / 2;
  private cy = H / 2;
  private zoom = 1;
  private userZoom = 0;
  /** The zoom the first turn eases in to after the opening look at the whole battle; 0 once done or the player zooms. */
  private playZoom = 0;
  private zoomGoal = 0;
  /** The active slug as it stood when its turn got ready; the arrow over it stays until any of this changes. */
  private poised = '';
  /** Set by a drag; the camera stops following until the next shot or turn. */
  private manual = false;
  /** The last thing the camera followed and when; sx, sy are where the active slug stood then. */
  private boomAt = { x: 0, y: 0, t: -1e9, sx: 0, sy: 0 };
  /** The camera's speed in world px a second, for glideCamera. */
  private camVx = 0;
  private camVy = 0;
  /** When the opening overview was first drawn; 0 until then. */
  private overviewAt = 0;

  private bgLayers: Phaser.GameObjects.TileSprite[] = [];
  private bgSize = '';
  private land!: LandLayer;
  private terrainRef: Uint8Array | null = null;
  private terrainSeed = -1;
  private waterBack!: Phaser.GameObjects.Graphics;
  private waterFront!: Phaser.GameObjects.Graphics;
  private waterShown = 0;
  private windShown = 0;
  private cloudShift = 0;
  private motes: Mote[] = [];
  private motePen!: Phaser.GameObjects.Graphics;
  private look: WaterLook;
  private overlay!: Phaser.GameObjects.Graphics;
  private ropeSegs: Phaser.GameObjects.TileSprite[] = [];

  private slugs: SlugView[] = [];
  /** The rules' tick when the slugs were last drawn, and the frame (ms) its glide is timed from: see drawSlugs. */
  private seenTick = -1;
  private tickSeenAt = 0;
  private slugFrameAt = 0;
  /** Whether the slugs' labels are folded to one small line: see drawSlugs. */
  private smallLabels = false;
  private projs: { img: Phaser.GameObjects.Image; tex: Phaser.Textures.CanvasTexture; fuse: Phaser.GameObjects.Text; drawn: string }[] = [];
  /** Where each projectile is drawn, by id, gliding over a tick the way slugs do (see drawSlugs). */
  private projGlide = new Map<number, { drawX: number; drawY: number; fromX: number; fromY: number }>();
  private projTick = -1;
  private projTickAt = 0;
  private projFrameAt = 0;
  private objViews: { img: Phaser.GameObjects.Image; tex: Phaser.Textures.CanvasTexture; drawn: string }[] = [];
  private graves: Grave[] = [];
  private sinking: Sinking[] = [];
  private popups: Popup[] = [];
  private fx!: SlugFx;
  private nextKey = 0;

  private state!: SlugsState;
  private pointer: { x: number; y: number } | null = null;
  private unlisten: (() => void)[] = [];
  /** Shut down by the screen. Phaser runs create() only once its own textures have loaded, which can be after that. */
  private shut = false;
  /** This turn so far, kept while replays are on, and whether its tally has been looked at. */
  private log: TurnLog | null = null;
  private planned = false;
  /** The driver's own queue of acts, mirrored so the log knows which tick each act went to. */
  private acts: Act[] = [];
  private replay: {
    r: Replay;
    live: SlugsState;
    liveLand: LandLayer;
    land: LandLayer;
    marker: Phaser.GameObjects.Text;
    /** Match ticks due but not yet run. */
    owed: number;
    skip: boolean;
  } | null = null;

  constructor(hooks: SceneHooks, dpr: number, lowerRes: () => void) {
    super({ key: 'slugs' });
    this.hooks = hooks;
    this.dpr = dpr;
    this.lowerRes = lowerRes;
    this.look = waterLook(hooks.theme);
  }

  create() {
    const { width, height } = this.scale;
    this.bgCam = this.cameras.main;
    this.worldCam = this.cameras.add(0, 0, width, height);
    this.uiCam = this.cameras.add(0, 0, width, height);

    this.makeRopeTexture();
    this.state = this.hooks.driver.tick(performance.now(), { keys: 0 });
    this.buildTerrain(this.state);
    if (this.replaysOn()) this.log = startLog(this.state);

    this.waterBack = this.world(this.add.graphics().setDepth(1));
    this.waterFront = this.world(this.add.graphics().setDepth(60));
    this.waterShown = this.state.water;
    this.overlay = this.world(this.add.graphics().setDepth(70));
    // Over the slugs and the water's face, under the aim and labels.
    this.motePen = this.world(this.add.graphics().setDepth(65));
    this.windShown = this.windNow();
    this.fx = new SlugFx({
      scene: this, theme: this.hooks.theme, world: (obj) => this.world(obj), reduced: this.reduced,
      shake: (ms, intensity) => this.worldCam.shake(ms, intensity, true),
      leanOf: (slug) => this.slugs[slug]?.tilt ?? 0,
      res: () => this.wantedRes(),
      projAt: (id) => this.projDrawn(id),
    });
    this.zips = new ZipLayer({
      scene: this, world: (obj) => this.world(obj), paintable: (prefix, w, h) => this.paintable(prefix, w, h),
      res: () => this.wantedRes(), reduced: this.reduced,
      drawnAt: (id) => (this.slugs[id] ? { x: this.slugs[id].drawX, y: this.slugs[id].drawY } : null),
    });

    this.fitView();
    this.listen();
  }

  // --- Which camera draws what ---

  private world<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.bgCam.ignore(obj);
    this.uiCam.ignore(obj);
    return obj;
  }

  private ui<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.bgCam.ignore(obj);
    this.worldCam.ignore(obj);
    return obj;
  }

  private sky<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.worldCam.ignore(obj);
    this.uiCam.ignore(obj);
    return obj;
  }

  private key(prefix: string) {
    return `${prefix}${this.nextKey++}`;
  }

  /**
   * A canvas texture for a picture repainted many times a second. Phaser's createCanvas
   * asks for willReadFrequently, which keeps the canvas in main memory, and every upload
   * of one then cost 2 to 6 times a GPU-backed canvas's (measured at 6x CPU throttle: 0.58
   * against 0.25 ms a slug at 1 texture px per world px, 1.95 against 0.31 at 4). The
   * context made here first is the one Phaser is handed back; nothing reads these back.
   */
  private paintable(prefix: string, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d');
    return this.textures.addCanvas(this.key(prefix), canvas)!;
  }

  /**
   * One run of rope, painted once: the rope is drawn as tiled strips laid along each
   * straight stretch, so a swinging rope costs no repainting. The twist pitch divides
   * ROPE_RUN, so the strip tiles without a seam.
   */
  private makeRopeTexture() {
    const tex = this.textures.createCanvas('slugrope', ROPE_RUN * ROPE_RES, 3 * ROPE_RES)!;
    tex.context.setTransform(ROPE_RES, 0, 0, ROPE_RES, 0, 1.5 * ROPE_RES);
    drawRope(tex.context, -4, 0, ROPE_RUN + 4, 0);
    tex.refresh();
  }

  private buildTerrain(state: SlugsState) {
    // The same match run again from the start keeps its burns; a new map starts clean.
    const before = this.land && state.seed === this.terrainSeed ? this.land.canvas : undefined;
    // The lean tier paints a quarter of the px; a match already painted keeps its canvas.
    const k = this.lean ? 1 : LAND_RES;
    const canvas = paintTerrain(state.terrain, W, H, this.hooks.theme, state.seed, before, k);
    this.land?.destroy();
    this.terrainSeed = state.seed;
    this.land = new LandLayer(this, canvas, k, (img) => this.world(img), () => this.key('terrain'));
    this.terrainRef = state.terrain;
  }

  // --- Sizes and the camera ---

  /** Called by the screen when the canvas changes size. */
  resizeTo(width: number, height: number) {
    this.scale.resize(width, height);
    for (const cam of [this.bgCam, this.worldCam, this.uiCam]) cam.setSize(width, height);
    this.fitView();
  }

  private minZoom() {
    const { width, height } = this.scale;
    return Math.min(width / (W + SIDE * 2), height / (H + 40));
  }

  private fitView() {
    const { width, height } = this.scale;
    const size = `${width}x${height}`;
    if (size !== this.bgSize) {
      this.bgSize = size;
      this.bgLayers.forEach((layer) => {
        const tex = layer.texture;
        layer.destroy();
        this.textures.remove(tex);
      });
      this.bgLayers = paintBackground(this.hooks.theme, width, height).map((canvas, i) =>
        this.sky(this.add.tileSprite(0, 0, width, height, this.textures.addCanvas(this.key('sky'), canvas)!).setOrigin(0, 0).setDepth(i))
      );
    }
    // The match opens on the whole battle, clear of the HUD; the first turn then eases in to a playing zoom where a
    // slug, stalks and all, stands about a twentieth of the screen high, as a worm does in Worms; still no less than
    // 640 px of ground across, Worms' own view, to aim over. Later the player's own zoom is kept, within what the new
    // size allows.
    if (this.userZoom === 0) {
      const cover = this.hudCover();
      this.playZoom = Math.max(this.minZoom(), Math.min(4 * this.dpr, (height - cover.top - cover.bottom) / PLAY_SPAN, width / 640));
      this.overviewAt = 0;
      this.setZoom(Math.min(width / (W + 40), (height - cover.top - cover.bottom) / (H + 40)));
      this.cx = W / 2;
      this.cy = H / 2 + (cover.bottom - cover.top) / 2 / this.zoom;
      this.manual = true;
      return;
    }
    this.setZoom(this.userZoom * this.dpr);
  }

  private setZoom(z: number) {
    this.zoom = Math.max(this.minZoom(), Math.min(4 * this.dpr, z));
    this.userZoom = this.zoom / this.dpr;
  }

  viewZoom() {
    return this.zoom / this.dpr;
  }

  zoomBy(factor: number, sx = this.scale.width / 2, sy = this.scale.height / 2) {
    this.playZoom = 0;
    this.zoomGoal = 0;
    const before = this.toWorld(sx, sy);
    this.setZoom(this.zoom * factor);
    const after = this.toWorld(sx, sy);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.clampCamera();
  }

  private toWorld(sx: number, sy: number) {
    return { x: (sx - this.scale.width / 2) / this.zoom + this.cx, y: (sy - this.scale.height / 2) / this.zoom + this.cy };
  }

  private toScreen(wx: number, wy: number) {
    return { x: (wx - this.cx) * this.zoom + this.scale.width / 2, y: (wy - this.cy) * this.zoom + this.scale.height / 2 };
  }

  /** Canvas px the HUD covers at the top and bottom. */
  private hudCover(): { top: number; bottom: number } {
    const { top, bottom } = this.hooks.hudCover();
    return { top: top * this.dpr, bottom: bottom * this.dpr };
  }

  private clampCamera() {
    const vw = this.scale.width / this.zoom;
    const vh = this.scale.height / this.zoom;
    const left = -SIDE;
    const right = W + SIDE;
    this.cx = vw >= right - left ? W / 2 : Math.max(left + vw / 2, Math.min(right - vw / 2, this.cx));
    const cover = this.hudCover();
    // Room to bring the lowest ground up out from behind the team bars, over more water, and the highest sky out from under the top bar.
    const top = -SKY - cover.top / this.zoom;
    const bottom = H + 20 + cover.bottom / this.zoom;
    this.cy = vh >= bottom - top ? bottom - vh / 2 : Math.max(top + vh / 2, Math.min(bottom - vh / 2, this.cy));
  }

  private activeTarget() {
    const slug = this.state.slugs[this.state.active];
    return slug ? { x: px(slug.x), y: px(slug.y) } : { x: W / 2, y: H / 2 };
  }

  /**
   * What the camera should be looking at: something flying, then a slug thrown about, then whichever of those came
   * to rest last (a blast, or where the thrown slug landed) while its smoke clears, then whoever's turn it is. The
   * hold is on the last thing followed, not always the blast, so a shot is one sweep out and one back.
   */
  private cameraGoal(now: number): { x: number; y: number; fast: boolean } {
    const s = this.state;
    // The slug being placed waits hidden at a seat nobody chose, so the camera stays where the player put it.
    if (s.phase === 'place') return { x: this.cx, y: this.cy, fast: false };
    const follow = (x: number, y: number) => {
      const at = this.activeTarget();
      this.boomAt = { x, y, t: now, sx: at.x, sy: at.y };
      return { x, y, fast: true };
    };
    if (s.projs.length) {
      let x = 0;
      let y = 0;
      for (const p of s.projs) {
        x += px(p.x);
        y += px(p.y);
      }
      return follow(x / s.projs.length, y / s.projs.length);
    }
    const flying = s.slugs.find((slug) => slug.alive && slug.mode === 'air' && slug.blown);
    if (flying) return follow(px(flying.x), px(flying.y));
    const held = { x: this.boomAt.x, y: this.boomAt.y, fast: false };
    if (now - this.boomAt.t < 1200) return held;
    if (s.phase === 'over') {
      // The last shooter may have drowned or be on the losing side: the end looks at the winners, or stays put on a draw.
      const active = s.slugs[s.active];
      const won = active?.alive && active.team === s.winner ? active : s.slugs.find((slug) => slug.alive && slug.team === s.winner);
      return won ? { x: px(won.x), y: px(won.y), fast: false } : held;
    }
    // Once the shot is spent nobody steers until the next turn, so the camera stays on the blast and makes one move,
    // to the next slug, instead of a trip back to the shooter first. In the retreat it goes back only to a shooter
    // who is actually running.
    const at = this.activeTarget();
    const ran = Math.abs(at.x - this.boomAt.sx) + Math.abs(at.y - this.boomAt.sy) > 6;
    if (s.phase === 'settle' || s.phase === 'tally' || s.phase === 'deaths' || (s.phase === 'retreat' && !ran)) return held;
    return { ...at, fast: false };
  }

  /** One critically damped step of the camera toward (tx, ty): no overshoot, and no jolt when the goal jumps. */
  private glideCamera(tx: number, ty: number, dt: number) {
    const w = 2 / CAMERA_SETTLE;
    const step = (w * Math.min(dt, 100)) / 1000;
    const decay = 1 / (1 + step + 0.48 * step * step + 0.235 * step * step * step);
    const ease = (at: number, to: number, v: number): [number, number] => {
      const off = at - to;
      const pull = ((v + w * off) * Math.min(dt, 100)) / 1000;
      return [to + (off + pull) * decay, (v - w * pull) * decay];
    };
    [this.cx, this.camVx] = ease(this.cx, tx, this.camVx);
    [this.cy, this.camVy] = ease(this.cy, ty, this.camVy);
  }

  private moveCamera(now: number, dt: number) {
    // The overview is a glance at the whole battle: the first turn's zoom starts once it has had a second and a half,
    // or as soon as the turn does.
    if (this.playZoom && !this.overviewAt) this.overviewAt = now;
    // Placing slugs is done on the overview, so the glance starts when the first turn is made ready.
    if (this.state.phase === 'place') this.overviewAt = now;
    if (this.playZoom && (this.state.phase !== 'ready' || now - this.overviewAt > 1500) && this.state.phase !== 'place') {
      this.zoomGoal = this.playZoom;
      this.playZoom = 0;
      this.manual = false;
    }
    if (this.zoomGoal) {
      // A goal setZoom would clamp could never be reached, and would hold the zoom at the clamp every frame.
      this.zoomGoal = Math.max(this.minZoom(), Math.min(4 * this.dpr, this.zoomGoal));
      // Zoomed about the middle of the screen while the follow below brings the slug into view.
      const z = this.zoom + (this.zoomGoal - this.zoom) * (1 - Math.exp(-dt / 250));
      this.setZoom(Math.abs(this.zoomGoal - z) < 0.002 ? this.zoomGoal : z);
      if (this.zoom === this.zoomGoal) this.zoomGoal = 0;
    }
    if (!this.manual) {
      const goal = this.cameraGoal(now);
      const vw = this.scale.width / this.zoom;
      const vh = this.scale.height / this.zoom;
      // A slug walking about the middle of the view leaves the camera still; it moves once they near an edge.
      const slackX = goal.fast ? vw * 0.12 : vw * 0.22;
      const slackY = goal.fast ? vh * 0.12 : vh * 0.2;
      // Never let the goal settle behind the HUD: the slack ends with the slug's feet clear of the bottom strip and
      // its label clear of the top one.
      const cover = this.hudCover();
      const slackDown = Math.max(0, Math.min(slackY, vh / 2 - cover.bottom / this.zoom - 16));
      const slackUp = Math.max(0, Math.min(slackY, vh / 2 - cover.top / this.zoom - 40));
      const tx = goal.x < this.cx - slackX ? goal.x + slackX : goal.x > this.cx + slackX ? goal.x - slackX : this.cx;
      const ty = goal.y < this.cy - slackUp ? goal.y + slackUp : goal.y > this.cy + slackDown ? goal.y - slackDown : this.cy;
      const fromX = this.cx;
      const fromY = this.cy;
      this.glideCamera(tx, ty, dt);
      // However fast the goal moves (a jetpack climbs 250 px a second, a shell three times that), the glide never lets
      // it leave the view: zoomed in, its lag alone would be more than half a screen.
      const reachX = Math.max(0, vw / 2 - 24);
      const above = Math.max(0, vh / 2 - (cover.top + 40 * this.dpr) / this.zoom - 12);
      const below = Math.max(0, vh / 2 - cover.bottom / this.zoom - 16);
      const glidedX = this.cx;
      const glidedY = this.cy;
      this.cx = Math.max(goal.x - reachX, Math.min(goal.x + reachX, this.cx));
      this.cy = Math.max(goal.y - below, Math.min(goal.y + above, this.cy));
      // Held at the edge, the camera moves at the goal's pace; its glide speed must become that pace, or letting go
      // lurches. Capped, so a goal that jumps (an air strike coming in from off the map) is not taken as a speed.
      const step = Math.max(1, Math.min(dt, 100)) / 1000;
      const pace = (moved: number) => Math.max(-CAMERA_PACE, Math.min(CAMERA_PACE, moved / step));
      if (this.cx !== glidedX) this.camVx = pace(this.cx - fromX);
      if (this.cy !== glidedY) this.camVy = pace(this.cy - fromY);
    } else {
      this.camVx = 0;
      this.camVy = 0;
    }
    this.clampCamera();
    const cam = this.worldCam;
    cam.setZoom(this.zoom);
    cam.setScroll(this.cx - this.scale.width / 2, this.cy - this.scale.height / 2);
  }

  // --- Pointer: drag to pan, wheel or pinch to zoom, click to target, right-click for weapons ---

  private listen() {
    if (this.shut) return;
    const canvas = this.game.canvas;
    const down = new Map<number, { x: number; y: number }>();
    let moved = false;
    let pinch = 0;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * this.scale.width, y: ((e.clientY - r.top) / r.height) * this.scale.height };
    };
    const spread = () => {
      const [a, b] = [...down.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const onDown = (e: PointerEvent) => {
      if (this.replay) {
        this.replay.skip = true;
        return;
      }
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      down.set(e.pointerId, local(e));
      moved = false;
      if (down.size === 2) pinch = spread();
    };
    const onMove = (e: PointerEvent) => {
      const at = local(e);
      this.pointer = at;
      const was = down.get(e.pointerId);
      if (!was) return;
      if (down.size === 2) {
        down.set(e.pointerId, at);
        const now = spread();
        const mid = [...down.values()].reduce((m, p) => ({ x: m.x + p.x / 2, y: m.y + p.y / 2 }), { x: 0, y: 0 });
        if (pinch > 0) this.zoomBy(now / pinch, mid.x, mid.y);
        pinch = now;
        moved = true;
        return;
      }
      const dx = at.x - was.x;
      const dy = at.y - was.y;
      if (!moved && Math.hypot(dx, dy) < 6 * this.dpr) return;
      moved = true;
      this.manual = true;
      this.cx -= dx / this.zoom;
      this.cy -= dy / this.zoom;
      this.clampCamera();
      down.set(e.pointerId, at);
    };
    const onUp = (e: PointerEvent) => {
      const was = down.get(e.pointerId);
      down.delete(e.pointerId);
      if (down.size < 2) pinch = 0;
      if (!was || moved || e.type === 'pointercancel') return;
      const s = this.state;
      if (s.phase === 'place') {
        if (!this.hooks.driver.mine.includes(s.activeTeam)) return;
        const w = this.toWorld(was.x, was.y);
        this.hooks.act({ t: 'target', x: Math.round(w.x), y: Math.round(w.y) });
        return;
      }
      const use = WEAPON[s.weapon].use;
      if ((use !== 'target' && use !== 'mark') || !this.hooks.driver.mine.includes(s.activeTeam) || s.phase !== 'turn') return;
      const w = this.toWorld(was.x, was.y);
      this.hooks.act({ t: 'target', x: Math.round(w.x), y: Math.round(w.y) });
    };
    const onLeave = () => {
      this.pointer = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const at = local(e);
      // Pinch on a trackpad arrives as a wheel with ctrl held, in smaller steps.
      this.zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), at.x, at.y);
    };
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      this.hooks.menu();
    };
    const onKey = () => {
      if (this.replay) this.replay.skip = true;
    };
    window.addEventListener('keydown', onKey, true);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onMenu);
    this.unlisten.push(() => {
      window.removeEventListener('keydown', onKey, true);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onMenu);
    });
  }

  shutdownListeners() {
    this.shut = true;
    this.unlisten.forEach((off) => off());
    this.unlisten = [];
  }

  // --- The frame ---

  update(time: number, delta: number) {
    if (this.replay) {
      this.replayFrame(time, delta);
      return;
    }
    const before = this.state.tick;
    const input = this.hooks.input();
    this.state = this.hooks.driver.tick(performance.now(), input);
    const ran = this.state.tick - before;
    if (ran) this.hooks.delivered();
    if (input.act) this.acts.push(input.act);
    const given = Array.from({ length: ran }, () => ({ keys: input.keys, act: this.acts.shift() }));
    this.draw(time, delta);
    this.hooks.frame(this.state);
    this.watchTurn(given);
  }

  private draw(time: number, delta: number) {
    const s = this.state;
    if (s.terrain !== this.terrainRef) this.buildTerrain(s);
    this.handleEvents(s.events, time);
    this.watchPace(time, delta);
    this.moveCamera(time, delta);
    this.land.show(this.zoom);
    // Before the effects, so trails are laid where the shell is drawn rather than a tick ahead of it.
    this.glideProjectiles(time);
    this.fx.update(s, time, delta);
    this.drawWind(delta);
    if (!this.lean) this.drawSky();
    this.drawWater(time, delta);
    this.drawSlugs(time, delta);
    // After the slugs, so a rider's pulley is drawn where its picture glided to this frame.
    this.zips.draw(s, time, delta);
    this.drawGraves(time, delta);
    this.drawObjects(time);
    this.drawProjectiles(time);
    this.drawOverlay();
    this.drawPopups(time);
  }

  // --- The instant replay ---

  private replaysOn() {
    // A replay is a burst of motion the player did not ask for, and costs a repaint of the ground.
    return !this.lean && !this.reduced && (this.hooks.replays?.() ?? false);
  }

  private watchTurn(given: Input[]) {
    const s = this.state;
    if (!this.replaysOn()) {
      this.log = null;
      return;
    }
    if (s.events.some((e) => e.k === 'turn')) {
      this.log = startLog(s);
      this.planned = false;
      return;
    }
    if (!this.log) return;
    noteFrame(this.log, s, given);
    if (this.planned || s.phase !== 'tally') return;
    this.planned = true;
    const r = planReplay(this.log, s);
    this.log = null;
    if (r) this.startReplay(r);
  }

  /**
   * The live ground is hidden, not repainted: it is the match's picture, burns and all,
   * and comes back as it was. The replay gets its own, a copy of it with the land the
   * turn cut put back, so no burn shows where a crater is still to come.
   */
  private startReplay(r: Replay) {
    const live = this.land;
    live.setVisible(false);
    const canvas = rewindTerrain(live.canvas, r.state.terrain, W, H, this.hooks.theme, r.state.seed);
    const land = new LandLayer(this, canvas, canvas.width / W, (img) => this.world(img), () => this.key('terrain'));
    const coarse = matchMedia('(pointer: coarse)').matches;
    const marker = this.ui(this.add.text(0, 0, coarse ? 'Replay. Tap to skip' : 'Replay. Any key skips', {
      fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: `${Math.round(13 * this.dpr)}px`,
      color: '#ffffff', stroke: '#111', strokeThickness: Math.round(3 * this.dpr),
    }).setOrigin(0.5, 0).setDepth(30));
    this.replay = { r, live: this.state, liveLand: live, land, marker, owed: 0, skip: false };
    this.land = land;
    this.terrainRef = r.state.terrain;
    this.state = r.state;
    this.manual = false;
  }

  private replayFrame(time: number, delta: number) {
    const play = this.replay!;
    // A hidden tab comes back to the replay where it was, not to its end.
    play.owed += (Math.min(delta, 250) / TICK_MS) * REPLAY_RATE;
    const events: SlugEvent[] = [];
    let done = play.skip;
    while (!done && play.owed >= 1) {
      play.owed--;
      if (stepReplay(play.r)) events.push(...play.r.state.events);
      else done = true;
    }
    if (done) {
      // The match's own events of its last frame were drawn before the replay began;
      // the next frame draws it from its next tick.
      this.endReplay();
      return;
    }
    play.r.state.events = events;
    play.marker.setPosition(this.scale.width / 2, this.hudCover().top + 8 * this.dpr);
    this.draw(time, delta);
  }

  private endReplay() {
    const play = this.replay!;
    this.replay = null;
    play.marker.destroy();
    play.land.destroy();
    play.liveLand.setVisible(true);
    this.land = play.liveLand;
    this.terrainRef = play.live.terrain;
    this.state = play.live;
    this.hooks.driver.restartClock?.();
  }

  /**
   * An old laptop that cannot hold the frame rate gets a cheaper picture: one canvas
   * px per CSS px, half the particles, a coarser water line and a still sky. Judged on
   * the mean frame over two seconds, after the first three (loading is not the pace),
   * and only when two such spans in a row are slow: a computer's turn can make one span
   * slow on a machine that holds 60 the rest of the time (measured at 6x CPU throttle:
   * single spans of 22 to 27 ms between runs of 16.7). It never steps back up, so the
   * picture does not flip between the two.
   */
  private watchPace(time: number, delta: number) {
    if (this.lean) return;
    if (this.pace.after < 0) this.pace.after = time + 3000;
    // A hidden tab or a paused debugger is not a slow machine.
    if (time < this.pace.after || delta > 250 || this.pace.from < 0) {
      this.pace.from = time;
      this.pace.frames = 0;
      this.pace.slow = 0;
      return;
    }
    this.pace.frames++;
    const span = time - this.pace.from;
    if (span < SLOW_SPAN) return;
    this.pace.slow = span / this.pace.frames > SLOW_FRAME_MS ? this.pace.slow + 1 : 0;
    if (this.pace.slow >= SLOW_RUNS) {
      this.lean = true;
      this.fx.lean = true;
      this.lowerRes();
    }
    this.pace.from = time;
    this.pace.frames = 0;
  }

  /** Called when the canvas is redrawn at a new number of canvas px per CSS px: text is sized in canvas px. */
  setDpr(dpr: number) {
    // The first turn's zoom, still to come or easing in, was worked out in canvas px at the old density.
    this.playZoom *= dpr / this.dpr;
    this.zoomGoal *= dpr / this.dpr;
    this.dpr = dpr;
    const size = (t: Phaser.GameObjects.Text, font: number, stroke: number) => t.setFontSize(Math.round(font * dpr)).setStroke('#111', Math.round(stroke * dpr));
    for (const view of this.slugs) this.sizeLabel(view.label);
    for (const view of this.projs) size(view.fuse, 11, 2.5);
    for (const p of this.popups) size(p.text, 15, 3);
  }

  private sizeLabel(label: Phaser.GameObjects.Text) {
    const font = this.smallLabels ? 11 : 12;
    return label.setFontSize(Math.round(font * this.dpr)).setStroke('#111', Math.round((font / 4.4) * this.dpr)).setLineSpacing(-2 * this.dpr);
  }

  private handleEvents(events: SlugEvent[], now: number) {
    for (const e of events) {
      let ground: number[] = [];
      switch (e.k) {
        case 'boom': {
          ground = dugColours(this.land.canvas, W, H, this.hooks.theme, this.state.seed, e.x, e.y, e.r, 24);
          const pad = 6;
          const box = repaintArea(this.land.canvas, this.state.terrain, W, H, this.hooks.theme, this.state.seed,
            e.x - e.r - pad, e.y - e.r - pad, e.x + e.r + pad, e.y + e.r + pad);
          if (box) this.land.painted(box);
          this.boomAt = { ...this.boomAt, x: e.x, y: e.y, t: now };
          break;
        }
        case 'land': {
          const box = repaintArea(this.land.canvas, this.state.terrain, W, H, this.hooks.theme, this.state.seed, e.x0, e.y0, e.x1 + 1, e.y1 + 1);
          if (box) this.land.painted(box);
          break;
        }
        case 'fire': {
          this.manual = false;
          const view = this.slugs[this.state.active];
          if (view) view.kickAt = now;
          break;
        }
        case 'turn':
          this.manual = false;
          // A new turn is the camera's cue to go to the new slug, even inside a blast's hold.
          this.boomAt.t = -1e9;
          break;
        case 'hurt': {
          const view = this.slugs[e.id];
          if (view) view.hurtAt = now;
          const slug = this.state.slugs[e.id];
          this.popup(`${e.dmg}`, px(slug.x), px(slug.y) - 22, TEAM_COLORS[this.state.teams[slug.team].color], now);
          break;
        }
        case 'drown':
          this.sink(this.state.slugs[e.id], now);
          break;
        case 'die':
          this.grave(this.state.slugs[e.id]);
          break;
        default:
          break;
      }
      this.fx.event(e, this.state, now, ground);
      this.zips.event(e);
    }
    this.land.upload();
  }

  private popup(text: string, x: number, y: number, colour: string, now: number) {
    const t = this.ui(this.add.text(0, 0, text, {
      fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: `${Math.round(15 * this.dpr)}px`, fontStyle: 'bold',
      color: colour, stroke: '#111', strokeThickness: Math.round(3 * this.dpr),
    }).setOrigin(0.5, 1).setDepth(20));
    this.popups.push({ text: t, x, y, born: now });
  }

  private drawPopups(now: number) {
    this.popups = this.popups.filter((p) => {
      const age = (now - p.born) / 1400;
      if (age >= 1) {
        p.text.destroy();
        return false;
      }
      const at = this.toScreen(p.x, p.y);
      p.text.setPosition(at.x, at.y - age * 34 * this.dpr);
      p.text.setAlpha(age < 0.7 ? 1 : 1 - (age - 0.7) / 0.3);
      return true;
    });
  }

  // --- Sky and water ---

  /** The wind in steps as it acts on a shell, after the room's wind setting. */
  private windNow() {
    return (this.state.wind * this.state.opts.windScale) / 100;
  }

  private drawWind(dt: number) {
    this.windShown = easeWind(this.windShown, this.windNow(), dt);
    if (this.reduced) {
      this.motePen.clear();
      return;
    }
    this.cloudShift -= skyDrift(this.hooks.theme, this.windShown) * dt * this.scale.width;
    if (this.lean) {
      this.motePen.clear();
      return;
    }
    const halfW = this.scale.width / this.zoom / 2;
    const halfH = this.scale.height / this.zoom / 2;
    const view = {
      x0: this.cx - halfW, x1: this.cx + halfW,
      y0: this.cy - halfH, y1: Math.min(this.cy + halfH, this.waterShown),
    };
    if (view.y1 <= view.y0) {
      this.motePen.clear();
      return;
    }
    stepMotes(this.motes, this.windShown, view, dt, Math.random);
    const t = this.state.terrain;
    drawMotes(this.motePen, this.motes, this.windShown, hex(THEMES[this.hooks.theme].crustLight), this.dpr / this.zoom,
      (x, y) => !solidAt(t, Math.round(x), Math.round(y)));
  }

  private drawSky() {
    const n = this.bgLayers.length;
    // Far layers barely move, near ones more: the sense of depth comes from how the camera has moved across the map.
    const along = (this.cx - W / 2) / W;
    const up = (this.cy - H / 2) / H;
    this.bgLayers.forEach((layer, i) => {
      const depth = n === 1 ? 0 : i / (n - 1);
      // Sideways the layer wraps. Up and down it only ever sits lower than its
      // place, so its see-through top shows and its bottom never lifts off the screen's.
      layer.tilePositionX = along * this.scale.width * 0.12 * depth + (i === 0 ? this.cloudShift : 0);
      // On a whole pixel: an edge across a pixel row leaves that row part-covered, the antialiased canvas shades it
      // from just above the sprite, and the tile wrap reads that as the texture's opaque bottom row, a pale line
      // across the sky.
      layer.y = Math.max(0, Math.round((0.5 - up) * this.scale.height * 0.1 * depth));
    });
  }

  private drawWater(now: number, dt: number) {
    // The rules raise the water a step at a time in sudden death; the picture rises to it over a second or so.
    this.waterShown += (this.state.water - this.waterShown) * (1 - Math.exp(-dt / 300));
    const half = this.scale.width / this.zoom / 2;
    drawWaterInto(this.waterBack, this.waterFront, this.look, {
      // Waves and drifting patches are motion nobody asked for: with reduced motion the surface is a still picture.
      level: this.waterShown, x0: this.cx - half - 20, x1: this.cx + half + 20, now: this.reduced ? 0 : now, lean: this.lean,
      // A tall narrow screen zoomed out to the whole map sees further down than the sky allowance.
      bottom: Math.max(H + SKY, this.cy + this.scale.height / this.zoom / 2 + 20),
    });
  }

  // --- Slugs ---

  private poseOf(slug: Slug, now: number, view: SlugView): SlugPose {
    const s = this.state;
    let anim: SlugPose['anim'] = 'idle';
    if (s.phase === 'over' && s.winner === slug.team) anim = 'win';
    else if (slug.mode === 'rope' || slug.mode === 'zip' || slug.mode === 'jet' || slug.mode === 'chute') anim = 'jump';
    else if (slug.mode === 'air') anim = slug.blown ? 'hurt' : slug.vy < 0 ? 'jump' : 'fall';
    else if (slug.mode === 'slide' || now - view.hurtAt < 700) anim = 'hurt';
    // Out of health and waiting for its turn to pop, after the tally has counted it down.
    else if (slug.hp <= 0 && slug.shown <= 0) anim = 'dead';
    else if (slug.walk > 0 && slug.still === 0) anim = 'crawl';
    else if (slug.id === s.active && s.phase === 'turn' && WEAPON[s.weapon].aims) anim = 'aim';
    // Whoever's turn it is holds the weapon chosen, aimed or not; the rest have nothing in hand.
    const holds = slug.id === s.active && s.phase === 'turn' && (anim === 'aim' || anim === 'idle');
    const team = s.teams[slug.team].color;
    return {
      facing: view.facing, aim: slug.aim, t: now, anim, crawl: slug.walk,
      weapon: holds ? s.weapon : undefined,
      band: TEAM_COLORS[team], hat: TEAM_HATS[team % TEAM_HATS.length],
    };
  }

  /** Texture px per world px for the slugs: enough to stay sharp at the current zoom, redrawn when that changes. */
  private wantedRes() {
    return Math.max(1, Math.min(8, Math.ceil(this.zoom)));
  }

  /** `thrust` is the jetpack's burning thrusters, as the rules' KEY bits. */
  private paintSlug(tex: Phaser.Textures.CanvasTexture, pose: SlugPose, res: number, grave = false, gear: Gear = 'none', thrust = 0) {
    const ctx = tex.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tex.width, tex.height);
    ctx.setTransform(res, 0, 0, res, (CELL / 2) * res, FEET * res);
    if (grave) drawGravestone(ctx);
    else {
      // The canopy's lines go behind the body; the jetpack straps go over it.
      if (gear === 'chute') drawParachute(ctx, pose.t);
      drawSlug(ctx, pose);
      if (gear === 'jet') drawJetpack(ctx, pose.facing, (thrust & KEY.up) !== 0, (thrust & (KEY.left | KEY.right)) !== 0, pose.t);
      if (pose.weapon) drawHeldWeapon(ctx, pose.weapon, pose.aim, pose.facing);
    }
    tex.refresh();
  }

  private newSlugTexture(res: number) {
    return this.paintable('slug', CELL * res, TALL * res)!;
  }

  private slugImage(x: number, y: number, tex: Phaser.Textures.CanvasTexture, depth: number) {
    return this.world(this.add.image(x, y, tex).setDepth(depth).setOrigin(0.5, FEET / TALL).setDisplaySize(CELL, TALL));
  }

  private drawSlugs(now: number, dt: number) {
    const s = this.state;
    const res = this.wantedRes();
    // Zoomed out past a world px a CSS px, slugs shrink to a dozen px; a full two-line label would bury them, so it
    // folds to one smaller line, kept as tall as the slug.
    const small = this.zoom < this.dpr;
    if (small !== this.smallLabels) {
      this.smallLabels = small;
      for (const view of this.slugs) this.sizeLabel(view.label);
    }
    const m = 4 * this.dpr;
    const cover = this.hudCover();
    const shown: Phaser.GameObjects.Text[] = [];
    // The rules move slugs 50 times a second and a frame may run none, one or two of those ticks; drawn where they
    // stand, slugs would judder against the eased camera. Each picture instead glides from where it was drawn when
    // the rules last moved it to where they put it, over one tick, which costs a tick of lag and nothing else.
    const ticked = s.tick !== this.seenTick;
    if (ticked) {
      this.seenTick = s.tick;
      // Timed from the last frame, where the glide sets off: timed from this one, every frame with a tick in it would
      // draw the slug standing still.
      this.tickSeenAt = this.slugFrameAt;
    }
    this.slugFrameAt = now;
    const glide = Math.min(1, (now - this.tickSeenAt) / TICK_MS);
    s.slugs.forEach((slug, i) => {
      let view = this.slugs[i];
      if (!view) {
        const tex = this.newSlugTexture(res);
        view = {
          tex,
          img: this.slugImage(0, 0, tex, 30),
          label: this.sizeLabel(this.ui(this.add.text(0, 0, '', {
            fontFamily: 'system-ui, -apple-system, sans-serif', fontStyle: 'bold',
            color: TEAM_COLORS[s.teams[slug.team].color], align: 'center',
          }).setOrigin(0.5, 1).setDepth(10))),
          labelText: '',
          drawn: '',
          hurtAt: -1e9,
          tilt: 0,
          drawX: px(slug.x),
          drawY: px(slug.y),
          fromX: px(slug.x),
          fromY: px(slug.y),
          facing: slug.facing,
          turnAt: -1e9,
          squash: 0,
          squashAt: -1e9,
          mode: slug.mode,
          vy: 0,
          kickAt: -1e9,
        };
        this.slugs[i] = view;
      }
      if (!slug.alive || s.placing.includes(slug.id)) {
        view.img.setVisible(false);
        view.label.setVisible(false);
        return;
      }
      // Judged per slug, not on the frame the resolution changed: a slug hidden then (placing, or dead until a replay
      // brings it back) would keep the old canvas and be painted into it at the new scale.
      if (view.tex.width !== CELL * res) {
        const old = view.tex;
        view.tex = this.newSlugTexture(res);
        view.img.setTexture(view.tex.key);
        this.textures.remove(old);
        view.drawn = '';
      }
      const x = px(slug.x);
      const y = px(slug.y);
      if (ticked) {
        // A teleport, or a slug brought back by a replay, jumps rather than glides.
        const far = Math.abs(x - view.drawX) > 24 || Math.abs(y - view.drawY) > 24;
        view.fromX = far ? x : view.drawX;
        view.fromY = far ? y : view.drawY;
      }
      view.drawX = view.fromX + (x - view.fromX) * glide;
      view.drawY = view.fromY + (y - view.fromY) * glide;
      // Standing or sliding, the picture lies along the ground; in the air or on a line it hangs upright.
      const footed = slug.mode === 'stand' || slug.mode === 'slide';
      // Capped short of the rules' steepest walkable ground: leaned further, a slug reads as falling over.
      const lean = footed ? Math.max(-LEAN_MOST, Math.min(LEAN_MOST, groundTilt(s.terrain, x, y + SLUG_HALF_H))) : 0;
      // A landing squashes the body into the ground, harder the faster the fall; a jump stretches it up.
      const aloft = slug.mode === 'air' || slug.mode === 'jet' || slug.mode === 'chute' || slug.mode === 'rope' || slug.mode === 'zip';
      if (footed && view.mode !== slug.mode && (view.mode === 'air' || view.mode === 'chute' || view.mode === 'jet')) {
        view.squash = Math.min(0.3, 0.1 + (view.vy / ONE) * 0.03);
        view.squashAt = now;
      } else if (aloft && view.mode === 'stand' && slug.vy < 0) {
        view.squash = -0.12;
        view.squashAt = now;
      }
      view.mode = slug.mode;
      view.vy = slug.vy;
      // A turn is a quick narrowing and widening of the picture, facing the new way from its middle.
      if (slug.facing !== view.facing && now - view.turnAt > TURN_MS) view.turnAt = now;
      const turning = (now - view.turnAt) / TURN_MS;
      if (turning >= 0.5) view.facing = slug.facing;
      // Eased over about a tenth of a second, so crawling over bumps rolls rather than twitches.
      view.tilt += (lean - view.tilt) * (1 - Math.exp(-dt / 110));
      const pose = this.poseOf(slug, now, view);
      const pic = leanedPicture(slug, view.tilt);
      pic.x += view.drawX - x;
      pic.y += view.drawY - y;
      if (pose.weapon) pose.aim = pic.aim;
      // The active slug and anything moving animate every frame; the rest at a gentler rate, which saves uploading
      // dozens of small textures each frame for a change no one can see.
      const lively = slug.id === s.active || pose.anim !== 'idle';
      const beat = Math.floor(now / (lively ? 16 : 90));
      const gear: Gear = slug.mode === 'chute' ? 'chute' : slug.mode === 'jet' ? 'jet' : 'none';
      const thrust = gear === 'jet' ? slug.thrust ?? 0 : 0;
      const sig = `${pose.anim}|${pose.facing}|${pose.aim}|${pose.crawl}|${pose.weapon}|${gear}|${thrust}|${beat}`;
      if (sig !== view.drawn) {
        view.drawn = sig;
        // Each slug runs its own clock for breathing and blinking, so a row of them never blinks in step.
        this.paintSlug(view.tex, { ...pose, t: beat * (lively ? 16 : 90) + slug.id * 1291 }, res, false, gear, thrust);
      }
      const sq = view.squash * Math.max(0, 1 - (now - view.squashAt) / SQUASH_MS);
      const narrow = turning < 1 ? Math.max(0.2, Math.abs(1 - 2 * turning)) : 1;
      // Firing shoves the slug back a px or so, eased out over a few frames.
      const kick = Math.max(0, 1 - (now - view.kickAt) / 140);
      view.img.setVisible(true)
        .setPosition(pic.x - slug.facing * 1.5 * kick * Math.cos(view.tilt), pic.y - slug.facing * 1.5 * kick * Math.sin(view.tilt))
        .setRotation(view.tilt)
        .setDisplaySize(CELL * (1 + sq * 0.6) * narrow, TALL * (1 - sq));
      // On a jetpack the health line gives way to the fuel left, counted down from 30 as Worms does.
      const second = slug.mode === 'jet' && slug.id === s.active ? `Fuel ${Math.ceil(s.jetFuel / 50)}` : Math.max(0, slug.shown);
      const text = `${slug.name}${small ? ' ' : '\n'}${second}`;
      if (text !== view.labelText) {
        view.labelText = text;
        view.label.setText(text);
      }
      // The label rests on the head, or on the canopy's top (27 px up) while a parachute is open, not across it.
      const at = this.toScreen(view.drawX, view.drawY - (slug.mode === 'chute' ? 28 : 13));
      // A slug on screen keeps its whole label on screen and above the team bars, even at the very edge or behind
      // them. One off screen takes its label with it, rather than piling labels up along the border.
      const half = view.label.width / 2;
      const seen = at.x >= 0 && at.x <= this.scale.width && at.y >= 0 && at.y <= this.scale.height;
      const lx = seen ? Math.max(half + m, Math.min(this.scale.width - half - m, at.x)) : at.x;
      const ly = seen ? Math.max(cover.top + view.label.height + m, Math.min(this.scale.height - cover.bottom - m, at.y)) : at.y;
      view.label.setVisible(true).setPosition(Math.round(lx), Math.round(ly));
      if (seen) shown.push(view.label);
    });
    this.unstackLabels(shown, this.slugs[s.active]?.label);
  }

  /**
   * Slugs huddled together would print their labels over each other, so each one that overlaps a label already
   * placed lifts clear above it: the active slug's stays put, then the rest from the lowest up. Labels only ever
   * move up, so a stack reads from its slug upward, and a few dozen rectangles cost nothing to compare.
   */
  private unstackLabels(labels: Phaser.GameObjects.Text[], first: Phaser.GameObjects.Text | undefined) {
    const gap = Math.round(this.dpr);
    labels.sort((a, b) => (a === first ? -1 : b === first ? 1 : b.y - a.y));
    const placed: Phaser.GameObjects.Text[] = [];
    for (const label of labels) {
      for (let tries = 0; tries < placed.length; tries++) {
        const over = placed.find((p) =>
          Math.abs(p.x - label.x) * 2 < p.width + label.width && label.y > p.y - p.height - gap && label.y - label.height - gap < p.y
        );
        if (!over) break;
        label.setY(over.y - over.height - gap);
      }
      placed.push(label);
    }
  }

  private grave(slug: Slug) {
    const res = this.wantedRes();
    const tex = this.newSlugTexture(res);
    this.paintSlug(tex, { facing: 1, aim: 0, t: 0, anim: 'dead', crawl: 0 }, res, true);
    const img = this.slugImage(px(slug.x), px(slug.y), tex, 20);
    this.graves.push({ x: px(slug.x), y: px(slug.y), vy: 0, img, tex });
  }

  /** Gravestones are picture only, so the rules never move them: they drop here when the ground under them is blown away. */
  private drawGraves(now: number, dt: number) {
    const t = this.state.terrain;
    this.graves = this.graves.filter((g) => {
      const resting = solidAt(t, Math.round(g.x), Math.round(g.y) + 8);
      if (resting) g.vy = 0;
      else {
        g.vy = Math.min(9, g.vy + 0.24 * (dt / 20));
        for (let k = 0; k < Math.ceil(g.vy * (dt / 20)) && !solidAt(t, Math.round(g.x), Math.round(g.y) + 8); k++) g.y += 1;
      }
      if (g.y > this.waterShown + 20) {
        g.img.destroy();
        this.textures.remove(g.tex);
        return false;
      }
      g.img.setPosition(g.x, g.y);
      return true;
    });
    this.sinking = this.sinking.filter((d) => {
      const age = (now - d.born) / 1600;
      if (age >= 1) {
        d.img.destroy();
        this.textures.remove(d.tex);
        return false;
      }
      d.img.setPosition(d.x, d.y + age * 36).setAlpha(1 - age * 0.8);
      return true;
    });
  }

  private sink(slug: Slug, now: number) {
    const res = this.wantedRes();
    const tex = this.newSlugTexture(res);
    const team = this.state.teams[slug.team].color;
    const pose: SlugPose = {
      facing: slug.facing, aim: 0, t: now, anim: 'drown', crawl: 0, band: TEAM_COLORS[team], hat: TEAM_HATS[team % TEAM_HATS.length],
    };
    this.paintSlug(tex, pose, res);
    const img = this.slugImage(px(slug.x), px(slug.y), tex, 30);
    this.sinking.push({ x: px(slug.x), y: px(slug.y), born: now, img, tex, pose });
  }

  // --- What flies ---

  /**
   * Mines, barrels and crates, repainted only when the picture changes: a mine's lamp flashes and a crate's
   * parachute sways, nothing else moves. The picture is 40 px square with the object 28 px down, leaving room above
   * for a canopy.
   */
  private drawObjects(now: number) {
    const objs = this.state.objs;
    const res = this.wantedRes();
    while (this.objViews.length < objs.length) {
      const tex = this.paintable('obj', 40 * res, 40 * res)!;
      this.objViews.push({ tex, img: this.world(this.add.image(0, 0, tex).setDepth(15).setOrigin(0.5, 0.7)), drawn: '' });
    }
    this.objViews.forEach((view, i) => {
      const o = objs[i];
      if (!o) {
        view.img.setVisible(false);
        return;
      }
      const lit = o.kind === 'mine' && mineLit(o, now);
      // The sway is drawn in steps; a smooth one would repaint every frame for the few seconds a crate falls.
      const sway = o.chute ? Math.floor(now / 80) * 80 : 0;
      const sig = `${o.kind}|${o.gift}|${sway}|${lit}|${res}`;
      if (sig !== view.drawn) {
        view.drawn = sig;
        // An image keeps the size its texture had when it was made, and places its origin by that size: resized, the
        // texture would draw an object off its place by the change in resolution, so the image takes the new size too.
        if (view.tex.width !== 40 * res) view.img.setSizeToFrame(view.tex.setSize(40 * res, 40 * res).get()).updateDisplayOrigin();
        const ctx = view.tex.context;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, view.tex.width, view.tex.height);
        ctx.setTransform(res, 0, 0, res, 20 * res, 28 * res);
        if (o.kind === 'crate' && o.gift) drawCrate(ctx, crateKind(o.gift), o.chute, sway);
        else {
          // The art's drum is half the size of the barrel the rules collide with
          // (12 x 16, centred on o.y); scaled up, its base meets the ground.
          if (o.kind === 'barrel') ctx.transform(2, 0, 0, 2, 0, 4);
          // drawObject blinks on its own clock; `lit` has already picked the phase, so it is drawn at a lit moment.
          drawObject(ctx, o.kind, 0, lit);
        }
        view.tex.refresh();
      }
      view.img.setVisible(true).setPosition(o.x / ONE, o.y / ONE).setDisplaySize(40, 40);
    });
  }

  /**
   * Shells drawn where the rules put them would judder against the eased camera, as slugs did; each instead glides
   * from where it was drawn to where the rules last put it, over one tick. Drawing only: the rules never see it.
   */
  private glideProjectiles(now: number) {
    const s = this.state;
    const ticked = s.tick !== this.projTick;
    if (ticked) {
      this.projTick = s.tick;
      // The glide sets off from where the last frame drew it, so it is timed from that frame: timed from this one,
      // every frame with a tick in it would draw the shell standing still.
      this.projTickAt = this.projFrameAt;
    }
    this.projFrameAt = now;
    const glide = Math.min(1, (now - this.projTickAt) / TICK_MS);
    const next = new Map<number, { drawX: number; drawY: number; fromX: number; fromY: number }>();
    for (const p of s.projs) {
      const x = p.x / ONE;
      const y = p.y / ONE;
      const view = this.projGlide.get(p.id) ?? { drawX: x, drawY: y, fromX: x, fromY: y };
      if (ticked) {
        // A fast shell covers 15 px a tick, so the slugs' 24 px teleport test is widened by its speed;
        // further than that (a replay rewinding) it jumps.
        const reach = (Math.hypot(p.vx, p.vy) / ONE) * 2 + 24;
        const far = Math.hypot(x - view.drawX, y - view.drawY) > reach;
        view.fromX = far ? x : view.drawX;
        view.fromY = far ? y : view.drawY;
      }
      view.drawX = view.fromX + (x - view.fromX) * glide;
      view.drawY = view.fromY + (y - view.fromY) * glide;
      next.set(p.id, view);
    }
    this.projGlide = next;
  }

  /** Where a projectile is drawn this frame, for the effects to lay its trail from. */
  projDrawn(id: number): { x: number; y: number } | null {
    const view = this.projGlide.get(id);
    return view ? { x: view.drawX, y: view.drawY } : null;
  }

  /**
   * What flies is painted once, unturned, and turned as an image, so a cluster's
   * dozen bits cost no uploads; only a flame, fuse or drill repaints, at 25 a second.
   */
  private drawProjectiles(now: number) {
    const s = this.state;
    const res = this.wantedRes();
    while (this.projs.length < s.projs.length) {
      const tex = this.paintable('proj', 24 * res, 24 * res)!;
      this.projs.push({
        tex,
        drawn: '',
        img: this.world(this.add.image(0, 0, tex).setDepth(40)),
        fuse: this.ui(this.add.text(0, 0, '', {
          fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: `${Math.round(11 * this.dpr)}px`, fontStyle: 'bold',
          color: '#fff', stroke: '#111', strokeThickness: Math.round(2.5 * this.dpr),
        }).setOrigin(0.5, 1).setDepth(11)),
      });
    }
    this.projs.forEach((view, i) => {
      const p = s.projs[i];
      if (!p) {
        view.img.setVisible(false);
        view.fuse.setVisible(false);
        return;
      }
      const angle = p.rest ? 0 : (Math.atan2(p.vy, p.vx) * 180) / Math.PI;
      const dir = Math.cos((angle * Math.PI) / 180) < 0 ? -1 : 1;
      const beat = projectileFlickers(p.kind) ? Math.floor(now / 40) : 0;
      const sig = `${p.kind}|${dir}|${beat}|${res}`;
      if (sig !== view.drawn) {
        view.drawn = sig;
        if (view.tex.width !== 24 * res) view.img.setSizeToFrame(view.tex.setSize(24 * res, 24 * res).get()).updateDisplayOrigin();
        const ctx = view.tex.context;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, view.tex.width, view.tex.height);
        ctx.setTransform(res, 0, 0, res, 12 * res, 12 * res);
        drawProjectileBody(ctx, p.kind, dir, beat * 40);
        view.tex.refresh();
      }
      const glided = this.projGlide.get(p.id);
      const x = glided ? glided.drawX : p.x / ONE;
      const y = glided ? glided.drawY : p.y / ONE;
      view.img.setVisible(true).setPosition(x, y).setDisplaySize(24, 24).setRotation(projectileSpin(p.kind, angle, now));
      // A fuse is shown in whole seconds, the way it was set.
      if (p.fuse > 0) {
        const at = this.toScreen(x, y - 9);
        view.fuse.setVisible(true).setText(`${Math.ceil(p.fuse / 50)}`).setPosition(Math.round(at.x), Math.round(at.y));
      } else view.fuse.setVisible(false);
    });
  }

  private drawOverlay() {
    const s = this.state;
    const g = this.overlay;
    g.clear();
    this.drawRopeLine();
    const slug = s.slugs[s.active];
    if (!slug || !slug.alive) return;
    const colour = hex(TEAM_COLORS[s.teams[slug.team].color]);
    if (s.phase === 'place') {
      const at = this.pointer && this.hooks.driver.mine.includes(s.activeTeam) && this.toWorld(this.pointer.x, this.pointer.y);
      const spot = at && placeSpot(s, Math.round(at.x), Math.round(at.y));
      if (spot) this.placeGhost(g, spot.x, spot.y, colour);
      return;
    }
    const x = px(slug.x);
    const y = px(slug.y) - 2;
    // Whose turn it is, pointed out while the turn gets ready and until that slug first crawls, aims, turns or picks a weapon.
    const stance = `${s.active}|${slug.x}|${slug.y}|${slug.aim}|${slug.facing}|${s.weapon}`;
    if (s.phase === 'ready') this.poised = stance;
    else if (s.phase !== 'turn' || s.charging || stance !== this.poised) this.poised = '';
    const label = this.slugs[s.active]?.label;
    if (this.poised && label?.visible) {
      // Pointing down at the label, not at the slug: at a playing zoom a world-fixed arrow lands on the name. It is
      // kept the size it has at a world px for two CSS px, so it reads the same zoomed in or out.
      const k = (2 * this.dpr) / this.zoom;
      const tip = (label.y - label.height - this.scale.height / 2) / this.zoom + this.cy - 2 * k;
      const ax = (label.x - this.scale.width / 2) / this.zoom + this.cx;
      g.fillStyle(0x111111, 0.9);
      g.fillTriangle(ax - 6 * k, tip - 8 * k, ax + 6 * k, tip - 8 * k, ax, tip);
      g.fillStyle(colour, 1);
      g.fillTriangle(ax - 4.5 * k, tip - 7 * k, ax + 4.5 * k, tip - 7 * k, ax, tip - 1.5 * k);
    }
    if (s.phase !== 'turn') return;
    const spec = WEAPON[s.weapon];
    const use = spec.use;
    const mine = this.hooks.driver.mine.includes(s.activeTeam);
    if (s.mark && use === 'mark') this.crosshair(g, s.mark.x, s.mark.y, colour);
    if ((use === 'charge' || use === 'shot' || use === 'mark') && spec.aims) {
      const dx = (slug.facing * cosDeg(slug.aim)) / ONE;
      const dy = -sinDeg(slug.aim) / ONE;
      if (s.charging) {
        // The power bar grows out along the aim, so the eye never leaves the slug.
        const len = 10 + (44 * s.power) / CHARGE_TICKS;
        const nx = -dy;
        const ny = dx;
        const wide = 1 + (6 * s.power) / CHARGE_TICKS;
        g.fillStyle(0x111111, 0.55);
        g.fillTriangle(x + dx * 8, y + dy * 8, x + dx * len + nx * (wide + 1), y + dy * len + ny * (wide + 1), x + dx * len - nx * (wide + 1), y + dy * len - ny * (wide + 1));
        g.fillStyle(colour, 1);
        g.fillTriangle(x + dx * 8, y + dy * 8, x + dx * len + nx * wide, y + dy * len + ny * wide, x + dx * len - nx * wide, y + dy * len - ny * wide);
      }
      if (s.boost & BOOST.laser && spec.category === 'firearm' && !s.charging) {
        const end = shotEnd(s, slug, slug.aim, shotRange(s.weapon));
        g.lineStyle(2, 0x111111, 0.45);
        g.lineBetween(end.x0, end.y0, end.x1, end.y1);
        g.lineStyle(1, LASER, 0.9);
        g.lineBetween(end.x0, end.y0, end.x1, end.y1);
        if (end.stop === 'hit') {
          g.fillStyle(LASER, 1);
          g.fillCircle(end.x1, end.y1, 1.5);
        }
      }
      this.crosshair(g, x + dx * 34, y + dy * 34, colour);
    }
    if ((use === 'target' || (use === 'mark' && !s.mark)) && this.pointer && mine) {
      const w = this.toWorld(this.pointer.x, this.pointer.y);
      if (s.weapon === 'girder') this.girderGhost(g, x, y, w.x, w.y, s.girderRot);
      else this.crosshair(g, w.x, w.y, colour);
    }
  }

  /** The rope from its first anchor round each bend to the slug, as strips of the painted rope texture. */
  private drawRopeLine() {
    const s = this.state;
    const slug = s.slugs[s.active];
    const rope = s.rope;
    const held = slug && this.slugs[slug.id];
    const pts = slug && slug.mode === 'rope' && rope && held ? [...rope.pts, { x: held.drawX, y: held.drawY - 2 }] : [];
    for (let i = 0; i < Math.max(this.ropeSegs.length, pts.length - 1); i++) {
      let seg = this.ropeSegs[i];
      if (i >= pts.length - 1) {
        seg.setVisible(false);
        continue;
      }
      if (!seg) {
        seg = this.world(this.add.tileSprite(0, 0, 1, 3, 'slugrope').setDepth(29).setTileScale(1 / ROPE_RES, 1 / ROPE_RES));
        this.ropeSegs[i] = seg;
      }
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // Anchored at its upper end, so the twist marks stay put on the rope while the slug climbs.
      seg.setVisible(true).setOrigin(0, 0.5).setPosition(a.x, a.y).setRotation(Math.atan2(b.y - a.y, b.x - a.x)).setSize(len, 3);
    }
  }

  /** Where a girder would go: its outline at the pointer, dimmed when the rules would refuse it as out of reach. */
  private girderGhost(g: Phaser.GameObjects.Graphics, sx: number, sy: number, cx: number, cy: number, rot: number) {
    const a = (rot * 22.5 * Math.PI) / 180;
    const ux = Math.cos(a) * GIRDER_HALF;
    const uy = Math.sin(a) * GIRDER_HALF;
    const near = Math.hypot(cx - sx, cy - sy) <= GIRDER_REACH;
    g.lineStyle(7, 0x111111, near ? 0.5 : 0.2);
    g.lineBetween(cx - ux, cy - uy, cx + ux, cy + uy);
    g.lineStyle(5, 0xc9ccd1, near ? 0.9 : 0.3);
    g.lineBetween(cx - ux, cy - uy, cx + ux, cy + uy);
  }

  /** Where a click would put the slug being placed: its outline on the ground there, pointed out from above. */
  private placeGhost(g: Phaser.GameObjects.Graphics, x: number, y: number, colour: number) {
    for (const [width, c] of [[3, 0x111111], [1.4, colour]] as const) {
      g.lineStyle(width, c, 1);
      g.strokeEllipse(x, y, 12, 17);
    }
    g.fillStyle(0x111111, 0.9);
    g.fillTriangle(x - 6, y - 22, x + 6, y - 22, x, y - 13);
    g.fillStyle(colour, 1);
    g.fillTriangle(x - 4.5, y - 21, x + 4.5, y - 21, x, y - 14.5);
  }

  private crosshair(g: Phaser.GameObjects.Graphics, x: number, y: number, colour: number) {
    const r = 4.5;
    for (const [width, c] of [[3, 0x111111], [1.4, colour]] as const) {
      g.lineStyle(width, c, 1);
      g.strokeCircle(x, y, r);
      g.lineBetween(x - r - 3, y, x - r + 1.5, y);
      g.lineBetween(x + r - 1.5, y, x + r + 3, y);
      g.lineBetween(x, y - r - 3, x, y - r + 1.5);
      g.lineBetween(x, y + r - 1.5, x, y + r + 3);
    }
  }
}

/** Start the battlefield in `parent`, sized to it. Phaser is in this module only, so it downloads when a match starts. */
export function startBattlefield(parent: HTMLElement, hooks: SceneHooks): Battlefield {
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  const size = () => ({ w: Math.max(1, Math.round(parent.clientWidth * dpr)), h: Math.max(1, Math.round(parent.clientHeight * dpr)) });
  const first = size();
  let leaned = false;
  const changeDpr = (next: number) => {
    if (next === dpr) return;
    dpr = next;
    game.scale.setZoom(1 / dpr);
    scene.setDpr(dpr);
    const { w, h } = size();
    scene.resizeTo(w, h);
    // At zoom 1 Phaser stops writing the canvas's CSS size and leaves the last one it
    // wrote; the canvas fills its box instead, which follows later resizes too.
    // At other zooms its resize has just written the CSS size itself.
    if (dpr === 1) {
      game.canvas.style.width = '100%';
      game.canvas.style.height = '100%';
    }
  };
  const scene = new SlugsScene(hooks, dpr, () => {
    leaned = true;
    changeDpr(1);
  });
  // Dragged to a screen of another density, the canvas is redrawn at that density, unless it has already dropped
  // to 1 for speed. The query only fires on leaving the density it names, so it is asked again after each change.
  let density: MediaQueryList | null = null;
  const watchDensity = () => {
    density?.removeEventListener('change', onDensity);
    density = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    density.addEventListener('change', onDensity);
  };
  const onDensity = () => {
    if (!leaned && scene.sys?.isActive()) changeDpr(Math.min(2, window.devicePixelRatio || 1));
    watchDensity();
  };
  watchDensity();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: first.w,
    height: first.h,
    zoom: 1 / dpr,
    backgroundColor: THEMES[hooks.theme].skyTop,
    banner: false,
    autoFocus: false,
    disableContextMenu: true,
    input: false,
    // The game has no sound. Phaser's own audio context also throws on a
    // window blur after `destroy` has closed it.
    audio: { noAudio: true },
    antialias: true,
    scene,
  });
  const observer = new ResizeObserver(() => {
    const { w, h } = size();
    if (scene.sys?.isActive() && (w !== game.scale.width || h !== game.scale.height)) scene.resizeTo(w, h);
  });
  observer.observe(parent);
  return {
    fps: () => game.loop.actualFps,
    zoomBy: (factor) => scene.zoomBy(factor),
    zoom: () => scene.viewZoom(),
    destroy() {
      observer.disconnect();
      density?.removeEventListener('change', onDensity);
      scene.shutdownListeners();
      game.destroy(true);
    },
  };
}
