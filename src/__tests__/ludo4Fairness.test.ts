/// <reference types="node" />
// Fairness, measured — because Ludo4 promises it.
//
// The help card makes two promises about the die. Out on the board it is
// exactly fair — no pity timer quietly swapping faces for 6s the way v1's
// does. And while a seat is shut in (all five counters at home) it warms by a
// stated curve — P(6) = (4 + misses) / 24, never past double — with the throw
// after YARD_MISS_LIMIT misses a given 6. A stated curve is only honest while
// it is the curve actually thrown, so both promises get pinned here. Those are product claims about probability, and probability
// claims rot silently: nothing else in the suite would fail if someone
// reintroduced `Math.random() * 6 | 0 % ...` bias, biased the seat deal, or
// wrote a scoring rule that favours one colour's side of the ring. So this file
// pins each claim to a number.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requestDiceRoll, requestYardRoll } from '../api/ludo4Api';
import { YARD_MISS_LIMIT } from '../ludo4GameLogic';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  FINAL_SIZE,
  PLAYER_COLORS,
  START_POSITIONS,
  MAX_PLAYER_SCORE,
  getColorTokenIndices,
  getPlayerScore,
  type Ludo4Color,
} from '../ludo4Board';
import {
  getValidMoves,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  getNextTurn,
  scoreBotMove,
} from '../ludo4GameLogic';
import type { TokenPosition } from '../ludoFirebase';

// --- The die ----------------------------------------------------------------

describe('the die is uniform', () => {
  it('never leaves 1..6', async () => {
    for (let i = 0; i < 1000; i++) {
      const { rolls } = await requestDiceRoll();
      expect(rolls[0]).toBeGreaterThanOrEqual(1);
      expect(rolls[0]).toBeLessThanOrEqual(6);
      expect(Number.isInteger(rolls[0])).toBe(true);
    }
  });

  it('passes a chi-square test over sixty thousand throws', async () => {
    // The faces should be uniform to within sampling noise. Chi-square with
    // five degrees of freedom: the critical value at p = 1e-4 is 25.7, so a
    // bound of 30 fails a genuinely biased die (the old `byte % 6` bias alone
    // costs ~34 at this sample size) while a fair one trips it about once per
    // hundred thousand runs.
    const N = 60_000;
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const { rolls } = await requestDiceRoll();
      counts[rolls[0] - 1]++;
    }
    const expected = N / 6;
    const chi2 = counts.reduce((sum, c) => sum + ((c - expected) ** 2) / expected, 0);
    expect(chi2).toBeLessThan(30);
    // Generous wall-clock allowance: 60k crypto draws are fast alone but this
    // file shares workers with the whole suite, and a timeout here would read
    // as a fairness failure.
  }, 30_000);
});

// --- The seats --------------------------------------------------------------

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

/** Four identical bots play a full game; returns the winner. Same harness as
 * ludo4FinishSim, kept lean — this file only cares who wins. */
function playGame(seed: number): Ludo4Color | null {
  const rand = rng(seed);
  let tokens: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');
  let turn: Ludo4Color = PLAYER_COLORS[Math.floor(rand() * 4)];
  let sixes = 0;
  for (let turns = 0; turns < 6000; turns++) {
    const roll = 1 + Math.floor(rand() * 6);
    const moves = getValidMoves(tokens, turn, roll);
    if (moves.length === 0) {
      const next = getNextTurn(turn, roll, sixes, false, false, 4, getFinishedColors(tokens, 4));
      turn = next.nextColor;
      sixes = next.nextSixes;
      continue;
    }
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const s = scoreBotMove(m.tokenIndex, m.newPosition, tokens, turn, 4);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    const applied = applyMove(tokens, best.tokenIndex, best.newPosition);
    tokens = applied.newTokens;
    if (checkPlayerFinished(tokens, turn)) return turn;
    const next = getNextTurn(
      turn, roll, sixes, applied.captured, applied.reachedHome, 4, getFinishedColors(tokens, 4)
    );
    turn = next.nextColor;
    sixes = next.nextSixes;
  }
  return null;
}

// --- The warm start ----------------------------------------------------------

describe('the warm start is exactly what the card says', () => {
  it('is stone fair before the first miss', async () => {
    const n = 60000;
    let sixes = 0;
    for (let i = 0; i < n; i++) if ((await requestYardRoll(0)).rolls[0] === 6) sixes++;
    // 1/6 ± 7σ — a fresh shut-in seat gets no warmth at all.
    expect(sixes / n).toBeGreaterThan(0.156);
    expect(sixes / n).toBeLessThan(0.178);
  });

  it('never warms past double fair odds', async () => {
    const n = 60000;
    let sixes = 0;
    for (let i = 0; i < n; i++) {
      if ((await requestYardRoll(YARD_MISS_LIMIT - 1)).rolls[0] === 6) sixes++;
    }
    // The warmest throw before the given 6 is (4 + 4)/24 = exactly 1/3, ± 6σ.
    expect(sixes / n).toBeGreaterThan(0.322);
    expect(sixes / n).toBeLessThan(0.345);
  });

  it('keeps the five other faces even while warm', async () => {
    // Warmth may only feed the 6. If the remainder is shared unevenly the low
    // faces pick up a bias nobody stated — at the warmest step each of 1..5
    // should carry (1 − 1/3)/5 ≈ 13.3% of all throws.
    const n = 60000;
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const f = (await requestYardRoll(YARD_MISS_LIMIT - 1)).rolls[0];
      if (f !== 6) counts[f - 1]++;
    }
    for (const c of counts) {
      expect(c / n).toBeGreaterThan(0.120);
      expect(c / n).toBeLessThan(0.147);
    }
  });

  it('serves the given 6 once the misses are spent', async () => {
    for (let i = 0; i < 50; i++) {
      expect((await requestYardRoll(YARD_MISS_LIMIT)).rolls[0]).toBe(6);
      expect((await requestYardRoll(YARD_MISS_LIMIT + 3)).rolls[0]).toBe(6);
    }
  });
});

describe('no seat is structurally favoured', () => {
  // Run out to 20,000 games the four shares are 24.70 / 25.11 / 25.09 / 25.09
  // (chi2 0.96 on 3 df) and captures made and taken match seat by seat. The one
  // measurable edge is the two-handed game — see startGame in ludo4Api.
  it('four identical bots win a fair share each over 400 games', () => {
    // The board is four-fold symmetric and the starting seat is drawn at
    // random, so equal players should win equally often. Expected share 25%;
    // over 400 games one standard deviation is ~2.2%, so the [15%, 35%] band
    // is ±4.6σ — it will not trip on luck, but a seat with a real structural
    // edge (a shorter lap, an unguarded start, an asymmetric safe zone) walks
    // straight out of it.
    const wins: Record<Ludo4Color, number> = { red: 0, green: 0, yellow: 0, blue: 0 };
    let played = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const w = playGame(seed);
      if (w) { wins[w]++; played++; }
    }
    expect(played).toBe(400);
    for (const color of PLAYER_COLORS) {
      expect(wins[color] / played).toBeGreaterThan(0.15);
      expect(wins[color] / played).toBeLessThan(0.35);
    }
    // Same allowance as the chi-square test: 400 full games take ~4s alone and
    // more under suite load; the default 5s timeout is the one way this test
    // could fail without fairness being at fault.
  }, 30_000);
});

// --- The score --------------------------------------------------------------

describe('scoring is identical for every seat', () => {
  it('a counter k steps from its own start scores k, whoever owns it', () => {
    for (const color of PLAYER_COLORS) {
      const [first] = getColorTokenIndices(color);
      for (let k = 1; k < TRACK_SIZE; k++) {
        const cell = ((START_POSITIONS[color] - 1 + k) % TRACK_SIZE) + 1;
        const tokens: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');
        tokens[first] = `track-${cell}`;
        expect(getPlayerScore(tokens, color)).toBe(k);
      }
    }
  });

  it('run-home cells are worth the same to every seat', () => {
    for (const color of PLAYER_COLORS) {
      const [first] = getColorTokenIndices(color);
      for (let f = 1; f <= FINAL_SIZE; f++) {
        const tokens: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');
        tokens[first] = `final-${f}`;
        expect(getPlayerScore(tokens, color)).toBe(TRACK_SIZE + f);
      }
    }
  });

  it('every seat tops out at the same maximum', () => {
    for (const color of PLAYER_COLORS) {
      const tokens: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');
      getColorTokenIndices(color).forEach((idx, i) => {
        tokens[idx] = `final-${i + 1}`;
      });
      expect(getPlayerScore(tokens, color)).toBe(MAX_PLAYER_SCORE);
    }
  });
});

// --- The promise in the UI --------------------------------------------------

describe('the fair-die promise is kept in the client', () => {
  const game = readFileSync(
    resolve(process.cwd(), 'src/components/ludo4/Ludo4Game.tsx'),
    'utf-8'
  );

  it('has no pity timer and plays the face it rolled', () => {
    // v1 swaps a stuck player's roll for a 6 after a few failed
    // deploys; Ludo4's help card promises it does not. That machinery has
    // distinctive identifiers — if any of them come back, this fails and the
    // help card has to be renegotiated rather than silently falsified. (The
    // identifiers, not the word "pity": the file legitimately *talks about*
    // the pity timer in the comment explaining why it has none.)
    expect(game).not.toMatch(/homeStuckRolls|pityThreshold|originalFace/);
  });

  it('tells the player the whole truth about the die', () => {
    expect(game).toContain('The die is fair');
    // The warm start may exist only for as long as the card discloses it.
    expect(game).toContain('the die warms to you');
    expect(game).toContain('given');
  });
});

// --- The database rules -----------------------------------------------------

describe('firebase rules accept every field the client writes', () => {
  // The `size`-field class of bug (see rulesCoverage.test.ts): a field the app
  // writes but the rules do not allow is rejected with a silent 401, because
  // every node ends with `"$other": { ".validate": false }`. lastRoll has
  // already broken a Ludo game once this way.
  const rules = JSON.parse(
    readFileSync(resolve(process.cwd(), 'database.rules.json'), 'utf-8')
  ) as { rules: Record<string, unknown> };
  const node = (rules.rules.ludo4 as Record<string, unknown>).$gameCode as Record<string, unknown>;
  const allowed = new Set(
    Object.keys(node).filter((k) => !k.startsWith('.') && !k.startsWith('$'))
  );

  // Every top-level field ludo4Api ever writes (create, move, pause, reset,
  // leave, start), by hand because the types are erased at runtime.
  const written = [
    'players', 'host', 'tokens', 'currentTurn', 'turnPhase', 'diceValue',
    'lastRoll', 'consecutiveSixes', 'winner', 'finishOrder', 'createdAt',
    'startedAt', 'turnStartedAt', 'playerCount', 'paused', 'pausedAt',
    'singlePlayer', 'rollStats',
  ];

  it.each(written)('allows %s', (field) => {
    expect(allowed.has(field)).toBe(true);
  });

  it('caps the token string at exactly 20 counters', () => {
    const tokens = node.tokens as { '.validate': string };
    expect(tokens['.validate']).toContain('length == 60');
  });
});
