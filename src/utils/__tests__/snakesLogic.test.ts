import { describe, it, expect } from 'vitest';
import {
  cellToGrid,
  gridToPercent,
  cellToPercent,
  resolveMove,
  getNextTurn,
  checkWinner,
  computeHopPath,
  serializePositions,
  deserializePositions,
  serializeMoveLog,
  deserializeMoveLog,
  computeGameStats,
  getTokenOffset,
  SNAKES,
  LADDERS,
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_SIZE,
} from '../snakesLogic';
import type { MoveLogEntry } from '../snakesLogic';

// ---------------------------------------------------------------------------
// 1. cellToGrid — serpentine mapping for a 15×10 board
// ---------------------------------------------------------------------------
describe('cellToGrid (15×10 board)', () => {
  it('board constants are correct', () => {
    expect(BOARD_COLS).toBe(15);
    expect(BOARD_ROWS).toBe(10);
    expect(BOARD_SIZE).toBe(150);
  });

  // Row 1 (bottom): cells 1-15, left-to-right → gridRow 9
  it('cell 1 is bottom-left corner [9, 0]', () => {
    expect(cellToGrid(1)).toEqual([9, 0]);
  });

  it('cell 8 is bottom row middle [9, 7]', () => {
    expect(cellToGrid(8)).toEqual([9, 7]);
  });

  it('cell 15 is bottom-right corner [9, 14]', () => {
    expect(cellToGrid(15)).toEqual([9, 14]);
  });

  // Row 2: cells 16-30, right-to-left (serpentine reversal) → gridRow 8
  it('cell 16 is second row right (serpentine) [8, 14]', () => {
    expect(cellToGrid(16)).toEqual([8, 14]);
  });

  it('cell 23 is second row middle [8, 7]', () => {
    expect(cellToGrid(23)).toEqual([8, 7]);
  });

  it('cell 30 is second row left [8, 0]', () => {
    expect(cellToGrid(30)).toEqual([8, 0]);
  });

  // Row 3: cells 31-45, left-to-right → gridRow 7
  it('cell 31 is third row left [7, 0]', () => {
    expect(cellToGrid(31)).toEqual([7, 0]);
  });

  it('cell 45 is third row right [7, 14]', () => {
    expect(cellToGrid(45)).toEqual([7, 14]);
  });

  // Row 5 (odd from bottom, R→L): cells 61-75, L→R → gridRow 5
  it('cell 61 is fifth row left [5, 0]', () => {
    expect(cellToGrid(61)).toEqual([5, 0]);
  });

  it('cell 75 is fifth row right [5, 14]', () => {
    expect(cellToGrid(75)).toEqual([5, 14]);
  });

  // Row 10 (top): cells 136-150, R→L (serpentine) → gridRow 0
  it('cell 136 is top-right [0, 14]', () => {
    expect(cellToGrid(136)).toEqual([0, 14]);
  });

  it('cell 150 is top-left (final cell) [0, 0]', () => {
    expect(cellToGrid(150)).toEqual([0, 0]);
  });

  it('cell 143 is top row middle [0, 7]', () => {
    expect(cellToGrid(143)).toEqual([0, 7]);
  });

  // Verify the serpentine pattern: even rows (from bottom) go L→R, odd rows go R→L
  it('serpentine reversal: row 1 L→R, row 2 R→L, row 3 L→R', () => {
    // Row 1 (even from bottom = 0): L→R
    const [, col1] = cellToGrid(1);
    const [, col2] = cellToGrid(2);
    expect(col2).toBeGreaterThan(col1);

    // Row 2 (odd from bottom = 1): R→L
    const [, col16] = cellToGrid(16);
    const [, col17] = cellToGrid(17);
    expect(col17).toBeLessThan(col16);

    // Row 3 (even from bottom = 2): L→R
    const [, col31] = cellToGrid(31);
    const [, col32] = cellToGrid(32);
    expect(col32).toBeGreaterThan(col31);
  });

  // Exhaustive: every cell maps to a valid grid coordinate
  it('all 150 cells map to valid grid positions', () => {
    const seen = new Set<string>();
    for (let cell = 1; cell <= BOARD_SIZE; cell++) {
      const [row, col] = cellToGrid(cell);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(BOARD_ROWS);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(BOARD_COLS);
      const key = `${row},${col}`;
      expect(seen.has(key)).toBe(false); // no duplicates
      seen.add(key);
    }
    expect(seen.size).toBe(BOARD_SIZE);
  });
});

// ---------------------------------------------------------------------------
// gridToPercent and cellToPercent
// ---------------------------------------------------------------------------
describe('gridToPercent', () => {
  it('returns center of top-left cell [0, 0]', () => {
    const [left, top] = gridToPercent(0, 0);
    const expectedLeft = (100 / BOARD_COLS) / 2; // ~3.33%
    const expectedTop = (100 / BOARD_ROWS) / 2;  // 5%
    expect(left).toBeCloseTo(expectedLeft, 5);
    expect(top).toBeCloseTo(expectedTop, 5);
  });

  it('returns center of bottom-right cell [9, 14]', () => {
    const [left, top] = gridToPercent(9, 14);
    const colPct = 100 / BOARD_COLS;
    const rowPct = 100 / BOARD_ROWS;
    expect(left).toBeCloseTo(14 * colPct + colPct / 2, 5);
    expect(top).toBeCloseTo(9 * rowPct + rowPct / 2, 5);
  });

  it('percentages stay within 0-100 for all valid grid positions', () => {
    for (let r = 0; r < BOARD_ROWS; r++) {
      for (let c = 0; c < BOARD_COLS; c++) {
        const [left, top] = gridToPercent(r, c);
        expect(left).toBeGreaterThan(0);
        expect(left).toBeLessThan(100);
        expect(top).toBeGreaterThan(0);
        expect(top).toBeLessThan(100);
      }
    }
  });
});

describe('cellToPercent', () => {
  it('returns the same result as cellToGrid + gridToPercent', () => {
    for (const cell of [1, 15, 16, 30, 75, 136, 150]) {
      const [row, col] = cellToGrid(cell);
      const expected = gridToPercent(row, col);
      expect(cellToPercent(cell)).toEqual(expected);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. resolveMove
// ---------------------------------------------------------------------------
describe('resolveMove', () => {
  describe('normal moves', () => {
    it('moves forward by dice value', () => {
      const result = resolveMove(10, 4);
      // 10+4=14, cell 14 has no snake/ladder
      expect(result).toEqual({ newPos: 14, landed: null, finalPos: 14 });
    });

    it('moves forward from arbitrary position', () => {
      expect(resolveMove(100, 5)).toEqual({ newPos: 105, landed: null, finalPos: 105 });
    });
  });

  describe('entering from off-board (position 0)', () => {
    it('enters board at cell = diceValue', () => {
      // dice 1 → cell 1 (no snake/ladder at 1)
      expect(resolveMove(0, 1)).toEqual({ newPos: 1, landed: null, finalPos: 1 });
    });

    it('enters board and hits ladder at cell 2', () => {
      // Ladder at 2 → 31
      expect(resolveMove(0, 2)).toEqual({ newPos: 2, landed: 'ladder', finalPos: 31 });
    });

    it('enters board on a safe cell', () => {
      // dice 4 → cell 4 (no snake/ladder)
      expect(resolveMove(0, 4)).toEqual({ newPos: 4, landed: null, finalPos: 4 });
    });
  });

  describe('snake hits', () => {
    it('hits snake at 148 → 118', () => {
      expect(resolveMove(145, 3)).toEqual({ newPos: 148, landed: 'snake', finalPos: 118 });
    });

    it('hits snake at 126 → 90 (biggest drop)', () => {
      expect(resolveMove(121, 5)).toEqual({ newPos: 126, landed: 'snake', finalPos: 90 });
    });

    it('hits snake at 44 → 22', () => {
      expect(resolveMove(40, 4)).toEqual({ newPos: 44, landed: 'snake', finalPos: 22 });
    });

    it('hits snake at 86 → 69', () => {
      expect(resolveMove(83, 3)).toEqual({ newPos: 86, landed: 'snake', finalPos: 69 });
    });

    it('every defined snake is reachable and results in a snake landing', () => {
      for (const [headStr, tail] of Object.entries(SNAKES)) {
        const head = Number(headStr);
        // Approach from one cell before with dice=1
        const result = resolveMove(head - 1, 1);
        expect(result.newPos).toBe(head);
        expect(result.landed).toBe('snake');
        expect(result.finalPos).toBe(tail);
      }
    });
  });

  describe('ladder hits', () => {
    it('hits ladder at 9 → 80 (big jackpot ladder)', () => {
      expect(resolveMove(5, 4)).toEqual({ newPos: 9, landed: 'ladder', finalPos: 80 });
    });

    it('hits ladder at 26 → 67', () => {
      expect(resolveMove(22, 4)).toEqual({ newPos: 26, landed: 'ladder', finalPos: 67 });
    });

    it('hits ladder at 82 → 131', () => {
      expect(resolveMove(78, 4)).toEqual({ newPos: 82, landed: 'ladder', finalPos: 131 });
    });

    it('hits ladder at 113 → 125', () => {
      expect(resolveMove(109, 4)).toEqual({ newPos: 113, landed: 'ladder', finalPos: 125 });
    });

    it('every defined ladder is reachable and results in a ladder landing', () => {
      for (const [bottomStr, top] of Object.entries(LADDERS)) {
        const bottom = Number(bottomStr);
        const result = resolveMove(bottom - 1, 1);
        expect(result.newPos).toBe(bottom);
        expect(result.landed).toBe('ladder');
        expect(result.finalPos).toBe(top);
      }
    });
  });

  describe('overshoot (exact finish required)', () => {
    it('stays put when dice overshoots past 150', () => {
      expect(resolveMove(149, 3)).toEqual({ newPos: 149, landed: null, finalPos: 149 });
    });

    it('stays put when dice overshoots by 1', () => {
      expect(resolveMove(149, 2)).toEqual({ newPos: 149, landed: null, finalPos: 149 });
    });

    it('stays at 148 with dice 6', () => {
      expect(resolveMove(148, 6)).toEqual({ newPos: 148, landed: null, finalPos: 148 });
    });

    it('stays at 147 with dice 4', () => {
      expect(resolveMove(147, 4)).toEqual({ newPos: 147, landed: null, finalPos: 147 });
    });
  });

  describe('exact win on 150', () => {
    it('wins on exact landing at 150', () => {
      expect(resolveMove(146, 4)).toEqual({ newPos: 150, landed: null, finalPos: 150 });
    });

    it('wins from 149 with dice 1', () => {
      expect(resolveMove(149, 1)).toEqual({ newPos: 150, landed: null, finalPos: 150 });
    });

    it('wins from 144 with dice 6', () => {
      expect(resolveMove(144, 6)).toEqual({ newPos: 150, landed: null, finalPos: 150 });
    });
  });

  describe('board integrity', () => {
    it('all snakes lead downward', () => {
      for (const [head, tail] of Object.entries(SNAKES)) {
        expect(Number(tail)).toBeLessThan(Number(head));
      }
    });

    it('all ladders lead upward', () => {
      for (const [bottom, top] of Object.entries(LADDERS)) {
        expect(Number(top)).toBeGreaterThan(Number(bottom));
      }
    });

    it('no cell is both a snake head and a ladder bottom', () => {
      for (const head of Object.keys(SNAKES)) {
        expect(LADDERS[Number(head)]).toBeUndefined();
      }
    });

    it('all snake/ladder positions are within board bounds [1, 150]', () => {
      for (const [head, tail] of Object.entries(SNAKES)) {
        expect(Number(head)).toBeGreaterThanOrEqual(1);
        expect(Number(head)).toBeLessThanOrEqual(BOARD_SIZE);
        expect(Number(tail)).toBeGreaterThanOrEqual(1);
        expect(Number(tail)).toBeLessThanOrEqual(BOARD_SIZE);
      }
      for (const [bottom, top] of Object.entries(LADDERS)) {
        expect(Number(bottom)).toBeGreaterThanOrEqual(1);
        expect(Number(bottom)).toBeLessThanOrEqual(BOARD_SIZE);
        expect(Number(top)).toBeGreaterThanOrEqual(1);
        expect(Number(top)).toBeLessThanOrEqual(BOARD_SIZE);
      }
    });

    it('no snake tail or ladder top is itself a snake head or ladder bottom', () => {
      // This prevents infinite loops
      for (const tail of Object.values(SNAKES)) {
        expect(SNAKES[tail]).toBeUndefined();
        expect(LADDERS[tail]).toBeUndefined();
      }
      for (const top of Object.values(LADDERS)) {
        expect(SNAKES[top]).toBeUndefined();
        expect(LADDERS[top]).toBeUndefined();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// 3. getNextTurn — turn logic with extra turns on 6 and three-6s penalty
// ---------------------------------------------------------------------------
describe('getNextTurn', () => {
  describe('normal turn advancement', () => {
    it('advances to next player on non-6 (2 players)', () => {
      expect(getNextTurn(0, 3, 2, 0)).toEqual({ nextTurn: 1, nextSixes: 0 });
    });

    it('advances to next player on non-6 (4 players)', () => {
      expect(getNextTurn(0, 3, 4, 0)).toEqual({ nextTurn: 1, nextSixes: 0 });
    });

    it('wraps around to player 0', () => {
      expect(getNextTurn(3, 2, 4, 0)).toEqual({ nextTurn: 0, nextSixes: 0 });
    });

    it('wraps with 7 players', () => {
      expect(getNextTurn(6, 4, 7, 0)).toEqual({ nextTurn: 0, nextSixes: 0 });
    });

    it('resets consecutiveSixes on non-6', () => {
      expect(getNextTurn(0, 5, 4, 1)).toEqual({ nextTurn: 1, nextSixes: 0 });
    });
  });

  describe('extra turn on rolling 6', () => {
    it('same player gets extra turn on first 6', () => {
      expect(getNextTurn(0, 6, 4, 0)).toEqual({ nextTurn: 0, nextSixes: 1 });
    });

    it('same player gets extra turn on second consecutive 6', () => {
      expect(getNextTurn(1, 6, 3, 1)).toEqual({ nextTurn: 1, nextSixes: 2 });
    });

    it('extra turn works for any player index', () => {
      expect(getNextTurn(2, 6, 4, 0)).toEqual({ nextTurn: 2, nextSixes: 1 });
      expect(getNextTurn(3, 6, 4, 0)).toEqual({ nextTurn: 3, nextSixes: 1 });
    });
  });

  describe('three consecutive 6s penalty', () => {
    it('loses turn on third consecutive 6', () => {
      expect(getNextTurn(2, 6, 4, 2)).toEqual({ nextTurn: 3, nextSixes: 0 });
    });

    it('penalty wraps around correctly', () => {
      expect(getNextTurn(3, 6, 4, 2)).toEqual({ nextTurn: 0, nextSixes: 0 });
    });

    it('penalty resets sixes counter', () => {
      const result = getNextTurn(0, 6, 2, 2);
      expect(result.nextSixes).toBe(0);
    });

    it('penalty also triggers with consecutiveSixes > 2', () => {
      // Edge case: if somehow consecutiveSixes is 3+, still penalizes
      expect(getNextTurn(0, 6, 4, 5)).toEqual({ nextTurn: 1, nextSixes: 0 });
    });
  });
});

// ---------------------------------------------------------------------------
// 4. checkWinner
// ---------------------------------------------------------------------------
describe('checkWinner', () => {
  it('returns null when no player is at BOARD_SIZE', () => {
    expect(checkWinner([0, 5, 23, 88])).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(checkWinner([])).toBeNull();
  });

  it('returns winner index when a player reaches 150', () => {
    expect(checkWinner([0, 150, 23, 88])).toBe(1);
  });

  it('returns first winner index if multiple players at 150', () => {
    expect(checkWinner([150, 150, 0])).toBe(0);
  });

  it('detects winner at last index', () => {
    expect(checkWinner([10, 20, 30, 150])).toBe(3);
  });

  it('does not confuse 149 with 150', () => {
    expect(checkWinner([149, 149, 149])).toBeNull();
  });

  it('works for 2-player game', () => {
    expect(checkWinner([0, 150])).toBe(1);
  });

  it('works for single player', () => {
    expect(checkWinner([150])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. serializePositions / deserializePositions — round-trip
// ---------------------------------------------------------------------------
describe('serializePositions / deserializePositions', () => {
  it('round-trips a typical 4-player game', () => {
    const positions = [0, 5, 23, 150];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('000005023150');
    expect(deserializePositions(serialized, 4)).toEqual(positions);
  });

  it('round-trips 2 players', () => {
    const positions = [50, 75];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('050075');
    expect(deserializePositions(serialized, 2)).toEqual(positions);
  });

  it('round-trips 7 players', () => {
    const positions = [0, 5, 23, 150, 42, 7, 88];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('000005023150042007088');
    expect(deserializePositions(serialized, 7)).toEqual(positions);
  });

  it('handles all zeros (start of game)', () => {
    const positions = [0, 0, 0, 0];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('000000000000');
    expect(deserializePositions(serialized, 4)).toEqual(positions);
  });

  it('handles all at 150 (edge case)', () => {
    const positions = [150, 150];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('150150');
    expect(deserializePositions(serialized, 2)).toEqual(positions);
  });

  it('pads single-digit and double-digit numbers to 3 characters', () => {
    const serialized = serializePositions([1, 10, 100]);
    expect(serialized).toBe('001010100');
  });

  it('handles single player', () => {
    const positions = [42];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('042');
    expect(deserializePositions(serialized, 1)).toEqual(positions);
  });
});

// ---------------------------------------------------------------------------
// 6. serializeMoveLog / deserializeMoveLog — round-trip
// ---------------------------------------------------------------------------
describe('serializeMoveLog / deserializeMoveLog', () => {
  it('round-trips entries with all mechanism types', () => {
    const entries: MoveLogEntry[] = [
      { player: 0, dice: 3, from: 5, to: 8, mechanism: null },
      { player: 1, dice: 4, from: 84, to: 52, mechanism: 'snake' },
      { player: 2, dice: 2, from: 5, to: 48, mechanism: 'ladder' },
    ];
    const serialized = serializeMoveLog(entries);
    const deserialized = deserializeMoveLog(serialized);
    expect(deserialized).toEqual(entries);
  });

  it('round-trips a single entry with no mechanism', () => {
    const entries: MoveLogEntry[] = [
      { player: 0, dice: 5, from: 10, to: 15, mechanism: null },
    ];
    const serialized = serializeMoveLog(entries);
    expect(serialized).toBe('0:5:10>15');
    const deserialized = deserializeMoveLog(serialized);
    expect(deserialized).toEqual(entries);
  });

  it('round-trips a snake entry', () => {
    const entries: MoveLogEntry[] = [
      { player: 1, dice: 3, from: 137, to: 65, mechanism: 'snake' },
    ];
    const serialized = serializeMoveLog(entries);
    expect(serialized).toBe('1:3:137>65s');
    const deserialized = deserializeMoveLog(serialized);
    expect(deserialized).toEqual(entries);
  });

  it('round-trips a ladder entry', () => {
    const entries: MoveLogEntry[] = [
      { player: 2, dice: 1, from: 85, to: 130, mechanism: 'ladder' },
    ];
    const serialized = serializeMoveLog(entries);
    expect(serialized).toBe('2:1:85>130l');
    const deserialized = deserializeMoveLog(serialized);
    expect(deserialized).toEqual(entries);
  });

  it('handles empty string → empty array', () => {
    expect(deserializeMoveLog('')).toEqual([]);
  });

  it('round-trips empty array → empty string → empty array', () => {
    const serialized = serializeMoveLog([]);
    expect(serialized).toBe('');
    expect(deserializeMoveLog(serialized)).toEqual([]);
  });

  it('round-trips a long game log', () => {
    const entries: MoveLogEntry[] = [];
    for (let i = 0; i < 50; i++) {
      entries.push({
        player: i % 4,
        dice: (i % 6) + 1,
        from: i * 3,
        to: i * 3 + (i % 6) + 1,
        mechanism: i % 10 === 0 ? 'snake' : i % 10 === 5 ? 'ladder' : null,
      });
    }
    const serialized = serializeMoveLog(entries);
    const deserialized = deserializeMoveLog(serialized);
    expect(deserialized).toEqual(entries);
  });

  // NOTE: deserializeMoveLog has defensive parsing (try/catch, length guards,
  // and NaN checks). Malformed entries are silently skipped rather than
  // crashing or producing NaN fields. The following tests verify this behavior.

  it('silently skips completely malformed data', () => {
    // "garbage" has no colons, so parts.length < 3 → skipped
    const result = deserializeMoveLog('garbage');
    expect(result).toEqual([]);
  });

  it('silently skips entries missing ">" separator', () => {
    // "0:3:badmove" has 3 colon-parts but "badmove" has no ">" → moveParts.length < 2 → skipped
    const result = deserializeMoveLog('0:3:badmove');
    expect(result).toEqual([]);
  });

  it('silently skips entries with too few colon-separated parts', () => {
    const result = deserializeMoveLog('0:3');
    expect(result).toEqual([]);
  });

  it('silently skips entries with NaN numeric fields', () => {
    // All three parts present, ">" present, but values are not numbers
    const result = deserializeMoveLog('a:b:c>d');
    expect(result).toEqual([]);
  });

  it('keeps valid entries and skips malformed ones in a mixed log', () => {
    const serialized = '0:3:5>8,garbage,1:4:10>14';
    const result = deserializeMoveLog(serialized);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ player: 0, dice: 3, from: 5, to: 8, mechanism: null });
    expect(result[1]).toEqual({ player: 1, dice: 4, from: 10, to: 14, mechanism: null });
  });
});

// ---------------------------------------------------------------------------
// 7. computeGameStats — post-game statistics
// ---------------------------------------------------------------------------
describe('computeGameStats', () => {
  it('returns zeroed stats for empty log', () => {
    const stats = computeGameStats([], 2);
    expect(stats).toHaveLength(2);
    expect(stats[0]).toEqual({
      totalMoves: 0,
      snakesHit: 0,
      laddersClimbed: 0,
      biggestSnakeFall: 0,
      biggestLadderGain: 0,
    });
    expect(stats[1]).toEqual({
      totalMoves: 0,
      snakesHit: 0,
      laddersClimbed: 0,
      biggestSnakeFall: 0,
      biggestLadderGain: 0,
    });
  });

  it('counts total moves per player', () => {
    const log: MoveLogEntry[] = [
      { player: 0, dice: 3, from: 0, to: 3, mechanism: null },
      { player: 1, dice: 4, from: 0, to: 4, mechanism: null },
      { player: 0, dice: 2, from: 3, to: 5, mechanism: null },
    ];
    const stats = computeGameStats(log, 2);
    expect(stats[0].totalMoves).toBe(2);
    expect(stats[1].totalMoves).toBe(1);
  });

  it('counts snakes hit', () => {
    const log: MoveLogEntry[] = [
      { player: 0, dice: 5, from: 135, to: 65, mechanism: 'snake' }, // hit 140 → 65
      { player: 0, dice: 2, from: 40, to: 6, mechanism: 'snake' },  // hit 42 → 6
    ];
    const stats = computeGameStats(log, 2);
    expect(stats[0].snakesHit).toBe(2);
    expect(stats[1].snakesHit).toBe(0);
  });

  it('counts ladders climbed', () => {
    const log: MoveLogEntry[] = [
      { player: 1, dice: 3, from: 0, to: 99, mechanism: 'ladder' },  // hit 3 → 99
      { player: 1, dice: 3, from: 5, to: 48, mechanism: 'ladder' },  // hit 8 → 48
    ];
    const stats = computeGameStats(log, 2);
    expect(stats[1].laddersClimbed).toBe(2);
    expect(stats[0].laddersClimbed).toBe(0);
  });

  it('calculates biggest snake fall', () => {
    // Snake at 140 → 65: fall = 140 - 65 = 75
    // Snake at 42 → 6: fall = 42 - 6 = 36
    const log: MoveLogEntry[] = [
      { player: 0, dice: 5, from: 135, to: 65, mechanism: 'snake' }, // snakeHead = 135+5 = 140, fall = 140-65 = 75
      { player: 0, dice: 2, from: 40, to: 6, mechanism: 'snake' },   // snakeHead = 40+2 = 42, fall = 42-6 = 36
    ];
    const stats = computeGameStats(log, 1);
    expect(stats[0].biggestSnakeFall).toBe(75);
  });

  it('calculates biggest ladder gain', () => {
    // Ladder at 3 → 99: gain = 99 - 3 = 96
    // Ladder at 8 → 48: gain = 48 - 8 = 40
    const log: MoveLogEntry[] = [
      { player: 0, dice: 3, from: 0, to: 99, mechanism: 'ladder' },  // ladderBase = 3 (from 0), gain = 99-3 = 96
      { player: 0, dice: 3, from: 5, to: 48, mechanism: 'ladder' },  // ladderBase = 5+3 = 8, gain = 48-8 = 40
    ];
    const stats = computeGameStats(log, 1);
    expect(stats[0].biggestLadderGain).toBe(96);
  });

  it('calculates snake fall correctly when entering from off-board', () => {
    // Player at 0, dice 3 → lands on 3 (which is a ladder, but let's pretend mechanism is snake for test)
    // Actually testing: from=0, dice=5 → snakeHead = dice = 5 (from === 0 path)
    const log: MoveLogEntry[] = [
      { player: 0, dice: 5, from: 0, to: 2, mechanism: 'snake' }, // snakeHead = 5, fall = 5-2 = 3
    ];
    const stats = computeGameStats(log, 1);
    expect(stats[0].biggestSnakeFall).toBe(3);
  });

  it('calculates ladder gain correctly when entering from off-board', () => {
    // from=0, dice=3 → ladderBase = dice = 3, to=99, gain = 99-3 = 96
    const log: MoveLogEntry[] = [
      { player: 0, dice: 3, from: 0, to: 99, mechanism: 'ladder' },
    ];
    const stats = computeGameStats(log, 1);
    expect(stats[0].biggestLadderGain).toBe(96);
  });

  it('handles multiple players independently', () => {
    const log: MoveLogEntry[] = [
      { player: 0, dice: 3, from: 0, to: 3, mechanism: null },
      { player: 1, dice: 5, from: 135, to: 65, mechanism: 'snake' },
      { player: 0, dice: 3, from: 5, to: 48, mechanism: 'ladder' },
      { player: 1, dice: 4, from: 0, to: 4, mechanism: null },
    ];
    const stats = computeGameStats(log, 2);
    expect(stats[0].totalMoves).toBe(2);
    expect(stats[0].snakesHit).toBe(0);
    expect(stats[0].laddersClimbed).toBe(1);
    expect(stats[1].totalMoves).toBe(2);
    expect(stats[1].snakesHit).toBe(1);
    expect(stats[1].laddersClimbed).toBe(0);
  });

  it('ignores entries with out-of-range player index', () => {
    const log: MoveLogEntry[] = [
      { player: 5, dice: 3, from: 0, to: 3, mechanism: null }, // player 5 does not exist for playerCount=2
    ];
    const stats = computeGameStats(log, 2);
    expect(stats[0].totalMoves).toBe(0);
    expect(stats[1].totalMoves).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. computeHopPath
// ---------------------------------------------------------------------------
describe('computeHopPath', () => {
  it('returns intermediate cells for a normal hop', () => {
    expect(computeHopPath(5, 8)).toEqual([6, 7, 8]);
  });

  it('returns single cell for 1-step hop', () => {
    expect(computeHopPath(10, 11)).toEqual([11]);
  });

  it('returns all 6 cells for a full dice roll', () => {
    expect(computeHopPath(100, 106)).toEqual([101, 102, 103, 104, 105, 106]);
  });

  it('returns just destination when entering from off-board (cell 0)', () => {
    expect(computeHopPath(0, 4)).toEqual([4]);
  });

  it('returns just destination for dice=1 from off-board', () => {
    expect(computeHopPath(0, 1)).toEqual([1]);
  });

  it('returns just destination for dice=6 from off-board', () => {
    expect(computeHopPath(0, 6)).toEqual([6]);
  });

  it('returns empty path for no movement (overshoot stayed)', () => {
    expect(computeHopPath(148, 148)).toEqual([]);
  });

  it('returns empty path when from equals to', () => {
    expect(computeHopPath(50, 50)).toEqual([]);
  });

  // Note: the function does not handle toCell < fromCell (used for dice movement only, not snake slides)
  // Snake/ladder animations are handled separately. computeHopPath only handles forward hops.
  it('returns empty for backward movement (toCell < fromCell)', () => {
    // When toCell < fromCell and fromCell !== 0, the for-loop condition (toCell > fromCell) is false
    expect(computeHopPath(50, 30)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 9. getTokenOffset — stacking offsets when tokens share a cell
// ---------------------------------------------------------------------------
describe('getTokenOffset', () => {
  it('returns [0, 0] for a token on a unique cell', () => {
    expect(getTokenOffset([5, 10, 20], 0)).toEqual([0, 0]);
    expect(getTokenOffset([5, 10, 20], 1)).toEqual([0, 0]);
    expect(getTokenOffset([5, 10, 20], 2)).toEqual([0, 0]);
  });

  it('returns [0, 0] for off-board token (position 0)', () => {
    expect(getTokenOffset([0, 5, 10], 0)).toEqual([0, 0]);
  });

  it('returns [0, 0] even if multiple tokens are at position 0', () => {
    // Tokens at 0 are off-board; they should not get stacking offsets
    expect(getTokenOffset([0, 0, 10], 0)).toEqual([0, 0]);
    expect(getTokenOffset([0, 0, 10], 1)).toEqual([0, 0]);
  });

  it('returns non-zero offsets when two tokens share a cell', () => {
    const offset0 = getTokenOffset([5, 5, 20], 0);
    const offset1 = getTokenOffset([5, 5, 20], 1);
    expect(offset0).not.toEqual([0, 0]);
    expect(offset1).not.toEqual([0, 0]);
  });

  it('returns different offsets for different tokens on the same cell', () => {
    const offset0 = getTokenOffset([5, 5, 20], 0);
    const offset1 = getTokenOffset([5, 5, 20], 1);
    expect(offset0).not.toEqual(offset1);
  });

  it('assigns correct positional offsets from the offsets array', () => {
    const shift = 0.8;
    // Two tokens at cell 10: indices in sameCell are [0, 1]
    const offset0 = getTokenOffset([10, 10, 20], 0);
    const offset1 = getTokenOffset([10, 10, 20], 1);
    expect(offset0).toEqual([-shift, -shift]); // offsets[0]
    expect(offset1).toEqual([shift, -shift]);   // offsets[1]
  });

  it('handles three tokens on the same cell', () => {
    const shift = 0.8;
    const offset0 = getTokenOffset([10, 10, 10], 0);
    const offset1 = getTokenOffset([10, 10, 10], 1);
    const offset2 = getTokenOffset([10, 10, 10], 2);
    expect(offset0).toEqual([-shift, -shift]); // offsets[0]
    expect(offset1).toEqual([shift, -shift]);   // offsets[1]
    expect(offset2).toEqual([-shift, shift]);   // offsets[2]
  });

  it('handles four tokens on the same cell', () => {
    const shift = 0.8;
    const positions = [10, 10, 10, 10];
    expect(getTokenOffset(positions, 0)).toEqual([-shift, -shift]);
    expect(getTokenOffset(positions, 1)).toEqual([shift, -shift]);
    expect(getTokenOffset(positions, 2)).toEqual([-shift, shift]);
    expect(getTokenOffset(positions, 3)).toEqual([shift, shift]);
  });

  it('wraps offsets for more than 7 tokens on the same cell', () => {
    // There are 7 offset patterns; the 8th token should wrap to offsets[0]
    const positions = [10, 10, 10, 10, 10, 10, 10, 10]; // 8 tokens at cell 10
    const shift = 0.8;
    // Token 7 (8th token): myIdx = 7, 7 % 7 = 0 → offsets[0]
    expect(getTokenOffset(positions, 7)).toEqual([-shift, -shift]);
  });

  it('returns [0, 0] for a lone token even when others are off-board', () => {
    expect(getTokenOffset([0, 0, 5], 2)).toEqual([0, 0]);
  });

  it('does not count off-board tokens when computing offsets', () => {
    // positions[0]=0 (off-board), positions[1]=5, positions[2]=5
    // sameCell for index 1 should be [1, 2], not include 0
    const offset1 = getTokenOffset([0, 5, 5], 1);
    const offset2 = getTokenOffset([0, 5, 5], 2);
    const shift = 0.8;
    expect(offset1).toEqual([-shift, -shift]); // first in sameCell
    expect(offset2).toEqual([shift, -shift]);   // second in sameCell
  });
});
