// What keeps two clients' Slugs matches the same match.
//
// Swarm's lockstep (see swarmSync.ts), cut to fit a turn-based game. Every
// client runs the same rules from the same seed. Each seat writes only its own
// inputs, tick-stamped, and a promise `k`: nothing more will be added for a
// tick up to k. Nobody reports damage or a result; each client works it out.
//
// Only one team plays at a time, and the rules read the input of that team
// alone. So a tick waits on one seat at most: the active team's, when a person
// plays it on another machine. On this machine's own turn nothing is waited
// for and the match runs as the keys are pressed. On the computer's turn
// nothing is waited for either: its moves come from the state. On the other
// person's turn the match runs a little behind their promise, so that what
// arrives in bursts over the network plays back at an even speed.
//
// There is one state, not Swarm's confirmed and shown pair: the state never
// runs ahead of what is known, so there is nothing to take back. Only a second
// tab on the same seat can change inputs already run, and then the match is
// run again from the start (see takeRoom).
//
// A seat's inputs grow through the match, so old ones are sealed in chunks
// under h/ (see slugsApi) and each write carries only the newest.

import { advance, DEFAULT_OPTIONS, newGame, TICK_MS, WEAPONS } from '../../slugsGameLogic';
import type { Act, Control, Input, SlugEvent, SlugsOptions, SlugsState, TeamSetup } from '../../slugsGameLogic';
import { chunkKey, chunksIn, teamSeats } from '../../api/slugsApi';
import type { Seat, SeatWrite, SlugsMatch, SlugsRoom, SlugsSeatState } from '../../api/slugsApi';
import { BEAT_LIVE_MS, orderTick } from '../swarm/swarmSync';
import { MAP_DESIGN_IDS } from '../../slugsMaps';
import { THEME_IDS } from './slugThemes';
import type { ThemeId } from './slugThemes';

// --- Settings ---

/**
 * What the host can choose, each from a short list so the database can hold
 * it as a number and a client can refuse one it does not know. `weapons`,
 * `ground` and `map` are stored as a place in their list.
 */
export const KNOBS = {
  perTeam: [1, 2, 3, 4, 5, 6, 7, 8],
  level: [1, 2, 3, 4, 5],
  ground: THEME_IDS.map((_, i) => i),
  turnSeconds: [15, 20, 30, 45, 60, 90],
  startHp: [50, 100, 150, 200],
  windScale: [0, 50, 100, 150],
  mines: [0, 4, 8, 12],
  barrels: [0, 4, 8, 12],
  weapons: [0, 1],
  roundMinutes: [5, 10, 15, 20, 30],
  map: MAP_DESIGN_IDS.map((_, i) => i),
} as const satisfies Record<string, readonly number[]>;

export type Knob = keyof typeof KNOBS;
export type Settings = Record<Knob, number>;

const WEAPON_SETS: readonly SlugsOptions['weapons'][] = ['classic', 'all'];

/** The local setup screen's defaults for the two the rules do not hold, and the rules' own for the rest. */
export const DEFAULT_SETTINGS: Settings = {
  perTeam: 4,
  level: 3,
  ground: 0,
  turnSeconds: DEFAULT_OPTIONS.turnSeconds,
  startHp: DEFAULT_OPTIONS.startHp,
  windScale: DEFAULT_OPTIONS.windScale,
  mines: DEFAULT_OPTIONS.mines,
  barrels: DEFAULT_OPTIONS.barrels,
  weapons: WEAPON_SETS.indexOf(DEFAULT_OPTIONS.weapons),
  roundMinutes: DEFAULT_OPTIONS.roundMinutes,
  map: MAP_DESIGN_IDS.indexOf(DEFAULT_OPTIONS.map),
};

/** `key=value;...` for the settings that differ from the default, which is the shape the rules hold `m/set` to. */
export function encodeSettings(settings: Settings): string {
  return (Object.keys(KNOBS) as Knob[])
    .filter((knob) => settings[knob] !== DEFAULT_SETTINGS[knob])
    .map((knob) => `${knob}=${settings[knob]}`)
    .join(';');
}

/** The settings a room's `set` stands for, or null when it holds one this client does not know. */
export function decodeSettings(set: string | undefined): Settings | null {
  const settings = { ...DEFAULT_SETTINGS };
  if (!set) return settings;
  for (const pair of set.split(';')) {
    const [knob, value] = pair.split('=');
    if (!(knob in KNOBS)) return null;
    const n = Number(value);
    if (!(KNOBS[knob as Knob] as readonly number[]).includes(n)) return null;
    settings[knob as Knob] = n;
  }
  return settings;
}

export function optionsOf(settings: Settings): SlugsOptions {
  return {
    ...DEFAULT_OPTIONS,
    turnSeconds: settings.turnSeconds,
    startHp: settings.startHp,
    windScale: settings.windScale,
    mines: settings.mines,
    barrels: settings.barrels,
    weapons: WEAPON_SETS[settings.weapons],
    roundMinutes: settings.roundMinutes,
    map: MAP_DESIGN_IDS[settings.map],
  };
}

export const themeOf = (settings: Settings): ThemeId => THEME_IDS[settings.ground];

/** The teams of a match, in seat order, as the rules are given them. */
export function setupsOf(match: Pick<SlugsMatch, 'players' | 'cpu'>, level: number): TeamSetup[] {
  const seats = teamSeats(match);
  const computers = seats.filter((seat) => !match.players[seat]).length;
  let nth = 0;
  return seats.map((seat) => {
    const player = match.players[seat];
    if (player) return { name: player.name.trim() || `Player ${seat.toUpperCase()}`, control: 'human' };
    nth++;
    return { name: computers > 1 ? `Computer ${nth}` : 'Computer', control: level as Control };
  });
}

// --- Inputs as text ---
//
// One string per seat per game. Each entry is the ticks since the entry before
// it in base 36, then what happened: K and the keys held, or an act. Each
// entry is written only from the one before, so the inputs of a seat grow by
// adding to the end of the string, which is what the rules check a write
// against (`beginsWith`).

export interface Entry {
  tick: number;
  keys?: number;
  act?: Act;
}

const KEY_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-';
const KEYS_MASK = KEY_CHARS.length - 1;
/** Three base-36 digits, for a target's x and y. */
const COORD_MOST = 36 ** 3 - 1;

/** The same shape the database rules hold `in`, `prev` and each chunk to (see database.rules.json). */
export const INPUT_SHAPE = /^([0-9a-z]{1,5}(K[0-9A-Za-z_-]|[JFRHBSX]|W[0-9a-z]|U[0-9a-z]|G[0-9a-z]|T[0-9a-z]{6}))*$/;

/** Most characters the rules let a seat's `in`, `prev` or a chunk hold. */
export const IN_MOST = 4096;
/** A seat's `in` is sealed into a chunk once the room holds this much of it. */
export const SEAL_AT = 1024;
/** Most chunks the rules let a seat seal in one game. */
export const CHUNKS_MOST = 1000;

const clampInt = (v: number, most: number) => Math.min(most, Math.max(0, Math.trunc(v)));
const b36 = (n: number, width = 1) => n.toString(36).padStart(width, '0');

/** An act as it reads back from its text, so this client runs the same act as every other. */
export function normalAct(act: Act): Act {
  switch (act.t) {
    case 'fuse':
      return { t: 'fuse', n: clampInt(act.n, 35) };
    case 'girder':
      return { t: 'girder', rot: clampInt(act.rot, 35) };
    case 'target':
      return { t: 'target', x: clampInt(act.x, COORD_MOST), y: clampInt(act.y, COORD_MOST) };
    default:
      return act;
  }
}

function actText(act: Act): string {
  switch (act.t) {
    case 'jump':
      return 'J';
    case 'flip':
      return 'F';
    case 'backjump':
      return 'R';
    case 'hop':
      return 'H';
    case 'bounce':
      return 'B';
    case 'skip':
      return 'S';
    case 'surrender':
      return 'X';
    case 'weapon': {
      const i = WEAPONS.indexOf(act.w);
      if (i < 0 || i >= 36) throw new Error(`weapon ${act.w} has no letter`);
      return `W${b36(i)}`;
    }
    case 'fuse':
      return `U${b36(clampInt(act.n, 35))}`;
    case 'girder':
      return `G${b36(clampInt(act.rot, 35))}`;
    case 'target':
      return `T${b36(clampInt(act.x, COORD_MOST), 3)}${b36(clampInt(act.y, COORD_MOST), 3)}`;
    default: {
      // A new act in the rules has to be given a letter here, and in INPUT_SHAPE and the rules' copy of it.
      const unknown: never = act;
      throw new Error(`act ${JSON.stringify(unknown)} has no letter`);
    }
  }
}

export function encodeEntry(entry: Entry, after: number): string {
  const body = entry.act ? actText(entry.act) : `K${KEY_CHARS[entry.keys! & KEYS_MASK]}`;
  return b36(entry.tick - after) + body;
}

/** `entries` after one at tick `after`, as text to add to the end of what is already written. */
export function encodeFrom(entries: readonly Entry[], after: number): string {
  let text = '';
  for (const entry of entries) {
    text += encodeEntry(entry, after);
    after = entry.tick;
  }
  return text;
}

export const encodeInputs = (entries: readonly Entry[]): string => encodeFrom(entries, 0);

const isDigit36 = (c: string) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'z');

/** The entries `text` stands for, or null when it is not inputs. Anyone can write a seat, so this is read with care. */
export function parseInputs(text: string): Entry[] | null {
  if (text.length > IN_MOST * (CHUNKS_MOST + 1) || !INPUT_SHAPE.test(text)) return null;
  const entries: Entry[] = [];
  let tick = 0;
  let i = 0;
  while (i < text.length) {
    let j = i;
    while (isDigit36(text[j])) j++;
    tick += parseInt(text.slice(i, j), 36);
    const kind = text[j];
    i = j + 1;
    if (kind === 'K') {
      entries.push({ tick, keys: KEY_CHARS.indexOf(text[i]) });
      i += 1;
      continue;
    }
    const simple = ({ J: 'jump', F: 'flip', R: 'backjump', H: 'hop', B: 'bounce', S: 'skip', X: 'surrender' } as const)[kind as 'J'];
    if (simple) {
      entries.push({ tick, act: { t: simple } });
      continue;
    }
    if (kind === 'T') {
      entries.push({ tick, act: { t: 'target', x: parseInt(text.slice(i, i + 3), 36), y: parseInt(text.slice(i + 3, i + 6), 36) } });
      i += 6;
      continue;
    }
    const n = parseInt(text[i], 36);
    i += 1;
    if (kind === 'W') {
      if (n >= WEAPONS.length) return null;
      entries.push({ tick, act: { t: 'weapon', w: WEAPONS[n] } });
    } else if (kind === 'U') {
      entries.push({ tick, act: { t: 'fuse', n } });
    } else {
      entries.push({ tick, act: { t: 'girder', rot: n } });
    }
  }
  return entries;
}

const sameEntry = (a: Entry, b: Entry) => a.tick === b.tick && encodeEntry(a, a.tick) === encodeEntry(b, b.tick);

/** Whether a seat's state as read from the room is one a game can be run on. */
export function sound(state: SlugsSeatState): boolean {
  return (
    Number.isInteger(state.seq) &&
    Number.isInteger(state.game) &&
    Number.isInteger(state.k) &&
    state.k >= 0 &&
    Number.isInteger(state.n) &&
    state.n >= 0 &&
    state.n <= CHUNKS_MOST &&
    typeof state.in === 'string' &&
    state.in.length <= IN_MOST &&
    INPUT_SHAPE.test(state.in) &&
    (state.n === 0 || typeof state.prev === 'string')
  );
}

// --- One seat's inputs, read in tick order ---

interface SeatLog {
  text: string;
  entries: Entry[];
  /** Entries before this one have been read by `inputAt`. */
  at: number;
  /** The keys as of the last tick read. */
  keys: number;
}

const emptyLog = (): SeatLog => ({ text: '', entries: [], at: 0, keys: 0 });

/** The input for `tick`. Ticks are asked for in rising order: the log is read once through. */
function inputAt(log: SeatLog, tick: number): Input {
  let act: Act | undefined;
  while (log.at < log.entries.length && log.entries[log.at].tick <= tick) {
    const entry = log.entries[log.at];
    if (entry.keys !== undefined) log.keys = entry.keys;
    // Two acts are never written for one tick by this file; one written by
    // anything else is read the same way on every client: the first counts.
    else if (entry.tick === tick && !act) act = entry.act;
    log.at++;
  }
  return act ? { keys: log.keys, act } : { keys: log.keys };
}

// --- One game as one client runs it ---

export interface Lockstep {
  game: number;
  seed: number;
  /** Team i is played from seats[i]. */
  seats: Seat[];
  setups: TeamSetup[];
  perTeam: number;
  options: SlugsOptions;
  settings: Settings;
  /** This client's seat. */
  seat: Seat;
  state: SlugsState;
  logs: Partial<Record<Seat, SeatLog>>;
  /** Sealed chunks as far as this client has them, by seat and place. Once written they never change. */
  chunks: Partial<Record<Seat, string[]>>;
  /** Each other seat's promise in this game, as last read. */
  k: Partial<Record<Seat, number>>;
  /** Seats that left a game of more than two: the computer plays them from the tick after. */
  out: Partial<Record<Seat, number>>;

  /** The write of this seat that this client's inputs are built on. */
  ownSeq: number | undefined;
  /** Every write of this client's in this game, oldest first: how it tells its own from another tab's. */
  sent: number[];
  /** The last tick this seat promised its inputs complete through. */
  promised: number;
  /** What the room holds for this seat as of `ownSeq`: the chunks sealed, the open part and the last sealed. */
  roomN: number;
  roomIn: string;
  roomPrev: string | undefined;
  /** Length of this seat's text that is sealed: chunks 0..roomN-1. */
  sealedLen: number;
  /** The last keys written for this seat, so only a change is written. */
  keys: number;
  /** The tick of this seat's last written act, so a second act goes on the tick after. */
  lastAct: number;
  /** The text as last sent, so a change to it is sent at once. */
  sentText: string;

  // Pacing.
  clock: number | null;
  budget: number;
  /** How far the other person's promise has jumped at each of the last reads that moved it, for the playback buffer. */
  jumps: number[];
  /** Events of ticks run since the screen last asked. */
  pending: SlugEvent[];
  /** The highest tick whose events the screen has been given: a run again from the start gives none of them twice. */
  shownTo: number;
  /** Times the match was run again from the start. Each run makes a new terrain array, which is what tells the scene to repaint the land. */
  reruns: number;
}

/**
 * A new game's lockstep, before anything has been heard or sent. Throws on
 * settings this client does not know: the game cannot be run the same as on a
 * client that does.
 */
export function newLockstep(match: SlugsMatch, seat: Seat): Lockstep {
  const settings = decodeSettings(match.set);
  if (!settings) throw new Error('This room was set up by a newer version of Slugs. Reload the page.');
  const seats = teamSeats(match);
  const setups = setupsOf(match, settings.level);
  const options = optionsOf(settings);
  const state = newGame(match.seed, setups, settings.perTeam, options);
  const logs: Partial<Record<Seat, SeatLog>> = {};
  for (const each of seats) if (match.players[each]) logs[each] = emptyLog();
  return {
    game: match.game,
    seed: match.seed,
    seats,
    setups,
    perTeam: settings.perTeam,
    options,
    settings,
    seat,
    state,
    logs,
    chunks: {},
    k: {},
    out: {},
    ownSeq: undefined,
    sent: [],
    promised: 0,
    roomN: 0,
    roomIn: '',
    roomPrev: undefined,
    sealedLen: 0,
    keys: 0,
    lastAct: -1,
    sentText: '',
    clock: null,
    budget: 0,
    jumps: [],
    // `newGame` already raised the first turn's events.
    pending: state.events.slice(),
    shownTo: 0,
    reruns: 0,
  };
}

const ownLog = (ls: Lockstep) => ls.logs[ls.seat]!;

/** The seat the next tick waits on: a person playing the active team, or null when the rules read nobody's input. */
export function waitsOn(ls: Lockstep): Seat | null {
  const { state } = ls;
  if (state.phase !== 'ready' && state.phase !== 'turn' && state.phase !== 'retreat') return null;
  const seat = ls.seats[state.activeTeam];
  if (state.teams[state.activeTeam].control !== 'human') return null;
  const out = ls.out[seat];
  if (out !== undefined && state.tick >= out) return null;
  return seat;
}

/** Whether every input of the next tick is known. */
export function canStep(ls: Lockstep): boolean {
  if (ls.state.phase === 'over') return false;
  const seat = waitsOn(ls);
  return seat === null || seat === ls.seat || (ls.k[seat] ?? 0) > ls.state.tick;
}

/** Run one tick. Only when canStep. */
function step(ls: Lockstep): void {
  const { state } = ls;
  // A seat that left is handed to the computer on the first tick after its
  // last promise, which every client reaches with the same state: nobody can
  // run that seat's turn past its promise until then.
  for (const [seat, from] of Object.entries(ls.out) as [Seat, number][]) {
    const team = state.teams[ls.seats.indexOf(seat)];
    if (state.tick >= from && team.control === 'human') team.control = ls.settings.level as Control;
  }
  const seat = waitsOn(ls);
  advance(state, seat ? inputAt(ls.logs[seat]!, state.tick + 1) : { keys: 0 });
}

/** Run the match again from its start up to where it was, giving none of the replayed ticks' events. */
function rerun(ls: Lockstep): void {
  const to = ls.state.tick;
  ls.state = newGame(ls.seed, ls.setups, ls.perTeam, ls.options);
  for (const log of Object.values(ls.logs)) {
    log.at = 0;
    log.keys = 0;
  }
  while (ls.state.tick < to && canStep(ls)) step(ls);
  ls.pending = [];
  ls.reruns++;
}

/**
 * This seat's inputs once what the room holds for it is taken in: `mine`
 * itself when that changes nothing. Otherwise the room's come first, as the
 * other clients have them, and after them whatever this client gave that the
 * room's promise still leaves room for, as Swarm's withStored does. An input
 * dropped there is one a second tab on the seat was overtaken on.
 */
export function withStored(mine: Entry[], kept: Entry[], k: number): Entry[] {
  let shared = 0;
  while (shared < mine.length && shared < kept.length && sameEntry(mine[shared], kept[shared])) shared++;
  const unsent = mine.slice(shared);
  if (shared === kept.length && unsent.every((entry) => entry.tick > k)) return mine;
  // Not before the room's last either: the text can only count forward.
  const last = kept.length ? kept[kept.length - 1].tick : 0;
  return [...kept, ...unsent.filter((entry) => entry.tick > k && entry.tick >= last)];
}

/**
 * Whether a read of the room shows a write of this tab's older than one it
 * knows has landed since (Swarm's `behind`). Going back to it would get the
 * next write refused.
 */
function behind(ls: Lockstep, seen: number): boolean {
  return ls.ownSeq !== undefined && seen < ls.ownSeq && ls.sent.includes(seen) && ls.sent.includes(ls.ownSeq);
}

/** A seat's sealed chunks 0..n-1, from what this client has or the room read; undefined while one is missing. */
function chunksOf(ls: Lockstep, room: SlugsRoom, seat: Seat, n: number): string[] | undefined {
  const known = (ls.chunks[seat] ??= []);
  const read = chunksIn(room, ls.game, seat);
  for (let i = known.length; i < n; i++) {
    const text = read?.[chunkKey(i)];
    if (typeof text !== 'string' || text.length > IN_MOST || !INPUT_SHAPE.test(text)) return undefined;
    known.push(text);
  }
  return known.slice(0, n);
}

/** Add chunks fetched on their own (getChunks), so the next read of the room can use them. */
export function addChunks(ls: Lockstep, seat: Seat, byKey: Record<string, string>): void {
  const known = (ls.chunks[seat] ??= []);
  for (let text = byKey[chunkKey(known.length)]; typeof text === 'string'; text = byKey[chunkKey(known.length)]) {
    if (text.length > IN_MOST || !INPUT_SHAPE.test(text)) return;
    known.push(text);
  }
}

const PLAYBACK_JUMPS = 8;

/**
 * Take in a read of the room. Returns the seats whose sealed chunks this
 * client does not have yet: they are fetched, and the room taken in again.
 *
 * The room's copy of this seat's own inputs is read as well as the others'. A
 * tab that was reloaded starts with none and has to take them back, and the
 * same seat open in a second tab is giving inputs this one has not seen;
 * either way the other clients are running them.
 */
export function takeRoom(ls: Lockstep, room: SlugsRoom): Seat[] {
  const missing: Seat[] = [];
  if (room.m.game === ls.game && room.m.out) {
    for (const seat of ls.seats) {
      const from = room.m.out[seat];
      if (from !== undefined && ls.out[seat] === undefined) ls.out[seat] = from;
    }
  }
  for (const seat of ls.seats) {
    const log = ls.logs[seat];
    const stored = room.s?.[seat];
    if (!log || !stored || stored.game !== ls.game || !sound(stored)) continue;
    if (seat === ls.seat) {
      if (stored.seq === ls.ownSeq || behind(ls, stored.seq)) continue;
      const chunks = chunksOf(ls, room, seat, stored.n);
      if (!chunks) {
        missing.push(seat);
        continue;
      }
      const kept = parseInputs(chunks.join('') + stored.in);
      if (!kept) continue;
      takeOwn(ls, stored, chunks, kept);
      continue;
    }
    if (stored.k < (ls.k[seat] ?? 0)) continue;
    const chunks = chunksOf(ls, room, seat, stored.n);
    if (!chunks) {
      missing.push(seat);
      continue;
    }
    const text = chunks.join('') + stored.in;
    if (text !== log.text) {
      // An older read than one already taken in: reads and writes cross on the wire.
      if (log.text.startsWith(text)) continue;
      const entries = parseInputs(text);
      if (!entries) continue;
      const grew = text.startsWith(log.text);
      log.text = text;
      log.entries = entries;
      // The rules let a seat's text only grow while its game is played. One
      // that did not was read in some other way; it is run again rather than trusted.
      if (!grew) rerun(ls);
    }
    const before = ls.k[seat] ?? 0;
    if (stored.k > before) {
      ls.jumps.push(stored.k - before);
      if (ls.jumps.length > PLAYBACK_JUMPS) ls.jumps.shift();
    }
    ls.k[seat] = stored.k;
  }
  return missing;
}

function takeOwn(ls: Lockstep, stored: SlugsSeatState, chunks: string[], kept: Entry[]): void {
  const log = ownLog(ls);
  ls.ownSeq = stored.seq;
  ls.promised = Math.max(ls.promised, stored.k);
  ls.roomN = stored.n;
  ls.roomIn = stored.in;
  ls.roomPrev = stored.prev;
  ls.sealedLen = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = withStored(log.entries, kept, stored.k);
  if (merged === log.entries) return;
  let differ = 0;
  while (differ < merged.length && differ < log.entries.length && sameEntry(merged[differ], log.entries[differ])) differ++;
  const first = Math.min(merged[differ]?.tick ?? Infinity, log.entries[differ]?.tick ?? Infinity);
  const storedText = chunks.join('') + stored.in;
  log.text = storedText + encodeFrom(merged.slice(kept.length), kept.length ? kept[kept.length - 1].tick : 0);
  log.entries = merged;
  const lastKeys = [...merged].reverse().find((entry) => entry.keys !== undefined);
  ls.keys = lastKeys?.keys ?? 0;
  const lastAct = [...merged].reverse().find((entry) => entry.act);
  ls.lastAct = lastAct?.tick ?? -1;
  // Entries the reader has passed may have changed under it.
  if (first <= ls.state.tick) rerun(ls);
  else log.at = Math.min(log.at, differ);
}

/** Whether this machine plays the team whose turn it is. */
export function myTurn(ls: Lockstep): boolean {
  return waitsOn(ls) === ls.seat;
}

/**
 * Write down what this machine is pressing. Keys are written whenever they
 * change; an act only on this seat's turn, when the rules would read it. The
 * input is turned down when it would not fit what a seat may store: past that
 * every write would be refused and the seat's promise would stop moving.
 */
export function record(ls: Lockstep, input: Input): void {
  const { state } = ls;
  if (state.phase === 'over') return;
  const log = ownLog(ls);
  const lastTick = log.entries.length ? log.entries[log.entries.length - 1].tick : 0;
  const keys = input.keys & KEYS_MASK;
  if (keys !== ls.keys) {
    add(ls, { tick: orderTick(state.tick + 1, ls.promised, state.tick, lastTick), keys });
  }
  if (input.act && myTurn(ls)) {
    const last = log.entries.length ? log.entries[log.entries.length - 1].tick : 0;
    add(ls, { tick: orderTick(state.tick + 1, ls.promised, state.tick, Math.max(last, ls.lastAct + 1)), act: normalAct(input.act) });
  }
}

function add(ls: Lockstep, entry: Entry): void {
  const log = ownLog(ls);
  const after = log.entries.length ? log.entries[log.entries.length - 1].tick : 0;
  const text = encodeEntry(entry, after);
  if (log.text.length + text.length - ls.sealedLen - (ls.roomIn.length >= SEAL_AT ? ls.roomIn.length : 0) > IN_MOST) return;
  log.text += text;
  log.entries.push(entry);
  if (entry.keys !== undefined) ls.keys = entry.keys;
  else ls.lastAct = entry.tick;
}

/** A chunk to seal before a seat write, at its place among the seat's chunks. */
export interface Seal {
  index: number;
  text: string;
}

/**
 * What this seat writes now, and the chunk to seal first when the room holds
 * enough of its inputs. Sending it is a promise, so it is made here and not
 * when the write lands.
 */
export function sending(ls: Lockstep, seq: number): { write: SeatWrite; seal?: Seal } {
  ls.promised = Math.max(ls.promised, ls.state.tick);
  ls.sent.push(seq);
  const text = ownLog(ls).text;
  ls.sentText = text;
  let n = ls.roomN;
  let prev = ls.roomPrev;
  let from = ls.sealedLen;
  let seal: Seal | undefined;
  if (ls.roomIn.length >= SEAL_AT && n < CHUNKS_MOST) {
    seal = { index: n, text: ls.roomIn };
    n += 1;
    prev = ls.roomIn;
    from += ls.roomIn.length;
  }
  const write: SeatWrite = {
    seq,
    game: ls.game,
    k: ls.promised,
    n,
    in: text.slice(from),
    ...(prev !== undefined && { prev }),
    ...(ls.ownSeq !== undefined && { base: ls.ownSeq }),
  };
  return seal ? { write, seal } : { write };
}

/** The chunk is in the room: this client can count on it. */
export function sealed(ls: Lockstep, seal: Seal): void {
  const known = (ls.chunks[ls.seat] ??= []);
  if (known.length === seal.index) known.push(seal.text);
}

/** A write of this seat's has landed. Unless the room moved on from what it was built on, it is now what the next one builds on. */
export function landed(ls: Lockstep, write: SeatWrite): void {
  if (ls.ownSeq !== write.base) return;
  ls.ownSeq = write.seq;
  if (write.n > ls.roomN) ls.sealedLen += ls.roomIn.length;
  ls.roomN = write.n;
  ls.roomIn = write.in;
  ls.roomPrev = write.prev;
}

/**
 * What a seat writes while it is not running a game: the lobby's heartbeat.
 * In a game it repeats what the room holds for it, as Swarm's restingReport
 * does: saying "no game" there would withdraw inputs the other client has
 * run. A finished game's are kept too, for a client still playing its end.
 */
export function restingReport(match: Pick<SlugsMatch, 'game'>, stored: SlugsSeatState | undefined, seq: number): SeatWrite {
  if (match.game > 0 && stored?.game === match.game && sound(stored)) {
    return {
      seq,
      game: stored.game,
      k: stored.k,
      n: stored.n,
      in: stored.in,
      ...(stored.prev !== undefined && { prev: stored.prev }),
      base: stored.seq,
    };
  }
  return { seq, game: 0, k: 0, n: 0, in: '' };
}

/** Swarm's: on this seat's turn a write goes at least this often in ticks, so the other client can run on. */
export const REPORT_EVERY = 4;

/** Whether this seat should write now, given when it last did. */
export function reportDue(ls: Lockstep, sinceLastMs: number): boolean {
  if (sinceLastMs >= BEAT_LIVE_MS) return true;
  if (!myTurn(ls)) return false;
  return ownLog(ls).text !== ls.sentText || ls.state.tick - ls.promised >= REPORT_EVERY;
}

// --- Pacing ---

/**
 * Most ticks one frame runs while keeping time: a second's worth. A hidden tab
 * is run from a timer the browser holds to once a second, and on this seat's
 * turn the other client is waiting on it.
 */
const FRAME_MOST = 50;
/** Most ticks one frame runs while catching up: a reload deep into a match, or a long wait ending. About 60ms of rules on a laptop. */
const CATCH_UP_MOST = 1000;
/** Behind the furthest promise by this much, the match is caught up at full speed instead of played. 5 seconds. */
const CATCH_UP_FROM = 250;
/** Bounds on how far behind the other person's promise their turn is played. 0.12 to 1 second. */
const BUFFER_LEAST = 6;
const BUFFER_MOST = 50;

/** How many ticks behind the other person's promise their turn is played: as much as their promise has jumped lately. */
export function bufferOf(ls: Lockstep): number {
  return Math.min(BUFFER_MOST, Math.max(BUFFER_LEAST, ...ls.jumps));
}

/** The furthest tick any seat has promised. Behind it, nothing is new to anyone. */
function horizon(ls: Lockstep): number {
  return Math.max(ls.promised, ...Object.values(ls.k));
}

/**
 * Bring the match up to `now` (a local clock in ms) on the inputs known, and
 * hand back the state with every event since the last call in
 * `state.events`. Time is this machine's own: a tick waits only for an input
 * not yet known, so no clock is shared and none can step back between clients.
 */
export function frame(ls: Lockstep, now: number, input: Input): SlugsState {
  const elapsed = ls.clock === null ? 0 : Math.max(0, now - ls.clock);
  ls.clock = now;
  record(ls, input);

  const { state } = ls;
  const waiting = waitsOn(ls);
  let rate = 1;
  if (waiting !== null && waiting !== ls.seat) {
    const lag = (ls.k[waiting] ?? 0) - state.tick;
    const buffer = bufferOf(ls);
    rate = lag < buffer ? 0.8 : lag > 2 * buffer ? 1.5 : 1;
  }
  ls.budget = Math.min(ls.budget + (elapsed / TICK_MS) * rate, FRAME_MOST);
  if (horizon(ls) - state.tick > CATCH_UP_FROM) ls.budget = CATCH_UP_MOST;

  while (ls.budget >= 1 && canStep(ls)) {
    step(ls);
    ls.budget -= 1;
    if (ls.state.tick > ls.shownTo) {
      ls.pending.push(...ls.state.events);
      ls.shownTo = ls.state.tick;
    }
  }
  // Time spent waiting is not owed afterwards: the match resumes at its own pace.
  if (!canStep(ls)) ls.budget = Math.min(ls.budget, 1);

  ls.state.events = ls.pending;
  ls.pending = [];
  return ls.state;
}

/** The result as this client's own state has it: a seat, 'draw', or null while the match is on. */
export function resultOf(ls: Lockstep): Seat | 'draw' | null {
  const { state } = ls;
  if (state.phase !== 'over') return null;
  return state.winner === null ? 'draw' : ls.seats[state.winner];
}

