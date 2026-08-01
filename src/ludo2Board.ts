// Ludo2 (three-player, Y-board) — shared types, board constants, and helpers.
//
// Ludo2 runs on a 42-cell circular track (3 arms × 14 cells) mirroring the
// numbering pattern of the original 56-cell board: each color starts at
// start = 1 + 14·k, enters its final column at start − 2 (mod 42), and safe
// zones sit on every start cell and start + 9. Token serialization reuses
// serializeTokens/deserializeTokens from ludoFirebase (length-agnostic).

import type { TokenPosition, TurnPhase, LudoPlayer } from './ludoFirebase';

// --- Types ---

export type Ludo2Color = 'red' | 'green' | 'yellow';

export interface Ludo2GameState {
  players: {
    red?: LudoPlayer | null;
    green?: LudoPlayer | null;
    yellow?: LudoPlayer | null;
  };
  /** Which seat created the room. Seats are handed out at random, so the host
   * is not necessarily red — legacy games without this field default to red. */
  host?: Ludo2Color;
  tokens: string; // 12 tokens × 3 chars = 36
  currentTurn: Ludo2Color;
  turnPhase: TurnPhase;
  diceValue: number | null;
  consecutiveSixes: number;
  winner: Ludo2Color | null;
  finishOrder: string;
  createdAt: number;
  startedAt: number | null;
  turnStartedAt: number;
  playerCount: number;
  paused?: boolean;
  pausedAt?: number;
  singlePlayer?: boolean;
  rollStats?: string; // "r1,..,r6,captures|g...|y..." (3 groups)
}

export interface Ludo2MoveUpdate {
  tokens: string;
  currentTurn: Ludo2Color;
  turnPhase: TurnPhase;
  diceValue: number | null;
  consecutiveSixes: number;
  winner: Ludo2Color | null;
  finishOrder: string;
  turnStartedAt: number | object; // accepts serverTimestamp() sentinel
  rollStats?: string;
}

// --- Board constants ---

export const TRACK_SIZE = 42;
export const TOKENS_PER_PLAYER = 4;
export const TOTAL_TOKENS = 12;
export const PLAYER_COLORS: Ludo2Color[] = ['red', 'green', 'yellow'];

export const START_POSITIONS: Record<Ludo2Color, number> = {
  red: 1, green: 15, yellow: 29,
};

export const ENTRY_CELLS: Record<Ludo2Color, number> = {
  red: 41, green: 13, yellow: 27,
};

export const SAFE_ZONES = new Set([1, 10, 15, 24, 29, 38]);

const COLOR_OFFSET: Record<Ludo2Color, number> = {
  red: 0, green: 4, yellow: 8,
};

export const INITIAL_TOKENS = 'bas'.repeat(TOTAL_TOKENS); // 36 chars

// --- Helpers ---

export function colorIndex(color: Ludo2Color): number {
  return PLAYER_COLORS.indexOf(color);
}

export function getColorTokenIndices(color: Ludo2Color): number[] {
  const offset = COLOR_OFFSET[color];
  return [offset, offset + 1, offset + 2, offset + 3];
}

export function getTokenColor(index: number): Ludo2Color {
  if (index < 4) return 'red';
  if (index < 8) return 'green';
  return 'yellow';
}

/**
 * Race-progress score for a player. Higher = closer to finishing.
 * Shown on the board's score badges and used by the bot heuristics.
 */
export function getPlayerScore(tokens: TokenPosition[], color: Ludo2Color): number {
  return getColorTokenIndices(color).reduce((sum, i) => {
    const pos = tokens[i];
    if (pos === 'base') return sum;
    if (pos === 'final-6') return sum + TRACK_SIZE + 6;
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

// --- Roll stats (3 color groups: red|green|yellow) ---

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
