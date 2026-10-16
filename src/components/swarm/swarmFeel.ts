// Swarm's feel: what the board does in answer to the game, and what it does
// on its own while nothing is happening.
//
// Nothing here changes the game. It is told the state after every tick and
// keeps its own record of the tick before, so what died where, which hut
// changed hands and what is worth saying to the viewer are all read from the
// difference between the two. What is drawn every frame is a function of the
// seed and the clock, so the two players see the same wind and the same snow.

import {
  cloneState,
  countOf,
  mulberry32,
  pathLength,
  speedOf,
  type Hut,
  type Kind,
  type Seat,
  type SwarmMap,
  type SwarmState,
  type Unit,
} from '../../swarmGameLogic';
import { BADGE, LANE, PATH_W, areaOf, crossingsOf, fontOf, growOf, pathPoint, riverDir, riverOf, siteRadius, summitOf, type Crossing } from './swarmSceneKit';
import { WIND } from './swarmSceneGround';
import { momentumStep, newMomentum, type Momentum, type MomentumKey } from './swarmMomentum';

const TAU = Math.PI * 2;

/** What a dead unit leaves on the ground: ants a dark red-brown, bees a darker amber than they fly in, beetles near black, spiders a dark grey-brown. */
const STAIN: Record<Kind, string> = { ant: '#4d1c12', bee: '#75501a', beetle: '#1e211a', spider: '#3a3229' };
const DUST = '#d2c3a2';

const laneKey = (a: number, b: number): number => Math.min(a, b) * 64 + Math.max(a, b);

function hash01(n: number): number {
  let h = Math.imul(n + 1, 0x9e3779b1) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  return (h % 1000) / 1000;
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
const smooth = (t: number): number => t * t * (3 - 2 * t);

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx);
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
}

// The callouts.

/** What a side drawn as each creature is called, and one of its units. */
export const KIND_NAME: Record<Kind, { many: string; one: string }> = {
  ant: { many: 'Ants', one: 'ant' },
  bee: { many: 'Bees', one: 'bee' },
  beetle: { many: 'Beetles', one: 'beetle' },
  spider: { many: 'Spiders', one: 'spider' },
};

export type CalloutKey =
  | 'lastHut'
  | 'enemyAtGate'
  | 'towerLost'
  | 'fortLost'
  | 'flagRaised'
  | 'towerTaken'
  | 'fortTaken'
  | 'bridgeHeld'
  | 'backFromOne'
  | 'overtime'
  | MomentumKey;

/** Most pressing first: when several are due at once, bad news is read before good. */
export const CALLOUT_ORDER: readonly CalloutKey[] = [
  'overtime',
  'lastHut',
  'enemyAtGate',
  'towerLost',
  'fortLost',
  'flagRaised',
  'towerTaken',
  'fortTaken',
  'held',
  'rout',
  'bridgeHeld',
  'backFromOne',
  'run',
];

export const CALLOUT_TEXT: Record<CalloutKey, string> = {
  lastHut: 'Last hut',
  enemyAtGate: 'Enemy at the gate',
  towerLost: 'Tower lost',
  fortLost: 'Fort lost',
  flagRaised: 'White flag raised',
  towerTaken: 'Tower taken',
  fortTaken: 'Fort taken',
  bridgeHeld: 'Bridge held',
  backFromOne: 'Back from one hut',
  overtime: 'Overtime',
  // Said with their numbers in (see swarmMomentum): these are only what the banner falls back on.
  run: 'Run',
  rout: 'Rout',
  held: 'Held',
};

/** Enemy units on the road to the viewer's home before it is called a column. */
export const GATE_COLUMN = 8;

/** The hut a seat starts the match in, which a draft can move off the map's. */
export function homeOf(map: SwarmMap, state: SwarmState, seat: Seat): number {
  return state.homes[map.sides.indexOf(seat)];
}

function marchingOn(state: SwarmState, hut: number, seat: Seat): number {
  let count = 0;
  for (const unit of state.units) if (unit.dest === hut && unit.seat !== seat) count++;
  return count;
}

const holdsBridge = (state: SwarmState, map: SwarmMap, seat: Seat): boolean =>
  map.paths.some((path) => path.kind === 'bridge' && state.huts[path.a].owner === seat && state.huts[path.b].owner === seat);

/**
 * What is worth telling `seat` about the step from `before` to `after`. Every
 * one is a change and not a condition, so a state that stays as it is says
 * nothing a second time. `reduced` is whether the viewer has been down to one
 * hut since they last got back from it: without it, the first hut anyone takes
 * in a match would read as a comeback.
 */
export function calloutsFor(before: SwarmState, after: SwarmState, map: SwarmMap, seat: Seat, reduced: boolean): CalloutKey[] {
  // The viewer's own white flag gives up every hut at once: none of that is news to them.
  if (after.yielded.includes(seat) && !before.yielded.includes(seat)) return [];
  const due = new Set<CalloutKey>();
  // Its huts stand open, with their units in them, for whoever gets there first.
  if (after.yielded.length > before.yielded.length) due.add('flagRaised');
  after.huts.forEach((hut, index) => {
    const was = before.huts[index].owner;
    if (was === hut.owner) return;
    const site = map.sites[index];
    if (hut.owner === seat) {
      if (site.tower) due.add('towerTaken');
      if (site.fort) due.add('fortTaken');
    } else if (was === seat) {
      if (site.tower) due.add('towerLost');
      if (site.fort) due.add('fortLost');
    }
  });

  const hutsWas = countOf(before, seat).huts;
  const huts = countOf(after, seat).huts;
  if (hutsWas > 1 && huts === 1) due.add('lastHut');
  if (reduced && hutsWas === 1 && huts > 1) due.add('backFromOne');

  if (!holdsBridge(before, map, seat) && holdsBridge(after, map, seat)) due.add('bridgeHeld');
  if (before.tick < map.ticks && after.tick >= map.ticks && after.winner === null) due.add('overtime');

  const home = homeOf(map, after, seat);
  if (
    home !== -1 &&
    after.huts[home].owner === seat &&
    marchingOn(before, home, seat) < GATE_COLUMN &&
    marchingOn(after, home, seat) >= GATE_COLUMN
  ) {
    due.add('enemyAtGate');
  }
  return CALLOUT_ORDER.filter((key) => due.has(key));
}

/** The words on a callout's banner. A white flag names the creatures that raised it. */
export function calloutWords(callout: Callout, kinds: Record<Seat, Kind>): string {
  if (callout.text !== undefined) return callout.text;
  return callout.key === 'flagRaised' && callout.seat ? `${KIND_NAME[kinds[callout.seat]].many} raised the white flag` : CALLOUT_TEXT[callout.key];
}

/** A banner comes in, is read, and goes. */
export const BANNER_MS = { in: 180, hold: 1500, out: 260 };
export const BANNER_TOTAL_MS = BANNER_MS.in + BANNER_MS.hold + BANNER_MS.out;
/** Bare board between two banners, so the second is seen to be a second. */
export const BANNER_GAP_MS = 250;
export const CALLOUT_QUEUE_MAX = 3;
/** A callout that has waited this long behind others is about a moment that has passed. */
export const CALLOUT_STALE_MS = 5000;
/**
 * How soon the same callout may be said again. A tower can honestly change
 * hands twice in a few seconds; a hut count hovering between one and two, or a
 * column thinning and filling at the gate, is one piece of news.
 */
export const CALLOUT_AGAIN_MS: Record<CalloutKey, number> = {
  lastHut: 20000,
  enemyAtGate: 20000,
  towerLost: 6000,
  fortLost: 6000,
  // A side raises it once at most, so each one is news.
  flagRaised: 0,
  towerTaken: 6000,
  fortTaken: 6000,
  bridgeHeld: 20000,
  backFromOne: 20000,
  overtime: 60000,
  run: 3000,
  rout: 4000,
  held: 4000,
};

/** A callout waiting or up, with the words it is said in when they carry a number. */
export interface Callout {
  key: CalloutKey;
  at: number;
  /** The side a callout names: the one that raised a white flag. */
  seat?: Seat;
  text?: string;
}

export interface Callouts {
  queue: Callout[];
  showing: Callout | null;
  /** When each callout was last accepted. */
  saidAt: Partial<Record<CalloutKey, number>>;
  reduced: boolean;
}

/** `about` is the side each callout that names one is about. */
export function queueCallouts(
  callouts: Callouts,
  keys: (CalloutKey | { key: CalloutKey; text: string })[],
  now: number,
  about: Partial<Record<CalloutKey, Seat>> = {},
): void {
  for (const each of keys) {
    const { key, text } = typeof each === 'string' ? { key: each, text: undefined } : each;
    const said = callouts.saidAt[key];
    if (said !== undefined && now - said < CALLOUT_AGAIN_MS[key]) continue;
    callouts.saidAt[key] = now;
    callouts.queue.push({ key, at: now, seat: about[key], ...(text !== undefined && { text }) });
  }
  callouts.queue.sort((p, q) => CALLOUT_ORDER.indexOf(p.key) - CALLOUT_ORDER.indexOf(q.key) || p.at - q.at);
  callouts.queue.length = Math.min(callouts.queue.length, CALLOUT_QUEUE_MAX);
}

/** The banner up at `now`, moving the queue on when the last one is done. */
export function currentCallout(callouts: Callouts, now: number): Callout | null {
  const { showing } = callouts;
  if (showing && now - showing.at < BANNER_TOTAL_MS) return showing;
  if (showing && now - showing.at < BANNER_TOTAL_MS + BANNER_GAP_MS && callouts.queue.length > 0) return null;
  callouts.showing = null;
  while (callouts.queue.length > 0) {
    const next = callouts.queue.shift()!;
    if (now - next.at > CALLOUT_STALE_MS) continue;
    callouts.showing = { ...next, at: now };
    break;
  }
  return callouts.showing;
}

// What a death leaves behind.

export type MarkKind = 'pool' | 'ripple' | 'burst';

export interface Mark {
  kind: MarkKind;
  x: number;
  y: number;
  /** When it starts. A shot's is a little ahead, for the ball to land first. */
  at: number;
  /** How many died here within a moment. */
  weight: number;
  seat: Seat;
  /** What gives this pool its own outline. */
  grain: number;
}

export const MARK_MAX = 48;
export const MARK_WEIGHT_MAX = 5;
/** Deaths this near in place and time are one pool, which grows. */
export const MERGE_R = 12;
export const MERGE_MS = 500;
export const POOL_MS = 1100;
/** A deeper pool takes longer to soak in. */
export const POOL_MS_PER_WEIGHT = 100;
export const RIPPLE_MS = 900;
export const BURST_MS = 450;
/** The renderer's cannon ball is in the air this long. */
export const SHOT_LAND_MS = 168;

export function markLife(mark: Mark): number {
  if (mark.kind === 'ripple') return RIPPLE_MS;
  if (mark.kind === 'burst') return BURST_MS;
  return POOL_MS + POOL_MS_PER_WEIGHT * (mark.weight - 1);
}

function addMark(feel: Feel, kind: MarkKind, x: number, y: number, seat: Seat, at: number): void {
  for (const mark of feel.marks) {
    if (mark.kind !== kind || mark.seat !== seat || at - mark.at > MERGE_MS) continue;
    if ((mark.x - x) * (mark.x - x) + (mark.y - y) * (mark.y - y) > MERGE_R * MERGE_R) continue;
    mark.weight = Math.min(MARK_WEIGHT_MAX, mark.weight + 1);
    // A fight that goes on in one place keeps its pool until it is over.
    mark.at = at;
    return;
  }
  feel.marks.push({ kind, x, y, at, weight: 1, seat, grain: feel.grain++ });
  if (feel.marks.length > MARK_MAX) feel.marks.shift();
}

/** Drops what has run its time. */
export function sweep(feel: Feel, now: number): void {
  feel.marks = feel.marks.filter((mark) => now - mark.at < markLife(mark));
  feel.dust = feel.dust.filter((puff) => now - puff.at < (puff.splash ? SPLASH_MS : DUST_MS));
  feel.falls = feel.falls.filter((fall) => now - fall.at < (fall.strong ? FALL_STRONG_MS : FALL_MS));
}

/** Where a path meets the edge of a hut: the doorstep a column arrives at. */
function doorstep(map: SwarmMap, from: number, hut: number, level: number): { x: number; y: number } {
  const r = siteRadius(map.sites[hut], level);
  const length = pathLength(map, from, hut);
  return pathPoint(map, from, hut, Math.max(0.5, 1 - (r + 4) / length));
}

// Capture.

interface Fall {
  hut: number;
  at: number;
  /** A fort or a tower fell. */
  strong: boolean;
}

export const FALL_MS = 760;
export const FALL_STRONG_MS = 980;
const FALL_MAX = 8;

// The ground remembers.

/** Unit-ticks on one path before it is as worn as it gets: about ten columns of twenty over a long road. */
export const WEAR_FULL = 6000;

// What a column kicks up.

/** The units of one side going one way along one path. */
export interface March {
  from: number;
  to: number;
  seat: Seat;
  count: number;
  /** How far along the path its last unit and its first are. */
  rear: number;
  head: number;
}

const MARCH_SIDE: Record<Seat, number> = { a: 0, b: 1, c: 2, d: 3 };

export function marchesOf(state: SwarmState): March[] {
  const marches = new Map<number, March>();
  for (const unit of state.units) {
    const key = (unit.from * 64 + unit.to) * 4 + MARCH_SIDE[unit.seat];
    const march = marches.get(key);
    if (!march) {
      marches.set(key, { from: unit.from, to: unit.to, seat: unit.seat, count: 1, rear: unit.d, head: unit.d });
      continue;
    }
    march.count++;
    march.rear = Math.min(march.rear, unit.d);
    march.head = Math.max(march.head, unit.d);
  }
  return [...marches.values()];
}

/**
 * A hut lets one unit out every other tick, so a single send is strung out
 * ten to twenty to a road. Fewer than six on a path is a handful and raises
 * nothing; twenty is a road full, and the most dust there is.
 */
export const DUST_FROM = 6;
export const DUST_FULL = 20;
/** Puffs a full column on foot raises each tick. A column on the wing raises half. */
export const DUST_RATE = 3.5;
export const DUST_MAX = 96;
export const DUST_MS = 800;
export const SPLASH_MS = 520;

/** How much of a full column's dust this many raise, from 0 to 1. */
export function dustWeight(count: number): number {
  if (count < DUST_FROM) return 0;
  return Math.min(1, (count - DUST_FROM + 1) / (DUST_FULL - DUST_FROM + 1));
}

export interface Puff {
  x: number;
  y: number;
  at: number;
  size: number;
  /** Where it has drifted to by the end of its life. */
  dx: number;
  dy: number;
  /** Raised in a ford: a ring on the water, not a cloud. */
  splash: boolean;
  /** Raised by wings from above: thinner and wider than what feet raise. */
  faint: boolean;
}

/**
 * What the ground of each scene gives up when it is walked on, as r, g, b, and
 * how thick it hangs. Pale dust over a pale road is told from it by the shade
 * it throws on the ground under it; damp earth is dark already and throws none.
 */
const DUST_TINT: Record<SwarmMap['scene'], { rgb: string; alpha: number; cast: string | null }> = {
  meadow: { rgb: '50, 40, 28', alpha: 0.5, cast: null },
  scrub: { rgb: '244, 234, 210', alpha: 0.8, cast: '112, 84, 50' },
  valley: { rgb: '40, 34, 26', alpha: 0.5, cast: null },
  ice: { rgb: '255, 255, 255', alpha: 0.8, cast: '84, 112, 148' },
  terrace: { rgb: '242, 232, 208', alpha: 0.7, cast: '96, 80, 48' },
};

function raiseDust(feel: Feel, map: SwarmMap, state: SwarmState, now: number): void {
  for (const march of marchesOf(state)) {
    const weight = dustWeight(march.count);
    const lane = feel.lanes.get(laneKey(march.from, march.to));
    if (weight === 0 || lane === undefined) continue;
    const path = map.paths[lane];
    const wet = feel.wet[lane];
    const length = pathLength(map, march.from, march.to);
    const flying = feel.kinds[march.seat] === 'bee';
    const puffs = Math.floor(weight * (flying ? DUST_RATE / 2 : DUST_RATE) + hash01(feel.puffed++));
    for (let puff = 0; puff < puffs; puff++) {
      const pick = hash01(feel.puffed++);
      const across = hash01(feel.puffed++) * 2 - 1;
      // Cubed, so most of it is raised by the last of the column and the rest along its flanks.
      const d = Math.max(0, Math.min(length, march.rear - 5 + (march.head - march.rear + 5) * pick * pick * pick));
      const f = d / length;
      const fromA = march.from === path.a ? f : 1 - f;
      const over = wet !== undefined && fromA >= wet.f0 && fromA <= wet.f1;
      // Planks raise nothing, and wings are too high over water to mark it.
      if (over && (flying || path.kind === 'bridge')) continue;
      const p = pathPoint(map, march.from, march.to, f);
      const out = (7 * LANE[path.kind] * Math.sin(Math.PI * f) + 3) * (across < 0 ? -1 : 1) * (0.5 + 0.5 * Math.abs(across));
      feel.dust.push({
        // A bee's lands where its shadow does.
        x: p.x - Math.sin(p.angle) * out + (flying ? 3 : 0),
        y: p.y + Math.cos(p.angle) * out + (flying ? 1.5 : 0),
        at: now,
        size: (9 + 6 * weight) * (flying ? 1.5 : 1),
        dx: -Math.cos(p.angle) * 5,
        dy: -Math.sin(p.angle) * 5 - 2.5,
        splash: over,
        faint: flying,
      });
    }
  }
  if (feel.dust.length > DUST_MAX) feel.dust.splice(0, feel.dust.length - DUST_MAX);
}

/** A unit passing this near bends a blade or a reed. */
const STIR_R = 30;
const STIR_MS = 700;

/** Notes what stands within reach of a unit as brushed at `now`. `spots` holds x and y at the head of every `stride` numbers. */
function brush(spots: Float32Array, stride: number, stirred: Float64Array, column: number[], now: number): void {
  for (let i = 0, k = 0; i < spots.length; i += stride, k++) {
    // One still springing back is left to finish, so a long column rustles it and does not hold it flat.
    if (now - stirred[k] < STIR_MS) continue;
    for (let u = 0; u < column.length; u += 2) {
      const dx = spots[i] - column[u];
      const dy = spots[i + 1] - column[u + 1];
      if (dx * dx + dy * dy >= STIR_R * STIR_R) continue;
      stirred[k] = now;
      break;
    }
  }
}

/** Bent over at once and then let up, from 0 to 1 and back. */
function stirPress(at: number, now: number): number {
  const u = (now - at) / STIR_MS;
  return u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * Math.pow(u, 0.6));
}

// The garrison at the door.

/** A hut shows one more of its own at the door for each of these it holds. */
export const MILL_BANDS: readonly number[] = [3, 8, 15, 25, 40, 60];
const MILL_SCALE = 1.2;
/** How long one of them takes to come out of the door or go back in. */
const MILL_MS = 450;

export function millCount(stock: number): number {
  let count = 0;
  for (const band of MILL_BANDS) if (stock >= band) count++;
  return count;
}

/** What a hut holds that is not already told to leave, so a hut emptying into a column thins at once. */
export function stockOf(hut: Hut): number {
  return hut.n - hut.out.reduce((sum, line) => sum + line.n, 0);
}

// The life on the map.

export interface Critter {
  kind: 'butterfly' | 'dragonfly';
  x: number;
  y: number;
  reach: number;
  phase: number;
  pace: number;
  tone: number;
  /** Which way it goes when it is put up, as a unit vector. */
  fleeX: number;
  fleeY: number;
  /** It stays away until this time. */
  awayUntil: number;
  /** 0 at home, 1 fully away. Moved a frame at a time, so it never jumps. */
  scare: number;
}

/** A unit passing this near puts a creature up. */
export const FLEE_R = 46;
export const FLEE_DIST = 64;
/** How long after the last unit has passed before it comes back. */
export const FLEE_AWAY_MS = 1800;
const FLEE_OUT_MS = 260;
const FLEE_BACK_MS = 2600;

/** Where a creature is when nothing has disturbed it. */
export function critterPoint(critter: Critter, now: number): { x: number; y: number } {
  if (critter.kind === 'butterfly') {
    const t = now * critter.pace + critter.phase;
    return {
      x: critter.x + Math.sin(t) * critter.reach + Math.sin(t * 2.7 + critter.phase) * critter.reach * 0.25,
      y: critter.y + Math.sin(t * 1.3 + critter.phase * 2) * critter.reach * 0.5,
    };
  }
  // A dragonfly hangs in one place and then darts to the next.
  const beat = now * critter.pace + critter.phase;
  const leg = Math.floor(beat);
  const dart = smooth(Math.max(0, (beat - leg - 0.72) / 0.28));
  const spot = (k: number, axis: number) => (hash01(k * 7 + axis + Math.round(critter.phase * 1000)) - 0.5) * 2 * critter.reach;
  const x0 = spot(leg, 0);
  const y0 = spot(leg, 1) * 0.4;
  return {
    x: critter.x + x0 + (spot(leg + 1, 0) - x0) * dart,
    y: critter.y + y0 + (spot(leg + 1, 1) * 0.4 - y0) * dart,
  };
}

const BLADES = 420;
/** The reeds stand in clumps of this many. */
const REED_CLUMP = 4;
const REEDS = 12 * REED_CLUMP;
const SNOW = [
  { count: 36, size: 0.8, fall: 0.02, drift: 0.006, alpha: 0.4 },
  { count: 22, size: 1.2, fall: 0.034, drift: 0.011, alpha: 0.5 },
  { count: 10, size: 1.9, fall: 0.055, drift: 0.019, alpha: 0.62 },
];
const MOTES: Record<SwarmMap['scene'], number> = {
  meadow: 2,
  scrub: 14 + 3 + 6,
  valley: 6,
  ice: SNOW.reduce((sum, layer) => sum + layer.count, 0),
  terrace: 3 + 3,
};

export interface Ambient {
  /** Meadow grass the wind shows up in: x, y and length of each blade. */
  blades: Float32Array;
  /** Valley reeds: x, y, height and phase of each. */
  reeds: Float32Array;
  /** Each river as its points in the order it runs: x, y, the way across it as a unit vector, and half its width there, 0 under a bridge or a ford. */
  streams: Float32Array[];
  /** Where snow blows over the roads of the ice: x, y and phase of each place. */
  drifts: Float32Array;
  /** Four numbers from 0 to 1 for each drifting thing of the scene, read by its painter. */
  motes: Float32Array;
  critters: Critter[];
  /** What the birds of the terrace wheel over. */
  hub: { x: number; y: number };
}

function riverSpots(map: SwarmMap, count: number, rnd: () => number): { x: number; y: number; nx: number; ny: number }[] {
  const reaches: { x: number; y: number; dx: number; dy: number; length: number }[] = [];
  let total = 0;
  for (const river of map.rivers) {
    for (let i = 1; i < river.length; i++) {
      const dx = river[i].x - river[i - 1].x;
      const dy = river[i].y - river[i - 1].y;
      const length = Math.hypot(dx, dy);
      if (length === 0) continue;
      reaches.push({ x: river[i - 1].x, y: river[i - 1].y, dx, dy, length });
      total += length;
    }
  }
  const spots: { x: number; y: number; nx: number; ny: number }[] = [];
  if (reaches.length === 0) return spots;
  for (let made = 0; made < count; made++) {
    let along = rnd() * total;
    let reach = reaches[0];
    for (const candidate of reaches) {
      reach = candidate;
      if (along <= candidate.length) break;
      along -= candidate.length;
    }
    const f = Math.min(1, along / reach.length);
    spots.push({ x: reach.x + reach.dx * f, y: reach.y + reach.dy * f, nx: -reach.dy / reach.length, ny: reach.dx / reach.length });
  }
  return spots;
}

function newAmbient(map: SwarmMap, seed: number): Ambient {
  const rnd = mulberry32(seed ^ 0x7f4a);
  const ambient: Ambient = {
    blades: new Float32Array(0),
    reeds: new Float32Array(0),
    streams: [],
    drifts: new Float32Array(0),
    motes: new Float32Array(MOTES[map.scene] * 4),
    critters: [],
    hub: summitOf(map),
  };
  for (let i = 0; i < ambient.motes.length; i++) ambient.motes[i] = rnd();
  const critter = (kind: Critter['kind'], x: number, y: number, reach: number, pace: number): Critter => ({
    kind,
    x,
    y,
    reach,
    phase: rnd() * TAU,
    pace,
    tone: Math.floor(rnd() * 3),
    fleeX: 0,
    fleeY: -1,
    awayUntil: -Infinity,
    scare: 0,
  });

  if (map.scene === 'meadow') {
    const trodden: { x: number; y: number }[] = [];
    for (const path of map.paths) for (let f = 0; f <= 1; f += 0.05) trodden.push(pathPoint(map, path.a, path.b, f));
    // Grass grows neither on the paths nor on the worn earth round a hut.
    const grassy = (x: number, y: number) =>
      trodden.every((p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) > 24 * 24) &&
      map.sites.every((site) => (site.x - x) * (site.x - x) + ((site.y - y) * (site.y - y)) / 0.4 > 70 * 70);
    // A bigger meadow has as much grass to the acre, and as many butterflies.
    const area = areaOf(map);
    const count = Math.round(BLADES * area);
    const blades = new Float32Array(count * 3);
    let made = 0;
    for (let tries = 0; made < count && tries < count * 6; tries++) {
      const x = rnd() * map.w;
      const y = rnd() * map.h;
      const length = 4 + rnd() * 5;
      if (!grassy(x, y)) continue;
      blades.set([x, y, length], made * 3);
      made++;
    }
    ambient.blades = blades.subarray(0, made * 3);
    for (let i = 0; i < 4 * area; i++) {
      ambient.critters.push(critter('butterfly', 90 + rnd() * (map.w - 180), 70 + rnd() * (map.h - 140), 28 + rnd() * 24, 0.0005 + rnd() * 0.0003));
    }
  }

  const rivers = map.rivers.map(riverOf);
  const decks: { x: number; y: number; room: number }[] = [];
  for (const path of map.paths) {
    if (path.kind !== 'bridge' && path.kind !== 'ford') continue;
    for (let f = 0; f <= 1; f += 0.02) decks.push({ ...pathPoint(map, path.a, path.b, f), room: PATH_W[path.kind] / 2 + 6 });
  }
  const offDeck = (x: number, y: number) => decks.every((p) => (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) > p.room * p.room);
  ambient.streams = rivers.map((river) => {
    const stream = new Float32Array(river.pts.length * 5);
    river.pts.forEach((p, i) => {
      const dir = riverDir(river, i);
      stream.set([p.x, p.y, -dir.y, dir.x, offDeck(p.x, p.y) ? river.half[i] : 0], i * 5);
    });
    return stream;
  });

  if (map.scene === 'ice') {
    const drifts: number[] = [];
    for (const path of map.paths) {
      const places = Math.floor(pathLength(map, path.a, path.b) / 34);
      for (let place = 2; place < places - 1; place++) {
        const p = pathPoint(map, path.a, path.b, place / places);
        drifts.push(p.x, p.y, rnd());
      }
    }
    ambient.drifts = new Float32Array(drifts);
  }

  if (map.scene === 'valley') {
    const reeds: number[] = [];
    // A bigger valley has more river in it, and as many reeds and dragonflies along each length of bank.
    const area = areaOf(map);
    const count = Math.round(REEDS * area);
    for (let tries = 0; rivers.length > 0 && reeds.length < count * 4 && tries < count * 4; tries++) {
      const river = rivers[Math.floor(rnd() * rivers.length)];
      const first = Math.floor(rnd() * river.pts.length);
      const side = rnd() < 0.5 ? -1 : 1;
      for (let stalk = 0; stalk < REED_CLUMP && reeds.length < count * 4; stalk++) {
        const i = Math.min(river.pts.length - 1, first + stalk);
        const dir = riverDir(river, i);
        // Rooted in the wet margin the ground paints along the water, clear of the water itself.
        const out = (river.half[i] + 1 + rnd() * 7) * side;
        const x = river.pts[i].x - dir.y * out;
        const y = river.pts[i].y + dir.x * out;
        if (offDeck(x, y)) reeds.push(x, y, 10 + rnd() * 8, rnd() * TAU);
      }
    }
    ambient.reeds = new Float32Array(reeds);
    for (const spot of riverSpots(map, Math.round(4 * area), rnd)) {
      ambient.critters.push(critter('dragonfly', spot.x, spot.y, 34 + rnd() * 16, 0.0006 + rnd() * 0.0003));
    }
    const mist = riverSpots(map, 6, rnd);
    mist.forEach((spot, index) => {
      ambient.motes[index * 4] = spot.x / map.w;
      ambient.motes[index * 4 + 1] = spot.y / map.h;
    });
  }

  return ambient;
}

export interface Feel {
  seed: number;
  /** The creature each side is drawn as. */
  kinds: Record<Seat, Kind>;
  /** The last tick stepped. */
  tick: number;
  /** The state after that tick, to read the next one against. */
  before: SwarmState | null;
  marks: Mark[];
  grain: number;
  falls: Fall[];
  /** Unit-ticks walked on each path, in the order of `map.paths`. */
  wear: number[];
  /** The control point of each path's curve, likewise. */
  bends: { x: number; y: number }[];
  lanes: Map<number, number>;
  /** Where every unit was on the last tick: x then y. Kept between ticks to save making it again. */
  column: number[];
  dust: Puff[];
  /** How many times the dust has asked for a number, which is what makes the next one different. */
  puffed: number;
  /** The stretch of each bridge and ford that is over water, in the order of `map.paths`. */
  wet: (Crossing | undefined)[];
  /** When each blade and each reed was last brushed by a unit. */
  stirred: { blades: Float64Array; reeds: Float64Array };
  callouts: Callouts;
  momentum: Momentum;
  ambient: Ambient;
  /** How many of its garrison each hut is showing, on the way to how many it should. */
  mill: number[];
  drawnAt: number;
  sprites: Map<string, HTMLCanvasElement>;
}

export function newFeel(map: SwarmMap, seed: number, kinds: Record<Seat, Kind>): Feel {
  const lanes = new Map<number, number>();
  map.paths.forEach((path, index) => lanes.set(laneKey(path.a, path.b), index));
  const ambient = newAmbient(map, seed);
  const crossings = crossingsOf(map, map.rivers.map(riverOf));
  return {
    seed,
    kinds,
    tick: -1,
    before: null,
    marks: [],
    grain: 0,
    falls: [],
    wear: map.paths.map(() => 0),
    // A quadratic curve's middle is half its control point and a quarter of each end.
    bends: map.paths.map((path) => {
      const mid = pathPoint(map, path.a, path.b, 0.5);
      return {
        x: 2 * mid.x - (map.sites[path.a].x + map.sites[path.b].x) / 2,
        y: 2 * mid.y - (map.sites[path.a].y + map.sites[path.b].y) / 2,
      };
    }),
    lanes,
    column: [],
    dust: [],
    puffed: 0,
    wet: map.paths.map((path) => crossings.find((crossing) => crossing.path === path)),
    stirred: {
      blades: new Float64Array(ambient.blades.length / 3).fill(-Infinity),
      reeds: new Float64Array(ambient.reeds.length / 4).fill(-Infinity),
    },
    callouts: { queue: [], showing: null, saidAt: {}, reduced: false },
    momentum: newMomentum(),
    ambient,
    mill: map.sites.map(() => 0),
    drawnAt: -Infinity,
    sprites: new Map(),
  };
}

/** Called once per simulated tick, in order, with the state after that tick. `seat` is the viewer. */
export function feelStep(feel: Feel, map: SwarmMap, state: SwarmState, seat: Seat, now: number): void {
  // A tick shown again (the drawing was rerun from an earlier state) has had its say already.
  if (state.tick <= feel.tick) {
    feel.tick = state.tick;
    feel.before = cloneState(state);
    return;
  }
  sweep(feel, now);
  const before = feel.before;
  const next = before !== null && state.tick === feel.tick + 1;

  feel.column.length = 0;
  for (const unit of state.units) {
    const lane = feel.lanes.get(laneKey(unit.from, unit.to));
    if (lane !== undefined) feel.wear[lane] = Math.min(WEAR_FULL, feel.wear[lane] + 1);
    const p = pathPoint(map, unit.from, unit.to, Math.min(1, unit.d / pathLength(map, unit.from, unit.to)));
    feel.column.push(p.x, p.y);
  }
  raiseDust(feel, map, state, now);
  brush(feel.ambient.blades, 3, feel.stirred.blades, feel.column, now);
  brush(feel.ambient.reeds, 4, feel.stirred.reeds, feel.column, now);

  // The units of the tick before that are not in this one, and whether each had reached the end of its path.
  const gone: { unit: Unit; reached: boolean }[] = [];
  if (next) {
    const alive = new Set<number>();
    for (const unit of state.units) alive.add(unit.id);
    for (const unit of before.units) {
      if (alive.has(unit.id)) continue;
      gone.push({ unit, reached: unit.d + speedOf(map, state.army[unit.seat].speed) >= pathLength(map, unit.from, unit.to) });
    }
  }
  // One that walked into a hut its side now holds is inside it, not dead.
  const fell = ({ unit, reached }: { unit: Unit; reached: boolean }) => !(reached && state.huts[unit.to].owner === unit.seat);

  for (const shot of state.shots) addMark(feel, 'pool', shot.x, shot.y, shot.seat, now + SHOT_LAND_MS);

  const struck = new Set<number>();
  for (const event of state.events) {
    if (event.kind === 'clash') {
      // The event does not say which side lost a unit, so that is read from who is missing on this path.
      const key = laneKey(event.from, event.to);
      const p = pathPoint(map, event.from, event.to, event.d / pathLength(map, event.from, event.to));
      const lost = new Set<Seat>();
      for (const item of gone) if (laneKey(item.unit.from, item.unit.to) === key && fell(item)) lost.add(item.unit.seat);
      for (const loser of lost) addMark(feel, 'pool', p.x, p.y, loser, now);
    } else if (event.kind === 'toll') {
      const p = pathPoint(map, event.from, event.to, event.d / pathLength(map, event.from, event.to));
      const lane = feel.lanes.get(laneKey(event.from, event.to));
      const kind = lane === undefined ? 'road' : map.paths[lane].kind;
      if (kind === 'ford') {
        addMark(feel, 'ripple', p.x, p.y, event.seat, now);
      } else {
        addMark(feel, 'pool', p.x, p.y, event.seat, now);
        if (kind === 'spikes') addMark(feel, 'burst', p.x, p.y, event.seat, now);
      }
    } else if (event.kind === 'hit') {
      struck.add(event.hut);
    } else if (event.kind === 'capture') {
      const site = map.sites[event.hut];
      feel.falls.push({ hut: event.hut, at: now, strong: Boolean(site.tower || site.fort) });
      if (feel.falls.length > FALL_MAX) feel.falls.shift();
    }
  }

  // A fight at a door: every attacker that reached it and is not inside died
  // there, and so did some of the garrison if it is smaller or gone.
  if (next) {
    for (const hut of struck) {
      const was = before.huts[hut];
      const held = state.huts[hut];
      let step: { x: number; y: number } | null = null;
      for (const item of gone) {
        if (item.unit.to !== hut || !item.reached || item.unit.seat === was.owner) continue;
        step = doorstep(map, item.unit.from, hut, held.level);
        if (fell(item)) addMark(feel, 'pool', step.x, step.y, item.unit.seat, now);
      }
      if (step && was.owner && (held.owner !== was.owner || held.n < was.n)) addMark(feel, 'pool', step.x, step.y, was.owner, now);
    }
  }

  for (const critter of feel.ambient.critters) {
    const home = critterPoint(critter, now);
    let nearest = FLEE_R * FLEE_R;
    let fromX = 0;
    let fromY = 0;
    let near = false;
    for (let i = 0; i < feel.column.length; i += 2) {
      const dx = home.x - feel.column[i];
      const dy = home.y - feel.column[i + 1];
      if (dx * dx + dy * dy >= nearest) continue;
      nearest = dx * dx + dy * dy;
      fromX = dx;
      fromY = dy;
      near = true;
    }
    if (!near) continue;
    // One already away keeps its line, so the next unit of the column does not jerk it sideways.
    if (critter.scare < 0.05) {
      const gap = Math.sqrt(nearest);
      // Walked over exactly: no direction is better, so go straight up.
      critter.fleeX = gap === 0 ? 0 : fromX / gap;
      critter.fleeY = gap === 0 ? -1 : fromY / gap;
    }
    critter.awayUntil = now + FLEE_AWAY_MS;
  }

  if (before) {
    const due = calloutsFor(before, state, map, seat, feel.callouts.reduced);
    if (due.includes('lastHut')) feel.callouts.reduced = true;
    if (due.includes('backFromOne')) feel.callouts.reduced = false;
    // Two flags in one tick are named by the later one's banner; the result line names both.
    queueCallouts(feel.callouts, [...due, ...momentumStep(feel.momentum, map, before, state, seat)], now, {
      flagRaised: state.yielded[state.yielded.length - 1],
    });
  }

  feel.tick = state.tick;
  feel.before = cloneState(state);
}

// The painting.

function softSprite(feel: Feel, rgb: string): HTMLCanvasElement {
  const cached = feel.sprites.get(rgb);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const fall = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    fall.addColorStop(0, `rgba(${rgb}, 1)`);
    fall.addColorStop(0.5, `rgba(${rgb}, 0.45)`);
    fall.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = fall;
    ctx.fillRect(0, 0, 64, 64);
  }
  feel.sprites.set(rgb, canvas);
  return canvas;
}

function paintWear(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap) {
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#3a2c18';
  // Wide and faint for the churned verge, narrow and darker for the line the columns kept to.
  for (const [width, most] of [[19, 0.14], [8, 0.16]] as const) {
    ctx.lineWidth = width;
    map.paths.forEach((path, index) => {
      const share = feel.wear[index] / WEAR_FULL;
      if (share < 0.02) return;
      ctx.globalAlpha = most * share;
      ctx.beginPath();
      ctx.moveTo(map.sites[path.a].x, map.sites[path.a].y);
      ctx.quadraticCurveTo(feel.bends[index].x, feel.bends[index].y, map.sites[path.b].x, map.sites[path.b].y);
      ctx.stroke();
    });
  }
  ctx.globalAlpha = 1;
}

function paintMarks(ctx: CanvasRenderingContext2D, feel: Feel, now: number) {
  for (const mark of feel.marks) {
    const t = (now - mark.at) / markLife(mark);
    if (t < 0 || t >= 1) continue;
    if (mark.kind === 'pool') {
      const r = (4.2 + 1.3 * (mark.weight - 1)) * (t < 0.12 ? 0.6 + (0.4 * t) / 0.12 : 1);
      const depth = 0.34 + 0.07 * (mark.weight - 1);
      const fade = t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
      ctx.fillStyle = STAIN[feel.kinds[mark.seat]];
      // The spread goes first and the middle last, which is what soaking in looks like.
      ctx.globalAlpha = depth * fade * fade;
      ctx.beginPath();
      for (let lobe = 0; lobe < 3; lobe++) {
        const angle = hash01(mark.grain * 3 + lobe) * TAU;
        const size = r * (0.55 + hash01(mark.grain * 5 + lobe) * 0.3);
        blob(ctx, mark.x + Math.cos(angle) * r * 0.45, mark.y + Math.sin(angle) * r * 0.25, size, size * 0.55, angle);
      }
      ctx.fill();
      ctx.globalAlpha = depth * Math.sqrt(fade);
      ctx.beginPath();
      blob(ctx, mark.x, mark.y, r * 0.6, r * 0.34);
      ctx.fill();
    } else if (mark.kind === 'ripple') {
      ctx.fillStyle = STAIN[feel.kinds[mark.seat]];
      ctx.globalAlpha = 0.3 * (1 - t);
      ctx.beginPath();
      blob(ctx, mark.x, mark.y, 7 + t * 4, (7 + t * 4) * 0.45);
      ctx.fill();
      ctx.strokeStyle = '#ebf4f6';
      ctx.lineWidth = 1.1;
      for (let ring = 0; ring < 2; ring++) {
        const s = (t - ring * 0.25) / 0.75;
        if (s <= 0 || s >= 1) continue;
        ctx.globalAlpha = 0.55 * (1 - s);
        ctx.beginPath();
        blob(ctx, mark.x, mark.y, 3 + s * 15, (3 + s * 15) * 0.45);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = STAIN[feel.kinds[mark.seat]];
      ctx.globalAlpha = 0.7 * (1 - t);
      ctx.beginPath();
      for (let speck = 0; speck < 6; speck++) {
        const angle = (speck / 6) * TAU + hash01(mark.grain + speck) * 0.8;
        const out = easeOut(t) * 9;
        blob(ctx, mark.x + Math.cos(angle) * out, mark.y + Math.sin(angle) * out * 0.5 - Math.sin(t * Math.PI) * 5, 1.2, 1.2);
      }
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/**
 * A hut falling throws dust out along the ground, which is what says
 * something happened here; then a ring in the taker's colour closes on the
 * hut, which is what says whose it is now and leaves the eye on it.
 */
function paintFalls(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap, state: SwarmState, now: number) {
  for (const fall of feel.falls) {
    const t = (now - fall.at) / (fall.strong ? FALL_STRONG_MS : FALL_MS);
    if (t < 0 || t >= 1) continue;
    const site = map.sites[fall.hut];
    const hut = state.huts[fall.hut];
    const r = siteRadius(site, hut.level);
    const puffs = fall.strong ? 20 : 12;
    const reach = easeOut(Math.min(1, t / 0.6)) * (fall.strong ? 54 : 30);
    const size = (fall.strong ? 4 : 3) + t * (fall.strong ? 7 : 5);
    ctx.fillStyle = DUST;
    ctx.globalAlpha = 0.42 * (1 - t) * (1 - t);
    ctx.beginPath();
    for (let puff = 0; puff < puffs; puff++) {
      const angle = (puff / puffs) * TAU + hash01(fall.hut * 31 + puff) * 0.4;
      blob(ctx, site.x + Math.cos(angle) * (r + reach), site.y + Math.sin(angle) * (r + reach) * 0.42 - t * 6, size, size * 0.8);
    }
    ctx.fill();
    if (t > 0.45 && hut.owner) {
      const s = (t - 0.45) / 0.55;
      const ring = r * (1.75 - 0.45 * easeOut(s));
      ctx.strokeStyle = BADGE[hut.owner].fill;
      ctx.globalAlpha = 0.8 * Math.sin(Math.PI * s);
      ctx.lineWidth = fall.strong ? 3.5 : 2.5;
      ctx.beginPath();
      blob(ctx, site.x, site.y + 2, ring, ring * 0.4);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

const GUST_ANGLE = 0.35;
/** World units a gust front covers per millisecond. */
const GUST_SPEED = 0.16;
/** From one front to the next. Longer than the board, so there is a lull between gusts. */
const GUST_SPAN = 1700;
const GUST_HALF = 75;

/** How hard the gust is leaning on this place, from 0 to 1. */
function gustPress(x: number, y: number, now: number): number {
  // The front is not a ruled line: it runs ahead in some places and hangs back in others.
  const along = x * Math.cos(GUST_ANGLE) + y * Math.sin(GUST_ANGLE) + Math.sin(y * 0.011) * 45 - now * GUST_SPEED;
  const behind = ((along % GUST_SPAN) + GUST_SPAN) % GUST_SPAN;
  const gap = Math.min(behind, GUST_SPAN - behind);
  return gap >= GUST_HALF ? 0 : Math.cos((gap / GUST_HALF) * (Math.PI / 2));
}

function paintGusts(ctx: CanvasRenderingContext2D, blades: Float32Array, stirred: Float64Array, now: number) {
  ctx.strokeStyle = '#bcc79a';
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  for (let level = 0; level < 3; level++) {
    ctx.globalAlpha = 0.14 + level * 0.12;
    ctx.beginPath();
    for (let i = 0; i < blades.length; i += 3) {
      const x = blades[i];
      const y = blades[i + 1];
      const press = Math.max(gustPress(x, y, now), stirPress(stirred[i / 3], now));
      if (press === 0 || Math.min(2, Math.floor(press * press * 3)) !== level) continue;
      const length = blades[i + 2];
      const lean = press * length * 0.9;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + lean * 0.3, y - length * 0.6, x + lean, y - length * (1 - press * 0.3));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintReeds(ctx: CanvasRenderingContext2D, reeds: Float32Array, stirred: Float64Array, now: number) {
  ctx.lineCap = 'round';
  // What each stalk throws on the bank, away from the light, so it is seen to be rooted there.
  ctx.strokeStyle = '#1c2616';
  ctx.lineWidth = 1.2;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  for (let i = 0; i < reeds.length; i += 4) {
    ctx.moveTo(reeds[i], reeds[i + 1]);
    ctx.lineTo(reeds[i] + reeds[i + 2] * 0.4, reeds[i + 1] + reeds[i + 2] * 0.12);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  // The stalks, then the seed heads as a thicker stroke over the top quarter of each.
  for (const [colour, width, from] of [['#5a6638', 1.1, 0], ['#66503a', 2.2, 0.72]] as const) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let i = 0; i < reeds.length; i += 4) {
      const height = reeds[i + 2];
      const pressed = Math.max(gustPress(reeds[i], reeds[i + 1], now), stirPress(stirred[i / 4], now));
      const sway = (Math.sin(now * 0.0012 + reeds[i + 3]) * 0.12 + pressed * 0.32) * height;
      // A stalk bends as the square of the way up it, being held at the root.
      ctx.moveTo(reeds[i] + sway * from * from, reeds[i + 1] - height * from);
      if (from === 0) ctx.quadraticCurveTo(reeds[i], reeds[i + 1] - height * 0.5, reeds[i] + sway, reeds[i + 1] - height);
      else ctx.lineTo(reeds[i] + sway, reeds[i + 1] - height);
    }
    ctx.stroke();
  }
}

const FLOW_LINES = 5;
/** How far a line of the current is carried while it is seen, in points of the stream. */
const FLOW_RUN = 9;
const FLOW_MS = 5200;
const RISE_EVERY_MS = 9000;
const RISE_MS = 1500;

/**
 * Which way the river runs: a few short pale lines carried down it and let go,
 * and now and then the ring of a fish rising. Under a bridge or over the bar
 * of a ford there is none of either, the ground having painted those.
 */
function paintFlow(ctx: CanvasRenderingContext2D, streams: Float32Array[], now: number) {
  ctx.strokeStyle = '#d5dedb';
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.9;
  streams.forEach((stream, river) => {
    const points = stream.length / 5;
    if (points <= FLOW_RUN + 4) return;
    const spot = (at: number, lane: number) => {
      const i = Math.floor(at) * 5;
      const s = at - Math.floor(at);
      const x = stream[i] + (stream[i + 5] - stream[i]) * s;
      const y = stream[i + 1] + (stream[i + 6] - stream[i + 1]) * s;
      return { x: x + stream[i + 2] * stream[i + 4] * lane, y: y + stream[i + 3] * stream[i + 4] * lane, open: stream[i + 4] > 0 && stream[i + 9] > 0 };
    };
    for (let line = 0; line < FLOW_LINES; line++) {
      const id = river * 16 + line;
      const period = FLOW_MS * (1 + hash01(id) * 0.5);
      const turn = (now + hash01(id + 40) * period) / period;
      const u = turn - Math.floor(turn);
      const lane = hash01(Math.floor(turn) * 53 + id) * 1.2 - 0.6;
      const first = hash01(Math.floor(turn) * 31 + id) * (points - FLOW_RUN - 4) + u * FLOW_RUN;
      const tail = spot(first, lane);
      const mid = spot(first + 1.5, lane);
      const head = spot(first + 3, lane);
      if (!tail.open || !mid.open || !head.open) continue;
      ctx.globalAlpha = 0.24 * Math.sin(Math.PI * u);
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      ctx.quadraticCurveTo(mid.x, mid.y, head.x, head.y);
      ctx.stroke();
    }

    const turn = now / RISE_EVERY_MS + hash01(river + 90);
    const u = ((turn - Math.floor(turn)) * RISE_EVERY_MS) / RISE_MS;
    if (u >= 1) return;
    const rise = spot(hash01(Math.floor(turn) * 17 + river) * (points - 2), hash01(Math.floor(turn) * 23 + river) - 0.5);
    if (!rise.open) return;
    for (let ring = 0; ring < 2; ring++) {
      const s = (u - ring * 0.25) / 0.75;
      if (s <= 0 || s >= 1) continue;
      ctx.globalAlpha = 0.3 * (1 - s);
      ctx.beginPath();
      blob(ctx, rise.x, rise.y, 2 + s * 9, (2 + s * 9) * 0.45);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
}

const DRIFT_MS = 4200;
const DRIFT_RUN = 44;

/** Snow blown low across the packed roads of the ice, the way the drifts beside them lie. It shows on a road because the road is bare. */
function paintSpindrift(ctx: CanvasRenderingContext2D, drifts: Float32Array, now: number) {
  ctx.strokeStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.9;
  for (let i = 0; i < drifts.length; i += 3) {
    const period = DRIFT_MS * (1 + drifts[i + 2]);
    // Seen for a third of its round, so two places in three are still at any moment.
    const u = (((now + drifts[i + 2] * 9 * period) % period) / period) * 3;
    if (u >= 1) continue;
    const x = drifts[i] + (u - 0.5) * DRIFT_RUN;
    const y = drifts[i + 1] + (u - 0.5) * DRIFT_RUN * WIND;
    ctx.globalAlpha = 0.3 * Math.sin(Math.PI * u);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + 5, y - 1.6 + WIND * 5, x + 12, y + WIND * 12);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintDust(ctx: CanvasRenderingContext2D, feel: Feel, scene: SwarmMap['scene'], now: number) {
  const tint = DUST_TINT[scene];
  const sprite = softSprite(feel, tint.rgb);
  const cast = tint.cast && softSprite(feel, tint.cast);
  ctx.strokeStyle = '#dbe5e4';
  ctx.lineWidth = 0.9;
  for (const puff of feel.dust) {
    const t = (now - puff.at) / (puff.splash ? SPLASH_MS : DUST_MS);
    if (t < 0 || t >= 1) continue;
    if (puff.splash) {
      const r = 1.5 + t * 6;
      ctx.globalAlpha = 0.34 * (1 - t);
      ctx.beginPath();
      blob(ctx, puff.x, puff.y, r, r * 0.45);
      ctx.stroke();
      continue;
    }
    // Up quickly and thinning as it spreads; low and wide, because it hangs at the height of a leg.
    const r = puff.size * (0.6 + 0.9 * easeOut(t));
    const thick = tint.alpha * (puff.faint ? 0.45 : 1) * Math.min(1, t / 0.15) * (1 - t);
    if (cast) {
      ctx.globalAlpha = thick * 0.4;
      ctx.drawImage(cast, puff.x + puff.dx * t * 0.4 - r + 2, puff.y + r * 0.1, r * 2, r * 0.8);
    }
    ctx.globalAlpha = thick;
    ctx.drawImage(sprite, puff.x + puff.dx * t - r, puff.y + puff.dy * t - r * 0.65, r * 2, r * 1.3);
  }
  ctx.globalAlpha = 1;
}

function paintMist(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap, now: number) {
  const sprite = softSprite(feel, '236, 242, 240');
  const { motes } = feel.ambient;
  for (let i = 0; i < 6 * 4; i += 4) {
    const width = 120 + motes[i + 2] * 80;
    const x = motes[i] * map.w + Math.sin(now * 0.00012 + motes[i + 3] * TAU) * 26;
    ctx.globalAlpha = 0.07 + 0.03 * Math.sin(now * 0.0004 + motes[i + 3] * 9);
    ctx.drawImage(sprite, x - width / 2, motes[i + 1] * map.h - width * 0.22, width, width * 0.44);
  }
  ctx.globalAlpha = 1;
}

function paintCloudShadows(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap, now: number) {
  const sprite = softSprite(feel, '24, 34, 14');
  const { motes } = feel.ambient;
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 3 * 4; i += 4) {
    const width = 300 + motes[i + 2] * 160;
    const x = ((motes[i] * (map.w + width) + now * 0.012) % (map.w + width)) - width;
    ctx.drawImage(sprite, x, motes[i + 1] * map.h - width * 0.28, width, width * 0.56);
  }
  ctx.globalAlpha = 1;
}

function paintBirds(ctx: CanvasRenderingContext2D, ambient: Ambient, now: number) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let bird = 0; bird < 3; bird++) {
    const at = (3 + bird) * 4;
    const turn = now * 0.00035 * (bird === 1 ? -1 : 1) + ambient.motes[at] * TAU;
    const radius = 55 + bird * 24;
    const x = ambient.hub.x + Math.cos(turn) * radius;
    const y = ambient.hub.y + Math.sin(turn) * radius * 0.5;
    ctx.fillStyle = '#18220e';
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    blob(ctx, x + 8, y, 4, 1.6);
    ctx.fill();
    // Wings held out on the glide, with a slow beat now and then.
    const lift = 1.6 + Math.max(0, Math.sin(now * 0.004 + ambient.motes[at + 1] * TAU)) * 2.2;
    const heading = turn + (bird === 1 ? -1 : 1) * (Math.PI / 2);
    ctx.save();
    ctx.translate(x, y - 74);
    ctx.rotate(Math.atan2(Math.sin(heading) * 0.5, Math.cos(heading)));
    ctx.strokeStyle = '#2b2a26';
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-1, -6.5);
    ctx.quadraticCurveTo(lift, -3, 0, 0);
    ctx.quadraticCurveTo(lift, 3, -1, 6.5);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function paintLeaves(ctx: CanvasRenderingContext2D, motes: Float32Array, map: SwarmMap, now: number) {
  const period = 17000;
  for (let i = 0; i < 2 * 4; i += 4) {
    const u = ((now + motes[i] * period) % period) / period / 0.45;
    if (u >= 1) continue;
    ctx.save();
    ctx.translate(-20 + u * (map.w + 40), 60 + motes[i + 1] * (map.h - 160) + Math.sin(u * 20) * 18 + u * 40);
    ctx.rotate(now * 0.004 + motes[i + 2] * TAU);
    ctx.fillStyle = motes[i + 3] < 0.5 ? '#a9772f' : '#b88a3a';
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.quadraticCurveTo(0, -2.6, 5, 0);
    ctx.quadraticCurveTo(0, 2.6, -5, 0);
    ctx.fill();
    ctx.restore();
  }
}

function paintScrubAir(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap, now: number) {
  const { motes } = feel.ambient;
  const sprite = softSprite(feel, '226, 208, 170');
  for (let i = 0; i < 14 * 4; i += 4) {
    const width = 70 + motes[i + 2] * 80;
    const x = ((motes[i] * (map.w + width) + now * (0.006 + motes[i + 3] * 0.006)) % (map.w + width)) - width;
    ctx.globalAlpha = 0.035 + motes[i + 3] * 0.03;
    ctx.drawImage(sprite, x, motes[i + 1] * map.h - width * 0.2, width, width * 0.4);
  }

  // Seed heads bowled along by the same wind, bouncing as they go.
  const period = 21000;
  ctx.lineWidth = 0.7;
  for (let i = 14 * 4; i < 17 * 4; i += 4) {
    const u = ((now + motes[i] * period) % period) / period / 0.6;
    if (u >= 1) continue;
    const x = -20 + u * (map.w + 40);
    const y = 70 + motes[i + 1] * (map.h - 140);
    const hop = Math.abs(Math.sin(u * 34)) * 7;
    ctx.fillStyle = '#18140a';
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    blob(ctx, x + 1, y + 1, 4.5, 1.8);
    ctx.fill();
    ctx.strokeStyle = '#e4d6b0';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    const spin = x * 0.22;
    for (let spoke = 0; spoke < 7; spoke++) {
      const angle = spin + (spoke / 7) * TAU;
      ctx.moveTo(x, y - 4 - hop);
      ctx.lineTo(x + Math.cos(angle) * 4.5, y - 4 - hop + Math.sin(angle) * 4.5);
    }
    ctx.stroke();
  }

  // Haze: thin pale lenses lifting off the ground and thinning out as they go.
  ctx.fillStyle = '#fff6dc';
  for (let i = 17 * 4; i < 23 * 4; i += 4) {
    const u = (now * 0.00028 + motes[i + 3]) % 1;
    ctx.globalAlpha = 0.05 * Math.sin(Math.PI * u);
    ctx.beginPath();
    blob(ctx, motes[i] * map.w + Math.sin(now * 0.002 + motes[i + 3] * TAU) * 5, 80 + motes[i + 1] * (map.h - 120) - u * 14, 60 + motes[i + 2] * 50, 1.3);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paintSnow(ctx: CanvasRenderingContext2D, motes: Float32Array, map: SwarmMap, now: number) {
  ctx.fillStyle = '#ffffff';
  let at = 0;
  // Three depths: what is near is larger, falls faster and is blown further.
  for (const layer of SNOW) {
    ctx.globalAlpha = layer.alpha;
    ctx.beginPath();
    for (let flake = 0; flake < layer.count; flake++, at += 4) {
      const x = (motes[at] * map.w + now * layer.drift + Math.sin(now * 0.0011 + motes[at + 3] * TAU) * layer.size * 4 + map.w) % map.w;
      const y = (motes[at + 1] * map.h + now * layer.fall * (0.85 + motes[at + 2] * 0.3)) % map.h;
      const r = layer.size * (0.8 + motes[at + 2] * 0.4);
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const WING = ['#f6f1df', '#f2d16b', '#e98f3a'];

function paintCritters(ctx: CanvasRenderingContext2D, critters: Critter[], now: number, dt: number) {
  for (const critter of critters) {
    if (now < critter.awayUntil) critter.scare = Math.min(1, critter.scare + dt / FLEE_OUT_MS);
    else critter.scare = Math.max(0, critter.scare - dt / FLEE_BACK_MS);
    const home = critterPoint(critter, now);
    const ahead = critterPoint(critter, now + 60);
    const away = smooth(critter.scare) * FLEE_DIST;
    const x = home.x + critter.fleeX * away;
    const y = home.y + critter.fleeY * away;
    const angle = Math.atan2(ahead.y - home.y, ahead.x - home.x);

    ctx.fillStyle = '#18220e';
    ctx.globalAlpha = 0.16;
    ctx.beginPath();
    blob(ctx, x + 2, y, 3, 1.3);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(x, y - 9);
    ctx.rotate(angle);
    if (critter.kind === 'butterfly') {
      // It beats faster while it is getting away.
      const flap = Math.abs(Math.sin(now * (0.016 + critter.scare * 0.014) + critter.phase));
      ctx.fillStyle = WING[critter.tone];
      ctx.beginPath();
      blob(ctx, 0.6, -2.4 * flap - 0.4, 2.6, 2.4 * flap + 0.3, -0.4);
      blob(ctx, 0.6, 2.4 * flap + 0.4, 2.6, 2.4 * flap + 0.3, 0.4);
      ctx.fill();
      ctx.fillStyle = '#2a2016';
      ctx.beginPath();
      blob(ctx, 0, 0, 2.6, 0.6);
      ctx.fill();
    } else {
      const blur = 0.75 + 0.25 * Math.sin(now * 0.09 + critter.phase);
      ctx.strokeStyle = '#ffffff';
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 1.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(1.5, -5.5 * blur);
      ctx.lineTo(1.5, 5.5 * blur);
      ctx.moveTo(-0.5, -4.5 * blur);
      ctx.lineTo(-0.5, 4.5 * blur);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#1f5d6b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(3, 0);
      ctx.stroke();
      ctx.fillStyle = '#1f5d6b';
      ctx.beginPath();
      blob(ctx, 3.4, 0, 1.3, 1.3);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** An ant about its mound, in the colours of the ones on the march. */
function tinyAnt(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, stride: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(MILL_SCALE, MILL_SCALE);
  ctx.strokeStyle = '#2a120b';
  ctx.lineWidth = 0.55;
  ctx.beginPath();
  for (let leg = -1; leg <= 1; leg++) {
    const swing = Math.sin(stride + leg * 2.1) * 1.3;
    ctx.moveTo(leg * 1.7 + swing, -3.3);
    ctx.lineTo(leg * 1.1, 0);
    ctx.lineTo(leg * 1.7 - swing, 3.3);
  }
  ctx.stroke();
  ctx.fillStyle = '#4a1d10';
  ctx.beginPath();
  blob(ctx, -3.3, 0, 2.6, 1.9);
  ctx.fill();
  ctx.fillStyle = '#3a160c';
  ctx.beginPath();
  blob(ctx, 0, 0, 1.6, 1.25);
  blob(ctx, 2.7, 0, 1.5, 1.4);
  ctx.fill();
  ctx.restore();
}

/** A beetle about its mound: the round shell and stub legs of the ones on the march, in their green-black. */
function tinyBeetle(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, stride: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(MILL_SCALE, MILL_SCALE);
  ctx.strokeStyle = '#141710';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  for (let leg = -1; leg <= 1; leg++) {
    const swing = Math.sin(stride + leg * 2.1) * 0.8;
    ctx.moveTo(leg * 1.9 + 0.4 + swing, -3.4);
    ctx.lineTo(leg * 1.4 + 0.4, 0);
    ctx.lineTo(leg * 1.9 + 0.4 - swing, 3.4);
  }
  ctx.stroke();
  ctx.fillStyle = '#10140c';
  ctx.beginPath();
  blob(ctx, 2.6, 0, 1.4, 1.6);
  ctx.fill();
  ctx.fillStyle = '#1f2a1a';
  ctx.beginPath();
  blob(ctx, -0.9, 0, 3.6, 2.8);
  ctx.fill();
  ctx.fillStyle = '#5c6a3a';
  ctx.beginPath();
  blob(ctx, -0.6, -1.3, 2.2, 0.6);
  ctx.fill();
  ctx.restore();
}

/** A spider about its mound: eight legs round a big body, in the grey-brown of the ones on the march. */
function tinySpider(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, stride: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(MILL_SCALE, MILL_SCALE);
  ctx.strokeStyle = '#3a3128';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let leg = 0; leg < 4; leg++) {
    const swing = Math.sin(stride + leg * Math.PI) * 0.9;
    const foot = 4.6 - leg * 2.5;
    ctx.moveTo(foot + swing, -4.2);
    ctx.lineTo(1.9 - leg * 0.4, 0);
    ctx.lineTo(foot - swing, 4.2);
  }
  ctx.stroke();
  ctx.fillStyle = '#75664f';
  ctx.beginPath();
  blob(ctx, -2.5, 0, 2.5, 2.2);
  ctx.fill();
  ctx.fillStyle = '#4a3f33';
  ctx.beginPath();
  blob(ctx, 1.3, 0, 1.6, 1.3);
  ctx.fill();
  ctx.restore();
}

function tinyBee(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, beat: number) {
  ctx.fillStyle = '#161e0c';
  ctx.globalAlpha = 0.22;
  ctx.beginPath();
  blob(ctx, x + 2, y + 9, 3.4 * MILL_SCALE, 1.6 * MILL_SCALE);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(MILL_SCALE, MILL_SCALE);
  const flap = 0.55 + Math.abs(Math.sin(beat)) * 0.45;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.beginPath();
  blob(ctx, -0.4, -2.9 * flap, 2.3, 2.6 * flap, -0.5);
  blob(ctx, -0.4, 2.9 * flap, 2.3, 2.6 * flap, 0.5);
  ctx.fill();
  ctx.fillStyle = '#f0b429';
  ctx.beginPath();
  blob(ctx, -0.8, 0, 3.7, 2.4);
  ctx.fill();
  ctx.fillStyle = '#231a10';
  ctx.fillRect(-2.8, -2.1, 1.2, 4.2);
  ctx.fillRect(-0.5, -2.4, 1.2, 4.8);
  ctx.beginPath();
  blob(ctx, 3.1, 0, 1.6, 1.6);
  ctx.fill();
  ctx.restore();
}

/**
 * The garrison seen at the door. Each one walks out from the doorway to its
 * own patch and back in again as the hut's stock crosses a band, so the count
 * changing is seen as something coming or going, not as a sprite appearing.
 */
function paintMillers(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap, state: SwarmState, now: number, dt: number) {
  state.huts.forEach((hut, index) => {
    const site = map.sites[index];
    const want = hut.owner && !site.tower ? millCount(stockOf(hut)) : 0;
    const shown = feel.mill[index] + Math.max(-dt / MILL_MS, Math.min(dt / MILL_MS, want - feel.mill[index]));
    feel.mill[index] = shown;
    if (shown <= 0 || !hut.owner) return;
    const r = siteRadius(site, hut.level);
    for (let k = 0; k < shown; k++) {
      const out = smooth(Math.min(1, shown - k));
      const id = index * 16 + k;
      const phase = hash01(id) * TAU;
      const kind = feel.kinds[hut.owner];
      if (kind !== 'bee') {
        const pace = 0.0009 + hash01(id + 5) * 0.0006;
        const a = now * pace + phase;
        const b = now * pace * 0.7 + phase * 2;
        const x = site.x + ((hash01(id + 1) * 2 - 1) * r * 0.85 + Math.sin(a) * 8) * out;
        const y = site.y + 4 + (3 + hash01(id + 2) * r * 0.3 + Math.sin(b) * 3) * out;
        const angle = Math.atan2(Math.cos(b) * 3 * 0.7, Math.cos(a) * 8);
        const stride = now * 0.012 + phase;
        if (kind === 'ant') tinyAnt(ctx, x, y, angle, stride);
        else if (kind === 'beetle') tinyBeetle(ctx, x, y, angle, stride);
        else tinySpider(ctx, x, y, angle, stride);
      } else {
        const round = hash01(id + 1) * TAU;
        const a = now * (0.0022 + hash01(id + 5) * 0.001) + phase;
        const x = site.x + (Math.cos(round) * r * 0.95 + Math.cos(a) * 6) * out;
        const y = site.y - r * 0.3 + (Math.sin(round) * r * 0.42 + Math.sin(a * 1.3) * 4) * out;
        tinyBee(ctx, x, y, Math.atan2(Math.cos(a * 1.3) * 4 * 1.3, -Math.sin(a) * 6), now * 0.05 + phase);
      }
    }
  });
}

/** The least height, in CSS px, the callout's words are drawn at. */
const BANNER_MIN_PX = 11;

function paintBanner(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap, now: number, px: number) {
  const banner = currentCallout(feel.callouts, now);
  if (!banner) return;
  const t = now - banner.at;
  // In quickly from just above so it is noticed, still while it is read, then lifted away.
  const arriving = Math.min(1, t / BANNER_MS.in);
  const leaving = Math.max(0, (t - BANNER_MS.in - BANNER_MS.hold) / BANNER_MS.out);
  const text = calloutWords(banner, feel.kinds);
  const grow = growOf(13, BANNER_MIN_PX, px);
  ctx.font = fontOf(600, 13 * grow);
  const width = ctx.measureText(text).width + 28 * grow;
  const y = (44 - (1 - easeOut(arriving)) * 8 - leaving * leaving * 6) * grow;
  ctx.globalAlpha = easeOut(arriving) * (1 - leaving);
  ctx.fillStyle = 'rgba(24, 22, 18, 0.8)';
  ctx.beginPath();
  ctx.roundRect(map.w / 2 - width / 2, y - 12 * grow, width, 24 * grow, 4 * grow);
  ctx.fill();
  ctx.fillStyle = '#f4efe2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, map.w / 2, y + 0.5 * grow);
  ctx.globalAlpha = 1;
}

/** After the ground and paths, before huts and units. */
export function drawUnder(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap, state: SwarmState, now: number): void {
  sweep(feel, now);
  ctx.save();
  paintWear(ctx, feel, map);
  if (map.scene === 'meadow') paintGusts(ctx, feel.ambient.blades, feel.stirred.blades, now);
  paintFlow(ctx, feel.ambient.streams, now);
  if (map.scene === 'valley' && map.rivers.length > 0) {
    paintMist(ctx, feel, map, now);
    paintReeds(ctx, feel.ambient.reeds, feel.stirred.reeds, now);
  }
  if (map.scene === 'ice') paintSpindrift(ctx, feel.ambient.drifts, now);
  if (map.scene === 'terrace') paintCloudShadows(ctx, feel, map, now);
  paintDust(ctx, feel, map.scene, now);
  paintMarks(ctx, feel, now);
  paintFalls(ctx, feel, map, state, now);
  ctx.restore();
}

/** After everything else in the world, before the drag UI. `px` is world units to a CSS pixel. */
export function drawOver(ctx: CanvasRenderingContext2D, feel: Feel, map: SwarmMap, state: SwarmState, now: number, px: number): void {
  const dt = Math.min(100, now - feel.drawnAt);
  feel.drawnAt = now;
  ctx.save();
  paintMillers(ctx, feel, map, state, now, dt);
  if (map.scene === 'meadow') paintLeaves(ctx, feel.ambient.motes, map, now);
  if (map.scene === 'scrub') paintScrubAir(ctx, feel, map, now);
  if (map.scene === 'ice') paintSnow(ctx, feel.ambient.motes, map, now);
  if (map.scene === 'terrace') paintBirds(ctx, feel.ambient, now);
  paintCritters(ctx, feel.ambient.critters, now, dt);
  paintBanner(ctx, feel, map, now, px);
  ctx.restore();
}
