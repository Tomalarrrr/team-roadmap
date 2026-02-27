// --- Snakes & Ladders: Pure Game Logic ---

// Board dimensions
export const BOARD_COLS = 15;
export const BOARD_ROWS = 10;
export const BOARD_SIZE = BOARD_COLS * BOARD_ROWS; // 150

// Snake/ladder map for 15×10 board.
// Spread across entire board (edges, corners, center) with mixed orientations.
// No snake crosses another snake; no ladder crosses another ladder.
export const SNAKES: Record<number, number> = {
  148: 118, // grid(0,2)→(2,2)   — top-left, vertical drop 2 rows
  142: 114, // grid(0,8)→(2,6)   — top-center, diagonal left 2 rows
  137: 103, // grid(0,13)→(3,12) — top-right corner, nearly vertical 3 rows
  126: 90,  // grid(1,5)→(4,0)   — upper-center to far-left edge, diagonal 3 rows
  101: 75,  // grid(3,10)→(5,14) — center-right to far-right edge, diagonal right 2 rows
  94: 88,   // grid(3,3)→(4,2)   — short 1-row nip, upper-left
  86: 69,   // grid(4,4)→(5,8)   — center, diagonal right 1 row
  64: 36,   // grid(5,3)→(7,5)   — mid-left, short diagonal right 2 rows
  60: 34,   // grid(6,0)→(7,3)   — left edge, diagonal right 1 row
  53: 39,   // grid(6,7)→(7,8)   — center, slight right 1 row
  44: 22,   // grid(7,13)→(8,8)  — lower-right, nearly horizontal 1 row
  17: 12,   // grid(8,13)→(9,11) — short 1-row nip, bottom-right
};

export const LADDERS: Record<number, number> = {
  2: 31,    // grid(9,1)→(7,0)   — bottom-left corner to far-left edge, vertical 2 rows
  9: 80,    // grid(9,8)→(4,10)  — BIG aggressive 5-row jackpot, bottom to mid-board
  13: 41,   // grid(9,12)→(7,10) — bottom-right, nearly vertical 2 rows
  23: 38,   // grid(8,7)→(7,7)   — short 1-row hop, vertical center
  26: 67,   // grid(8,4)→(5,6)   — lower-center, diagonal right 3 rows
  58: 92,   // grid(6,2)→(3,1)   — mid-left edge, nearly vertical 3 rows
  49: 106,  // grid(6,11)→(2,14) — mid-right to upper far-right, diagonal 4 rows
  70: 81,   // grid(5,9)→(4,9)   — short 1-row hop, vertical center-right
  82: 131,  // grid(4,8)→(1,10)  — center to upper-right, diagonal 3 rows
  85: 112,  // grid(4,5)→(2,8)   — center-left to upper-center, diagonal 2 rows
  114: 125, // grid(2,6)→(1,4)   — upper-center, short 1-row hop left
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

// Cell number (1-150) → [gridRow, gridCol] (0-indexed, row 0 = top of rendered board)
export function cellToGrid(cell: number): [number, number] {
  const zeroCell = cell - 1;
  const rowFromBottom = Math.floor(zeroCell / BOARD_COLS);
  const colInRow = zeroCell % BOARD_COLS;
  const gridRow = (BOARD_ROWS - 1) - rowFromBottom;
  const gridCol = rowFromBottom % 2 === 0 ? colInRow : (BOARD_COLS - 1) - colInRow;
  return [gridRow, gridCol];
}

// Grid position → center point as percentages of board size (for token positioning)
export function gridToPercent(gridRow: number, gridCol: number): [number, number] {
  const colPct = 100 / BOARD_COLS;
  const rowPct = 100 / BOARD_ROWS;
  const left = gridCol * colPct + colPct / 2;
  const top = gridRow * rowPct + rowPct / 2;
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

  // Exact finish: must land exactly on final cell
  if (newPos > BOARD_SIZE) {
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
  const idx = positions.findIndex(p => p === BOARD_SIZE);
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
  const entries: MoveLogEntry[] = [];
  for (const chunk of str.split(',')) {
    if (!chunk) continue;
    try {
      const mechSuffix = chunk.endsWith('s') ? 'snake' : chunk.endsWith('l') ? 'ladder' : null;
      const clean = mechSuffix ? chunk.slice(0, -1) : chunk;
      const parts = clean.split(':');
      if (parts.length < 3) continue;
      const player = parseInt(parts[0]);
      const dice = parseInt(parts[1]);
      const moveParts = parts[2].split('>');
      if (moveParts.length < 2) continue;
      const from = parseInt(moveParts[0]);
      const to = parseInt(moveParts[1]);
      if (isNaN(player) || isNaN(dice) || isNaN(from) || isNaN(to)) continue;
      entries.push({ player, dice, from, to, mechanism: mechSuffix });
    } catch {
      continue; // skip malformed entries
    }
  }
  return entries;
}

// --- Post-game stats ---

export interface PlayerStats {
  totalMoves: number;
  snakesHit: number;
  laddersClimbed: number;
  biggestSnakeFall: number;
  biggestLadderGain: number;
}

export function computeGameStats(
  log: MoveLogEntry[],
  playerCount: number,
): PlayerStats[] {
  const stats: PlayerStats[] = Array.from({ length: playerCount }, () => ({
    totalMoves: 0,
    snakesHit: 0,
    laddersClimbed: 0,
    biggestSnakeFall: 0,
    biggestLadderGain: 0,
  }));

  for (const entry of log) {
    const s = stats[entry.player];
    if (!s) continue;
    s.totalMoves++;
    if (entry.mechanism === 'snake') {
      s.snakesHit++;
      const snakeHead = entry.from === 0 ? entry.dice : entry.from + entry.dice;
      const fall = snakeHead - entry.to;
      if (fall > s.biggestSnakeFall) s.biggestSnakeFall = fall;
    }
    if (entry.mechanism === 'ladder') {
      s.laddersClimbed++;
      const ladderBase = entry.from === 0 ? entry.dice : entry.from + entry.dice;
      const gain = entry.to - ladderBase;
      if (gain > s.biggestLadderGain) s.biggestLadderGain = gain;
    }
  }

  return stats;
}

// --- MVP Awards ---

export interface MvpAward {
  playerIndex: number;
  title: string;
  detail: string;
}

export function computeMvpAwards(
  stats: PlayerStats[],
  winner: number,
  playerCount: number,
): MvpAward[] {
  const awards: MvpAward[] = [];
  if (stats.length === 0) return awards;

  // Winner award
  const winnerStat = stats[winner];
  if (winnerStat) {
    awards.push({
      playerIndex: winner,
      title: 'Champion',
      detail: `Won in ${winnerStat.totalMoves} moves`,
    });
  }

  // Most snakes survived (hit most snakes but still played well)
  let maxSnakes = 0;
  let snakeSurvivor = -1;
  for (let i = 0; i < playerCount; i++) {
    if (stats[i] && stats[i].snakesHit > maxSnakes) {
      maxSnakes = stats[i].snakesHit;
      snakeSurvivor = i;
    }
  }
  if (snakeSurvivor >= 0 && maxSnakes >= 2) {
    awards.push({
      playerIndex: snakeSurvivor,
      title: 'Snake Magnet',
      detail: `Hit ${maxSnakes} snakes`,
    });
  }

  // Luckiest roller (most ladders)
  let maxLadders = 0;
  let luckiest = -1;
  for (let i = 0; i < playerCount; i++) {
    if (stats[i] && stats[i].laddersClimbed > maxLadders) {
      maxLadders = stats[i].laddersClimbed;
      luckiest = i;
    }
  }
  if (luckiest >= 0 && maxLadders >= 2 && luckiest !== snakeSurvivor) {
    awards.push({
      playerIndex: luckiest,
      title: 'Lucky Climber',
      detail: `Climbed ${maxLadders} ladders`,
    });
  }

  // Biggest single event
  let biggestFall = 0;
  let bigFallPlayer = -1;
  let biggestGain = 0;
  let bigGainPlayer = -1;
  for (let i = 0; i < playerCount; i++) {
    if (stats[i]?.biggestSnakeFall > biggestFall) {
      biggestFall = stats[i].biggestSnakeFall;
      bigFallPlayer = i;
    }
    if (stats[i]?.biggestLadderGain > biggestGain) {
      biggestGain = stats[i].biggestLadderGain;
      bigGainPlayer = i;
    }
  }
  if (bigFallPlayer >= 0 && biggestFall >= 40) {
    awards.push({
      playerIndex: bigFallPlayer,
      title: 'Epic Fall',
      detail: `Dropped ${biggestFall} cells in one snake`,
    });
  }
  if (bigGainPlayer >= 0 && biggestGain >= 40) {
    awards.push({
      playerIndex: bigGainPlayer,
      title: 'Rocket Launch',
      detail: `Climbed ${biggestGain} cells in one ladder`,
    });
  }

  return awards;
}

// --- Snake/ladder path waypoints for animated traversal ---

// Compute grid-coordinate waypoints along a snake's sinusoidal body
export function computeSnakePath(headCell: number, tailCell: number, steps = 12): [number, number][] {
  const [hRow, hCol] = cellToGrid(headCell);
  const [tRow, tCol] = cellToGrid(tailCell);
  const dx = tCol - hCol;
  const dy = tRow - hRow;
  const len = Math.sqrt(dx * dx + dy * dy);
  const nx = -dy / len;
  const ny = dx / len;
  const waveAmp = Math.min(1.5, len * 0.05);
  const waveFreq = Math.max(3, Math.floor(len / 3));

  const waypoints: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const taper = Math.sin(t * Math.PI);
    const wave = Math.sin(t * waveFreq * Math.PI * 2) * waveAmp * taper;
    const row = hRow + dy * t + ny * wave;
    const col = hCol + dx * t + nx * wave;
    waypoints.push([row, col]);
  }
  return waypoints;
}

// Compute grid-coordinate waypoints along a ladder (rung-by-rung)
export function computeLadderPath(bottomCell: number, topCell: number, steps = 8): [number, number][] {
  const [bRow, bCol] = cellToGrid(bottomCell);
  const [tRow, tCol] = cellToGrid(topCell);
  const waypoints: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    waypoints.push([bRow + (tRow - bRow) * t, bCol + (tCol - bCol) * t]);
  }
  return waypoints;
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
  const shift = 0.8; // percentage offset (smaller for narrower cells)
  const offsets: [number, number][] = [
    [-shift, -shift], [shift, -shift], [-shift, shift], [shift, shift],
    [0, -shift], [0, shift], [-shift, 0],
  ];
  return offsets[myIdx % offsets.length];
}
