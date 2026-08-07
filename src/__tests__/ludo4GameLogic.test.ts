import { describe, it, expect } from 'vitest';
import {
  calculateNewPosition,
  getValidMoves,
  distinctMoves,
  getDistinctMoves,
  helpfulRolls,
  describeNoMove,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  findNextActivePlayer,
  getNextTurn,
  scoreBotMove,
  allInYard,
  YARD_MISS_LIMIT,
} from '../ludo4GameLogic';
import {
  SAFE_ZONES,
  TRACK_SIZE,
  TOTAL_TOKENS,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  START_POSITIONS,
  ENTRY_CELLS,
  MAX_PLAYER_SCORE,
  PLAYER_COLORS,
  getPlayerScore,
  getStandings,
  describePosition,
  getOccupiedFinals,
  deserializeLudo4Tokens,
  initRollStats,
  deserializeRollStats,
  recordRoll,
  recordCapture,
  serializeRollStats,
  mergeRollStats,
  parseYardMisses,
  serializeYardMisses,
  INITIAL_TOKENS,
} from '../ludo4Board';
import { deserializeTokens, serializeTokens } from '../ludoFirebase';
import type { TokenPosition } from '../ludoFirebase';

// Board: 56-cell track, 4 arms × 14. Starts at 1, 15, 29, 43; each colour turns
// off for its run home on the cell before its own start.
// Safe zones: 1, 7, 15, 21, 29, 35, 43, 49
// Token indices: red 0-4, green 5-9, yellow 10-14, blue 15-19
// Run home: five cells per colour, one counter each, landed on exactly.
//
// Cell numbers are derived from START_POSITIONS/ENTRY_CELLS rather than written
// in — where the entry sits relative to the start is a live design decision
// (see the Ludo3 suite this is forked from).

const BASE_TOKENS: TokenPosition[] = Array(TOTAL_TOKENS).fill('base');

function tokensWith(overrides: Record<number, TokenPosition>): TokenPosition[] {
  const t = [...BASE_TOKENS];
  for (const [idx, pos] of Object.entries(overrides)) t[Number(idx)] = pos;
  return t;
}

type Seat = 'red' | 'green' | 'yellow' | 'blue';

/** calculateNewPosition against an otherwise-empty board. */
function calc(from: TokenPosition, steps: number, color: Seat) {
  return calculateNewPosition(from, steps, color, BASE_TOKENS);
}

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
    for (const color of PLAYER_COLORS) {
      expect(ENTRY_CELLS[color]).toBe(cellBefore(START_POSITIONS[color], 1));
    }
  });

  it('gives every colour the same distance to run', () => {
    for (const color of PLAYER_COLORS) {
      const start = START_POSITIONS[color];
      const entry = ENTRY_CELLS[color];
      const lap = entry >= start ? entry - start : TRACK_SIZE - start + entry;
      expect(lap).toBe(TRACK_SIZE - 1);
    }
  });

  it('safe zones are all starts plus start+6', () => {
    expect([...SAFE_ZONES].sort((a, b) => a - b))
      .toEqual([1, 7, 15, 21, 29, 35, 43, 49]);
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
    expect(TOTAL_TOKENS).toBe(FINAL_SIZE * 4);
  });

  it('initial tokens string is 60 chars of base', () => {
    expect(INITIAL_TOKENS).toHaveLength(60);
    expect(deserializeTokens(INITIAL_TOKENS)).toEqual(BASE_TOKENS);
  });

  it('token serialization round-trips at 20 tokens', () => {
    const t = tokensWith({ 0: 'track-56', 6: 'final-3', 19: 'track-7' });
    expect(deserializeTokens(serializeTokens(t))).toEqual(t);
  });

  it('pads a short token string from an older client', () => {
    const legacy = 'bas'.repeat(12);
    const padded = deserializeLudo4Tokens(legacy);
    expect(padded).toHaveLength(TOTAL_TOKENS);
    expect(padded.every(p => p === 'base')).toBe(true);
  });

  it('reads a colour’s occupied run-home cells, ignoring other colours', () => {
    const t = tokensWith({ 0: 'final-2', 3: 'final-5', 5: 'final-1', 15: 'final-4' });
    expect(getOccupiedFinals(t, 'red')).toEqual(new Set([2, 5]));
    expect(getOccupiedFinals(t, 'green')).toEqual(new Set([1]));
    expect(getOccupiedFinals(t, 'yellow')).toEqual(new Set());
    expect(getOccupiedFinals(t, 'blue')).toEqual(new Set([4]));
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

  it('rejects overshoot past the last cell', () => {
    expect(calc('final-4', 2, 'green')).toBeNull();
  });

  it('enters the run home from the entry cell', () => {
    expect(calc(atEntry('red'), 3, 'red')).toBe('final-3');
  });

  it('reaches the deepest cell from the entry cell with an exact 5', () => {
    expect(calc(atEntry('red'), FINAL_SIZE, 'red')).toBe(`final-${FINAL_SIZE}`);
  });

  it('rejects a roll that would overshoot the run home entirely', () => {
    expect(calc(atEntry('red'), FINAL_SIZE + 1, 'red')).toBeNull();
  });

  it('enters green’s run home from green’s entry', () => {
    expect(calc(atEntry('green'), 2, 'green')).toBe('final-2');
  });

  it('enters blue’s run home from blue’s entry', () => {
    expect(calc(atEntry('blue'), 1, 'blue')).toBe('final-1');
  });

  it('moves forward on track', () => {
    expect(calc('track-5', 3, 'green')).toBe('track-8');
  });

  it('wraps around track (cell 56 → cell 1)', () => {
    // Green's turning is nowhere near the seam, so this is a plain wrap.
    expect(calc('track-56', 1, 'green')).toBe('track-1');
  });

  it('wraps around track across the seam', () => {
    expect(calc('track-54', 4, 'green')).toBe('track-2');
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

  // --- The exact-landing rule ---

  it('refuses a cell of the run home that is already taken', () => {
    const entry = atEntry('red');
    const t = tokensWith({ 0: 'final-3', 1: entry });
    expect(calculateNewPosition(entry, 3, 'red', t)).toBeNull();
    expect(calculateNewPosition(entry, 2, 'red', t)).toBe('final-2');
  });

  it('refuses a taken cell when shuffling up the run home', () => {
    const t = tokensWith({ 0: 'final-2', 1: 'final-4' });
    expect(calculateNewPosition('final-2', 2, 'red', t)).toBeNull();
    expect(calculateNewPosition('final-2', 1, 'red', t)).toBe('final-3');
  });

  it('passes over taken cells to land on a free one beyond them', () => {
    const t = tokensWith({ 0: 'final-1', 1: 'final-2', 2: 'final-3' });
    expect(calculateNewPosition('final-1', 3, 'red', t)).toBe('final-4');
  });

  it('is blocked only by its own colour', () => {
    // Red holds its own final-2; blue's final-2 is a different cell entirely.
    const blueEntry = atEntry('blue');
    const t = tokensWith({ 0: 'final-2', 15: blueEntry });
    expect(calculateNewPosition(blueEntry, 2, 'blue', t)).toBe('final-2');
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

  it('deploys green to track-15, yellow to track-29 and blue to track-43', () => {
    expect(getValidMoves(BASE_TOKENS, 'green', 6)[0].newPosition).toBe('track-15');
    expect(getValidMoves(BASE_TOKENS, 'yellow', 6)[0].newPosition).toBe('track-29');
    expect(getValidMoves(BASE_TOKENS, 'blue', 6)[0].newPosition).toBe('track-43');
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

  it('leaves a player stuck when the only space its roll reaches is taken', () => {
    // Red's last counter waits on its entry cell; a 3 would land on final-3,
    // which one of its own is standing in. No move — and it stays out on the
    // track where it can be sent back to the yard.
    const t = tokensWith({
      0: 'final-3', 1: 'final-4', 2: 'final-5', 3: atEntry('red'), 4: 'base',
    });
    expect(getValidMoves(t, 'red', 3)).toEqual([]);
    expect(getValidMoves(t, 'red', 2)).toEqual([{ tokenIndex: 3, newPosition: 'final-2' }]);
  });

  it('only returns moves for the given color', () => {
    const t = tokensWith({ 0: 'track-3', 5: 'track-16', 10: 'track-30', 15: 'track-44' });
    const moves = getValidMoves(t, 'blue', 2);
    expect(moves).toEqual([{ tokenIndex: 15, newPosition: 'track-46' }]);
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

// Under the exact-landing rule "no moves" is not one situation, so the player
// is told which face would actually help rather than a single canned line.
// One door out of the yard, by the players' own ruling. The 1-or-6 variant
// shipped briefly (9b564a0) and measured well — half the yard time, a third of
// the dead turns — but the table threw it out the same afternoon: a counter
// walking out on a 1 reads as the game miscounting. This block pins their
// decision so no future cleanup quietly reopens the second door. The drought
// the ruling leaves is answered by the warm start instead — a stated curve on
// the shut-in throw and a given 6 after YARD_MISS_LIMIT misses, applied only
// while every counter is still at home. Eligibility is guarded here; the
// curve itself is pinned to numbers in the fairness suite.
describe('leaving the yard', () => {
  it('a 6 brings a counter out, onto the start haven', () => {
    const moves = getDistinctMoves(BASE_TOKENS, 'red', 6);
    expect(moves).toHaveLength(1);
    expect(moves[0].newPosition).toBe(`track-${START_POSITIONS.red}`);
    expect(SAFE_ZONES.has(START_POSITIONS.red)).toBe(true);
  });

  it('no other face does — a 1 stays in the yard', () => {
    for (const face of [1, 2, 3, 4, 5]) {
      expect(getDistinctMoves(BASE_TOKENS, 'red', face)).toEqual([]);
    }
  });

  it('warms the die only while every counter is still at home', () => {
    expect(YARD_MISS_LIMIT).toBe(5);
    expect(allInYard(BASE_TOKENS, 'red')).toBe(true);
    // One counter anywhere out of the yard — on the ring or standing in the
    // run home — and every throw is the plain fair die.
    expect(allInYard(tokensWith({ 0: 'track-9' }), 'red')).toBe(false);
    expect(allInYard(tokensWith({ 0: 'final-2' }), 'red')).toBe(false);
    // Another colour's counters never count for red.
    expect(allInYard(tokensWith({ 5: 'track-9' }), 'red')).toBe(true);
  });

  it('round-trips the shut-in tally, reading legacy rooms as cold', () => {
    expect(parseYardMisses(undefined)).toEqual([0, 0, 0, 0]);
    expect(parseYardMisses('')).toEqual([0, 0, 0, 0]);
    expect(parseYardMisses('junk')).toEqual([0, 0, 0, 0]);
    expect(serializeYardMisses(parseYardMisses('2,0,5,1'))).toBe('2,0,5,1');
  });
});

describe('helpfulRolls / describeNoMove', () => {
  it('asks for a 6 when the whole yard is still full', () => {
    expect(helpfulRolls(BASE_TOKENS, 'red')).toEqual([6]);
    expect(describeNoMove(BASE_TOKENS, 'red')).toBe('Need a 6 to come out');
  });

  it('names only the faces that actually do something', () => {
    // Red holds run-home cells 1, 3, 4 and 5 and waits on its entry, so cell 2
    // is the only gap. A 2 walks the waiting counter in; a 1 shuffles the one on
    // cell 1 up into it. Nothing else moves, and a 6 is no use with an empty yard.
    const t = tokensWith({
      0: 'final-3', 1: 'final-4', 2: 'final-5', 3: atEntry('red'), 4: 'final-1',
    });
    expect(getValidMoves(t, 'red', 3)).toEqual([]);
    expect(helpfulRolls(t, 'red')).toEqual([1, 2]);
    expect(describeNoMove(t, 'red')).toBe('Need 1 or 2');
  });

  it('lists several faces in order when more than one helps', () => {
    const t = tokensWith({
      0: 'final-4', 1: 'final-5', 2: atEntry('red'), 3: 'base', 4: 'base',
    });
    const faces = helpfulRolls(t, 'red');
    expect(faces).toEqual([1, 2, 3, 6]);
    expect(describeNoMove(t, 'red')).toBe('Need 1, 2, 3 or 6');
  });

  it('never runs out of helpful faces once anything is off the yard', () => {
    // The anti-deadlock guarantee. A counter short of its turning can always
    // walk on down the ring; one standing *on* the turning has at most four of
    // its own counters ahead of it, so at least one cell of the five is free
    // and the roll that reaches it is legal. A player is therefore never
    // permanently stuck — only ever stuck on *this* roll.
    for (let stuck = 0; stuck < FINAL_SIZE; stuck++) {
      for (let back = 0; back <= 8; back++) {
        const t = [...BASE_TOKENS];
        // `stuck` counters parked in the deepest cells, the rest out on the ring.
        for (let f = 0; f < stuck; f++) t[f] = `final-${FINAL_SIZE - f}` as TokenPosition;
        for (let i = stuck; i < TOKENS_PER_PLAYER; i++) t[i] = beforeEntry('red', back);
        expect(helpfulRolls(t, 'red').length).toBeGreaterThan(0);
      }
    }
  });

  it('reads each colour independently', () => {
    const t = tokensWith({ 0: 'track-3' });
    expect(helpfulRolls(t, 'red')).toEqual([1, 2, 3, 4, 5, 6]);
    expect(helpfulRolls(t, 'green')).toEqual([6]);
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
      10: 'track-50',  // yellow: most of a lap in
      15: 'track-45',  // blue: two cells out
    });
    const standings = getStandings(t, 4, ['red']);
    expect(standings.map(s => s.color)).toEqual(['red', 'yellow', 'blue', 'green']);
    expect(standings[0].finished).toBe(true);
    expect(standings[1].finished).toBe(false);
  });

  it('respects playerCount', () => {
    const t = tokensWith({ 0: 'track-3', 5: 'track-20' });
    expect(getStandings(t, 2, []).map(s => s.color)).toEqual(['green', 'red']);
  });

  it('breaks ties by seat order so every client agrees', () => {
    const standings = getStandings(BASE_TOKENS, 4, []);
    expect(standings.map(s => s.color)).toEqual(['red', 'green', 'yellow', 'blue']);
    expect(standings.every(s => s.score === 0)).toBe(true);
  });

  it('ignores a finish order naming a seat that is not playing', () => {
    const t = tokensWith({ 0: 'track-3' });
    expect(getStandings(t, 2, ['blue']).map(s => s.color)).toEqual(['red', 'green']);
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
    const t = tokensWith({ 0: 'track-3', 5: 'track-6', 15: 'track-6' });
    const { newTokens, captured } = applyMove(t, 0, 'track-6');
    expect(captured).toBe(true);
    expect(newTokens[5]).toBe('base');
    expect(newTokens[15]).toBe('base');
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
      15: 'final-1', 16: 'final-2', 17: 'final-3', 18: 'final-4', 19: 'final-5',
    });
    expect(getFinishedColors(t, 4)).toEqual(new Set(['blue']));
    expect(getFinishedColors(t, 3)).toEqual(new Set());
  });
});

describe('findNextActivePlayer', () => {
  it('rotates red → green → yellow → blue → red with 4 players', () => {
    expect(findNextActivePlayer('red', 4, new Set())).toBe('green');
    expect(findNextActivePlayer('green', 4, new Set())).toBe('yellow');
    expect(findNextActivePlayer('yellow', 4, new Set())).toBe('blue');
    expect(findNextActivePlayer('blue', 4, new Set())).toBe('red');
  });

  it('rotates red → green → red with 2 players', () => {
    expect(findNextActivePlayer('red', 2, new Set())).toBe('green');
    expect(findNextActivePlayer('green', 2, new Set())).toBe('red');
  });

  it('skips finished players', () => {
    expect(findNextActivePlayer('red', 4, new Set(['green']))).toBe('yellow');
    expect(findNextActivePlayer('green', 4, new Set(['yellow', 'blue']))).toBe('red');
  });
});

describe('getNextTurn', () => {
  const none = new Set<never>() as Set<Seat>;

  it('advances on a normal roll', () => {
    expect(getNextTurn('red', 3, 0, false, false, 4, none))
      .toEqual({ nextColor: 'green', nextSixes: 0 });
  });

  it('bonus turn on a 6', () => {
    expect(getNextTurn('red', 6, 0, false, false, 4, none))
      .toEqual({ nextColor: 'red', nextSixes: 1 });
  });

  it('third consecutive 6 forfeits the bonus', () => {
    expect(getNextTurn('red', 6, 2, false, false, 4, none))
      .toEqual({ nextColor: 'green', nextSixes: 0 });
  });

  it('bonus turn on capture', () => {
    expect(getNextTurn('green', 4, 0, true, false, 4, none))
      .toEqual({ nextColor: 'green', nextSixes: 0 });
  });

  it('bonus turn on reaching home', () => {
    expect(getNextTurn('blue', 2, 0, false, true, 4, none))
      .toEqual({ nextColor: 'blue', nextSixes: 0 });
  });

  it('always advances when the player just finished', () => {
    expect(getNextTurn('red', 6, 0, false, true, 4, new Set(['red']) as Set<Seat>))
      .toEqual({ nextColor: 'green', nextSixes: 0 });
  });
});

describe('scoreBotMove', () => {
  it('prefers capturing over plain advancement', () => {
    const t = tokensWith({ 5: 'track-16', 10: 'track-20' });
    const capture = scoreBotMove(5, 'track-20', t, 'green', 4);
    const advance = scoreBotMove(5, 'track-19', t, 'green', 4);
    expect(capture).toBeGreaterThan(advance);
  });

  it('does not score a capture on a safe zone', () => {
    const t = tokensWith({ 5: 'track-19', 10: 'track-21' });
    const ontoSafe = scoreBotMove(5, 'track-21', t, 'green', 4);
    // Safe-zone landing gets +15 but no capture bonus (>100)
    expect(ontoSafe).toBeLessThan(100);
  });

  it('values taking a run-home cell over track movement', () => {
    const t = tokensWith({ 0: atEntry('red') });
    const runHome = scoreBotMove(0, 'final-3', t, 'red', 4);
    const track = tokensWith({ 0: 'track-30' });
    const advance = scoreBotMove(0, 'track-33', track, 'red', 4);
    expect(runHome).toBeGreaterThan(advance);
  });

  it('takes the deeper free cell first — the shallow ones stay reachable', () => {
    const t = tokensWith({ 0: atEntry('red') });
    expect(scoreBotMove(0, 'final-5', t, 'red', 4))
      .toBeGreaterThan(scoreBotMove(0, 'final-2', t, 'red', 4));
  });

  it('first deploy scores higher than later deploys', () => {
    const noneOut = scoreBotMove(0, 'track-1', BASE_TOKENS, 'red', 4);
    const oneOut = tokensWith({ 1: 'track-10' });
    const second = scoreBotMove(0, 'track-1', oneOut, 'red', 4);
    expect(noneOut).toBeGreaterThan(second);
  });

  it('penalizes landing within reach of an opponent', () => {
    // Green token would land on 20 with red on 18 (2 behind, can capture)
    const threatened = tokensWith({ 5: 'track-17', 0: 'track-18' });
    const clear = tokensWith({ 5: 'track-17' });
    const risky = scoreBotMove(5, 'track-20', threatened, 'green', 4);
    const safe = scoreBotMove(5, 'track-20', clear, 'green', 4);
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
    // Blue start=43; track-45 → distance 2
    const t = tokensWith({ 15: 'track-45' });
    expect(getPlayerScore(t, 'blue')).toBe(2);
  });

  it('wraps distance across the seam', () => {
    // Blue start=43; track-2 → (56-43)+2 = 15
    const t = tokensWith({ 15: 'track-2' });
    expect(getPlayerScore(t, 'blue')).toBe(15);
  });
});

describe('rollStats (4 colors)', () => {
  it('init has 4 empty groups', () => {
    const stats = deserializeRollStats(initRollStats());
    expect(stats).toHaveLength(4);
    expect(stats.every(s => s.rolls.every(r => r === 0) && s.captures === 0)).toBe(true);
  });

  it('records rolls and captures, round-trips', () => {
    let stats = deserializeRollStats(initRollStats());
    stats = recordRoll(stats, 1, 6);
    stats = recordCapture(stats, 3);
    const rt = deserializeRollStats(serializeRollStats(stats));
    expect(rt[1].rolls[5]).toBe(1);
    expect(rt[3].captures).toBe(1);
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
    expect(deserializeRollStats('')).toHaveLength(4);
    expect(deserializeRollStats('1,0,0,0,0,0,2')).toHaveLength(4);
  });
});
