// Slugs: a turn-based artillery game. Teams of slugs on a side-on landscape
// that explosions carve away, over water that drowns them.
//
// The whole game is a pure function of the seed and the players' inputs, tick
// by tick, the way Swarm's is: integer arithmetic only, a seeded generator, and
// no Math.sin/cos (their last bits differ between browsers). Positions and
// speeds are fixed point, ONE to a pixel. The computer's inputs are worked out
// inside the tick from the state, so every client would give it the same ones.
//
// The physics numbers are the ones measured for the classic 2D artillery games
// on the Worms Knowledge Base (worms2d.info, "Physics Engine", "Fall Damage",
// "Worm Walking", "Detailed Weapon Settings"). Where that source had no value,
// the constant says the number is ours.

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

/** Landing faster than this hurts, by `((v - 8) * 50 + 18) / 18` hp, and ends the turn. */
export const FALL_SAFE = 8 * ONE;
export const FALL_COEF = 50;

export const TURN_TICKS = 45 * 50;
export const RETREAT_TICKS = 3 * 50;
export const ROUND_TICKS = 15 * 60 * 50;
export const READY_TICKS = 60;
export const START_HP = 100;
/** Sudden death: every slug to 1 hp, then the water rises this much each turn. */
export const WATER_RISE = 20;
export const WATER_START = H - 70;
/** Ticks the board must be still before the turn's damage is counted. Ours. */
const QUIET_TICKS = 25;
/** Longest a turn waits for the board to settle. Ours. */
const SETTLE_MOST = 30 * 50;
const DEATH_GAP = 40;

/**
 * Knockback, in fixed-point speed per hp of damage dealt. The source gives no
 * formula; this throws a slug hit squarely by a 50 hp blast about 7 px/frame.
 */
const KNOCK_PER_HP = 9800;

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
const isqrt = (n: number) => Math.floor(Math.sqrt(n));

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

export type WeaponId = 'bazooka' | 'grenade' | 'cluster' | 'shotgun' | 'dynamite' | 'airstrike';
export const WEAPONS: readonly WeaponId[] = ['bazooka', 'grenade', 'cluster', 'shotgun', 'dynamite', 'airstrike'];

interface WeaponSpec {
  name: string;
  /** How it is set off: charged with the power bar, a straight shot, dropped at the feet, or a point picked on the map. */
  use: 'charge' | 'shot' | 'drop' | 'target';
  /** Starting stock per team; -1 is unlimited. */
  ammo: number;
  fuse: boolean;
  wind: boolean;
  damage: number;
  crater: number;
  /** Percent of the crater radius the knockback centre is moved down, so a slug hit from above still flies up. */
  bias: number;
  retreat: number;
}

export const WEAPON: Record<WeaponId, WeaponSpec> = {
  bazooka: { name: 'Bazooka', use: 'charge', ammo: -1, fuse: false, wind: true, damage: 50, crater: 48, bias: 0, retreat: RETREAT_TICKS },
  grenade: { name: 'Grenade', use: 'charge', ammo: -1, fuse: true, wind: false, damage: 50, crater: 48, bias: 10, retreat: RETREAT_TICKS },
  cluster: { name: 'Cluster bomb', use: 'charge', ammo: 5, fuse: true, wind: false, damage: 26, crater: 23, bias: 10, retreat: RETREAT_TICKS },
  shotgun: { name: 'Shotgun', use: 'shot', ammo: -1, fuse: false, wind: false, damage: 25, crater: 12, bias: 5, retreat: RETREAT_TICKS },
  dynamite: { name: 'Dynamite', use: 'drop', ammo: 1, fuse: false, wind: false, damage: 75, crater: 73, bias: 50, retreat: 5 * 50 },
  airstrike: { name: 'Air strike', use: 'target', ammo: 1, fuse: false, wind: false, damage: 30, crater: 30, bias: 0, retreat: RETREAT_TICKS },
};

const CLUSTER_BITS = 5;
const SHOTGUN_SHOTS = 2;
const SHOT_RANGE = 900;
const DYNAMITE_FUSE = 5 * 50;
const STRIKE_MISSILES = 5;
const STRIKE_GAP = 26;
const STRIKE_SPEED = 7 * ONE;
/** A grenade keeps 96% of its speed along the ground, and 60% (high bounce) or 30% (low) of it off the ground. */
const BOUNCE_ALONG = 62915;
const BOUNCE_HIGH = 39322;
const BOUNCE_LOW = 19661;
/** A thrown thing this slow, with ground under it, stops. Ours. */
const REST_SPEED = Math.trunc(0.6 * ONE);
/** Slug death: a small burst of up to 25 hp. */
const POP_DAMAGE = 25;
const POP_CRATER = 20;

export type ProjKind = 'shell' | 'grenade' | 'cluster' | 'bit' | 'dynamite' | 'missile';

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
}

export interface Slug {
  id: number;
  team: number;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  mode: 'stand' | 'air' | 'slide';
  /** Thrown by a blast: its next landing does not hurt. */
  blown: boolean;
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

export type Phase = 'ready' | 'turn' | 'retreat' | 'settle' | 'tally' | 'deaths' | 'over';

export type SlugEvent =
  | { k: 'boom'; x: number; y: number; r: number }
  | { k: 'fire'; w: WeaponId; x: number; y: number }
  | { k: 'shot'; x0: number; y0: number; x1: number; y1: number }
  | { k: 'splash'; x: number; big: boolean }
  | { k: 'bounce'; x: number; y: number }
  | { k: 'hurt'; id: number; dmg: number }
  | { k: 'fall'; id: number; dmg: number }
  | { k: 'die'; id: number }
  | { k: 'drown'; id: number }
  | { k: 'turn'; id: number }
  | { k: 'jump'; id: number }
  | { k: 'sudden' }
  | { k: 'rise' };

export interface CpuPlan {
  weapon: WeaponId;
  facing: 1 | -1;
  aim: number;
  power: number;
  fuse: number;
  tx: number;
  ty: number;
}

export interface SlugsState {
  seed: number;
  rng: number;
  tick: number;
  terrain: Uint8Array;
  water: number;
  wind: number;
  teams: Team[];
  slugs: Slug[];
  projs: Proj[];
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
  events: SlugEvent[];
}

export const KEY = { left: 1, right: 2, up: 4, down: 8, fire: 16, fine: 32 } as const;

export type Act =
  | { t: 'jump' }
  | { t: 'flip' }
  | { t: 'weapon'; w: WeaponId }
  | { t: 'fuse'; n: number }
  | { t: 'bounce' }
  | { t: 'target'; x: number; y: number }
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

export const solidAt = (t: Uint8Array, x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && t[y * W + x] === 1;

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

export function carve(t: Uint8Array, cx: number, cy: number, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= H) continue;
    const span = isqrt(r * r - dy * dy);
    const x0 = Math.max(0, cx - span);
    const x1 = Math.min(W - 1, cx + span);
    if (x1 >= x0) t.fill(0, y * W + x0, y * W + x1 + 1);
  }
}

// --- Slugs on the ground ---

export function fits(t: Uint8Array, x: number, y: number): boolean {
  for (let dy = -SLUG_HALF_H; dy < SLUG_HALF_H; dy++) {
    for (let dx = -SLUG_HALF_W; dx <= SLUG_HALF_W; dx++) {
      if (solidAt(t, x + dx, y + dy)) return false;
    }
  }
  return true;
}

const grounded = (t: Uint8Array, x: number, y: number) => !fits(t, x, y + 1);

/** Spread the slugs over the land, interleaving the teams, at least 60 px apart and clear of the water. */
function placeSlugs(state: SlugsState): void {
  const spots: { x: number; y: number }[] = [];
  const g = state;
  for (let tries = 0; tries < 4000 && spots.length < state.slugs.length; tries++) {
    const x = 30 + randInt(g, W - 60);
    let found = -1;
    for (let y = 10; y < state.water - 20; y++) {
      if (fits(state.terrain, x, y) && grounded(state.terrain, x, y)) {
        found = y;
        break;
      }
    }
    if (found < 0 || spots.some((s) => Math.abs(s.x - x) < 60 && Math.abs(s.y - found) < 40)) continue;
    spots.push({ x, y: found });
  }
  // A map with too few spots still has to seat everyone: stack the rest on the spots found.
  state.slugs.forEach((slug, i) => {
    const spot = spots[i % Math.max(1, spots.length)] ?? { x: W / 2, y: 0 };
    slug.x = spot.x * ONE;
    slug.y = spot.y * ONE;
    slug.facing = spot.x < W / 2 ? 1 : -1;
  });
}

export function newGame(seed: number, setups: TeamSetup[], perTeam: number): SlugsState {
  const state: SlugsState = {
    seed,
    rng: (seed ^ 0x9e3779b9) >>> 0,
    tick: 0,
    terrain: buildTerrain(seed),
    water: WATER_START,
    wind: 0,
    teams: [],
    slugs: [],
    projs: [],
    nextId: 1,
    phase: 'ready',
    phaseT: 0,
    timeLeft: TURN_TICKS,
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
      ammo: Object.fromEntries(WEAPONS.map((w) => [w, WEAPON[w].ammo])) as Record<WeaponId, number>,
    };
    for (let k = 0; k < perTeam; k++) {
      const id = state.slugs.length;
      team.slugs.push(id);
      state.slugs.push({
        id, team: ti, name: names[id % names.length], x: 0, y: 0, vx: 0, vy: 0, mode: 'stand', blown: false,
        facing: 1, aim: 0, hp: START_HP, shown: START_HP, alive: true, drowned: false, walk: 0, still: 0,
      });
    }
    state.teams.push(team);
  });
  placeSlugs(state);
  state.activeTeam = randInt(state, state.teams.length);
  beginTurn(state, state.activeTeam);
  return state;
}

// --- Turns ---

function rollWind(state: SlugsState): void {
  const slug = state.slugs[state.active];
  let wind = randInt(state, WIND_MOST * 2 + 1) - WIND_MOST;
  // Leans toward the middle of the map from where the slug stands (ours: the source gives the lean, not its size).
  if (randInt(state, 100) < 15) wind += px(slug.x) < W / 2 ? 2 : -2;
  if (wind === state.wind) wind = randInt(state, WIND_MOST * 2 + 1) - WIND_MOST;
  state.wind = Math.max(-WIND_MOST, Math.min(WIND_MOST, wind));
}

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
  state.timeLeft = TURN_TICKS;
  state.charging = false;
  state.power = 0;
  state.shotsLeft = SHOTGUN_SHOTS;
  state.plan = null;
  const team = state.teams[teamIndex];
  if (team.ammo[state.weapon] === 0) state.weapon = 'bazooka';
  state.events.push({ k: 'turn', id: state.active });
}

function endTurn(state: SlugsState): void {
  if (state.phase !== 'turn' && state.phase !== 'retreat' && state.phase !== 'ready') return;
  state.phase = 'settle';
  state.phaseT = 0;
  state.quiet = 0;
  state.charging = false;
  state.power = 0;
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
  if (!state.sudden && state.roundT >= ROUND_TICKS) {
    state.sudden = true;
    state.slugs.forEach((slug) => {
      if (slug.alive) slug.hp = slug.shown = 1;
    });
    state.events.push({ k: 'sudden' });
  } else if (state.sudden) {
    state.water -= WATER_RISE;
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
  if (slug.id === state.active) endTurn(state);
}

/** Distance in px from a point to the nearest point of a slug's body. */
function distToSlug(slug: Slug, x: number, y: number): number {
  const sx = px(slug.x);
  const sy = px(slug.y);
  const dx = Math.max(0, Math.abs(x - sx) - SLUG_HALF_W);
  const dy = Math.max(0, Math.abs(y - sy) - SLUG_HALF_H);
  return isqrt(dx * dx + dy * dy);
}

/**
 * Damage falls off in a straight line from full at the centre to none at the
 * crater's edge. The source does not give the curve; linear is ours.
 */
export function blastDamage(damage: number, crater: number, dist: number): number {
  if (dist >= crater) return 0;
  return Math.ceil((damage * (crater - dist)) / crater);
}

export function explode(state: SlugsState, x: number, y: number, damage: number, crater: number, bias: number): void {
  carve(state.terrain, x, y, crater);
  state.events.push({ k: 'boom', x, y, r: crater });
  const kx = x;
  const ky = y + Math.trunc((crater * bias) / 100);
  for (const slug of state.slugs) {
    if (!slug.alive) continue;
    const dmg = blastDamage(damage, crater, distToSlug(slug, x, y));
    if (dmg <= 0) continue;
    const dx = px(slug.x) - kx;
    const dy = px(slug.y) - ky;
    const len = isqrt(dx * dx + dy * dy);
    const push = Math.min(SPEED_CAP, dmg * KNOCK_PER_HP);
    if (len === 0) {
      slug.vy -= push;
    } else {
      slug.vx += Math.trunc((dx * push) / len);
      slug.vy += Math.trunc((dy * push) / len);
    }
    slug.mode = 'air';
    slug.blown = true;
    hurt(state, slug, dmg);
  }
  for (const p of state.projs) {
    if (p.fuse < 0) continue;
    const dx = px(p.x) - kx;
    const dy = px(p.y) - ky;
    const len = isqrt(dx * dx + dy * dy);
    if (len >= crater) continue;
    const push = Math.trunc(((crater - len) * damage * KNOCK_PER_HP) / crater);
    p.vx += len === 0 ? 0 : Math.trunc((dx * push) / len);
    p.vy += len === 0 ? -push : Math.trunc((dy * push) / len);
    p.rest = false;
  }
}

// --- Moving things ---

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

const projHitsLand = (t: Uint8Array, x: number, y: number) =>
  solidAt(t, x, y) || solidAt(t, x - 2, y) || solidAt(t, x + 2, y) || solidAt(t, x, y - 2) || solidAt(t, x, y + 2);

function slugHitBy(state: SlugsState, p: Proj, x: number, y: number): Slug | undefined {
  return state.slugs.find(
    (s) => s.alive && (p.free || s.id !== p.owner) && Math.abs(px(s.x) - x) <= SLUG_HALF_W + 2 && Math.abs(px(s.y) - y) <= SLUG_HALF_H + 2
  );
}

export type ProjFate = 'flying' | 'boom' | 'gone';

/**
 * One tick of one projectile. Used both by the game and by the computer
 * looking ahead, so `live` says whether it may touch the state's events.
 */
export function stepProj(state: SlugsState, p: Proj, live: boolean): ProjFate {
  const t = state.terrain;
  if (p.fuse > 0) p.fuse--;
  if (p.fuse === 0) return 'boom';
  if (p.rest) {
    if (projHitsLand(t, px(p.x), px(p.y) + 1)) return 'flying';
    p.rest = false;
  }
  p.vy += GRAVITY;
  if (p.wind) p.vx += state.wind * WIND_STEP;
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
    if (!land && !target) {
      p.x = nx;
      p.y = ny;
      continue;
    }
    if (p.fuse < 0) {
      p.x = nx;
      p.y = ny;
      return 'boom';
    }
    // Something with a fuse bounces off what it met, from where it was.
    const n = target ? { nx: px(p.x) - px(target.x), ny: px(p.y) - px(target.y) } : normalAt(t, px(p.x), px(p.y));
    const nn = n.nx * n.nx + n.ny * n.ny || 1;
    const vn = p.vx * n.nx + p.vy * n.ny;
    if (vn < 0) {
      const nvx = Math.trunc((vn * n.nx) / nn);
      const nvy = Math.trunc((vn * n.ny) / nn);
      const tvx = p.vx - nvx;
      const tvy = p.vy - nvy;
      p.vx = Math.trunc((tvx * BOUNCE_ALONG) / ONE) - Math.trunc((nvx * p.bounce) / ONE);
      p.vy = Math.trunc((tvy * BOUNCE_ALONG) / ONE) - Math.trunc((nvy * p.bounce) / ONE);
      if (live && Math.abs(vn) / (isqrt(nn) || 1) > ONE) state.events.push({ k: 'bounce', x: px(p.x), y: px(p.y) });
    }
    if (Math.abs(p.vx) < REST_SPEED && Math.abs(p.vy) < REST_SPEED && projHitsLand(t, px(p.x), px(p.y) + 3)) {
      p.vx = p.vy = 0;
      p.rest = true;
    }
    return 'flying';
  }
  return 'flying';
}

function goOff(state: SlugsState, p: Proj): void {
  explode(state, px(p.x), px(p.y), p.damage, p.crater, p.bias);
  if (p.kind === 'cluster') {
    for (let i = 0; i < CLUSTER_BITS; i++) {
      const vx = (randInt(state, 9) - 4) * Math.trunc(ONE * 0.9);
      const vy = -(3 * ONE + randInt(state, 3 * ONE));
      state.projs.push(newProj(state, 'bit', px(p.x), px(p.y) - 4, vx, vy, p.owner, { fuse: -1, damage: 26, crater: 23, bias: 10 }));
    }
  }
}

function newProj(
  state: SlugsState, kind: ProjKind, x: number, y: number, vx: number, vy: number, owner: number,
  o: { fuse: number; damage: number; crater: number; bias: number; wind?: boolean; bounce?: number }
): Proj {
  return {
    id: state.nextId++, kind, x: x * ONE, y: y * ONE, vx, vy, owner, free: kind === 'bit' || kind === 'missile',
    fuse: o.fuse, damage: o.damage, crater: o.crater, bias: o.bias, wind: o.wind ?? false, bounce: o.bounce ?? 0, rest: false,
  };
}

function stepSlug(state: SlugsState, slug: Slug): void {
  const t = state.terrain;
  if (!slug.alive) return;
  slug.still++;
  if (px(slug.y) + SLUG_HALF_H > state.water) {
    drown(state, slug);
    return;
  }
  if (slug.mode === 'stand') {
    if (!grounded(t, px(slug.x), px(slug.y))) {
      slug.mode = 'air';
      slug.vx = 0;
      slug.vy = 0;
    }
    return;
  }
  if (slug.mode === 'slide') {
    slug.vx = Math.trunc((slug.vx * FRICTION) / ONE);
    if (Math.abs(slug.vx) < ONE / 2) {
      slug.vx = 0;
      slug.mode = 'stand';
      return;
    }
    const dir = slug.vx > 0 ? 1 : -1;
    const moves = Math.max(1, Math.ceil(Math.abs(slug.vx) / ONE));
    for (let i = 0; i < moves; i++) {
      if (!stepAlong(state, slug, dir, 1)) {
        slug.vx = 0;
        slug.mode = 'stand';
        return;
      }
      if (slug.mode !== 'slide') return;
    }
    return;
  }
  // In the air.
  slug.still = 0;
  slug.vy = Math.min(SPEED_CAP, slug.vy + GRAVITY);
  slug.vx = Math.max(-SPEED_CAP, Math.min(SPEED_CAP, slug.vx));
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(slug.vx), Math.abs(slug.vy)) / ONE));
  const x0 = slug.x;
  const y0 = slug.y;
  for (let i = 1; i <= steps; i++) {
    const nx = x0 + Math.trunc((slug.vx * i) / steps);
    const ny = y0 + Math.trunc((slug.vy * i) / steps);
    if (fits(t, px(nx), px(ny))) {
      slug.x = nx;
      slug.y = ny;
      continue;
    }
    const n = normalAt(t, px(nx), px(ny) + (slug.vy > 0 ? SLUG_HALF_H : -SLUG_HALF_H));
    const nn = n.nx * n.nx + n.ny * n.ny;
    // Land on anything that faces mostly upward.
    if (n.ny < 0 && n.ny * n.ny * 2 >= nn) {
      const impact = slug.vy;
      if (!slug.blown && impact > FALL_SAFE) {
        const dmg = Math.trunc(((impact - FALL_SAFE) * FALL_COEF + 18 * ONE) / (18 * ONE));
        state.events.push({ k: 'fall', id: slug.id, dmg });
        hurt(state, slug, dmg);
        if (slug.id === state.active) endTurn(state);
      }
      slug.blown = false;
      slug.vy = 0;
      if (Math.abs(slug.vx) > ONE) {
        slug.mode = 'slide';
      } else {
        slug.vx = 0;
        slug.mode = 'stand';
      }
      settleDown(state, slug);
      return;
    }
    // A wall or a roof: lose the speed into it.
    const vn = slug.vx * n.nx + slug.vy * n.ny;
    if (vn < 0 && nn > 0) {
      slug.vx -= Math.trunc((vn * n.nx * 13) / (nn * 10));
      slug.vy -= Math.trunc((vn * n.ny * 13) / (nn * 10));
    } else {
      slug.vx = 0;
      slug.vy = Math.max(0, slug.vy);
    }
    return;
  }
}

/** Snap a landed slug down onto the ground under it. */
function settleDown(state: SlugsState, slug: Slug): void {
  for (let k = 0; k < STEP_PX && fits(state.terrain, px(slug.x), px(slug.y) + 1); k++) slug.y = (px(slug.y) + 1) * ONE;
  slug.y = px(slug.y) * ONE;
}

/**
 * Move a standing slug one pixel along the ground, climbing or dropping up to
 * `climb` px. False if the way is blocked. Walks off a ledge into the air.
 */
function stepAlong(state: SlugsState, slug: Slug, dir: number, climb: number): boolean {
  const t = state.terrain;
  const x = px(slug.x) + dir;
  const y = px(slug.y);
  if (x < -40 || x > W + 40) return false;
  for (let up = 0; up <= climb; up++) {
    if (!fits(t, x, y - up)) continue;
    let ny = y - up;
    let down = 0;
    while (down <= STEP_PX && fits(t, x, ny + 1)) {
      ny++;
      down++;
    }
    slug.x = x * ONE + (slug.x - px(slug.x) * ONE);
    if (down > STEP_PX) {
      slug.y = (ny - down + STEP_PX) * ONE;
      slug.mode = 'air';
      slug.vx = dir * Math.trunc(ONE / 2);
      slug.vy = 0;
    } else {
      slug.y = ny * ONE;
    }
    return true;
  }
  return false;
}

// --- The active slug's controls ---

function fire(state: SlugsState, slug: Slug): void {
  const team = state.teams[slug.team];
  const w = state.weapon;
  const spec = WEAPON[w];
  const sx = px(slug.x);
  const sy = px(slug.y) - 2;
  state.events.push({ k: 'fire', w, x: sx, y: sy });
  if (w === 'shotgun') {
    shoot(state, slug);
    state.shotsLeft--;
    if (state.shotsLeft > 0) return;
  } else if (w === 'dynamite') {
    state.projs.push(newProj(state, 'dynamite', sx + slug.facing * 6, sy, slug.facing * Math.trunc(ONE / 2), -ONE, slug.id, {
      fuse: DYNAMITE_FUSE, damage: spec.damage, crater: spec.crater, bias: spec.bias, bounce: BOUNCE_LOW,
    }));
  } else {
    const speed = Math.trunc((FULL_SPEED * Math.max(1, state.power)) / CHARGE_TICKS);
    const { vx, vy } = aimVector(slug.facing, slug.aim, speed);
    const ax = sx + Math.trunc((slug.facing * cosDeg(slug.aim) * 8) / ONE);
    const ay = sy - Math.trunc((sinDeg(slug.aim) * 8) / ONE);
    const kind: ProjKind = w === 'bazooka' ? 'shell' : w === 'grenade' ? 'grenade' : 'cluster';
    state.projs.push(newProj(state, kind, ax, ay, vx, vy, slug.id, {
      fuse: spec.fuse ? state.fuse * 50 : -1,
      damage: spec.damage,
      crater: spec.crater,
      bias: spec.bias,
      wind: spec.wind,
      bounce: state.bounceHigh ? BOUNCE_HIGH : BOUNCE_LOW,
    }));
  }
  if (team.ammo[w] > 0) team.ammo[w]--;
  state.charging = false;
  state.power = 0;
  state.phase = 'retreat';
  state.phaseT = 0;
  state.timeLeft = spec.retreat;
}

function shoot(state: SlugsState, slug: Slug): void {
  const t = state.terrain;
  const x0 = px(slug.x);
  const y0 = px(slug.y) - 2;
  const dx = slug.facing * cosDeg(slug.aim);
  const dy = -sinDeg(slug.aim);
  let hitX = x0;
  let hitY = y0;
  for (let d = 6; d < SHOT_RANGE; d++) {
    const x = x0 + Math.trunc((dx * d) / ONE);
    const y = y0 + Math.trunc((dy * d) / ONE);
    hitX = x;
    hitY = y;
    if (y > state.water) {
      state.events.push({ k: 'shot', x0, y0, x1: x, y1: y }, { k: 'splash', x, big: false });
      return;
    }
    const target = state.slugs.find(
      (s) => s.alive && s.id !== slug.id && Math.abs(px(s.x) - x) <= SLUG_HALF_W && Math.abs(px(s.y) - y) <= SLUG_HALF_H
    );
    if (target || solidAt(t, x, y)) {
      state.events.push({ k: 'shot', x0, y0, x1: x, y1: y });
      explode(state, x, y, WEAPON.shotgun.damage, WEAPON.shotgun.crater, WEAPON.shotgun.bias);
      return;
    }
  }
  state.events.push({ k: 'shot', x0, y0, x1: hitX, y1: hitY });
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
    state.projs.push(newProj(state, 'missile', startX + offset, -60 - i * 4, dir * STRIKE_SPEED, STRIKE_SPEED, slug.id, {
      fuse: -1, damage: WEAPON.airstrike.damage, crater: WEAPON.airstrike.crater, bias: WEAPON.airstrike.bias,
    }));
  }
  state.events.push({ k: 'fire', w: 'airstrike', x: tx, y: ty });
  const team = state.teams[slug.team];
  if (team.ammo.airstrike > 0) team.ammo.airstrike--;
  state.phase = 'retreat';
  state.phaseT = 0;
  state.timeLeft = WEAPON.airstrike.retreat;
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
    if (act.t === 'weapon' && canFire && !state.charging && state.shotsLeft === SHOTGUN_SHOTS && team.ammo[act.w] !== 0) state.weapon = act.w;
    if (act.t === 'fuse' && act.n >= 1 && act.n <= 5) state.fuse = act.n;
    if (act.t === 'bounce') state.bounceHigh = !state.bounceHigh;
    if (act.t === 'target' && canFire && state.weapon === 'airstrike' && team.ammo.airstrike !== 0) {
      strike(state, slug, Math.max(0, Math.min(W - 1, Math.trunc(act.x))), Math.max(0, Math.min(state.water, Math.trunc(act.y))));
      return;
    }
    if ((act.t === 'jump' || act.t === 'flip') && slug.mode === 'stand' && !state.charging) {
      const v = act.t === 'jump' ? JUMP : FLIP;
      slug.vx = slug.facing * v.vx;
      slug.vy = v.vy;
      slug.mode = 'air';
      slug.still = 0;
      state.events.push({ k: 'jump', id: slug.id });
      return;
    }
  }

  // Aim: a degree a tick, or one every other tick held fine.
  const aimStep = keys & KEY.fine ? (state.tick % 2 === 0 ? 1 : 0) : 1;
  if (keys & KEY.up) slug.aim = Math.min(90, slug.aim + aimStep);
  if (keys & KEY.down) slug.aim = Math.max(-90, slug.aim - aimStep);

  const spec = WEAPON[state.weapon];
  if (canFire && spec.use !== 'target') {
    if (spec.use === 'charge') {
      if (pressed & KEY.fire && slug.mode === 'stand') {
        state.charging = true;
        state.power = 0;
      }
      if (state.charging) {
        if (keys & KEY.fire) state.power++;
        if (!(keys & KEY.fire) || state.power >= CHARGE_TICKS) fire(state, slug);
        return;
      }
    } else if (pressed & KEY.fire && slug.mode === 'stand') {
      fire(state, slug);
      return;
    }
  }

  // Walk. Turning round takes a tick; the shotgun's second barrel keeps you where you are.
  const dir = keys & KEY.left ? -1 : keys & KEY.right ? 1 : 0;
  if (dir === 0 || slug.mode !== 'stand' || state.charging || state.shotsLeft < SHOTGUN_SHOTS) {
    slug.walk = 0;
    return;
  }
  if (dir !== slug.facing) {
    slug.facing = dir;
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
    if (!stepAlong(state, slug, dir, STEP_PX)) {
      slug.x = px(slug.x) * ONE;
      break;
    }
    if (slug.mode !== 'stand') break;
  }
}

// --- The computer ---

const AIM_ERROR = [0, 8, 5, 3, 1, 0];
const POWER_ERROR = [0, 9, 6, 3, 1, 0];
const THINK_TICKS = 40;

interface Landing {
  x: number;
  y: number;
}

/** Fly a shot through the current land without changing anything, and say where it goes off. */
export function predict(state: SlugsState, weapon: WeaponId, slug: Slug, facing: 1 | -1, aim: number, power: number, fuse: number): Landing | null {
  const spec = WEAPON[weapon];
  const speed = Math.trunc((FULL_SPEED * Math.max(1, power)) / CHARGE_TICKS);
  const { vx, vy } = aimVector(facing, aim, speed);
  const sx = px(slug.x) + Math.trunc((facing * cosDeg(aim) * 8) / ONE);
  const sy = px(slug.y) - 2 - Math.trunc((sinDeg(aim) * 8) / ONE);
  const p = newProj(state, 'shell', sx, sy, vx, vy, slug.id, {
    fuse: spec.fuse ? fuse * 50 : -1, damage: spec.damage, crater: spec.crater, bias: spec.bias, wind: spec.wind, bounce: BOUNCE_LOW,
  });
  for (let i = 0; i < 600; i++) {
    const fate = stepProj(state, p, false);
    if (fate === 'boom') return { x: px(p.x), y: px(p.y) };
    if (fate === 'gone') return null;
  }
  return { x: px(p.x), y: px(p.y) };
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

function makePlan(state: SlugsState, me: Slug, level: number): CpuPlan {
  const team = state.teams[me.team];
  let best: CpuPlan | null = null;
  let bestScore = 0;
  const tryWeapon = (weapon: WeaponId, fuses: number[]) => {
    if (team.ammo[weapon] === 0) return;
    const spec = WEAPON[weapon];
    for (const facing of [1, -1] as const) {
      for (let aim = -20; aim <= 85; aim += 3) {
        for (let power = 12; power <= CHARGE_TICKS; power += 3) {
          for (const fuse of fuses) {
            const at = predict(state, weapon, me, facing, aim, power, fuse);
            if (!at) continue;
            const score = scoreBlast(state, me, at, spec.damage, spec.crater);
            if (score > bestScore) {
              bestScore = score;
              best = { weapon, facing, aim, power, fuse, tx: at.x, ty: at.y };
            }
          }
        }
      }
    }
  };
  tryWeapon('bazooka', [3]);
  tryWeapon('grenade', [2, 3]);
  if (best === null) {
    // Nothing reaches anyone from here: lob a shell toward the nearest enemy.
    const enemy = state.slugs.filter((s) => s.alive && s.team !== me.team).sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x))[0];
    const facing: 1 | -1 = enemy && enemy.x < me.x ? -1 : 1;
    best = { weapon: 'bazooka', facing, aim: 45, power: CHARGE_TICKS, fuse: 3, tx: 0, ty: 0 };
  }
  const plan: CpuPlan = best;
  const aimErr = AIM_ERROR[level];
  const powErr = POWER_ERROR[level];
  if (aimErr) plan.aim = Math.max(-90, Math.min(90, plan.aim + randInt(state, aimErr * 2 + 1) - aimErr));
  if (powErr) plan.power = Math.max(4, Math.min(CHARGE_TICKS, plan.power + randInt(state, powErr * 2 + 1) - powErr));
  return plan;
}

function cpuInput(state: SlugsState, level: number): Input {
  const me = state.slugs[state.active];
  if (state.phase !== 'turn' || !me || me.mode !== 'stand') return { keys: 0 };
  if (!state.plan) state.plan = makePlan(state, me, level);
  const plan = state.plan;
  if (state.phaseT < THINK_TICKS) return { keys: 0 };
  if (state.weapon !== plan.weapon) return { keys: 0, act: { t: 'weapon', w: plan.weapon } };
  if (WEAPON[plan.weapon].fuse && state.fuse !== plan.fuse) return { keys: 0, act: { t: 'fuse', n: plan.fuse } };
  if (me.facing !== plan.facing) return { keys: plan.facing < 0 ? KEY.left : KEY.right };
  if (me.aim < plan.aim) return { keys: KEY.up };
  if (me.aim > plan.aim) return { keys: KEY.down };
  if (state.charging && state.power >= plan.power) return { keys: 0 };
  return { keys: KEY.fire };
}

// --- The tick ---

export const isComputer = (team: Team) => team.control !== 'human';

export function advance(state: SlugsState, input: Input): void {
  state.events = [];
  state.tick++;
  state.phaseT++;
  const team = state.teams[state.activeTeam];

  if (state.phase === 'ready' && state.phaseT >= READY_TICKS) {
    state.phase = 'turn';
    state.phaseT = 0;
  }
  if (state.phase === 'turn' || state.phase === 'retreat') {
    const given = isComputer(team) ? cpuInput(state, team.control as number) : input;
    control(state, given);
    if (!state.charging) {
      state.timeLeft--;
      if (state.phase === 'turn') state.roundT++;
    }
    if (state.timeLeft <= 0) endTurn(state);
  }

  for (const slug of state.slugs) stepSlug(state, slug);

  const flying = state.projs;
  state.projs = [];
  for (const p of flying) {
    const fate = stepProj(state, p, true);
    if (fate === 'flying') state.projs.push(p);
    else if (fate === 'boom') goOff(state, p);
  }

  if (state.phase === 'settle') {
    const busy = state.projs.length > 0 || state.slugs.some((s) => s.alive && s.mode !== 'stand');
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
        explode(state, px(dying.x), px(dying.y), POP_DAMAGE, POP_CRATER, 50);
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
