/// <reference types="node" />
// Fairness, measured — because Ludo4 promises it.
//
// The help card makes two promises about the die. Out on the board it is a
// pack of eighteen per seat — three of every face, drawn without replacement,
// refilled when the last is taken — no pity timer quietly swapping faces for
// 6s the way v1's does, and no night run cold: the fairness is per pack, not
// per expectation. And on a throw taken after a wasted turn with a counter
// still in the yard it warms by a stated curve — P(6) = (2 + misses) / 8 —
// with the throw after YARD_MISS_LIMIT misses a given 6. A stated rule is
// only honest while it is the rule actually thrown, so both promises get
// pinned here. Those are product claims about probability, and probability
// claims rot silently: nothing else in the suite would fail if someone
// reintroduced `Math.random() * 6 | 0 % ...` bias, put the i.i.d. die back,
// biased the seat deal, or wrote a scoring rule that favours one colour's
// side of the ring. So this file pins each claim to a number.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { requestPackRoll, requestYardRoll } from '../api/ludo4Api';
import { YARD_MISS_LIMIT } from '../ludo4GameLogic';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  FINAL_SIZE,
  PLAYER_COLORS,
  START_POSITIONS,
  MAX_PLAYER_SCORE,
  PACK_PER_FACE,
  PACK_SIZE,
  PACK_CUT_MIN,
  packSeed,
  packCut,
  packOrder,
  packFace,
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
  isWarmThrow,
  hasYardCounter,
} from '../ludo4GameLogic';
import type { TokenPosition } from '../ludoFirebase';

// --- The die ----------------------------------------------------------------

describe('the die is a shuffled, cut pack', () => {
  const SEED = packSeed('TEST', 1700000000000);

  it('never leaves 1..6', async () => {
    for (let i = 0; i < 2000; i++) {
      const { rolls } = await requestPackRoll(SEED, i % 4, i);
      expect(rolls[0]).toBeGreaterThanOrEqual(1);
      expect(rolls[0]).toBeLessThanOrEqual(6);
      expect(Number.isInteger(rolls[0])).toBe(true);
    }
  });

  it('is idempotent — the same throw index always gives the same face', async () => {
    // The property the whole design turns on. Two clients throwing the same
    // bot turn compute the same index, so they compute the same face, so the
    // duplicate cannot cost that seat a second card. Under the crypto die this
    // replaced they rolled independently and both draws were kept.
    for (let i = 0; i < 500; i++) {
      const a = await requestPackRoll(SEED, 0, i);
      const b = await requestPackRoll(SEED, 0, i);
      expect(a.rolls[0]).toBe(b.rolls[0]);
    }
  });

  it('holds a game\'s worth of throws near its share, without being exact', async () => {
    // The fairness the table asked for and the variety it asked for after, in
    // one test. Over a realistic 90-throw game a seat's 6 count stays near its
    // share of 15 — worst deviation 7 measured across 2000 seat-games, against
    // 13 for a true die. But an exact three-of-each pack window is rare: the
    // cut and the wild throw are what stop the seat cards finishing as
    // arithmetic, which is what got the uncut pack thrown out.
    let exact = 0, windows = 0, worstDeviation = 0;
    for (let room = 0; room < 60; room++) {
      const seed = packSeed(`R${room}`, 1700000000000 + room);
      for (let seat = 0; seat < 4; seat++) {
        let sixes = 0;
        for (let i = 0; i < 90; i++) {
          if ((await requestPackRoll(seed, seat, i)).rolls[0] === 6) sixes++;
        }
        worstDeviation = Math.max(worstDeviation, Math.abs(sixes - 15));
        for (let start = 0; start + PACK_SIZE <= 90; start += PACK_SIZE) {
          const counts = [0, 0, 0, 0, 0, 0];
          for (let i = start; i < start + PACK_SIZE; i++) {
            counts[(await requestPackRoll(seed, seat, i)).rolls[0] - 1]++;
          }
          windows++;
          if (counts.every(c => c === PACK_PER_FACE)) exact++;
        }
      }
    }
    expect(exact / windows).toBeLessThan(0.05);
    expect(worstDeviation).toBeLessThanOrEqual(9);
  }, 30_000);

  it('is uniform over the six faces across many rooms', async () => {
    // Per room the pack is a fixed shuffle, so uniformity is a claim about the
    // shuffle across rooms, not within one. Chi-square, five degrees of
    // freedom: the critical value at p = 1e-4 is 25.7, so a bound of 30 fails
    // a shuffle that favours a face while a fair one trips about once per
    // hundred thousand runs.
    const N = 60_000;
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) {
      const seed = packSeed(`R${i}`, 1700000000000 + i);
      counts[(await requestPackRoll(seed, i % 4, i % 37)).rolls[0] - 1]++;
    }
    const expected = N / 6;
    const chi2 = counts.reduce((s, c) => s + ((c - expected) ** 2) / expected, 0);
    expect(chi2).toBeLessThan(30);
  }, 30_000);

  it('caps a 6 drought well short of the old die', async () => {
    // A cut pack can withhold 6s across a boundary, and a wild throw can too,
    // so the hard 30 the uncut pack guaranteed is gone — deliberately. What
    // must not come back is the unbounded drought of a true die, which is what
    // gave one seat 7 sixes in 85 the night this was written.
    let worst = 0;
    for (let room = 0; room < 40; room++) {
      const seed = packSeed(`D${room}`, 1700000000000 + room);
      let since = 0;
      for (let i = 0; i < 3000; i++) {
        if ((await requestPackRoll(seed, 0, i)).rolls[0] === 6) since = 0;
        else { since++; worst = Math.max(worst, since); }
      }
    }
    expect(worst).toBeLessThanOrEqual(45);
  }, 30_000);

  it('cuts each pack somewhere unpredictable', async () => {
    // The cut is the answer to "you could almost guess the next number": a
    // pack whose end you know is a pack you can count out.
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const cut = packCut(SEED, 0, k);
      expect(cut).toBeGreaterThanOrEqual(PACK_CUT_MIN);
      expect(cut).toBeLessThanOrEqual(PACK_SIZE);
      seen.add(cut);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it('deals a wild throw often enough to matter, rarely enough to stay a pack', async () => {
    let wild = 0;
    const N = 20_000;
    for (let i = 0; i < N; i++) {
      let packIdx = 0, base = 0;
      for (;;) { const c = packCut(SEED, 0, packIdx); if (i < base + c) break; base += c; packIdx++; }
      if ((await requestPackRoll(SEED, 0, i)).rolls[0] !== packOrder(SEED, 0, packIdx)[i - base]) wild++;
    }
    expect(wild / N).toBeGreaterThan(0.05);
    expect(wild / N).toBeLessThan(0.25);
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

/** Per-seat packs for a simulation, drawn through the shipped drawFromPack so
 * the sim rolls the same die the table does — seeded, so a failure is
 * reproducible. */
function makePackDraw(seed: number): (c: Ludo4Color) => number {
  const counts = new Map<typeof PLAYER_COLORS[number], number>(PLAYER_COLORS.map(c => [c, 0]));
  return (c: Ludo4Color) => {
    const seat = PLAYER_COLORS.indexOf(c);
    const i = counts.get(c)!;
    counts.set(c, i + 1);
    return packFace(seed, seat, i);
  };
}

/** Four identical bots play a full game; returns the winner. Same harness as
 * ludo4FinishSim, kept lean — this file only cares who wins. */
function playGame(seed: number): Ludo4Color | null {
  const rand = rng(seed);
  const draw = makePackDraw(packSeed(`S${seed}`, 1700000000000 + seed));
  let tokens: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');
  let turn: Ludo4Color = PLAYER_COLORS[Math.floor(rand() * 4)];
  let sixes = 0;
  for (let turns = 0; turns < 6000; turns++) {
    const roll = draw(turn);
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
  it('is already warm on the very first throw', async () => {
    const n = 60000;
    let sixes = 0;
    for (let i = 0; i < n; i++) if ((await requestYardRoll(0)).rolls[0] === 6) sixes++;
    // (2 + 0)/8 = exactly 1/4 ± 7σ. The gentler curve this replaced opened at
    // a stone-fair 1/6 and was too flat to be felt (see ludo4GameLogic).
    expect(sixes / n).toBeGreaterThan(0.237);
    expect(sixes / n).toBeLessThan(0.263);
  });

  it('warms to a coin on the last throw before the given 6', async () => {
    const n = 60000;
    let sixes = 0;
    for (let i = 0; i < n; i++) {
      if ((await requestYardRoll(YARD_MISS_LIMIT - 1)).rolls[0] === 6) sixes++;
    }
    // The warmest throw before the given 6 is (2 + 2)/8 = exactly 1/2, ± 6σ.
    expect(sixes / n).toBeGreaterThan(0.487);
    expect(sixes / n).toBeLessThan(0.513);
  });

  it('keeps the five other faces even while warm', async () => {
    // Warmth may only feed the 6. If the remainder is shared unevenly the low
    // faces pick up a bias nobody stated — at the warmest step each of 1..5
    // should carry (1 − 1/2)/5 = 10% of all throws.
    const n = 60000;
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      const f = (await requestYardRoll(YARD_MISS_LIMIT - 1)).rolls[0];
      if (f !== 6) counts[f - 1]++;
    }
    for (const c of counts) {
      expect(c / n).toBeGreaterThan(0.092);
      expect(c / n).toBeLessThan(0.108);
    }
  });

  it('serves the given 6 once the misses are spent', async () => {
    for (let i = 0; i < 50; i++) {
      expect((await requestYardRoll(YARD_MISS_LIMIT)).rolls[0]).toBe(6);
      expect((await requestYardRoll(YARD_MISS_LIMIT + 3)).rolls[0]).toBe(6);
    }
  });
});

/**
 * The whole warm-die pipeline, simulated the way the client runs it: the same
 * isWarmThrow gate, the same curve, the same miss accounting as the no-move
 * path in Ludo4Game, with the cold branch drawing from the seat's pack.
 *
 * Returns, per seat, the longest run of that seat's OWN consecutive turns
 * spent with a counter in the yard and no legal move.
 */
function worstYardWait(seed: number): Record<Ludo4Color, number> {
  const rand = rng(seed);
  const draw = makePackDraw(packSeed(`S${seed}`, 1700000000000 + seed));
  let tokens: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');
  let turn: Ludo4Color = PLAYER_COLORS[Math.floor(rand() * 4)];
  let sixes = 0;
  const misses: Record<Ludo4Color, number> = { red: 0, green: 0, yellow: 0, blue: 0 };
  const run: Record<Ludo4Color, number> = { red: 0, green: 0, yellow: 0, blue: 0 };
  const worst: Record<Ludo4Color, number> = { red: 0, green: 0, yellow: 0, blue: 0 };

  for (let t = 0; t < 20000; t++) {
    const before = misses[turn];
    const warm = isWarmThrow(tokens, turn, before);
    let roll: number;
    if (warm && before >= YARD_MISS_LIMIT) {
      roll = 6; // the given 6
    } else if (warm) {
      // P(6) = (2 + misses) / 8, the other five faces sharing the remainder.
      const sixStates = (2 + before) * 5;
      const r = Math.floor(rand() * 40);
      roll = r < sixStates ? 6 : 1 + ((r - sixStates) % 5);
    } else {
      // The cold branch is the shipped pack die; warm throws never draw from
      // the pack, exactly as in the client.
      roll = draw(turn);
    }

    const moves = getValidMoves(tokens, turn, roll);
    if (moves.length === 0) {
      const waiting = hasYardCounter(tokens, turn);
      misses[turn] = waiting ? before + 1 : 0;
      if (waiting) {
        run[turn]++;
        if (run[turn] > worst[turn]) worst[turn] = run[turn];
      }
      const next = getNextTurn(turn, roll, sixes, false, false, 4, getFinishedColors(tokens, 4));
      turn = next.nextColor;
      sixes = next.nextSixes;
      continue;
    }

    run[turn] = 0;
    misses[turn] = 0;
    let best = moves[0];
    let bestScore = -Infinity;
    for (const m of moves) {
      const s = scoreBotMove(m.tokenIndex, m.newPosition, tokens, turn, 4);
      if (s > bestScore) { bestScore = s; best = m; }
    }
    const applied = applyMove(tokens, best.tokenIndex, best.newPosition);
    tokens = applied.newTokens;
    if (checkPlayerFinished(tokens, turn)) break;
    const next = getNextTurn(
      turn, roll, sixes, applied.captured, applied.reachedHome, 4, getFinishedColors(tokens, 4)
    );
    turn = next.nextColor;
    sixes = next.nextSixes;
  }
  return worst;
}

describe('nobody is left watching their own yard', () => {
  it('caps the wait at three dead turns, in real games', () => {
    // The card promises the fourth throw is a given 6 — the table's own
    // spec, stated as "a 6 within four goes when you can't move anything
    // else". That promise is only worth anything if it is reachable, and the
    // rule it replaced made it almost unreachable: warmth applied only while
    // all five counters were at home, so a seat stranded late in the game —
    // one counter stuck out on the ring, the rest waiting behind a 6 — was
    // stuck against a cold die with no cap at all.
    //
    // Under the rule as it now stands the guarantee binds: a fourth consecutive
    // dead turn is not reachable at all, because the third miss makes the next
    // throw a given 6 and a 6 always deploys. This is the assertion that would
    // fail if the warm condition were ever narrowed back to the board state
    // instead of the wasted turn.
    let worstSeen = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const worst = worstYardWait(seed);
      for (const color of PLAYER_COLORS) {
        worstSeen = Math.max(worstSeen, worst[color]);
      }
    }
    expect(worstSeen).toBeLessThanOrEqual(YARD_MISS_LIMIT);
  }, 30_000);
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
    expect(game).toContain('three of every face');
    // The cut and the wild throw are the answer to "you could almost guess the
    // next number" — they may only exist for as long as the card says so.
    expect(game).toContain('cut');
    expect(game).toContain('one throw in seven is wild');
    // The warm throw may exist only for as long as the card discloses it, and
    // the card has to name the condition it actually fires on — "while all five
    // are at home" described a rule the game no longer plays.
    expect(game).toContain('the die warms to you');
    expect(game).toContain('leaves you nothing to do');
    expect(game).toContain('given');
  });

  it('shows the warm throws it took, beside the faces they produced', () => {
    // The six face columns are read as a fairness record, and a warm throw
    // leans to the 6 — so a seat that was shut out a lot shows a tall 6 column
    // for a reason that has nothing to do with the die being crooked. The `w`
    // column is what makes that readable rather than suspicious; without it the
    // tally is an honest number presented misleadingly.
    expect(game).toContain('Warm throws (shut out of your yard)');
    expect(game).toContain('stats.warm');
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
    'singlePlayer', 'rollStats', 'yardMisses', 'packThrows',
  ];

  it.each(written)('allows %s', (field) => {
    expect(allowed.has(field)).toBe(true);
  });

  it('caps the token string at exactly 20 counters', () => {
    const tokens = node.tokens as { '.validate': string };
    expect(tokens['.validate']).toContain('length == 60');
  });
});
