// Slugs: a turn-based artillery game. Teams of slugs on a side-on landscape
// that explosions carve away, over water that drowns them.
//
// The whole game is a pure function of the seed, the options and the players'
// inputs, tick by tick, the way Swarm's is: integer arithmetic only, a seeded
// generator kept in the state, and no Math.sin/cos/atan2 (their last bits
// differ between browsers). Positions and speeds are fixed point, ONE to a
// pixel. The computer's inputs are worked out inside the tick from the state,
// so every client gives it the same ones.
//
// The physics numbers are the ones measured for the classic 2D artillery games
// on the Worms Knowledge Base (worms2d.info, "Physics Engine", "Fall Damage",
// "Worm Walking", "Detailed Weapon Settings", the weapon pages), collected in
// docs/slugs-mechanics-research.md. Where that source had no value, the
// constant says the number is ours.

import { buildMap, type MapDesignId } from './slugsMaps';

export const TICK_MS = 20;
export const ONE = 65536;
export const W = 1920;
export const H = 696;

/** 0.24 px/frame². */
export const GRAVITY = 15728;
/** Each of the ten wind steps either way pushes a wind-borne shell sideways by 11.9% of gravity. */
export const WIND_STEP = 1872;
export const WIND_MOST = 10;
export const SPEED_CAP = 32 * ONE;
/** A full-power shot leaves at about 24 px/frame. The bar is taken as linear (not measured). */
export const FULL_SPEED = 24 * ONE;
/** Ticks for the power bar to fill. Ours: the source does not give it. */
export const CHARGE_TICKS = 60;
/** Ground friction per tick while sliding. */
export const FRICTION = 62914;

export const SLUG_HALF_W = 4;
export const SLUG_HALF_H = 8;
/** Most a slug climbs or drops in one step of a walk. */
export const STEP_PX = 8;
/** Quarter pixels walked on each tick of an 18-tick crawl cycle: about 27 px a second. */
export const WALK_CYCLE = [2, 0, 2, 2, 2, 2, 6, 7, 6, 5, 1, 0, 1, 1, 1, 0, 0, 0];

export const JUMP = { vx: Math.trunc(2.25 * ONE), vy: -Math.trunc(3.897 * ONE) };
export const FLIP = { vx: -Math.trunc(0.424 * ONE), vy: -Math.trunc(5.988 * ONE) };
/** The source gives only the result, about 28 px back; this launch lands there, rising about 52 px. */
export const BACKJUMP = { vx: -Math.trunc(0.672 * ONE), vy: -Math.trunc(5 * ONE) };
/** Straight up about 39 px, as the source's straight jump: v = sqrt(2 * gravity * 39). */
export const HOP = { vx: 0, vy: -Math.trunc(4.327 * ONE) };
const LEAP = { jump: JUMP, flip: FLIP, backjump: BACKJUMP, hop: HOP } as const;
/**
 * Holding left or right in the air pushes a slug that jumped or stepped off by this much a tick,
 * up to a forward jump's own speed. Ours: Worms has no steering in the air, and the table asked
 * for it so a jump can be carried over or up onto what it would otherwise fall short of.
 */
const AIR_PUSH = Math.trunc(0.12 * ONE);
const AIR_TOP = JUMP.vx;

/**
 * Landing faster than this hurts, by `((v - 8 + 1/65536) * FALL_COEF + 18) / 18` hp, and ends the turn.
 * The coefficient is the source's fall-damage setting at 2, double its default: at 1 a 300 px drop
 * cost 12 hp and falls hardly counted.
 */
export const FALL_SAFE = 8 * ONE;
export const FALL_COEF = 100;

export const TURN_TICKS = 45 * 50;
export const RETREAT_TICKS = 3 * 50;
/** Retreat after firing from a rope. */
const ROPE_RETREAT = 5 * 50;
export const ROUND_TICKS = 15 * 60 * 50;
/** The hot seat: the most a person's turn waits before its clock starts. Their first key or act starts it sooner. */
export const READY_TICKS = 5 * 50;
/** The computer's turn starts after this, as it has no key to press. */
const CPU_READY_TICKS = 60;
export const START_HP = 100;
/** Sudden death: every slug to 1 hp, then the water rises this much each turn. */
export const WATER_RISE = 20;
export const WATER_START = H - 70;
/** Ticks the board must be still before the turn's damage is counted. Ours. */
const QUIET_TICKS = 25;
/** Longest a turn waits for the board to settle. Ours. */
const SETTLE_MOST = 30 * 50;
const DEATH_GAP = 40;
/** Bounce off a wall or roof keeps this much of the speed into it. Ours. */
const WALL_KEEP = 26214;

/**
 * Knockback, in fixed-point speed per hp of damage dealt. The source gives no
 * formula; this throws a slug hit squarely by a 50 hp blast about 7 px/frame.
 */
const KNOCK_PER_HP = 9800;

/**
 * How far past the crater a blast still shoves, as a percent of the crater radius. Ours. Damage
 * stops at the crater's edge, but a push that fell to nothing there as well left a slug at the rim
 * hurt but unmoved, and one a pixel outside untouched though the fireball covered it.
 */
const SHOVE_PCT = 150;

export interface SlugsOptions {
  turnSeconds: number;
  startHp: number;
  /** Wind strength as a percent of the measured scale; 0 turns it off. */
  windScale: number;
  /** Mines and barrels scattered on the land at the start. Fewer are placed if the land has no room. */
  mines: number;
  barrels: number;
  /** 'classic' is the first six weapons; 'all' stocks every weapon. */
  weapons: 'classic' | 'all';
  /** Minutes of play, settling between turns included, before sudden death. */
  roundMinutes: number;
  /** Pixels the water rises each turn in sudden death. */
  waterRise: number;
  /** Which map design the land is built from (slugsMaps.ts). */
  map: MapDesignId;
  /** 'players': before the first turn each team picks where its slugs start, one slug at a time (Worms' manual placement). */
  placing: 'auto' | 'players';
}

export const DEFAULT_OPTIONS: SlugsOptions = {
  turnSeconds: TURN_TICKS / 50,
  startHp: START_HP,
  windScale: 100,
  mines: 0,
  barrels: 0,
  weapons: 'classic',
  roundMinutes: ROUND_TICKS / 3000,
  waterRise: WATER_RISE,
  map: 'classic',
  placing: 'auto',
};

// --- Fixed-point trig: sin of 0..90 degrees, times ONE. ---
const SIN_TABLE = [0,1144,2287,3430,4572,5712,6850,7987,9121,10252,11380,12505,13626,14742,15855,16962,18064,19161,20252,21336,22415,23486,24550,25607,26656,27697,28729,29753,30767,31772,32768,33754,34729,35693,36647,37590,38521,39441,40348,41243,42126,42995,43852,44695,45525,46341,47143,47930,48703,49461,50203,50931,51643,52339,53020,53684,54332,54963,55578,56175,56756,57319,57865,58393,58903,59396,59870,60326,60764,61183,61584,61966,62328,62672,62997,63303,63589,63856,64104,64332,64540,64729,64898,65048,65177,65287,65376,65446,65496,65526,65536];

/** sin of a whole number of degrees in -90..90, times ONE. */
export function sinDeg(deg: number): number {
  return deg < 0 ? -SIN_TABLE[-deg] : SIN_TABLE[deg];
}
export function cosDeg(deg: number): number {
  return SIN_TABLE[90 - Math.abs(deg)];
}

/** Aim is degrees above the horizontal (-90 straight down, 90 straight up), toward `facing`. */
export function aimVector(facing: number, aim: number, speed: number): { vx: number; vy: number } {
  return {
    vx: Math.trunc((facing * cosDeg(aim) * (speed / ONE))),
    vy: -Math.trunc(sinDeg(aim) * (speed / ONE)),
  };
}

export const px = (v: number) => Math.floor(v / ONE);
/** Exact integer square root for 0 <= n < 2^53, so it cannot depend on how a browser rounds. */
function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

// --- Seeded generator, its state kept in the game state so it can be copied. ---
export function nextRand(s: { rng: number }): number {
  s.rng = (s.rng + 0x6d2b79f5) >>> 0;
  let t = s.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
/** A whole number in 0..n-1. */
export const randInt = (s: { rng: number }, n: number) => nextRand(s) % n;

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// --- Weapons ---

export type WeaponId =
  | 'bazooka' | 'homing' | 'mortar' | 'grenade' | 'cluster' | 'seedpod' | 'jar' | 'borer'
  | 'dynamite' | 'mine' | 'snail' | 'airstrike' | 'millstone'
  | 'shotgun' | 'handgun' | 'machinegun' | 'minigun' | 'longshot'
  | 'uppercut' | 'spade' | 'prod'
  | 'rope' | 'jetpack' | 'parachute' | 'teleport' | 'girder' | 'blowtorch' | 'drill';

export const WEAPONS: readonly WeaponId[] = [
  'bazooka', 'homing', 'mortar', 'grenade', 'cluster', 'seedpod', 'jar', 'borer',
  'dynamite', 'mine', 'snail', 'airstrike', 'millstone',
  'shotgun', 'handgun', 'machinegun', 'minigun', 'longshot',
  'uppercut', 'spade', 'prod',
  'rope', 'jetpack', 'parachute', 'teleport', 'girder', 'blowtorch', 'drill',
];

export type WeaponCategory = 'explosive' | 'special' | 'firearm' | 'melee' | 'tool';

/**
 * How a weapon is set off:
 * - 'charge': hold fire to fill the power bar, release to launch along the aim.
 * - 'shot': press fire and it happens at once along the aim (guns, close combat, and tools
 *   that start on a press: rope, jetpack, parachute, blowtorch, drill). Press again to let go
 *   of the rope, switch off the jetpack, or stop a blowtorch or drill early.
 * - 'drop': press fire and it is put down at the slug's feet.
 * - 'target': send `{ t: 'target', x, y }` and that sets it off at the point.
 * - 'mark': send `{ t: 'target', x, y }` to mark the point, then charge and fire like 'charge'.
 */
export type WeaponUse = 'charge' | 'shot' | 'drop' | 'target' | 'mark';

export interface WeaponSpec {
  name: string;
  /** One plain line on what it does. */
  desc: string;
  category: WeaponCategory;
  use: WeaponUse;
  /** Starting stock per team; -1 is unlimited. Stocks are ours. */
  ammo: number;
  /** The fuse can be set (`{ t: 'fuse', n }`, 1 to 5 s). */
  fuse: boolean;
  wind: boolean;
  /** Whether the aim angle matters, so the crosshair is worth drawing. */
  aims: boolean;
  /** Using it is the turn's attack: retreat time follows and nothing else can be fired. */
  ends: boolean;
  /** Full damage of its blast or hit, before falloff. */
  damage: number;
  /** Blast radius in px; 0 for no blast. */
  crater: number;
  /** Percent of the crater radius the knockback centre is moved down, so a slug hit from above still flies up. */
  bias: number;
  retreat: number;
  /** In the classic set as well as in 'all'. */
  classic: boolean;
}

// Standard blast 50 hp / 97 px crater, large 75 / 147 (worms2d.info power 3); radii are half the diameters.
export const WEAPON: Record<WeaponId, WeaponSpec> = {
  bazooka: { name: 'Bazooka', desc: 'Charged shell that drifts with the wind and bursts on contact.', category: 'explosive', use: 'charge', ammo: -1, fuse: false, wind: true, aims: true, ends: true, damage: 50, crater: 48, bias: 0, retreat: RETREAT_TICKS, classic: true },
  homing: { name: 'Homing missile', desc: 'Mark a point, then fire: from half a second in it steers to the point until 4 s.', category: 'explosive', use: 'mark', ammo: 2, fuse: false, wind: true, aims: true, ends: true, damage: 50, crater: 48, bias: 5, retreat: RETREAT_TICKS, classic: false },
  mortar: { name: 'Mortar', desc: 'Full-power shell that drifts with the wind and throws five bomblets where it lands.', category: 'explosive', use: 'shot', ammo: 3, fuse: false, wind: true, aims: true, ends: true, damage: 20, crater: 17, bias: 0, retreat: RETREAT_TICKS, classic: false },
  grenade: { name: 'Grenade', desc: 'Thrown with a 1 to 5 s fuse; bounces and ignores the wind.', category: 'explosive', use: 'charge', ammo: -1, fuse: true, wind: false, aims: true, ends: true, damage: 50, crater: 48, bias: 10, retreat: RETREAT_TICKS, classic: true },
  cluster: { name: 'Cluster bomb', desc: 'Thrown with a fuse; bursts into five bomblets that go off on contact.', category: 'explosive', use: 'charge', ammo: 5, fuse: true, wind: false, aims: true, ends: true, damage: 26, crater: 23, bias: 10, retreat: RETREAT_TICKS, classic: true },
  seedpod: { name: 'Seed pod', desc: 'Thrown with a fuse; splits into four heavy seeds that bounce and go off after 1 to 2 s.', category: 'special', use: 'charge', ammo: 1, fuse: true, wind: false, aims: true, ends: true, damage: 40, crater: 36, bias: 10, retreat: RETREAT_TICKS, classic: false },
  jar: { name: 'Pickle jar', desc: 'Very large blast. Fixed 3 s fuse, and it waits until it has stopped rolling.', category: 'special', use: 'charge', ammo: 1, fuse: false, wind: false, aims: true, ends: true, damage: 100, crater: 99, bias: 75, retreat: RETREAT_TICKS, classic: false },
  borer: { name: 'Borer', desc: 'Charged shell that tunnels about 90 px into the land before it bursts.', category: 'explosive', use: 'charge', ammo: 2, fuse: false, wind: true, aims: true, ends: true, damage: 50, crater: 48, bias: 0, retreat: RETREAT_TICKS, classic: false },
  dynamite: { name: 'Dynamite', desc: 'Dropped at your feet; a large blast after 5 s.', category: 'explosive', use: 'drop', ammo: 1, fuse: false, wind: false, aims: false, ends: true, damage: 75, crater: 73, bias: 50, retreat: 5 * 50, classic: true },
  mine: { name: 'Mine', desc: 'Dropped at your feet; goes off 3 s after any slug comes within 48 px. One in six is a dud.', category: 'explosive', use: 'drop', ammo: 2, fuse: false, wind: false, aims: false, ends: true, damage: 50, crater: 48, bias: 50, retreat: RETREAT_TICKS, classic: false },
  snail: { name: 'Snail', desc: 'Crawls the way you face, hopping steps and turning at walls. Fire sets it off; it goes by itself after 20 s.', category: 'special', use: 'drop', ammo: 1, fuse: false, wind: false, aims: false, ends: true, damage: 75, crater: 73, bias: 50, retreat: RETREAT_TICKS, classic: false },
  airstrike: { name: 'Air strike', desc: 'Pick a point: five missiles come down across it from the side you face.', category: 'explosive', use: 'target', ammo: 1, fuse: false, wind: false, aims: false, ends: true, damage: 30, crater: 30, bias: 0, retreat: RETREAT_TICKS, classic: true },
  millstone: { name: 'Millstone', desc: 'Pick a point: a stone drops there and bursts through every layer of land down to the water.', category: 'special', use: 'target', ammo: 1, fuse: false, wind: false, aims: false, ends: true, damage: 60, crater: 40, bias: 100, retreat: RETREAT_TICKS, classic: false },
  shotgun: { name: 'Shotgun', desc: 'Two straight shots per turn, 25 damage each.', category: 'firearm', use: 'shot', ammo: -1, fuse: false, wind: false, aims: true, ends: true, damage: 25, crater: 12, bias: 5, retreat: RETREAT_TICKS, classic: true },
  handgun: { name: 'Handgun', desc: 'Six straight shots, 5 damage each; the aim can move between shots.', category: 'firearm', use: 'shot', ammo: 2, fuse: false, wind: false, aims: true, ends: true, damage: 5, crater: 4, bias: 5, retreat: RETREAT_TICKS, classic: false },
  machinegun: { name: 'Machine gun', desc: 'Ten scattered rounds, 5 damage each, one every 0.12 s.', category: 'firearm', use: 'shot', ammo: 2, fuse: false, wind: false, aims: true, ends: true, damage: 5, crater: 4, bias: 5, retreat: RETREAT_TICKS, classic: false },
  minigun: { name: 'Minigun', desc: 'Twenty scattered rounds, 5 damage each, one every 0.06 s.', category: 'firearm', use: 'shot', ammo: 1, fuse: false, wind: false, aims: true, ends: true, damage: 5, crater: 4, bias: 20, retreat: RETREAT_TICKS, classic: false },
  longshot: { name: 'Long shot', desc: 'One straight shot that crosses the whole map, 35 damage.', category: 'firearm', use: 'shot', ammo: 2, fuse: false, wind: false, aims: true, ends: true, damage: 35, crater: 6, bias: 5, retreat: RETREAT_TICKS, classic: false },
  uppercut: { name: 'Uppercut', desc: 'Leap up punching: 30 damage, and a slug just in front is thrown upward.', category: 'melee', use: 'shot', ammo: -1, fuse: false, wind: false, aims: false, ends: true, damage: 30, crater: 0, bias: 0, retreat: RETREAT_TICKS, classic: false },
  spade: { name: 'Spade', desc: 'Swing along the aim: 30 damage, and a slug just in front is thrown far.', category: 'melee', use: 'shot', ammo: 1, fuse: false, wind: false, aims: true, ends: true, damage: 30, crater: 0, bias: 0, retreat: RETREAT_TICKS, classic: false },
  prod: { name: 'Prod', desc: 'Nudge a slug just in front. No damage: a fall or the water does the rest.', category: 'melee', use: 'shot', ammo: -1, fuse: false, wind: false, aims: false, ends: true, damage: 0, crater: 0, bias: 0, retreat: RETREAT_TICKS, classic: false },
  rope: { name: 'Grapple', desc: 'Fire a rope upward along the aim to swing on. Up and down climb, left and right swing, fire lets go.', category: 'tool', use: 'shot', ammo: -1, fuse: false, wind: false, aims: true, ends: false, damage: 0, crater: 0, bias: 0, retreat: 0, classic: false },
  jetpack: { name: 'Jetpack', desc: 'Fly on 5 s of thrust: up, left and right. Fire again to switch it off.', category: 'tool', use: 'shot', ammo: 2, fuse: false, wind: false, aims: false, ends: false, damage: 0, crater: 0, bias: 0, retreat: 0, classic: false },
  parachute: { name: 'Parachute', desc: 'Open while falling: drifts with the wind and lands without fall damage.', category: 'tool', use: 'shot', ammo: 2, fuse: false, wind: true, aims: false, ends: false, damage: 0, crater: 0, bias: 0, retreat: 0, classic: false },
  teleport: { name: 'Teleport', desc: 'Pick any clear spot and move there. Ends the turn.', category: 'tool', use: 'target', ammo: 2, fuse: false, wind: false, aims: false, ends: true, damage: 0, crater: 0, bias: 0, retreat: 0, classic: false },
  girder: { name: 'Girder', desc: 'Pick a spot within 200 px for a 64 px beam; turn it first with the girder control.', category: 'tool', use: 'target', ammo: 3, fuse: false, wind: false, aims: false, ends: true, damage: 0, crater: 0, bias: 0, retreat: RETREAT_TICKS, classic: false },
  blowtorch: { name: 'Blowtorch', desc: 'Burn a tunnel forward for up to 5 s: level, or angled up or down by the aim.', category: 'tool', use: 'shot', ammo: 2, fuse: false, wind: false, aims: true, ends: true, damage: 15, crater: 0, bias: 0, retreat: RETREAT_TICKS, classic: false },
  drill: { name: 'Drill', desc: 'Dig straight down for up to 5 s.', category: 'tool', use: 'shot', ammo: 2, fuse: false, wind: false, aims: false, ends: true, damage: 15, crater: 0, bias: 0, retreat: RETREAT_TICKS, classic: false },
};

const CLUSTER_BITS = 5;
/** Mortar bomblets: about 19 hp and 35 px craters each (worms2d.info). How many there are is ours. */
const MORTAR_BITS = 5;
const MORTAR_BIT = { damage: 19, crater: 17 };
const CLUSTER_BIT = { damage: 26, crater: 23 };
/** Cluster bits go off on contact or after 9 s. */
const BIT_LIFE = 9 * 50;
const POD_SEEDS = 4;
const SHOTGUN_SHOTS = 2;
const SHOT_RANGE = 900;
const LONG_RANGE = 2400;
const DYNAMITE_FUSE = 5 * 50;
const JAR_FUSE = 3 * 50;
const STRIKE_MISSILES = 5;
const STRIKE_GAP = 26;
const STRIKE_SPEED = 7 * ONE;
/** Homing: flies as a shell for 0.5 s, steers until 4 s, goes off by itself at 10 s. */
const HOMING_LOCK = 25;
const HOMING_END = 200;
const HOMING_LIFE = 500;
/** Speed it steers toward, and the share of the gap closed each tick. Ours. */
const HOMING_SPEED = 12 * ONE;
const HOMING_TURN = 8;
/** Borer: tunnelling speed and ticks of tunnel before it bursts (about 90 px). Ours. */
const BORER_SPEED = 2 * ONE;
const BORER_TICKS = 45;
const BORER_HOLE = 7;
/** Snail: crawl speed, longest life, and hops at one wall before it turns. Ours, except the 20 s. */
const SNAIL_SPEED = Math.trunc(1.5 * ONE);
const SNAIL_LIFE = 20 * 50;
const SNAIL_HOPS = 2;
const SNAIL_HALF = 4;
/** Millstone: fastest fall, and ticks between two of its blasts. Ours. */
const STONE_FALL = 9 * ONE;
const STONE_GAP = 6;
/** Bullets: tick gap and rounds. Handgun gap and every spread are ours. */
const BURST: Partial<Record<WeaponId, { rounds: number; gap: number; spread: number }>> = {
  handgun: { rounds: 6, gap: 10, spread: 0 },
  machinegun: { rounds: 10, gap: 6, spread: 3 },
  minigun: { rounds: 20, gap: 3, spread: 4 },
};
/** Close combat reach in front of the slug. Ours. */
const MELEE_REACH = 18;
/** Spade at 45° throws a slug about 643 px on the flat: v = sqrt(643 × 0.24). */
const SPADE_SPEED = Math.trunc(12.42 * ONE);
const UPPERCUT_SELF = -5 * ONE;
const UPPERCUT_THROW = 9 * ONE;
const PROD_PUSH = 2 * ONE;
/** Dig tools last 5 s. Blowtorch tunnels about 141 px in that time, the drill about 158 px down. */
const DIG_TICKS = 250;
const TORCH_RATE = Math.trunc((141 * ONE) / 250);
const DRILL_RATE = Math.trunc((158 * ONE) / 250);
/** Rope: reach and the 16 px/frame cap from the source; the rest is ours. */
const ROPE_MAX = 378;
const ROPE_MIN = 10;
const ROPE_CAP = 16 * ONE;
/** Rope shots a turn: the source's default rope power 3 allows 2. */
const ROPE_SHOTS = 2;
const ROPE_REEL = 2 * ONE;
const ROPE_PUSH = 6554;
/** Shortest stretch of rope between two bends; closer bends are the same corner. */
const ROPE_BEND_MIN = 3;
/** Jetpack: 30 fuel, 6 a second per thruster, 5 px/frame cap. Thrust strengths are ours. */
const JET_FUEL = 30 * 50;
const JET_BURN = 6;
const JET_CAP = 5 * ONE;
const JET_UP = Math.trunc(GRAVITY * 1.8);
const JET_SIDE = Math.trunc(GRAVITY * 0.6);
/** Parachute: fall speed and the drift per wind step. Ours. */
const CHUTE_FALL = Math.trunc(1.5 * ONE);
const CHUTE_DRIFT = Math.trunc(0.25 * ONE);
const TELEPORT_TOP = 10;
/** Girder: reach about 200 px, long beam about 64 px, eight angles in 22.5° steps. Thickness ours. */
export const GIRDER_REACH = 200;
export const GIRDER_HALF = 32;
const GIRDER_THICK = 3;
const GIRDER_DIR: readonly (readonly [number, number])[] = [
  [65536, 0], [60547, 25080], [46341, 46341], [25080, 60547], [0, 65536], [-25080, 60547], [-46341, 46341], [-60547, 25080],
];
/** Mines: a 48 px diamond trips them, 3 s when placed by a slug; one trigger in each six is a dud. */
const MINE_REACH = 48;
const MINE_FUSE = 3 * 50;
const DUD_BAG = 6;
const MINE_HALF = { w: 4, h: 2 };
/** Barrels: what they take before they burst, and the burst. All ours (the source gives no numbers). */
const BARREL_HP = 40;
const BARREL_HALF = { w: 6, h: 8 };
const BARREL_BLAST = { damage: 50, crater: 40, bias: 50 };
/** A grenade keeps 96% of its speed along the ground, and 60% (high bounce) or 30% (low) of it off the ground. */
const BOUNCE_ALONG = 62915;
const BOUNCE_HIGH = 39322;
const BOUNCE_LOW = 19661;
/** A thrown thing this slow, with ground under it, stops. Ours. */
const REST_SPEED = Math.trunc(0.6 * ONE);
/** Slug death: a small burst of up to 25 hp. */
const POP_DAMAGE = 25;
const POP_CRATER = 20;

export type ProjKind =
  | 'shell' | 'grenade' | 'cluster' | 'bit' | 'dynamite' | 'missile'
  | 'homing' | 'mortar' | 'pod' | 'seed' | 'jar' | 'borer' | 'snail' | 'stone';

export interface Proj {
  id: number;
  kind: ProjKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks to go off; -1 goes off on contact. */
  fuse: number;
  bounce: number;
  wind: boolean;
  damage: number;
  crater: number;
  bias: number;
  owner: number;
  /** Has left its owner's body, so it can hit them. */
  free: boolean;
  rest: boolean;
  /** Ticks since launch. */
  age: number;
  /** Goes off by itself at this age; -1 never. */
  life: number;
  /** The point a homing missile steers to, in px. */
  tx: number;
  ty: number;
  /** Which way a snail crawls. */
  dir: 1 | -1;
  /** Borer: ticks of tunnel left once it has met land (0 before). Millstone: ticks until it can burst again. */
  dig: number;
  /** Snail: hops at the wall in front of it. */
  hops: number;
}

export type ObjKind = 'mine' | 'barrel';

/** Things lying on the land between turns: mines and barrels. */
export interface Obj {
  id: number;
  kind: ObjKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rest: boolean;
  /** Mine: ticks until it goes off once tripped; -1 not tripped. */
  fuse: number;
  /** Mine: the fuse it lights with. */
  delay: number;
  /** Mine: tripped and fizzled; it never goes off. */
  dud: boolean;
  /** Mine: ticks before a slug can trip it, so whoever drops it has the retreat to get clear. */
  arm: number;
  /** Barrel: damage it takes before it bursts. */
  hp: number;
}

/** A rope from its first anchor, bent round corners: the slug swings on the last point. */
export interface Rope {
  /** Anchor, then each corner it is wrapped round, in px. `side` is the turn it wrapped with, to unwrap. */
  pts: { x: number; y: number; side: number }[];
  /** Free length from the last point to the slug, fixed point. */
  len: number;
}

/** A gun firing a burst, or a tool digging, over several ticks. */
export interface Using {
  w: WeaponId;
  /** Rounds, or dig ticks, left. */
  left: number;
  t: number;
  /** Slugs a dig tool has already hurt. */
  hit: number[];
}

// --- State ---

export type Control = 'human' | 1 | 2 | 3 | 4 | 5;

export interface TeamSetup {
  name: string;
  control: Control;
}

export interface Team {
  name: string;
  color: number;
  control: Control;
  slugs: number[];
  /** Index into slugs of the one that went last. */
  last: number;
  out: boolean;
  ammo: Record<WeaponId, number>;
  /** The weapon, fuse and bounce this team last chose, taken up again at the start of its next turn. */
  weapon: WeaponId;
  fuse: number;
  bounceHigh: boolean;
}

export interface Slug {
  id: number;
  team: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 'rope' swinging, 'jet' on a jetpack, 'chute' under a parachute. */
  mode: 'stand' | 'air' | 'slide' | 'rope' | 'jet' | 'chute';
  /** Thrown by a blast or a blow: it cannot steer, and skids where it lands. */
  blown: boolean;
  /** Jetpack thrusters burning this tick, as KEY bits (up, left, right); 0 or absent when none. */
  thrust?: number;
  facing: 1 | -1;
  aim: number;
  hp: number;
  /** What its label shows. It catches up with hp when the turn's damage is counted. */
  shown: number;
  alive: boolean;
  drowned: boolean;
  walk: number;
  /** Ticks since it last moved, for the drawing. */
  still: number;
}

/** What set off a blast: a projectile, a weapon fired straight, a barrel, a mine, or a slug popping. */
export type BoomSource = ProjKind | WeaponId | ObjKind | 'pop';

export type Phase = 'place' | 'ready' | 'turn' | 'retreat' | 'settle' | 'tally' | 'deaths' | 'over';

export type SlugEvent =
  /** `src` is what went off, when the rules know it. */
  | { k: 'boom'; x: number; y: number; r: number; src?: BoomSource }
  | { k: 'fire'; w: WeaponId; x: number; y: number }
  /** A straight shot by slug `id`, from its gun at (x0, y0). */
  | { k: 'shot'; id: number; x0: number; y0: number; x1: number; y1: number }
  | { k: 'splash'; x: number; big: boolean }
  | { k: 'bounce'; x: number; y: number }
  | { k: 'hurt'; id: number; dmg: number }
  | { k: 'fall'; id: number; dmg: number }
  | { k: 'die'; id: number }
  | { k: 'drown'; id: number }
  | { k: 'turn'; id: number }
  | { k: 'jump'; id: number }
  | { k: 'sudden' }
  | { k: 'rise' }
  /** Land changed in this box (dig, tunnel, girder) other than by a 'boom'; redraw it from the terrain. */
  | { k: 'land'; x0: number; y0: number; x1: number; y1: number }
  /** Rope caught at (x, y), or flew out to (x, y) and caught nothing. */
  | { k: 'rope'; x: number; y: number; hit: boolean }
  | { k: 'unrope'; id: number }
  | { k: 'teleport'; id: number; x0: number; y0: number; x1: number; y1: number }
  | { k: 'girder'; x0: number; y0: number; x1: number; y1: number }
  /** A mine was tripped; it goes off (or fizzles) in `fuse` ticks. */
  | { k: 'mine'; id: number; fuse: number }
  | { k: 'dud'; x: number; y: number }
  /** A close-combat blow landed on slug `id`. */
  | { k: 'blow'; w: WeaponId; id: number }
  | { k: 'jet'; id: number; on: boolean }
  | { k: 'chute'; id: number; open: boolean };

/** Where the computer's turn has got to: searching shots, looking for a place to move to, moving, trying out the shot, aiming it. */
export type CpuStage = 'shots' | 'moves' | 'move' | 'check' | 'aim';
export type CpuMove = 'walk' | 'jet' | 'rope' | 'teleport';

/** The computer's turn so far. Plain values only, so cloneState's shallow copy is a full one. */
export interface CpuPlan {
  stage: CpuStage;
  /** The next search job, or move to try. */
  step: number;
  /** The best shot's worth so far (see `worth`). */
  score: number;
  weapon: WeaponId;
  facing: 1 | -1;
  aim: number;
  power: number;
  fuse: number;
  /** Where the shot is expected to go off, or the point picked for a 'target' or 'mark' weapon. */
  tx: number;
  ty: number;
  /** The shot as found, before the level's error. */
  aim0: number;
  power0: number;
  tx0: number;
  /** Shots tried out and turned down for hurting its own side. */
  tries: number;
  /** A weapon left out of the second search after its shot kept hurting its own side. */
  banned: WeaponId | null;
  move: CpuMove | null;
  dir: 1 | -1;
  /** Ticks of walking, of rising on the jetpack, or of swinging on the rope. */
  len: number;
  moveAim: number;
  /** Teleport point. */
  mx: number;
  my: number;
  moveScore: number;
  moveT: number;
  /** Ticks on the jetpack or rope so far; -1 after the rope is fired and before it catches. */
  flown: number;
  moves: number;
}

export interface SlugsState {
  seed: number;
  rng: number;
  tick: number;
  /** One byte a pixel: 0 empty, 1 land, 2 girder (destructible like land, drawn differently), 3 steel (STEEL: never carved). */
  terrain: Uint8Array;
  water: number;
  wind: number;
  teams: Team[];
  slugs: Slug[];
  projs: Proj[];
  objs: Obj[];
  nextId: number;
  phase: Phase;
  /** Ticks into the phase. */
  phaseT: number;
  /** Turn time left, in ticks, while the timer runs. */
  timeLeft: number;
  roundT: number;
  sudden: boolean;
  activeTeam: number;
  active: number;
  weapon: WeaponId;
  fuse: number;
  bounceHigh: boolean;
  charging: boolean;
  power: number;
  shotsLeft: number;
  held: number;
  quiet: number;
  winner: number | null;
  plan: CpuPlan | null;
  /** The point marked for a 'mark' weapon, in px. */
  mark: { x: number; y: number } | null;
  /** Girder angle, 0..7 in 22.5° steps clockwise from flat. */
  girderRot: number;
  using: Using | null;
  /** Id of the projectile fire sets off (a snail); -1 none. */
  remote: number;
  rope: Rope | null;
  ropeShots: number;
  jetFuel: number;
  /** Mine triggers still to draw before the bag is refilled; 1 is a dud. */
  dudBag: number[];
  /** Slugs still to be placed by their teams, the one being placed first; it stands hidden at its automatic seat meanwhile. */
  placing: number[];
  /** While slugs are placed: every place one may start, in a shuffled order for the automatic pick. Empty after. */
  seats: Spot[];
  opts: SlugsOptions;
  events: SlugEvent[];
}

/**
 * Keys held this tick. While on a rope, up and down climb and left and right
 * swing; on a jetpack, up, left and right are the thrusters. Otherwise up and
 * down aim and left and right walk.
 */
export const KEY = { left: 1, right: 2, up: 4, down: 8, fire: 16, fine: 32 } as const;

/**
 * One-off actions. 'jump' leaps forward and also lets go of a rope; 'backjump'
 * leaps back, 'hop' straight up and 'flip' is the high backflip. 'target' picks the point for
 * a 'target' weapon (which sets it off) or marks it for a 'mark' weapon.
 * 'girder' sets the girder's angle, 0..7.
 */
export type Act =
  | { t: 'jump' }
  | { t: 'flip' }
  | { t: 'backjump' }
  | { t: 'hop' }
  | { t: 'weapon'; w: WeaponId }
  | { t: 'fuse'; n: number }
  | { t: 'bounce' }
  | { t: 'target'; x: number; y: number }
  | { t: 'girder'; rot: number }
  | { t: 'skip' }
  | { t: 'surrender' };

export interface Input {
  keys: number;
  act?: Act;
}

export const TEAM_COLORS = ['#e5484d', '#3e8ef7', '#30a46c', '#e9c03a', '#d6409f', '#12a5b8'];

const SLUG_NAMES = [
  'Gloop', 'Ooze', 'Drizzle', 'Sprout', 'Mossy', 'Pebble', 'Slick', 'Dewdrop', 'Squelch', 'Tumble', 'Fern', 'Clover',
  'Puddle', 'Smudge', 'Wobble', 'Truffle', 'Bramble', 'Crumb', 'Sludge', 'Gherkin', 'Velvet', 'Glint', 'Mudlark', 'Nettle',
  'Parsnip', 'Rhubarb', 'Soggy', 'Toadstool', 'Bogey', 'Custard', 'Dribble', 'Lichen', 'Marrow', 'Noodle', 'Pickle', 'Spud',
];

// --- Terrain ---

export const solidAt = (t: Uint8Array, x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && t[y * W + x] !== 0;

function noise1(x: number, cell: number, seed: number): number {
  const i = Math.floor(x / cell);
  const f = x - i * cell;
  const a = hash2(i, 0, seed) & 1023;
  const b = hash2(i + 1, 0, seed) & 1023;
  const s = Math.trunc((f * f * (3 * cell - 2 * f)) / (cell * cell));
  return a + Math.trunc(((b - a) * s) / cell);
}

function noise2(x: number, y: number, cell: number, seed: number): number {
  const ix = Math.floor(x / cell);
  const iy = Math.floor(y / cell);
  const fx = x - ix * cell;
  const fy = y - iy * cell;
  const sx = Math.trunc((fx * fx * (3 * cell - 2 * fx)) / (cell * cell));
  const sy = Math.trunc((fy * fy * (3 * cell - 2 * fy)) / (cell * cell));
  const a = hash2(ix, iy, seed) & 1023;
  const b = hash2(ix + 1, iy, seed) & 1023;
  const c = hash2(ix, iy + 1, seed) & 1023;
  const d = hash2(ix + 1, iy + 1, seed) & 1023;
  const top = a + Math.trunc(((b - a) * sx) / cell);
  const bottom = c + Math.trunc(((d - c) * sx) / cell);
  return top + Math.trunc(((bottom - top) * sy) / cell);
}

const ISLAND_SPANS: readonly (readonly [number, number])[][] = [
  [[120, 1800]],
  [[80, 880], [1040, 1840]],
  [[60, 620], [700, 1220], [1300, 1860]],
];

/** Land from the seed: one, two or three islands with rough edges, overhangs and caves. */
export function buildTerrain(seed: number): Uint8Array {
  const g = { rng: seed >>> 0 };
  const spans = ISLAND_SPANS[randInt(g, ISLAND_SPANS.length)];
  const top = new Int32Array(W);
  for (let x = 0; x < W; x++) {
    const span = spans.find(([a, b]) => x >= a && x <= b);
    if (!span) {
      top[x] = H * 2;
      continue;
    }
    const edge = Math.min(x - span[0], span[1] - x);
    const taper = edge < 140 ? Math.trunc(((140 - edge) * (140 - edge) * 420) / (140 * 140)) : 0;
    top[x] =
      430 -
      Math.trunc((noise1(x, 260, seed) * 230) / 1023) -
      Math.trunc((noise1(x, 90, seed + 1) * 70) / 1023) -
      Math.trunc((noise1(x, 31, seed + 2) * 18) / 1023) +
      90 +
      taper;
  }
  const t = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const rough = Math.trunc((noise2(x, y, 70, seed + 3) * 90) / 1023) + Math.trunc((noise2(x, y, 23, seed + 4) * 26) / 1023) - 58;
      if (y - top[x] + rough > 0) t[y * W + x] = 1;
    }
  }
  const holes = 7 + randInt(g, 7);
  for (let i = 0; i < holes; i++) {
    const [a, b] = spans[randInt(g, spans.length)];
    const cx = a + 60 + randInt(g, Math.max(1, b - a - 120));
    const cy = top[cx] + 50 + randInt(g, Math.max(1, WATER_START - top[cx]));
    const r = 18 + randInt(g, 40);
    carve(t, cx, cy, r);
  }
  const chunks = randInt(g, 4);
  for (let i = 0; i < chunks; i++) {
    const cx = 200 + randInt(g, W - 400);
    const cy = 140 + randInt(g, 160);
    const rx = 30 + randInt(g, 50);
    const ry = 14 + randInt(g, 18);
    for (let y = cy - ry - 20; y <= cy + ry + 20; y++) {
      for (let x = cx - rx - 20; x <= cx + rx + 20; x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const dx = ((x - cx) * 100) / rx;
        const dy = ((y - cy) * 100) / ry;
        const wobble = Math.trunc((noise2(x, y, 14, seed + 5) * 40) / 1023);
        if (dx * dx + dy * dy < (100 + wobble - 20) * (100 + wobble - 20)) t[y * W + x] = 1;
      }
    }
  }
  return smooth(t);
}

/** One pass of a 3x3 majority vote, which rubs off single-pixel spikes and pits. */
function smooth(t: Uint8Array): Uint8Array {
  const out = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += t[(y + dy) * W + x + dx];
      out[y * W + x] = n >= 5 ? 1 : 0;
    }
  }
  return out;
}

/** Terrain value for land nothing can carve: blasts, tools and girders leave it as it is. */
export const STEEL = 3;

function clearSpan(t: Uint8Array, from: number, to: number): void {
  for (let i = from; i < to; i++) if (t[i] !== STEEL) t[i] = 0;
}

export function carve(t: Uint8Array, cx: number, cy: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= H) continue;
    const span = isqrt(r * r - dy * dy);
    const x0 = Math.max(0, cx - span);
    const x1 = Math.min(W - 1, cx + span);
    if (x1 >= x0) clearSpan(t, y * W + x0, y * W + x1 + 1);
  }
}

function carveBox(state: SlugsState, x0: number, y0: number, x1: number, y1: number, live: boolean): void {
  const ax = Math.max(0, x0);
  const bx = Math.min(W - 1, x1);
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) if (bx >= ax) clearSpan(state.terrain, y * W + ax, y * W + bx + 1);
  if (live) state.events.push({ k: 'land', x0, y0, x1, y1 });
}

// --- Bodies against the land ---

function boxFree(t: Uint8Array, x: number, y: number, hw: number, hh: number): boolean {
  for (let dy = -hh; dy < hh; dy++) {
    for (let dx = -hw; dx <= hw; dx++) {
      if (solidAt(t, x + dx, y + dy)) return false;
    }
  }
  return true;
}

export function fits(t: Uint8Array, x: number, y: number): boolean {
  return boxFree(t, x, y, SLUG_HALF_W, SLUG_HALF_H);
}

const grounded = (t: Uint8Array, x: number, y: number) => !fits(t, x, y + 1);

/** Which way the land around a point faces: the sum of the empty directions. Not normalised. */
function normalAt(t: Uint8Array, x: number, y: number): { nx: number; ny: number } {
  let nx = 0;
  let ny = 0;
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      if (dx * dx + dy * dy > 16) continue;
      if (solidAt(t, x + dx, y + dy)) {
        nx -= dx;
        ny -= dy;
      }
    }
  }
  return nx === 0 && ny === 0 ? { nx: 0, ny: -1 } : { nx, ny };
}

/** Bounce a speed off a surface facing (nx, ny): `along` of the part along it kept, `off` of the part into it reversed. */
function reflect(b: { vx: number; vy: number }, nx: number, ny: number, along: number, off: number): number {
  const nn = nx * nx + ny * ny;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0 || nn === 0) return 0;
  const nvx = Math.trunc((vn * nx) / nn);
  const nvy = Math.trunc((vn * ny) / nn);
  const tvx = b.vx - nvx;
  const tvy = b.vy - nvy;
  b.vx = Math.trunc((tvx * along) / ONE) - Math.trunc((nvx * off) / ONE);
  b.vy = Math.trunc((tvy * along) / ONE) - Math.trunc((nvy * off) / ONE);
  return Math.trunc(-vn / isqrt(nn));
}

/** A unit vector (times ONE) from (x0, y0) to (x1, y1) in px; straight up when they are the same point. */
function unitTo(x0: number, y0: number, x1: number, y1: number): { ux: number; uy: number; d: number } {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const d = isqrt(dx * dx + dy * dy);
  if (d === 0) return { ux: 0, uy: -ONE, d: 0 };
  return { ux: Math.trunc((dx * ONE) / d), uy: Math.trunc((dy * ONE) / d), d };
}

// --- Setting up ---

export interface Spot {
  x: number;
  y: number;
}

/** Ground needed either side of a starting slug's foot, so it does not perch on a spike or hang over an edge. Ours. */
const SEAT_HALF = 6;
/**
 * How far that ground may sit below or above the foot: the step a slug walks
 * down without falling, so a slope is fine but an edge it would hang over is not.
 */
const SEAT_DIP = STEP_PX;
/** Clear rock above a starting slug's head, where its name and health are drawn. */
const SEAT_HEADROOM = 24;
/** Names are cut off by the side of the map nearer than this. */
const SEAT_EDGE = 30;
/** A start must have this much ground to walk, both ways together, or it is a pit. */
const SEAT_ESCAPE = 100;
/** Dropping further than this below its start takes a slug out of whatever it stood in. */
const SEAT_DROP = 16;

/**
 * Every place a slug can start above the water, every 6 px across: room for
 * its body, its head and name, ground under its whole width, and off the edge.
 */
function standingSpots(t: Uint8Array, water: number): Spot[] {
  const spots: Spot[] = [];
  const clear = new Uint8Array(H);
  const rock = (x: number, y: number) => y >= 0 && t[y * W + x] !== 0;
  for (let x = SEAT_EDGE; x < W - SEAT_EDGE; x += 6) {
    for (let y = 0; y < H; y++) {
      let free = 1;
      for (let dx = -SLUG_HALF_W; dx <= SLUG_HALF_W && free; dx++) if (t[y * W + x + dx] !== 0) free = 0;
      clear[y] = free;
    }
    let run = 0;
    for (let y = 0; y < water - 24; y++) {
      run = clear[y] ? run + 1 : 0;
      // run covers rows y-run+1..y; a slug centred at c covers c-8..c+7.
      const c = y - SLUG_HALF_H + 1;
      if (run < SLUG_HALF_H * 2 || c < SLUG_HALF_H || clear[y + 1]) continue;
      const foot = y + 1;
      let ok = true;
      // Each column needs rock within a step of the foot and nothing above that, up past the head.
      for (let dx = -SEAT_HALF; dx <= SEAT_HALF && ok; dx++) {
        const cx = x + dx;
        for (let up = c - SLUG_HALF_H - SEAT_HEADROOM; up < foot - SEAT_DIP && ok; up++) ok = !rock(cx, up);
        if (!ok) break;
        ok = false;
        for (let d = -SEAT_DIP; d <= SEAT_DIP && !ok; d++) ok = rock(cx, foot + d);
      }
      if (ok) spots.push({ x, y: c });
    }
  }
  return spots;
}

/**
 * How far a slug centred at (x, y) walks towards `dir`, step by step as
 * stepAlong moves it, up to SEAT_ESCAPE. Dropping off a ledge by more than
 * SEAT_DROP, into the water or off the side counts as all the way. Jumps are
 * left out: they need a run-up a narrow hole does not have, so a start only
 * a jump leaves is a pit.
 */
function walkRoom(t: Uint8Array, x: number, y: number, dir: number, water: number): number {
  const y0 = y;
  for (let k = 1; k <= SEAT_ESCAPE; k++) {
    const nx = x + dir * k;
    if (nx - SLUG_HALF_W < 0 || nx + SLUG_HALF_W >= W) return SEAT_ESCAPE;
    const foot = footAt(t, nx, y, STEP_PX);
    if (!foot || tooSteep(t, nx, y, dir, STEP_PX)) return k - 1;
    y = foot.y;
    if (foot.drop) while (y + SLUG_HALF_H < water && fits(t, nx, y + 1)) y++;
    if (y - y0 > SEAT_DROP || y + SLUG_HALF_H >= water) return SEAT_ESCAPE;
  }
  return SEAT_ESCAPE;
}

/**
 * Where a slug's centre can be, marked 1 if that room joins the open air: the
 * top or a side of the map. A pocket sealed in rock, which no slug could walk,
 * jump or rope out of, stays 0. A land with no opening to the edge at all (one
 * closed cavern) counts its largest room as open instead.
 */
function openRoom(t: Uint8Array, water: number): Uint8Array {
  const sat = new Int32Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += t[y * W + x] !== 0 ? 1 : 0;
      sat[(y + 1) * (W + 1) + x + 1] = sat[y * (W + 1) + x + 1] + row;
    }
  }
  const x0 = SLUG_HALF_W;
  const x1 = W - SLUG_HALF_W - 1;
  const y0 = SLUG_HALF_H;
  const y1 = Math.min(H - SLUG_HALF_H, water - SLUG_HALF_H);
  // 0 rock, 1 room not yet reached, above 1 the room's label.
  const mark = new Int32Array(W * H);
  for (let y = y0; y < y1; y++) {
    const top = (y - SLUG_HALF_H) * (W + 1);
    const bottom = (y + SLUG_HALF_H) * (W + 1);
    for (let x = x0; x <= x1; x++) {
      const a = x - SLUG_HALF_W;
      const b = x + SLUG_HALF_W + 1;
      if (sat[bottom + b] - sat[top + b] - sat[bottom + a] + sat[top + a] === 0) mark[y * W + x] = 1;
    }
  }
  const queue = new Int32Array(W * H);
  const sizes: number[] = [0, 0];
  const edged: boolean[] = [false, false];
  for (let start = 0; start < mark.length; start++) {
    if (mark[start] !== 1) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    let edge = false;
    mark[start] = id;
    queue[tail++] = start;
    while (head < tail) {
      const at = queue[head++];
      const cx = at % W;
      if (cx === x0 || cx === x1 || at < (y0 + 1) * W) edge = true;
      // Room cells never sit on the map's outer columns or rows, so these stay in bounds.
      for (let k = 0; k < 4; k++) {
        const next = at + (k === 0 ? -1 : k === 1 ? 1 : k === 2 ? -W : W);
        if (mark[next] !== 1) continue;
        mark[next] = id;
        queue[tail++] = next;
      }
    }
    sizes.push(tail);
    edged.push(edge);
  }
  let keep = edged;
  if (!keep.includes(true)) {
    const largest = sizes.indexOf(Math.max(...sizes));
    keep = sizes.map((size, i) => i === largest && size > 0);
  }
  const open = new Uint8Array(W * H);
  for (let i = 0; i < mark.length; i++) if (keep[mark[i]]) open[i] = 1;
  return open;
}

/** Standing spots in the room that joins the open air. */
const openSpots = (state: SlugsState) => {
  const open = openRoom(state.terrain, state.water);
  return standingSpots(state.terrain, state.water).filter((s) => open[s.y * W + s.x] === 1);
};

/** Whether a slug at a spot can walk out of it (walkRoom both ways), worked out once a spot, as it is the dear check. */
function roomTest(state: SlugsState): (s: Spot) => boolean {
  const roomy = new Map<Spot, boolean>();
  return (s) => {
    let ok = roomy.get(s);
    if (ok === undefined) {
      ok = walkRoom(state.terrain, s.x, s.y, -1, state.water) + walkRoom(state.terrain, s.x, s.y, 1, state.water) >= SEAT_ESCAPE;
      roomy.set(s, ok);
    }
    return ok;
  };
}

/** Slugs closer than this to an enemy at the start, or this to anyone, are moved. Ours. */
const ENEMY_GAP = 140;
const FRIEND_GAP = 60;

/**
 * Seat the slugs on standing spots in turn order, team by team, at least
 * ENEMY_GAP from any enemy and FRIEND_GAP from a teammate, halving the gaps
 * up to twice. A crowded land (six teams of eight on hills or islets) still
 * runs out of room that way, so the last try sweeps the ground from a random
 * point and seats each team together, which needs about half the ground.
 * False if even that cannot seat them.
 */
export function placeSlugs(state: SlugsState): boolean {
  const spots = openSpots(state);
  const room = roomTest(state);
  if (spots.length === 0) return false;
  // standingSpots runs left to right, so this is the ground in order from a random start.
  const start = randInt(state, spots.length);
  const sweep = [...spots.slice(start), ...spots.slice(0, start)];
  for (let i = spots.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }
  const order: Slug[] = [];
  const most = Math.max(...state.teams.map((team) => team.slugs.length));
  for (let k = 0; k < most; k++) for (const team of state.teams) if (k < team.slugs.length) order.push(state.slugs[team.slugs[k]]);
  const together = state.teams.flatMap((team) => team.slugs.map((i) => state.slugs[i]));
  const tries: [Spot[], Slug[], number][] = [
    [spots, order, 0],
    [spots, order, 1],
    [spots, order, 2],
    [sweep, together, 2],
  ];
  for (const [ground, slugs, relax] of tries) {
    const enemyGap = ENEMY_GAP >> relax;
    const friendGap = FRIEND_GAP >> relax;
    const seated: { slug: Slug; at: Spot }[] = [];
    for (const slug of slugs) {
      const at = ground.find(
        (s) =>
          seated.every(({ slug: o, at: p }) => {
            const gap = o.team === slug.team ? friendGap : enemyGap;
            return (s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y) >= gap * gap;
          }) && room(s)
      );
      if (!at) break;
      seated.push({ slug, at });
    }
    if (seated.length === slugs.length) {
      for (const { slug, at } of seated) {
        slug.x = at.x * ONE;
        slug.y = at.y * ONE;
        slug.facing = at.x < W / 2 ? 1 : -1;
      }
      return true;
    }
  }
  return false;
}

/** A slug placed by a player keeps this far from every slug already placed, so two never stand in one another. Ours. */
const PLACE_APART = 2 * SLUG_HALF_W + 4;

/**
 * Whether the slug being placed may start at `s`: clear of the slugs already
 * placed, off any mine's trigger and not inside a barrel, by placeObjects' own
 * measure of near.
 */
function seatFree(state: SlugsState, s: Spot): boolean {
  const near = (o: Obj) => Math.abs(px(o.x) - s.x) + Math.abs(px(o.y) - s.y);
  if (state.objs.some((o) => near(o) < (o.kind === 'mine' ? MINE_REACH + 30 : 30))) return false;
  const placed = state.slugs.filter((g) => !state.placing.includes(g.id));
  return placed.every((g) => Math.abs(px(g.x) - s.x) >= PLACE_APART || Math.abs(px(g.y) - s.y) >= PLACE_APART);
}

/**
 * Where a click at (x, y) puts the slug being placed: the free seat nearest it,
 * so a click in the sky drops it to the ground below. Null outside placement or
 * when no seat is free. The scene shows the same answer under the pointer.
 */
export function placeSpot(state: SlugsState, x: number, y: number): Spot | null {
  if (state.phase !== 'place') return null;
  let best: Spot | null = null;
  let bestD = Infinity;
  for (const s of state.seats) {
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (d < bestD && seatFree(state, s)) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * The seat picked for a computer team, or for a person who lets the clock run
 * out: the first free one in the shuffled list that keeps placeSlugs' gaps from
 * the slugs already placed, halving them up to twice, then any free one. Null
 * if none is free; the slug then keeps the seat placeSlugs gave it.
 */
function autoSeat(state: SlugsState): Spot | null {
  const slug = state.slugs[state.active];
  const placed = state.slugs.filter((g) => !state.placing.includes(g.id));
  for (let relax = 0; relax <= 2; relax++) {
    const at = state.seats.find(
      (s) =>
        seatFree(state, s) &&
        placed.every((o) => {
          const gap = (o.team === slug.team ? FRIEND_GAP : ENEMY_GAP) >> relax;
          return (s.x - px(o.x)) ** 2 + (s.y - px(o.y)) ** 2 >= gap * gap;
        })
    );
    if (at) return at;
  }
  return state.seats.find((s) => seatFree(state, s)) ?? null;
}

/**
 * Start placement: every seat placeSlugs would trust, shuffled, and the slugs
 * queued in turn order, a slug from each team in turn as the turns will run.
 */
function beginPlacing(state: SlugsState): void {
  const room = roomTest(state);
  const seats = openSpots(state).filter(room);
  for (let i = seats.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  state.seats = seats;
  const most = Math.max(...state.teams.map((team) => team.slugs.length));
  for (let k = 0; k < most; k++) for (const team of state.teams) if (k < team.slugs.length) state.placing.push(team.slugs[k]);
  nextToPlace(state);
}

/** Hand the next slug in the queue to its team to place, or, once all are placed, start the first turn. */
function nextToPlace(state: SlugsState): void {
  if (state.placing.length === 0) {
    state.seats = [];
    beginTurn(state, randInt(state, state.teams.length));
    return;
  }
  state.active = state.placing[0];
  state.activeTeam = state.slugs[state.active].team;
  state.phase = 'place';
  state.phaseT = 0;
  state.timeLeft = state.opts.turnSeconds * 50;
}

/**
 * One tick of placement. A person places with a 'target' act at the point, or
 * 'skip' to take the automatic pick, which the clock running out also takes; a
 * computer takes it after the same pause it starts a turn with.
 */
function placeTick(state: SlugsState, input: Input): void {
  const team = state.teams[state.activeTeam];
  let at: Spot | null | undefined;
  if (isComputer(team)) {
    if (state.phaseT >= CPU_READY_TICKS) at = autoSeat(state);
  } else if (input.act?.t === 'target') {
    at = placeSpot(state, input.act.x, input.act.y);
    // Nowhere free to put it: wait for the clock, whose pick keeps the automatic seat.
    if (!at) return;
  } else if (input.act?.t === 'skip' || --state.timeLeft <= 0) {
    at = autoSeat(state);
  }
  if (at === undefined) return;
  const slug = state.slugs[state.active];
  if (at) {
    slug.x = at.x * ONE;
    slug.y = at.y * ONE;
    slug.facing = at.x < W / 2 ? 1 : -1;
  }
  state.placing.shift();
  nextToPlace(state);
}

/** Scatter mines and barrels on free standing spots well clear of the slugs and of each other. */
function placeObjects(state: SlugsState, mines: number, barrels: number): void {
  const spots = standingSpots(state.terrain, state.water);
  const kinds: ObjKind[] = [...Array<ObjKind>(mines).fill('mine'), ...Array<ObjKind>(barrels).fill('barrel')];
  for (const kind of kinds) {
    for (let tries = 0; tries < 60; tries++) {
      const s = spots[randInt(state, spots.length)];
      const nearSlug = state.slugs.some((g) => Math.abs(px(g.x) - s.x) + Math.abs(px(g.y) - s.y) < MINE_REACH + 30);
      const nearObj = state.objs.some((o) => Math.abs(px(o.x) - s.x) < 30 && Math.abs(px(o.y) - s.y) < 30);
      if (nearSlug || nearObj) continue;
      const half = kind === 'mine' ? MINE_HALF : BARREL_HALF;
      state.objs.push(newObj(state, kind, s.x, s.y + SLUG_HALF_H - half.h, 50 * randInt(state, 4)));
      break;
    }
  }
}

function newObj(state: SlugsState, kind: ObjKind, x: number, y: number, delay: number): Obj {
  return {
    id: state.nextId++, kind, x: x * ONE, y: y * ONE, vx: 0, vy: 0, rest: false, fuse: -1, delay, dud: false, arm: 0,
    hp: kind === 'barrel' ? BARREL_HP : 0,
  };
}

/** Stock a team for the weapon set: weapons outside it start at 0. */
function startAmmo(set: SlugsOptions['weapons']): Record<WeaponId, number> {
  return Object.fromEntries(WEAPONS.map((w) => [w, set === 'all' || WEAPON[w].classic ? WEAPON[w].ammo : 0])) as Record<WeaponId, number>;
}

export function newGame(seed: number, setups: TeamSetup[], perTeam: number, options: Partial<SlugsOptions> = {}): SlugsState {
  const opts: SlugsOptions = { ...DEFAULT_OPTIONS, ...options };
  const state: SlugsState = {
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    tick: 0,
    terrain: buildMap(opts.map, seed),
    water: WATER_START,
    wind: 0,
    teams: [],
    slugs: [],
    projs: [],
    objs: [],
    nextId: 1,
    phase: 'ready',
    phaseT: 0,
    timeLeft: opts.turnSeconds * 50,
    roundT: 0,
    sudden: false,
    activeTeam: 0,
    active: 0,
    weapon: 'bazooka',
    fuse: 3,
    bounceHigh: false,
    charging: false,
    power: 0,
    shotsLeft: SHOTGUN_SHOTS,
    held: 0,
    quiet: 0,
    winner: null,
    plan: null,
    mark: null,
    girderRot: 0,
    using: null,
    remote: -1,
    rope: null,
    ropeShots: ROPE_SHOTS,
    jetFuel: 0,
    dudBag: [],
    placing: [],
    seats: [],
    opts,
    events: [],
  };
  const names = [...SLUG_NAMES];
  for (let i = names.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [names[i], names[j]] = [names[j], names[i]];
  }
  setups.forEach((setup, ti) => {
    const team: Team = {
      name: setup.name,
      color: ti % TEAM_COLORS.length,
      control: setup.control,
      slugs: [],
      last: -1,
      out: false,
      ammo: startAmmo(opts.weapons),
      weapon: 'bazooka',
      fuse: 3,
      bounceHigh: false,
    };
    for (let k = 0; k < perTeam; k++) {
      const id = state.slugs.length;
      team.slugs.push(id);
      state.slugs.push({
        id, team: ti, name: names[id % names.length], x: 0, y: 0, vx: 0, vy: 0, mode: 'stand', blown: false,
        facing: 1, aim: 0, hp: opts.startHp, shown: opts.startHp, alive: true, drowned: false, walk: 0, still: 0,
      });
    }
    state.teams.push(team);
  });
  // A land too broken to seat everyone is swapped for the next seed's.
  for (let land = 1; !placeSlugs(state); land++) state.terrain = buildMap(opts.map, (seed + land * 7919) >>> 0);
  placeObjects(state, opts.mines, opts.barrels);
  // Placement still seats everyone first: it proves the land has room, and is where a slug no seat is free for stays.
  if (opts.placing === 'players') {
    beginPlacing(state);
    return state;
  }
  state.activeTeam = randInt(state, state.teams.length);
  beginTurn(state, state.activeTeam);
  return state;
}

/** A copy that shares nothing with the original, so one can run on while the other is kept. */
export function cloneState(s: SlugsState): SlugsState {
  return {
    ...s,
    terrain: s.terrain.slice(),
    teams: s.teams.map((team) => ({ ...team, slugs: team.slugs.slice(), ammo: { ...team.ammo } })),
    slugs: s.slugs.map((slug) => ({ ...slug })),
    projs: s.projs.map((p) => ({ ...p })),
    objs: s.objs.map((o) => ({ ...o })),
    plan: s.plan && { ...s.plan },
    mark: s.mark && { ...s.mark },
    using: s.using && { ...s.using, hit: s.using.hit.slice() },
    rope: s.rope && { ...s.rope, pts: s.rope.pts.map((q) => ({ ...q })) },
    dudBag: s.dudBag.slice(),
    placing: s.placing.slice(),
    // Spots are never changed, only the list replaced, so copies share them.
    seats: s.seats.slice(),
    opts: { ...s.opts },
    events: s.events.slice(),
  };
}

// --- Turns ---

/**
 * A wind step from -WIND_MOST to WIND_MOST, the sum of two rolls so light wind is common and
 * strong wind rare: 8 or more either way on about 1 turn in 10, where an even roll gave 2 in 7
 * and left the bazooka a lottery. Ours: the source leaves its distribution unstated.
 */
const windRoll = (state: SlugsState) => randInt(state, WIND_MOST + 1) + randInt(state, WIND_MOST + 1) - WIND_MOST;

function rollWind(state: SlugsState): void {
  const slug = state.slugs[state.active];
  let wind = windRoll(state);
  // Leans toward the middle of the map from where the slug stands (ours: the source gives the lean, not its size).
  if (randInt(state, 100) < 15) wind += px(slug.x) < W / 2 ? 2 : -2;
  if (wind === state.wind) wind = windRoll(state);
  state.wind = Math.max(-WIND_MOST, Math.min(WIND_MOST, wind));
}

/** Sideways push of the wind this tick on something the wind carries. */
const windPush = (state: SlugsState) => Math.trunc((state.wind * WIND_STEP * state.opts.windScale) / 100);

function nextLiving(state: SlugsState, team: Team): number {
  for (let k = 1; k <= team.slugs.length; k++) {
    const i = (team.last + k) % team.slugs.length;
    if (state.slugs[team.slugs[i]].alive) {
      team.last = i;
      return team.slugs[i];
    }
  }
  return -1;
}

function beginTurn(state: SlugsState, teamIndex: number): void {
  state.activeTeam = teamIndex;
  state.active = nextLiving(state, state.teams[teamIndex]);
  rollWind(state);
  state.phase = 'ready';
  state.phaseT = 0;
  state.timeLeft = state.opts.turnSeconds * 50;
  state.charging = false;
  state.power = 0;
  state.shotsLeft = SHOTGUN_SHOTS;
  state.plan = null;
  state.mark = null;
  state.ropeShots = ROPE_SHOTS;
  const team = state.teams[teamIndex];
  state.weapon = team.ammo[team.weapon] === 0 ? 'bazooka' : team.weapon;
  state.fuse = team.fuse;
  state.bounceHigh = team.bounceHigh;
  state.events.push({ k: 'turn', id: state.active });
}

function endTurn(state: SlugsState): void {
  if (state.phase !== 'turn' && state.phase !== 'retreat' && state.phase !== 'ready') return;
  state.phase = 'settle';
  state.phaseT = 0;
  state.quiet = 0;
  state.charging = false;
  state.power = 0;
  state.using = null;
  const slug = state.slugs[state.active];
  if (slug.mode === 'rope') letGo(state, slug);
  if (slug.mode === 'jet') {
    slug.mode = 'air';
    slug.thrust = 0;
    state.events.push({ k: 'jet', id: slug.id, on: false });
  }
}

const teamAlive = (state: SlugsState, team: Team) => !team.out && team.slugs.some((id) => state.slugs[id].alive);

function finishTurn(state: SlugsState): void {
  state.teams.forEach((team) => {
    if (!teamAlive(state, team)) team.out = true;
  });
  const living = state.teams.map((team, i) => (team.out ? -1 : i)).filter((i) => i >= 0);
  if (living.length <= 1) {
    state.phase = 'over';
    state.phaseT = 0;
    state.winner = living.length === 1 ? living[0] : null;
    return;
  }
  if (!state.sudden && state.roundT >= state.opts.roundMinutes * 3000) {
    state.sudden = true;
    state.slugs.forEach((slug) => {
      if (slug.alive) slug.hp = slug.shown = 1;
    });
    state.events.push({ k: 'sudden' });
  } else if (state.sudden) {
    state.water -= state.opts.waterRise;
    state.events.push({ k: 'rise' });
  }
  let next = state.activeTeam;
  for (let k = 0; k < state.teams.length; k++) {
    next = (next + 1) % state.teams.length;
    if (!state.teams[next].out) break;
  }
  beginTurn(state, next);
}

// --- Damage ---

function hurt(state: SlugsState, slug: Slug, dmg: number): void {
  if (!slug.alive || dmg <= 0) return;
  slug.hp -= dmg;
  state.events.push({ k: 'hurt', id: slug.id, dmg });
  if (slug.id === state.active) endTurn(state);
}

function drown(state: SlugsState, slug: Slug): void {
  slug.alive = false;
  slug.drowned = true;
  slug.hp = 0;
  slug.mode = 'stand';
  slug.vx = slug.vy = 0;
  state.events.push({ k: 'drown', id: slug.id }, { k: 'splash', x: px(slug.x), big: true });
  if (slug.id === state.active) {
    state.rope = null;
    endTurn(state);
  }
}

/** Distance in px from a point to the nearest point of a slug's body. */
/** From (x, y) to the nearest point of a box centred at (bx, by), in px. */
function distToBox(bx: number, by: number, halfW: number, halfH: number, x: number, y: number): number {
  const dx = Math.max(0, Math.abs(x - bx) - halfW);
  const dy = Math.max(0, Math.abs(y - by) - halfH);
  return isqrt(dx * dx + dy * dy);
}

const distToSlug = (slug: Slug, x: number, y: number) => distToBox(px(slug.x), px(slug.y), SLUG_HALF_W, SLUG_HALF_H, x, y);

/**
 * Damage falls off in a straight line from full at the centre to none at the
 * crater's edge. The source does not give the curve; linear is ours.
 */
export function blastDamage(damage: number, crater: number, dist: number): number {
  if (dist >= crater) return 0;
  return Math.ceil((damage * (crater - dist)) / crater);
}

/** Throw a slug off its feet: the speed is added, and if `blown` it cannot steer and skids on landing. */
function knock(slug: Slug, vx: number, vy: number, blown: boolean): void {
  slug.vx += vx;
  slug.vy += vy;
  if (slug.mode !== 'rope' && slug.mode !== 'jet') slug.mode = 'air';
  slug.blown = blown;
  slug.still = 0;
}

export function explode(state: SlugsState, x: number, y: number, damage: number, crater: number, bias: number, src?: BoomSource): void {
  carve(state.terrain, x, y, crater);
  state.events.push({ k: 'boom', x, y, r: crater, ...(src && { src }) });
  const kx = x;
  const ky = y + Math.trunc((crater * bias) / 100);
  const reach = Math.trunc((crater * SHOVE_PCT) / 100);
  // The push the damage gives, but never less than a shove that is an eighth of the full push at the
  // crater's edge and fades to none at `reach`: for a standard blast that is about 0.9 px/frame at
  // the rim, which skids a slug some 15 px. Nearer than about 0.8 of the crater the damage's push is larger.
  const atLeast = (dist: number) => (dist >= reach ? 0 : Math.trunc(((reach - dist) * damage * KNOCK_PER_HP) / (8 * (reach - crater))));
  for (const slug of state.slugs) {
    if (!slug.alive) continue;
    const dist = distToSlug(slug, x, y);
    const dmg = blastDamage(damage, crater, dist);
    const push = Math.min(SPEED_CAP, Math.max(dmg * KNOCK_PER_HP, atLeast(dist)));
    if (push <= 0) continue;
    // A blast throws a slug standing on land off it, never into it: for that slug the push is
    // measured from no higher than its feet, so a shot level with its body still lifts it out of
    // the crater rather than skimming it into the far wall and back towards the shooter.
    const footed = slug.mode === 'stand' || slug.mode === 'slide';
    const u = unitTo(kx, footed ? Math.max(ky, px(slug.y) + SLUG_HALF_H) : ky, px(slug.x), px(slug.y));
    knock(slug, Math.trunc((u.ux * push) / ONE), Math.trunc((u.uy * push) / ONE), true);
    hurt(state, slug, dmg);
  }
  const pushBody = (b: { x: number; y: number; vx: number; vy: number; rest: boolean }) => {
    const u = unitTo(kx, ky, px(b.x), px(b.y));
    const inner = u.d >= crater ? 0 : Math.trunc(((crater - u.d) * damage * KNOCK_PER_HP) / crater);
    const push = Math.max(inner, atLeast(u.d));
    if (push <= 0) return u.d;
    b.vx += Math.trunc((u.ux * push) / ONE);
    b.vy += Math.trunc((u.uy * push) / ONE);
    b.rest = false;
    return u.d;
  };
  for (const p of state.projs) if (p.fuse >= 0) pushBody(p);
  for (const o of state.objs) {
    // Shoved out to `reach`, but only the crater itself hurts a barrel or trips a mine.
    // A barrel is hurt as a slug is, by the blast's distance to its body, so a shot that hits it does full damage.
    if (pushBody(o) >= crater) continue;
    if (o.kind === 'barrel') o.hp -= blastDamage(damage, crater, distToBox(px(o.x), px(o.y), BARREL_HALF.w, BARREL_HALF.h, x, y));
    else if (!o.dud && o.fuse < 0) {
      // A blast trips a mine whether or not it has armed, and it goes off as a slug would set it off.
      o.fuse = Math.max(1, o.delay);
      state.events.push({ k: 'mine', id: o.id, fuse: o.fuse });
    }
  }
}

// --- Projectiles ---

const projHitsLand = (t: Uint8Array, x: number, y: number) =>
  solidAt(t, x, y) || solidAt(t, x - 2, y) || solidAt(t, x + 2, y) || solidAt(t, x, y - 2) || solidAt(t, x, y + 2);

function slugHitBy(state: SlugsState, p: Proj, x: number, y: number): Slug | undefined {
  return state.slugs.find(
    (s) => s.alive && (p.free || s.id !== p.owner) && Math.abs(px(s.x) - x) <= SLUG_HALF_W + 2 && Math.abs(px(s.y) - y) <= SLUG_HALF_H + 2
  );
}

const barrelAt = (state: SlugsState, x: number, y: number) =>
  state.objs.find((o) => o.kind === 'barrel' && Math.abs(px(o.x) - x) <= BARREL_HALF.w && Math.abs(px(o.y) - y) <= BARREL_HALF.h);

export type ProjFate = 'flying' | 'boom' | 'gone';

/**
 * One tick of one projectile. Used both by the game and by the computer
 * looking ahead, so `live` says whether it may touch the state's events and land.
 */
export function stepProj(state: SlugsState, p: Proj, live: boolean): ProjFate {
  const t = state.terrain;
  p.age++;
  if (p.life >= 0 && p.age >= p.life) return 'boom';
  if (p.fuse > 0) {
    // The jar's fuse burns down to its last tick, then waits for it to stop rolling.
    if (!(p.kind === 'jar' && p.fuse === 1 && !p.rest)) p.fuse--;
    if (p.fuse === 0) return 'boom';
  }
  if (p.kind === 'snail') return stepSnail(state, p, live);
  if (p.kind === 'stone') return stepStone(state, p, live);
  if (p.kind === 'borer' && p.dig > 0) return stepBorer(state, p, live);
  if (p.rest) {
    if (projHitsLand(t, px(p.x), px(p.y) + 1)) return 'flying';
    p.rest = false;
  }
  const homing = p.kind === 'homing' && p.age >= HOMING_LOCK && p.age < HOMING_END;
  if (homing) {
    const u = unitTo(px(p.x), px(p.y), p.tx, p.ty);
    p.vx += Math.trunc((Math.trunc((u.ux * (HOMING_SPEED / ONE))) - p.vx) / HOMING_TURN);
    p.vy += Math.trunc((Math.trunc((u.uy * (HOMING_SPEED / ONE))) - p.vy) / HOMING_TURN);
  } else {
    p.vy += GRAVITY;
    if (p.wind && !(p.kind === 'homing' && p.age >= HOMING_LOCK)) p.vx += windPush(state);
  }
  p.vx = Math.max(-SPEED_CAP, Math.min(SPEED_CAP, p.vx));
  p.vy = Math.max(-SPEED_CAP, Math.min(SPEED_CAP, p.vy));
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy)) / ONE));
  const x0 = p.x;
  const y0 = p.y;
  for (let i = 1; i <= steps; i++) {
    const nx = x0 + Math.trunc((p.vx * i) / steps);
    const ny = y0 + Math.trunc((p.vy * i) / steps);
    const ix = px(nx);
    const iy = px(ny);
    if (iy > state.water) {
      if (live) state.events.push({ k: 'splash', x: ix, big: false });
      return 'gone';
    }
    if (ix < -600 || ix > W + 600) return 'gone';
    const owner = state.slugs[p.owner];
    if (!p.free && owner && !(Math.abs(px(owner.x) - ix) <= SLUG_HALF_W + 2 && Math.abs(px(owner.y) - iy) <= SLUG_HALF_H + 2)) p.free = true;
    const target = slugHitBy(state, p, ix, iy);
    const land = projHitsLand(t, ix, iy);
    const barrel = p.fuse < 0 && !target && !land ? barrelAt(state, ix, iy) : undefined;
    if (!land && !target && !barrel) {
      p.x = nx;
      p.y = ny;
      continue;
    }
    if (p.kind === 'borer' && land && !target) {
      p.x = nx;
      p.y = ny;
      const u = unitTo(0, 0, Math.trunc(p.vx / 256), Math.trunc(p.vy / 256));
      p.vx = Math.trunc((u.ux * BORER_SPEED) / ONE);
      p.vy = Math.trunc((u.uy * BORER_SPEED) / ONE);
      p.dig = BORER_TICKS;
      return 'flying';
    }
    if (p.fuse < 0) {
      p.x = nx;
      p.y = ny;
      return 'boom';
    }
    // Something with a fuse bounces off what it met, from where it was.
    const n = target ? { nx: px(p.x) - px(target.x), ny: px(p.y) - px(target.y) } : normalAt(t, px(p.x), px(p.y));
    let hit = reflect(p, n.nx, n.ny, BOUNCE_ALONG, p.bounce);
    if (hit === 0) {
      // The normal points along the motion (a narrow pit): bounce off whichever way is blocked.
      hit = Math.abs(p.vx) + Math.abs(p.vy);
      if (projHitsLand(t, px(p.x), iy)) {
        p.vy = -Math.trunc((p.vy * p.bounce) / ONE);
        p.vx = Math.trunc((p.vx * BOUNCE_ALONG) / ONE);
      } else {
        p.vx = -Math.trunc((p.vx * p.bounce) / ONE);
      }
    }
    if (live && hit > ONE) state.events.push({ k: 'bounce', x: px(p.x), y: px(p.y) });
    // Wedged in a notch, the bounce keeps most of its speed along the land but still points into it,
    // so it cannot take a step: by speed alone it would never come to rest, and a jar never go off.
    const fall = p.vy + GRAVITY;
    const next = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(fall)) / ONE));
    const pinned = projHitsLand(t, px(p.x + Math.trunc(p.vx / next)), px(p.y + Math.trunc(fall / next)));
    if ((pinned || (Math.abs(p.vx) < REST_SPEED && Math.abs(p.vy) < REST_SPEED)) && projHitsLand(t, px(p.x), px(p.y) + 3)) {
      p.vx = p.vy = 0;
      p.rest = true;
    }
    return 'flying';
  }
  // Skimming along the ground without touching it would otherwise roll for ever.
  if (p.fuse >= 0 && projHitsLand(t, px(p.x), px(p.y) + 3)) p.vx = Math.trunc((p.vx * FRICTION) / ONE);
  return 'flying';
}

/** A borer inside the land: straight on, no gravity, cutting a hole, until its tunnel runs out or it meets a slug. */
function stepBorer(state: SlugsState, p: Proj, live: boolean): ProjFate {
  p.dig--;
  p.x += p.vx;
  p.y += p.vy;
  const ix = px(p.x);
  const iy = px(p.y);
  if (iy > state.water) {
    if (live) state.events.push({ k: 'splash', x: ix, big: false });
    return 'gone';
  }
  if (p.dig <= 0 || slugHitBy(state, p, ix, iy)) return 'boom';
  if (live) {
    carve(state.terrain, ix, iy, BORER_HOLE);
    state.events.push({ k: 'land', x0: ix - BORER_HOLE, y0: iy - BORER_HOLE, x1: ix + BORER_HOLE, y1: iy + BORER_HOLE });
  }
  return 'flying';
}

/** The millstone falls through everything, bursting wherever it is in land or on a slug. */
function stepStone(state: SlugsState, p: Proj, live: boolean): ProjFate {
  p.vy = Math.min(STONE_FALL, p.vy + GRAVITY);
  p.y += p.vy;
  const ix = px(p.x);
  const iy = px(p.y);
  if (iy > state.water) {
    if (live) state.events.push({ k: 'splash', x: ix, big: true });
    return 'gone';
  }
  if (p.dig > 0) p.dig--;
  if (live && p.dig === 0 && (projHitsLand(state.terrain, ix, iy + 6) || slugHitBy(state, p, ix, iy))) {
    explode(state, ix, iy, p.damage, p.crater, p.bias, p.kind);
    p.dig = STONE_GAP;
  }
  return 'flying';
}

/** The snail crawls along the land, climbs small steps, hops at walls and turns after SNAIL_HOPS hops. */
function stepSnail(state: SlugsState, p: Proj, live: boolean): ProjFate {
  const t = state.terrain;
  const free = (x: number, y: number) => boxFree(t, x, y, SNAIL_HALF, SNAIL_HALF);
  const ix = px(p.x);
  const iy = px(p.y);
  if (iy > state.water) {
    if (live) state.events.push({ k: 'splash', x: ix, big: false });
    return 'gone';
  }
  if (!p.rest) {
    p.vy = Math.min(SPEED_CAP, p.vy + GRAVITY);
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy)) / ONE));
    for (let i = 0; i < steps; i++) {
      const nx = p.x + Math.trunc(p.vx / steps);
      const ny = p.y + Math.trunc(p.vy / steps);
      if (free(px(nx), px(ny))) {
        p.x = nx;
        p.y = ny;
      } else if (free(px(p.x), px(ny))) {
        p.y = ny;
        p.vx = 0;
      } else {
        if (p.vy > 0) {
          p.rest = true;
          p.vx = p.vy = 0;
          p.y = px(p.y) * ONE;
        } else {
          p.vy = 0;
        }
        break;
      }
    }
    return 'flying';
  }
  if (free(ix, iy + 1)) {
    p.rest = false;
    return 'flying';
  }
  const before = px(p.x);
  p.x += p.dir * SNAIL_SPEED;
  for (let x = before + p.dir; p.dir > 0 ? x <= px(p.x) : x >= px(p.x); x += p.dir) {
    let up = 0;
    while (up <= STEP_PX && !free(x, iy - up)) up++;
    if (up > STEP_PX) {
      p.x = (x - p.dir) * ONE;
      p.hops++;
      if (p.hops > SNAIL_HOPS) {
        p.dir = p.dir > 0 ? -1 : 1;
        p.hops = 0;
      } else {
        p.vx = p.dir * Math.trunc(1.5 * ONE);
        p.vy = -Math.trunc(4.5 * ONE);
        p.rest = false;
      }
      return 'flying';
    }
    let y = iy - up;
    let down = 0;
    while (down <= STEP_PX && free(x, y + 1)) {
      y++;
      down++;
    }
    p.y = y * ONE;
    if (down > STEP_PX) {
      p.x = x * ONE;
      p.vx = p.dir * SNAIL_SPEED;
      p.vy = 0;
      p.rest = false;
      return 'flying';
    }
  }
  if (px(p.x) !== before) p.hops = 0;
  return 'flying';
}

function goOff(state: SlugsState, p: Proj): void {
  const x = px(p.x);
  const y = px(p.y);
  explode(state, x, y, p.damage, p.crater, p.bias, p.kind);
  const spray = (n: number, kind: ProjKind, o: { fuse: number; damage: number; crater: number; bias: number; bounce: number; life: number }) => {
    for (let i = 0; i < n; i++) {
      const vx = (randInt(state, 9) - 4) * Math.trunc(ONE * 0.9);
      const vy = -(3 * ONE + randInt(state, 3 * ONE));
      state.projs.push(newProj(state.nextId++, kind, x, y - 4, vx, vy, p.owner, o));
    }
  };
  if (p.kind === 'cluster') spray(CLUSTER_BITS, 'bit', { fuse: -1, ...CLUSTER_BIT, bias: 10, bounce: 0, life: BIT_LIFE });
  if (p.kind === 'mortar') spray(MORTAR_BITS, 'bit', { fuse: -1, ...MORTAR_BIT, bias: 10, bounce: 0, life: BIT_LIFE });
  if (p.kind === 'pod') {
    for (let i = 0; i < POD_SEEDS; i++) {
      const vx = (randInt(state, 11) - 5) * Math.trunc(ONE * 0.8);
      const vy = -(4 * ONE + randInt(state, 3 * ONE));
      state.projs.push(newProj(state.nextId++, 'seed', x, y - 4, vx, vy, p.owner, {
        fuse: 50 + randInt(state, 51), damage: WEAPON.seedpod.damage, crater: WEAPON.seedpod.crater, bias: WEAPON.seedpod.bias, bounce: BOUNCE_HIGH, life: -1,
      }));
    }
  }
}

function newProj(
  id: number, kind: ProjKind, x: number, y: number, vx: number, vy: number, owner: number,
  o: { fuse: number; damage: number; crater: number; bias: number; wind?: boolean; bounce?: number; life?: number }
): Proj {
  return {
    id, kind, x: x * ONE, y: y * ONE, vx, vy, owner, free: kind === 'bit' || kind === 'missile' || kind === 'seed' || kind === 'stone',
    fuse: o.fuse, damage: o.damage, crater: o.crater, bias: o.bias, wind: o.wind ?? false, bounce: o.bounce ?? 0, rest: false,
    age: 0, life: o.life ?? -1, tx: 0, ty: 0, dir: 1, dig: 0, hops: 0,
  };
}

const LAUNCHED: Partial<Record<WeaponId, ProjKind>> = {
  bazooka: 'shell', homing: 'homing', mortar: 'mortar', grenade: 'grenade', cluster: 'cluster', seedpod: 'pod', jar: 'jar', borer: 'borer',
};

/** The projectile a charged or aimed weapon leaves the slug as. */
function launch(
  id: number, w: WeaponId, slug: Slug, facing: 1 | -1, aim: number, power: number, fuse: number, high: boolean, mark: { x: number; y: number } | null
): Proj {
  const spec = WEAPON[w];
  const speed = spec.use === 'shot' ? FULL_SPEED : Math.trunc((FULL_SPEED * Math.max(1, power)) / CHARGE_TICKS);
  const { vx, vy } = aimVector(facing, aim, speed);
  const ax = px(slug.x) + Math.trunc((facing * cosDeg(aim) * 8) / ONE);
  const ay = px(slug.y) - 2 - Math.trunc((sinDeg(aim) * 8) / ONE);
  const kind = LAUNCHED[w] as ProjKind;
  const p = newProj(id, kind, ax, ay, vx, vy, slug.id, {
    fuse: w === 'jar' ? JAR_FUSE : spec.fuse ? fuse * 50 : -1,
    damage: spec.damage,
    crater: spec.crater,
    bias: spec.bias,
    wind: spec.wind,
    bounce: w === 'seedpod' ? BOUNCE_HIGH : w === 'jar' ? BOUNCE_LOW : high ? BOUNCE_HIGH : BOUNCE_LOW,
    life: w === 'homing' ? HOMING_LIFE : -1,
  });
  if (mark) {
    p.tx = mark.x;
    p.ty = mark.y;
  }
  return p;
}

// --- Objects ---

function stepObj(state: SlugsState, o: Obj): boolean {
  const t = state.terrain;
  // Water risen over something lying still takes it, as it would if it fell in.
  if (px(o.y) > state.water) {
    state.events.push({ k: 'splash', x: px(o.x), big: false });
    return false;
  }
  if (o.kind === 'barrel' && o.hp <= 0) {
    explode(state, px(o.x), px(o.y), BARREL_BLAST.damage, BARREL_BLAST.crater, BARREL_BLAST.bias, 'barrel');
    return false;
  }
  if (o.kind === 'mine' && !o.dud) {
    if (o.fuse > 0) {
      o.fuse--;
      if (o.fuse === 0) {
        if (state.dudBag.length === 0) {
          state.dudBag = Array.from({ length: DUD_BAG }, (_, i) => (i === 0 ? 1 : 0));
          for (let i = DUD_BAG - 1; i > 0; i--) {
            const j = randInt(state, i + 1);
            [state.dudBag[i], state.dudBag[j]] = [state.dudBag[j], state.dudBag[i]];
          }
        }
        if (state.dudBag.pop() === 1) {
          o.dud = true;
          o.fuse = -1;
          state.events.push({ k: 'dud', x: px(o.x), y: px(o.y) });
        } else {
          explode(state, px(o.x), px(o.y), WEAPON.mine.damage, WEAPON.mine.crater, WEAPON.mine.bias, 'mine');
          return false;
        }
      }
    } else if (o.arm > 0) {
      o.arm--;
    } else if (o.fuse < 0) {
      const near = state.slugs.some((s) => s.alive && Math.abs(px(s.x) - px(o.x)) + Math.abs(px(s.y) - px(o.y)) <= MINE_REACH);
      if (near) {
        o.fuse = Math.max(1, o.delay);
        state.events.push({ k: 'mine', id: o.id, fuse: o.fuse });
      }
    }
  }
  const half = o.kind === 'mine' ? MINE_HALF : BARREL_HALF;
  const free = (x: number, y: number) => boxFree(t, x, y, half.w, half.h);
  if (o.rest) {
    if (!free(px(o.x), px(o.y) + 1)) return true;
    o.rest = false;
  }
  o.vy = Math.min(SPEED_CAP, o.vy + GRAVITY);
  o.vx = Math.max(-SPEED_CAP, Math.min(SPEED_CAP, o.vx));
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(o.vx), Math.abs(o.vy)) / ONE));
  const x0 = o.x;
  const y0 = o.y;
  for (let i = 1; i <= steps; i++) {
    const nx = x0 + Math.trunc((o.vx * i) / steps);
    const ny = y0 + Math.trunc((o.vy * i) / steps);
    if (px(ny) > state.water) {
      state.events.push({ k: 'splash', x: px(nx), big: false });
      return false;
    }
    if (px(nx) < -40 || px(nx) > W + 40) return false;
    if (free(px(nx), px(ny))) {
      o.x = nx;
      o.y = ny;
      continue;
    }
    // Bounce off whichever way is blocked. A surface normal can point along the
    // motion in a narrow pit, and bouncing off that would leave it stuck falling.
    const off = o.kind === 'mine' ? BOUNCE_HIGH : BOUNCE_LOW;
    if (free(px(o.x), px(ny))) {
      o.vx = -Math.trunc((o.vx * off) / ONE);
    } else {
      o.vy = -Math.trunc((o.vy * off) / ONE);
      o.vx = Math.trunc((o.vx * BOUNCE_ALONG) / ONE);
    }
    if (Math.abs(o.vx) < REST_SPEED && Math.abs(o.vy) < REST_SPEED && !free(px(o.x), px(o.y) + 1)) {
      o.vx = o.vy = 0;
      o.rest = true;
    }
    return true;
  }
  return true;
}

// --- Slugs moving ---

/**
 * Move a slug through the air by its speed, a pixel at a time. A wall or roof
 * takes most of the speed into it; land under it while it is coming down is a
 * landing. Returns the downward speed it landed with, or -1 if it did not land.
 */
function moveSlug(state: SlugsState, slug: Slug): number {
  const t = state.terrain;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(slug.vx), Math.abs(slug.vy)) / ONE));
  for (let i = 0; i < steps; i++) {
    const nx = slug.x + Math.trunc(slug.vx / steps);
    const ny = slug.y + Math.trunc(slug.vy / steps);
    if (fits(t, px(nx), px(ny))) {
      slug.x = nx;
      slug.y = ny;
      continue;
    }
    const upright = fits(t, px(slug.x), px(ny));
    const level = fits(t, px(nx), px(slug.y));
    // A slug that jumped or stepped off is not thrown: it climbs onto a lip it clips, as a walk
    // climbs a step, and meeting a wall it slides up it rather than being flung back off it.
    const leapt = slug.mode === 'air' && !slug.blown;
    if (leapt && nx !== slug.x && (upright || !level)) {
      let lip = 1;
      while (lip <= STEP_PX && !fits(t, px(nx), px(ny) - lip)) lip++;
      if (lip <= STEP_PX) {
        slug.x = nx;
        slug.y = ny - lip * ONE;
        continue;
      }
    }
    if (upright) {
      slug.y = ny;
      slug.vx = leapt ? 0 : -Math.trunc((slug.vx * WALL_KEEP) / ONE);
      continue;
    }
    if (slug.vy > 0) {
      const impact = slug.vy;
      if (level) slug.x = nx;
      slug.vy = 0;
      settleDown(state, slug);
      return impact;
    }
    if (level) {
      slug.x = nx;
      slug.vy = -Math.trunc((slug.vy * WALL_KEEP) / ONE);
      continue;
    }
    slug.vx = -Math.trunc((slug.vx * WALL_KEEP) / ONE);
    slug.vy = 0;
    break;
  }
  return -1;
}

export function fallDamage(impact: number): number {
  if (impact <= FALL_SAFE) return 0;
  return Math.trunc(((impact - FALL_SAFE + 1) * FALL_COEF + 18 * ONE) / (18 * ONE));
}

function land(state: SlugsState, slug: Slug, impact: number): void {
  // A thrown slug's landing hurts too, as with the source's v3.8 option: without it a blast that
  // flings a slug across the map costs no more than one that nudges it.
  if (impact > FALL_SAFE) {
    const dmg = fallDamage(impact);
    state.events.push({ k: 'fall', id: slug.id, dmg });
    hurt(state, slug, dmg);
  }
  // Only a slug thrown by a blast or a blow skids on landing; a jump or a drop stops where it lands.
  const thrown = slug.blown;
  slug.blown = false;
  // The slide's own stopping speed, so a slow throw skids a few px rather than stopping dead.
  if (thrown && Math.abs(slug.vx) >= ONE / 2) {
    slug.mode = 'slide';
  } else {
    slug.vx = 0;
    slug.mode = 'stand';
  }
}

function stepSlug(state: SlugsState, slug: Slug): void {
  const t = state.terrain;
  if (!slug.alive) return;
  slug.still++;
  if (px(slug.y) + SLUG_HALF_H > state.water) {
    drown(state, slug);
    return;
  }
  if (state.using && slug.id === state.active && (state.using.w === 'blowtorch' || state.using.w === 'drill')) return;
  switch (slug.mode) {
    case 'stand':
      if (!grounded(t, px(slug.x), px(slug.y))) {
        slug.mode = 'air';
        slug.vx = 0;
        slug.vy = 0;
      }
      return;
    case 'slide': {
      slug.vx = Math.trunc((slug.vx * FRICTION) / ONE);
      if (Math.abs(slug.vx) < ONE / 2) {
        slug.vx = 0;
        slug.mode = 'stand';
        return;
      }
      slug.still = 0;
      const dir = slug.vx > 0 ? 1 : -1;
      const moves = Math.max(1, Math.ceil(Math.abs(slug.vx) / ONE));
      for (let i = 0; i < moves; i++) {
        if (!stepAlong(state, slug, dir, 1, true)) {
          slug.vx = 0;
          slug.mode = 'stand';
          return;
        }
        if (slug.mode !== 'slide') return;
      }
      return;
    }
    case 'air': {
      slug.still = 0;
      slug.vy = Math.min(SPEED_CAP, slug.vy + GRAVITY);
      slug.vx = Math.max(-SPEED_CAP, Math.min(SPEED_CAP, slug.vx));
      const impact = moveSlug(state, slug);
      if (impact >= 0) land(state, slug, impact);
      return;
    }
    case 'chute': {
      slug.still = 0;
      slug.vy = Math.min(CHUTE_FALL, slug.vy + GRAVITY);
      const drift = Math.trunc((state.wind * CHUTE_DRIFT * state.opts.windScale) / 100);
      slug.vx += Math.trunc((drift - slug.vx) / 8);
      if (moveSlug(state, slug) >= 0) {
        slug.mode = 'stand';
        slug.vx = 0;
        slug.blown = false;
        state.events.push({ k: 'chute', id: slug.id, open: false });
      }
      return;
    }
    case 'jet': {
      slug.still = 0;
      slug.vy += GRAVITY;
      slug.vx = Math.max(-JET_CAP, Math.min(JET_CAP, slug.vx));
      slug.vy = Math.max(-JET_CAP, Math.min(JET_CAP, slug.vy));
      const aloft = fits(state.terrain, px(slug.x), px(slug.y) + 1);
      if (moveSlug(state, slug) >= 0) {
        slug.vx = 0;
        // Coming down onto the land switches the jetpack off, as running out of fuel does; one
        // switched on or pushed sideways along the ground has not come down, and stays on.
        if (aloft) {
          slug.vy = 0;
          slug.mode = 'stand';
          slug.thrust = 0;
          state.events.push({ k: 'jet', id: slug.id, on: false });
          return;
        }
      }
      if (state.jetFuel <= 0) {
        slug.mode = 'air';
        slug.thrust = 0;
        state.events.push({ k: 'jet', id: slug.id, on: false });
      }
      return;
    }
    case 'rope':
      stepRope(state, slug);
      return;
  }
}

/** Push a slug in the air towards `dir`, never past AIR_TOP, and never slowing one already going faster that way. */
function steer(slug: Slug, dir: 1 | -1): void {
  slug.facing = dir;
  if (dir * slug.vx >= AIR_TOP) return;
  slug.vx = dir * Math.min(AIR_TOP, dir * slug.vx + AIR_PUSH);
}

/** Snap a landed slug down onto the ground under it. */
function settleDown(state: SlugsState, slug: Slug): void {
  for (let k = 0; k < STEP_PX && fits(state.terrain, px(slug.x), px(slug.y) + 1); k++) slug.y = (px(slug.y) + 1) * ONE;
  slug.y = px(slug.y) * ONE;
}

/**
 * Where a slug standing at height `y` stands in column `x`, climbing up to
 * `climb` px or dropping up to STEP_PX: its new height, and whether it walked
 * off a ledge (then the height is where it starts to fall from). Null if blocked.
 */
function footAt(t: Uint8Array, x: number, y: number, climb: number): { y: number; drop: boolean } | null {
  for (let up = 0; up <= climb; up++) {
    if (!fits(t, x, y - up)) continue;
    let ny = y - up;
    let down = 0;
    while (down <= STEP_PX && fits(t, x, ny + 1)) {
      ny++;
      down++;
    }
    return down > STEP_PX ? { y: ny - down + STEP_PX, drop: true } : { y: ny, drop: false };
  }
  return null;
}

/**
 * Most a walk climbs over CLIMB_RUN px of ground: the source's 14 px step. Each
 * pixel may still rise STEP_PX, so a ledge is climbed, but a staircase of such
 * rises (a wall at 80°) is not. The run is ours.
 */
const CLIMB_MOST = 14;
const CLIMB_RUN = 4;

/** Whether the ground from column `x` on rises more than CLIMB_MOST within CLIMB_RUN px. */
function tooSteep(t: Uint8Array, x: number, y: number, dir: number, climb: number): boolean {
  // Only a step that rises can start a climb too steep; the window is checked again
  // from where the rise begins. This keeps flat walking (and the computer's plans) cheap.
  const first = footAt(t, x, y, climb);
  if (!first || first.drop || first.y >= y) return false;
  let at = first.y;
  for (let k = 1; k < CLIMB_RUN; k++) {
    const foot = footAt(t, x + dir * k, at, climb);
    if (!foot || foot.drop) return false;
    at = foot.y;
    if (y - at > CLIMB_MOST) return true;
  }
  return false;
}

/**
 * Move a standing slug one pixel along the ground, climbing or dropping up to
 * `climb` px. False if the way is blocked. Walks (or slides) off a ledge into the air.
 */
function stepAlong(state: SlugsState, slug: Slug, dir: number, climb: number, keepSpeed: boolean): boolean {
  const t = state.terrain;
  const x = px(slug.x) + dir;
  const y = px(slug.y);
  if (x < -40 || x > W + 40) return false;
  const foot = footAt(t, x, y, climb);
  if (!foot || tooSteep(t, x, y, dir, climb)) return false;
  slug.x = x * ONE + (slug.x - px(slug.x) * ONE);
  slug.y = foot.y * ONE;
  if (foot.drop) {
    slug.mode = 'air';
    if (!keepSpeed) slug.vx = dir * Math.trunc(ONE / 2);
    slug.vy = 0;
  }
  return true;
}

// --- The rope ---

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** First land pixel on the line from (x0, y0) to (x1, y1), skipping `skip` px at each end; the free pixel before it. */
function firstBlock(t: Uint8Array, x0: number, y0: number, x1: number, y1: number, skip: number): Spot | null {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = skip; k <= n - skip; k++) {
    const x = x0 + Math.trunc(((x1 - x0) * k) / n);
    const y = y0 + Math.trunc(((y1 - y0) * k) / n);
    if (solidAt(t, x, y)) {
      return { x: x0 + Math.trunc(((x1 - x0) * (k - 1)) / n), y: y0 + Math.trunc(((y1 - y0) * (k - 1)) / n) };
    }
  }
  return null;
}

/** Throw the rope along the aim (never below level); it catches the first land within reach. */
function fireRope(state: SlugsState, slug: Slug): void {
  const aim = Math.max(0, slug.aim);
  const sx = px(slug.x);
  const sy = px(slug.y) - 2;
  const ex = sx + Math.trunc((slug.facing * cosDeg(aim) * ROPE_MAX) / ONE);
  const ey = sy - Math.trunc((sinDeg(aim) * ROPE_MAX) / ONE);
  const at = firstBlock(state.terrain, sx, sy, ex, ey, 6);
  if (!at) {
    state.events.push({ k: 'rope', x: ex, y: ey, hit: false });
    return;
  }
  const u = unitTo(at.x, at.y, sx, sy);
  state.rope = { pts: [{ x: at.x, y: at.y, side: 0 }], len: Math.max(ROPE_MIN, u.d) * ONE };
  state.ropeShots--;
  if (slug.mode === 'jet') state.events.push({ k: 'jet', id: slug.id, on: false });
  slug.mode = 'rope';
  slug.blown = false;
  slug.walk = 0;
  state.events.push({ k: 'rope', x: at.x, y: at.y, hit: true });
}

function letGo(state: SlugsState, slug: Slug): void {
  state.rope = null;
  slug.mode = 'air';
  slug.blown = false;
  state.events.push({ k: 'unrope', id: slug.id });
}

/** Length of rope already wound round corners, in px. */
function ropeWound(rope: Rope): number {
  let sum = 0;
  for (let i = 1; i < rope.pts.length; i++) sum += unitTo(rope.pts[i - 1].x, rope.pts[i - 1].y, rope.pts[i].x, rope.pts[i].y).d;
  return sum;
}

/**
 * Swing: gravity and the player's push, then the slug is held within the free
 * length of the last point, losing any speed outward. The rope wraps round
 * land it swings across and unwraps when the slug swings back past the corner.
 */
function stepRope(state: SlugsState, slug: Slug): void {
  const rope = state.rope as Rope;
  const t = state.terrain;
  slug.still = 0;
  slug.vy += GRAVITY;
  const speed = isqrt(Math.trunc(slug.vx / 16) ** 2 + Math.trunc(slug.vy / 16) ** 2) * 16;
  if (speed > ROPE_CAP) {
    slug.vx = Math.trunc((slug.vx * (ROPE_CAP / 256)) / (speed / 256));
    slug.vy = Math.trunc((slug.vy * (ROPE_CAP / 256)) / (speed / 256));
  }
  moveSlug(state, slug);
  let last = rope.pts[rope.pts.length - 1];
  const dx = slug.x - last.x * ONE;
  const dy = slug.y - last.y * ONE;
  const dist = isqrt(Math.trunc(dx / 64) ** 2 + Math.trunc(dy / 64) ** 2) * 64;
  if (dist > rope.len && dist > 0) {
    const ux = Math.trunc((dx * 1024) / dist);
    const uy = Math.trunc((dy * 1024) / dist);
    const tx = last.x * ONE + Math.trunc((ux * rope.len) / 1024);
    const ty = last.y * ONE + Math.trunc((uy * rope.len) / 1024);
    if (fits(t, px(tx), px(ty))) {
      slug.x = tx;
      slug.y = ty;
    }
    const out = Math.trunc((slug.vx * ux + slug.vy * uy) / 1024);
    if (out > 0) {
      slug.vx -= Math.trunc((out * ux) / 1024);
      slug.vy -= Math.trunc((out * uy) / 1024);
    }
  }
  const sx = px(slug.x);
  const sy = px(slug.y);
  if (rope.pts.length >= 2) {
    const prev = rope.pts[rope.pts.length - 2];
    const turn = cross(last.x - prev.x, last.y - prev.y, sx - last.x, sy - last.y);
    if (turn * last.side < 0) {
      rope.pts.pop();
      rope.len += unitTo(prev.x, prev.y, last.x, last.y).d * ONE;
      last = prev;
    }
  }
  const hit = firstBlock(t, last.x, last.y, sx, sy, 2);
  if (hit) {
    const corner = offRock(t, hit);
    const wound = unitTo(last.x, last.y, corner.x, corner.y).d;
    const side = Math.sign(cross(corner.x - last.x, corner.y - last.y, sx - corner.x, sy - corner.y));
    if (side !== 0 && wound >= ROPE_BEND_MIN) {
      rope.pts.push({ x: corner.x, y: corner.y, side });
      rope.len = Math.max(ROPE_MIN * ONE, rope.len - wound * ONE);
    }
  }
}

/**
 * A bend point stood off the rock by up to 2 px, so the rope from it does not
 * graze the same rock next tick and wrap again a pixel further along.
 */
function offRock(t: Uint8Array, at: Spot): Spot {
  const n = normalAt(t, at.x, at.y);
  const u = unitTo(0, 0, n.nx, n.ny);
  for (let d = 2; d > 0; d--) {
    const x = at.x + Math.round((u.ux * d) / ONE);
    const y = at.y + Math.round((u.uy * d) / ONE);
    if (!solidAt(t, x, y)) return { x, y };
  }
  return at;
}

// --- The active slug's controls ---

/** Spend the turn's attack: retreat time from now. A shot that hurt its own slug has already ended the turn, and that stands. */
function attacked(state: SlugsState, w: WeaponId, slug: Slug): void {
  if (state.phase !== 'turn') return;
  state.charging = false;
  state.power = 0;
  state.phase = 'retreat';
  state.phaseT = 0;
  state.timeLeft = slug.mode === 'rope' ? Math.max(ROPE_RETREAT, WEAPON[w].retreat) : WEAPON[w].retreat;
  // Fired from the rope, the slug keeps roping through its retreat and may shoot it again.
  if (slug.mode === 'rope') state.weapon = 'rope';
}

function spend(team: Team, w: WeaponId): void {
  if (team.ammo[w] > 0) team.ammo[w]--;
}

function fire(state: SlugsState, slug: Slug): void {
  const team = state.teams[slug.team];
  const w = state.weapon;
  const spec = WEAPON[w];
  const sx = px(slug.x);
  const sy = px(slug.y) - 2;
  if (w === 'rope') {
    fireRope(state, slug);
    return;
  }
  state.events.push({ k: 'fire', w, x: sx, y: sy });
  switch (w) {
    case 'shotgun':
      bullet(state, slug, slug.aim, SHOT_RANGE, w);
      state.shotsLeft--;
      if (state.shotsLeft > 0) return;
      break;
    case 'longshot':
      bullet(state, slug, slug.aim, LONG_RANGE, w);
      break;
    case 'handgun':
    case 'machinegun':
    case 'minigun':
      state.using = { w, left: (BURST[w] as { rounds: number }).rounds, t: 0, hit: [] };
      spend(team, w);
      state.charging = false;
      state.power = 0;
      return;
    case 'blowtorch':
    case 'drill':
      state.using = { w, left: DIG_TICKS, t: 0, hit: [] };
      spend(team, w);
      return;
    case 'dynamite': {
      // Facing a wall, it is dropped where the slug stands rather than inside the rock.
      const dx = projHitsLand(state.terrain, sx + slug.facing * 6, sy) ? 0 : slug.facing * 6;
      state.projs.push(newProj(state.nextId++, 'dynamite', sx + dx, sy, slug.facing * Math.trunc(ONE / 2), -ONE, slug.id, {
        fuse: DYNAMITE_FUSE, damage: spec.damage, crater: spec.crater, bias: spec.bias, bounce: BOUNCE_LOW,
      }));
      break;
    }
    case 'mine': {
      const dx = boxFree(state.terrain, sx + slug.facing * 8, sy, MINE_HALF.w, MINE_HALF.h) ? slug.facing * 8 : 0;
      const mine = newObj(state, 'mine', sx + dx, sy, MINE_FUSE);
      mine.arm = spec.retreat;
      state.objs.push(mine);
      break;
    }
    case 'snail': {
      const p = newProj(state.nextId++, 'snail', sx + slug.facing * 8, sy, 0, 0, slug.id, {
        fuse: -1, damage: spec.damage, crater: spec.crater, bias: spec.bias, life: SNAIL_LIFE,
      });
      p.dir = slug.facing;
      state.projs.push(p);
      state.remote = p.id;
      break;
    }
    case 'uppercut':
    case 'spade':
    case 'prod':
      blow(state, slug, w);
      break;
    case 'jetpack':
      spend(team, w);
      state.jetFuel = JET_FUEL;
      slug.mode = 'jet';
      slug.blown = false;
      state.events.push({ k: 'jet', id: slug.id, on: true });
      return;
    case 'parachute':
      spend(team, w);
      slug.mode = 'chute';
      slug.blown = false;
      state.events.push({ k: 'chute', id: slug.id, open: true });
      return;
    default:
      state.projs.push(launch(state.nextId++, w, slug, slug.facing, slug.aim, state.power, state.fuse, state.bounceHigh, state.mark));
  }
  spend(team, w);
  attacked(state, w, slug);
}

/** A straight shot: the first slug, barrel or land on the line takes a small blast. */
function bullet(state: SlugsState, slug: Slug, aim: number, range: number, w: WeaponId): void {
  const spec = WEAPON[w];
  const t = state.terrain;
  const x0 = px(slug.x);
  const y0 = px(slug.y) - 2;
  const dx = slug.facing * cosDeg(aim);
  const dy = -sinDeg(aim);
  let hitX = x0;
  let hitY = y0;
  for (let d = 6; d < range; d++) {
    const x = x0 + Math.trunc((dx * d) / ONE);
    const y = y0 + Math.trunc((dy * d) / ONE);
    hitX = x;
    hitY = y;
    if (y > state.water) {
      state.events.push({ k: 'shot', id: slug.id, x0, y0, x1: x, y1: y }, { k: 'splash', x, big: false });
      return;
    }
    if (x < -40 || x > W + 40 || y < -400) break;
    const target = state.slugs.find(
      (s) => s.alive && s.id !== slug.id && Math.abs(px(s.x) - x) <= SLUG_HALF_W && Math.abs(px(s.y) - y) <= SLUG_HALF_H
    );
    const barrel = barrelAt(state, x, y);
    if (target || barrel || solidAt(t, x, y)) {
      state.events.push({ k: 'shot', id: slug.id, x0, y0, x1: x, y1: y });
      explode(state, x, y, spec.damage, spec.crater, spec.bias, w);
      return;
    }
  }
  state.events.push({ k: 'shot', id: slug.id, x0, y0, x1: hitX, y1: hitY });
}

/** Slugs within reach just in front of `slug`. */
function inReach(state: SlugsState, slug: Slug): Slug[] {
  const sx = px(slug.x);
  const sy = px(slug.y);
  return state.slugs.filter((s) => {
    if (!s.alive || s.id === slug.id) return false;
    const ahead = (px(s.x) - sx) * slug.facing;
    return ahead >= -2 && ahead <= MELEE_REACH && Math.abs(px(s.y) - sy) <= SLUG_HALF_H * 2;
  });
}

function blow(state: SlugsState, slug: Slug, w: WeaponId): void {
  const spec = WEAPON[w];
  for (const s of inReach(state, slug)) {
    state.events.push({ k: 'blow', w, id: s.id });
    if (w === 'spade') {
      const v = aimVector(slug.facing, slug.aim, SPADE_SPEED);
      knock(s, v.vx, v.vy, true);
    } else if (w === 'uppercut') {
      const v = aimVector(slug.facing, 75, UPPERCUT_THROW);
      knock(s, v.vx, v.vy, true);
    } else {
      knock(s, slug.facing * PROD_PUSH, -PROD_PUSH, false);
    }
    hurt(state, s, spec.damage);
  }
  if (w === 'uppercut') knock(slug, 0, UPPERCUT_SELF, true);
}

/** One tick of a gun's burst or a dig tool. Fire stops a dig early. */
function stepUsing(state: SlugsState, slug: Slug, keys: number, pressed: number): void {
  const using = state.using as Using;
  const spec = WEAPON[using.w];
  const burst = BURST[using.w];
  if (burst) {
    if (keys & KEY.up) slug.aim = Math.min(90, slug.aim + 1);
    if (keys & KEY.down) slug.aim = Math.max(-90, slug.aim - 1);
    if (using.t % burst.gap === 0) {
      const spread = burst.spread ? randInt(state, burst.spread * 2 + 1) - burst.spread : 0;
      bullet(state, slug, Math.max(-90, Math.min(90, slug.aim + spread)), SHOT_RANGE, using.w);
      using.left--;
    }
    using.t++;
    if (using.left <= 0 && state.using === using) {
      state.using = null;
      attacked(state, using.w, slug);
    }
    return;
  }
  using.t++;
  using.left--;
  const sx = px(slug.x);
  const was = { x: slug.x, y: slug.y };
  if (using.w === 'blowtorch') {
    const tilt = slug.aim > 10 ? -25080 : slug.aim < -10 ? 25080 : 0;
    const along = tilt === 0 ? ONE : 60547;
    slug.x += Math.trunc((slug.facing * along * (TORCH_RATE / ONE)));
    slug.y += Math.trunc(tilt * (TORCH_RATE / ONE));
    const nx = px(slug.x);
    const ny = px(slug.y);
    const front = nx + slug.facing * (SLUG_HALF_W + 3);
    carveBox(state, Math.min(nx, front) - SLUG_HALF_W, ny - SLUG_HALF_H - 1, Math.max(nx, front) + SLUG_HALF_W, ny + SLUG_HALF_H - 1, true);
  } else {
    slug.y += DRILL_RATE;
    const ny = px(slug.y);
    carveBox(state, sx - SLUG_HALF_W - 1, ny - SLUG_HALF_H, sx + SLUG_HALF_W + 1, ny + SLUG_HALF_H + 2, true);
  }
  // Steel is not carved, so the tool stops against it rather than moving the slug into it, and
  // the map edge stops it too: past it there is nothing to burn through, only air.
  const blocked = !fits(state.terrain, px(slug.x), px(slug.y)) || px(slug.x) < SLUG_HALF_W || px(slug.x) >= W - SLUG_HALF_W;
  if (blocked) {
    slug.x = was.x;
    slug.y = was.y;
  }
  for (const s of state.slugs) {
    if (!s.alive || s.id === slug.id || using.hit.includes(s.id)) continue;
    const ahead = using.w === 'drill' ? px(s.y) - px(slug.y) : (px(s.x) - px(slug.x)) * slug.facing;
    const side = using.w === 'drill' ? Math.abs(px(s.x) - px(slug.x)) : Math.abs(px(s.y) - px(slug.y));
    if (ahead > 0 && ahead <= SLUG_HALF_H * 2 + 4 && side <= SLUG_HALF_H * 2) {
      using.hit.push(s.id);
      knock(s, using.w === 'drill' ? 0 : slug.facing * ONE * 2, -2 * ONE, true);
      hurt(state, s, spec.damage);
    }
  }
  if (blocked || using.left <= 0 || pressed & KEY.fire || slug.y > state.water * ONE) {
    state.using = null;
    attacked(state, using.w, slug);
  }
}

/** Fire a 'target' weapon at a point. False if the point cannot take it, which spends nothing. */
function fireAtPoint(state: SlugsState, slug: Slug, w: WeaponId, x: number, y: number): boolean {
  const team = state.teams[slug.team];
  if (w === 'airstrike') {
    strike(state, slug, Math.max(0, Math.min(W - 1, x)), Math.max(0, Math.min(state.water, y)));
  } else if (w === 'millstone') {
    const sx = Math.max(0, Math.min(W - 1, x));
    state.projs.push(newProj(state.nextId++, 'stone', sx, -40, 0, 2 * ONE, slug.id, {
      fuse: -1, damage: WEAPON.millstone.damage, crater: WEAPON.millstone.crater, bias: WEAPON.millstone.bias,
    }));
    state.events.push({ k: 'fire', w, x: sx, y });
  } else if (w === 'teleport') {
    if (x < SLUG_HALF_W || x >= W - SLUG_HALF_W || y < TELEPORT_TOP || y + SLUG_HALF_H >= state.water || !fits(state.terrain, x, y)) return false;
    // Another slug is as solid as rock to arrive in.
    const taken = state.slugs.some((s) => s.alive && s.id !== slug.id && Math.abs(px(s.x) - x) <= SLUG_HALF_W * 2 && Math.abs(px(s.y) - y) < SLUG_HALF_H * 2);
    if (taken) return false;
    state.events.push({ k: 'teleport', id: slug.id, x0: px(slug.x), y0: px(slug.y), x1: x, y1: y });
    slug.x = x * ONE;
    slug.y = y * ONE;
    slug.vx = slug.vy = 0;
    slug.mode = grounded(state.terrain, x, y) ? 'stand' : 'air';
    spend(team, w);
    endTurn(state);
    return true;
  } else if (w === 'girder') {
    if (!placeGirder(state, slug, x, y)) return false;
  } else {
    return false;
  }
  spend(team, w);
  attacked(state, w, slug);
  return true;
}

function placeGirder(state: SlugsState, slug: Slug, cx: number, cy: number): boolean {
  if (unitTo(px(slug.x), px(slug.y), cx, cy).d > GIRDER_REACH) return false;
  const [ux, uy] = GIRDER_DIR[state.girderRot];
  const x0 = cx - Math.trunc((ux * GIRDER_HALF) / ONE);
  const y0 = cy - Math.trunc((uy * GIRDER_HALF) / ONE);
  const x1 = cx + Math.trunc((ux * GIRDER_HALF) / ONE);
  const y1 = cy + Math.trunc((uy * GIRDER_HALF) / ONE);
  const cells: number[] = [];
  for (let y = Math.min(y0, y1) - GIRDER_THICK; y <= Math.max(y0, y1) + GIRDER_THICK; y++) {
    for (let x = Math.min(x0, x1) - GIRDER_THICK; x <= Math.max(x0, x1) + GIRDER_THICK; x++) {
      if (x < 0 || x >= W || y < 0 || y >= state.water) continue;
      // Distance from the beam's centre line, along and across, in px times ONE.
      const along = (x - cx) * ux + (y - cy) * uy;
      const across = -(x - cx) * uy + (y - cy) * ux;
      if (Math.abs(along) <= GIRDER_HALF * ONE && Math.abs(across) <= GIRDER_THICK * ONE) cells.push(y * W + x);
    }
  }
  const covers = (bx: number, by: number, hw: number, hh: number) =>
    cells.some((c) => Math.abs((c % W) - bx) <= hw + 1 && Math.abs(Math.floor(c / W) - by) <= hh + 1);
  if (cells.length === 0) return false;
  if (state.slugs.some((s) => s.alive && covers(px(s.x), px(s.y), SLUG_HALF_W, SLUG_HALF_H))) return false;
  if (state.objs.some((o) => covers(px(o.x), px(o.y), BARREL_HALF.w, BARREL_HALF.h))) return false;
  for (const c of cells) if (state.terrain[c] !== STEEL) state.terrain[c] = 2;
  state.events.push(
    { k: 'girder', x0, y0, x1, y1 },
    { k: 'land', x0: Math.min(x0, x1) - GIRDER_THICK, y0: Math.min(y0, y1) - GIRDER_THICK, x1: Math.max(x0, x1) + GIRDER_THICK, y1: Math.max(y0, y1) + GIRDER_THICK },
  );
  return true;
}

/** Where the strike's missiles start so that, falling through clear air, they come down on the point picked. */
function strike(state: SlugsState, slug: Slug, tx: number, ty: number): void {
  const dir = slug.facing;
  let x = 0;
  let y = -60 * ONE;
  let vy = STRIKE_SPEED;
  while (px(y) < ty) {
    vy += GRAVITY;
    x += dir * STRIKE_SPEED;
    y += vy;
  }
  const startX = tx - dir * px(x);
  for (let i = 0; i < STRIKE_MISSILES; i++) {
    const offset = (i - (STRIKE_MISSILES >> 1)) * STRIKE_GAP;
    state.projs.push(newProj(state.nextId++, 'missile', startX + offset, -60 - i * 4, dir * STRIKE_SPEED, STRIKE_SPEED, slug.id, {
      fuse: -1, damage: WEAPON.airstrike.damage, crater: WEAPON.airstrike.crater, bias: WEAPON.airstrike.bias,
    }));
  }
  state.events.push({ k: 'fire', w: 'airstrike', x: tx, y: ty });
}

/** Weapons that can be fired while hanging on a rope, flying a jetpack or under a parachute. */
const firesAloft = (w: WeaponId) => {
  const spec = WEAPON[w];
  return (spec.category === 'explosive' || spec.category === 'special' || spec.category === 'firearm') && spec.use !== 'target';
};

/**
 * Whether the active team may pick a weapon now, or why not: 'used' once the
 * turn's attack is spent (or it is not a turn at all), 'busy' while charging
 * or using a tool, 'between shots' after the shotgun's first. In the hot seat
 * a pick is allowed: it starts the turn.
 */
export function canPickWeapon(state: SlugsState): true | 'used' | 'busy' | 'between shots' {
  if (state.phase !== 'turn' && state.phase !== 'ready') return 'used';
  if (state.charging || state.using) return 'busy';
  if (state.shotsLeft < SHOTGUN_SHOTS) return 'between shots';
  return true;
}

function control(state: SlugsState, input: Input): void {
  const slug = state.slugs[state.active];
  if (!slug || !slug.alive) return;
  const team = state.teams[slug.team];
  const keys = input.keys;
  const pressed = keys & ~state.held;
  state.held = keys;
  const act = input.act;
  const canFire = state.phase === 'turn';
  const aloft = slug.mode === 'rope' || slug.mode === 'jet' || slug.mode === 'chute';

  if (act) {
    if (act.t === 'skip') {
      endTurn(state);
      return;
    }
    if (act.t === 'surrender') {
      team.out = true;
      team.slugs.forEach((id) => {
        const s = state.slugs[id];
        if (s.alive) s.hp = 0;
      });
      endTurn(state);
      return;
    }
    if (act.t === 'weapon' && canPickWeapon(state) === true && team.ammo[act.w] !== 0) {
      state.weapon = team.weapon = act.w;
      state.mark = null;
    }
    if (act.t === 'fuse' && act.n >= 1 && act.n <= 5) state.fuse = team.fuse = act.n;
    if (act.t === 'bounce') state.bounceHigh = team.bounceHigh = !state.bounceHigh;
    if (act.t === 'girder' && act.rot >= 0 && act.rot < GIRDER_DIR.length) state.girderRot = Math.trunc(act.rot);
    if (act.t === 'target' && canFire && team.ammo[state.weapon] !== 0) {
      const tx = Math.trunc(act.x);
      const ty = Math.trunc(act.y);
      if (WEAPON[state.weapon].use === 'target' && slug.mode === 'stand' && fireAtPoint(state, slug, state.weapon, tx, ty)) return;
      if (WEAPON[state.weapon].use === 'mark') state.mark = { x: Math.max(0, Math.min(W - 1, tx)), y: Math.max(-400, Math.min(H, ty)) };
    }
    if (act.t === 'jump' && slug.mode === 'rope') {
      letGo(state, slug);
      return;
    }
    if ((act.t === 'jump' || act.t === 'flip' || act.t === 'backjump' || act.t === 'hop') && slug.mode === 'stand' && !state.charging && !state.using) {
      const v = LEAP[act.t];
      slug.vx = slug.facing * v.vx;
      slug.vy = v.vy;
      slug.mode = 'air';
      slug.still = 0;
      state.events.push({ k: 'jump', id: slug.id });
      return;
    }
  }

  if (state.using) {
    stepUsing(state, slug, keys, pressed);
    return;
  }
  const remote = state.remote >= 0 ? state.projs.find((p) => p.id === state.remote) : undefined;
  if (remote) {
    if (pressed & KEY.fire) remote.life = remote.age + 1;
    return;
  }

  if (slug.mode === 'rope') {
    const rope = state.rope as Rope;
    if (keys & KEY.up) rope.len = Math.max(ROPE_MIN * ONE, rope.len - ROPE_REEL);
    if (keys & KEY.down) rope.len = Math.min((ROPE_MAX - ropeWound(rope)) * ONE, rope.len + ROPE_REEL);
    if (keys & KEY.left) slug.vx -= ROPE_PUSH;
    if (keys & KEY.right) slug.vx += ROPE_PUSH;
    if (keys & KEY.left) slug.facing = -1;
    if (keys & KEY.right) slug.facing = 1;
    if (!state.charging && pressed & KEY.fire && !(canFire && state.weapon !== 'rope' && firesAloft(state.weapon))) {
      letGo(state, slug);
      return;
    }
  } else if (slug.mode === 'jet') {
    slug.thrust = keys & (KEY.up | KEY.left | KEY.right);
    let burn = 0;
    if (keys & KEY.up) {
      slug.vy -= JET_UP;
      burn += JET_BURN;
    }
    if (keys & KEY.left) {
      slug.vx -= JET_SIDE;
      slug.facing = -1;
      burn += JET_BURN;
    }
    if (keys & KEY.right) {
      slug.vx += JET_SIDE;
      slug.facing = 1;
      burn += JET_BURN;
    }
    state.jetFuel = Math.max(0, state.jetFuel - burn);
    if (pressed & KEY.fire && !(canFire && firesAloft(state.weapon))) {
      slug.mode = 'air';
      slug.thrust = 0;
      slug.blown = false;
      state.events.push({ k: 'jet', id: slug.id, on: false });
      return;
    }
  } else {
    // Aim: a degree a tick, or one every other tick held fine.
    const aimStep = keys & KEY.fine ? (state.tick % 2 === 0 ? 1 : 0) : 1;
    if (keys & KEY.up) slug.aim = Math.min(90, slug.aim + aimStep);
    if (keys & KEY.down) slug.aim = Math.max(-90, slug.aim - aimStep);
  }

  const w = state.weapon;
  const spec = WEAPON[w];
  const ready = slug.mode === 'stand' || (aloft && firesAloft(w));
  if (w === 'parachute' && pressed & KEY.fire && slug.mode === 'air' && team.ammo.parachute !== 0) {
    fire(state, slug);
    return;
  }
  if (w === 'rope' && pressed & KEY.fire && state.ropeShots > 0 && (slug.mode === 'stand' || slug.mode === 'air' || slug.mode === 'jet')) {
    fire(state, slug);
    return;
  }
  if (canFire && spec.use !== 'target' && w !== 'rope' && w !== 'parachute' && team.ammo[w] !== 0) {
    if (spec.use === 'charge' || spec.use === 'mark') {
      if (pressed & KEY.fire && ready && (spec.use === 'charge' || state.mark)) {
        state.charging = true;
        state.power = 0;
      }
      if (state.charging) {
        if (keys & KEY.fire) state.power++;
        if (!(keys & KEY.fire) || state.power >= CHARGE_TICKS) fire(state, slug);
        return;
      }
    } else if (pressed & KEY.fire && ready && (spec.category !== 'melee' && spec.category !== 'tool' ? true : slug.mode === 'stand')) {
      fire(state, slug);
      return;
    }
  }

  // Walk. Turning round takes a tick; between the shotgun's shots the slug may turn but not walk.
  const dir = keys & KEY.left ? -1 : keys & KEY.right ? 1 : 0;
  if (dir !== 0 && slug.mode === 'air' && !slug.blown && !state.charging) steer(slug, dir);
  if (dir === 0 || slug.mode !== 'stand' || state.charging) {
    slug.walk = 0;
    return;
  }
  if (dir !== slug.facing) {
    slug.facing = dir;
    slug.walk = 0;
    return;
  }
  if (state.shotsLeft < SHOTGUN_SHOTS) {
    slug.walk = 0;
    return;
  }
  const quarter = WALK_CYCLE[slug.walk % WALK_CYCLE.length];
  slug.walk++;
  slug.still = 0;
  const sub = (slug.x - px(slug.x) * ONE) + Math.trunc((dir * quarter * ONE) / 4);
  const whole = Math.floor(sub / ONE);
  slug.x = px(slug.x) * ONE + (sub - whole * ONE);
  for (let i = 0; i < Math.abs(whole); i++) {
    if (!stepAlong(state, slug, dir, STEP_PX, false)) {
      slug.x = px(slug.x) * ONE;
      break;
    }
    if (slug.mode !== 'stand') break;
  }
}

// --- The computer ---
//
// The computer's turn is worked out a piece a tick, so no single tick stalls
// a frame, and its progress lives in state.plan, so a clone or a replay
// partway through a turn carries on from the same point. Moves and the chosen
// shot are tried out on a clone of the state run through advance() itself,
// with the computer pressing the same keys it then presses for real, so what
// it expects to happen is what happens.

const AIM_ERROR = [0, 8, 5, 3, 1, 0];
const POWER_ERROR = [0, 9, 6, 3, 1, 0];
const THINK_TICKS = 40;
/** Px a 'target' weapon's point is off per degree of the level's aim error. Ours. */
const TARGET_ERROR = 8;
const IDLE: Input = { keys: 0 };
/** A shot's worth is its damage score times this; a miss is worth minus how far from an enemy it lands. */
const HIT = 1024;
const NO_SHOT = -(1 << 30);
/** Below this score (about hp of damage) it looks for somewhere better to stand. Ours. */
const MOVE_BAR = 20;
/** Error draws for a shot before it gives up on that weapon for the turn. Ours. */
const REDRAWS = 3;
/** Bomblets land round the burst; scored as one wider blast of about two bomblets' damage. Ours. */
const SPRAY: Partial<Record<WeaponId, { damage: number; reach: number }>> = {
  cluster: { damage: CLUSTER_BIT.damage * 2, reach: 50 },
  mortar: { damage: MORTAR_BIT.damage * 2, reach: 50 },
  seedpod: { damage: WEAPON.seedpod.damage * 2, reach: 60 },
};
/** Guns the line search weighs, with how far they carry and how much of a burst it counts on landing. */
const GUNS: { w: WeaponId; range: number; rounds: number; scatter: boolean }[] = [
  { w: 'shotgun', range: SHOT_RANGE, rounds: SHOTGUN_SHOTS, scatter: false },
  { w: 'longshot', range: LONG_RANGE, rounds: 1, scatter: false },
  { w: 'handgun', range: SHOT_RANGE, rounds: 6, scatter: false },
  { w: 'machinegun', range: SHOT_RANGE, rounds: 10, scatter: true },
  { w: 'minigun', range: SHOT_RANGE, rounds: 20, scatter: true },
];
const CLOSE: WeaponId[] = ['uppercut', 'prod', 'dynamite', 'mine'];

interface Landing {
  x: number;
  y: number;
}

/** Fly a shot through the current land without changing anything, and say where it goes off. */
export function predict(
  state: SlugsState, weapon: WeaponId, slug: Slug, facing: 1 | -1, aim: number, power: number, fuse: number, mark: Landing | null = null
): Landing | null {
  const p = launch(0, weapon, slug, facing, aim, power, fuse, false, mark);
  for (let i = 0; i < 600; i++) {
    const fate = stepProj(state, p, false);
    if (fate === 'boom') return { x: px(p.x), y: px(p.y) };
    if (fate === 'gone') return null;
  }
  // Still going after 12 s: nothing to plan a shot on.
  return null;
}

function scoreBlast(state: SlugsState, me: Slug, at: Landing, damage: number, crater: number): number {
  let score = 0;
  for (const s of state.slugs) {
    if (!s.alive) continue;
    const dmg = Math.min(Math.max(0, s.hp), blastDamage(damage, crater, distToSlug(s, at.x, at.y)));
    if (dmg <= 0) continue;
    if (s.team === me.team) score -= dmg * (s.id === me.id ? 3 : 2);
    else score += dmg + (dmg >= s.hp ? 30 : 0);
  }
  return score;
}

function scoreAt(state: SlugsState, me: Slug, w: WeaponId, at: Landing): number {
  const spec = WEAPON[w];
  const spray = SPRAY[w];
  return scoreBlast(state, me, at, spec.damage, spec.crater) + (spray ? scoreBlast(state, me, at, spray.damage, spray.reach) : 0);
}

const enemiesOf = (state: SlugsState, me: Slug) =>
  state.slugs
    .filter((s) => s.alive && s.team !== me.team)
    .sort((a, b) => Math.abs(px(a.x) - px(me.x)) + Math.abs(px(a.y) - px(me.y)) - (Math.abs(px(b.x) - px(me.x)) + Math.abs(px(b.y) - px(me.y))) || a.id - b.id);

function nearestEnemy(state: SlugsState, me: Slug, at: Landing): number {
  let d = W + H;
  for (const e of state.slugs) if (e.alive && e.team !== me.team) d = Math.min(d, Math.abs(px(e.x) - at.x) + Math.abs(px(e.y) - at.y));
  return d;
}

/** A shot's worth on the HIT scale, or NO_SHOT if it hurts its own side more than an enemy. */
function worth(state: SlugsState, me: Slug, score: number, at: Landing): number {
  if (score > 0) return score * HIT;
  return score === 0 ? -nearestEnemy(state, me, at) : NO_SHOT;
}

type Shot = Pick<CpuPlan, 'weapon' | 'facing' | 'aim' | 'power' | 'fuse' | 'tx' | 'ty'>;

function consider(plan: CpuPlan, value: number, shot: Shot): void {
  if (value <= plan.score) return;
  plan.score = value;
  plan.weapon = shot.weapon;
  plan.facing = shot.facing;
  plan.aim = shot.aim;
  plan.power = shot.power;
  plan.fuse = shot.fuse;
  plan.tx = shot.tx;
  plan.ty = shot.ty;
}

function tryThrow(state: SlugsState, me: Slug, plan: CpuPlan, weapon: WeaponId, facing: 1 | -1, aim: number, power: number, fuse: number): void {
  const at = predict(state, weapon, me, facing, aim, power, fuse);
  if (at) consider(plan, worth(state, me, scoreAt(state, me, weapon, at), at), { weapon, facing, aim, power, fuse, tx: at.x, ty: at.y });
}

/** The first slug a straight shot along `aim` meets, or none if land or the range stops it first. */
function lineHits(state: SlugsState, me: Slug, facing: 1 | -1, aim: number, range: number): Slug | undefined {
  const x0 = px(me.x);
  const y0 = px(me.y) - 2;
  const dx = facing * cosDeg(aim);
  const dy = -sinDeg(aim);
  for (let d = 6; d < range; d += 2) {
    const x = x0 + Math.trunc((dx * d) / ONE);
    const y = y0 + Math.trunc((dy * d) / ONE);
    if (y > state.water || solidAt(state.terrain, x, y)) return undefined;
    const s = state.slugs.find((g) => g.alive && g.id !== me.id && Math.abs(px(g.x) - x) <= SLUG_HALF_W && Math.abs(px(g.y) - y) <= SLUG_HALF_H);
    if (s) return s;
  }
  return undefined;
}

function searchLines(state: SlugsState, me: Slug, plan: CpuPlan, guns: typeof GUNS): void {
  for (const facing of [1, -1] as const) {
    for (let aim = -60; aim <= 60; aim += 2) {
      const s = lineHits(state, me, facing, aim, LONG_RANGE);
      if (!s || s.team === me.team) continue;
      const at = { x: px(s.x), y: px(s.y) };
      const d = Math.abs(at.x - px(me.x)) + Math.abs(at.y - px(me.y));
      for (const g of guns) {
        if (d >= g.range) continue;
        // A scattered burst loses rounds past about 100 px (ours, from the spread).
        const rounds = g.scatter && d > 100 ? Math.max(1, Math.trunc((g.rounds * 100) / d)) : g.rounds;
        const spec = WEAPON[g.w];
        consider(plan, worth(state, me, scoreBlast(state, me, at, spec.damage * rounds, spec.crater), at), { weapon: g.w, facing, aim, power: 0, fuse: 3, tx: at.x, ty: at.y });
      }
    }
  }
}

/** Run a clone on, the computer pressing its own keys, until the turn's damage is about to be counted. */
function playOn(c: SlugsState, most: number): void {
  for (let i = 0; i < most && (c.phase === 'turn' || c.phase === 'retreat' || c.phase === 'settle'); i++) advance(c, IDLE);
}

interface Outcome {
  /** On the scoreBlast scale: enemy hp lost and kills, less its own side's. */
  value: number;
  own: number;
  enemy: number;
  died: boolean;
  /** Something it fired was still about when the damage came to be counted. */
  stuck: boolean;
}

function outcome(before: SlugsState, after: SlugsState, me: Slug): Outcome {
  const out: Outcome = { value: 0, own: 0, enemy: 0, died: false, stuck: after.projs.length > 0 };
  for (const s of before.slugs) {
    if (!s.alive || s.hp <= 0) continue;
    const now = after.slugs[s.id];
    const left = now.alive ? Math.max(0, now.hp) : 0;
    const lost = s.hp - left;
    if (lost <= 0) continue;
    if (s.team === me.team) {
      out.own += lost;
      out.value -= lost * (s.id === me.id ? 3 : 2) + (left === 0 ? 60 : 0);
      if (s.id === me.id && left === 0) out.died = true;
    } else {
      out.enemy += lost;
      out.value += lost + (left === 0 ? 30 : 0);
    }
  }
  return out;
}

/** Take a shot on a clone, getting clear after it as it would, and see what it does. */
function rehearseShot(state: SlugsState, me: Slug, shot: Shot): Outcome {
  const c = cloneState(state);
  Object.assign(c.plan as CpuPlan, shot, { stage: 'aim' });
  playOn(c, 3000);
  return outcome(state, c, me);
}

function tryRehearsed(state: SlugsState, me: Slug, plan: CpuPlan, shot: Shot): void {
  const out = rehearseShot(state, me, shot);
  if (out.value > 0 && !out.stuck) consider(plan, out.value * HIT, shot);
}

/** The jobs of a shot search from where the slug stands, one a tick. The list depends only on the state, so every tick of the search rebuilds the same one. */
function shotJobs(state: SlugsState, me: Slug, plan: CpuPlan, level: number): (() => void)[] {
  const team = state.teams[me.team];
  // The jar and millstone hit hard even thrown wide, so the two easiest levels keep to the classic kit.
  const has = (w: WeaponId) => team.ammo[w] !== 0 && w !== plan.banned && (level >= 3 || WEAPON[w].classic);
  const jobs: (() => void)[] = [];
  const grid = (w: WeaponId, fuses: number[]) => {
    if (!has(w)) return;
    for (const facing of [1, -1] as const) {
      for (const fuse of fuses) {
        jobs.push(() => {
          for (let aim = -24; aim <= 84; aim += 6) for (let power = 12; power <= CHARGE_TICKS; power += 6) tryThrow(state, me, plan, w, facing, aim, power, fuse);
        });
      }
    }
  };
  grid('bazooka', [3]);
  grid('grenade', [2, 3]);
  grid('cluster', [2]);
  grid('borer', [3]);
  grid('seedpod', [2]);
  grid('jar', [3]);
  if (has('mortar')) {
    jobs.push(() => {
      for (const facing of [1, -1] as const) for (let aim = -24; aim <= 84; aim += 2) tryThrow(state, me, plan, 'mortar', facing, aim, CHARGE_TICKS, 3);
    });
  }
  const guns = GUNS.filter((g) => has(g.w));
  if (guns.length) jobs.push(() => searchLines(state, me, plan, guns));
  const enemies = enemiesOf(state, me);
  for (const e of enemies.slice(0, 2)) {
    const ex = px(e.x);
    const ey = px(e.y);
    const toward: 1 | -1 = ex < px(me.x) ? -1 : 1;
    if (has('homing')) {
      jobs.push(() => {
        const mark = { x: ex, y: ey };
        for (const facing of [toward, -toward as 1 | -1]) {
          for (let aim = 30; aim <= 90; aim += 20) {
            for (let power = 24; power <= CHARGE_TICKS; power += 18) {
              const at = predict(state, 'homing', me, facing, aim, power, 3, mark);
              if (at) consider(plan, worth(state, me, scoreAt(state, me, 'homing', at), at), { weapon: 'homing', facing, aim, power, fuse: 3, tx: ex, ty: ey });
            }
          }
        }
      });
    }
    if (has('airstrike')) for (const facing of [toward, -toward as 1 | -1]) jobs.push(() => tryRehearsed(state, me, plan, { weapon: 'airstrike', facing, aim: me.aim, power: 0, fuse: 3, tx: ex, ty: ey }));
    if (has('millstone')) jobs.push(() => tryRehearsed(state, me, plan, { weapon: 'millstone', facing: me.facing, aim: me.aim, power: 0, fuse: 3, tx: ex, ty: ey }));
    if (Math.abs(ex - px(me.x)) <= 40 && Math.abs(ey - px(me.y)) <= SLUG_HALF_H * 2) {
      for (const w of CLOSE) {
        if (has(w)) jobs.push(() => tryRehearsed(state, me, plan, { weapon: w, facing: toward, aim: me.aim, power: 0, fuse: 3, tx: px(me.x) + toward * 8, ty: px(me.y) }));
      }
      if (has('spade')) for (const aim of [10, 45]) jobs.push(() => tryRehearsed(state, me, plan, { weapon: 'spade', facing: toward, aim, power: 0, fuse: 3, tx: px(me.x), ty: px(me.y) }));
    }
  }
  jobs.push(() => {
    if (plan.score < HIT || WEAPON[plan.weapon].use !== 'charge') return;
    const { weapon, facing, aim, power, fuse } = plan;
    for (let da = -4; da <= 4; da += 2) {
      for (let dp = -4; dp <= 4; dp += 2) {
        if ((da || dp) && aim + da >= -90 && aim + da <= 90 && power + dp >= 4 && power + dp <= CHARGE_TICKS) tryThrow(state, me, plan, weapon, facing, aim + da, power + dp, fuse);
      }
    }
  });
  return jobs;
}

/** A coarse look at what could be hit from where the slug now stands, to rank places to move to. */
function quickWorth(state: SlugsState, me: Slug): number {
  const team = state.teams[me.team];
  const best = newPlan();
  for (const w of ['bazooka', 'grenade'] as const) {
    if (team.ammo[w] === 0) continue;
    for (const facing of [1, -1] as const) {
      for (let aim = -24; aim <= 84; aim += 12) for (let power = 18; power <= CHARGE_TICKS; power += 14) tryThrow(state, me, best, w, facing, aim, power, 3);
    }
  }
  const guns = GUNS.filter((g) => team.ammo[g.w] !== 0);
  if (guns.length) searchLines(state, me, best, guns);
  for (const e of enemiesOf(state, me)) {
    if (Math.abs(px(e.x) - px(me.x)) <= 30 && Math.abs(px(e.y) - px(me.y)) <= SLUG_HALF_H * 2 && CLOSE.some((w) => team.ammo[w] !== 0)) {
      best.score = Math.max(best.score, 30 * HIT);
    }
  }
  return best.score;
}

// --- The computer: moving ---

type StepAhead = 'clear' | 'wall' | 'drop';

/** Fall a copy of a slug through the land: false if it would drown, be hurt landing, or come down near a mine. */
function fallsSafely(state: SlugsState, s: Slug): boolean {
  for (let i = 0; i < 400; i++) {
    if (px(s.y) + SLUG_HALF_H > state.water) return false;
    s.vy = Math.min(SPEED_CAP, s.vy + GRAVITY);
    s.vx = Math.max(-SPEED_CAP, Math.min(SPEED_CAP, s.vx));
    const impact = moveSlug(state, s);
    if (impact >= 0) return impact <= FALL_SAFE && !nearMine(state, s);
  }
  return false;
}

function nearMine(state: SlugsState, s: Slug): boolean {
  return state.objs.some((o) => o.kind === 'mine' && !o.dud && o.fuse < 0 && Math.abs(px(o.x) - px(s.x)) + Math.abs(px(o.y) - px(s.y)) <= MINE_REACH + 6);
}

/** What the next few pixels of a walk towards `dir` hold: a walk on, a wall, or a drop it should not take. */
function stepAhead(state: SlugsState, me: Slug, dir: 1 | -1): StepAhead {
  const s = { ...me };
  for (let i = 0; i < 3; i++) {
    if (!stepAlong(state, s, dir, STEP_PX, false)) return i === 0 ? 'wall' : 'clear';
    if (s.mode === 'air') return fallsSafely(state, s) ? 'clear' : 'drop';
    if (nearMine(state, s)) return 'drop';
  }
  return 'clear';
}

/** A jump towards `dir` that lands unhurt more than `past` px further on. */
function jumpsSafely(state: SlugsState, me: Slug, dir: 1 | -1, past: number): boolean {
  const s = { ...me, vx: dir * JUMP.vx, vy: JUMP.vy, mode: 'air' as const };
  return fallsSafely(state, s) && (px(s.x) - px(me.x)) * dir > past;
}

/** A jump rises too slowly to clear a high step from its foot, so it is taken from as far back as clears it. */
const WALL_LOOK = 24;

/** Pixels of walking before a wall within WALL_LOOK px, or -1 if there is none. */
function wallIn(state: SlugsState, me: Slug, dir: 1 | -1): number {
  const s = { ...me };
  for (let k = 0; k < WALL_LOOK; k++) {
    if (!stepAlong(state, s, dir, STEP_PX, false)) return k;
    if (s.mode !== 'stand') return -1;
  }
  return -1;
}

/** Walk towards `dir`, jumping what it cannot climb; null where it should stop. */
function walkOn(state: SlugsState, me: Slug, dir: 1 | -1): Input | null {
  const key = dir < 0 ? KEY.left : KEY.right;
  if (me.facing !== dir) return { keys: key };
  const ahead = stepAhead(state, me, dir);
  if (ahead === 'drop') return null;
  const wall = wallIn(state, me, dir);
  if (wall >= 0 && jumpsSafely(state, me, dir, wall + 1)) return { keys: 0, act: { t: 'jump' } };
  return wall === 0 ? null : { keys: key };
}

function moveDone(plan: CpuPlan): Input {
  plan.stage = 'shots';
  plan.step = 0;
  plan.score = NO_SHOT;
  plan.moves++;
  plan.move = null;
  return IDLE;
}

/** The keys for a tick of the move picked. A pure function of the state and the plan, so the clone that tried it out pressed the same. */
function moveInput(state: SlugsState, me: Slug, plan: CpuPlan): Input {
  plan.moveT++;
  const dirKey = plan.dir < 0 ? KEY.left : KEY.right;
  const fresh = (keys: number) => ({ keys: state.held & KEY.fire ? keys & ~KEY.fire : keys });
  if (plan.moveT > plan.len + 400 && me.mode === 'stand') return moveDone(plan);
  switch (plan.move) {
    case 'walk': {
      if (me.mode !== 'stand') return IDLE;
      if (plan.moveT > plan.len) return moveDone(plan);
      return walkOn(state, me, plan.dir) ?? moveDone(plan);
    }
    case 'jet': {
      if (me.mode === 'stand') {
        if (plan.flown > 0) return moveDone(plan);
        if (state.weapon !== 'jetpack') return { keys: 0, act: { t: 'weapon', w: 'jetpack' } };
        return fresh(KEY.fire);
      }
      if (me.mode !== 'jet') return IDLE;
      plan.flown++;
      if ((plan.flown > 8 && grounded(state.terrain, px(me.x), px(me.y))) || plan.flown > 300) return fresh(KEY.fire);
      // Rise for `len` ticks; push sideways for twice that, then brake, and hold the fall to 2 px a tick.
      let keys = plan.flown < plan.len || me.vy > 2 * ONE ? KEY.up : 0;
      if (plan.flown < plan.len * 2) keys |= dirKey;
      else if (me.vx * plan.dir > ONE / 2) keys |= plan.dir < 0 ? KEY.right : KEY.left;
      return { keys };
    }
    case 'rope': {
      if (me.mode === 'stand') {
        if (plan.flown !== 0) return moveDone(plan);
        if (state.weapon !== 'rope') return { keys: 0, act: { t: 'weapon', w: 'rope' } };
        if (me.facing !== plan.dir) return { keys: dirKey };
        if (me.aim < plan.moveAim) return { keys: KEY.up };
        if (me.aim > plan.moveAim) return { keys: KEY.down };
        if (state.held & KEY.fire) return IDLE;
        plan.flown = -1;
        return { keys: KEY.fire };
      }
      if (me.mode !== 'rope') return IDLE;
      plan.flown = Math.max(0, plan.flown) + 1;
      if (plan.flown >= plan.len) return { keys: 0, act: { t: 'jump' } };
      return { keys: dirKey | (plan.flown * 2 < plan.len ? KEY.up : 0) };
    }
    case 'teleport': {
      if (state.weapon !== 'teleport') return { keys: 0, act: { t: 'weapon', w: 'teleport' } };
      if (plan.moveT > 4) return moveDone(plan);
      return { keys: 0, act: { t: 'target', x: plan.mx, y: plan.my } };
    }
  }
  return moveDone(plan);
}

/** A clear, standing spot for a slug in the column at `x`, nearest the height `y`. */
function landingSpot(state: SlugsState, x: number, y: number): Landing | null {
  if (x < SLUG_HALF_W || x >= W - SLUG_HALF_W) return null;
  let best: Landing | null = null;
  for (let cy = TELEPORT_TOP; cy + SLUG_HALF_H < state.water; cy++) {
    if (!fits(state.terrain, x, cy) || fits(state.terrain, x, cy + 1)) continue;
    if (!best || Math.abs(cy - y) < Math.abs(best.y - y)) best = { x, y: cy };
  }
  return best;
}

interface MoveTry {
  move: CpuMove;
  dir: 1 | -1;
  len: number;
  aim: number;
  x: number;
  y: number;
}

/** Ways to move this turn: walks of several lengths each way, and the jetpack, rope and teleport if it has them. */
function moveTries(state: SlugsState, me: Slug): MoveTry[] {
  const team = state.teams[me.team];
  const tries: MoveTry[] = [];
  const room = Math.min(400, state.timeLeft - 700);
  for (const dir of [1, -1] as const) for (let len = 40; len <= room; len += 40) tries.push({ move: 'walk', dir, len, aim: 0, x: 0, y: 0 });
  if (team.ammo.jetpack !== 0) for (const dir of [1, -1] as const) for (const len of [15, 35, 60]) tries.push({ move: 'jet', dir, len, aim: 0, x: 0, y: 0 });
  if (team.ammo.rope !== 0) {
    for (const dir of [1, -1] as const) for (const aim of [50, 75]) for (const len of [40, 80]) tries.push({ move: 'rope', dir, len, aim, x: 0, y: 0 });
  }
  if (team.ammo.teleport !== 0) {
    for (const e of enemiesOf(state, me).slice(0, 3)) {
      for (const dx of [-110, 110]) {
        const at = landingSpot(state, px(e.x) + dx, px(e.y));
        if (at && !state.slugs.some((s) => s.alive && Math.abs(px(s.x) - at.x) < 30 && Math.abs(px(s.y) - at.y) < 30)) {
          tries.push({ move: 'teleport', dir: 1, len: 0, aim: 0, x: at.x, y: at.y });
        }
      }
    }
  }
  return tries;
}

/** Make the move on a clone and say what it is worth from where it ends, or NO_SHOT if it goes wrong or goes nowhere new. */
function tryMove(state: SlugsState, me: Slug, t: MoveTry): number {
  const c = cloneState(state);
  const cme = c.slugs[me.id];
  if (t.move === 'teleport') {
    cme.x = t.x * ONE;
    cme.y = t.y * ONE;
    if (nearMine(c, cme)) return NO_SHOT;
    const v = quickWorth(c, cme);
    // It ends the turn, and the wind will have changed by the shot.
    return v >= HIT ? Math.trunc(v / 2) : v - 150;
  }
  const p = c.plan as CpuPlan;
  Object.assign(p, { stage: 'move', move: t.move, dir: t.dir, len: t.len, moveAim: t.aim, moveT: 0, flown: 0 });
  for (let i = 0; i < t.len + 500 && p.stage === 'move' && c.phase === 'turn'; i++) {
    advance(c, IDLE);
    if (c.events.some((e) => e.k === 'hurt' || e.k === 'fall' || e.k === 'drown' || e.k === 'mine')) return NO_SHOT;
  }
  if (p.stage === 'move' || c.phase !== 'turn' || !cme.alive || cme.mode !== 'stand') return NO_SHOT;
  if (Math.abs(px(cme.x) - px(me.x)) + Math.abs(px(cme.y) - px(me.y)) < 12) return NO_SHOT;
  // A walk that stopped short ends where a shorter one did.
  if (t.move === 'walk' && p.moveT < t.len - 40) return NO_SHOT;
  return quickWorth(c, cme);
}

/** Whether a move worth `v` beats staying put with a shot worth `base`. */
function beats(v: number, base: number): boolean {
  if (v >= HIT) return base < HIT || v > (base * 3) / 2;
  return base < HIT && v > base + 60;
}

// --- The computer: the turn ---

export function newPlan(): CpuPlan {
  return {
    stage: 'shots', step: 0, score: NO_SHOT,
    weapon: 'bazooka', facing: 1, aim: 45, power: CHARGE_TICKS, fuse: 3, tx: 0, ty: 0, aim0: 45, power0: CHARGE_TICKS, tx0: 0, tries: 0, banned: null,
    move: null, dir: 1, len: 0, moveAim: 0, mx: 0, my: 0, moveScore: NO_SHOT, moveT: 0, flown: 0, moves: 0,
  };
}

/** Add the level's error to the shot as found, and work out where the shot as it will be fired goes off. */
function drawError(state: SlugsState, me: Slug, plan: CpuPlan, level: number): void {
  const spec = WEAPON[plan.weapon];
  const aimErr = AIM_ERROR[level];
  const powErr = POWER_ERROR[level];
  plan.aim = plan.aim0;
  plan.power = plan.power0;
  plan.tx = plan.tx0;
  if (aimErr && spec.use === 'target') plan.tx = plan.tx0 + (randInt(state, aimErr * 2 + 1) - aimErr) * TARGET_ERROR;
  if (aimErr && spec.aims) plan.aim = Math.max(-90, Math.min(90, plan.aim0 + randInt(state, aimErr * 2 + 1) - aimErr));
  if (powErr && spec.use === 'charge') plan.power = Math.max(4, Math.min(CHARGE_TICKS, plan.power0 + randInt(state, powErr * 2 + 1) - powErr));
  if (LAUNCHED[plan.weapon] && spec.use !== 'mark') {
    const at = predict(state, plan.weapon, me, plan.facing, plan.aim, plan.power, plan.fuse);
    if (at) {
      plan.tx = at.x;
      plan.ty = at.y;
    }
  }
}

function think(state: SlugsState, me: Slug, plan: CpuPlan, level: number): Input {
  if (me.mode !== 'stand' || state.using) return IDLE;
  if (plan.stage === 'shots') {
    const jobs = shotJobs(state, me, plan, level);
    if (plan.step < jobs.length) {
      jobs[plan.step++]();
      return IDLE;
    }
    if (plan.score < MOVE_BAR * HIT && plan.moves === 0 && state.timeLeft > 900) {
      plan.stage = 'moves';
      plan.step = 0;
      plan.move = null;
      plan.moveScore = plan.score;
      return IDLE;
    }
    if (plan.score === NO_SHOT) return { keys: 0, act: { t: 'skip' } };
    plan.stage = 'check';
    plan.aim0 = plan.aim;
    plan.power0 = plan.power;
    plan.tx0 = plan.tx;
    plan.tries = 0;
    drawError(state, me, plan, level);
    return IDLE;
  }
  if (plan.stage === 'moves') {
    const tries = moveTries(state, me);
    if (plan.step < tries.length) {
      const t = tries[plan.step++];
      const v = tryMove(state, me, t);
      if (beats(v, plan.score) && v > plan.moveScore) {
        plan.moveScore = v;
        plan.move = t.move;
        plan.dir = t.dir;
        plan.len = t.len;
        plan.moveAim = t.aim;
        plan.mx = t.x;
        plan.my = t.y;
      }
      return IDLE;
    }
    if (plan.move) {
      plan.stage = 'move';
      plan.moveT = 0;
      plan.flown = 0;
      return IDLE;
    }
    plan.moves++;
    plan.step = Number.MAX_SAFE_INTEGER;
    plan.stage = 'shots';
    return IDLE;
  }
  // 'check': try the shot as it will be fired; if it hurts its own side, draw the error again, then search without that weapon.
  const out = rehearseShot(state, me, plan);
  if (!out.died && !out.stuck && (out.own === 0 || out.own * 2 <= out.enemy)) {
    plan.stage = 'aim';
    return IDLE;
  }
  plan.tries++;
  if (plan.tries < REDRAWS) {
    drawError(state, me, plan, level);
  } else if (plan.banned === null) {
    plan.banned = plan.weapon;
    plan.stage = 'shots';
    plan.step = 0;
    plan.score = NO_SHOT;
  } else {
    return { keys: 0, act: { t: 'skip' } };
  }
  return IDLE;
}

function aimInput(state: SlugsState, me: Slug, plan: CpuPlan): Input {
  if (state.phaseT < THINK_TICKS || me.mode !== 'stand' || state.using) return IDLE;
  const spec = WEAPON[plan.weapon];
  if (state.weapon !== plan.weapon) return { keys: 0, act: { t: 'weapon', w: plan.weapon } };
  if (spec.fuse && state.fuse !== plan.fuse) return { keys: 0, act: { t: 'fuse', n: plan.fuse } };
  // predict() throws with the low bounce.
  if (spec.fuse && state.bounceHigh) return { keys: 0, act: { t: 'bounce' } };
  if (me.facing !== plan.facing) return { keys: plan.facing < 0 ? KEY.left : KEY.right };
  if (spec.use === 'target' || (spec.use === 'mark' && !state.mark)) return { keys: 0, act: { t: 'target', x: plan.tx, y: plan.ty } };
  if (spec.aims && me.aim < plan.aim) return { keys: KEY.up };
  if (spec.aims && me.aim > plan.aim) return { keys: KEY.down };
  if (spec.use === 'charge' || spec.use === 'mark') return state.charging && state.power >= plan.power ? IDLE : { keys: KEY.fire };
  return { keys: state.held & KEY.fire ? 0 : KEY.fire };
}

/** After firing, walk out of reach of where the shot is due to go off, without walking off anything. */
function getClear(state: SlugsState, me: Slug, plan: CpuPlan): Input {
  if (me.mode !== 'stand' || state.using || state.remote >= 0) return IDLE;
  const spec = WEAPON[plan.weapon];
  const reach = spec.crater + (SPRAY[plan.weapon]?.reach ?? 0) + 24;
  const dx = plan.tx - px(me.x);
  if (spec.crater === 0 || Math.abs(dx) >= reach || Math.abs(plan.ty - px(me.y)) >= reach) return IDLE;
  return walkOn(state, me, dx > 0 ? -1 : dx < 0 ? 1 : (-me.facing as 1 | -1)) ?? IDLE;
}

function cpuInput(state: SlugsState, level: number): Input {
  const me = state.slugs[state.active];
  if (!me || !me.alive) return IDLE;
  if (state.phase === 'retreat') return state.plan ? getClear(state, me, state.plan) : IDLE;
  if (state.phase !== 'turn') return IDLE;
  if (!state.plan) state.plan = newPlan();
  const plan = state.plan;
  if (plan.stage === 'move') return moveInput(state, me, plan);
  if (plan.stage === 'aim') return aimInput(state, me, plan);
  return think(state, me, plan, level);
}

// --- The tick ---

export const isComputer = (team: Team) => team.control !== 'human';

export function advance(state: SlugsState, input: Input): void {
  state.events = [];
  state.tick++;
  state.phaseT++;
  // Nothing moves while slugs are placed, and the round clock has not started.
  if (state.phase === 'place') {
    placeTick(state, input);
    return;
  }
  // The round runs on the match clock, retreats and settling included, as the classic game's does.
  if (state.phase !== 'over') state.roundT++;
  const team = state.teams[state.activeTeam];

  if (state.phase === 'ready') {
    // A key held over from before the turn came round does not start it; a new press or an act does.
    const held = state.held;
    const pressed = input.keys & ~held;
    state.held = input.keys;
    const person = !isComputer(team);
    const started = person && (input.act !== undefined || (state.phaseT > 1 && pressed !== 0));
    if (started || state.phaseT >= (person ? READY_TICKS : CPU_READY_TICKS)) {
      state.phase = 'turn';
      state.phaseT = 0;
      // The press that starts the turn also counts in it.
      state.held = held;
    }
  }
  if (state.phase === 'turn' || state.phase === 'retreat') {
    const given = isComputer(team) ? cpuInput(state, team.control as number) : input;
    control(state, given);
    if (!state.charging && !state.using && state.remote < 0) state.timeLeft--;
    if (state.timeLeft <= 0) endTurn(state);
  }

  for (const slug of state.slugs) stepSlug(state, slug);

  // A shot leaves the list the moment it ends, before it goes off, and everything else
  // stays in it, so a blast pushes what is later in the list as well as what came before.
  for (const p of state.projs.slice()) {
    const fate = stepProj(state, p, true);
    if (fate === 'flying') continue;
    state.projs.splice(state.projs.indexOf(p), 1);
    if (fate === 'boom') goOff(state, p);
  }
  if (state.remote >= 0 && !state.projs.some((p) => p.id === state.remote)) state.remote = -1;

  const removed = new Set<Obj>();
  for (const o of state.objs.slice()) if (!stepObj(state, o)) removed.add(o);
  if (removed.size) state.objs = state.objs.filter((o) => !removed.has(o));

  if (state.phase === 'settle') {
    const busy =
      state.projs.length > 0 ||
      state.slugs.some((s) => s.alive && s.mode !== 'stand') ||
      state.objs.some((o) => !o.rest || o.fuse > 0 || (o.kind === 'barrel' && o.hp <= 0));
    state.quiet = busy ? 0 : state.quiet + 1;
    if (state.quiet >= QUIET_TICKS || state.phaseT > SETTLE_MOST) {
      state.phase = 'tally';
      state.phaseT = 0;
    }
  } else if (state.phase === 'tally') {
    let counting = false;
    for (const slug of state.slugs) {
      const target = Math.max(0, slug.hp);
      if (slug.shown > target) {
        slug.shown--;
        counting = true;
      } else if (slug.shown < target) {
        slug.shown = target;
      }
    }
    if (!counting && state.phaseT > 10) {
      state.phase = 'deaths';
      state.phaseT = 0;
    }
  } else if (state.phase === 'deaths') {
    if (state.phaseT % DEATH_GAP === 0) {
      const dying = state.slugs.find((s) => s.alive && s.hp <= 0);
      if (dying) {
        dying.alive = false;
        state.events.push({ k: 'die', id: dying.id });
        explode(state, px(dying.x), px(dying.y), POP_DAMAGE, POP_CRATER, 50, 'pop');
      } else if (state.slugs.some((s) => s.alive && (s.mode !== 'stand' || Math.max(0, s.hp) !== s.shown)) || state.projs.length) {
        state.phase = 'settle';
        state.phaseT = 0;
        state.quiet = 0;
      } else {
        finishTurn(state);
      }
    }
  }
}

/** Seconds on the turn clock as shown: rounded up, so it reads 1 until the last tick. */
export const secondsLeft = (state: SlugsState) => Math.max(0, Math.ceil(state.timeLeft / 50));

export const teamHealth = (state: SlugsState, team: Team) => team.slugs.reduce((sum, id) => sum + Math.max(0, state.slugs[id].shown), 0);
