// Simulation: play a few hundred full games with the shipped logic and the
// shipped bot, and check they finish and stay playable.
//
// This exists because of a live regression. A previous version of the run-home
// rule required an exact landing on an empty cell, and an earlier version of
// this file asserted only that games *terminate* — which they did, so it
// passed. What it never asked was whether a player could take a turn: with five
// counters needing five distinct cells, the endgame was mostly turns with no
// legal move, and players reported the dice doing nothing. The invariant that
// actually matters is therefore the one below: a player holding counters off
// the yard always has a move.

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
      // The regression, caught at its source: a colour with a counter out on
      // the ring and nothing it can do with the roll.
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

    if (checkPlayerFinished(tokens, turn)) winner = turn;
    const nowFinished = getFinishedColors(tokens, 3);
    const next = getNextTurn(turn, roll, sixes, applied.captured, applied.reachedHome, 3, nowFinished);
    turn = next.nextColor;
    sixes = next.nextSixes;
  }

  return { turns, winner, captures, stuckWithPiecesOut, tokens };
}

describe('ludo2 run home: full-game simulation', () => {
  const GAMES = 200;
  const results: Outcome[] = [];
  for (let seed = 1; seed <= GAMES; seed++) results.push(playGame(seed));

  it('never leaves a player with counters out and no move — the live regression', () => {
    const stuck = results.reduce((n, r) => n + r.stuckWithPiecesOut, 0);
    expect(stuck).toBe(0);
  });

  it('every game reaches a winner', () => {
    expect(results.filter(r => !r.winner)).toHaveLength(0);
  });

  it('a winner has every counter in its run home', () => {
    for (const r of results) {
      const cells = getColorTokenIndices(r.winner!).map(i => r.tokens[i]);
      expect(cells).toHaveLength(TOKENS_PER_PLAYER);
      expect(cells.every(c => c.startsWith('final-'))).toBe(true);
      // Cells are shared now, so the only bound is the size of the run home.
      expect(new Set(cells).size).toBeLessThanOrEqual(FINAL_SIZE);
    }
  });

  it('games stay a sane length', () => {
    const turns = results.map(r => r.turns).sort((a, b) => a - b);
    const median = turns[Math.floor(turns.length / 2)];
    expect(median).toBeGreaterThan(60);
    expect(turns[turns.length - 1]).toBeLessThan(1200);
  });

  it('counters still get caught out on the track', () => {
    const captures = results.reduce((n, r) => n + r.captures, 0);
    expect(captures / GAMES).toBeGreaterThan(1);
  });
});
