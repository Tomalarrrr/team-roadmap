/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advance, DEFAULT_OPTIONS, KEY, WEAPONS } from '../slugsGameLogic';
import type { Act, Input, SlugsState } from '../slugsGameLogic';
import { chunkKey } from '../api/slugsApi';
import { MAP_DESIGN_IDS, MAP_DESIGNS } from '../slugsMaps';
import type { Seat, SeatWrite, SlugsMatch, SlugsRoom } from '../api/slugsApi';
import {
  addChunks,
  canStep,
  choicesOf,
  DEFAULT_SETTINGS,
  decodeSettings,
  encodeEntry,
  encodeInputs,
  encodeSettings,
  frame,
  INPUT_SHAPE,
  KNOBS,
  landed,
  MAP_GROUND,
  mapOf,
  myTurn,
  newLockstep,
  nextSeed,
  normalAct,
  optionsOf,
  OTHER_RULES,
  parseInputs,
  RANDOM_MAP,
  reportDue,
  restingReport,
  resultOf,
  RULES as MY_RULES,
  sameRules,
  SEAL_AT,
  sealed,
  sending,
  settingsOf,
  stamped,
  takeRoom,
  themeOf,
  waitsOn,
  withStored,
} from '../components/slugs/slugsSync';
import type { Entry, Lockstep, MatchChoices, Settings } from '../components/slugs/slugsSync';
import { THEME_IDS } from '../components/slugs/slugThemes';

// --- The database rules, run against a stand-in for the server's evaluator ---
//
// Copied from src/api/__tests__/swarmRules.test.ts, which says what it models,
// with every `$` variable passed in rather than only $code and $seat: the
// slugs block also has $g (a game's sealed inputs) and $c (one chunk).

type RuleNode = { [key: string]: RuleNode | string | boolean };
type Tree = { [key: string]: unknown };

const RULES = (JSON.parse(readFileSync(resolve(process.cwd(), 'database.rules.json'), 'utf-8')) as { rules: RuleNode }).rules;
const VAR_NAMES = ['$code', '$seat', '$g', '$c', '$other'];

class Snap {
  private readonly tree: unknown;
  private readonly path: string[];
  constructor(tree: unknown, path: string[]) {
    this.tree = tree;
    this.path = path;
  }
  private at(): unknown {
    let value = this.tree;
    for (const key of this.path) {
      if (value === null || typeof value !== 'object') return null;
      value = (value as Tree)[key] ?? null;
    }
    return value ?? null;
  }
  val(): unknown {
    return this.at();
  }
  exists(): boolean {
    return this.at() !== null;
  }
  child(path: string): Snap {
    return new Snap(this.tree, [...this.path, ...path.split('/')]);
  }
  parent(): Snap {
    return new Snap(this.tree, this.path.slice(0, -1));
  }
  hasChild(path: string): boolean {
    return this.child(path).exists();
  }
  hasChildren(keys?: string[]): boolean {
    const value = this.at();
    if (value === null || typeof value !== 'object') return false;
    return keys ? keys.every((key) => this.hasChild(key)) : true;
  }
  isNumber(): boolean {
    return typeof this.at() === 'number';
  }
  isString(): boolean {
    return typeof this.at() === 'string';
  }
  isBoolean(): boolean {
    return typeof this.at() === 'boolean';
  }
}

type Vars = Record<string, string>;

function holds(rule: string | boolean, before: unknown, after: unknown, path: string[], vars: Vars, now: number): boolean {
  if (typeof rule === 'boolean') return rule;
  const js = rule
    .replace(/\.matches\(/g, '.match(')
    .replace(/\.contains\(/g, '.includes(')
    .replace(/\.beginsWith\(/g, '.startsWith(')
    .replace(/([!=])=/g, '$1==');
  // slop-check-ignore: runs this repo's own database.rules.json in a test, never user input
  const run = new Function('root', 'data', 'newData', 'now', ...VAR_NAMES, `return !!(${js});`);
  try {
    return run(new Snap(before, []), new Snap(before, path), new Snap(after, path), now, ...VAR_NAMES.map((name) => vars[name])) as boolean;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function descend(node: RuleNode, key: string, vars: Vars): [RuleNode, Vars] | null {
  const named = node[key];
  if (typeof named === 'object') return [named, vars];
  const wild = Object.keys(node).find((each) => each.startsWith('$'));
  if (!wild) return null;
  return [node[wild] as RuleNode, { ...vars, [wild]: key }];
}

function put(tree: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const copy: Tree = tree !== null && typeof tree === 'object' ? { ...(tree as Tree) } : {};
  const next = put(copy[path[0]] ?? null, path.slice(1), value);
  if (next === null || (typeof next === 'object' && Object.keys(next as Tree).length === 0)) delete copy[path[0]];
  else copy[path[0]] = next;
  return Object.keys(copy).length === 0 ? null : copy;
}

function allowed(before: unknown, at: string, value: unknown, now: number): boolean {
  const path = at.split('/');
  const after = put(before, path, value);
  const valid = (node: RuleNode, here: string[], vars: Vars): boolean =>
    new Snap(after, here).val() === null || node['.validate'] === undefined || holds(node['.validate'] as string | boolean, before, after, here, vars, now);

  let node: RuleNode | null = RULES;
  let vars: Vars = {};
  let granted = false;
  for (let i = 0; node; i++) {
    const here = path.slice(0, i);
    if (node['.write'] !== undefined && holds(node['.write'] as string | boolean, before, after, here, vars, now)) granted = true;
    if (i > 0 && i < path.length && !valid(node, here, vars)) return false;
    if (i === path.length) break;
    const down: [RuleNode, Vars] | null = descend(node, path[i], vars);
    if (!down) {
      node = null;
      break;
    }
    [node, vars] = down;
  }
  if (!granted) return false;
  if (!node) return true;

  const subtree = (rules: RuleNode, here: string[], vars: Vars): boolean => {
    if (!valid(rules, here, vars)) return false;
    const value = new Snap(after, here).val();
    if (value === null || typeof value !== 'object') return true;
    return Object.keys(value as Tree).every((key) => {
      const down = descend(rules, key, vars);
      return !down || subtree(down[0], [...here, key], down[1]);
    });
  };
  return subtree(node, path, vars);
}

// --- A room held to those rules, and clients that play through it ---

const CODE = 'QX7Z';
const T0 = 1_800_000_000_000;

class Db {
  tree: unknown = null;
  now = T0;
  refused = 0;
  write(at: string, value: unknown): boolean {
    if (!allowed(this.tree, at, value, this.now)) {
      this.refused++;
      return false;
    }
    this.tree = put(this.tree, at.split('/'), value);
    return true;
  }
  room(): SlugsRoom {
    return structuredClone((this.tree as { slugs: Record<string, SlugsRoom> }).slugs[CODE]);
  }
}

const roomAt = (sub = '') => `slugs/${CODE}${sub}`;

function lobbyMatch(set: Settings): SlugsMatch {
  return {
    status: 'waiting',
    createdAt: T0,
    seed: 0,
    game: 0,
    players: { a: { sessionId: 'session-a', name: 'Ann' }, b: { sessionId: 'session-b', name: 'Bob' } },
    set: stamped(encodeSettings(set)),
  };
}

/** A room with Ann and Bob in game 1, made and started through the rules. */
function startedDb(set: Settings, seed = 12345, cpu?: string): Db {
  const db = new Db();
  expect(db.write(roomAt(), { m: lobbyMatch(set) })).toBe(true);
  const playing: SlugsMatch = { ...lobbyMatch(set), status: 'playing', seed, game: 1, ...(cpu && { cpu }) };
  expect(db.write(roomAt('/m'), playing)).toBe(true);
  return db;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a person might do on their turn: walk, aim, charge and let go, change
 * weapon, and now and then something else. A bot that does not fire only aims,
 * for whole turns: walking and jumping slugs drown, and the match has to last
 * long enough to measure.
 */
function bot(seed: number, surrenderAfter = Infinity, fires = true) {
  const rnd = mulberry(seed);
  let keys = 0;
  let holdFor = 0;
  let turns = 0;
  let wasMine = false;
  return (ls: Lockstep): Input => {
    const mine = myTurn(ls) && ls.state.phase === 'turn';
    if (mine && !wasMine) turns++;
    wasMine = mine;
    if (!mine) {
      keys = 0;
      return { keys };
    }
    if (turns > surrenderAfter) return { keys: 0, act: { t: 'surrender' } };
    let act: Act | undefined;
    if (holdFor-- <= 0) {
      holdFor = 4 + Math.floor(rnd() * 30);
      const pick = rnd();
      keys =
        !fires ? [KEY.up, KEY.down, KEY.up | KEY.fine, KEY.down | KEY.fine, 0][Math.floor(pick * 5)] : pick < 0.3 ? KEY.left : pick < 0.5 ? KEY.right : pick < 0.6 ? KEY.up | KEY.fine : pick < 0.7 ? KEY.down : pick < 0.85 ? KEY.fire : 0;
      const roll = rnd();
      if (!fires) act = undefined;
      else if (roll < 0.08) act = { t: 'weapon', w: WEAPONS[Math.floor(rnd() * 6)] };
      else if (roll < 0.1) act = { t: 'jump' };
      else if (roll < 0.11) act = { t: 'fuse', n: 1 + Math.floor(rnd() * 5) };
      else if (roll < 0.12) act = { t: 'target', x: Math.floor(rnd() * 2000), y: Math.floor(rnd() * 900) };
      else if (roll < 0.125) act = { t: 'skip' };
    }
    return act ? { keys, act } : { keys };
  };
}

interface Flight {
  write: SeatWrite;
  seal?: { index: number; text: string };
  at: number;
}

interface Client {
  name: string;
  ls: Lockstep;
  seq: number;
  sentAt: number;
  flight: Flight | null;
  reads: { at: number; room: SlugsRoom }[];
  nextRead: number;
  play: (ls: Lockstep) => Input;
  rnd: () => number;
  heard: boolean;
}

function client(name: string, seat: Seat, match: SlugsMatch, play: (ls: Lockstep) => Input, seed: number): Client {
  return { name, ls: newLockstep(match, seat), seq: seed * 1000, sentAt: -Infinity, flight: null, reads: [], nextRead: 0, play, rnd: mulberry(seed), heard: false };
}

/** Delays in ms on the way to and from the room: a few tens, now and then a few hundred. */
const lag = (c: Client) => 30 + Math.floor(c.rnd() * 120) + (c.rnd() < 0.05 ? 600 : 0);

/** One frame of one client, at `now` on the shared clock (each client's own clock is the same, which this file does not need to vary). */
function step(db: Db, c: Client, now: number) {
  if (now >= c.nextRead) {
    c.reads.push({ at: now + lag(c), room: db.room() });
    c.nextRead = now + 150;
  }
  // Reads come back in the order they arrive, which need not be the order they were made.
  c.reads.sort((x, y) => x.at - y.at);
  while (c.reads.length && c.reads[0].at <= now) {
    takeRoom(c.ls, c.reads.shift()!.room);
    c.heard = true;
  }
  if (c.flight && c.flight.at <= now) {
    const { write, seal } = c.flight;
    c.flight = null;
    const chunkOk = !seal || db.write(roomAt(`/h/g${write.game}/${c.ls.seat}/c${seal.index}`), seal.text);
    if (seal && chunkOk) sealed(c.ls, seal);
    if (chunkOk && db.write(roomAt(`/s/${c.ls.seat}`), { ...write, at: db.now })) landed(c.ls, write);
    else c.sentAt = -Infinity;
  }
  if (!c.heard) return;
  frame(c.ls, now, c.play(c.ls));
  if (!c.flight && reportDue(c.ls, now - c.sentAt)) {
    const { write, seal } = sending(c.ls, ++c.seq);
    c.sentAt = now;
    c.flight = { write, ...(seal && { seal }), at: now + lag(c) };
  }
}

const FRAME_MS = 16;

/** Run the clients until every one has finished the match, or `most` ms pass. */
function run(db: Db, clients: Client[], most: number, from = 0, until?: (now: number) => boolean): number {
  let now = from;
  for (; now < from + most; now += FRAME_MS) {
    db.now = T0 + now;
    for (const c of clients) step(db, c, now);
    if (until?.(now)) break;
    if (clients.every((c) => c.ls.state.phase === 'over')) {
      // Let the last writes land, so a client made from the room afterwards has them all.
      for (let settle = 0; settle < 100; settle++) {
        now += FRAME_MS;
        db.now = T0 + now;
        for (const c of clients) step(db, c, now);
      }
      break;
    }
  }
  return now;
}

function hash(state: SlugsState): string {
  let h = 2166136261;
  const mix = (n: number) => {
    h = Math.imul(h ^ n, 16777619) >>> 0;
  };
  const text = JSON.stringify(state, (key, value: unknown) => {
    if (key === 'events') return undefined;
    if (value instanceof Uint8Array) {
      for (let i = 0; i < value.length; i++) mix(value[i]);
      return value.length;
    }
    return value;
  });
  for (let i = 0; i < text.length; i++) mix(text.charCodeAt(i));
  return h.toString(16);
}

/** A client made from the room alone, as a reload is, run to the end of the match. */
function replay(db: Db, seat: Seat): Lockstep {
  return replayRoom(db.room(), seat);
}

function replayRoom(room: SlugsRoom, seat: Seat): Lockstep {
  const ls = newLockstep(room.m, seat);
  expect(takeRoom(ls, room)).toEqual([]);
  for (let now = 0; now < 1e7 && ls.state.phase !== 'over'; now += 1000) {
    frame(ls, now, { keys: 0 });
    if (!canStep(ls)) break;
  }
  return ls;
}

const QUICK: Settings = { ...DEFAULT_SETTINGS, perTeam: 2, turnSeconds: 15, startHp: 50, roundMinutes: 5 };

// --- Tests ---

describe('slugs inputs as text', () => {
  it('reads back every kind of entry as written', () => {
    const entries: Entry[] = [
      { tick: 0, keys: 0 },
      { tick: 3, keys: KEY.left | KEY.fine },
      { tick: 3, act: { t: 'jump' } },
      { tick: 40, act: { t: 'flip' } },
      { tick: 41, act: { t: 'weapon', w: WEAPONS[WEAPONS.length - 1] } },
      { tick: 900, act: { t: 'fuse', n: 5 } },
      { tick: 901, act: { t: 'bounce' } },
      { tick: 950, act: { t: 'target', x: 1999, y: 0 } },
      { tick: 951, act: { t: 'girder', rot: 7 } },
      { tick: 60_000, keys: 63 },
      { tick: 60_001, act: { t: 'skip' } },
      { tick: 60_002, act: { t: 'surrender' } },
    ];
    const text = encodeInputs(entries);
    expect(INPUT_SHAPE.test(text)).toBe(true);
    expect(parseInputs(text)).toEqual(entries);
  });

  it('gives every weapon a letter', () => {
    expect(WEAPONS.length).toBeLessThanOrEqual(36);
    for (const w of WEAPONS) expect(parseInputs(encodeInputs([{ tick: 1, act: { t: 'weapon', w } }]))).toEqual([{ tick: 1, act: { t: 'weapon', w } }]);
  });

  it('refuses what is not inputs, without throwing', () => {
    expect(parseInputs('3K')).toBeNull();
    expect(parseInputs('3Q')).toBeNull();
    expect(parseInputs('K1')).toBeNull();
    expect(parseInputs('1T00a')).toBeNull();
    expect(parseInputs('1Wz')).toBeNull(); // a weapon this client does not have
    expect(parseInputs('')).toEqual([]);
  });

  it('records an act as it will read back', () => {
    expect(normalAct({ t: 'target', x: -5.7, y: 99_999 })).toEqual({ t: 'target', x: 0, y: 46_655 });
    expect(normalAct({ t: 'fuse', n: 3.9 })).toEqual({ t: 'fuse', n: 3 });
    const act = normalAct({ t: 'target', x: 123.4, y: 55.5 });
    expect(parseInputs(encodeInputs([{ tick: 2, act }]))?.[0].act).toEqual(act);
  });

  it('is held to the same shape by the database rules', () => {
    const slugs = RULES.slugs as RuleNode;
    const seat = ((slugs.$code as RuleNode).s as RuleNode).$seat as RuleNode;
    expect((seat.in as RuleNode)['.validate']).toContain(`matches(${INPUT_SHAPE.toString()})`);
    expect((seat.prev as RuleNode)['.validate']).toContain(`matches(${INPUT_SHAPE.toString()})`);
  });
});

describe('slugs settings', () => {
  it('reads back what the host chose, and stores the defaults as nothing', () => {
    expect(encodeSettings(DEFAULT_SETTINGS)).toBe('');
    expect(decodeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const chosen: Settings = { ...DEFAULT_SETTINGS, perTeam: 2, turnSeconds: 90, weapons: 1, ground: 3 };
    expect(decodeSettings(encodeSettings(chosen))).toEqual(chosen);
    expect(encodeSettings(chosen)).toMatch(/^[a-z][a-zA-Z]{1,11}=[0-9]{1,4}(;[a-z][a-zA-Z]{1,11}=[0-9]{1,4})*$/);
  });

  it('offers the rules defaults among its choices', () => {
    for (const knob of Object.keys(KNOBS) as (keyof typeof KNOBS)[]) {
      expect(KNOBS[knob] as readonly number[]).toContain(DEFAULT_SETTINGS[knob]);
    }
    expect(DEFAULT_SETTINGS.turnSeconds).toBe(DEFAULT_OPTIONS.turnSeconds);
  });

  it('carries the host\'s map into the match, and a room from before the map knob plays the default map', () => {
    const last = MAP_DESIGN_IDS.length - 1;
    expect(MAP_DESIGN_IDS[DEFAULT_SETTINGS.map]).toBe(DEFAULT_OPTIONS.map);
    expect(optionsOf(DEFAULT_SETTINGS, 7).map).toBe(DEFAULT_OPTIONS.map);
    const chosen: Settings = { ...DEFAULT_SETTINGS, map: last };
    expect(encodeSettings(chosen)).toBe(`map=${last}`);
    expect(optionsOf(decodeSettings(`map=${last}`)!, 7).map).toBe(MAP_DESIGN_IDS[last]);
    expect(optionsOf(decodeSettings('perTeam=2')!, 7).map).toBe(DEFAULT_OPTIONS.map);
    expect(decodeSettings(`map=${last + 1}`)).toBeNull();
    expect(allowed(null, roomAt(), { m: lobbyMatch(chosen) }, T0)).toBe(true);
  });

  const FIRST: MatchChoices = {
    perTeam: 4,
    level: 3,
    map: 'random',
    ground: 'map',
    options: {
      turnSeconds: DEFAULT_OPTIONS.turnSeconds,
      startHp: DEFAULT_OPTIONS.startHp,
      windScale: DEFAULT_OPTIONS.windScale,
      mines: DEFAULT_OPTIONS.mines,
      barrels: DEFAULT_OPTIONS.barrels,
      weapons: DEFAULT_OPTIONS.weapons,
      roundMinutes: DEFAULT_OPTIONS.roundMinutes,
      placing: DEFAULT_OPTIONS.placing,
      crates: DEFAULT_OPTIONS.crates,
    },
  };

  it('starts a new room on a random design and its own ground, which every seat works out the same from the seed', () => {
    const fresh = settingsOf(FIRST);
    // Crates are on for a new room but off in DEFAULT_SETTINGS, so the room says so and a client from before crates refuses it.
    expect(encodeSettings(fresh)).toBe(`ground=${MAP_GROUND};map=${RANDOM_MAP};crates=1`);
    expect(optionsOf(decodeSettings('crates=1')!, 7).crates).toBe(true);
    expect(optionsOf(decodeSettings('')!, 7).crates).toBe(false);
    expect(decodeSettings('crates=2')).toBeNull();
    expect(allowed(null, roomAt(), { m: lobbyMatch(fresh) }, T0)).toBe(true);
    const playing: SlugsMatch = { ...lobbyMatch(fresh), status: 'playing', seed: 0xc0ffee, game: 1 };
    const ann = newLockstep(playing, 'a');
    const bob = newLockstep(playing, 'b');
    expect(bob.options.map).toBe(ann.options.map);
    expect(Array.from(bob.state.terrain)).toEqual(Array.from(ann.state.terrain));
    expect(ann.options.map).toBe(mapOf(fresh, 0xc0ffee));
    expect(themeOf(fresh, 0xc0ffee)).toBe(MAP_DESIGNS[ann.options.map].theme);
    // A ground picked by hand still wins over the design's own.
    expect(themeOf({ ...fresh, ground: 2 }, 0xc0ffee)).toBe(THEME_IDS[2]);
  });

  it('draws every design over a run of games, and a fixed design ignores the seed', () => {
    const fresh = settingsOf(FIRST);
    const seen = new Map<string, number>();
    for (let game = 0; game < 600; game++) {
      const map = mapOf(fresh, (Math.imul(game + 1, 2654435761) >>> 0));
      seen.set(map, (seen.get(map) ?? 0) + 1);
    }
    expect([...seen.keys()].sort()).toEqual([...MAP_DESIGN_IDS].sort());
    // 600 games over the designs is 50 each when even; none should be drawn under half or over twice that.
    for (const count of seen.values()) {
      expect(count).toBeGreaterThan(600 / MAP_DESIGN_IDS.length / 2);
      expect(count).toBeLessThan((600 / MAP_DESIGN_IDS.length) * 2);
    }
    // Seeds close together, as a counter would give, still land on more than one design.
    expect(new Set([1, 2, 3, 4].map((seed) => mapOf(fresh, seed))).size).toBeGreaterThan(1);
    // So do seeds that share their low bits: unmixed, every one of these would give the same design.
    const apart = [1, 2, 3, 4, 5, 6].map((k) => k * MAP_DESIGN_IDS.length);
    expect(new Set(apart.map((seed) => mapOf(fresh, seed))).size).toBeGreaterThan(1);
    const fixed = { ...fresh, map: MAP_DESIGN_IDS.indexOf('canyon') };
    expect(new Set([1, 2, 3, 99, 0xffffffff].map((seed) => mapOf(fixed, seed)))).toEqual(new Set(['canyon']));
  });

  it('never deals a room the design it just played on Random, and still reaches every design', () => {
    const fresh = settingsOf(FIRST);
    const seen = new Set<string>();
    let seed = 1;
    for (let game = 0; game < 400; game++) {
      const next = nextSeed(fresh, seed);
      expect(mapOf(fresh, next)).not.toBe(mapOf(fresh, seed));
      seen.add(mapOf(fresh, next));
      seed = next;
    }
    expect([...seen].sort()).toEqual([...MAP_DESIGN_IDS].sort());
    // A fixed design has nothing to avoid, so its seeds still change from game to game.
    const fixed = { ...fresh, map: MAP_DESIGN_IDS.indexOf('canyon') };
    expect(mapOf(fixed, nextSeed(fixed, seed))).toBe('canyon');
    expect(new Set([1, 2, 3, 4, 5].map(() => nextSeed(fixed, seed))).size).toBeGreaterThan(1);
  });

  it('keeps Random and the map ground out of the old list places, so a client from before them refuses the room', () => {
    const oldMapKnob = MAP_DESIGN_IDS.map((_, i) => i);
    const oldGroundKnob = THEME_IDS.map((_, i) => i);
    expect(oldMapKnob).not.toContain(RANDOM_MAP);
    expect(oldGroundKnob).not.toContain(MAP_GROUND);
    // An empty set is a room from before Random, and still reads as the one fixed design it was.
    expect(decodeSettings('')).toEqual(DEFAULT_SETTINGS);
    expect(mapOf(decodeSettings('')!, 1)).toBe(DEFAULT_OPTIONS.map);
  });

  it('turns the local setup into a room and back without losing a choice', () => {
    const picked: MatchChoices = {
      perTeam: 2,
      level: 5,
      map: 'canyon',
      ground: THEME_IDS[1],
      options: { turnSeconds: 20, startHp: 200, windScale: 0, mines: 12, barrels: 12, weapons: 'all', roundMinutes: 30, placing: 'players', crates: false },
    };
    for (const choices of [FIRST, picked]) {
      const settings = settingsOf(choices);
      expect(choicesOf(settings)).toEqual(choices);
      expect(choicesOf(decodeSettings(encodeSettings(settings))!)).toEqual(choices);
    }
    // A value no knob offers takes the default rather than making a room nobody can read.
    const odd = settingsOf({ ...picked, options: { ...picked.options, turnSeconds: 33 } });
    expect(odd.turnSeconds).toBe(DEFAULT_SETTINGS.turnSeconds);
    expect(decodeSettings(encodeSettings(odd))).toEqual(odd);
  });

  it('refuses a setting or a choice it does not know', () => {
    expect(decodeSettings('gravity=2')).toBeNull();
    expect(decodeSettings('turnSeconds=33')).toBeNull();
    expect(() => newLockstep({ ...lobbyMatch(DEFAULT_SETTINGS), status: 'playing', game: 1, set: 'gravity=2' }, 'a')).toThrow(/newer version/);
  });
});

// In room 8WBG one tab had been open since before a deploy. On its rules the
// game ended at tick 25078 with Bob's team the winner; on the other tab's it
// was Ann's turn, and her team was alive, and play went on.
describe('slugs rules version', () => {
  const playing = (set: string | undefined): SlugsMatch => {
    const m: SlugsMatch = { ...lobbyMatch(DEFAULT_SETTINGS), status: 'playing', seed: 77, game: 1 };
    if (set === undefined) delete m.set;
    else m.set = set;
    return m;
  };
  const other = (MY_RULES % 9999) + 1;

  it('is a number the database holds in a room’s set', () => {
    expect(Number.isInteger(MY_RULES)).toBe(true);
    expect(MY_RULES).toBeGreaterThanOrEqual(1);
    expect(MY_RULES).toBeLessThanOrEqual(9999);
    const every = settingsOf({ ...choicesOf(DEFAULT_SETTINGS), perTeam: 6, map: 'random', ground: 'map' });
    for (const set of [stamped(''), stamped('perTeam=2'), stamped(encodeSettings(every))]) {
      expect(set).toMatch(/^[a-z][a-zA-Z]{1,11}=[0-9]{1,4}(;[a-z][a-zA-Z]{1,11}=[0-9]{1,4})*$/);
    }
  });

  it('plays a room set up on this client’s rules, with the settings it would have without them', () => {
    expect(sameRules(stamped('perTeam=2'))).toBe(true);
    expect(decodeSettings(stamped('perTeam=2'))).toEqual({ ...DEFAULT_SETTINGS, perTeam: 2 });
    expect(decodeSettings(stamped(''))).toEqual(DEFAULT_SETTINGS);
    expect(newLockstep(playing(stamped('perTeam=2')), 'a').state.slugs).toHaveLength(4);
  });

  it('refuses a room on other rules, or from before rooms said which', () => {
    for (const set of [undefined, '', 'perTeam=2', `perTeam=2;rules=${other}`, `rules=${MY_RULES}0`, `rules=0${MY_RULES}`, `rules=${other};perTeam=2`]) {
      expect(sameRules(set)).toBe(false);
      expect(() => newLockstep(playing(set), 'a')).toThrow(OTHER_RULES);
    }
  });

  it('still says a setting it does not know is from a newer version', () => {
    expect(() => newLockstep(playing(stamped('gravity=2')), 'a')).toThrow(/newer version/);
  });
});

describe('slugs rules', () => {
  const set = QUICK;

  it('lets a room be made only waiting, and started only with two teams and the next game number', () => {
    const db = new Db();
    expect(allowed(null, roomAt(), { m: { ...lobbyMatch(set), status: 'playing', game: 1 } }, T0)).toBe(false);
    expect(db.write(roomAt(), { m: lobbyMatch(set) })).toBe(true);
    const alone: SlugsMatch = { ...lobbyMatch(set), players: { a: { sessionId: 'session-a', name: 'Ann' } } };
    expect(db.write(roomAt('/m'), alone)).toBe(true);
    expect(allowed(db.tree, roomAt('/m'), { ...alone, status: 'playing', game: 1 }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m'), { ...alone, status: 'playing', game: 1, cpu: 'c' }, T0)).toBe(true);
    expect(allowed(db.tree, roomAt('/m'), { ...alone, status: 'playing', game: 2, cpu: 'c' }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m'), { ...alone, cpu: 'ca' }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m'), { ...alone, players: { a: { sessionId: 'session-a', name: 'Ann', ready: false } } }, T0)).toBe(false);
  });

  it('holds the teams, seed and settings still while a game is played', () => {
    const db = startedDb(set);
    const m = db.room().m;
    expect(allowed(db.tree, roomAt('/m/players/b/name'), 'Robert', T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m/seed'), 1, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m/set'), 'perTeam=3', T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m/cpu'), 'c', T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m'), { ...m, status: 'finished', winner: 'a' }, T0)).toBe(true);
    expect(allowed(db.tree, roomAt('/m'), { ...m, status: 'finished', winner: 'a', gone: 'a' }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m'), { ...m, status: 'finished' }, T0)).toBe(false);
  });

  it('lets a seat only add to its inputs while its game is played, built on the write it names', () => {
    const db = startedDb(set);
    const first = { seq: 1, at: T0, game: 1, k: 10, n: 0, in: '3K1' };
    expect(db.write(roomAt('/s/a'), first)).toBe(true);
    const more = { seq: 2, at: T0, game: 1, k: 20, n: 0, in: '3K15K0', base: 1 };
    expect(allowed(db.tree, roomAt('/s/a'), more, T0)).toBe(true);
    expect(allowed(db.tree, roomAt('/s/a'), { ...more, in: '3K2' }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), { ...more, base: 7 }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), { ...more, k: 9 }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), { ...more, game: 2 }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), { ...more, in: '3K15Q' }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), { ...more, at: T0 - 1 }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), { ...more, extra: 1 }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/g'), { ...first }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), null, T0)).toBe(false);
  });

  it('lets a seat seal the inputs the room holds for it, and nothing else', () => {
    const db = startedDb(set);
    expect(db.write(roomAt('/s/a'), { seq: 1, at: T0, game: 1, k: 10, n: 0, in: '3K1' })).toBe(true);
    const seal = { seq: 2, at: T0, game: 1, k: 30, n: 1, in: '9K0', prev: '3K1', base: 1 };
    expect(allowed(db.tree, roomAt('/s/a'), seal, T0)).toBe(true);
    expect(allowed(db.tree, roomAt('/s/a'), { ...seal, prev: '3K2' }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), { ...seal, n: 2 }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/s/a'), { ...seal, prev: undefined }, T0)).toBe(false);
  });

  it('lets a chunk be written once, and a game\'s chunks go only between games', () => {
    const db = startedDb(set);
    expect(db.write(roomAt('/h/g1/a/c0'), '3K1')).toBe(true);
    expect(allowed(db.tree, roomAt('/h/g1/a/c0'), '3K1', T0)).toBe(true);
    expect(allowed(db.tree, roomAt('/h/g1/a/c0'), '3K2', T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/h/g1/a/c1'), 'nonsense', T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/h/g1/a/x1'), '3K2', T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/h/g1/a/c1'), 'a'.repeat(1) + 'K1'.repeat(2100), T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/h/g1'), null, T0)).toBe(false);
    expect(db.write(roomAt('/m'), { ...db.room().m, status: 'finished', winner: 'b' })).toBe(true);
    expect(allowed(db.tree, roomAt('/h/g1'), null, T0)).toBe(true);
    expect(allowed(db.tree, roomAt('/h/g1/a/c1'), '3K1', T0)).toBe(false);
  });

  it('hands a leaver of a game of three to the computer no earlier than its promise, and then holds it to it', () => {
    const db = startedDb(set, 5, 'c');
    expect(db.write(roomAt('/s/b'), { seq: 1, at: T0, game: 1, k: 500, n: 0, in: '' })).toBe(true);
    expect(allowed(db.tree, roomAt('/m/out/b'), 499, T0)).toBe(false);
    expect(db.write(roomAt('/m/out/b'), 500)).toBe(true);
    expect(allowed(db.tree, roomAt('/s/b'), { seq: 2, at: T0, game: 1, k: 501, n: 0, in: '', base: 1 }, T0)).toBe(false);
    expect(allowed(db.tree, roomAt('/m/out/b'), 600, T0)).toBe(false);
  });

  it('lets a room be removed between games, or once nobody playing is left', () => {
    const db = startedDb(set);
    expect(allowed(db.tree, roomAt(), null, T0)).toBe(false);
    expect(db.write(roomAt('/m/out/a'), 0)).toBe(true);
    expect(allowed(db.tree, roomAt(), null, T0)).toBe(false);
    expect(db.write(roomAt('/m/out/b'), 0)).toBe(true);
    expect(allowed(db.tree, roomAt(), null, T0)).toBe(true);
  });
});

describe('slugs lockstep', () => {
  it('plays a whole match on two clients to the same state and winner, and a reload of either gets there too', () => {
    const db = startedDb(QUICK, 777);
    const m = db.room().m;
    const ann = client('ann', 'a', m, bot(1), 1);
    const bob = client('bob', 'b', m, bot(2, 6), 2);
    run(db, [ann, bob], 30 * 60_000);

    expect(ann.ls.state.phase).toBe('over');
    expect(bob.ls.state.phase).toBe('over');
    expect(ann.ls.state.tick).toBe(bob.ls.state.tick);
    expect(hash(ann.ls.state)).toBe(hash(bob.ls.state));
    expect(resultOf(ann.ls)).toBe(resultOf(bob.ls));
    // Bob gives up on his seventh turn if the match lasts that long, so it always has a winner.
    expect(['a', 'b']).toContain(resultOf(ann.ls));
    // Longer than one turn, so both seats' inputs were run.
    expect(ann.ls.state.tick).toBeGreaterThan(QUICK.turnSeconds * 50);
    expect(ann.ls.reruns + bob.ls.reruns).toBe(0);

    const again = replay(db, 'b');
    expect(again.state.tick).toBe(ann.ls.state.tick);
    expect(hash(again.state)).toBe(hash(ann.ls.state));
  }, 60_000);

  it('picks up after a reload partway through, and nobody else has to run anything again', () => {
    const db = startedDb(QUICK, 4242);
    const m = db.room().m;
    const ann = client('ann', 'a', m, bot(3), 3);
    const bob = client('bob', 'b', m, bot(4, 5), 4);
    const at = run(db, [ann, bob], 30 * 60_000, 0, () => ann.ls.state.tick > 800 && myTurn(bob.ls) && bob.ls.state.phase === 'turn');
    expect(myTurn(bob.ls)).toBe(true);
    // Bob's page reloads on his own turn, losing whatever it had not sent.
    const reloaded = client('bob again', 'b', db.room().m, bot(5, 3), 5);
    run(db, [ann, reloaded], 30 * 60_000, at + FRAME_MS);

    expect(reloaded.ls.state.phase).toBe('over');
    expect(hash(reloaded.ls.state)).toBe(hash(ann.ls.state));
    expect(ann.ls.reruns).toBe(0);
    expect(hash(replay(db, 'a').state)).toBe(hash(ann.ls.state));
  }, 60_000);

  it('agrees with the room when the same seat is open in two tabs', () => {
    const db = startedDb(QUICK, 99);
    const m = db.room().m;
    const ann = client('ann', 'a', m, bot(6), 6);
    const bob = client('bob', 'b', m, bot(7, 5), 7);
    const at = run(db, [ann, bob], 30 * 60_000, 0, () => ann.ls.state.tick > 1500);
    const second = client('ann tab 2', 'a', db.room().m, bot(8), 8);
    run(db, [ann, bob, second], 30 * 60_000, at + FRAME_MS);

    // Some of one tab's writes were refused as built on a write the other had replaced.
    expect(db.refused).toBeGreaterThan(0);
    expect(hash(ann.ls.state)).toBe(hash(bob.ls.state));
    expect(hash(second.ls.state)).toBe(hash(bob.ls.state));
    expect(hash(replay(db, 'b').state)).toBe(hash(bob.ls.state));
  }, 60_000);

  it('takes no notice of a stale read, a repeated one, or one it cannot run', () => {
    const db = startedDb(QUICK, 31);
    const m = db.room().m;
    const ann = client('ann', 'a', m, bot(9), 9);
    const bob = client('bob', 'b', m, bot(10), 10);
    let old: SlugsRoom | null = null;
    run(db, [ann, bob], 30 * 60_000, 0, () => {
      if (!old && ann.ls.state.tick > 600) old = db.room();
      return ann.ls.state.tick > 2000;
    });
    const watcher = newLockstep(m, 'a');
    const fresh = db.room();
    takeRoom(watcher, fresh);
    const k = watcher.k.b;
    const text = watcher.logs.b!.text;
    expect(k).toBeGreaterThan(0);

    takeRoom(watcher, old!);
    expect(old!.s!.b!.k).toBeLessThan(k!);
    expect(watcher.k.b).toBe(k);
    expect(watcher.logs.b!.text).toBe(text);
    takeRoom(watcher, fresh);
    expect(watcher.k.b).toBe(k);
    expect(watcher.logs.b!.text).toBe(text);
    // The same inputs with an older promise: the seat promises again without adding any.
    const earlier = structuredClone(fresh);
    earlier.s!.b = { ...earlier.s!.b!, k: k! - 5 };
    takeRoom(watcher, earlier);
    expect(watcher.k.b).toBe(k);

    const broken = structuredClone(fresh);
    broken.s!.b = { ...broken.s!.b!, k: k! + 10_000, in: 'not inputs' };
    takeRoom(watcher, broken);
    expect(watcher.k.b).toBe(k);
    const wrongGame = structuredClone(fresh);
    wrongGame.s!.b = { ...wrongGame.s!.b!, game: 2, k: k! + 10_000 };
    takeRoom(watcher, wrongGame);
    expect(watcher.k.b).toBe(k);
    expect(watcher.reruns).toBe(0);
  }, 60_000);

  it('runs only the active team\'s inputs: what another seat presses on that turn changes nothing', () => {
    // A match played live, then the same room with Bob's log filled with keys
    // and acts on every tick the rules read someone else's input or nobody's.
    // Both rooms are run from scratch, so frame timing plays no part: the two
    // differ only in what Bob's log holds on those ticks.
    const db = startedDb(QUICK, 2024);
    const m = db.room().m;
    const ann = client('ann', 'a', m, bot(11), 11);
    const bob = client('bob', 'b', m, bot(12, 4), 12);
    run(db, [ann, bob], 30 * 60_000);
    expect(ann.ls.state.phase).toBe('over');
    const calmRoom = db.room();
    const calm = replayRoom(calmRoom, 'a');
    expect(hash(calm.state)).toBe(hash(ann.ls.state));

    // Whose input each tick is read from. The lockstep runs ticks in bursts, so
    // this walks the rules one tick at a time on the room's inputs, read as
    // inputAt reads them; ending on the live state shows it read them the same.
    const entries: Record<string, Entry[]> = { a: parseInputs(calm.logs.a!.text)!, b: parseInputs(calm.logs.b!.text)! };
    const readAt: Record<string, number> = { a: 0, b: 0 };
    const held: Record<string, number> = { a: 0, b: 0 };
    const readers: (Seat | null)[] = [null];
    const walker = newLockstep(m, 'a');
    while (walker.state.phase !== 'over') {
      const seat = waitsOn(walker);
      const tick = walker.state.tick + 1;
      readers[tick] = seat;
      let act: Act | undefined;
      if (seat) {
        for (const list = entries[seat]; readAt[seat] < list.length && list[readAt[seat]].tick <= tick; readAt[seat]++) {
          const entry = list[readAt[seat]];
          if (entry.keys !== undefined) held[seat] = entry.keys;
          else if (entry.tick === tick && !act) act = entry.act;
        }
      }
      advance(walker.state, seat ? { keys: held[seat], ...(act && { act }) } : { keys: 0 });
    }
    expect(hash(walker.state)).toBe(hash(calm.state));
    const last = walker.state.tick;

    const acts: Act[] = [
      { t: 'jump' },
      { t: 'backjump' },
      { t: 'hop' },
      { t: 'flip' },
      { t: 'weapon', w: WEAPONS[3] },
      { t: 'fuse', n: 2 },
      { t: 'bounce' },
      { t: 'target', x: 700, y: 300 },
      { t: 'girder', rot: 5 },
      { t: 'skip' },
      { t: 'surrender' },
    ];
    const calmKeysAt = (tick: number) => [...entries.b].reverse().find((entry) => entry.tick <= tick && entry.keys !== undefined)?.keys ?? 0;
    const rnd = mulberry(13);
    const noisy: Entry[] = [];
    let i = 0;
    for (let tick = 0; tick <= last; tick++) {
      while (i < entries.b.length && entries.b[i].tick === tick) noisy.push(entries.b[i++]);
      if (tick === 0 || readers[tick] === 'b') continue;
      noisy.push({ tick, keys: Math.floor(rnd() * 64) });
      if (rnd() < 0.2) noisy.push({ tick, act: acts[Math.floor(rnd() * acts.length)] });
      // Keys a seat holds carry into its own next turn, which is not a leak:
      // they go back to what Bob held before his turn comes round.
      if (tick === last || readers[tick + 1] === 'b') noisy.push({ tick, keys: calmKeysAt(tick) });
    }
    noisy.push(...entries.b.slice(i));

    // The noise is there: keys on every one of Ann's ticks, and every kind of act.
    const annTicks = readers.filter((seat) => seat === 'a').length;
    const onAnnTicks = noisy.filter((entry) => readers[entry.tick] === 'a');
    expect(annTicks).toBeGreaterThan(QUICK.turnSeconds * 50);
    expect(new Set(onAnnTicks.filter((entry) => entry.keys !== undefined).map((entry) => entry.tick)).size).toBe(annTicks);
    expect(new Set(onAnnTicks.flatMap((entry) => (entry.act ? [entry.act.t] : [])))).toEqual(new Set(acts.map((act) => act.t)));
    expect(entries.b.filter((entry) => readers[entry.tick] === 'a').length).toBeLessThan(annTicks / 10);

    // Into the room as Bob's client would have put it: sealed chunks and the open part.
    const chunks: string[] = [];
    let open = '';
    let after = 0;
    for (const entry of noisy) {
      const text = encodeEntry(entry, after);
      after = entry.tick;
      if (open.length + text.length > SEAL_AT) {
        chunks.push(open);
        open = '';
      }
      open += text;
    }
    const noisyText = encodeInputs(noisy);
    expect(chunks.join('') + open).toBe(noisyText);
    expect(chunks.length).toBeGreaterThan(1);
    const noisyRoom = structuredClone(calmRoom);
    noisyRoom.h = { g1: { ...calmRoom.h?.g1, b: Object.fromEntries(chunks.map((chunk, n) => [chunkKey(n), chunk])) } };
    noisyRoom.s!.b = { ...calmRoom.s!.b!, n: chunks.length, in: open, prev: chunks[chunks.length - 1] };

    for (const seat of ['a', 'b'] as const) {
      const heard = replayRoom(noisyRoom, seat);
      expect(heard.logs.b!.text).toBe(noisyText);
      expect(heard.state.phase).toBe('over');
      expect(heard.state.tick).toBe(last);
      expect(hash(heard.state)).toBe(hash(calm.state));
    }
  }, 60_000);

  it('waits on the other person\'s turn rather than guessing, and runs its own at once', () => {
    const db = startedDb(QUICK, 8);
    const m = db.room().m;
    const ann = newLockstep(m, 'a');
    takeRoom(ann, db.room());
    for (let now = 0; now < 60_000 && !(waitsOn(ann) && !myTurn(ann)); now += 16) frame(ann, now, { keys: 0 });
    expect(waitsOn(ann)).toBe('b');
    const stuck = ann.state.tick;
    for (let now = 60_000; now < 70_000; now += 16) frame(ann, now, { keys: 0 });
    expect(ann.state.tick).toBe(stuck);
    expect(canStep(ann)).toBe(false);
  });

  it('waits on the seat placing a slug, and the placing knob reaches the rules', () => {
    const set = { ...DEFAULT_SETTINGS, placing: 1 };
    expect(decodeSettings(encodeSettings(set))).toEqual(set);
    const playing: SlugsMatch = { ...lobbyMatch(set), status: 'playing', seed: 77, game: 1 };
    const ann = newLockstep(playing, 'a');
    expect(ann.state.phase).toBe('place');
    expect(waitsOn(ann)).toBe('a');
    expect(newLockstep({ ...lobbyMatch(DEFAULT_SETTINGS), status: 'playing', seed: 77, game: 1 }, 'a').state.phase).toBe('ready');
  });

  it('copes with its clock stepping back', () => {
    const db = startedDb(QUICK, 8);
    // The seat whose turn comes first, which runs at once without waiting on anyone.
    const first = newLockstep(db.room().m, 'a');
    const ann = newLockstep(db.room().m, first.seats[first.state.activeTeam]);
    takeRoom(ann, db.room());
    frame(ann, 10_000, { keys: 0 });
    frame(ann, 10_400, { keys: 0 });
    const tick = ann.state.tick;
    expect(tick).toBeGreaterThan(0);
    frame(ann, 2_000, { keys: 0 });
    expect(ann.state.tick).toBe(tick);
    frame(ann, 2_200, { keys: 0 });
    expect(ann.state.tick).toBe(tick + 10);
  });

  it('hands every event to the screen once, across a run again from the start', () => {
    const db = startedDb(QUICK, 8);
    // The seat whose turn comes first, which runs at once without waiting on anyone.
    const first = newLockstep(db.room().m, 'a');
    const ann = newLockstep(db.room().m, first.seats[first.state.activeTeam]);
    takeRoom(ann, db.room());
    expect(frame(ann, 0, { keys: 0 }).events.length).toBeGreaterThan(0);
    for (let now = 0; now < 4000; now += 16) frame(ann, now, { keys: KEY.right });
    const tick = ann.state.tick;
    const land = ann.state.terrain;
    // Another tab of this seat wrote different inputs for ticks already run.
    const room = db.room();
    room.s = { [ann.seat]: { seq: 5, at: T0, game: 1, k: 3, n: 0, in: encodeInputs([{ tick: 2, keys: KEY.left }]) } };
    takeRoom(ann, room);
    expect(ann.reruns).toBe(1);
    expect(ann.state.tick).toBe(tick);
    // The scene repaints the land when the terrain array is a different one (slugsScene.ts, update).
    expect(ann.state.terrain).not.toBe(land);
    expect(frame(ann, 4000, { keys: 0 }).events).toEqual([]);
  }, 60_000);

  it('starts a rematch from its own seed, and takes no inputs of the last game into it', () => {
    const db = startedDb(QUICK, 1);
    const m = db.room().m;
    const one = newLockstep(m, 'a');
    const two = newLockstep({ ...m, seed: 2, game: 2 }, 'a');
    expect(hash(two.state)).not.toBe(hash(one.state));
    const room = db.room();
    room.s = { b: { seq: 5, at: T0, game: 1, k: 3000, n: 0, in: '1K1' } };
    takeRoom(two, room);
    expect(two.k.b).toBeUndefined();
  });

  it('merges what the room holds of its own seat with what it has not sent yet', () => {
    const kept: Entry[] = [{ tick: 5, keys: 1 }, { tick: 9, keys: 0 }];
    const mine: Entry[] = [...kept, { tick: 12, keys: 2 }];
    expect(withStored(mine, kept, 10)).toBe(mine);
    const other: Entry[] = [{ tick: 5, keys: 1 }, { tick: 8, keys: 4 }];
    expect(withStored(mine, other, 10)).toEqual([...other, { tick: 12, keys: 2 }]);
    expect(withStored(mine, other, 12)).toEqual(other);
    // The other tab wrote past what this one has not sent: only what comes after its last counts.
    const ahead: Entry[] = [{ tick: 5, keys: 1 }, { tick: 20, keys: 4 }];
    expect(withStored([{ tick: 5, keys: 1 }, { tick: 9, keys: 2 }, { tick: 25, keys: 0 }], ahead, 8)).toEqual([...ahead, { tick: 25, keys: 0 }]);
  });

  it('fetches sealed chunks a read of the room did not carry', () => {
    const db = startedDb({ ...QUICK, turnSeconds: 60, roundMinutes: 30 }, 3);
    const m = db.room().m;
    const ann = client('ann', 'a', m, bot(14), 14);
    const bob = client('bob', 'b', m, bot(15), 15);
    // Busy keys, so both seats seal chunks early.
    const rnd = mulberry(16);
    ann.play = (ls) => (myTurn(ls) ? { keys: Math.floor(rnd() * 64) & ~KEY.fire } : { keys: 0 });
    run(db, [ann, bob], 30 * 60_000, 0, () => (db.room().s?.a?.n ?? 0) >= 2);
    const full = db.room();
    expect(full.s!.a!.n).toBeGreaterThanOrEqual(2);
    const bare: SlugsRoom = { m: full.m, s: full.s };
    const watcher = newLockstep(m, 'b');
    expect(takeRoom(watcher, bare)).toEqual(['a']);
    addChunks(watcher, 'a', full.h!.g1.a!);
    expect(takeRoom(watcher, bare)).toEqual([]);
    expect(watcher.logs.a!.text).toBe(ann.ls.logs.a!.text.slice(0, watcher.logs.a!.text.length));
  }, 60_000);

  it('repeats the room\'s copy of a seat between games, and says no game otherwise', () => {
    const stored = { seq: 4, at: T0, game: 3, k: 70, n: 1, in: '1K1', prev: '2K2' };
    expect(restingReport({ game: 3 }, stored, 9)).toEqual({ seq: 9, game: 3, k: 70, n: 1, in: '1K1', prev: '2K2', base: 4 });
    expect(restingReport({ game: 4 }, stored, 9)).toEqual({ seq: 9, game: 0, k: 0, n: 0, in: '' });
    expect(restingReport({ game: 0 }, undefined, 9)).toEqual({ seq: 9, game: 0, k: 0, n: 0, in: '' });
  });
});

describe('slugs input sizes over a long match', () => {
  it('stays within what a write may carry through 15 minutes of 45 second turns', () => {
    const db = startedDb({ ...DEFAULT_SETTINGS, perTeam: 4, turnSeconds: 45, roundMinutes: 30 }, 555);
    const m = db.room().m;
    // Keys change every 4 to 34 ticks for the whole of a seat's turn: busier than a person, so the sizes are an upper bound.
    const ann = client('ann', 'a', m, bot(17, Infinity, false), 17);
    const bob = client('bob', 'b', m, bot(18, Infinity, false), 18);
    let biggest = 0;
    const sizes = () => {
      for (const seat of ['a', 'b'] as const) {
        const s = db.room().s?.[seat];
        if (s) biggest = Math.max(biggest, JSON.stringify(s).length);
      }
      return ann.ls.state.tick >= 15 * 60 * 50;
    };
    run(db, [ann, bob], 40 * 60_000, 0, sizes);
    expect(ann.ls.state.tick).toBeGreaterThanOrEqual(15 * 60 * 50);
    const room = db.room();
    const total = ann.ls.logs.a!.text.length + ann.ls.logs.b!.text.length;
    const chunks = Object.keys(room.h?.g1?.a ?? {}).length + Object.keys(room.h?.g1?.b ?? {}).length;
    // Measured on this seed (2026-11-27): 6816 characters of inputs for both seats
    // over 45000 ticks, 6 sealed chunks, the biggest seat write 2140 characters. A write carries
    // the open text and the sealed one it names, each a little over SEAL_AT.
    expect(chunks).toBeGreaterThan(0);
    expect(biggest).toBeLessThan(2 * 1024 + 400);
    expect(total).toBeLessThan(20_000);
  }, 120_000);
});
