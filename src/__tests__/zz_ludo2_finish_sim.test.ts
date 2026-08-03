// Simulation: does the "one counter per cell of the run home, landed on
// exactly" rule still produce games that finish?
//
// The rule's one real hazard is a stalemate — a player whose remaining counters
// can never land on the cells they still need. Rather than argue about it, play
// a few hundred full games with the shipped logic and the shipped bot and check
// that every one of them ends, that no colour ever gets two counters onto one
// cell of its run home, and that the exactness actually bites often enough to
// leave counters out on the track where they can be taken.

import { describe, it, expect } from 'vitest';
import {
  getValidMoves,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  getNextTurn,
  scoreBotMove,
} from '../ludo2GameLogic';
import {
  PLAYER_COLORS,
  TOTAL_TOKENS,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  getColorTokenIndices,
  getOccupiedFinals,
  type Ludo2Color,
} from '../ludo2Board';
import type { TokenPosition } from '../ludoFirebase';

/** mulberry32 — seeded so a failure is reproducible. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Outcome {
  turns: number;
  winner: Ludo2Color | null;
  captures: number;
  /** Turns where a player had counters out on the track and still could not move. */
  stuckWithPiecesOut: number;
  tokens: TokenPosition[];
}

function playGame(seed: number, turnCap = 4000): Outcome {
  const rand = rng(seed);
  let tokens: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');
  let turn: Ludo2Color = PLAYER_COLORS[Math.floor(rand() * 3)];
  let sixes = 0;
  let captures = 0;
  let stuckWithPiecesOut = 0;
  let winner: Ludo2Color | null = null;
  let turns = 0;

  while (turns < turnCap && !winner) {
    turns++;
    const roll = 1 + Math.floor(rand() * 6);
    const moves = getValidMoves(tokens, turn, roll);
    const finished = getFinishedColors(tokens, 3);

    if (moves.length === 0) {
      if (getColorTokenIndices(turn).some(i => tokens[i].startsWith('track-'))) {
        stuckWithPiecesOut++;
      }
      const next = getNextTurn(turn, roll, sixes, false, false, 3, finished);
      turn = next.nextColor;
      sixes = next.nextSixes;
      continue;
    }

    // Same choice the shipped bot would make.
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const s = scoreBotMove(m.tokenIndex, m.newPosition, tokens, turn, 3);
      if (s > bestScore) { bestScore = s; best = m; }
    }

    const applied = applyMove(tokens, best.tokenIndex, best.newPosition);
    tokens = applied.newTokens;
    if (applied.captured) captures++;

    // Invariant: a colour never gets two counters onto one run-home cell.
    for (const color of PLAYER_COLORS) {
      const inRun = getColorTokenIndices(color)
        .filter(i => tokens[i].startsWith('final-')).length;
      expect(getOccupiedFinals(tokens, color).size).toBe(inRun);
    }

    if (checkPlayerFinished(tokens, turn)) winner = turn;
    const nowFinished = getFinishedColors(tokens, 3);
    const next = getNextTurn(turn, roll, sixes, applied.captured, applied.reachedHome, 3, nowFinished);
    turn = next.nextColor;
    sixes = next.nextSixes;
  }

  return { turns, winner, captures, stuckWithPiecesOut, tokens };
}

describe('ludo2 run-home rule: full-game simulation', () => {
  const GAMES = 200;
  const results: Outcome[] = [];
  for (let seed = 1; seed <= GAMES; seed++) results.push(playGame(seed));

  it('every game reaches a winner — the exact-landing rule never stalemates', () => {
    const unfinished = results.filter(r => !r.winner);
    expect(unfinished).toHaveLength(0);
  });

  it('a winner is standing in every cell of its run home, one counter each', () => {
    for (const r of results) {
      const cells = getColorTokenIndices(r.winner!).map(i => r.tokens[i]);
      expect(cells.every(c => c.startsWith('final-'))).toBe(true);
      expect(new Set(cells).size).toBe(TOKENS_PER_PLAYER);
      expect(new Set(cells).size).toBe(FINAL_SIZE);
    }
  });

  it('games stay a sane length', () => {
    const turns = results.map(r => r.turns).sort((a, b) => a - b);
    const median = turns[Math.floor(turns.length / 2)];
    expect(median).toBeGreaterThan(60);
    expect(turns[turns.length - 1]).toBeLessThan(1200);
  });

  it('counters really do get stranded on the track and sent back', () => {
    // Both halves of what the rule is for: a roll that cannot be used leaves a
    // counter out in the open, and counters out in the open get taken.
    const stuck = results.reduce((n, r) => n + r.stuckWithPiecesOut, 0);
    const captures = results.reduce((n, r) => n + r.captures, 0);
    expect(stuck / GAMES).toBeGreaterThan(1);
    expect(captures / GAMES).toBeGreaterThan(1);
  });
});
