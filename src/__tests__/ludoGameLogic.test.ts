import { describe, it, expect } from 'vitest';
import {
  calculateNewPosition,
  getValidMoves,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  findNextActivePlayer,
  getNextTurn,
  scoreBotMove,
} from '../ludoGameLogic';
import type { TokenPosition } from '../ludoFirebase';

// Constants from ludoPowerUps (used implicitly by the logic)
// Red: start=1, entry=55 | Green: start=15, entry=13
// Yellow: start=29, entry=27 | Blue: start=43, entry=41
// Safe zones: 1, 10, 15, 24, 29, 38, 43, 52
// Track size: 56

const BASE_TOKENS: TokenPosition[] = Array(16).fill('base');

describe('calculateNewPosition', () => {
  it('returns null for base position', () => {
    expect(calculateNewPosition('base', 3, 'red')).toBeNull();
  });

  it('returns null for final-6 (already home)', () => {
    expect(calculateNewPosition('final-6', 1, 'red')).toBeNull();
  });

  // --- Final corridor movement ---
  it('moves within final corridor', () => {
    expect(calculateNewPosition('final-2', 3, 'red')).toBe('final-5');
  });

  it('reaches home (final-6) exactly', () => {
    expect(calculateNewPosition('final-4', 2, 'red')).toBe('final-6');
  });

  it('rejects overshoot past final-6', () => {
    expect(calculateNewPosition('final-4', 3, 'red')).toBeNull();
  });

  it('rejects large overshoot in corridor', () => {
    expect(calculateNewPosition('final-1', 7, 'red')).toBeNull();
  });

  // --- Entry cell to final corridor ---
  it('enters final corridor from entry cell (red entry=55)', () => {
    expect(calculateNewPosition('track-55', 3, 'red')).toBe('final-3');
  });

  it('enters final corridor from entry cell with exact 6', () => {
    expect(calculateNewPosition('track-55', 6, 'red')).toBe('final-6');
  });

  it('rejects > 6 steps from entry cell', () => {
    expect(calculateNewPosition('track-55', 7, 'red')).toBeNull();
  });

  // --- Normal track movement ---
  it('moves forward on track', () => {
    expect(calculateNewPosition('track-5', 3, 'red')).toBe('track-8');
  });

  it('wraps around track (cell 56 → cell 1)', () => {
    // Red entry is at 55, so from 54 with 4 steps = enters corridor (final-3).
    // Use green (entry=13) for a clean wrap test: track-54 + 4 = track-2 (no entry crossing)
    expect(calculateNewPosition('track-54', 4, 'green')).toBe('track-2');
  });

  it('wraps around track exactly to cell 1', () => {
    expect(calculateNewPosition('track-56', 1, 'red')).toBe('track-1');
  });

  // --- Entry detection from distance ---
  it('passes through track without entering corridor when steps <= stepsToEntry', () => {
    // Red at track-50, entry at 55. stepsToEntry = 5. Roll 3 → track-53.
    expect(calculateNewPosition('track-50', 3, 'red')).toBe('track-53');
  });

  it('enters corridor when steps > stepsToEntry', () => {
    // Red at track-50, entry at 55. stepsToEntry = 5. Roll 7 → final-2.
    expect(calculateNewPosition('track-50', 7, 'red')).toBe('final-2');
  });

  it('rejects entry overshoot (remaining > 6)', () => {
    // Red at track-40, entry at 55. stepsToEntry = 15. Roll 22 → remaining 7 > 6.
    expect(calculateNewPosition('track-40', 22, 'red')).toBeNull();
  });

  // --- Green player (entry=13, start=15) ---
  it('green enters corridor correctly', () => {
    expect(calculateNewPosition('track-13', 4, 'green')).toBe('final-4');
  });

  it('green wraps past entry', () => {
    // Green at track-10, entry at 13. stepsToEntry = 3. Roll 5 → final-2.
    expect(calculateNewPosition('track-10', 5, 'green')).toBe('final-2');
  });

  // --- Yellow player (entry=27) ---
  it('yellow enters corridor', () => {
    expect(calculateNewPosition('track-27', 1, 'yellow')).toBe('final-1');
  });

  // --- Blue player (entry=41) ---
  it('blue wraps and enters corridor', () => {
    // Blue at track-39. entry=41. stepsToEntry = 2. Roll 4 → final-2.
    expect(calculateNewPosition('track-39', 4, 'blue')).toBe('final-2');
  });
});

describe('getValidMoves', () => {
  it('returns empty for all tokens at base with non-6 roll', () => {
    const moves = getValidMoves(BASE_TOKENS, 'red', 3);
    expect(moves).toHaveLength(0);
  });

  it('returns deploy moves for base tokens on roll of 6', () => {
    const moves = getValidMoves(BASE_TOKENS, 'red', 6);
    expect(moves).toHaveLength(4); // All 4 red tokens can deploy
    expect(moves[0].newPosition).toBe('track-1');
  });

  it('returns deploy moves on effective 12 (Super Mushroom doubled 6)', () => {
    const moves = getValidMoves(BASE_TOKENS, 'red', 12);
    expect(moves).toHaveLength(4);
  });

  it('does not return moves for final-6 tokens', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-6';
    tokens[1] = 'track-5';
    const moves = getValidMoves(tokens, 'red', 3);
    // Only token 1 (track-5) can move, not token 0 (final-6) or 2,3 (base)
    expect(moves).toHaveLength(1);
    expect(moves[0].tokenIndex).toBe(1);
  });

  it('filters out invalid moves (overshoot)', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-5'; // Can only move 1 to reach home
    const moves = getValidMoves(tokens, 'red', 3); // 3 overshoots
    expect(moves).toHaveLength(0);
  });
});

describe('applyMove', () => {
  it('moves token to new position', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-5';
    const { newTokens } = applyMove(tokens, 0, 'track-8');
    expect(newTokens[0]).toBe('track-8');
  });

  it('captures opponent on non-safe track cell', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-3'; // Red token
    tokens[4] = 'track-5'; // Green token at destination
    const { newTokens, captured } = applyMove(tokens, 0, 'track-5');
    expect(captured).toBe(true);
    expect(newTokens[4]).toBe('base'); // Green sent home
    expect(newTokens[0]).toBe('track-5'); // Red at destination
  });

  it('does NOT capture on safe zone', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-8'; // Red
    tokens[4] = 'track-10'; // Green on safe zone
    const { newTokens, captured } = applyMove(tokens, 0, 'track-10');
    expect(captured).toBe(false);
    expect(newTokens[4]).toBe('track-10'); // Green stays
    expect(newTokens[0]).toBe('track-10'); // Both coexist
  });

  it('does NOT capture same-team tokens', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-3'; // Red token 0
    tokens[1] = 'track-5'; // Red token 1
    const { newTokens, captured } = applyMove(tokens, 0, 'track-5');
    expect(captured).toBe(false);
    expect(newTokens[1]).toBe('track-5'); // Red token 1 stays
  });

  it('captures multiple opponents on same cell', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-3'; // Red
    tokens[4] = 'track-5'; // Green
    tokens[8] = 'track-5'; // Yellow — same cell
    const { newTokens, captured } = applyMove(tokens, 0, 'track-5');
    expect(captured).toBe(true);
    expect(newTokens[4]).toBe('base');
    expect(newTokens[8]).toBe('base');
  });

  it('detects reaching home', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-4';
    const { reachedHome } = applyMove(tokens, 0, 'final-6');
    expect(reachedHome).toBe(true);
  });

  it('does not detect reaching home for non-final-6', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-2';
    const { reachedHome } = applyMove(tokens, 0, 'final-5');
    expect(reachedHome).toBe(false);
  });

  it('does not capture in final corridor', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-2'; // Red
    tokens[4] = 'final-3'; // Green — different position anyway
    const { captured } = applyMove(tokens, 0, 'final-3');
    // final positions don't trigger capture logic (only track- positions do)
    expect(captured).toBe(false);
  });
});

describe('checkPlayerFinished', () => {
  it('returns false when not all tokens at final-6', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-6';
    tokens[1] = 'final-6';
    tokens[2] = 'final-6';
    tokens[3] = 'track-5'; // Not home yet
    expect(checkPlayerFinished(tokens, 'red')).toBe(false);
  });

  it('returns true when all 4 tokens at final-6', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'final-6';
    tokens[1] = 'final-6';
    tokens[2] = 'final-6';
    tokens[3] = 'final-6';
    expect(checkPlayerFinished(tokens, 'red')).toBe(true);
  });

  it('checks correct color indices', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    // Green indices are 4-7
    tokens[4] = 'final-6';
    tokens[5] = 'final-6';
    tokens[6] = 'final-6';
    tokens[7] = 'final-6';
    expect(checkPlayerFinished(tokens, 'green')).toBe(true);
    expect(checkPlayerFinished(tokens, 'red')).toBe(false);
  });
});

describe('getFinishedColors', () => {
  it('returns empty set when no one finished', () => {
    expect(getFinishedColors(BASE_TOKENS, 4).size).toBe(0);
  });

  it('returns finished colors only within player count', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    // Finish yellow (indices 8-11)
    tokens[8] = 'final-6';
    tokens[9] = 'final-6';
    tokens[10] = 'final-6';
    tokens[11] = 'final-6';
    const finished = getFinishedColors(tokens, 4);
    expect(finished.has('yellow')).toBe(true);
    expect(finished.size).toBe(1);
  });

  it('ignores colors beyond player count', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    // Finish blue (indices 12-15), but only 3 players
    tokens[12] = 'final-6';
    tokens[13] = 'final-6';
    tokens[14] = 'final-6';
    tokens[15] = 'final-6';
    const finished = getFinishedColors(tokens, 3); // Only red, green, yellow
    expect(finished.has('blue')).toBe(false);
  });
});

describe('findNextActivePlayer', () => {
  it('advances to next player', () => {
    expect(findNextActivePlayer('red', 4, new Set())).toBe('green');
    expect(findNextActivePlayer('green', 4, new Set())).toBe('yellow');
    expect(findNextActivePlayer('blue', 4, new Set())).toBe('red');
  });

  it('skips finished players', () => {
    const finished = new Set<'red' | 'green' | 'yellow' | 'blue'>(['green']);
    expect(findNextActivePlayer('red', 4, finished)).toBe('yellow');
  });

  it('wraps around skipping finished', () => {
    const finished = new Set<'red' | 'green' | 'yellow' | 'blue'>(['blue', 'red']);
    expect(findNextActivePlayer('yellow', 4, finished)).toBe('green');
  });

  it('returns current if all others finished', () => {
    const finished = new Set<'red' | 'green' | 'yellow' | 'blue'>(['green', 'yellow', 'blue']);
    expect(findNextActivePlayer('red', 4, finished)).toBe('red');
  });

  it('respects player count (2 players)', () => {
    expect(findNextActivePlayer('red', 2, new Set())).toBe('green');
    expect(findNextActivePlayer('green', 2, new Set())).toBe('red');
  });
});

describe('getNextTurn', () => {
  const noFinished = new Set<'red' | 'green' | 'yellow' | 'blue'>();

  it('grants bonus turn on rolling 6', () => {
    const { nextColor, nextSixes } = getNextTurn('red', 6, 0, false, false, 4, noFinished);
    expect(nextColor).toBe('red');
    expect(nextSixes).toBe(1);
  });

  it('grants bonus turn on effective 12 (doubled 6)', () => {
    const { nextColor } = getNextTurn('red', 12, 0, false, false, 4, noFinished);
    expect(nextColor).toBe('red');
  });

  it('no bonus on 3 consecutive sixes', () => {
    const { nextColor, nextSixes } = getNextTurn('red', 6, 2, false, false, 4, noFinished);
    expect(nextColor).toBe('green'); // Turn passes
    expect(nextSixes).toBe(0);
  });

  it('grants bonus turn on capture', () => {
    const { nextColor, nextSixes } = getNextTurn('red', 3, 0, true, false, 4, noFinished);
    expect(nextColor).toBe('red');
    expect(nextSixes).toBe(0); // Capture resets sixes
  });

  it('grants bonus turn on reaching home', () => {
    const { nextColor } = getNextTurn('red', 2, 0, false, true, 4, noFinished);
    expect(nextColor).toBe('red');
  });

  it('advances turn on normal roll', () => {
    const { nextColor } = getNextTurn('red', 3, 0, false, false, 4, noFinished);
    expect(nextColor).toBe('green');
  });

  it('immediately advances if current player just finished', () => {
    const finished = new Set<'red' | 'green' | 'yellow' | 'blue'>(['red']);
    const { nextColor } = getNextTurn('red', 6, 0, false, false, 4, finished);
    expect(nextColor).toBe('green'); // No bonus even though rolled 6
  });

  it('6 bonus takes priority over capture bonus', () => {
    const { nextColor, nextSixes } = getNextTurn('red', 6, 1, true, false, 4, noFinished);
    expect(nextColor).toBe('red');
    expect(nextSixes).toBe(2); // 6 increments sixes even with capture
  });
});

describe('scoreBotMove', () => {
  const noFlag = { cell: null, carrier: null, used: true } as const;
  const noEffects: any[] = [];

  it('scores deploy from base positively', () => {
    const score = scoreBotMove(0, 'track-1', BASE_TOKENS, 'red', 4, noEffects, noFlag);
    expect(score).toBeGreaterThan(0);
  });

  it('scores final corridor higher than track', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-50';
    const trackScore = scoreBotMove(0, 'track-53', tokens, 'red', 4, noEffects, noFlag);
    const finalScore = scoreBotMove(0, 'final-3', tokens, 'red', 4, noEffects, noFlag);
    expect(finalScore).toBeGreaterThan(trackScore);
  });

  it('scores capture higher than non-capture', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-3';
    tokens[4] = 'track-5'; // Green opponent at cell 5
    const captureScore = scoreBotMove(0, 'track-5', tokens, 'red', 4, noEffects, noFlag);
    const nonCaptureScore = scoreBotMove(0, 'track-4', tokens, 'red', 4, noEffects, noFlag);
    expect(captureScore).toBeGreaterThan(nonCaptureScore);
  });

  it('penalizes landing on banana', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-3';
    const bananas = [{ type: 'banana' as const, cell: 5, ownerColorIdx: 1 }]; // Green's banana
    const bananaScore = scoreBotMove(0, 'track-5', tokens, 'red', 4, bananas, noFlag);
    const cleanScore = scoreBotMove(0, 'track-5', tokens, 'red', 4, noEffects, noFlag);
    expect(bananaScore).toBeLessThan(cleanScore);
  });

  it('prefers safe zones', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-8';
    const safeScore = scoreBotMove(0, 'track-10', tokens, 'red', 4, noEffects, noFlag); // Cell 10 is safe
    const unsafeScore = scoreBotMove(0, 'track-9', tokens, 'red', 4, noEffects, noFlag);
    expect(safeScore).toBeGreaterThan(unsafeScore);
  });

  it('penalizes landing near opponents', () => {
    const tokens = [...BASE_TOKENS] as TokenPosition[];
    tokens[0] = 'track-3';
    tokens[4] = 'track-4'; // Green 1 cell behind target cell 5
    const dangerScore = scoreBotMove(0, 'track-5', tokens, 'red', 4, noEffects, noFlag);
    // Without opponent nearby
    const tokens2 = [...BASE_TOKENS] as TokenPosition[];
    tokens2[0] = 'track-3';
    const safeScore = scoreBotMove(0, 'track-5', tokens2, 'red', 4, noEffects, noFlag);
    expect(dangerScore).toBeLessThan(safeScore);
  });
});
