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
} from '../snakesLogic';

describe('cellToGrid', () => {
  it('cell 1 is bottom-left', () => {
    expect(cellToGrid(1)).toEqual([9, 0]);
  });

  it('cell 10 is bottom-right', () => {
    expect(cellToGrid(10)).toEqual([9, 9]);
  });

  it('cell 11 is second row right (serpentine)', () => {
    expect(cellToGrid(11)).toEqual([8, 9]);
  });

  it('cell 20 is second row left', () => {
    expect(cellToGrid(20)).toEqual([8, 0]);
  });

  it('cell 21 is third row left', () => {
    expect(cellToGrid(21)).toEqual([7, 0]);
  });

  it('cell 100 is top-left', () => {
    expect(cellToGrid(100)).toEqual([0, 0]);
  });

  it('cell 91 is top-right (serpentine)', () => {
    expect(cellToGrid(91)).toEqual([0, 9]);
  });

  it('cell 50 is fifth row right (L→R row ends at right)', () => {
    expect(cellToGrid(50)).toEqual([5, 9]);
  });
});

describe('resolveMove', () => {
  it('moves forward normally', () => {
    expect(resolveMove(5, 3)).toEqual({ newPos: 8, landed: null, finalPos: 8 });
  });

  it('enters from off-board', () => {
    expect(resolveMove(0, 4)).toEqual({ newPos: 4, landed: 'ladder', finalPos: 14 });
  });

  it('enters board and hits ladder on cell 1', () => {
    expect(resolveMove(0, 1)).toEqual({ newPos: 1, landed: 'ladder', finalPos: 38 });
  });

  it('hits a snake', () => {
    expect(resolveMove(12, 4)).toEqual({ newPos: 16, landed: 'snake', finalPos: 6 });
  });

  it('hits a ladder', () => {
    expect(resolveMove(7, 2)).toEqual({ newPos: 9, landed: 'ladder', finalPos: 31 });
  });

  it('stays put on overshoot (exact finish required)', () => {
    expect(resolveMove(98, 4)).toEqual({ newPos: 98, landed: null, finalPos: 98 });
  });

  it('wins on exact 100', () => {
    expect(resolveMove(96, 4)).toEqual({ newPos: 100, landed: null, finalPos: 100 });
  });

  it('stays at 99 with dice > 1', () => {
    expect(resolveMove(99, 2)).toEqual({ newPos: 99, landed: null, finalPos: 99 });
  });

  it('wins from 99 with dice 1', () => {
    expect(resolveMove(99, 1)).toEqual({ newPos: 100, landed: null, finalPos: 100 });
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
    expect(checkWinner([0, 100, 23, 88])).toBe(1);
  });

  it('returns first winner if somehow multiple', () => {
    expect(checkWinner([100, 100, 0])).toBe(0);
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
    expect(computeHopPath(98, 98)).toEqual([]);
  });

  it('returns just destination when entering from off-board', () => {
    expect(computeHopPath(0, 4)).toEqual([4]);
  });
});

describe('serialization', () => {
  it('round-trips positions', () => {
    const positions = [0, 5, 23, 100, 42, 7, 88];
    const serialized = serializePositions(positions);
    expect(serialized).toBe('000005023100042007088');
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
      { player: 1, dice: 4, from: 12, to: 6, mechanism: 'snake' as const },
      { player: 2, dice: 2, from: 7, to: 31, mechanism: 'ladder' as const },
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
