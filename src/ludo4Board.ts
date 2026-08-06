// Ludo4 (four-player, circular board) — shared types, constants and helpers.
//
// Ludo4 is Ludo2's four-seat sibling: the same classic rules on a 56-cell ring
// (4 arms × 14 cells, the same arm length as Ludo2's and the classic board's).
// Each color starts at start = 1 + 14·k, enters its final column at start − 1
// (mod 56), and safe zones sit on every start cell and start + 6. Token
// serialization reuses serializeTokens/deserializeTokens from ludoFirebase
// (length-agnostic).
//
// The run home is five cells deep and a player has five counters. Counters walk
// in rather than having to land exactly: any number may share a cell, and a
// roll that would carry one past the end stops it on the last cell. A player is
// finished once all five are somewhere in the run home. (The exact-landing rule
// deadlocked Ludo2's endgame — see ludo2GameLogic — so this board never had it.)

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
  rollStats?: string; // "r1,..,r6,captures|g...|y...|b..." (4 groups)
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
}

// --- Board constants ---

export const TRACK_SIZE = 56;
/** Cells in a run home, and counters per player. Counters may share a cell —
 * a player is finished once all of theirs are somewhere in the run home. */
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
 * The same reasoning as Ludo2's, which holds here unchanged because the arms
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

/** Deserialize a stored token string to exactly TOTAL_TOKENS entries. Rooms
 * written by an older client are shorter; pad rather than hand the board a
 * sparse array it will read past the end of. */
export function deserializeLudo4Tokens(str: string): TokenPosition[] {
  const parsed = deserializeTokens(str).slice(0, TOTAL_TOKENS);
  while (parsed.length < TOTAL_TOKENS) parsed.push('base');
  return parsed;
}

/**
 * The highest score getPlayerScore can return: every counter on the last cell
 * of the run home.
 *
 * FINAL_SIZE apiece, not 1+2+…+FINAL_SIZE — counters walk in and may share a
 * cell, so all of them can pile onto the deepest one (see Ludo2's note; the
 * walk-in rule was inherited, so the true ceiling was too). A winner need not
 * read 100%: finishing only means every counter is *in* the run home.
 */
export const MAX_PLAYER_SCORE = TOKENS_PER_PLAYER * (TRACK_SIZE + FINAL_SIZE);

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

export type RollStats = { rolls: number[]; captures: number }[];

function emptyRollStats(): RollStats {
  return PLAYER_COLORS.map(() => ({ rolls: [0, 0, 0, 0, 0, 0], captures: 0 }));
}

export function initRollStats(): string {
  return serializeRollStats(emptyRollStats());
}

export function serializeRollStats(stats: RollStats): string {
  return stats.map(s => [...s.rolls, s.captures].join(',')).join('|');
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
    }
  }
  return result;
}

export function recordRoll(stats: RollStats, colorIdx: number, diceValue: number): RollStats {
  const result = stats.map(s => ({ rolls: [...s.rolls], captures: s.captures }));
  const idx = Math.max(0, Math.min(diceValue, 6) - 1);
  result[colorIdx].rolls[idx]++;
  return result;
}

export function recordCapture(stats: RollStats, colorIdx: number): RollStats {
  const result = stats.map(s => ({ rolls: [...s.rolls], captures: s.captures }));
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
  }));
  return serializeRollStats(merged);
}
