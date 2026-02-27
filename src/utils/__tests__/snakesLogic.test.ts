import { describe, it, expect } from 'vitest';
import {
  cellToGrid,
  resolveMove,
  getNextTurn,
  checkWinner,
  computeHopPath,
  serializePositions,
  deserializePositions,
  serializeMoveLog,
  deserializeMoveLog,
  getTokenOffset,
  SNAKES,
  LADDERS,
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_SIZE,
} from '../snakesLogic';

describe('cellToGrid (15×10 board)', () => {
  it('cell 1 is bottom-left', () => {
    expect(cellToGrid(1)).toEqual([9, 0]);
  });

  it('cell 15 is bottom-right (15 columns)', () => {
    expect(cellToGrid(15)).toEqual([9, 14]);
  });

  it('cell 16 is second row right (serpentine)', () => {
    expect(cellToGrid(16)).toEqual([8, 14]);
  });

  it('cell 30 is second row left', () => {
    expect(cellToGrid(30)).toEqual([8, 0]);
  });

  it('cell 31 is third row left', () => {
    expect(cellToGrid(31)).toEqual([7, 0]);
  });

  it('cell 150 is top-left (final cell)', () => {
    expect(cellToGrid(150)).toEqual([0, 0]);
  });

  it('cell 136 is top-right (serpentine, last row starts right)', () => {
    // Row 10 (top): cells 136-150, serpentine R→L, so cell 136 = col 14
    expect(cellToGrid(136)).toEqual([0, 14]);
  });

  it('cell 75 is fifth row right (L→R row ends at right)', () => {
    // Row 5 (0-indexed from bottom): cells 61-75, L→R
    expect(cellToGrid(75)).toEqual([5, 14]);
  });

  it('board constants are correct', () => {
    expect(BOARD_COLS).toBe(15);
    expect(BOARD_ROWS).toBe(10);
    expect(BOARD_SIZE).toBe(150);
  });
});

describe('resolveMove', () => {
  it('moves forward normally', () => {
    expect(resolveMove(3, 3)).toEqual({ newPos: 6, landed: null, finalPos: 6 });
  });

  it('enters from off-board and hits ladder on cell 2', () => {
    expect(resolveMove(0, 2)).toEqual({ newPos: 2, landed: 'ladder', finalPos: 26 });
  });

  it('hits a snake', () => {
    expect(resolveMove(10, 4)).toEqual({ newPos: 14, landed: 'snake', finalPos: 3 });
  });

  it('hits a ladder', () => {
    expect(resolveMove(6, 2)).toEqual({ newPos: 8, landed: 'ladder', finalPos: 34 });
  });

  it('stays put on overshoot (exact finish required)', () => {
    expect(resolveMove(147, 4)).toEqual({ newPos: 147, landed: null, finalPos: 147 });
  });

  it('overshoot past 150 stays put', () => {
    expect(resolveMove(149, 3)).toEqual({ newPos: 149, landed: null, finalPos: 149 });
  });

  it('wins on exact 150', () => {
    expect(resolveMove(146, 4)).toEqual({ newPos: 150, landed: null, finalPos: 150 });
  });

  it('stays at 149 with dice > 1', () => {
    expect(resolveMove(149, 2)).toEqual({ newPos: 149, landed: null, finalPos: 149 });
  });

  it('wins from 149 with dice 1', () => {
    expect(resolveMove(149, 1)).toEqual({ newPos: 150, landed: null, finalPos: 150 });
  });

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

  it('no snake head is also a ladder bottom', () => {
    for (const head of Object.keys(SNAKES)) {
      expect(LADDERS[Number(head)]).toBeUndefined();
    }
  });

  it('all snake/ladder positions are within board bounds', () => {
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
});

describe('getNextTurn', () => {
  it('stays on 6 (extra turn)', () => {
    expect(getNextTurn(0, 6, 4, 0)).toEqual({ nextTurn: 0, nextSixes: 1 });
  });

  it('advances on non-6', () => {
    expect(getNextTurn(0, 3, 4, 0)).toEqual({ nextTurn: 1, nextSixes: 0 });
  });

  it('wraps around', () => {
    expect(getNextTurn(3, 2, 4, 0)).toEqual({ nextTurn: 0, nextSixes: 0 });
  });

  it('loses turn on three consecutive 6s', () => {
    expect(getNextTurn(2, 6, 4, 2)).toEqual({ nextTurn: 3, nextSixes: 0 });
  });

  it('second consecutive 6 still gives extra turn', () => {
    expect(getNextTurn(1, 6, 3, 1)).toEqual({ nextTurn: 1, nextSixes: 2 });
  });

  it('wraps with 7 players', () => {
    expect(getNextTurn(6, 4, 7, 0)).toEqual({ nextTurn: 0, nextSixes: 0 });
  });
});

describe('checkWinner', () => {
  it('returns null when no winner', () => {
    expect(checkWinner([0, 5, 23, 88])).toBeNull();
  });

  it('returns winner index', () => {
    expect(checkWinner([0, 150, 23, 88])).toBe(1);
  });

  it('returns first winner if somehow multiple', () => {
    expect(checkWinner([150, 150, 0])).toBe(0);
  });
});

describe('computeHopPath', () => {
  it('returns intermediate cells', () => {
    expect(computeHopPath(5, 8)).toEqual([6, 7, 8]);
  });

  it('returns single cell for 1 step', () => {
    expect(computeHopPath(10, 11)).toEqual([11]);
  });

  it('returns empty for no movement', () => {
    expect(computeHopPath(148, 148)).toEqual([]);
  });

  it('returns just destination when entering from off-board', () => {
    expect(computeHopPath(0, 4)).toEqual([4]);
  });
});

describe('serialization', () => {
  it('round-trips positions', () => {
    const positions = [0, 5, 23, 150, 42, 7, 88];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('000005023150042007088');
    expect(deserializePositions(serialized, 7)).toEqual(positions);
  });

  it('handles 2 players', () => {
    const positions = [50, 75];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('050075');
    expect(deserializePositions(serialized, 2)).toEqual(positions);
  });
});

describe('moveLog serialization', () => {
  it('round-trips entries', () => {
    const entries = [
      { player: 0, dice: 3, from: 5, to: 8, mechanism: null as null },
      { player: 1, dice: 4, from: 10, to: 3, mechanism: 'snake' as const },
      { player: 2, dice: 2, from: 6, to: 34, mechanism: 'ladder' as const },
    ];
    const serialized = serializeMoveLog(entries);
    const deserialized = deserializeMoveLog(serialized);
    expect(deserialized).toEqual(entries);
  });

  it('handles empty string', () => {
    expect(deserializeMoveLog('')).toEqual([]);
  });
});

describe('getTokenOffset', () => {
  it('returns [0,0] for unique position', () => {
    expect(getTokenOffset([5, 10, 20], 0)).toEqual([0, 0]);
  });

  it('returns offsets when tokens share a cell', () => {
    const offset0 = getTokenOffset([5, 5, 20], 0);
    const offset1 = getTokenOffset([5, 5, 20], 1);
    expect(offset0).not.toEqual([0, 0]);
    expect(offset1).not.toEqual([0, 0]);
    expect(offset0).not.toEqual(offset1);
  });

  it('returns [0,0] for off-board', () => {
    expect(getTokenOffset([0, 5, 10], 0)).toEqual([0, 0]);
  });
});
