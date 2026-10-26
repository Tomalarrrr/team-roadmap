// @vitest-environment node
/// <reference types="node" />
// A red team for Swarm. It plays games set up every way the lobby allows, with
// seats that give every kind of order a person can and some no client ever
// would, and holds every client's game to one played straight through.
//
// What has to hold, whatever the seats do: every client that has run a tick
// for good has the same state there, a state is only ever whole numbers in
// their ranges, and copying a state gives a game that runs the same and
// leaves the original alone.
//
// The modes, starts, twists, maps, sizes and kinds of order are read from the
// game's own lists, so whatever is added to them is played here without a line
// changing. `SWARM_FUZZ=long` plays every set of twists with every mode and
// start, and plays games to their clock. A failure ends with the game's setup
// and every seat's orders: SWARM_FUZZ_REPLAY='<that JSON>' plays it again.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CLASSIC,
  CLOSED_FOREVER,
  LUCK_DEN,
  MAP_IDS,
  MAX_ARMY_LEVEL,
  MAX_HUT_LEVEL,
  MODE_IDS,
  SEATS,
  SIZE_IDS,
  START_IDS,
  TWISTS,
  WALLS_MOST,
  WORLDS,
  advance,
  buildMap,
  centreOf,
  cloneState,
  computerOf,
  decodeOrders,
  encodeOrders,
  mulberry32,
  newState,
  pathLength,
  pathOf,
  rulesOf,
  sidesOf,
  step,
  twistLetters,
  type Computer,
  type MapId,
  type ModeId,
  type Nest,
  type Order,
  type OrderKind,
  type Owner,
  type Rules,
  type Seat,
  type SizeId,
  type StartId,
  type SwarmMap,
  type SwarmMatch,
  type SwarmSeatState,
  type SwarmState,
  type Twist,
} from '../swarmGameLogic';
import { newLockstep, orderTick, sending, settle, sound, type Lockstep, type SeatWrite } from '../components/swarm/swarmSync';

const LONG = process.env.SWARM_FUZZ === 'long';
const REPLAY = process.env.SWARM_FUZZ_REPLAY;
const BASE_SEED = Number(process.env.SWARM_FUZZ_SEED ?? 1);
if (!Number.isSafeInteger(BASE_SEED)) throw new Error(`SWARM_FUZZ_SEED is not a whole number: ${process.env.SWARM_FUZZ_SEED}`);

// The board's own, in SwarmGame.tsx, which does not export them.
const ORDER_DELAY = 4;
const REPORT_EVERY = 4;

// The orders a seat may store are what the database rules say, read from them
// so that the two cannot drift apart here.
const DB = JSON.parse(readFileSync(resolve(process.cwd(), 'database.rules.json'), 'utf-8'));
const ORDERS_RULE: string = DB.rules.swarm.$code.s.$seat.orders['.validate'];
const ordersShape = /matches\(\/(.+)\/\)/.exec(ORDERS_RULE);
const ordersCap = /length <= (\d+)/.exec(ORDERS_RULE);
if (!ordersShape || !ordersCap) throw new Error(`The rule for a seat's orders has changed shape: ${ORDERS_RULE}`);
const ORDERS_SHAPE = new RegExp(ordersShape[1]);
const ORDERS_CAP = Number(ordersCap[1]);
/** One character of 0-9, a-z and A-Z per hut in an order: a hut past this cannot be named. */
const MOST_SITES = 62;
const LAST_TICK = 36 ** 4 - 1;

// Read back off the letters rather than listed, so a kind added later is
// fuzzed too. decodeOrders gives no kind for a letter it does not know.
const KIND_LIST = [...'abcdefghijklmnopqrstuvwxyz'].flatMap((letter) => decodeOrders(`1:${letter}00`)[0].kind ?? []);
const SENDS: readonly OrderKind[] = ['half', 'all'];
// Only the seat chosen to give up raises the white flag: anyone raising it at
// random would end most games before anything else was tried.
const OTHER_KINDS = KIND_LIST.filter((kind) => kind !== 'flag');

/**
 * What the lobby lets start: teams is two against two, and survival needs a
 * person to survive and a computer to send what comes.
 */
function lobbyAllows(mode: ModeId, sides: number, people: number): boolean {
  if (mode === 'teams') return sides === 4;
  if (mode === 'survival') return people >= 1 && people < sides;
  return true;
}

const pick = <T>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

interface Setup {
  /** The map's seed, and the seed of everything the harness throws. */
  seed: number;
  map: MapId;
  size: SizeId;
  people: Seat[];
  cpu: Seat[];
  mode: ModeId;
  start: StartId;
  twists: Twist[];
  nests: Partial<Record<Seat, Nest>>;
  /** A seat written straight to the room with no client: any text the rules let through. */
  rogue: Seat | null;
  /** A person who leaves at `leaveAt`, after which the computer plays the seat. */
  leaver: Seat | null;
  leaveAt: number;
  /** A person who raises the white flag from `flagAt` on, again and again, and keeps giving orders. */
  flagger: Seat | null;
  flagAt: number;
  /** The last tick played. */
  until: number;
}

interface Game {
  kind: 'lockstep' | 'solo';
  setup: Setup;
}

function matchOf(setup: Setup): SwarmMatch {
  const players = Object.fromEntries(
    setup.people.map((seat) => [seat, { sessionId: seat, name: seat.toUpperCase(), ...(setup.nests[seat] && { nest: setup.nests[seat] }) }])
  );
  return {
    status: 'playing',
    createdAt: 0,
    seed: setup.seed,
    players,
    game: 1,
    startAt: 0,
    map: setup.map,
    size: setup.size,
    cpu: setup.cpu.join(''),
    mode: setup.mode,
    start: setup.start,
    twists: twistLetters(setup.twists),
  };
}

const mapOf = (m: SwarmMatch): SwarmMap => buildMap(m.seed, m.map, sidesOf(m), m.size, rulesOf(m));

function setupOf(seed: number, map: MapId, size: SizeId, count: number, mode: ModeId, start: StartId, twists: Twist[], until: number): Setup | null {
  const rand = mulberry32(seed);
  const counts = [0, 1, 2, 3, 4].filter((people) => people <= count && lobbyAllows(mode, count, people));
  if (counts.length === 0) return null;
  // Now and then seats that are not the first ones, as when the lobby leaves a seat empty.
  const sides = rand() < 0.3 ? SEATS.filter(() => rand() < 0.5) : SEATS.slice(0, count);
  for (const seat of SEATS) if (sides.length < count && !sides.includes(seat)) sides.push(seat);
  while (sides.length > count) sides.splice(Math.floor(rand() * sides.length), 1);
  const shuffled = [...sides].sort(() => rand() - 0.5);
  const people = shuffled.slice(0, pick(rand, counts));
  const inOrder = (seats: Seat[]) => SEATS.filter((seat) => seats.includes(seat));
  const nests: Partial<Record<Seat, Nest>> = {};
  for (const seat of people) if (rand() < 0.5) nests[seat] = rand() < 0.5 ? 'big' : 'many';
  const rogue = people.length >= 2 && rand() < 0.4 ? pick(rand, people) : null;
  const honest = people.filter((seat) => seat !== rogue);
  const leaver = count >= 3 && honest.length > 0 && rand() < 0.4 ? pick(rand, honest) : null;
  const flagger = honest.length > 0 && rand() < 0.3 ? pick(rand, honest) : null;
  const end = Math.min(until, 9600);
  return {
    seed,
    map,
    size,
    people: inOrder(people),
    cpu: inOrder(sides.filter((seat) => !people.includes(seat))),
    mode,
    start,
    twists,
    nests,
    rogue,
    leaver,
    leaveAt: Math.floor(end * (0.1 + 0.7 * rand())),
    flagger,
    flagAt: Math.floor(end * (0.2 + 0.7 * rand())),
    until,
  };
}

/** Every set of twists, from none to all. */
const everySet = (): Twist[][] => Array.from({ length: 2 ** TWISTS.length }, (_, bits) => TWISTS.filter((_, at) => bits & (2 ** at)));

function gamesToPlay(): Game[] {
  if (REPLAY) return [JSON.parse(REPLAY) as Game];
  const rand = mulberry32(BASE_SEED);
  const layouts = MAP_IDS.flatMap((map) => SIZE_IDS.flatMap((size) => [2, 3, 4].map((count) => ({ map, size, count }))));
  const pairs = MODE_IDS.flatMap((mode) => START_IDS.map((start) => ({ mode, start })));
  const some = () => TWISTS.filter(() => rand() < 0.5);
  const shortly = () => 300 + Math.floor(rand() * 500);
  type RuleSet = { mode: ModeId; start: StartId; twists: Twist[] };
  // Each twist alone and every twist at once, with every mode and every start.
  const marked: RuleSet[] = [
    ...TWISTS.map((twist) => ({ ...pick(rand, pairs), twists: [twist] })),
    ...MODE_IDS.map((mode) => ({ mode, start: pick(rand, START_IDS), twists: TWISTS })),
    ...START_IDS.map((start) => ({ mode: pick(rand, MODE_IDS), start, twists: TWISTS })),
  ];
  const lockstepRules: RuleSet[] = LONG
    ? pairs.flatMap((pair) => [[], TWISTS, ...TWISTS.map((twist) => [twist])].map((twists) => ({ ...pair, twists })))
    : [...pairs.map((pair) => ({ ...pair, twists: some() })), ...marked];
  const soloRules: RuleSet[] = LONG
    ? pairs.flatMap((pair) => everySet().map((twists) => ({ ...pair, twists })))
    : [...pairs.map((pair) => ({ ...pair, twists: some() })), ...marked];

  const games: Game[] = [];
  const lay = (kind: Game['kind'], ruleSets: RuleSet[], shift: number, until: () => number) => {
    const total = Math.max(ruleSets.length, layouts.length);
    for (let at = 0; at < total; at++) {
      const { mode, start, twists } = ruleSets[at % ruleSets.length];
      // A layout the lobby will not start with these rules gives way to the next that it will.
      for (let next = 0; next < layouts.length; next++) {
        const { map, size, count } = layouts[(at + shift + next) % layouts.length];
        const setup = setupOf((BASE_SEED * 7919 + games.length * 104729) >>> 0, map, size, count, mode, start, twists, until());
        if (setup) {
          games.push({ kind, setup });
          break;
        }
      }
    }
  };
  lay('lockstep', lockstepRules, 0, LONG ? () => LAST_TICK : shortly);
  lay('solo', soloRules, Math.floor(layouts.length / 2), LONG ? () => 1000 : () => 400 + Math.floor(rand() * 600));
  return games;
}

const GAMES = gamesToPlay();

type Orders = Record<Seat, Order[]>;
type Seats = Partial<Record<Seat, SwarmSeatState>>;
const noneYet = (): Orders => ({ a: [], b: [], c: [], d: [] });

/** A state with what a step only reports left out: what cloneState gives, and what two clients can be held to. */
const strip = (state: SwarmState): SwarmState => ({ ...state, events: [], shots: [] });

/**
 * Throw at the first thing in a state that is not a whole number, a string, a
 * boolean, null, a plain object or an array without holes. Anything else does
 * not survive the trip between clients, or rounds differently on one of them.
 */
function wholeNumbersOnly(value: unknown, at: (string | number)[]): void {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) throw new Error(`${at.join('.')} is ${Object.is(value, -0) ? '-0' : value}`);
    return;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) throw new Error(`${at.join('.')} has a hole at ${i}`);
      at.push(i);
      wholeNumbersOnly(value[i], at);
      at.pop();
    }
    return;
  }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const key of Object.keys(value)) {
      at.push(key);
      wholeNumbersOnly((value as Record<string, unknown>)[key], at);
      at.pop();
    }
    return;
  }
  throw new Error(`${at.join('.')} is ${value === undefined ? 'undefined' : Object.prototype.toString.call(value)}`);
}

/** Throw when the copy holds an object of the original's: running one would change the other. */
function shareNothing(original: SwarmState, copy: SwarmState): void {
  const seen = new Set<object>();
  const gather = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return;
    seen.add(value);
    for (const inner of Object.values(value)) gather(inner);
  };
  gather(original);
  const look = (value: unknown, at: string) => {
    if (typeof value !== 'object' || value === null) return;
    if (seen.has(value)) throw new Error(`cloneState shares ${at} with the state it copied`);
    for (const [key, inner] of Object.entries(value)) look(inner, `${at}.${key}`);
  };
  look(copy, 'state');
}

/** Everything that has to be true of a state after any tick, shown or confirmed, on any board. */
function checkState(state: SwarmState, map: SwarmMap): void {
  const bad = (what: string): never => {
    throw new Error(`tick ${state.tick}: ${what}`);
  };
  wholeNumbersOnly(state, ['state']);
  const count = map.sites.length;
  if (count > MOST_SITES) bad(`${count} sites, and an order can only name ${MOST_SITES}`);
  if (state.huts.length !== count) bad(`${state.huts.length} huts on ${count} sites`);
  state.huts.forEach((hut, at) => {
    if (hut.owner !== null && !map.sides.includes(hut.owner)) bad(`hut ${at} held by ${hut.owner}, not a side`);
    if (hut.n < 0) bad(`hut ${at} holds ${hut.n}`);
    if (hut.level < 1 || hut.level > MAX_HUT_LEVEL) bad(`hut ${at} at level ${hut.level}`);
    if (hut.grow < 0) bad(`hut ${at} grows at ${hut.grow}`);
    for (const line of hut.out) {
      if (line.n < 1 || !map.links[at].includes(line.to) || line.dest < 0 || line.dest >= count) bad(`hut ${at} queues ${JSON.stringify(line)}`);
    }
  });
  let lastId = 0;
  for (const unit of state.units) {
    if (!map.sides.includes(unit.seat)) bad(`unit ${unit.id} of ${unit.seat}, not a side`);
    if (unit.id <= lastId || unit.id >= state.nextId) bad(`unit ${unit.id} out of order or ahead of nextId ${state.nextId}`);
    lastId = unit.id;
    const onBoard = (at: number) => at >= 0 && at < count;
    if (!onBoard(unit.from) || !onBoard(unit.to) || !onBoard(unit.dest) || !pathOf(map, unit.from, unit.to)) bad(`unit ${unit.id} on no path: ${JSON.stringify(unit)}`);
    if (unit.d < 0 || unit.d > pathLength(map, unit.from, unit.to)) bad(`unit ${unit.id} at ${unit.d} on a path ${pathLength(map, unit.from, unit.to)} long`);
    if (state.yielded.includes(unit.seat)) bad(`unit ${unit.id} of ${unit.seat}, who gave up`);
  }
  for (const seat of SEATS) {
    const { speed, strength, luck } = state.army[seat];
    if (speed < 0 || speed > MAX_ARMY_LEVEL || strength < 0 || strength > MAX_ARMY_LEVEL || luck < 0 || luck >= LUCK_DEN) bad(`army ${seat} is ${JSON.stringify(state.army[seat])}`);
  }
  if (state.tolls.length !== map.paths.length || state.tolls.some((toll) => toll < 0)) bad(`tolls ${state.tolls}`);
  if (state.closed.length !== map.paths.length || state.closed.some((until) => until < 0 || until > CLOSED_FOREVER)) bad(`closed ${state.closed}`);
  for (const wall of state.walls) {
    if (!map.rules.twists.includes('walls') || !map.paths[wall.path] || !map.sides.includes(wall.seat) || wall.hp < 1 || wall.hp > map.rules.tune.wallHp) bad(`wall ${JSON.stringify(wall)}`);
    if (state.walls.filter((one) => one.path === wall.path).length > 1) bad(`two walls on path ${wall.path}`);
    if (state.closed[wall.path] >= state.tick) bad(`wall on closed path ${wall.path}`);
  }
  for (const seat of SEATS) if (state.walls.filter((wall) => wall.seat === seat).length > WALLS_MOST) bad(`${seat} has more than ${WALLS_MOST} walls`);
  if (new Set(state.yielded).size !== state.yielded.length || state.yielded.some((seat) => !map.sides.includes(seat))) bad(`yielded ${state.yielded}`);
  for (const seat of state.yielded) if (state.huts.some((hut) => hut.owner === seat)) bad(`${seat} gave up and holds a hut`);
  if (state.winner !== null && state.winner !== 'draw' && !map.sides.includes(state.winner)) bad(`won by ${state.winner}, not a side`);
  const { mode, tune } = map.rules;
  const target = mode === 'domination' ? tune.domTarget : mode === 'raid' ? tune.raidTarget : 0;
  for (const seat of SEATS) {
    const points = state.points[seat];
    if (points < 0 || (target === 0 && points !== 0)) bad(`${seat} has ${points} points in ${mode}`);
    if (target > 0 && points >= target && state.winner === null) bad(`${seat} has ${points} of ${target} points and nobody has won`);
  }
  // No mode plays past the clock: one that does has to say here by how much.
  if (state.tick >= map.ticks && state.winner === null) bad(`the clock ran out at ${map.ticks} with nobody winning`);
}

/**
 * Run a game tick by tick with every check on every tick. Now and then the
 * state is copied and the copy run alongside on the same orders: it has to
 * stay the same game, and running it must not touch the original.
 */
function playChecked(
  map: SwarmMap,
  orders: Orders,
  cpu: Computer,
  until: number,
  rand: () => number,
  give?: (state: SwarmState) => void,
  seen?: (state: SwarmState) => void
): SwarmState {
  const state = newState(map);
  checkState(state, map);
  let twin: SwarmState | null = null;
  let winner = state.winner;
  while (state.tick < until && state.winner === null) {
    give?.(state);
    if (!twin && rand() < 0.03) {
      twin = cloneState(state);
      expect(twin, `cloneState at tick ${state.tick}`).toStrictEqual(strip(state));
      shareNothing(state, twin);
      const before = structuredClone(state);
      step(twin, map, orders, cpu);
      expect(state, `the original after its copy ran tick ${state.tick + 1}`).toStrictEqual(before);
    } else if (twin) step(twin, map, orders, cpu);
    step(state, map, orders, cpu);
    checkState(state, map);
    if (winner !== null && state.winner !== winner) throw new Error(`tick ${state.tick}: the winner changed from ${winner} to ${state.winner}`);
    winner = state.winner;
    if (twin) {
      expect(twin, `a copy run alongside, at tick ${state.tick}`).toStrictEqual(state);
      if (rand() < 0.1) twin = null;
    }
    if (rand() < 0.02) expect(JSON.parse(JSON.stringify(state)), `the state through JSON at tick ${state.tick}`).toStrictEqual(state);
    seen?.(state);
  }
  return state;
}

function farthest(map: SwarmMap, from: number): number {
  let best = from;
  map.sites.forEach((_, at) => {
    if (pathLength(map, from, at) > pathLength(map, from, best)) best = at;
  });
  return best;
}

/**
 * An order a person could give, or one no client lets them: from huts not
 * theirs or not on the board, to the hut itself, past the last hut, to the far
 * side of the board or the other homes.
 */
function fuzzOrder(rand: () => number, map: SwarmMap, state: SwarmState, seat: Seat, tick: number, flag: boolean): Order {
  const count = map.sites.length;
  const anyHut = () => Math.floor(rand() * count);
  const nowhere = () => (count < MOST_SITES ? count + Math.floor(rand() * (MOST_SITES - count)) : anyHut());
  const held = state.huts.flatMap((hut, at) => (hut.owner === seat ? [at] : []));
  const kind = flag ? 'flag' : rand() < 0.6 ? pick(rand, SENDS) : pick(rand, OTHER_KINDS);
  const r = rand();
  let from = r < 0.6 && held.length > 0 ? pick(rand, held) : r < 0.92 ? anyHut() : nowhere();
  const t = rand();
  let to: number;
  if (from >= count) to = anyHut();
  else if (t < 0.3 && map.links[from].length > 0) to = pick(rand, map.links[from]);
  else if (t < 0.4) to = from;
  else if (t < 0.5) to = nowhere();
  else if (t < 0.65) to = farthest(map, from);
  else if (t < 0.8) to = pick(rand, map.homes);
  else to = anyHut();
  const bridges = map.paths.filter((path) => path.kind === 'bridge');
  if (kind === 'burn' && bridges.length > 0 && rand() < 0.8) {
    const bridge = pick(rand, bridges);
    [from, to] = rand() < 0.5 ? [bridge.a, bridge.b] : [bridge.b, bridge.a];
  }
  // A cut or a wall goes on a path off a hut the seat holds, or it is only ever refused.
  if ((kind === 'cut' || kind === 'wall') && held.length > 0 && rand() < 0.8) {
    from = pick(rand, held);
    if (map.links[from].length > 0) to = pick(rand, map.links[from]);
  }
  return { tick, kind, from, to, ...(rand() < 0.3 && { risky: true }) };
}

/** Each seat's orders, read back, and held to what the rules let a seat store. */
function storable(orders: Order[]): string {
  const text = encodeOrders(orders);
  expect(text, 'orders as the rules see them').toMatch(ORDERS_SHAPE);
  expect(decodeOrders(text)).toStrictEqual(orders);
  return text;
}

interface Read {
  m: SwarmMatch;
  s: Seats;
}

/** The room, refusing what the database rules refuse. */
class Room {
  m: SwarmMatch;
  s: Seats = {};
  history: Read[] = [];
  /** Writes whose orders the rules would never take: a seat that sends one is not heard again. */
  unshaped: string[] = [];
  private stamp = 0;

  constructor(m: SwarmMatch) {
    this.m = m;
    this.keep();
  }

  /** What vacateSeat does: the computer plays the seat after its promise. */
  leave(seat: Seat) {
    const stored = this.s[seat];
    this.m = { ...this.m, out: { ...this.m.out, [seat]: stored?.game === this.m.game ? stored.k : 0 } };
  }

  put(seat: Seat, { base, ...state }: SeatWrite): boolean {
    if (state.orders.length > ORDERS_CAP || !ORDERS_SHAPE.test(state.orders) || !Number.isSafeInteger(state.k) || state.k < 0) {
      this.unshaped.push(`${seat}: k ${state.k}, ${state.orders.length} characters ending ${state.orders.slice(-24)}`);
      return false;
    }
    const stored = this.s[seat];
    const out = this.m.out?.[seat];
    if (out !== undefined && state.game === this.m.game && state.k > out) return false;
    if (stored && stored.game === this.m.game) {
      if (state.game !== stored.game || state.k < stored.k || !state.orders.startsWith(stored.orders)) return false;
      if (base !== undefined && base !== stored.seq) return false;
    }
    this.s = { ...this.s, [seat]: { ...state, at: ++this.stamp } };
    return true;
  }

  keep() {
    this.history.push({ m: this.m, s: this.s });
  }

  read(stepsAgo: number): Read {
    return this.history[Math.max(this.history.length - 1 - stepsAgo, 0)];
  }
}

/**
 * What a connection and a tab do to a client: reads `lag` steps old, writes
 * lost, answers lost (`deaf`), writes `slow` steps on the way, a clock `skew`
 * ticks off, and frames skipped as in a hidden tab.
 */
interface Faults {
  lag: number;
  lose: number;
  deaf: number;
  slow: number;
  skew: number;
  skip: number;
}

const CLEAN: Faults = { lag: 0, lose: 0, deaf: 0, slow: 0, skew: 0, skip: 0 };

/** One person's tab, doing what the board's pump does once a frame, with orders given at random. */
class Client {
  seat: Seat;
  lock: Lockstep | null = null;
  view: Read;
  faults: Faults;
  seq: number;
  sentKey = '';
  sentK = -1;
  given = 0;
  flying: [number, SeatWrite][] = [];
  /** Confirmed states taken at random frames, to hold against the game played straight through. */
  snaps: SwarmState[] = [];
  private room: Room;
  private rand: () => number;
  private setup: Setup;

  constructor(seat: Seat, room: Room, rand: () => number, setup: Setup) {
    this.seat = seat;
    this.room = room;
    this.rand = rand;
    this.setup = setup;
    this.view = room.read(0);
    this.seq = Math.floor(rand() * 1e6) * 1000;
    this.faults = { lag: Math.floor(rand() * 4), lose: rand() * 0.15, deaf: rand() * 0.1, slow: Math.floor(rand() * 5), skew: Math.floor(rand() * 7) - 3, skip: rand() * 0.3 };
  }

  poll() {
    const read = this.room.read(Math.floor(this.rand() * (this.faults.lag + 1)));
    const s: Seats = {};
    for (const seat of SEATS) {
      const state = read.s[seat];
      if (state && sound(state)) s[seat] = state;
    }
    this.view = { m: read.m, s };
  }

  /** `giving` false is a player who has stopped: the game is being drained to its end. */
  frame(tick: number, beat: boolean, giving = true) {
    for (const flight of this.flying) flight[0]--;
    for (const [, write] of this.flying.filter(([left]) => left <= 0)) {
      if (!this.room.put(this.seat, write) || this.rand() < this.faults.deaf) this.sentKey = '';
      else if (this.lock && write.game === this.lock.game && this.lock.ownSeq === write.base) this.lock.ownSeq = write.seq;
    }
    this.flying = this.flying.filter(([left]) => left > 0);

    if (!this.lock) this.lock = newLockstep(this.view.m.game, mapOf(this.view.m));
    const lock = this.lock;
    settle(lock, this.seat, this.view.m, this.view.s, tick);
    if (this.rand() < 0.05) checkState(lock.shown, lock.map);
    if (lock.confirmed.tick > 0 && this.rand() < 0.03) this.snaps.push(structuredClone(strip(lock.confirmed)));
    if (giving && lock.shown.winner === null && this.rand() < 0.12) this.give(tick);

    if (this.flying.length > 0) return;
    const key = `${lock.game}|${lock.orders[this.seat].length}`;
    if (beat || key !== this.sentKey || Math.min(tick, lock.map.ticks) - this.sentK >= REPORT_EVERY) this.send(sending(lock, this.seat, ++this.seq, tick), key);
  }

  /** A burst of orders, as from a drag over several huts. Some are given on a board that had fallen behind, so they come late. */
  private give(tick: number) {
    const lock = this.lock as Lockstep;
    const mine = lock.orders[this.seat];
    const flag = this.seat === this.setup.flagger && tick >= this.setup.flagAt;
    for (let burst = 1 + Math.floor(this.rand() * 3); burst > 0; burst--) {
      const r = this.rand();
      const earliest = r < 0.8 ? tick + ORDER_DELAY : r < 0.95 ? tick - Math.floor(this.rand() * 30) : 0;
      const last = mine.length > 0 ? mine[mine.length - 1].tick : 0;
      const at = orderTick(earliest, lock.promised, lock.confirmed.tick, last);
      mine.push(fuzzOrder(this.rand, lock.map, lock.shown, this.seat, at, flag && this.rand() < 0.4));
      this.given++;
    }
  }

  private send(write: SeatWrite, key: string) {
    this.sentKey = key;
    this.sentK = write.k;
    if (this.rand() < this.faults.lose) {
      this.sentKey = '';
      return;
    }
    this.flying.push([1 + Math.floor(this.rand() * (this.faults.slow + 1)), write]);
  }
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * A seat written by hand: any letter, any huts, ticks out of order, zero
 * padded or as far off as a tick can be written. It never adds an order for a
 * tick it has promised, which the rules do not stop (see the report) and
 * which would split any game.
 */
class Rogue {
  seat: Seat;
  private room: Room;
  private rand: () => number;
  private seq = 1;

  constructor(seat: Seat, room: Room, rand: () => number) {
    this.seat = seat;
    this.room = room;
    this.rand = rand;
  }

  frame(tick: number, promise: boolean) {
    if (!promise && this.rand() > 0.3) return;
    const stored = this.room.s[this.seat];
    const k = stored?.k ?? 0;
    const parts: string[] = [];
    for (let n = promise ? 0 : Math.floor(this.rand() * 4); n > 0; n--) {
      const at = this.rand() < 0.05 ? LAST_TICK : k + 1 + Math.floor(this.rand() * 60);
      const written = at.toString(36);
      parts.push(`${this.rand() < 0.2 ? written.padStart(4, '0') : written}:${pick(this.rand, [...LETTERS])}${pick(this.rand, [...DIGITS])}${pick(this.rand, [...DIGITS])}`);
    }
    const before = stored?.orders ?? '';
    const orders = [before, ...parts].filter((text) => text !== '').join(',');
    this.room.put(this.seat, { seq: ++this.seq, game: this.room.m.game, k: Math.max(k, promise ? tick : tick - Math.floor(this.rand() * 8)), orders, ...(stored && { base: stored.seq }) });
  }
}

/** Where a failing game's orders are read from when it is reported. */
interface Trail {
  texts: () => Partial<Record<Seat, string>>;
}

/** Tallies across every game, held to at the end so that a run that tested nothing cannot pass. */
const tally = { games: 0, given: 0, compared: 0, forked: 0, withPeople: 0, mattered: 0, longestOrders: 0 };

function playLockstep(setup: Setup, trail: Trail): void {
  const rand = mulberry32(setup.seed ^ 0x5bd1e995);
  const room = new Room(matchOf(setup));
  trail.texts = () => Object.fromEntries(SEATS.flatMap((seat) => (room.s[seat] ? [[seat, room.s[seat].orders]] : [])));
  const until = Math.min(setup.until, mapOf(room.m).ticks);
  const clients = setup.people.filter((seat) => seat !== setup.rogue).map((seat) => new Client(seat, room, rand, setup));
  const rogue = setup.rogue ? new Rogue(setup.rogue, room, rand) : null;
  let playing = clients;

  for (let tick = 0; tick <= until; tick++) {
    if (setup.leaver && tick === setup.leaveAt) {
      const leaving = playing.find((client) => client.seat === setup.leaver);
      if (leaving) {
        room.leave(leaving.seat);
        // Writes still on their way when the seat was given up land after it.
        for (const [, write] of leaving.flying) room.put(leaving.seat, write);
        playing = playing.filter((client) => client !== leaving);
      }
    }
    for (const client of playing) {
      if (rand() < 0.75) client.poll();
      if (rand() < client.faults.skip) continue;
      client.frame(Math.max(0, Math.min(until, tick + client.faults.skew)), rand() < 0.1);
    }
    rogue?.frame(tick, false);
    room.keep();
  }
  // Every tab hears everything and runs to the end.
  for (let round = 0; round < 12; round++) {
    for (const client of playing) {
      client.faults = CLEAN;
      client.poll();
      client.frame(until, true, false);
    }
    rogue?.frame(until, true);
    room.keep();
  }

  const honest = new Set(clients.map((client) => client.seat));
  expect(room.unshaped.filter((write) => honest.has(write[0] as Seat))).toEqual([]);
  for (const client of playing) {
    const lock = client.lock as Lockstep;
    expect(room.s[client.seat]?.orders, `${client.seat}'s orders in the room`).toBe(storable(lock.orders[client.seat]));
  }

  const snaps = new Map<number, [Seat, SwarmState][]>();
  for (const client of clients) for (const snap of client.snaps) snaps.set(snap.tick, [...(snaps.get(snap.tick) ?? []), [client.seat, snap]]);
  const orders = noneYet();
  for (const seat of SEATS) {
    const text = room.s[seat]?.orders ?? '';
    orders[seat] = decodeOrders(text);
    if (honest.has(seat)) tally.longestOrders = Math.max(tally.longestOrders, text.length);
  }
  const map = mapOf(room.m);
  const cpu = computerOf(room.m);
  const end = playChecked(map, orders, cpu, until, rand, undefined, (state) => {
    for (const [seat, snap] of snaps.get(state.tick) ?? []) {
      expect(snap, `${seat}'s confirmed state at tick ${state.tick}`).toStrictEqual(strip(state));
      tally.compared++;
    }
  });
  for (const client of playing) {
    const lock = client.lock as Lockstep;
    expect(strip(lock.confirmed), `${client.seat}'s confirmed state at the end`).toStrictEqual(strip(end));
    tally.compared++;
  }

  tally.given += clients.reduce((sum, client) => sum + client.given, 0);
  if (setup.people.length > 0) {
    tally.withPeople++;
    const idle = newState(map);
    advance(idle, map, {}, end.tick, cpu);
    if (JSON.stringify(strip(idle)) !== JSON.stringify(strip(end))) tally.mattered++;
  }
}

function playSolo(setup: Setup, trail: Trail): void {
  const rand = mulberry32(setup.seed ^ 0x5bd1e995);
  const m = matchOf(setup);
  if (setup.leaver) m.out = { [setup.leaver]: setup.leaveAt };
  const map = mapOf(m);
  const cpu = computerOf(m);
  const orders = noneYet();
  trail.texts = () => Object.fromEntries(SEATS.map((seat) => [seat, encodeOrders(orders[seat])]));
  const end = playChecked(map, orders, cpu, setup.until, rand, (state) => {
    for (const seat of setup.people) {
      if (rand() > 0.15) continue;
      const r = rand();
      // Never at or before a tick already run, which no client gives: a game played again from its orders would run it.
      const at = r < 0.9 ? state.tick + 1 + Math.floor(rand() * 2 * ORDER_DELAY) : r < 0.97 ? state.tick + 1 + Math.floor(rand() * 2000) : LAST_TICK;
      const flag = seat === setup.flagger && state.tick >= setup.flagAt && rand() < 0.4;
      orders[seat].push(fuzzOrder(rand, map, state, seat, at, flag));
      tally.given++;
    }
  });
  const decoded = noneYet();
  for (const seat of SEATS) decoded[seat] = decodeOrders(storable(orders[seat]));
  // Played straight through on a map built again, from the orders as they would be read from the room.
  const again = newState(mapOf(m));
  advance(again, mapOf(m), decoded, setup.until, cpu);
  expect(again, 'the game played straight through').toStrictEqual(end);
}

function nameOf({ kind, setup }: Game): string {
  const seats = SEATS.filter((seat) => setup.people.includes(seat) || setup.cpu.includes(seat))
    .map((seat) => (seat === setup.rogue ? `${seat}!` : setup.people.includes(seat) ? seat.toUpperCase() : seat))
    .join('');
  return `${kind} ${setup.mode}/${setup.start}/${twistLetters(setup.twists) || '-'} on ${setup.map} ${setup.size} ${seats} seed ${setup.seed}`;
}

describe('swarm fuzz: orders on the wire', () => {
  it('has every kind of order the code knows', () => {
    expect(KIND_LIST).toEqual(expect.arrayContaining(['half', 'all', 'hut', 'speed', 'strength', 'flag', 'nest', 'burn', 'rain', 'call', 'decoy', 'range', 'rate', 'armour', 'mortar', 'ballista', 'web', 'tower', 'carapace', 'cut', 'wall']));

    for (const kind of KIND_LIST) expect(decodeOrders(encodeOrders([{ tick: 1, kind, from: 0, to: 0 }]))[0].kind).toBe(kind);
  });

  it('gives every kind a letter of its own', () => {
    // Two kinds on one letter decode as whichever was written last, so the other drops out of the list.
    expect(KIND_LIST).toHaveLength(21);
    expect(new Set(KIND_LIST).size).toBe(KIND_LIST.length);
  });

  it('reads back every kind, risky or not, at the edges of a tick and a hut, in the shape the rules take', () => {
    const orders: Order[] = KIND_LIST.flatMap((kind) =>
      [0, 1, 35, 36, 9600, LAST_TICK].flatMap((tick) =>
        [[0, 0], [35, 35], [7, 20], [20, 7]].flatMap(([from, to]) => [false, true].map((risky) => ({ tick, kind, from, to, ...(risky && { risky: true }) })))
      )
    );
    for (const order of orders) expect(decodeOrders(storable([order]))).toStrictEqual([order]);
    storable(orders);
    expect(decodeOrders(encodeOrders(orders)).filter((order) => order.risky)).toHaveLength(orders.length / 2);
    expect(storable([])).toBe('');
  });

  it('reads back random lists', () => {
    const rand = mulberry32(BASE_SEED);
    for (let list = 0; list < (LONG ? 5000 : 300); list++) {
      const orders = Array.from({ length: Math.floor(rand() * 40) }, () => ({
        tick: Math.floor(rand() * (rand() < 0.1 ? LAST_TICK : 10_000)),
        kind: pick(rand, KIND_LIST),
        from: Math.floor(rand() * MOST_SITES),
        to: Math.floor(rand() * MOST_SITES),
        ...(rand() < 0.5 && { risky: true }),
      }));
      storable(orders);
    }
  });

  it('cannot carry a tick or a hut past what one order has room for', () => {
    expect(encodeOrders([{ tick: LAST_TICK + 1, kind: 'half', from: 0, to: 1 }])).not.toMatch(ORDERS_SHAPE);
    expect(encodeOrders([{ tick: 1, kind: 'half', from: MOST_SITES, to: 1 }])).not.toMatch(ORDERS_SHAPE);
  });

  it('lets the lobby store every mode, start, twist, size and map there is', () => {
    const m = DB.rules.swarm.$code.m;
    for (const mode of MODE_IDS) expect(m.mode['.validate']).toContain(`'${mode}'`);
    for (const start of START_IDS) expect(m.start['.validate']).toContain(`'${start}'`);
    for (const size of SIZE_IDS) expect(m.size['.validate']).toContain(`'${size}'`);
    const shapeOf = (rule: string) => new RegExp((/matches\(\/(.+)\/\)/.exec(rule) as RegExpExecArray)[1]);
    for (const twists of [TWISTS, ...TWISTS.map((twist) => [twist])]) expect(twistLetters(twists)).toMatch(shapeOf(m.twists['.validate']));
    for (const map of MAP_IDS) expect(map).toMatch(shapeOf(m.map['.validate']));
  });
});

describe('swarm fuzz: games', () => {
  it('plays every mode, start, twist, map, size and number of sides', () => {
    const played = (of: (setup: Setup) => string | number) => new Set(GAMES.map((game) => of(game.setup)));
    if (REPLAY) return;
    expect([...played((setup) => setup.mode)].sort()).toEqual([...MODE_IDS].sort());
    expect([...played((setup) => setup.start)].sort()).toEqual([...START_IDS].sort());
    expect([...played((setup) => setup.map)].sort()).toEqual([...MAP_IDS].sort());
    expect([...played((setup) => setup.size)].sort()).toEqual([...SIZE_IDS].sort());
    expect([...played((setup) => setup.people.length + setup.cpu.length)].sort()).toEqual([2, 3, 4]);
    for (const twist of TWISTS) expect(GAMES.some((game) => game.setup.twists.length === 1 && game.setup.twists[0] === twist)).toBe(true);
    expect(GAMES.some((game) => game.setup.twists.length === TWISTS.length)).toBe(true);
    for (const kind of ['lockstep', 'solo'] as const) {
      const pairs = new Set(GAMES.filter((game) => game.kind === kind).map((game) => `${game.setup.mode}/${game.setup.start}`));
      expect(pairs.size).toBe(MODE_IDS.length * START_IDS.length);
    }
    for (const { setup } of GAMES) expect(lobbyAllows(setup.mode, setup.people.length + setup.cpu.length, setup.people.length)).toBe(true);
  });

  for (const game of GAMES) {
    it(nameOf(game), { timeout: LONG ? 600_000 : 60_000 }, () => {
      const trail: Trail = { texts: () => ({}) };
      try {
        if (game.kind === 'lockstep') playLockstep(game.setup, trail);
        else playSolo(game.setup, trail);
        tally.games++;
      } catch (error) {
        if (error instanceof Error) {
          error.message += `\n\nPlay it again with SWARM_FUZZ_REPLAY='${JSON.stringify(game)}'\nEvery seat's orders: ${JSON.stringify(trail.texts())}`;
        }
        throw error;
      }
    });
  }

  it.skipIf(REPLAY)('tested something in every game', async ({ annotate }) => {
    expect(tally.games).toBe(GAMES.length);
    expect(tally.given).toBeGreaterThan(GAMES.length * 10);
    expect(tally.compared).toBeGreaterThan(GAMES.length);
    // The orders have to have changed the games, or equal boards say nothing.
    expect(tally.mattered).toBeGreaterThan(tally.withPeople / 2);
    await annotate(`${tally.games} games, ${tally.given} orders given, ${tally.compared} states held to the game played straight through; the longest a person's orders grew was ${tally.longestOrders} of ${ORDERS_CAP} characters`);
  });
});

/** Every map is built as its own half-turn and, with four sides, its own mirror both ways. */
function moves(map: SwarmMap): ((x: number, y: number) => [number, number])[] {
  const { x: cx, y: cy } = centreOf(map);
  const turn = (x: number, y: number): [number, number] => [2 * cx - x, 2 * cy - y];
  if (map.sides.length < 4) return [turn];
  return [turn, (x, y) => [2 * cx - x, y], (x, y) => [x, 2 * cy - y]];
}

function expectSymmetric(map: SwarmMap, move: (x: number, y: number) => [number, number], label: string): void {
  const at = new Map(map.sites.map((site, index) => [`${site.x},${site.y}`, index]));
  const twin = map.sites.map((site) => {
    const found = at.get(move(site.x, site.y).join(','));
    if (found === undefined) throw new Error(`${label}: no site where ${site.x},${site.y} moves to`);
    return found;
  });
  const seatOf = new Map<Owner, Owner>([[null, null]]);
  map.sites.forEach((site, index) => {
    const other = map.sites[twin[index]];
    if (!seatOf.has(site.owner)) seatOf.set(site.owner, other.owner);
    expect(other.owner, `${label}: the owner of site ${twin[index]}`).toBe(seatOf.get(site.owner));
    expect({ ...other, x: 0, y: 0, owner: null }, `${label}: site ${twin[index]}`).toStrictEqual({ ...site, x: 0, y: 0, owner: null });
  });
  expect(new Set(seatOf.values()).size, `${label}: seats swapped one for one`).toBe(seatOf.size);
  map.homes.forEach((home, k) => expect(map.homes[map.sides.indexOf(seatOf.get(map.sides[k]) as Seat)], `${label}: home of ${map.sides[k]}`).toBe(twin[home]));
  const pathKey = (a: number, b: number, kind: string, up: number | undefined) => `${Math.min(a, b)}-${Math.max(a, b)} ${kind} ${up ?? ''}`;
  const paths = map.paths.map((path) => pathKey(path.a, path.b, path.kind, path.up)).sort();
  const moved = map.paths.map((path) => pathKey(twin[path.a], twin[path.b], path.kind, path.up === undefined ? undefined : twin[path.up])).sort();
  expect(moved, `${label}: paths`).toEqual(paths);
  const riverKey = (points: [number, number][]) => {
    const forward = points.map((point) => point.join(',')).join(' ');
    const back = [...points].reverse().map((point) => point.join(',')).join(' ');
    return forward < back ? forward : back;
  };
  const rivers = map.rivers.map((river) => riverKey(river.map(({ x, y }): [number, number] => [x, y]))).sort();
  const movedRivers = map.rivers.map((river) => riverKey(river.map(({ x, y }) => move(x, y)))).sort();
  expect(movedRivers, `${label}: rivers`).toEqual(rivers);
}

describe('swarm fuzz: maps', () => {
  it('builds every map the same each time, as its own turn and mirror, and the same for any seats', () => {
    const rand = mulberry32(BASE_SEED + 1);
    let built = 0;
    for (const id of MAP_IDS) {
      for (const size of SIZE_IDS) {
        for (const count of [2, 3, 4]) {
          for (let n = 0; n < (LONG ? 20 : 2); n++) {
            const seed = Math.floor(rand() * 2 ** 32);
            const rules: Rules = { ...CLASSIC, mode: pick(rand, MODE_IDS), start: pick(rand, START_IDS), twists: TWISTS.filter(() => rand() < 0.5) };
            const sides = SEATS.slice(0, count);
            const map = buildMap(seed, id, sides, size, rules);
            const label = `${id} ${size} ${count} sides ${rules.mode}/${rules.start}/${twistLetters(rules.twists)} seed ${seed}`;
            expect(buildMap(seed, id, sides, size, rules), `${label}: built again`).toStrictEqual(map);
            for (const move of moves(map)) expectSymmetric(map, move, label);
            if (count < 4) {
              const others = SEATS.slice(SEATS.length - count);
              const rename = (owner: Owner) => (owner === null ? null : others[sides.indexOf(owner)]);
              const shifted = buildMap(seed, id, others, size, rules);
              expect(shifted, `${label}: seated as ${others.join('')}`).toStrictEqual({ ...map, sides: others, sites: map.sites.map((site) => ({ ...site, owner: rename(site.owner) })) });
            }
            built++;
          }
        }
      }
    }
    expect(built).toBe(MAP_IDS.length * SIZE_IDS.length * 3 * (LONG ? 20 : 2));
  });
});

// Measured on 2026-10-16 at 0fad874 on the laptop this was written on, four
// people giving orders at random on guns, large, every twist, to the clock:
// p50 0.04 to 0.08ms, p99 0.35 to 0.9ms, the worst tick 11 to 22ms and at a
// different tick each run, so the collector's rather than the game's. The p99
// budget is several times that, and the worst tick has to leave half a TICK_MS
// for everything else a frame does.
const BUDGET_P99_MS = 5;
const BUDGET_WORST_MS = 50;

describe('swarm fuzz: time', () => {
  it.skipIf(REPLAY)('runs a four-side game on the largest ground within budget', async ({ annotate }) => {
    const size = [...SIZE_IDS].sort((p, q) => WORLDS[q].w * WORLDS[q].h - WORLDS[p].w * WORLDS[p].h)[0];
    const sides = SEATS.slice(0, 4);
    const rules: Rules = { ...CLASSIC, twists: TWISTS };
    const id = [...MAP_IDS].sort((p, q) => buildMap(1, q, sides, size, rules).sites.length - buildMap(1, p, sides, size, rules).sites.length)[0];
    let longest: { times: number[]; ticks: number; seed: number; clock: number } | null = null;
    for (let attempt = 0; attempt < (LONG ? 10 : 3); attempt++) {
      const seed = BASE_SEED + attempt;
      const rand = mulberry32(seed);
      const map = buildMap(seed, id, sides, size, rules);
      const state = newState(map);
      const orders = noneYet();
      const times: number[] = [];
      while (state.winner === null) {
        for (const seat of sides) if (rand() < 0.15) orders[seat].push(fuzzOrder(rand, map, state, seat, state.tick + 1 + Math.floor(rand() * ORDER_DELAY), false));
        const started = performance.now();
        step(state, map, orders, {});
        times.push(performance.now() - started);
      }
      if (!longest || state.tick > longest.ticks) longest = { times, ticks: state.tick, seed, clock: map.ticks };
    }
    const { times, ticks, seed, clock } = longest as NonNullable<typeof longest>;
    const sorted = [...times].sort((p, q) => p - q);
    const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
    const worst = sorted[sorted.length - 1];
    const total = times.reduce((sum, time) => sum + time, 0);
    await annotate(
      `${id} ${size}, 4 sides, every twist, seed ${seed}: ${ticks} of ${clock} ticks; ` +
        `p50 ${at(0.5).toFixed(3)}ms, p99 ${at(0.99).toFixed(3)}ms, worst ${worst.toFixed(2)}ms at tick ${times.indexOf(worst) + 1}; ` +
        `${total.toFixed(0)}ms for the whole game, what a reload replays`
    );
    expect(at(0.99)).toBeLessThan(BUDGET_P99_MS);
    expect(worst).toBeLessThan(BUDGET_WORST_MS);
  });
});
