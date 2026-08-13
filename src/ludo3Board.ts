// Ludo3 (three-player, circular board) — shared types, constants and helpers.
//
// Ludo3 is Ludo4's three-seat sibling — the same board drawn flat, one arm
// shorter of a full set: a 42-cell ring (3 arms × 14 cells, the same arm length
// as Ludo4's and the classic board's). Each color starts at start = 1 + 14·k,
// enters its final column at start − 1 (mod 42), and safe zones sit on every
// start cell and start + 6. Token serialization reuses
// serializeTokens/deserializeTokens from ludoFirebase (length-agnostic).
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

export type Ludo3Color = 'red' | 'green' | 'blue';

export interface Ludo3GameState {
  players: {
    red?: LudoPlayer | null;
    green?: LudoPlayer | null;
    blue?: LudoPlayer | null;
  };
  /** Which seat created the room. Seats are handed out at random, so the host
   * is not necessarily red — legacy games without this field default to red. */
  host?: Ludo3Color;
  tokens: string; // 15 tokens × 3 chars = 45
  currentTurn: Ludo3Color;
  turnPhase: TurnPhase;
  diceValue: number | null;
  /** The face last rolled by anyone. diceValue is cleared the moment a move is
   * committed, so on its own the die is blank almost all the time and an
   * opponent's roll is never visible. This is never cleared mid-game. */
  lastRoll?: number | null;
  consecutiveSixes: number;
  winner: Ludo3Color | null;
  finishOrder: string;
  createdAt: number;
  startedAt: number | null;
  turnStartedAt: number;
  playerCount: number;
  paused?: boolean;
  pausedAt?: number;
  singlePlayer?: boolean;
  rollStats?: string; // "r1,..,r6,captures,warm|g...|b..." (3 groups)
  /** Consecutive dead throws taken with a counter still in the yard, one count
   * per seat ("0,0,0"). The warm die's memory (see requestYardRoll). Missing
   * reads as cold, so legacy rooms and old clients simply play on fair. */
  yardMisses?: string;
  /** Cumulative faces drawn from each seat's dice pack,
   * "d1,..,d6|g...|b..." (see the pack section below). Missing reads as zero
   * draws, so a legacy room starts every seat on a fresh, full pack. */
  packDraws?: string;
}

export interface Ludo3MoveUpdate {
  tokens: string;
  currentTurn: Ludo3Color;
  turnPhase: TurnPhase;
  diceValue: number | null;
  /** Omit to preserve the stored value — makeMove spreads updates over current. */
  lastRoll?: number | null;
  consecutiveSixes: number;
  winner: Ludo3Color | null;
  finishOrder: string;
  turnStartedAt: number | object; // accepts serverTimestamp() sentinel
  rollStats?: string;
  /** Omit to preserve the stored counts — only turn-resolving writes carry it. */
  yardMisses?: string;
  /** Rides exactly where rollStats rides — same monotone counts, same merge. */
  packDraws?: string;
}

// --- Board constants ---

export const TRACK_SIZE = 42;
/** Cells in a run home — and, deliberately, counters per player: every cell
 * has to end up with a counter standing in it for that player to be finished. */
export const FINAL_SIZE = 5;
export const TOKENS_PER_PLAYER = FINAL_SIZE;
export const TOTAL_TOKENS = TOKENS_PER_PLAYER * 3;
export const PLAYER_COLORS: Ludo3Color[] = ['red', 'green', 'blue'];

export const START_POSITIONS: Record<Ludo3Color, number> = {
  red: 1, green: 15, blue: 29,
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
export const ENTRY_CELLS: Record<Ludo3Color, number> = {
  red: 42, green: 14, blue: 28,
};

/**
 * Havens: every start cell, and the cell six on from each start.
 *
 * The same reasoning as Ludo4's, which holds here unchanged because the arms
 * are the same fourteen cells long. The start cells have to be safe or
 * deploying is suicide. That makes a counter parked on its own start the
 * strongest square in the game — it cannot be taken, and it covers the six
 * cells ahead of it. Those six are where every other colour is at its most
 * exposed, because each arm's start is also the gate a third of the ring has to
 * walk through on its way home. Putting the second haven at start + 6 takes the
 * last of those six cells off the camper's guns and gives the runner something
 * to aim at: an exact six carries a counter from one haven to the next, and a
 * six buys another roll, so the leap is paid for.
 *
 * The spacing that falls out — 6, 8, 6, 8, 6, 8 — also lands each star a hair
 * short of halfway between one arm's start cell and the next arm's entry cell
 * (start + 6 against a midpoint of start + 6.5), near enough dead centre of the
 * blank stretch between two yards.
 */
export const SAFE_ZONES = new Set([1, 7, 15, 21, 29, 35]);

const COLOR_OFFSET: Record<Ludo3Color, number> = {
  red: 0,
  green: TOKENS_PER_PLAYER,
  blue: TOKENS_PER_PLAYER * 2,
};

export const INITIAL_TOKENS = 'bas'.repeat(TOTAL_TOKENS); // 45 chars

// --- Helpers ---

export function colorIndex(color: Ludo3Color): number {
  return PLAYER_COLORS.indexOf(color);
}

export function getColorTokenIndices(color: Ludo3Color): number[] {
  const offset = COLOR_OFFSET[color];
  return Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => offset + i);
}

export function getTokenColor(index: number): Ludo3Color {
  if (index < COLOR_OFFSET.green) return 'red';
  if (index < COLOR_OFFSET.blue) return 'green';
  return 'blue';
}

/** Which cells of `color`'s run home already have a counter standing in them.
 * A counter may pass over an occupied cell but never stop on one. */
export function getOccupiedFinals(tokens: TokenPosition[], color: Ludo3Color): Set<number> {
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
export function deserializeLudo3Tokens(str: string): TokenPosition[] {
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

export interface Ludo3Standing {
  color: Ludo3Color;
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
  finishOrder: Ludo3Color[]
): Ludo3Standing[] {
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
export function getPlayerScore(tokens: TokenPosition[], color: Ludo3Color): number {
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

// --- Roll stats (3 color groups: red|green|blue) ---

/**
 * A seat's tally: how each face fell, captures made, and how many of those
 * throws came off the warm die rather than the fair one.
 *
 * `warm` exists because the other seven numbers are read as a fairness record
 * and, on their own, they lie by omission. A seat that spent turns shut out of
 * its own yard throws a die that leans to the 6 (see requestYardRoll), so the
 * player who had the *worst* luck shows the *most* 6s — which is exactly the
 * reading that gets the die called crooked. Counting the warm throws puts the
 * explanation on the card beside the number it explains.
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
 * than the fair one — see RollStats. */
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

// --- Shut-out misses (the warm die's memory) ---------------------------------

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
// Every seat throws from its own pack of eighteen dice — three of every face,
// drawn without replacement, refilled the moment the last one is taken. That
// is the whole rule: over any completed pack a seat gets exactly three 6s (and
// three of everything else), so a night cannot run cold by luck alone. The
// warm yard die is the one throw that does not draw from the pack — it is its
// own stated exception and its own stated curve.

/** Three of each face per pack: the whole fairness promise in one number. */
export const PACK_PER_FACE = 3;
/** Six faces of PACK_PER_FACE each — eighteen draws empties a pack. */
export const PACK_SIZE = 6 * PACK_PER_FACE;

/**
 * What is synced is not the pack but the DRAWS: per seat, how many times each
 * face has ever been drawn from that seat's pack since the game began. Counts
 * only ever grow, which is the property everything downstream leans on:
 * makeMove merges concurrent writers cell-by-cell with max exactly as it
 * merges rollStats, and a duplicate throw for the same bot turn collapses to
 * one draw the same way it collapses to one tally mark. Storing the dice
 * *remaining* would read more naturally and be wrong the first time two
 * clients wrote at once — max would resurrect every die the other had drawn.
 *
 * The pack itself is derived (packRemaining), and the refill needs no synced
 * event: the eighteenth draw of one pack simply starts the count of the next.
 */
export type PackDraws = number[][];

export function initPackDraws(): string {
  return PLAYER_COLORS.map(() => [0, 0, 0, 0, 0, 0].join(',')).join('|');
}

/** Absent or garbled reads as zero draws — a legacy room or an old client's
 * write starts a seat on a fresh, full pack, never a depleted one. */
export function parsePackDraws(str: string | undefined | null): PackDraws {
  const out: PackDraws = PLAYER_COLORS.map(() => [0, 0, 0, 0, 0, 0]);
  if (!str) return out;
  const parts = str.split('|');
  for (let i = 0; i < out.length && i < parts.length; i++) {
    const nums = parts[i].split(',').map(Number);
    for (let j = 0; j < 6; j++) {
      const n = nums[j];
      if (Number.isFinite(n) && n > 0) out[i][j] = Math.floor(n);
    }
  }
  return out;
}

export function serializePackDraws(draws: PackDraws): string {
  return PLAYER_COLORS.map((_, i) => (draws[i] ?? [0, 0, 0, 0, 0, 0]).join(',')).join('|');
}

/**
 * The dice one seat still holds, derived from its cumulative draws. Each
 * face's allowance is PACK_PER_FACE per pack, and a new pack begins the moment
 * the last draw of the current one is taken: the allowance grows with
 * floor(total / PACK_SIZE), what remains is allowance minus drawn. Within an
 * honest pack no face can outrun its allowance (drawFromPack only offers what
 * remains), so at every boundary each face has been drawn exactly three times
 * and the fresh pack is full — the clamp is for garbled writes, and the sum of
 * what this returns is always at least one, so there is always a die to draw.
 */
export function packRemaining(drawn: number[]): number[] {
  const total = drawn.reduce((a, b) => a + b, 0);
  const allowance = PACK_PER_FACE * (Math.floor(total / PACK_SIZE) + 1);
  return drawn.map(d => Math.max(0, allowance - d));
}

/**
 * Draw one die from a seat's pack: uniform among the dice actually remaining.
 * That is a shuffled pack without the theatre of a stored order — and without
 * a stored order, nothing in the synced state says what anyone's next throw
 * will be. `pick` supplies the randomness (a uniform integer in [0, n)): the
 * api layer passes its crypto randomInt, the simulations pass their seeded
 * generator, and this stays the one definition of how a pack is drawn.
 */
export function drawFromPack(drawn: number[], pick: (n: number) => number): number {
  const remaining = packRemaining(drawn);
  const total = remaining.reduce((a, b) => a + b, 0);
  let k = pick(total);
  for (let face = 0; face < 6; face++) {
    k -= remaining[face];
    if (k < 0) return face + 1;
  }
  return 6; // unreachable: packRemaining never sums to zero
}

/** Record one drawn face into a seat's cumulative counts. String in, string
 * out — the ref that carries this lives in serialized form, like yardMisses. */
export function recordPackDraw(packStr: string, colorIdx: number, face: number): string {
  const draws = parsePackDraws(packStr);
  draws[colorIdx][Math.max(0, Math.min(face, 6) - 1)]++;
  return serializePackDraws(draws);
}

/** Merge two serialized pack-draw strings cell-by-cell taking the max — the
 * same idempotence rollStats gets from mergeRollStats, for the same races. */
export function mergePackDraws(a: string, b: string): string {
  const da = parsePackDraws(a);
  const db = parsePackDraws(b);
  return serializePackDraws(da.map((seat, i) => seat.map((d, j) => Math.max(d, db[i][j]))));
}
