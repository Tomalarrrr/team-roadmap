// --- Snakes & Ladders: Pure Game Logic ---

// Classic snake/ladder map — easy to swap for any variant
export const SNAKES: Record<number, number> = {
  16: 6, 34: 1, 47: 26, 49: 11, 62: 19,
  74: 26, 82: 43, 87: 24, 93: 37, 95: 52, 97: 58, 99: 41,
};

export const LADDERS: Record<number, number> = {
  1: 38, 4: 14, 9: 31, 21: 42, 28: 84,
  36: 44, 51: 67, 71: 91, 80: 100,
};

export type PlayerColor = 'red' | 'green' | 'blue' | 'yellow' | 'purple' | 'orange' | 'teal';

export const PLAYER_COLORS: PlayerColor[] = [
  'red', 'green', 'blue', 'yellow', 'purple', 'orange', 'teal',
];

export const COLOR_HEX: Record<PlayerColor, string> = {
  red: '#ea4330',
  green: '#34a853',
  blue: '#4285f4',
  yellow: '#fbbc05',
  purple: '#9c27b0',
  orange: '#ff6d00',
  teal: '#00897b',
};

export const COLOR_LABELS: Record<PlayerColor, string> = {
  red: 'Red', green: 'Green', blue: 'Blue', yellow: 'Yellow',
  purple: 'Purple', orange: 'Orange', teal: 'Teal',
};

// --- Serpentine coordinate mapping ---

// Cell number (1-100) → [gridRow, gridCol] (0-indexed, row 0 = top of rendered board)
export function cellToGrid(cell: number): [number, number] {
  const zeroCell = cell - 1;
  const rowFromBottom = Math.floor(zeroCell / 10);
  const colInRow = zeroCell % 10;
  const gridRow = 9 - rowFromBottom;
  const gridCol = rowFromBottom % 2 === 0 ? colInRow : 9 - colInRow;
  return [gridRow, gridCol];
}

// Grid position → center point as percentages of board size (for token positioning)
export function gridToPercent(gridRow: number, gridCol: number): [number, number] {
  const cellPct = 10; // 100% / 10 cells
  const left = gridCol * cellPct + cellPct / 2;
  const top = gridRow * cellPct + cellPct / 2;
  return [left, top];
}

// Cell number → center percentages (convenience)
export function cellToPercent(cell: number): [number, number] {
  const [row, col] = cellToGrid(cell);
  return gridToPercent(row, col);
}

// --- Move resolution ---

export interface MoveResult {
  newPos: number;       // position after dice move (before snake/ladder)
  landed: 'snake' | 'ladder' | null;
  finalPos: number;     // position after snake/ladder resolution
}

export function resolveMove(currentPos: number, diceValue: number): MoveResult {
  let newPos: number;

  if (currentPos === 0) {
    // First move: enter the board at cell = diceValue
    newPos = diceValue;
  } else {
    newPos = currentPos + diceValue;
  }

  // Exact finish: must land exactly on 100
  if (newPos > 100) {
    return { newPos: currentPos, landed: null, finalPos: currentPos };
  }

  // Check snake or ladder
  if (SNAKES[newPos] !== undefined) {
    return { newPos, landed: 'snake', finalPos: SNAKES[newPos] };
  }
  if (LADDERS[newPos] !== undefined) {
    return { newPos, landed: 'ladder', finalPos: LADDERS[newPos] };
  }

  return { newPos, landed: null, finalPos: newPos };
}

// --- Turn logic ---

export function getNextTurn(
  currentTurn: number,
  diceValue: number,
  playerCount: number,
  consecutiveSixes: number,
): { nextTurn: number; nextSixes: number } {
  // Three consecutive 6s: lose turn
  if (diceValue === 6 && consecutiveSixes >= 2) {
    return {
      nextTurn: (currentTurn + 1) % playerCount,
      nextSixes: 0,
    };
  }
  // Extra turn on 6
  if (diceValue === 6) {
    return {
      nextTurn: currentTurn,
      nextSixes: consecutiveSixes + 1,
    };
  }
  return {
    nextTurn: (currentTurn + 1) % playerCount,
    nextSixes: 0,
  };
}

export function checkWinner(positions: number[]): number | null {
  const idx = positions.findIndex(p => p === 100);
  return idx >= 0 ? idx : null;
}

// --- Hop path computation ---

export function computeHopPath(fromCell: number, toCell: number): number[] {
  if (fromCell === 0) {
    // Entering the board: just the destination
    return [toCell];
  }
  const path: number[] = [];
  if (toCell > fromCell) {
    for (let c = fromCell + 1; c <= toCell; c++) path.push(c);
  }
  // If toCell === fromCell (overshoot stayed), path is empty — no animation needed
  return path;
}

// --- Serialization ---

export function serializePositions(positions: number[]): string {
  return positions.map(p => String(p).padStart(3, '0')).join('');
}

export function deserializePositions(str: string, playerCount: number): number[] {
  const positions: number[] = [];
  for (let i = 0; i < playerCount; i++) {
    positions.push(parseInt(str.substring(i * 3, i * 3 + 3)));
  }
  return positions;
}

// --- Move log ---

export interface MoveLogEntry {
  player: number;
  dice: number;
  from: number;
  to: number;
  mechanism: 'snake' | 'ladder' | null;
}

export function serializeMoveLog(entries: MoveLogEntry[]): string {
  return entries.map(e => {
    let s = `${e.player}:${e.dice}:${e.from}>${e.to}`;
    if (e.mechanism === 'snake') s += 's';
    else if (e.mechanism === 'ladder') s += 'l';
    return s;
  }).join(',');
}

export function deserializeMoveLog(str: string): MoveLogEntry[] {
  if (!str) return [];
  return str.split(',').filter(Boolean).map(chunk => {
    const mechSuffix = chunk.endsWith('s') ? 'snake' : chunk.endsWith('l') ? 'ladder' : null;
    const clean = mechSuffix ? chunk.slice(0, -1) : chunk;
    const parts = clean.split(':');
    const player = parseInt(parts[0]);
    const dice = parseInt(parts[1]);
    const moveParts = parts[2].split('>');
    const from = parseInt(moveParts[0]);
    const to = parseInt(moveParts[1]);
    return { player, dice, from, to, mechanism: mechSuffix } as MoveLogEntry;
  });
}

// --- Token stacking offsets ---

export function getTokenOffset(
  positions: number[],
  playerIndex: number,
): [number, number] {
  const myPos = positions[playerIndex];
  if (myPos <= 0) return [0, 0];

  const sameCell: number[] = [];
  for (let i = 0; i < positions.length; i++) {
    if (positions[i] === myPos && positions[i] > 0) sameCell.push(i);
  }
  if (sameCell.length <= 1) return [0, 0];

  const myIdx = sameCell.indexOf(playerIndex);
  const shift = 1.2; // percentage offset
  const offsets: [number, number][] = [
    [-shift, -shift], [shift, -shift], [-shift, shift], [shift, shift],
    [0, -shift], [0, shift], [-shift, 0],
  ];
  return offsets[myIdx % offsets.length];
}
