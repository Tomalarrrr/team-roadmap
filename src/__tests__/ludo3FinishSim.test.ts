// Simulation: play a few hundred full games with the shipped logic and the
// shipped bot, and check they finish and stay playable.
//
// The run-home rule asks for an exact landing on an empty cell, so a counter
// that cannot land waits out on the ring where it can be sent back to the yard.
// That is the point of the rule, not a fault in it, and this file exists to keep
// the difference measurable — because the rule was once reverted on the belief
// that it left "the endgame mostly turns with no legal move".
//
// It does not, and the numbers below are the evidence. What actually stopped
// play at the time was the database rules rejecting every write carrying
// `lastRoll`, which made the dice do nothing in every game whatever the rule
// said. Two faults, one symptom, and the wrong one got reverted.

import { describe, it, expect } from 'vitest';
import {
  getValidMoves,
  helpfulRolls,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  getNextTurn,
  scoreBotMove,
} from '../ludo3GameLogic';
import {
  PLAYER_COLORS,
  TOTAL_TOKENS,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  getColorTokenIndices,
  type Ludo3Color,
} from '../ludo3Board';
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
  winner: Ludo3Color | null;
  captures: number;
  /** Turns where a player had counters out on the track and still could not move. */
  stuckWithPiecesOut: number;
  /** Positions where an unfinished colour had counters out and *no* face helped. */
  deadlocked: number;
  tokens: TokenPosition[];
}

function playGame(seed: number, turnCap = 4000): Outcome {
  const rand = rng(seed);
  let tokens: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');
  let turn: Ludo3Color = PLAYER_COLORS[Math.floor(rand() * 3)];
  let sixes = 0;
  let captures = 0;
  let stuckWithPiecesOut = 0;
  let deadlocked = 0;
  let winner: Ludo3Color | null = null;
  let turns = 0;

  while (turns < turnCap && !winner) {
    turns++;
    // Checked every turn, for every seat: stuck on this roll is the rule doing
    // its job, stuck on all six would be a deadlock. Sampling the finished board
    // alone would never see it — by then the game is over.
    for (const c of PLAYER_COLORS) {
      const idx = getColorTokenIndices(c);
      if (checkPlayerFinished(tokens, c)) continue;
      if (idx.every(i => tokens[i] === 'base')) continue;
      if (helpfulRolls(tokens, c).length === 0) deadlocked++;
    }
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

  return { turns, winner, captures, stuckWithPiecesOut, deadlocked, tokens };
}

describe('ludo3 run home: full-game simulation', () => {
  const GAMES = 200;
  const results: Outcome[] = [];
  for (let seed = 1; seed <= GAMES; seed++) results.push(playGame(seed));

  it('leaves counters stranded on the ring — but as a minority of turns', () => {
    // Not zero: a counter that cannot land exactly is *supposed* to be left in
    // the open. What would be a real fault is that becoming the shape of the
    // endgame, so it is bounded rather than banned. Measured at ~1.3% of turns
    // against a walk-in rule's 0%; the ceiling is set well clear of that so it
    // catches a rule change that makes stranding the norm, not ordinary drift.
    const turns = results.reduce((n, r) => n + r.turns, 0);
    const stuck = results.reduce((n, r) => n + r.stuckWithPiecesOut, 0);
    expect(stuck).toBeGreaterThan(0);
    expect(stuck / turns).toBeLessThan(0.05);
  });

  it('never leaves an unfinished player permanently stuck', () => {
    // Stuck on *this* roll is the rule working; stuck on *all six* would be a
    // deadlock, and that is the thing the rule was accused of. Across every seat
    // on every turn of every game, it never once happens.
    expect(results.reduce((n, r) => n + r.deadlocked, 0)).toBe(0);
  });

  it('every game reaches a winner', () => {
    expect(results.filter(r => !r.winner)).toHaveLength(0);
  });

  it('a winner is standing in every cell of its run home, one counter each', () => {
    for (const r of results) {
      const cells = getColorTokenIndices(r.winner!).map(i => r.tokens[i]);
      expect(cells).toHaveLength(TOKENS_PER_PLAYER);
      expect(cells.every(c => c.startsWith('final-'))).toBe(true);
      // One per cell — the rule the whole endgame turns on.
      expect(new Set(cells).size).toBe(FINAL_SIZE);
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
