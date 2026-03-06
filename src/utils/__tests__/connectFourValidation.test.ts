import { describe, it, expect } from 'vitest';

// Re-implement validateMove locally for unit testing (it's not exported from connectFourFirebase)
function validateMove(
  oldBoard: string,
  newBoard: string,
  expectedTurn: 'red' | 'yellow'
): boolean {
  if (newBoard.length !== 48) return false;
  if (!/^[.RY]+$/.test(newBoard)) return false;

  const ROWS = 6;
  const COLS = 8;
  const piece = expectedTurn === 'red' ? 'R' : 'Y';

  let diffCount = 0;
  let diffIndex = -1;
  for (let i = 0; i < 48; i++) {
    if (oldBoard[i] !== newBoard[i]) {
      diffCount++;
      diffIndex = i;
      if (oldBoard[i] !== '.' || newBoard[i] !== piece) return false;
    }
  }
  if (diffCount !== 1) return false;

  const row = Math.floor(diffIndex / COLS);
  if (row < ROWS - 1) {
    const belowIndex = diffIndex + COLS;
    if (newBoard[belowIndex] === '.') return false;
  }

  return true;
}

describe('Connect Four validateMove', () => {
  const emptyBoard = '.'.repeat(48);

  it('accepts a valid move on the bottom row', () => {
    // Place R at position 40 (bottom-left, row 5, col 0)
    const newBoard = emptyBoard.slice(0, 40) + 'R' + emptyBoard.slice(41);
    expect(validateMove(emptyBoard, newBoard, 'red')).toBe(true);
  });

  it('rejects a move that floats (gravity violation)', () => {
    // Place R at position 0 (top-left) with nothing below
    const newBoard = 'R' + emptyBoard.slice(1);
    expect(validateMove(emptyBoard, newBoard, 'red')).toBe(false);
  });

  it('rejects placing the wrong color piece', () => {
    const newBoard = emptyBoard.slice(0, 40) + 'Y' + emptyBoard.slice(41);
    expect(validateMove(emptyBoard, newBoard, 'red')).toBe(false);
  });

  it('rejects removing a piece', () => {
    const board = emptyBoard.slice(0, 40) + 'R' + emptyBoard.slice(41);
    expect(validateMove(board, emptyBoard, 'yellow')).toBe(false);
  });

  it('rejects placing more than one piece', () => {
    const newBoard = emptyBoard.slice(0, 40) + 'RR' + emptyBoard.slice(42);
    expect(validateMove(emptyBoard, newBoard, 'red')).toBe(false);
  });

  it('rejects no change', () => {
    expect(validateMove(emptyBoard, emptyBoard, 'red')).toBe(false);
  });

  it('rejects invalid board length', () => {
    expect(validateMove(emptyBoard, '.'.repeat(47), 'red')).toBe(false);
  });

  it('rejects invalid characters', () => {
    const bad = emptyBoard.slice(0, 40) + 'X' + emptyBoard.slice(41);
    expect(validateMove(emptyBoard, bad, 'red')).toBe(false);
  });

  it('accepts a valid stacked move', () => {
    // Row 5 col 0 has R, now place Y at row 4 col 0 (index 32)
    const board = emptyBoard.slice(0, 40) + 'R' + emptyBoard.slice(41);
    const newBoard = board.slice(0, 32) + 'Y' + board.slice(33);
    expect(validateMove(board, newBoard, 'yellow')).toBe(true);
  });
});
