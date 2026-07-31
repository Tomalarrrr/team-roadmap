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
} from '../ludo2GameLogic';
import {
  SAFE_ZONES,
  START_POSITIONS,
  ENTRY_CELLS,
  getPlayerScore,
  initRollStats,
  deserializeRollStats,
  recordRoll,
  recordCapture,
  serializeRollStats,
  mergeRollStats,
  INITIAL_TOKENS,
} from '../ludo2Board';
import { deserializeTokens, serializeTokens } from '../ludoFirebase';
import type { TokenPosition } from '../ludoFirebase';

// Board: 42-cell track, 3 arms × 14.
// Red: start=1, entry=41 | Green: start=15, entry=13 | Yellow: start=29, entry=27
// Safe zones: 1, 10, 15, 24, 29, 38
// Token indices: red 0-3, green 4-7, yellow 8-11

const BASE_TOKENS: TokenPosition[] = Array(12).fill('base');

function tokensWith(overrides: Record<number, TokenPosition>): TokenPosition[] {
  const t = [...BASE_TOKENS];
  for (const [idx, pos] of Object.entries(overrides)) t[Number(idx)] = pos;
  return t;
}

describe('board constants', () => {
  it('entry cells are start - 2 mod 42', () => {
    for (const color of ['red', 'green', 'yellow'] as const) {
      const expected = ((START_POSITIONS[color] - 3 + 42) % 42) + 1;
      expect(ENTRY_CELLS[color]).toBe(expected);
    }
  });

  it('safe zones are all starts plus start+9', () => {
    expect([...SAFE_ZONES].sort((a, b) => a - b)).toEqual([1, 10, 15, 24, 29, 38]);
  });

  it('initial tokens string is 36 chars of base', () => {
    expect(INITIAL_TOKENS).toHaveLength(36);
    expect(deserializeTokens(INITIAL_TOKENS)).toEqual(BASE_TOKENS);
  });

  it('token serialization round-trips at 12 tokens', () => {
    const t = tokensWith({ 0: 'track-42', 5: 'final-3', 11: 'track-7' });
    expect(deserializeTokens(serializeTokens(t))).toEqual(t);
  });
});

describe('calculateNewPosition', () => {
  it('returns null for base position', () => {
    expect(calculateNewPosition('base', 3, 'red')).toBeNull();
  });

  it('returns null for final-6 (already home)', () => {
    expect(calculateNewPosition('final-6', 1, 'red')).toBeNull();
  });

  it('moves within final corridor', () => {
    expect(calculateNewPosition('final-2', 3, 'red')).toBe('final-5');
  });

  it('reaches home (final-6) exactly', () => {
    expect(calculateNewPosition('final-4', 2, 'yellow')).toBe('final-6');
  });

  it('rejects overshoot past final-6', () => {
    expect(calculateNewPosition('final-4', 3, 'green')).toBeNull();
  });

  it('enters final corridor from entry cell (red entry=41)', () => {
    expect(calculateNewPosition('track-41', 3, 'red')).toBe('final-3');
  });

  it('enters final corridor from entry cell with exact 6', () => {
    expect(calculateNewPosition('track-41', 6, 'red')).toBe('final-6');
  });

  it('rejects > 6 steps from entry cell', () => {
    expect(calculateNewPosition('track-41', 7, 'red')).toBeNull();
  });

  it('enters green corridor from green entry (13)', () => {
    expect(calculateNewPosition('track-13', 2, 'green')).toBe('final-2');
  });

  it('enters yellow corridor from yellow entry (27)', () => {
    expect(calculateNewPosition('track-27', 1, 'yellow')).toBe('final-1');
  });

  it('moves forward on track', () => {
    expect(calculateNewPosition('track-5', 3, 'green')).toBe('track-8');
  });

  it('wraps around track (cell 42 → cell 1)', () => {
    // Green entry is 13, no crossing: 42 + 1 = 1
    expect(calculateNewPosition('track-42', 1, 'green')).toBe('track-1');
  });

  it('wraps around track across the seam', () => {
    expect(calculateNewPosition('track-40', 4, 'green')).toBe('track-2');
  });

  it('crosses into corridor when passing own entry', () => {
    // Red at track-39, entry 41. stepsToEntry = 2. Roll 5 → final-3.
    expect(calculateNewPosition('track-39', 5, 'red')).toBe('final-3');
  });

  it('stops on own entry cell without entering corridor', () => {
    // Landing exactly on the entry stays a track cell; corridor entry happens next turn
    expect(calculateNewPosition('track-39', 2, 'red')).toBe('track-41');
  });

  it('non-owner passes over another color entry cell', () => {
    // Yellow passing red's entry (41): 40 + 3 = 1 (wrap), no corridor
    expect(calculateNewPosition('track-40', 3, 'yellow')).toBe('track-1');
  });

  it('rejects overshoot past own corridor from just before entry', () => {
    // Red at track-40, entry 41 → stepsToEntry 1; roll 8 impossible, roll 6 → remaining 5 = final-5
    expect(calculateNewPosition('track-40', 6, 'red')).toBe('final-5');
  });
});

describe('getValidMoves', () => {
  it('no moves from base without a 6', () => {
    expect(getValidMoves(BASE_TOKENS, 'red', 5)).toEqual([]);
  });

  it('deploys all base tokens on a 6', () => {
    const moves = getValidMoves(BASE_TOKENS, 'red', 6);
    expect(moves).toHaveLength(4);
    expect(moves.every(m => m.newPosition === 'track-1')).toBe(true);
  });

  it('deploys green to track-15 and yellow to track-29', () => {
    expect(getValidMoves(BASE_TOKENS, 'green', 6)[0].newPosition).toBe('track-15');
    expect(getValidMoves(BASE_TOKENS, 'yellow', 6)[0].newPosition).toBe('track-29');
  });

  it('skips finished tokens', () => {
    const t = tokensWith({ 0: 'final-6', 1: 'track-5' });
    const moves = getValidMoves(t, 'red', 3);
    expect(moves).toEqual([{ tokenIndex: 1, newPosition: 'track-8' }]);
  });

  it('excludes corridor overshoots', () => {
    const t = tokensWith({ 4: 'final-5' });
    expect(getValidMoves(t, 'green', 3)).toEqual([]);
  });

  it('only returns moves for the given color', () => {
    const t = tokensWith({ 0: 'track-3', 4: 'track-16', 8: 'track-30' });
    const moves = getValidMoves(t, 'yellow', 2);
    expect(moves).toEqual([{ tokenIndex: 8, newPosition: 'track-32' }]);
  });
});

describe('applyMove', () => {
  it('moves a token', () => {
    const t = tokensWith({ 0: 'track-3' });
    const { newTokens, captured, reachedHome } = applyMove(t, 0, 'track-6');
    expect(newTokens[0]).toBe('track-6');
    expect(captured).toBe(false);
    expect(reachedHome).toBe(false);
  });

  it('captures an opponent on the target cell', () => {
    const t = tokensWith({ 0: 'track-3', 4: 'track-6' });
    const { newTokens, captured } = applyMove(t, 0, 'track-6');
    expect(captured).toBe(true);
    expect(newTokens[4]).toBe('base');
  });

  it('captures multiple opponents on the same cell', () => {
    const t = tokensWith({ 0: 'track-3', 4: 'track-6', 8: 'track-6' });
    const { newTokens, captured } = applyMove(t, 0, 'track-6');
    expect(captured).toBe(true);
    expect(newTokens[4]).toBe('base');
    expect(newTokens[8]).toBe('base');
  });

  it('does not capture own tokens', () => {
    const t = tokensWith({ 0: 'track-3', 1: 'track-6' });
    const { newTokens, captured } = applyMove(t, 0, 'track-6');
    expect(captured).toBe(false);
    expect(newTokens[1]).toBe('track-6');
  });

  it.each([...SAFE_ZONES])('does not capture on safe zone %i', cell => {
    const t = tokensWith({ 0: 'track-2', 4: `track-${cell}` });
    const { newTokens, captured } = applyMove(t, 0, `track-${cell}`);
    expect(captured).toBe(false);
    expect(newTokens[4]).toBe(`track-${cell}`);
  });

  it('reports reachedHome for final-6', () => {
    const t = tokensWith({ 8: 'final-4' });
    const { reachedHome } = applyMove(t, 8, 'final-6');
    expect(reachedHome).toBe(true);
  });

  it('no capture inside final corridor', () => {
    // Corridor positions are per-color namespaced; same string must not capture
    const t = tokensWith({ 0: 'final-1', 4: 'final-3' });
    const { captured, newTokens } = applyMove(t, 0, 'final-3');
    expect(captured).toBe(false);
    expect(newTokens[4]).toBe('final-3');
  });
});

describe('checkPlayerFinished / getFinishedColors', () => {
  it('detects a finished player', () => {
    const t = tokensWith({ 0: 'final-6', 1: 'final-6', 2: 'final-6', 3: 'final-6' });
    expect(checkPlayerFinished(t, 'red')).toBe(true);
    expect(checkPlayerFinished(t, 'green')).toBe(false);
  });

  it('not finished with 3 of 4 home', () => {
    const t = tokensWith({ 0: 'final-6', 1: 'final-6', 2: 'final-6', 3: 'final-5' });
    expect(checkPlayerFinished(t, 'red')).toBe(false);
  });

  it('getFinishedColors respects playerCount', () => {
    const t = tokensWith({
      8: 'final-6', 9: 'final-6', 10: 'final-6', 11: 'final-6',
    });
    expect(getFinishedColors(t, 3)).toEqual(new Set(['yellow']));
    expect(getFinishedColors(t, 2)).toEqual(new Set());
  });
});

describe('findNextActivePlayer', () => {
  it('rotates red → green → yellow → red with 3 players', () => {
    expect(findNextActivePlayer('red', 3, new Set())).toBe('green');
    expect(findNextActivePlayer('green', 3, new Set())).toBe('yellow');
    expect(findNextActivePlayer('yellow', 3, new Set())).toBe('red');
  });

  it('rotates red → green → red with 2 players', () => {
    expect(findNextActivePlayer('red', 2, new Set())).toBe('green');
    expect(findNextActivePlayer('green', 2, new Set())).toBe('red');
  });

  it('skips finished players', () => {
    expect(findNextActivePlayer('red', 3, new Set(['green']))).toBe('yellow');
  });
});

describe('getNextTurn', () => {
  const none = new Set<never>() as Set<'red' | 'green' | 'yellow'>;

  it('advances on a normal roll', () => {
    expect(getNextTurn('red', 3, 0, false, false, 3, none))
      .toEqual({ nextColor: 'green', nextSixes: 0 });
  });

  it('bonus turn on a 6', () => {
    expect(getNextTurn('red', 6, 0, false, false, 3, none))
      .toEqual({ nextColor: 'red', nextSixes: 1 });
  });

  it('third consecutive 6 forfeits the bonus', () => {
    expect(getNextTurn('red', 6, 2, false, false, 3, none))
      .toEqual({ nextColor: 'green', nextSixes: 0 });
  });

  it('bonus turn on capture', () => {
    expect(getNextTurn('green', 4, 0, true, false, 3, none))
      .toEqual({ nextColor: 'green', nextSixes: 0 });
  });

  it('bonus turn on reaching home', () => {
    expect(getNextTurn('yellow', 2, 0, false, true, 3, none))
      .toEqual({ nextColor: 'yellow', nextSixes: 0 });
  });

  it('always advances when the player just finished', () => {
    expect(getNextTurn('red', 6, 0, false, true, 3, new Set(['red'])))
      .toEqual({ nextColor: 'green', nextSixes: 0 });
  });
});

describe('scoreBotMove', () => {
  it('prefers capturing over plain advancement', () => {
    const t = tokensWith({ 4: 'track-16', 8: 'track-20' });
    const capture = scoreBotMove(4, 'track-20', t, 'green', 3);
    const advance = scoreBotMove(4, 'track-19', t, 'green', 3);
    expect(capture).toBeGreaterThan(advance);
  });

  it('does not score a capture on a safe zone', () => {
    const t = tokensWith({ 4: 'track-22', 8: 'track-24' });
    const ontoSafe = scoreBotMove(4, 'track-24', t, 'green', 3);
    // Safe-zone landing gets +15 but no capture bonus (>100)
    expect(ontoSafe).toBeLessThan(100);
  });

  it('values corridor entry over track movement', () => {
    const t = tokensWith({ 0: 'track-41' });
    const corridor = scoreBotMove(0, 'final-3', t, 'red', 3);
    const track = tokensWith({ 0: 'track-30' });
    const advance = scoreBotMove(0, 'track-33', track, 'red', 3);
    expect(corridor).toBeGreaterThan(advance);
  });

  it('first deploy scores higher than later deploys', () => {
    const noneOut = scoreBotMove(0, 'track-1', BASE_TOKENS, 'red', 3);
    const oneOut = tokensWith({ 1: 'track-10' });
    const second = scoreBotMove(0, 'track-1', oneOut, 'red', 3);
    expect(noneOut).toBeGreaterThan(second);
  });

  it('penalizes landing within reach of an opponent', () => {
    // Green token would land on 20 with red on 18 (2 behind, can capture)
    const threatened = tokensWith({ 4: 'track-17', 0: 'track-18' });
    const clear = tokensWith({ 4: 'track-17' });
    const risky = scoreBotMove(4, 'track-20', threatened, 'green', 3);
    const safe = scoreBotMove(4, 'track-20', clear, 'green', 3);
    expect(risky).toBeLessThan(safe);
  });
});

describe('getPlayerScore', () => {
  it('scores base as 0 and home as track+6', () => {
    expect(getPlayerScore(BASE_TOKENS, 'red')).toBe(0);
    const t = tokensWith({ 0: 'final-6' });
    expect(getPlayerScore(t, 'red')).toBe(48);
  });

  it('scores track distance from own start', () => {
    // Yellow start=29; track-31 → distance 2
    const t = tokensWith({ 8: 'track-31' });
    expect(getPlayerScore(t, 'yellow')).toBe(2);
  });

  it('wraps distance across the seam', () => {
    // Yellow start=29; track-2 → (42-29)+2 = 15
    const t = tokensWith({ 8: 'track-2' });
    expect(getPlayerScore(t, 'yellow')).toBe(15);
  });
});

describe('rollStats (3 colors)', () => {
  it('init has 3 empty groups', () => {
    const stats = deserializeRollStats(initRollStats());
    expect(stats).toHaveLength(3);
    expect(stats.every(s => s.rolls.every(r => r === 0) && s.captures === 0)).toBe(true);
  });

  it('records rolls and captures, round-trips', () => {
    let stats = deserializeRollStats(initRollStats());
    stats = recordRoll(stats, 1, 6);
    stats = recordCapture(stats, 2);
    const rt = deserializeRollStats(serializeRollStats(stats));
    expect(rt[1].rolls[5]).toBe(1);
    expect(rt[2].captures).toBe(1);
  });

  it('merge takes per-cell max', () => {
    let a = deserializeRollStats(initRollStats());
    a = recordRoll(a, 0, 1);
    a = recordRoll(a, 0, 1);
    let b = deserializeRollStats(initRollStats());
    b = recordRoll(b, 0, 1);
    b = recordCapture(b, 1);
    const merged = deserializeRollStats(
      mergeRollStats(serializeRollStats(a), serializeRollStats(b))
    );
    expect(merged[0].rolls[0]).toBe(2);
    expect(merged[1].captures).toBe(1);
  });

  it('tolerates empty and short input', () => {
    expect(deserializeRollStats('')).toHaveLength(3);
    expect(deserializeRollStats('1,0,0,0,0,0,2')).toHaveLength(3);
  });
});
