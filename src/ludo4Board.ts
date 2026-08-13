// Ludo4 (four-player, circular board) — shared types, constants and helpers.
//
// Ludo4 is Ludo3's four-seat sibling: the same classic rules on a 56-cell ring
// (4 arms × 14 cells, the same arm length as Ludo3's and the classic board's).
// Each color starts at start = 1 + 14·k, enters its final column at start − 1
// (mod 56), and safe zones sit on every start cell and start + 6. Token
// serialization reuses serializeTokens/deserializeTokens from ludoFirebase
// (length-agnostic).
//
// The run home is five cells and a player has five counters, one per cell: a
// counter is home only once it stands in a cell of its own, which it can only
// reach on an exact roll. There is no pile at the centre to overflow into, so a
// counter that cannot land keeps waiting out on the track — where it can still
// be sent back to the yard. That exposure is the point of the rule (see
// ludo3GameLogic for the simulation that retired the walk-in alternative).

import type { TokenPosition, TurnPhase, LudoPlayer } from './ludoFirebase';
import { deserializeTokens } from './ludoFirebase';

// --- Types ---

export type Ludo4Color = 'red' | 'green' | 'yellow' | 'blue';

export interface Ludo4GameState {
  players: {
    red?: LudoPlayer | null;
    green?: LudoPlayer | null;
    yellow?: LudoPlayer | null;
    blue?: LudoPlayer | null;
  };
  /** Which seat created the room. Seats are handed out at random, so the host
   * is not necessarily red — legacy games without this field default to red. */
  host?: Ludo4Color;
  tokens: string; // 20 tokens × 3 chars = 60
  currentTurn: Ludo4Color;
  turnPhase: TurnPhase;
  diceValue: number | null;
  /** The face last rolled by anyone. diceValue is cleared the moment a move is
   * committed, so on its own the die is blank almost all the time and an
   * opponent's roll is never visible. This is never cleared mid-game. */
  lastRoll?: number | null;
  consecutiveSixes: number;
  winner: Ludo4Color | null;
  finishOrder: string;
  createdAt: number;
  startedAt: number | null;
  turnStartedAt: number;
  playerCount: number;
  paused?: boolean;
  pausedAt?: number;
  singlePlayer?: boolean;
  rollStats?: string; // "r1,..,r6,captures,warm|g...|y...|b..." (4 groups)
  /** Consecutive shut-in throws without a 6, one count per seat ("0,0,0,0").
   * The warm die's memory (see requestYardRoll). Missing reads as cold, so
   * legacy rooms and old clients simply play on fair. */
  yardMisses?: string;
  /** How many pack throws each seat has taken ("0,0,0,0") — the whole pack is
   * derived from this and the room's seed (see the pack section below).
   * Missing reads as zero, so a legacy room starts every seat on a fresh
   * pack. */
  packThrows?: string;
}

export interface Ludo4MoveUpdate {
  tokens: string;
  currentTurn: Ludo4Color;
  turnPhase: TurnPhase;
  diceValue: number | null;
  /** Omit to preserve the stored value — makeMove spreads updates over current. */
  lastRoll?: number | null;
  consecutiveSixes: number;
  winner: Ludo4Color | null;
  finishOrder: string;
  turnStartedAt: number | object; // accepts serverTimestamp() sentinel
  rollStats?: string;
  /** Omit to preserve the stored counts — only turn-resolving writes carry it. */
  yardMisses?: string;
  /** Rides exactly where rollStats rides — same monotone counts, same merge. */
  packThrows?: string;
}

// --- Board constants ---

export const TRACK_SIZE = 56;
/** Cells in a run home — and, deliberately, counters per player: every cell
 * has to end up with a counter standing in it for that player to be finished. */
export const FINAL_SIZE = 5;
export const TOKENS_PER_PLAYER = FINAL_SIZE;
export const TOTAL_TOKENS = TOKENS_PER_PLAYER * 4;
export const PLAYER_COLORS: Ludo4Color[] = ['red', 'green', 'yellow', 'blue'];

export const START_POSITIONS: Record<Ludo4Color, number> = {
  red: 1, green: 15, yellow: 29, blue: 43,
};

/**
 * Where each colour turns off the ring for its run home: the cell immediately
 * before its own start, so the haven you come out on sits at the foot of your
 * own bridge rather than two cells round from it.
 *
 * One short of the start is as close as it can get. A counter standing *on* its
 * entry cell goes into the run home on its next move — calculateNewPosition has
 * no notion of laps — so start = entry would send a counter from the yard to
 * home in two moves without it ever travelling the ring.
 */
export const ENTRY_CELLS: Record<Ludo4Color, number> = {
  red: 56, green: 14, yellow: 28, blue: 42,
};

/**
 * Havens: every start cell, and the cell six on from each start.
 *
 * The same reasoning as Ludo3's, which holds here unchanged because the arms
 * are the same fourteen cells long: the start cells have to be safe or
 * deploying is suicide, which makes a counter parked on its own start the
 * strongest square in the game — it covers the six cells ahead of it, which are
 * where every other colour is at its most exposed. Putting the second haven at
 * start + 6 takes the last of those six off the camper's guns and gives the
 * runner something to aim at: an exact six carries a counter from one haven to
 * the next, and a six buys another roll, so the leap is paid for. The 6, 8
 * spacing that falls out lands each star near dead centre of the blank stretch
 * between two yards.
 */
export const SAFE_ZONES = new Set([1, 7, 15, 21, 29, 35, 43, 49]);

const COLOR_OFFSET: Record<Ludo4Color, number> = {
  red: 0,
  green: TOKENS_PER_PLAYER,
  yellow: TOKENS_PER_PLAYER * 2,
  blue: TOKENS_PER_PLAYER * 3,
};

export const INITIAL_TOKENS = 'bas'.repeat(TOTAL_TOKENS); // 60 chars

// --- Helpers ---

export function colorIndex(color: Ludo4Color): number {
  return PLAYER_COLORS.indexOf(color);
}

export function getColorTokenIndices(color: Ludo4Color): number[] {
  const offset = COLOR_OFFSET[color];
  return Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => offset + i);
}

export function getTokenColor(index: number): Ludo4Color {
  if (index < COLOR_OFFSET.green) return 'red';
  if (index < COLOR_OFFSET.yellow) return 'green';
  if (index < COLOR_OFFSET.blue) return 'yellow';
  return 'blue';
}

/** Which cells of `color`'s run home already have a counter standing in them.
 * A counter may pass over an occupied cell but never stop on one. */
export function getOccupiedFinals(tokens: TokenPosition[], color: Ludo4Color): Set<number> {
  const occupied = new Set<number>();
  for (const i of getColorTokenIndices(color)) {
    const pos = tokens[i];
    if (pos && pos.startsWith('final-')) occupied.add(parseInt(pos.split('-')[1]));
  }
  return occupied;
}

/** Deserialize a stored token string to exactly TOTAL_TOKENS entries. Rooms
 * written by an older client are shorter; pad rather than hand the board a
 * sparse array it will read past the end of. */
export function deserializeLudo4Tokens(str: string): TokenPosition[] {
  const parsed = deserializeTokens(str).slice(0, TOTAL_TOKENS);
  while (parsed.length < TOTAL_TOKENS) parsed.push('base');
  return parsed;
}

/**
 * The highest score getPlayerScore can return: every counter standing in a cell
 * of the run home, one per cell.
 *
 * Not TOKENS_PER_PLAYER × (TRACK_SIZE + FINAL_SIZE) — only one counter can hold
 * the deepest cell, so the run-home half of the sum is 1+2+…+FINAL_SIZE rather
 * than FINAL_SIZE apiece. A meter scaled to that looser bound stops short of
 * full even for the player who has just won.
 */
export const MAX_PLAYER_SCORE =
  TOKENS_PER_PLAYER * TRACK_SIZE + (FINAL_SIZE * (FINAL_SIZE + 1)) / 2;

/**
 * A position in the words the board uses. 'track-17' is a storage detail; what
 * a player is looking at is space 17. Used for piece labels and announcements,
 * which are the two places the raw string would otherwise be read aloud.
 */
export function describePosition(pos: TokenPosition): string {
  if (pos === 'base') return 'the yard';
  if (pos.startsWith('final-')) return `home ${pos.split('-')[1]}`;
  if (pos.startsWith('track-')) return `space ${pos.split('-')[1]}`;
  return pos;
}

export interface Ludo4Standing {
  color: Ludo4Color;
  score: number;
  finished: boolean;
}

/**
 * Final placings. The game ends the moment one player fills their run home, so
 * the seats behind them are separated by how far round they got rather than by
 * the order they finished in — only the winner ever finishes.
 *
 * Anyone in `finishOrder` is placed first and in that order; the rest follow by
 * race score, ties broken by seat order so every client renders the same board.
 */
export function getStandings(
  tokens: TokenPosition[],
  playerCount: number,
  finishOrder: Ludo4Color[]
): Ludo4Standing[] {
  const active = PLAYER_COLORS.slice(0, playerCount);
  const finished = finishOrder.filter(c => active.includes(c));
  const rest = active
    .filter(c => !finished.includes(c))
    .sort((a, b) => {
      const diff = getPlayerScore(tokens, b) - getPlayerScore(tokens, a);
      return diff !== 0 ? diff : active.indexOf(a) - active.indexOf(b);
    });
  return [...finished, ...rest].map(color => ({
    color,
    score: getPlayerScore(tokens, color),
    finished: finished.includes(color),
  }));
}

/**
 * Race-progress score for a player. Higher = closer to finishing.
 * Shown on the board's score badges and used by the bot heuristics.
 */
export function getPlayerScore(tokens: TokenPosition[], color: Ludo4Color): number {
  return getColorTokenIndices(color).reduce((sum, i) => {
    const pos = tokens[i];
    if (pos === 'base') return sum;
    if (pos.startsWith('final-')) return sum + TRACK_SIZE + parseInt(pos.split('-')[1]);
    if (pos.startsWith('track-')) {
      const track = parseInt(pos.split('-')[1]);
      const start = START_POSITIONS[color];
      const dist = track >= start ? track - start : (TRACK_SIZE - start) + track;
      return sum + Math.max(1, dist); // tokens on track always score at least 1
    }
    return sum;
  }, 0);
}

// --- Roll stats (4 color groups: red|green|yellow|blue) ---

/**
 * `warm` exists because the other seven numbers are read as a fairness record
 * and, on their own, they lie by omission. A seat that spent turns stuck
 * behind its own yard throws a die that leans to the 6 (see requestYardRoll),
 * so the player who had the *worst* luck shows the *most* 6s — which is
 * exactly the reading that gets the die called crooked. Counting the warm
 * throws puts the explanation on the card beside the number it explains.
 */
export type RollStats = { rolls: number[]; captures: number; warm: number }[];

function emptyRollStats(): RollStats {
  return PLAYER_COLORS.map(() => ({ rolls: [0, 0, 0, 0, 0, 0], captures: 0, warm: 0 }));
}

export function initRollStats(): string {
  return serializeRollStats(emptyRollStats());
}

export function serializeRollStats(stats: RollStats): string {
  return stats.map(s => [...s.rolls, s.captures, s.warm].join(',')).join('|');
}

export function deserializeRollStats(str: string): RollStats {
  const result = emptyRollStats();
  if (!str) return result;
  const parts = str.split('|');
  for (let i = 0; i < result.length; i++) {
    if (i < parts.length && parts[i]) {
      const nums = parts[i].split(',').map(Number);
      for (let j = 0; j < 6; j++) result[i].rolls[j] = nums[j] || 0;
      result[i].captures = nums[6] || 0;
      // Absent in rooms written before the warm throw was counted — reads as
      // zero, which is the truthful answer for a tally that never tracked it.
      result[i].warm = nums[7] || 0;
    }
  }
  return result;
}

/** Record one throw. `warm` marks it as coming off the shut-out die rather
 * than the pack — see RollStats. */
export function recordRoll(
  stats: RollStats,
  colorIdx: number,
  diceValue: number,
  warm = false
): RollStats {
  const result = stats.map(s => ({ rolls: [...s.rolls], captures: s.captures, warm: s.warm }));
  const idx = Math.max(0, Math.min(diceValue, 6) - 1);
  result[colorIdx].rolls[idx]++;
  if (warm) result[colorIdx].warm++;
  return result;
}

export function recordCapture(stats: RollStats, colorIdx: number): RollStats {
  const result = stats.map(s => ({ rolls: [...s.rolls], captures: s.captures, warm: s.warm }));
  result[colorIdx].captures++;
  return result;
}

/**
 * Merge two serialized roll-stat strings cell-by-cell taking the max, so
 * concurrent writers can't clobber each other's counts (same strategy as v1).
 */
export function mergeRollStats(a: string, b: string): string {
  const sa = deserializeRollStats(a);
  const sb = deserializeRollStats(b);
  const merged = sa.map((s, i) => ({
    rolls: s.rolls.map((r, j) => Math.max(r, sb[i].rolls[j])),
    captures: Math.max(s.captures, sb[i].captures),
    warm: Math.max(s.warm, sb[i].warm),
  }));
  return serializeRollStats(merged);
}

// --- Shut-in misses (the warm die's memory) ----------------------------------

/** Parse "a,b,c" per-seat miss counts. Anything absent or malformed reads as
 * zero, so a legacy room or a garbled write starts a seat cold, never warm. */
export function parseYardMisses(str: string | undefined | null): number[] {
  const out = PLAYER_COLORS.map(() => 0);
  if (!str) return out;
  const parts = str.split(',');
  for (let i = 0; i < out.length && i < parts.length; i++) {
    const n = parseInt(parts[i], 10);
    if (Number.isFinite(n) && n > 0) out[i] = n;
  }
  return out;
}

export function serializeYardMisses(misses: number[]): string {
  return PLAYER_COLORS.map((_, i) => misses[i] ?? 0).join(',');
}

// --- The dice pack -----------------------------------------------------------
//
// Every seat throws from its own pack: three of every face, shuffled, dealt in
// order — and cut, so the pack is reshuffled at a point nobody can see. One
// throw in WILD_IN comes off a fresh die instead of the pack.
//
// The first cut of this was a plain pack of eighteen drawn to exhaustion. It
// delivered exactly what it promised — every seat's tally within one or two of
// every other's — and the table rejected it for the same reason: with the
// per-face counts printed on the seat cards, a pack you can see the end of is a
// pack you can count. Measured, a watcher could name a player's next face 32.9%
// of the time against a true die's 16.7%, and the tallies finished so level the
// game read as arithmetic rather than dice. The cut and the wild throw put the
// uncertainty back: 23.9% guessable even to someone who somehow knew the pack
// state, seat-to-seat gaps of about three 6s rather than one, and the drought
// and yard guarantees untouched.
//
// The warm yard die is the one throw that does not come off the pack — its own
// stated exception, its own stated curve, and it does not advance the count.

/** Three of each face in a full pack. */
export const PACK_PER_FACE = 3;
/** A full pack, before the cut takes some of it away. */
export const PACK_SIZE = 6 * PACK_PER_FACE;
/** The cut never falls before this, so a pack always deals most of itself. */
export const PACK_CUT_MIN = 12;
/** One throw in this many is wild — a fresh die, not a card off the pack. */
export const WILD_IN = 7;

/**
 * What is synced is not the pack, nor the faces drawn from it, but a single
 * count per seat: how many pack throws that seat has taken. Everything else —
 * which pack, how it was shuffled, where it is cut, which throws are wild — is
 * derived from that count and the room's seed.
 *
 * That is what makes the throw idempotent, and idempotence is the whole reason
 * for the design. Bot turns are thrown by whichever human client gets there
 * first, and two clients can both reach the same turn before either one's write
 * has been polled by the other. Under a stored draw-history they would generate
 * two *different* faces, and a cell-wise max merge would keep both — one bot
 * turn quietly burning two dice out of the pack. Here both clients compute the
 * same throw index, so they compute the same face; the merge takes the max of
 * two equal counts and the duplicate costs nothing. The race is not defended
 * against, it is designed out.
 *
 * The count only grows, so the merge stays safe under every other concurrent
 * write as well, exactly as rollStats does.
 */
export function initPackThrows(): string {
  return PLAYER_COLORS.map(() => 0).join(',');
}

/** Absent or garbled reads as zero throws — a legacy room or an old client's
 * write starts a seat on a fresh pack, never a part-dealt one. */
export function parsePackThrows(str: string | undefined | null): number[] {
  const out = PLAYER_COLORS.map(() => 0);
  if (!str) return out;
  const parts = str.split(',');
  for (let i = 0; i < out.length && i < parts.length; i++) {
    const n = parseInt(parts[i], 10);
    if (Number.isFinite(n) && n > 0) out[i] = n;
  }
  return out;
}

export function serializePackThrows(throws: number[]): string {
  return PLAYER_COLORS.map((_, i) => Math.max(0, throws[i] ?? 0)).join(',');
}

/** Merge two serialized counts taking the per-seat max — monotone counts, so a
 * concurrent writer can never wind a seat's pack backwards, and a duplicate
 * throw of the same index merges to itself. */
export function mergePackThrows(a: string, b: string): string {
  const pa = parsePackThrows(a);
  const pb = parsePackThrows(b);
  return serializePackThrows(pa.map((n, i) => Math.max(n, pb[i])));
}

/**
 * The room's seed: the game code and the moment it was created, mixed. Every
 * client derives the same one, so every client deals the same pack.
 *
 * This is a hidden shuffle, not a secret one. Someone who reimplemented these
 * functions and knew the room's createdAt could deal the pack out ahead of the
 * game — which is a fair description of a marked deck, and the reason this is
 * acceptable is that it is a casual game hidden behind a search palette among
 * people sharing a roadmap. What it buys is worth the trade: every client
 * agreeing on every face, which is what makes a bot's turn safe to throw twice.
 */
export function packSeed(gameCode: string, createdAt: number): number {
  let h = 0x811c9dc5;
  const s = `${gameCode}:${createdAt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** One round of mixing — enough for a pack shuffle nobody is attacking. */
function mix(seed: number, a: number, b: number, c: number): number {
  let h = (seed ^ Math.imul(a + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ Math.imul(b + 0x165667b1, 0x27d4eb2f)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = (h ^ Math.imul(c + 0x9e3779b9, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x2545f491) >>> 0;
  return h >>> 0;
}

/** Where pack `packIdx` is cut: PACK_CUT_MIN..PACK_SIZE throws, then reshuffle.
 * Never the same twice running for long, and never visible in the state. */
export function packCut(seed: number, seatIdx: number, packIdx: number): number {
  return PACK_CUT_MIN + (mix(seed, seatIdx, packIdx, 0x0c07) % (PACK_SIZE - PACK_CUT_MIN + 1));
}

/** The shuffled order of one pack: three of every face, Fisher-Yates with a
 * generator seeded from the room, the seat and the pack number. */
export function packOrder(seed: number, seatIdx: number, packIdx: number): number[] {
  const cards: number[] = [];
  for (let face = 1; face <= 6; face++) {
    for (let n = 0; n < PACK_PER_FACE; n++) cards.push(face);
  }
  for (let i = cards.length - 1; i > 0; i--) {
    const j = mix(seed, seatIdx, packIdx, i) % (i + 1);
    const t = cards[i];
    cards[i] = cards[j];
    cards[j] = t;
  }
  return cards;
}

/**
 * The face for one seat's Nth pack throw — the whole die, as a pure function.
 *
 * Walks the cuts to find which pack this throw falls in and how far into it,
 * then either deals that card or, one throw in WILD_IN, throws a fresh die
 * instead. The walk is bounded by the throw count (a long game is a couple of
 * hundred throws, each pack at least PACK_CUT_MIN of them), so it stays cheap.
 */
export function packFace(seed: number, seatIdx: number, throwIndex: number): number {
  let packIdx = 0;
  let base = 0;
  // A guard, not a rule: at PACK_CUT_MIN per pack this cannot spin, but a
  // corrupt count must not hang the client mid-turn.
  for (let guard = 0; guard < 10000; guard++) {
    const cut = packCut(seed, seatIdx, packIdx);
    if (throwIndex < base + cut) break;
    base += cut;
    packIdx++;
  }
  const offset = throwIndex - base;
  // The wild throw: the reason a face the pack has run out of is unlikely
  // rather than impossible, and the reason a hot streak can still happen.
  if (mix(seed, seatIdx, packIdx * 1000 + offset, 0x77d1) % WILD_IN === 0) {
    return 1 + (mix(seed, seatIdx, packIdx * 1000 + offset, 0x51ed) % 6);
  }
  return packOrder(seed, seatIdx, packIdx)[offset] ?? 6;
}
