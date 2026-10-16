// Swarm's painting. Everything is drawn in code: the ground and paths once per
// map and size into an offscreen canvas, each hut once per look into a sprite,
// each pose of a unit once into a sheet, and the units copied from it, the
// badges and the effects every frame on top.
//
// Each side is a kind of creature, ants, bees, beetles or spiders, and no two
// sides in a game are the same kind. Bees build coiled straw skeps, the rest
// earth mounds, and a hut nobody holds is a house of whatever its place is
// made of. The creatures and the buildings differ in outline as well as in
// colour, so the sides can be told apart without relying on hue; the side's own
// colour is on its flags and its badges. The ground is in swarmSceneGround, the
// buildings in swarmSceneHuts, and the orders a player gives in swarmAim.

import {
  TICK_MS,
  allied,
  isTower,
  mulberry32,
  pathLength,
  pathOf,
  sendSize,
  reachOf,
  upgradeCost,
  type Army,
  type Kind,
  type Owner,
  type Seat,
  type Site,
  type SwarmEvent,
  type SwarmMap,
  type SwarmState,
  type Upgrade,
} from '../../swarmGameLogic';
import { ARMOURY_ICON, buildUp, drawArmoury, drawBlind, drawKit, noteArmoury, paceShown, tokenKinds } from './swarmArmoury';
import { REFUSED_MS, aimOf, drawAimOver, drawAimUnder, easeOut, standingOf, type Leg, type Sending } from './swarmAim';
import { drawPicks } from './swarmDraft';
import { SHOT_LAND_MS, drawOver, drawUnder, feelStep, newFeel, type Feel } from './swarmFeel';
import { drawThreats, type ThreatView } from './swarmThreat';
import { builtEvents, burnSpots, drawBuiltOver, drawBuiltUnder, flameIcon, newBuilt, tunnelSight, type Built } from './swarmSceneBuilt';
import { ageOf, drawMist, fogOf, newFog, newMist, type Fog, type Mist, type Sight } from './swarmFog';
import { drawDrowned, drawFlood } from './swarmFloodFx';
import { addPowerFx, drawCalls, drawRain, type CallFx } from './swarmPowerFx';
import { paintGround } from './swarmSceneGround';
import { drawModes } from './swarmSceneModes';
import { drawFlags, paintSite } from './swarmSceneHuts';
import { drawAllies } from './swarmTeamsArt';
import {
  BADGE,
  LANE,
  TOWER_BALL,
  TOWER_H,
  crossingsOf,
  ellipse,
  fileOf,
  fontOf,
  growOf,
  outOfDoors,
  pathPoint,
  riverDir,
  riverOf,
  siteRadius,
  siteTop,
  spreadAt,
  type River,
} from './swarmSceneKit';

export { pathPoint };
export { drawThumb } from './swarmSceneThumb';

interface Fx {
  kind: 'clash' | 'upgrade' | 'shot';
  x: number;
  y: number;
  at: number;
  seat: Owner;
  /** Who `seat` fought, for a clash. */
  foe?: Owner;
  /** The tower a shot was fired from. */
  tower?: number;
  /** The ball has come down and burnt its mark into the ground. */
  landed?: boolean;
}

/** From the ball landing to the last of its smoke. */
const SHOT_IMPACT_MS = 430;
/** The ball is in the air for as long as swarmFeel waits to stain the ground under what it kills. */
const FX_MS = { clash: 360, upgrade: 600, shot: SHOT_LAND_MS + SHOT_IMPACT_MS };
/** How long a puff of the ball's smoke hangs where the ball left it. */
const TRAIL_MS = 240;
const MUZZLE_MS = 260;
/** How long a tower takes to stand up again after a shot. */
const RECOIL_MS = 200;
/**
 * A hut given up under the white flag shows its old side and nobody by turns,
 * this long each, twice, before it stays nobody's: two flashes a second, well
 * under the three a second that is unsafe to flash at.
 */
const YIELD_BEAT_MS = 250;
const YIELD_BEATS = 4;
/** Burn marks kept on the ground; the oldest goes when another lands. */
const SCORCH_MAX = 70;

/** A place on open water where the light catches, and which way the water runs there. */
interface Glint {
  x: number;
  y: number;
  dx: number;
  dy: number;
  phase: number;
}

/** A hut painted once, and the device pixel of the board its top left corner goes on. */
interface Sprite {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
}

/** Every pose a unit is drawn in, painted once and copied to the board from then on. */
interface Sheet {
  canvas: HTMLCanvasElement;
  /** One pose's square of the sheet across, in its pixels, and how many of them go to one of a unit's own units. */
  cell: number;
  res: number;
  /** The ranks of the armies it was painted for. */
  ranks: string;
  /** The first row of each side's creature: a row for each of its coats, or one for a bee. Only the sides in the game have one. */
  first: Partial<Record<Seat, number>>;
  /** The row the two shadows are on, under everything else. */
  shadow: number;
}

export interface Scene {
  map: SwarmMap;
  seed: number;
  /** The creature each side is drawn as. */
  kinds: Record<Seat, Kind>;
  ground: HTMLCanvasElement | null;
  sprites: Map<string, Sprite>;
  sheet: Sheet | null;
  /** Device pixels per world unit the ground and sprites were painted at. */
  scale: number;
  /** When the board last changed size. */
  sizedAt: number;
  /** The sites from the back of the board to the front, and the ants of a frame that walk in front of each: kept, so a frame does not make them anew. */
  rows: number[];
  bands: Marcher[][];
  fx: Fx[];
  /** When each hut's garrison last took a hit, for the badge to jolt. */
  hitAt: number[];
  /** When each tower last fired, for it to sit down under the shot. */
  firedAt: number[];
  /** When each hut was given up under the white flag, and by whom. */
  flagged: ({ at: number; seat: Seat } | null)[];
  /** The paths the viewer's columns have still to walk, as of `tick`: worked out once a tick, not once a frame. */
  standing: { tick: number; legs: Leg[] };
  /** Where cannon balls have landed, burnt into the ground. */
  scorches: { x: number; y: number }[];
  /** The place each unit took in its column, by unit and path, and how many each path has sent out: units are numbered across all the columns at once, so a unit's own number does not say who walks next to it. */
  slots: Map<number, number>;
  sent: Uint32Array;
  rivers: River[];
  glints: Glint[];
  feel: Feel;
  built: Built;
  /** With the fog twist, what the viewer has seen, and the mist over the rest. */
  fog: Fog | null;
  mist: Mist | null;
  calls: CallFx[];
}

/** How far from the middle of a bridge or a ford the water is left unlit, so no glint shows through the planks. */
const CROSSING_CLEAR = 20;

function glintsOf(map: SwarmMap, seed: number, rivers: River[]): Glint[] {
  const rnd = mulberry32(seed ^ 0x61f7);
  const covered: { x: number; y: number }[] = [];
  for (const crossing of crossingsOf(map, rivers)) {
    for (let i = 0; i <= 6; i++) covered.push(pathPoint(map, crossing.path.a, crossing.path.b, crossing.f0 + ((crossing.f1 - crossing.f0) * i) / 6));
  }
  const glints: Glint[] = [];
  for (const river of rivers) {
    for (let i = 1; i < river.pts.length - 1; i += 2) {
      const dir = riverDir(river, i);
      const off = (rnd() - 0.5) * river.half[i] * 1.5;
      const x = river.pts[i].x - dir.y * off;
      const y = river.pts[i].y + dir.x * off;
      if (x < 0 || x > map.w || y < 0 || y > map.h) continue;
      if (covered.some((p) => Math.hypot(p.x - x, p.y - y) < CROSSING_CLEAR)) continue;
      glints.push({ x, y, dx: dir.x, dy: dir.y, phase: rnd() * Math.PI * 2 });
    }
  }
  return glints;
}

/** `seat` is whose screen it is: under the fog, it is what that side can see. */
export function newScene(map: SwarmMap, seed: number, kinds: Record<Seat, Kind>, seat: Seat): Scene {
  const rivers = map.rivers.map(riverOf);
  return {
    map,
    seed,
    kinds,
    ground: null,
    sprites: new Map(),
    sheet: null,
    scale: 0,
    sizedAt: 0,
    rows: [...map.sites.keys()].sort((p, q) => map.sites[p].y - map.sites[q].y),
    bands: Array.from({ length: map.sites.length + 1 }, () => []),
    fx: [],
    hitAt: map.sites.map(() => -Infinity),
    firedAt: map.sites.map(() => -Infinity),
    flagged: map.sites.map(() => null),
    standing: { tick: -1, legs: [] },
    scorches: [],
    slots: new Map(),
    sent: new Uint32Array(64 * 64),
    rivers,
    glints: glintsOf(map, seed, rivers),
    feel: newFeel(map, seed, kinds),
    built: newBuilt(map, rivers),
    fog: newFog(map, seat),
    mist: null,
    calls: [],
  };
}

export interface View {
  seat: Seat;
  /** How far into the next tick the frame is, 0 to 1 and a little over. */
  alpha: number;
  now: number;
  selected: number | null;
  /** Shift is held: a send takes everything and not half. */
  sendAll: boolean;
  /** Every hut the drag has swept up, the pointer, the hut under it, whether the send would go by the paths that cost lives, and whether the pointer is a finger, which hides what is under it. */
  drag: { sources: number[]; x: number; y: number; target: number | null; risky: boolean; finger: boolean } | null;
  /** 0 to 1: how long the pointer has rested on the target, towards sending everything. */
  hold: number;
  /** A press that could not be acted on, for that hut's count to shake its head; and the order it was, when it was a drag with nothing to send. */
  refused: { hut: number; at: number; order?: Sending } | null;
  /** The order just given, shown at once because its units leave some ticks later. */
  sent: { order: Sending; at: number } | null;
  /** What is marching on the viewer's huts, for a player still in the game. */
  threat: ThreatView | null;
  /** Under the fog, what the viewer can see on this tick. Set by drawScene. */
  sight?: Sight;
}

export function hutAt(map: SwarmMap, state: SwarmState, x: number, y: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  map.sites.forEach((site, index) => {
    const r = siteRadius(site, state.huts[index].level);
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

export const TOKEN_R = 17;
/** From the middle of one token to the middle of the next, and how far a token's price hangs below its disc. */
const TOKEN_STEP = 42;
const TOKEN_HANG = 3;
/** The least height, in CSS px, a token's price is drawn at. */
const PRICE_MIN_PX = 9;
/** How much larger than their world size the tokens are drawn, and so are pressed. `px` is world units to a CSS pixel. */
export const tokenGrow = (px: number) => growOf(10, PRICE_MIN_PX, px);

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What stands on a site that a token must not cover: the hut from the shadow at its foot to the top of its mast, and its count over that. */
function standingBox(site: Site, level: number, grow: number): Box {
  const r = siteRadius(site, level);
  const aside = badgeAside(site, level, grow);
  const wide = Math.max(r * 1.05, 24 * grow);
  return {
    x0: site.x - wide - (aside ? r * 0.34 + 24 * grow : 0),
    y0: Math.max(BADGE_ROOM * grow, badgeTip(site, level)) - (BADGE_DROP + 12) * grow,
    x1: site.x + wide,
    y1: site.y + r * 0.55,
  };
}

/** How finely, in token radii, the ground round a hut is searched for somewhere to put its tokens, and how far out. */
const SPOT_STEP = 0.5;
const SPOT_REACH = 14;

/**
 * Where the upgrade tokens of the hut in hand sit. Under it in rows of three
 * when nothing is in the way, as close to that as there is clear ground when
 * something is, and stood in columns of three where rows will not go. Clear means
 * over no hut and no hut's count; on a board so small that nowhere is, they go
 * where they cover the fewest. They are always on the board. `px` is world
 * units to a CSS pixel, which is what the tokens' size goes by.
 */
export function upgradeSpots(map: SwarmMap, state: SwarmState, hut: number, px: number): { kind: Upgrade; x: number; y: number }[] {
  const kinds = tokenKinds(map, state, hut);
  // Three to a line, as the three every hut has always been; the armoury's go on a second.
  const long = Math.min(3, kinds.length);
  const short = Math.ceil(kinds.length / 3);
  const grow = tokenGrow(px);
  const radius = TOKEN_R * grow;
  const step = TOKEN_STEP * grow;
  const hang = TOKEN_HANG * grow;
  const boxes = map.sites.map((site, index) => standingBox(site, state.huts[index].level, badgeGrow(px)));
  const home = { x: map.sites[hut].x, y: boxes[hut].y1 + 6 + radius + (short - 1) * step * 0.5 };
  let best = { ...home, upright: false };
  let bestCost = Infinity;
  for (const upright of [false, true]) {
    const across = radius + ((upright ? short : long) - 1) * step * 0.5;
    const up = radius + ((upright ? long : short) - 1) * step * 0.5;
    const down = up + hang;
    for (let i = -SPOT_REACH; i <= SPOT_REACH; i++) {
      for (let j = -SPOT_REACH; j <= SPOT_REACH; j++) {
        const x = home.x + i * radius * SPOT_STEP;
        const y = home.y + j * radius * SPOT_STEP;
        if (x - across < 2 || x + across > map.w - 2 || y - up < 2 || y + down > map.h - 2) continue;
        // A column is a little the worse for being one: the row is what the hand has learnt.
        const far = Math.hypot(x - home.x, y - home.y) + (upright ? radius : 0);
        if (far >= bestCost) continue;
        let covered = 0;
        for (const box of boxes) if (x - across < box.x1 && x + across > box.x0 && y - up < box.y1 && y + down > box.y0) covered++;
        // Anything covered is worse than any distance.
        const cost = far + covered * map.w * 2;
        if (cost >= bestCost) continue;
        best = { x, y, upright };
        bestCost = cost;
      }
    }
  }
  return kinds.map((kind, index) => {
    const along = (index % 3) - (long - 1) * 0.5;
    const over = Math.floor(index / 3) - (short - 1) * 0.5;
    return { kind, x: best.x + (best.upright ? over : along) * step, y: best.y + (best.upright ? along : over) * step };
  });
}

/** `seat` is whose screen this is: the callouts are worded for them. */
export function addEvents(scene: Scene, state: SwarmState, events: SwarmEvent[], now: number, seat: Seat): void {
  // Under the fog the feel, the shots and the calls are only of what the viewer can see.
  if (scene.fog) {
    state = fogOf(scene.fog, scene.map, state).state;
    events = state.events;
  }
  feelStep(scene.feel, scene.map, state, seat, now);
  builtEvents(scene.built, state, events, now, seat);
  for (const shot of state.shots) {
    // A mortar's or a ballista's kill is drawn by swarmArmoury as its shell or its bolt.
    if (shot.type) continue;
    scene.fx.push({ kind: 'shot', x: shot.x, y: shot.y, at: now, seat: shot.seat, tower: shot.tower });
    scene.firedAt[shot.tower] = now;
  }
  noteArmoury(scene, state, events, now);
  for (const event of events) {
    if (event.kind === 'hit') {
      scene.hitAt[event.hut] = now;
    } else if (event.kind === 'clash') {
      const p = pathPoint(scene.map, event.from, event.to, event.d / pathLength(scene.map, event.from, event.to));
      // A clash does not say who fought, and the units that did may be dead already. With two sides it can only have been them.
      const [seat, foe] = scene.map.sides.length === 2 ? scene.map.sides : [null, null];
      scene.fx.push({ kind: 'clash', x: p.x, y: p.y, at: now, seat, foe });
    } else if (event.kind === 'upgrade') {
      const site = scene.map.sites[event.hut];
      scene.fx.push({ kind: event.kind, x: site.x, y: site.y, at: now, seat: state.huts[event.hut].owner });
    } else if (event.kind === 'flag') {
      for (const hut of event.huts) scene.flagged[hut] = { at: now, seat: event.seat };
    } else if (event.kind === 'wave' || event.kind === 'rally') {
      // Every count a wave or a rally lands on jumps at once, and jolts as a hit's does so the eye is drawn to them.
      for (const hut of event.huts) scene.hitAt[hut] = now;
    }
    // A capture, and a unit lost to the spikes or the water, are drawn by swarmFeel.
    addPowerFx(scene.calls, scene.map, event, now);
  }
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


/**
 * The ground under a hut is at a fraction of a device pixel, and the sprite
 * goes down on whole ones. So the fraction is painted into the sprite: it is
 * then copied to the board pixel for pixel, with nothing resampled, and the hut
 * still stands exactly where its flags and its count are drawn.
 */
/** The side a hut is drawn as: its owner, or for a moment after the white flag, by turns the side that gave it up. */
export function ownerShown(scene: Scene, index: number, owner: Owner, now: number): Owner {
  const flagged = scene.flagged[index];
  if (owner !== null || !flagged) return owner;
  const beat = Math.floor((now - flagged.at) / YIELD_BEAT_MS);
  return beat >= 0 && beat < YIELD_BEATS && beat % 2 === 0 ? flagged.seat : owner;
}

function spriteOf(scene: Scene, index: number, owner: Owner, level: number): Sprite {
  const site = scene.map.sites[index];
  const key = `${index}|${owner}|${level}`;
  const cached = scene.sprites.get(key);
  if (cached) return cached;
  const r = siteRadius(site, level);
  const { scale } = scene;
  const left = Math.floor((site.x - r * 1.7) * scale);
  const top = Math.floor((site.y - r * 2.9) * scale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((site.x + r * 1.7) * scale) - left;
  canvas.height = Math.ceil((site.y + r * 0.7) * scale) - top;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(scale, 0, 0, scale, site.x * scale - left, site.y * scale - top);
    paintSite(ctx, mulberry32(scene.seed ^ Math.imul(index + 1, 0x85ebca6b)), scene.map.scene, site, owner, owner && scene.kinds[owner], level);
  }
  const sprite = { canvas, left, top };
  scene.sprites.set(key, sprite);
  return sprite;
}

// --- The units ---

/** The insects are drawn in their own small units and then enlarged to stand beside the huts. */
const UNIT_SCALE = 1.35;

/**
 * What an army has bought, worn by every unit of it in the pictures the tokens
 * sell it by: a line of air behind for each level of speed, and a shield on
 * the back that is bigger for each level of strength.
 */
function drawRank(ctx: CanvasRenderingContext2D, army: Army, tail: number, back: number, hair: number) {
  if (army.speed > 0) {
    ctx.strokeStyle = 'rgba(43, 36, 26, 0.5)';
    ctx.lineWidth = Math.max(0.5, hair);
    ctx.beginPath();
    for (let line = 0; line < army.speed; line++) {
      const y = (line - (army.speed - 1) / 2) * 1.5;
      ctx.moveTo(tail - 0.8 - Math.abs(y) * 0.5, y);
      ctx.lineTo(tail - 3.6, y);
    }
    ctx.stroke();
  }
  if (army.strength > 0) {
    const r = 1 + army.strength * 0.3;
    ctx.fillStyle = '#8a6a42';
    ellipse(ctx, back, 0, r, r);
    ctx.fill();
    ctx.strokeStyle = '#4a4640';
    ctx.lineWidth = Math.max(0.5, hair);
    ctx.stroke();
  }
}

/** One more round or oval in the path being built, on its own and not joined to the last by a line. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
}

/** No two ants of a nest are quite one brown, and it is what parts one from the next where they crowd. */
const ANT_COATS = [
  { leg: '#2a120b', body: '#4a1d10', back: '#6b2a17', head: '#3a160c' },
  { leg: '#27130b', body: '#43200f', back: '#61301a', head: '#33180b' },
  { leg: '#2c110b', body: '#531f13', back: '#74301b', head: '#41170d' },
  { leg: '#24100a', body: '#3d190f', back: '#592515', head: '#2f130a' },
];

type AntCoat = (typeof ANT_COATS)[number];

function paintAnt(ctx: CanvasRenderingContext2D, stride: number, coat: AntCoat, army: Army, hair: number) {
  ctx.strokeStyle = coat.leg;
  ctx.lineWidth = Math.max(0.55, hair);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let leg = -1; leg <= 1; leg++) {
    for (let side = -1; side <= 1; side += 2) {
      // Three feet down and three in the air: the front and hind of one side step with the middle of the other.
      const swing = Math.sin(stride + (leg === 0 ? side : -side) * (Math.PI / 2)) * 1.2;
      ctx.moveTo(leg * 1.1, side * 0.5);
      ctx.lineTo(leg * 1.6 + swing * 0.4, side * 2.3);
      ctx.lineTo(leg * 2.3 + swing, side * 3.5);
    }
  }
  const feel = Math.sin(stride * 0.5) * 0.35;
  ctx.moveTo(3.6, -0.5);
  ctx.lineTo(4.8, -1.7);
  ctx.lineTo(6, -1.3 + feel);
  ctx.moveTo(3.6, 0.5);
  ctx.lineTo(4.8, 1.7);
  ctx.lineTo(6, 1.3 + feel);
  ctx.stroke();
  ctx.fillStyle = coat.body;
  ellipse(ctx, -3.5, 0, 2.6, 1.9);
  ctx.fill();
  ctx.fillStyle = coat.back;
  ellipse(ctx, -3.7, -0.5, 1.5, 0.8);
  ctx.fill();
  ctx.fillStyle = coat.head;
  ctx.beginPath();
  blob(ctx, -1.3, 0, 0.6, 0.6);
  blob(ctx, 0.2, 0, 1.6, 1.2);
  blob(ctx, 2.8, 0, 1.45, 1.4);
  ctx.fill();
  drawRank(ctx, army, -6.1, 0.2, hair);
}

/** `flap` is how far open the wings are, from half to fully. */
function paintBee(ctx: CanvasRenderingContext2D, flap: number, army: Army, hair: number) {
  // The whole sweep of the wings faintly, and the wings where they are in it: too fast to be seen in one place.
  ctx.fillStyle = 'rgba(236, 238, 230, 0.16)';
  ctx.beginPath();
  blob(ctx, -0.4, -2.9, 2.4, 2.7, -0.5);
  blob(ctx, -0.4, 2.9, 2.4, 2.7, 0.5);
  ctx.fill();
  ctx.fillStyle = 'rgba(236, 238, 230, 0.4)';
  ctx.beginPath();
  blob(ctx, -0.4, -2.9 * flap, 2.2, 2.5 * flap, -0.5);
  blob(ctx, -0.4, 2.9 * flap, 2.2, 2.5 * flap, 0.5);
  ctx.fill();
  ctx.fillStyle = '#231a10';
  ctx.beginPath();
  ctx.moveTo(-4.1, -0.7);
  ctx.lineTo(-5.7, 0);
  ctx.lineTo(-4.1, 0.7);
  ctx.fill();
  ctx.fillStyle = '#d19a2e';
  ellipse(ctx, -0.8, 0, 3.7, 2.4);
  ctx.fill();
  // Each stripe is as tall as the body is where it crosses, so it follows the body's edge and does not stand out past it.
  ctx.fillStyle = '#231a10';
  ctx.beginPath();
  blob(ctx, -2.7, 0, 0.6, 2.05);
  blob(ctx, -0.5, 0, 0.6, 2.35);
  blob(ctx, 3.1, 0, 1.6, 1.6);
  ctx.fill();
  ctx.strokeStyle = '#231a10';
  ctx.lineWidth = Math.max(0.4, hair);
  ctx.beginPath();
  ctx.moveTo(4.2, -0.8);
  ctx.lineTo(5.5, -1.6);
  ctx.moveTo(4.2, 0.8);
  ctx.lineTo(5.5, 1.6);
  ctx.stroke();
  drawRank(ctx, army, -5.7, 1.3, hair);
}

/** A beetle is all shell: green-black with a bronze shine, or bronze through and through. */
const BEETLE_COATS = [
  { leg: '#141710', shell: '#1f2a1a', shine: '#5c6a3a', dark: '#10140c' },
  { leg: '#17120b', shell: '#3b2c15', shine: '#80652f', dark: '#1d150a' },
];

type BeetleCoat = (typeof BEETLE_COATS)[number];

/** The legs are short and the shell is wide and round, so at the size of an ant it reads as a pebble that walks and not as a thinner ant. */
function paintBeetle(ctx: CanvasRenderingContext2D, stride: number, coat: BeetleCoat, army: Army, hair: number) {
  ctx.strokeStyle = coat.leg;
  ctx.lineWidth = Math.max(0.6, hair);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let leg = -1; leg <= 1; leg++) {
    for (let side = -1; side <= 1; side += 2) {
      // The same three-and-three as an ant, in shorter steps.
      const swing = Math.sin(stride + (leg === 0 ? side : -side) * (Math.PI / 2)) * 0.8;
      ctx.moveTo(leg * 1.4 + 0.4, side * 1.8);
      ctx.lineTo(leg * 1.9 + 0.4 + swing * 0.4, side * 3.1);
      ctx.lineTo(leg * 2.4 + 0.4 + swing, side * 3.6);
    }
  }
  ctx.moveTo(3.8, -0.5);
  ctx.lineTo(4.9, -1.3);
  ctx.moveTo(3.8, 0.5);
  ctx.lineTo(4.9, 1.3);
  ctx.stroke();
  ctx.fillStyle = coat.dark;
  ctx.beginPath();
  blob(ctx, 2.4, 0, 1.3, 1.8);
  blob(ctx, 3.6, 0, 0.8, 0.9);
  ctx.fill();
  ctx.fillStyle = coat.shell;
  ellipse(ctx, -0.9, 0, 3.6, 2.8);
  ctx.fill();
  ctx.fillStyle = coat.shine;
  ellipse(ctx, -0.6, -1.3, 2.2, 0.6, -0.08);
  ctx.fill();
  // Where the two wing cases meet, down the middle of the back.
  ctx.strokeStyle = coat.dark;
  ctx.lineWidth = Math.max(0.45, hair);
  ctx.beginPath();
  ctx.moveTo(1.6, 0);
  ctx.lineTo(-4.3, 0);
  ctx.stroke();
  drawRank(ctx, army, -4.6, -1, hair);
}

/** Grey-brown, with dark bands across the back of the abdomen. */
const SPIDER_COATS = [
  { leg: '#3a3128', abdomen: '#75664f', band: '#3d342a', head: '#4a3f33' },
  { leg: '#2f2a24', abdomen: '#655d50', band: '#35302a', head: '#413b33' },
];

type SpiderCoat = (typeof SPIDER_COATS)[number];

/** Where each of a spider's four legs a side reaches, front to back, and where it bends. */
const SPIDER_FOOT = [4.6, 2.4, -0.7, -3];
const SPIDER_KNEE = [3.1, 1.8, 0.1, -1.6];

/** Eight bent legs round a small head and a big round body behind it: nothing else on the board has that outline. */
function paintSpider(ctx: CanvasRenderingContext2D, stride: number, coat: SpiderCoat, army: Army, hair: number) {
  ctx.strokeStyle = coat.leg;
  ctx.lineWidth = Math.max(0.5, hair);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let leg = 0; leg < 4; leg++) {
    for (let side = -1; side <= 1; side += 2) {
      // Four feet down and four up: the first and third of one side step with the second and fourth of the other.
      const swing = Math.sin(stride + (leg % 2 === 0 ? side : -side) * (Math.PI / 2)) * 0.9;
      ctx.moveTo(1.9 - leg * 0.4, side * 0.6);
      ctx.lineTo(SPIDER_KNEE[leg] + swing * 0.5, side * 3);
      ctx.lineTo(SPIDER_FOOT[leg] + swing, side * 4.4);
    }
  }
  ctx.stroke();
  ctx.fillStyle = coat.abdomen;
  ellipse(ctx, -2.5, 0, 2.5, 2.2);
  ctx.fill();
  ctx.fillStyle = coat.band;
  ctx.beginPath();
  blob(ctx, -1.6, 0, 0.45, 1.9);
  blob(ctx, -3.3, 0, 0.45, 1.6);
  ctx.fill();
  ctx.fillStyle = coat.head;
  ellipse(ctx, 1.3, 0, 1.6, 1.3);
  ctx.fill();
  drawRank(ctx, army, -5, -2.5, hair);
}

/** How many rows of the sheet a side of each creature takes: one for each coat it comes in, and a bee's one row of wing beats. */
const COATS = { ant: ANT_COATS.length, beetle: BEETLE_COATS.length, spider: SPIDER_COATS.length, bee: 1 } satisfies Record<Kind, number>;

/** A walker's legs come round to where they began once in this many poses, and an ant's feelers once in twice as many. */
const STRIDES = 12;
/** How many openings of a bee's wings are painted, from half to fully. */
const FLAPS = 8;
/** No part of a unit is further from its middle than this, in its own units: the lines of air behind the fastest ant come nearest. */
const UNIT_REACH = 10;
/** A pose is painted this many times the size it is seen at. It is turned to the way its unit faces as it is copied, and a picture turned at its own size goes soft. */
const SHEET_OVER = 2;

/** The rows of the sheet: each side in the game from the top, its creature's coats in turn, and the shadows last. */
export function sheetRows(sides: readonly Seat[], kinds: Record<Seat, Kind>): { first: Partial<Record<Seat, number>>; shadow: number } {
  const first: Partial<Record<Seat, number>> = {};
  let row = 0;
  for (const seat of sides) {
    first[seat] = row;
    row += COATS[kinds[seat]];
  }
  return { first, shadow: row };
}

/**
 * Several hundred units each drawn as a dozen shapes was most of a crowded
 * frame. A copy of a picture costs a fraction of that, so every pose is painted
 * once: a row for each coat of each side's creature with a walk along it, or
 * for bees their wings at each opening, and the shadows of walkers and fliers.
 * Only the sides in the game get rows.
 */
function sheetOf(scene: Scene, army: Record<Seat, Army>): Sheet {
  const { sides } = scene.map;
  const ranks = sides.map((seat) => `${army[seat].speed}|${army[seat].strength}`).join('|');
  if (scene.sheet && scene.sheet.ranks === ranks) return scene.sheet;
  const { first, shadow } = sheetRows(sides, scene.kinds);
  const res = scene.scale * UNIT_SCALE * SHEET_OVER;
  const cell = Math.ceil(UNIT_REACH * 2 * res);
  const canvas = document.createElement('canvas');
  canvas.width = cell * STRIDES * 2;
  canvas.height = cell * (shadow + 1);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // One pixel of the board is this wide here: a leg or a feeler thinner than that is a grey smear.
    const hair = SHEET_OVER / res;
    const pose = (column: number, row: number) => ctx.setTransform(res, 0, 0, res, (column + 0.5) * cell, (row + 0.5) * cell);
    const walk = (row: number, paint: (stride: number) => void) => {
      for (let step = 0; step < STRIDES * 2; step++) {
        pose(step, row);
        paint((step * Math.PI * 2) / STRIDES);
      }
    };
    for (const seat of sides) {
      const top = first[seat]!;
      const ranked = army[seat];
      const kind = scene.kinds[seat];
      if (kind === 'ant') ANT_COATS.forEach((coat, row) => walk(top + row, (stride) => paintAnt(ctx, stride, coat, ranked, hair)));
      else if (kind === 'beetle') BEETLE_COATS.forEach((coat, row) => walk(top + row, (stride) => paintBeetle(ctx, stride, coat, ranked, hair)));
      else if (kind === 'spider') SPIDER_COATS.forEach((coat, row) => walk(top + row, (stride) => paintSpider(ctx, stride, coat, ranked, hair)));
      else {
        for (let step = 0; step < FLAPS; step++) {
          pose(step, top);
          paintBee(ctx, 0.5 + (step / (FLAPS - 1)) * 0.5, ranked, hair);
        }
      }
    }
    pose(0, shadow);
    ctx.fillStyle = 'rgba(22, 30, 12, 0.22)';
    ellipse(ctx, 0, 0, 5.4, 2.3);
    ctx.fill();
    pose(1, shadow);
    ctx.fillStyle = 'rgba(22, 30, 12, 0.2)';
    ellipse(ctx, 0, 0, 3.4, 1.7);
    ctx.fill();
  }
  scene.sheet = { canvas, cell, res, ranks, first, shadow };
  return scene.sheet;
}

/**
 * Copies one pose to the board, turned and sized for its unit. It sets the
 * whole transform to do it, from `scale` device pixels to a world unit, and
 * whoever draws units puts the board's own back after the last of them.
 */
function stamp(ctx: CanvasRenderingContext2D, sheet: Sheet, scale: number, column: number, row: number, x: number, y: number, angle: number, size: number) {
  const k = (scale * size) / sheet.res;
  const cos = Math.cos(angle) * k;
  const sin = Math.sin(angle) * k;
  const { cell } = sheet;
  ctx.setTransform(cos, sin, -sin, cos, x * scale, y * scale);
  ctx.drawImage(sheet.canvas, column * cell, row * cell, cell, cell, -cell / 2, -cell / 2, cell, cell);
}

// --- The frame ---

/** From the middle of a hut's number down to the point of its bubble's tail. */
const BADGE_TAIL = 8;
const BADGE_DROP = 12 + BADGE_TAIL;
/** The least height a bubble's tail can point from and the whole bubble still be on the board. */
const BADGE_ROOM = BADGE_DROP + 15;
/** The least height, in CSS px, the figures of a count are drawn at: on a big map, or a board on a phone, the world's own 16 units come out smaller than can be read. */
const BADGE_MIN_PX = 10;
const badgeGrow = (px: number) => growOf(16, BADGE_MIN_PX, px);
/** Where the tail of a hut's bubble points: just over the highest thing on its site. */
const badgeTip = (site: Site, level: number) => site.y - siteTop(site, level) - 2;
/** A tall hut by the top edge leaves no room over its roof, so its bubble stands beside the peak. `grow` is how much larger than its world size the bubble is drawn. */
export const badgeAside = (site: Site, level: number, grow = 1) => badgeTip(site, level) < BADGE_ROOM * grow;

const countWidths = new Map<string, number>();

/** How wide a count is in the bubble's type at 16px. Measured once for each number that comes up. */
function countWidth(ctx: CanvasRenderingContext2D, text: string): number {
  let width = countWidths.get(text);
  if (width === undefined) {
    ctx.font = fontOf(700, 16);
    width = ctx.measureText(text).width;
    countWidths.set(text, width);
  }
  return width;
}

/** A note beside a count, such as how long ago it was seen: its size at a count's 16, and the gap before it. */
const NOTE_PX = 11;
const NOTE_GAP = 5;
const noteWidths = new Map<string, number>();

function noteWidth(ctx: CanvasRenderingContext2D, text: string): number {
  let width = noteWidths.get(text);
  if (width === undefined) {
    ctx.font = fontOf(600, NOTE_PX);
    width = ctx.measureText(text).width;
    noteWidths.set(text, width);
  }
  return width;
}

/**
 * A count in a speech bubble whose tail points at x, y; `aside` puts it up and
 * to the left of that point, not over it.
 *
 * Drawn in device pixels, `u` of them to one unit of the bubble, with its tip
 * and every straight edge on a whole one: a bubble laid down at a fraction of a
 * pixel has a grey line along each side, and this is the thing on the board
 * that is read most. It leaves the canvas in device pixels.
 */
function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, u: number, text: string, owner: Owner, aside: boolean, note?: string) {
  const tone = BADGE[owner ?? 'none'];
  const wide = countWidth(ctx, text);
  const extra = note === undefined ? 0 : noteWidth(ctx, note) + NOTE_GAP;
  const half = Math.round((Math.max(32, wide + extra + 18) * u) / 2);
  const tall = Math.round(12 * u);
  const tail = Math.round(BADGE_TAIL * u);
  const spread = Math.round(7 * u);
  const root = aside ? half - Math.round(16 * u) : 0;
  const tip = aside ? half : 0;
  const bubble = (drop: number) => {
    ctx.beginPath();
    ctx.roundRect(-half, drop - tall, half * 2, tall * 2, 9 * u);
    ctx.moveTo(root - spread, drop + tall - 1);
    ctx.lineTo(tip, drop + tall + tail);
    ctx.lineTo(root + spread, drop + tall - 1);
    ctx.closePath();
  };
  ctx.setTransform(1, 0, 0, 1, x - tip, y - tall - tail);
  ctx.fillStyle = 'rgba(20, 16, 10, 0.4)';
  bubble(Math.round(2 * u));
  ctx.fill();
  // Outlined before it is filled, so the join of body and tail is painted over.
  bubble(0);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 2 * Math.max(1, Math.round(1.1 * u));
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = tone.fill;
  ctx.fill();
  ctx.fillStyle = tone.text;
  ctx.font = fontOf(700, 16 * u);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, (-extra / 2) * u, 0.5 * u);
  if (note !== undefined) {
    ctx.font = fontOf(600, NOTE_PX * u);
    ctx.textAlign = 'left';
    ctx.globalAlpha *= 0.8;
    ctx.fillText(note, ((wide - extra) / 2 + NOTE_GAP) * u, 1 * u);
  }
}

const TOKEN_INK = '#2b241a';

/** A hut with a second storey built on and a pennant flying from it. */
function hutIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#b98a52';
  ctx.beginPath();
  ctx.moveTo(-8.5, 3);
  ctx.bezierCurveTo(-8.5, -4, 8.5, -4, 8.5, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#dcb274';
  ctx.beginPath();
  ctx.moveTo(-5, -2.4);
  ctx.bezierCurveTo(-5, -9, 5, -9, 5, -2.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = TOKEN_INK;
  ctx.beginPath();
  ctx.moveTo(-2, 3);
  ctx.bezierCurveTo(-2, -1.6, 2, -1.6, 2, 3);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(0, -7.2);
  ctx.lineTo(0, -13);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(5.5, -11.4);
  ctx.lineTo(0, -9.8);
  ctx.closePath();
  ctx.fill();
}

/** A wing, and the air it has left behind. */
function speedIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#d6e6ea';
  ctx.beginPath();
  ctx.moveTo(-3, 3.5);
  ctx.bezierCurveTo(-4, -6, 5, -12.5, 10.5, -9);
  ctx.bezierCurveTo(11.5, -3, 4, 3.5, -3, 3.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-3, 3.5);
  ctx.quadraticCurveTo(1, -5, 9.5, -8.4);
  ctx.moveTo(-3, 3.5);
  ctx.quadraticCurveTo(4, -2, 9, -4.5);
  ctx.moveTo(-3, 3.5);
  ctx.quadraticCurveTo(-2, -4, 3.5, -9);
  ctx.stroke();
  ctx.lineWidth = 1.7;
  ctx.beginPath();
  ctx.moveTo(-11, -7.5);
  ctx.lineTo(-5.5, -7.5);
  ctx.moveTo(-12.5, -3);
  ctx.lineTo(-6.5, -3);
  ctx.moveTo(-10.5, 1.5);
  ctx.lineTo(-6.5, 1.5);
  ctx.stroke();
}

/** A round shield of planks, rimmed and bossed with iron. */
function strengthIcon(ctx: CanvasRenderingContext2D) {
  const r = 8;
  ctx.translate(0, -3.5);
  ctx.fillStyle = '#b07f44';
  ellipse(ctx, 0, 0, r, r);
  ctx.fill();
  ctx.strokeStyle = 'rgba(43, 36, 26, 0.55)';
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  for (const x of [-4.5, -1.5, 1.5, 4.5]) {
    const reach = Math.sqrt(r * r - x * x);
    ctx.moveTo(x, -reach);
    ctx.lineTo(x, reach);
  }
  ctx.stroke();
  ctx.strokeStyle = '#4a4640';
  ctx.lineWidth = 2;
  ellipse(ctx, 0, 0, r, r);
  ctx.stroke();
  ctx.fillStyle = '#4a4640';
  ellipse(ctx, 0, 0, 2.8, 2.8);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ellipse(ctx, -0.8, -0.9, 1, 1);
  ctx.fill();
}

const TOKEN_ICON: Record<Upgrade | 'burn', (ctx: CanvasRenderingContext2D) => void> = { hut: hutIcon, speed: speedIcon, strength: strengthIcon, burn: flameIcon, ...ARMOURY_ICON };

function drawToken(ctx: CanvasRenderingContext2D, kind: Upgrade | 'burn', x: number, y: number, grow: number, cost: number, affordable: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(grow, grow);
  ctx.fillStyle = 'rgba(20, 16, 10, 0.4)';
  ellipse(ctx, 0, 2, TOKEN_R, TOKEN_R);
  ctx.fill();
  // One that cannot be paid for yet stays in place with its picture faded, and its price as plain as ever.
  ctx.fillStyle = affordable ? '#f6efdc' : '#cfc8b8';
  ellipse(ctx, 0, 0, TOKEN_R, TOKEN_R);
  ctx.fill();
  ctx.strokeStyle = TOKEN_INK;
  ctx.lineWidth = 1.6;
  ellipse(ctx, 0, 0, TOKEN_R - 0.8, TOKEN_R - 0.8);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(43, 36, 26, 0.25)';
  ctx.lineWidth = 0.8;
  ellipse(ctx, 0, 0, TOKEN_R - 3.2, TOKEN_R - 3.2);
  ctx.stroke();

  ctx.save();
  ctx.globalAlpha = affordable ? 1 : 0.4;
  ctx.strokeStyle = TOKEN_INK;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  TOKEN_ICON[kind](ctx);
  ctx.restore();

  ctx.fillStyle = TOKEN_INK;
  ctx.strokeStyle = '#f6efdc';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-11, 6.5, 22, 12.5, 6.25);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fbf7ee';
  ctx.font = fontOf(700, 10);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(cost), 0, 13.2);
  ctx.restore();
}

/** A tower's shot: smoke at the top of the tower, the ball over its shadow with its smoke hanging behind it, and what it throws up where it lands. */
function drawShot(ctx: CanvasRenderingContext2D, scene: Scene, fx: Fx, now: number) {
  const from = scene.map.sites[fx.tower!];
  const rise = TOWER_H + TOWER_BALL;
  const age = now - fx.at;
  const ice = scene.map.scene === 'ice';
  // Thrown a little upward and then falling faster and faster, which is what makes it a ball and not a thing on a wire.
  const lift = (f: number) => rise * (1 + 0.35 * f - 1.35 * f * f);
  const smoke = ice ? '#c2d0dc' : '#5b534a';

  if (age < MUZZLE_MS) {
    const m = age / MUZZLE_MS;
    const reach = Math.hypot(fx.x - from.x, fx.y - from.y + rise) || 1;
    const ux = (fx.x - from.x) / reach;
    const uy = (fx.y - from.y + rise) / reach;
    ctx.fillStyle = '#5b534a';
    ctx.globalAlpha = 0.45 * (1 - m);
    for (let puff = 0; puff < 2; puff++) {
      const out = 9 + m * (12 - puff * 6);
      ellipse(ctx, from.x + ux * out, from.y - rise + uy * out - m * (4 + puff * 4), 4.5 + m * (7 - puff * 3), 4 + m * (6 - puff * 3));
      ctx.fill();
    }
  }

  ctx.fillStyle = '#5b534a';
  for (let puff = 1; puff <= 6; puff++) {
    const f = puff / 7;
    const hung = (age - f * SHOT_LAND_MS) / TRAIL_MS;
    if (hung < 0 || hung >= 1) continue;
    // Each puff stays where the ball left it, lifting and thinning.
    ctx.globalAlpha = 0.3 * (1 - hung) * (1 - hung);
    const r = 1.8 + hung * 3;
    ellipse(ctx, from.x + (fx.x - from.x) * f, from.y + (fx.y - from.y) * f - lift(f) - hung * 7, r, r);
    ctx.fill();
  }

  if (age < SHOT_LAND_MS) {
    const f = age / SHOT_LAND_MS;
    const x = from.x + (fx.x - from.x) * f;
    const y = from.y + (fx.y - from.y) * f;
    // The shadow runs along the ground to the mark, and gathers and darkens as the ball comes down on it.
    ctx.globalAlpha = 0.2 + 0.25 * f;
    ctx.fillStyle = '#16190e';
    ellipse(ctx, x, y, 8 - 3 * f, 3.8 - 1.4 * f);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#121314';
    ellipse(ctx, x, y - lift(f), 3.9, 3.9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    ellipse(ctx, x - 1.2, y - lift(f) - 1.3, 1.1, 1.1);
    ctx.fill();
    return;
  }

  const burst = (age - SHOT_LAND_MS) / SHOT_IMPACT_MS;
  if (burst < 0.3) {
    // Dirt first, and in it for a few frames what little of the ball's fire there is to see. Ice has nothing to burn.
    const q = burst / 0.3;
    ctx.globalAlpha = 0.55 * (1 - q);
    ctx.fillStyle = ice ? '#dfe8ee' : '#3a2a1c';
    ellipse(ctx, fx.x, fx.y, 7 + q * 9, 3.2 + q * 3.8);
    ctx.fill();
    if (!ice && q < 0.6) {
      ctx.globalAlpha = 0.8 * (1 - q / 0.6);
      ctx.fillStyle = '#b5622a';
      ellipse(ctx, fx.x, fx.y, 3.2 + q * 2.4, 1.5 + q * 1.1);
      ctx.fill();
    }
  }
  if (burst > 0.1) {
    const s = (burst - 0.1) / 0.9;
    ctx.fillStyle = smoke;
    ctx.globalAlpha = 0.4 * (1 - s);
    for (let puff = 0; puff < 3; puff++) {
      ellipse(ctx, fx.x + (puff - 1) * 5 * (1 + s), fx.y - 3 - s * (13 + puff * 4), 4 + s * 6, 3.4 + s * 5);
      ctx.fill();
    }
  }
  // What the ground is made of, thrown out and falling back, and one ember with it. On ice all of it is snow.
  const out = easeOut(burst);
  const up = Math.sin(Math.PI * Math.min(1, burst * 1.2));
  ctx.globalAlpha = 0.9 * (1 - burst * burst);
  for (let clod = 0; clod < 4; clod++) {
    const angle = clod * 1.26 + fx.at;
    if (ice) ctx.fillStyle = '#f6fafc';
    else ctx.fillStyle = clod < 3 ? '#3d2f20' : '#7a3a18';
    const r = 2.1 - burst * 0.8;
    ellipse(ctx, fx.x + Math.cos(angle) * out * (12 + (clod % 3) * 4), fx.y + Math.sin(angle) * out * (5 + (clod % 3) * 2) - up * (7 + (clod % 2) * 5), r, r);
    ctx.fill();
  }
}

function drawFx(ctx: CanvasRenderingContext2D, scene: Scene, now: number) {
  for (const fx of scene.fx) {
    // The burn is the ball's, so it is not there before the ball is; and one that came down unwatched has burnt the ground all the same.
    if (fx.kind !== 'shot' || fx.landed || now - fx.at < SHOT_LAND_MS) continue;
    fx.landed = true;
    scene.scorches.push({ x: fx.x, y: fx.y });
    if (scene.scorches.length > SCORCH_MAX) scene.scorches.shift();
    const ground = scene.ground?.getContext('2d');
    if (ground) paintScorch(ground, fx.x, fx.y);
  }
  let kept = 0;
  for (const fx of scene.fx) if (now - fx.at < FX_MS[fx.kind]) scene.fx[kept++] = fx;
  scene.fx.length = kept;
  const ice = scene.map.scene === 'ice';
  for (const fx of scene.fx) {
    const t = (now - fx.at) / FX_MS[fx.kind];
    if (fx.kind === 'clash') {
      // A scuffle kicks up what is underfoot where the two columns met: dust, two clods, and one fleck of each side when it is known who they were.
      ctx.fillStyle = ice ? '#f1f6fa' : '#e2d0aa';
      ctx.globalAlpha = 0.5 * (1 - t);
      for (let puff = 0; puff < 3; puff++) {
        const angle = puff * 2.1 + fx.at;
        ellipse(ctx, fx.x + Math.cos(angle) * t * 9, fx.y + Math.sin(angle) * t * 5 - t * 4, 2 + t * 3.4, 1.6 + t * 2.6);
        ctx.fill();
      }
      ctx.globalAlpha = 0.8 * (1 - t * t);
      const out = easeOut(t);
      for (let fleck = 0; fleck < 4; fleck++) {
        const angle = fleck * 1.57 + fx.at * 1.3;
        const side = fleck === 2 ? fx.seat : fleck === 3 ? fx.foe : null;
        ctx.fillStyle = side ? BADGE[side].fill : ice ? '#8fa3b3' : '#5a4632';
        ellipse(ctx, fx.x + Math.cos(angle) * out * 10, fx.y + Math.sin(angle) * out * 5 - Math.sin(Math.PI * t) * (4 + fleck), 1.2, 1.2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      continue;
    }
    if (fx.kind === 'shot') {
      drawShot(ctx, scene, fx, now);
      ctx.globalAlpha = 1;
      continue;
    }
    // Something was built here: one line drawn round the hut that paid, and the dust of the work settling at its foot.
    const out = easeOut(t);
    const r = 46 + out * 8;
    ctx.globalAlpha = 0.5 * (1 - t);
    ellipse(ctx, fx.x, fx.y + 2, r, r * 0.4);
    ctx.strokeStyle = '#2b241a';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = ice ? '#f1f6fa' : '#e2d0aa';
    ctx.globalAlpha = 0.45 * (1 - t);
    for (let puff = 0; puff < 3; puff++) {
      ellipse(ctx, fx.x + (puff - 1) * (16 + out * 8), fx.y + 9 - Math.abs(puff - 1) * 3 - out * 3, 4 + out * 5, 2.4 + out * 2.6);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/** The river catching the light: short strokes that brighten and fade, each sliding a little way downstream. */
function drawShimmer(ctx: CanvasRenderingContext2D, scene: Scene, now: number) {
  ctx.strokeStyle = '#dfe9ea';
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.9;
  for (const glint of scene.glints) {
    const lit = Math.sin(now * 0.0017 + glint.phase);
    if (lit <= 0) continue;
    const slide = lit * 5;
    ctx.globalAlpha = lit * 0.26;
    ctx.beginPath();
    ctx.moveTo(glint.x + glint.dx * (slide - 3.5), glint.y + glint.dy * (slide - 3.5));
    ctx.lineTo(glint.x + glint.dx * (slide + 3.5), glint.y + glint.dy * (slide + 3.5));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** While a send is being aimed, every tower that would fire on it shows how far it reaches. */
function drawRanges(ctx: CanvasRenderingContext2D, map: SwarmMap, state: SwarmState, view: View) {
  ctx.setLineDash([7, 7]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = map.scene === 'ice' ? 'rgba(30, 54, 92, 0.6)' : 'rgba(255, 255, 255, 0.6)';
  state.huts.forEach((hut, index) => {
    if (!isTower(hut) || allied(map, hut.owner, view.seat) || view.sight?.unseen.has(index)) return;
    ellipse(ctx, map.sites[index].x, map.sites[index].y, reachOf(map, hut), reachOf(map, hut));
    ctx.stroke();
    drawBlind(ctx, map.sites[index], hut);
  });
  ctx.setLineDash([]);
}

/** A unit on the march, placed for this frame. */
interface Marcher {
  x: number;
  y: number;
  angle: number;
  /** How far along its path it is drawn. */
  d: number;
  /** How much of it is through the door of the hut it is leaving or reaching, 0 to 1. */
  out: number;
  id: number;
  /** Its id scrambled, for what is its own: its size, its coat, how high it flies. */
  own: number;
  size: number;
  /** The row of the sheet its coat is on, or a bee's row of wing beats. */
  row: number;
}

/** How strongly the viewer's own decoys are drawn: they are there, and the viewer is not to take them for an army. */
const DECOY_FAINT = 0.45;

/** How much wider than the path's own column a column of bees flies: the banks of a track do not hem in what is over them. */
const BEE_ROOM = 2.5;

/** How many places of units long gone are kept before they are cleared out. */
const SLOTS_SPARE = 400;

/**
 * Ants, beetles and spiders walk the ground between the huts, so they and the
 * huts are drawn back to front together. Bees fly over everything.
 */
function drawStanding(ctx: CanvasRenderingContext2D, scene: Scene, state: SwarmState, view: View, scale: number) {
  const { map, rows, bands } = scene;
  const sheet = sheetOf(scene, state.army);
  const ants: Marcher[] = [];
  const bees: Marcher[] = [];
  const paceOf = paceShown(map, state);
  for (const unit of state.units) {
    const kind = scene.kinds[unit.seat];
    const length = pathLength(map, unit.from, unit.to);
    // Everything that tells one unit from the next is read off its id, so it is the same unit in every frame.
    const own = Math.imul(unit.id, 0x9e3779b1) >>> 0;
    // The engine lets them out on the beat. Each is drawn a little ahead of its place or behind, so the column does not tick past like a ruler.
    const d = Math.min(length, Math.max(0, unit.d + paceOf(unit) * view.alpha + ((own >>> 16) % 7 - 3) * 0.5));
    const column = unit.from * 64 + unit.to;
    const key = unit.id * 4096 + column;
    let slot = scene.slots.get(key);
    if (slot === undefined) {
      slot = scene.sent[column]++;
      scene.slots.set(key, slot);
    }
    const out = outOfDoors(d, length, siteRadius(map.sites[unit.from], state.huts[unit.from].level), siteRadius(map.sites[unit.to], state.huts[unit.to].level)) * tunnelSight(map, unit, d, length, view.seat);
    if (out === 0) continue;
    const p = pathPoint(map, unit.from, unit.to, d / length);
    // A column fills the path it is on, so it thins on a track and spreads on a highway.
    const reach = (7 * LANE[pathOf(map, unit.from, unit.to)!.kind] + (kind === 'bee' ? BEE_ROOM : 0)) * fileOf(slot) + ((own >>> 12) % 7 - 3) * 0.2;
    const lane = reach * spreadAt(d, length);
    // While the column is opening out of a door or closing on one, each unit walks the way it is going, not sideways.
    const angle = p.angle + Math.atan(reach * (spreadAt(d + 1, length) - spreadAt(d, length)));
    (kind === 'bee' ? bees : ants).push({
      x: p.x - Math.sin(p.angle) * lane,
      y: p.y + Math.cos(p.angle) * lane,
      angle,
      d,
      out: unit.decoy && unit.seat === view.seat ? out * DECOY_FAINT : out,
      id: unit.id,
      own,
      size: UNIT_SCALE * (0.92 + ((own >>> 8) % 9) * 0.02),
      row: sheet.first[unit.seat]! + ((own >>> 20) % COATS[kind]),
    });
  }
  if (scene.slots.size > state.units.length + SLOTS_SPARE) {
    const live = new Map<number, number>();
    for (const unit of state.units) {
      const key = unit.id * 4096 + unit.from * 64 + unit.to;
      live.set(key, scene.slots.get(key)!);
    }
    scene.slots = live;
  }

  // Every shadow goes down before any body, or the shadow of one ant falls across the back of the next and a crowd goes dark.
  for (const ant of ants) {
    ctx.globalAlpha = ant.out;
    stamp(ctx, sheet, scale, 0, sheet.shadow, ant.x + 1.2, ant.y + 2, ant.angle, ant.size);
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  // An ant is drawn over the ants that left before it, wherever the path leads: it is the head of the one behind that shows in a crush, and a column of heads is a column of ants.
  for (const band of bands) band.length = 0;
  for (const ant of ants) {
    let row = 0;
    while (row < rows.length && map.sites[rows[row]].y <= ant.y) row++;
    bands[row].push(ant);
  }
  for (let row = 0; row <= rows.length; row++) {
    for (const ant of bands[row]) {
      ctx.globalAlpha = ant.out;
      const step = Math.floor(((ant.d * 0.55 + ant.id) * STRIDES) / (Math.PI * 2)) % (STRIDES * 2);
      stamp(ctx, sheet, scale, step, ant.row, ant.x, ant.y, ant.angle + Math.sin(ant.d * 0.09 + ant.id) * 0.07, ant.size);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    if (row === rows.length) break;
    const index = rows[row];
    const site = map.sites[index];
    const hut = state.huts[index];
    const shown = ownerShown(scene, index, hut.owner, view.now);
    const sprite = spriteOf(scene, index, shown, hut.level);
    if (hut.drowned) {
      const painted = scene.scale;
      drawDrowned(ctx, map, index, hut.level, view.now, () => ctx.drawImage(sprite.canvas, sprite.left / painted, sprite.top / painted, sprite.canvas.width / painted, sprite.canvas.height / painted));
      continue;
    }
    // A tower that has just fired is pressed down on its foot by the shot and stands up again.
    const spent = isTower(hut) ? Math.min(1, (view.now - scene.firedAt[index]) / RECOIL_MS) : 1;
    const stand = 1 - 0.035 * (1 - spent) * (1 - spent);
    if (stand === 1 && scene.scale === scale) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(sprite.canvas, sprite.left, sprite.top);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
    } else {
      // Stretched, and so softened: for the moment of a recoil, or while the board is being dragged to a new size.
      const painted = scene.scale;
      ctx.drawImage(sprite.canvas, sprite.left / painted, site.y - (site.y - sprite.top / painted) * stand, sprite.canvas.width / painted, (sprite.canvas.height / painted) * stand);
    }
    drawFlags(ctx, map.scene, site, shown, shown && scene.kinds[shown], hut.level, view.now);
    drawKit(ctx, site, hut);
  }

  // A bee flies, so its shadow is on the ground below and it is drawn above it. They do not all fly at one height.
  for (const bee of bees) {
    ctx.globalAlpha = bee.out;
    stamp(ctx, sheet, scale, 1, sheet.shadow, bee.x + 3, bee.y + 1.5, bee.angle, bee.size);
  }
  for (const bee of bees) {
    const beat = view.now * 0.05 + bee.id;
    ctx.globalAlpha = bee.out;
    stamp(ctx, sheet, scale, Math.round(Math.abs(Math.sin(beat)) * (FLAPS - 1)), bee.row, bee.x, bee.y - 9 - ((bee.own >>> 20) % 5) + Math.sin(beat * 0.21) * 1.2, bee.angle, bee.size);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

/** How strongly a count last seen a while ago is drawn. */
const MEMORY_ALPHA = 0.6;

function drawCounts(ctx: CanvasRenderingContext2D, scene: Scene, state: SwarmState, view: View, scale: number, px: number) {
  const grow = badgeGrow(px);
  state.huts.forEach((hut, index) => {
    if (hut.drowned) return;
    const site = scene.map.sites[index];
    const jolt = Math.max(0, 1 - (view.now - scene.hitAt[index]) / 220);
    const aside = badgeAside(site, hut.level, grow);
    const no = view.refused?.hut === index ? (view.now - view.refused.at) / REFUSED_MS : 1;
    const shake = no < 1 ? Math.sin(no * Math.PI * 5) * 6 * (1 - no) : 0;
    const x = (aside ? site.x - siteRadius(site, hut.level) * 0.34 : site.x) + shake;
    const y = Math.max(BADGE_ROOM * grow, badgeTip(site, hut.level));
    const memory = view.sight?.unseen.has(index) ? view.sight.memory[index] : null;
    // Out of sight, the count is the one last seen, faded and with how long ago; a hut never seen is a question.
    if (view.sight?.unseen.has(index)) ctx.globalAlpha = MEMORY_ALPHA;
    const text = view.sight?.unknown.has(index) ? '?' : String(hut.n);
    drawBadge(ctx, Math.round(x * scale), Math.round(y * scale), scale * grow * (1 + jolt * 0.22), text, hut.owner, aside, memory ? ageOf(memory, state.tick, TICK_MS) : undefined);
    ctx.globalAlpha = 1;
  });
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

/** The size of each watched board in device pixels, as the browser last laid it out. */
const boxes = new WeakMap<HTMLCanvasElement, { w: number; h: number }>();

/** A board's size in device pixels worked out from its CSS box, which is right to within a pixel. */
function measured(canvas: HTMLCanvasElement): { w: number; h: number } {
  const box = canvas.getBoundingClientRect();
  return { w: Math.round(box.width * window.devicePixelRatio), h: Math.round(box.height * window.devicePixelRatio) };
}

/**
 * Has the browser say how many device pixels a board covers, whenever that
 * changes. A canvas with any other number of pixels is stretched to fit, and
 * everything on it is softened. Returns what stops the watching.
 */
export function watchBoard(canvas: HTMLCanvasElement): () => void {
  // Safari does not report the box in device pixels, and is given the next best thing.
  const exact = 'devicePixelContentBoxSize' in ResizeObserverEntry.prototype;
  const observer = new ResizeObserver(([entry]) => {
    boxes.set(canvas, exact ? { w: entry.devicePixelContentBoxSize[0].inlineSize, h: entry.devicePixelContentBoxSize[0].blockSize } : measured(canvas));
  });
  observer.observe(canvas, { box: exact ? 'device-pixel-content-box' : 'content-box' });
  return () => {
    observer.disconnect();
    boxes.delete(canvas);
  };
}

/** A board that is changing size is drawn from the ground it has, stretched, until it has kept one size this long: a ground takes several frames to paint, and a window being dragged changes size on every one. */
const SETTLE_MS = 140;

export function drawScene(canvas: HTMLCanvasElement, scene: Scene, state: SwarmState, view: View): void {
  const sight = scene.fog && fogOf(scene.fog, scene.map, state);
  if (sight) {
    state = sight.state;
    view = { ...view, sight };
  }
  const box = boxes.get(canvas) ?? measured(canvas);
  if (box.w === 0 || box.h === 0) return;
  buildUp(scene, state);
  const { map } = scene;
  if (canvas.width !== box.w || canvas.height !== box.h) {
    canvas.width = box.w;
    canvas.height = box.h;
    scene.sizedAt = view.now;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  // The box is the map's shape to within a pixel. The larger of the two fits leaves no edge of it unpainted.
  const scale = Math.max(canvas.width / map.w, canvas.height / map.h);

  if (!scene.ground || (scene.scale !== scale && view.now - scene.sizedAt >= SETTLE_MS)) {
    scene.scale = scale;
    scene.sprites.clear();
    scene.sheet = null;
    scene.ground = document.createElement('canvas');
    scene.ground.width = canvas.width;
    scene.ground.height = canvas.height;
    const ground = scene.ground.getContext('2d');
    if (ground) {
      ground.scale(scale, scale);
      paintGround(ground, map, scene.seed, scene.rivers);
      for (const scorch of scene.scorches) paintScorch(ground, scorch.x, scorch.y);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (scene.scale === scale) ctx.drawImage(scene.ground, 0, 0);
  else ctx.drawImage(scene.ground, 0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawShimmer(ctx, scene, view.now);
  drawUnder(ctx, scene.feel, map, state, view.now);
  drawAllies(ctx, map, state, view.seat);
  drawFlood(ctx, map, state, state.tick + view.alpha);

  if (scene.standing.tick !== state.tick) scene.standing = { tick: state.tick, legs: standingOf(map, state, view.seat) };
  // World units to a CSS pixel: a finger is the same size on every board.
  const px = window.devicePixelRatio / scale;
  drawBuiltUnder(ctx, map, state, scene.built, view.seat, view.now, view.alpha, px);
  const aim = aimOf(map, state, view, px);
  if (view.drag) drawRanges(ctx, map, state, view);
  drawAimUnder(ctx, map, state, view, scene.standing.legs, aim);
  drawPicks(ctx, map, state, view);
  drawStanding(ctx, scene, state, view, scale);
  drawFx(ctx, scene, view.now);
  drawModes(ctx, map, state, view.alpha, px);
  drawCalls(ctx, scene.calls, view.now);
  drawArmoury(ctx, scene, state, view.now, view.alpha);
  if (sight) drawMist(ctx, (scene.mist ??= newMist(map)), sight);
  drawRain(ctx, map, state, state.tick + view.alpha, view.now);
  drawCounts(ctx, scene, state, view, scale, px);
  drawBuiltOver(ctx, map, state, scene.built, view.drag ? null : view.selected, view.now, px);

  if (view.selected !== null && !view.drag) {
    const hut = state.huts[view.selected];
    const grow = tokenGrow(px);
    for (const spot of upgradeSpots(map, state, view.selected, px)) {
      const cost = upgradeCost(map, state, view.selected, spot.kind);
      if (cost !== null) drawToken(ctx, spot.kind, spot.x, spot.y, grow, cost, sendSize(hut, 'all') >= cost);
    }
    for (const spot of burnSpots(map, state, view.selected)) drawToken(ctx, 'burn', spot.x, spot.y, grow, spot.cost, sendSize(hut, 'all') >= spot.cost);
  }
  if (view.threat) drawThreats(ctx, map, state, view.threat, view.now, px);
  drawOver(ctx, scene.feel, map, state, view.now, px);
  if (aim) drawAimOver(ctx, map, state, view, aim, px);
}
