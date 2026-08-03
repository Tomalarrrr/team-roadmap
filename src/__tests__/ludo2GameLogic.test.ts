import { describe, it, expect } from 'vitest';
import {
  calculateNewPosition,
  getValidMoves,
  distinctMoves,
  getDistinctMoves,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  findNextActivePlayer,
  getNextTurn,
  scoreBotMove,
} from '../ludo2GameLogic';
import {
  SAFE_ZONES,
  TRACK_SIZE,
  TOTAL_TOKENS,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  START_POSITIONS,
  ENTRY_CELLS,
  MAX_PLAYER_SCORE,
  getPlayerScore,
  getStandings,
  describePosition,
  deserializeLudo2Tokens,
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

// Board: 42-cell track, 3 arms × 14. Starts at 1, 15, 29; each colour turns off
// for its run home on the cell before its own start.
// Safe zones: 1, 7, 15, 21, 29, 35
// Token indices: red 0-4, green 5-9, yellow 10-14
// Run home: five cells per colour, shared freely, walked into.
//
// Cell numbers are derived from START_POSITIONS/ENTRY_CELLS rather than written
// in. Where the entry sits relative to the start is a live design decision — it
// has already moved once — and a suite that hardcodes it fails as a block every
// time, saying only "41 is not 42" about a board that is working perfectly.

const BASE_TOKENS: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');

function tokensWith(overrides: Record<number, TokenPosition>): TokenPosition[] {
  const t = [...BASE_TOKENS];
  for (const [idx, pos] of Object.entries(overrides)) t[Number(idx)] = pos;
  return t;
}

function calc(from: TokenPosition, steps: number, color: 'red' | 'green' | 'yellow') {
  return calculateNewPosition(from, steps, color);
}

type Seat = 'red' | 'green' | 'yellow';

/** The cell `n` steps back round the ring from `cell` (1-based, wrapping). */
function cellBefore(cell: number, n: number): number {
  return ((cell - 1 - n + TRACK_SIZE * 2) % TRACK_SIZE) + 1;
}

/** `track-N` for the cell `n` steps short of `color`'s run-home turning. */
function beforeEntry(color: Seat, n: number): TokenPosition {
  return `track-${cellBefore(ENTRY_CELLS[color], n)}`;
}

/** `track-N` for `color`'s own entry cell. */
function atEntry(color: Seat): TokenPosition {
  return `track-${ENTRY_CELLS[color]}`;
}

describe('board constants', () => {
  it('each colour turns for home on the cell before its own start', () => {
    // One short is as close as the entry can get: calculateNewPosition has no
    // notion of laps, so a counter standing on its entry goes home on its next
    // move. Put the entry *on* the start and a counter would come out of the
    // yard and turn straight for home without ever travelling the ring.
    for (const color of ['red', 'green', 'yellow'] as const) {
      expect(ENTRY_CELLS[color]).toBe(cellBefore(START_POSITIONS[color], 1));
    }
  });

  it('gives every colour the same distance to run', () => {
    for (const color of ['red', 'green', 'yellow'] as const) {
      const start = START_POSITIONS[color];
      const entry = ENTRY_CELLS[color];
      const lap = entry >= start ? entry - start : TRACK_SIZE - start + entry;
      expect(lap).toBe(TRACK_SIZE - 1);
    }
  });

  it('safe zones are all starts plus start+6', () => {
    expect([...SAFE_ZONES].sort((a, b) => a - b)).toEqual([1, 7, 15, 21, 29, 35]);
  });

  it('caps the reach of a counter camped on its own start', () => {
    // A start cell is safe and is where counters keep arriving, so one parked
    // there is the board's strongest ambush: it cannot be taken and it covers
    // the six cells ahead. The next haven sits on the sixth of those, so the
    // ambush only ever covers five open cells and the runner has a landing.
    for (const start of Object.values(START_POSITIONS)) {
      const covered = [1, 2, 3, 4, 5, 6].filter(
        d => !SAFE_ZONES.has(((start - 1 + d) % TRACK_SIZE) + 1)
      );
      expect(covered).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('leaves no run of open cells longer than seven', () => {
    let longest = 0;
    let run = 0;
    for (let i = 0; i < TRACK_SIZE * 2; i++) {
      run = SAFE_ZONES.has((i % TRACK_SIZE) + 1) ? 0 : run + 1;
      if (i >= TRACK_SIZE) longest = Math.max(longest, run);
    }
    expect(longest).toBe(7);
  });

  it('gives each player exactly one counter per cell of the run home', () => {
    expect(TOKENS_PER_PLAYER).toBe(FINAL_SIZE);
    expect(TOTAL_TOKENS).toBe(FINAL_SIZE * 3);
  });

  it('initial tokens string is 45 chars of base', () => {
    expect(INITIAL_TOKENS).toHaveLength(45);
    expect(deserializeTokens(INITIAL_TOKENS)).toEqual(BASE_TOKENS);
  });

  it('token serialization round-trips at 15 tokens', () => {
    const t = tokensWith({ 0: 'track-42', 6: 'final-3', 14: 'track-7' });
    expect(deserializeTokens(serializeTokens(t))).toEqual(t);
  });

  it('pads a short token string from an older client', () => {
    const legacy = 'bas'.repeat(12);
    const padded = deserializeLudo2Tokens(legacy);
    expect(padded).toHaveLength(TOTAL_TOKENS);
    expect(padded.every(p => p === 'base')).toBe(true);
  });

});

describe('calculateNewPosition', () => {
  it('returns null for base position', () => {
    expect(calc('base', 3, 'red')).toBeNull();
  });

  it('moves up the run home', () => {
    expect(calc('final-2', 3, 'red')).toBe('final-5');
  });

  it('takes the last cell exactly', () => {
    expect(calc('final-3', 2, 'yellow')).toBe('final-5');
  });

  it('stops on the last cell rather than overshooting it', () => {
    expect(calc('final-4', 2, 'green')).toBe(`final-${FINAL_SIZE}`);
  });

  it('enters the run home from the entry cell', () => {
    expect(calc(atEntry('red'), 3, 'red')).toBe('final-3');
  });

  it('reaches the deepest cell from the entry cell with an exact 5', () => {
    expect(calc(atEntry('red'), FINAL_SIZE, 'red')).toBe(`final-${FINAL_SIZE}`);
  });

  it('walks in on a roll that would carry past the run home', () => {
    expect(calc(atEntry('red'), FINAL_SIZE + 1, 'red')).toBe(`final-${FINAL_SIZE}`);
  });

  it('enters green’s run home from green’s entry', () => {
    expect(calc(atEntry('green'), 2, 'green')).toBe('final-2');
  });

  it('enters yellow’s run home from yellow’s entry', () => {
    expect(calc(atEntry('yellow'), 1, 'yellow')).toBe('final-1');
  });

  it('moves forward on track', () => {
    expect(calc('track-5', 3, 'green')).toBe('track-8');
  });

  it('wraps around track (cell 42 → cell 1)', () => {
    // Green's turning is nowhere near the seam, so this is a plain wrap.
    expect(calc('track-42', 1, 'green')).toBe('track-1');
  });

  it('wraps around track across the seam', () => {
    expect(calc('track-40', 4, 'green')).toBe('track-2');
  });

  it('crosses into the run home when passing own entry', () => {
    // Two cells short of the turning; a 5 carries it three cells in.
    expect(calc(beforeEntry('red', 2), 5, 'red')).toBe('final-3');
  });

  it('stops on own entry cell without entering the run home', () => {
    expect(calc(beforeEntry('red', 2), 2, 'red')).toBe(atEntry('red'));
  });

  it('non-owner passes over another color entry cell', () => {
    // Yellow steps over red's turning without being offered it.
    const from = beforeEntry('red', 1);
    const landing = cellBefore(ENTRY_CELLS.red, -2); // two cells past red's entry
    expect(calc(from, 3, 'yellow')).toBe(`track-${landing}`);
  });

  // --- Walking into the run home ---
  //
  // These replace an exact-landing rule that shipped briefly and deadlocked:
  // five counters needing five distinct cells left the tail of a game with no
  // legal move on most turns. The point of each test below is that a counter
  // off the yard is never stranded.

  it('caps an overshoot at the last cell rather than refusing it', () => {
    expect(calc('final-4', 6, 'red')).toBe(`final-${FINAL_SIZE}`);
    expect(calc(atEntry('red'), 6, 'red')).toBe(`final-${FINAL_SIZE}`);
  });

  it('lets counters of the same colour share a run-home cell', () => {
    const t = tokensWith({ 0: 'final-3', 1: atEntry('red') });
    expect(calculateNewPosition(t[1], 3, 'red')).toBe('final-3');
  });

  it('always has somewhere to go from anywhere in the run home', () => {
    for (let cell = 1; cell < FINAL_SIZE; cell++) {
      for (let roll = 1; roll <= 6; roll++) {
        expect(calc(`final-${cell}`, roll, 'red')).not.toBeNull();
      }
    }
  });
});

describe('getValidMoves', () => {
  it('no moves from base without a 6', () => {
    expect(getValidMoves(BASE_TOKENS, 'red', 5)).toEqual([]);
  });

  it('deploys all base tokens on a 6', () => {
    const moves = getValidMoves(BASE_TOKENS, 'red', 6);
    expect(moves).toHaveLength(TOKENS_PER_PLAYER);
    expect(moves.every(m => m.newPosition === 'track-1')).toBe(true);
  });

  it('deploys green to track-15 and yellow to track-29', () => {
    expect(getValidMoves(BASE_TOKENS, 'green', 6)[0].newPosition).toBe('track-15');
    expect(getValidMoves(BASE_TOKENS, 'yellow', 6)[0].newPosition).toBe('track-29');
  });

  it('skips counters that are already home and cannot go further', () => {
    const t = tokensWith({ 0: 'final-5', 1: 'track-5' });
    const moves = getValidMoves(t, 'red', 3);
    expect(moves).toEqual([{ tokenIndex: 1, newPosition: 'track-8' }]);
  });

  it('excludes run-home overshoots', () => {
    const t = tokensWith({ 5: 'final-5' });
    expect(getValidMoves(t, 'green', 3)).toEqual([]);
  });

  it('lets the last counter in even when its cell is already occupied', () => {
    // Red's last counter waits on its entry cell and a 3 takes it to final-3,
    // where one of its own is already standing. Under the exact-landing rule
    // this was no move at all, and the player sat there rolling.
    const t = tokensWith({
      0: 'final-3', 1: 'final-4', 2: 'final-5', 3: atEntry('red'), 4: 'base',
    });
    expect(getValidMoves(t, 'red', 3)).toContainEqual({ tokenIndex: 3, newPosition: 'final-3' });
    expect(getValidMoves(t, 'red', 2)).toContainEqual({ tokenIndex: 3, newPosition: 'final-2' });
  });

  it('only returns moves for the given color', () => {
    const t = tokensWith({ 0: 'track-3', 5: 'track-16', 10: 'track-30' });
    const moves = getValidMoves(t, 'yellow', 2);
    expect(moves).toEqual([{ tokenIndex: 10, newPosition: 'track-32' }]);
  });
});

describe('distinctMoves / getDistinctMoves', () => {
  it('collapses a whole yard deploying on a 6 into one choice', () => {
    // Five counters in the yard, one 6: five moves, but only one decision.
    expect(getValidMoves(BASE_TOKENS, 'red', 6)).toHaveLength(TOKENS_PER_PLAYER);
    expect(getDistinctMoves(BASE_TOKENS, 'red', 6)).toEqual([
      { tokenIndex: 0, newPosition: 'track-1' },
    ]);
  });

  it('keeps a deploy and a run home apart on the same 6', () => {
    // Red three cells short of its turning: a 6 carries it to final-3, and the
    // same 6 would bring a counter out of the yard. Two real decisions — the
    // four yard counters behind them are the only thing to collapse.
    const t = tokensWith({ 0: beforeEntry('red', 3) });
    expect(getValidMoves(t, 'red', 6)).toHaveLength(1 + (TOKENS_PER_PLAYER - 1));
    expect(getDistinctMoves(t, 'red', 6)).toEqual([
      { tokenIndex: 0, newPosition: 'final-3' },
      { tokenIndex: 1, newPosition: `track-${START_POSITIONS.red}` },
    ]);
  });

  it('never collapses counters standing on different cells', () => {
    // Keying on origin *and* destination is what makes the collapse provably
    // safe. It is also belt and braces: with a single die two counters on
    // different cells can never reach the same one, so every duplicate a real
    // game produces is a same-origin duplicate. Sweep the ring and confirm.
    for (let cell = 1; cell <= TRACK_SIZE; cell++) {
      const other = (cell % TRACK_SIZE) + 1;
      const t = tokensWith({ 0: `track-${cell}` as TokenPosition, 1: `track-${other}` as TokenPosition });
      for (let roll = 1; roll <= 6; roll++) {
        const raw = getValidMoves(t, 'red', roll).filter(m => m.tokenIndex === 0 || m.tokenIndex === 1);
        const collapsed = distinctMoves(t, raw);
        expect(collapsed).toHaveLength(raw.length);
      }
    }
  });

  it('leaves genuinely different moves alone', () => {
    const t = tokensWith({ 0: 'track-3', 1: 'track-9' });
    expect(getDistinctMoves(t, 'red', 2)).toEqual([
      { tokenIndex: 0, newPosition: 'track-5' },
      { tokenIndex: 1, newPosition: 'track-11' },
    ]);
  });

  it('collapses two counters stacked on one cell', () => {
    const t = tokensWith({ 0: 'track-7', 1: 'track-7' });
    expect(getDistinctMoves(t, 'red', 3)).toEqual([
      { tokenIndex: 0, newPosition: 'track-10' },
    ]);
  });

  it('preserves the first index of each equivalence class', () => {
    const t = tokensWith({ 0: 'track-5', 1: 'base', 2: 'base' });
    const collapsed = distinctMoves(t, getValidMoves(t, 'red', 6));
    expect(collapsed.map(m => m.tokenIndex)).toEqual([0, 1]);
  });

  it('returns nothing when there is nothing to do', () => {
    expect(getDistinctMoves(BASE_TOKENS, 'red', 3)).toEqual([]);
  });
});

describe('a turn is never stuck with counters on the board', () => {
  // The regression that took the live game down: with the exact-landing rule a
  // player could hold counters on the ring and still have no legal move on any
  // roll, turn after turn. It looked like the dice had stopped working.

  it('offers a move on every roll while anything is off the yard', () => {
    const boards: TokenPosition[][] = [
      tokensWith({ 0: 'final-3', 1: 'final-4', 2: 'final-5', 3: atEntry('red'), 4: 'base' }),
      tokensWith({ 0: 'final-1', 4: atEntry('red') }),
      tokensWith({ 0: 'final-2', 1: 'final-3', 2: 'final-4', 3: 'final-5', 4: 'track-3' }),
      tokensWith({ 0: 'track-3' }),
    ];
    for (const t of boards) {
      for (let roll = 1; roll <= 6; roll++) {
        expect(getValidMoves(t, 'red', roll).length).toBeGreaterThan(0);
      }
    }
  });

  it('only runs dry when every counter is in the yard or already home', () => {
    // Four home on the last cell and one still in the yard: nothing to move
    // without a 6, which is ordinary Ludo rather than a deadlock.
    const t = tokensWith({
      0: 'final-5', 1: 'final-5', 2: 'final-5', 3: 'final-5', 4: 'base',
    });
    for (let roll = 1; roll <= 5; roll++) {
      expect(getValidMoves(t, 'red', roll)).toEqual([]);
    }
    expect(getValidMoves(t, 'red', 6)).toHaveLength(1);
  });

  it('does not offer a counter on the last cell a move to where it stands', () => {
    const t = tokensWith({ 0: 'final-5', 1: 'track-3' });
    const moves = getValidMoves(t, 'red', 4);
    expect(moves.every(m => m.tokenIndex !== 0)).toBe(true);
  });
});

describe('MAX_PLAYER_SCORE', () => {
  it('is exactly what a filled run home scores', () => {
    const t = [...BASE_TOKENS];
    for (let f = 1; f <= FINAL_SIZE; f++) t[f - 1] = `final-${f}` as TokenPosition;
    expect(getPlayerScore(t, 'red')).toBe(MAX_PLAYER_SCORE);
    expect(checkPlayerFinished(t, 'red')).toBe(true);
  });

  it('is never exceeded from any reachable position', () => {
    // Sweep every single-counter placement; none may score above the ceiling.
    for (let t = 1; t <= TRACK_SIZE; t++) {
      expect(getPlayerScore(tokensWith({ 0: `track-${t}` }), 'red'))
        .toBeLessThanOrEqual(MAX_PLAYER_SCORE);
    }
  });
});

describe('describePosition', () => {
  it('speaks board words, not storage keys', () => {
    expect(describePosition('base')).toBe('the yard');
    expect(describePosition('track-17')).toBe('space 17');
    expect(describePosition('final-3')).toBe('home 3');
  });
});

describe('getStandings', () => {
  it('places the finisher first and the rest by how far they got', () => {
    const t = tokensWith({
      0: 'final-1', 1: 'final-2', 2: 'final-3', 3: 'final-4', 4: 'final-5',
      5: 'track-16',   // green: barely out
      10: 'track-40',  // yellow: most of a lap in
    });
    const standings = getStandings(t, 3, ['red']);
    expect(standings.map(s => s.color)).toEqual(['red', 'yellow', 'green']);
    expect(standings[0].finished).toBe(true);
    expect(standings[1].finished).toBe(false);
  });

  it('respects playerCount', () => {
    const t = tokensWith({ 0: 'track-3', 5: 'track-20' });
    expect(getStandings(t, 2, []).map(s => s.color)).toEqual(['green', 'red']);
  });

  it('breaks ties by seat order so every client agrees', () => {
    const standings = getStandings(BASE_TOKENS, 3, []);
    expect(standings.map(s => s.color)).toEqual(['red', 'green', 'yellow']);
    expect(standings.every(s => s.score === 0)).toBe(true);
  });

  it('ignores a finish order naming a seat that is not playing', () => {
    const t = tokensWith({ 0: 'track-3' });
    expect(getStandings(t, 2, ['yellow']).map(s => s.color)).toEqual(['red', 'green']);
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
    const t = tokensWith({ 0: 'track-3', 5: 'track-6' });
    const { newTokens, captured } = applyMove(t, 0, 'track-6');
    expect(captured).toBe(true);
    expect(newTokens[5]).toBe('base');
  });

  it('captures multiple opponents on the same cell', () => {
    const t = tokensWith({ 0: 'track-3', 5: 'track-6', 10: 'track-6' });
    const { newTokens, captured } = applyMove(t, 0, 'track-6');
    expect(captured).toBe(true);
    expect(newTokens[5]).toBe('base');
    expect(newTokens[10]).toBe('base');
  });

  it('does not capture own tokens', () => {
    const t = tokensWith({ 0: 'track-3', 1: 'track-6' });
    const { newTokens, captured } = applyMove(t, 0, 'track-6');
    expect(captured).toBe(false);
    expect(newTokens[1]).toBe('track-6');
  });

  it.each([...SAFE_ZONES])('does not capture on safe zone %i', cell => {
    const t = tokensWith({ 0: 'track-2', 5: `track-${cell}` });
    const { newTokens, captured } = applyMove(t, 0, `track-${cell}`);
    expect(captured).toBe(false);
    expect(newTokens[5]).toBe(`track-${cell}`);
  });

  it('reports reachedHome when a counter first takes a run-home cell', () => {
    const t = tokensWith({ 10: 'track-27' });
    const { reachedHome } = applyMove(t, 10, 'final-2');
    expect(reachedHome).toBe(true);
  });

  it('does not report reachedHome for shuffling up the run home', () => {
    const t = tokensWith({ 10: 'final-2' });
    const { reachedHome } = applyMove(t, 10, 'final-4');
    expect(reachedHome).toBe(false);
  });

  it('no capture inside the run home', () => {
    // Run-home cells are per-color namespaced; the same string must not capture
    const t = tokensWith({ 0: 'final-1', 5: 'final-3' });
    const { captured, newTokens } = applyMove(t, 0, 'final-3');
    expect(captured).toBe(false);
    expect(newTokens[5]).toBe('final-3');
  });
});

describe('checkPlayerFinished / getFinishedColors', () => {
  it('detects a player whose run home is full', () => {
    const t = tokensWith({
      0: 'final-1', 1: 'final-2', 2: 'final-3', 3: 'final-4', 4: 'final-5',
    });
    expect(checkPlayerFinished(t, 'red')).toBe(true);
    expect(checkPlayerFinished(t, 'green')).toBe(false);
  });

  it('not finished with one cell of the run home still empty', () => {
    const t = tokensWith({
      0: 'final-1', 1: 'final-2', 2: 'final-3', 3: 'final-4', 4: beforeEntry('red', 1),
    });
    expect(checkPlayerFinished(t, 'red')).toBe(false);
  });

  it('getFinishedColors respects playerCount', () => {
    const t = tokensWith({
      10: 'final-1', 11: 'final-2', 12: 'final-3', 13: 'final-4', 14: 'final-5',
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
    const t = tokensWith({ 5: 'track-16', 10: 'track-20' });
    const capture = scoreBotMove(5, 'track-20', t, 'green', 3);
    const advance = scoreBotMove(5, 'track-19', t, 'green', 3);
    expect(capture).toBeGreaterThan(advance);
  });

  it('does not score a capture on a safe zone', () => {
    const t = tokensWith({ 5: 'track-19', 10: 'track-21' });
    const ontoSafe = scoreBotMove(5, 'track-21', t, 'green', 3);
    // Safe-zone landing gets +15 but no capture bonus (>100)
    expect(ontoSafe).toBeLessThan(100);
  });

  it('values taking a run-home cell over track movement', () => {
    const t = tokensWith({ 0: atEntry('red') });
    const runHome = scoreBotMove(0, 'final-3', t, 'red', 3);
    const track = tokensWith({ 0: 'track-30' });
    const advance = scoreBotMove(0, 'track-33', track, 'red', 3);
    expect(runHome).toBeGreaterThan(advance);
  });

  it('takes the deeper free cell first — the shallow ones stay reachable', () => {
    const t = tokensWith({ 0: atEntry('red') });
    expect(scoreBotMove(0, 'final-5', t, 'red', 3))
      .toBeGreaterThan(scoreBotMove(0, 'final-2', t, 'red', 3));
  });

  it('first deploy scores higher than later deploys', () => {
    const noneOut = scoreBotMove(0, 'track-1', BASE_TOKENS, 'red', 3);
    const oneOut = tokensWith({ 1: 'track-10' });
    const second = scoreBotMove(0, 'track-1', oneOut, 'red', 3);
    expect(noneOut).toBeGreaterThan(second);
  });

  it('penalizes landing within reach of an opponent', () => {
    // Green token would land on 20 with red on 18 (2 behind, can capture)
    const threatened = tokensWith({ 5: 'track-17', 0: 'track-18' });
    const clear = tokensWith({ 5: 'track-17' });
    const risky = scoreBotMove(5, 'track-20', threatened, 'green', 3);
    const safe = scoreBotMove(5, 'track-20', clear, 'green', 3);
    expect(risky).toBeLessThan(safe);
  });
});

describe('getPlayerScore', () => {
  it('scores base as 0 and the deepest run-home cell as track+5', () => {
    expect(getPlayerScore(BASE_TOKENS, 'red')).toBe(0);
    const t = tokensWith({ 0: 'final-5' });
    expect(getPlayerScore(t, 'red')).toBe(TRACK_SIZE + FINAL_SIZE);
  });

  it('scores track distance from own start', () => {
    // Yellow start=29; track-31 → distance 2
    const t = tokensWith({ 10: 'track-31' });
    expect(getPlayerScore(t, 'yellow')).toBe(2);
  });

  it('wraps distance across the seam', () => {
    // Yellow start=29; track-2 → (42-29)+2 = 15
    const t = tokensWith({ 10: 'track-2' });
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
