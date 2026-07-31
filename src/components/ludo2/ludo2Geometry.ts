// Ludo2 Y-board geometry.
//
// The board is three 3-lane arms radiating from a central hub at 120° apart
// (red points down, green up-left, yellow up-right). Cells can't live on one
// CSS grid, so every cell gets a center position in % of a square container
// plus a rotation. Everything derives from one arm-local frame:
//
//   lane ∈ {-1, 0, +1}  lateral offset (viewed from the hub looking outward)
//   row  ∈ 1..7         radial distance (1 = innermost at hub, 7 = tip)
//
// Track walk per arm segment k (cells n = 1..14 of arm k, t = 14k + n):
//   n 1..6   own arm in-lane (-1), rows 6→1 (n=1 is the start cell)
//   n 7..12  NEXT arm out-lane (+1), rows 1→6 (n=10 is the safe star)
//   n 13     next arm tip-middle (0, 7) — that color's corridor entry
//   n 14     next arm in-lane tip (-1, 7)
// The middle lane rows 6→1 is the final column (final-1..final-6); the (+1, 7)
// tip spot is deliberately vacant and hosts the start-triangle decoration.

import type { TokenPosition } from '../../ludoFirebase';
import {
  TRACK_SIZE,
  TOKENS_PER_PLAYER,
  START_POSITIONS,
  ENTRY_CELLS,
  PLAYER_COLORS,
  getTokenColor,
  type Ludo2Color,
} from '../../ludo2Board';

/** Cell size as % of the (square) board container. */
export const CELL_PCT = 5.0;
/** Radial gap from board center to the inner edge of row 1. Below ~0.8×CELL_PCT
 * the three arms' innermost cells collide at the junction — don't shrink. */
const HUB_GAP = 5.0;

export const ARM_ANGLE: Record<Ludo2Color, number> = { red: 0, green: 120, yellow: 240 };

export interface CellSpec {
  x: number;
  y: number;
  rot: number;
}

function place(color: Ludo2Color, lane: number, row: number): CellSpec {
  const a = (ARM_ANGLE[color] * Math.PI) / 180;
  const dx = lane * CELL_PCT;
  const dy = HUB_GAP + (row - 0.5) * CELL_PCT;
  return {
    x: 50 + dx * Math.cos(a) - dy * Math.sin(a),
    y: 50 + dx * Math.sin(a) + dy * Math.cos(a),
    rot: ARM_ANGLE[color],
  };
}

export function trackCellSpec(t: number): CellSpec {
  const k = Math.floor((t - 1) / 14);
  const n = ((t - 1) % 14) + 1;
  if (n <= 6) return place(PLAYER_COLORS[k], -1, 7 - n);
  const c = PLAYER_COLORS[(k + 1) % 3];
  if (n <= 12) return place(c, +1, n - 6);
  if (n === 13) return place(c, 0, 7);
  return place(c, -1, 7);
}

export function finalCellSpec(color: Ludo2Color, f: number): CellSpec {
  return place(color, 0, 7 - f); // final-6 innermost, touching the hub
}

export function baseSpotSpec(color: Ludo2Color, i: number): CellSpec {
  const a = (ARM_ANGLE[color] * Math.PI) / 180;
  const dx = (i % 2 === 0 ? -0.5 : 0.5) * CELL_PCT;
  const dy = HUB_GAP + 7.5 * CELL_PCT + (i < 2 ? -0.5 : 0.5) * CELL_PCT;
  return {
    x: 50 + dx * Math.cos(a) - dy * Math.sin(a),
    y: 50 + dx * Math.sin(a) + dy * Math.cos(a),
    rot: ARM_ANGLE[color],
  };
}

/** A point on the arm axis at radial distance `dy`, e.g. for pads/silhouettes. */
function axisPoint(color: Ludo2Color, dy: number): CellSpec {
  const a = (ARM_ANGLE[color] * Math.PI) / 180;
  return { x: 50 - dy * Math.sin(a), y: 50 + dy * Math.cos(a), rot: ARM_ANGLE[color] };
}

// --- Prebuilt lookup tables (mirror v1's TRACK_COORDS/FINAL_COORDS shape) ---

export const TRACK_XY: Record<number, [number, number]> = {};
for (let t = 1; t <= TRACK_SIZE; t++) {
  const s = trackCellSpec(t);
  TRACK_XY[t] = [s.x, s.y];
}

export const FINAL_XY: Record<Ludo2Color, [number, number][]> = {
  red: [], green: [], yellow: [],
};
for (const color of PLAYER_COLORS) {
  for (let f = 1; f <= 6; f++) {
    const s = finalCellSpec(color, f);
    FINAL_XY[color].push([s.x, s.y]);
  }
}

export const BASE_XY: Record<Ludo2Color, [number, number][]> = {
  red: [], green: [], yellow: [],
};
for (const color of PLAYER_COLORS) {
  for (let i = 0; i < TOKENS_PER_PLAYER; i++) {
    const s = baseSpotSpec(color, i);
    BASE_XY[color].push([s.x, s.y]);
  }
}

/** Colored start-triangle decoration on the vacant (+1, 7) tip spot. */
export const START_MARKER: Record<Ludo2Color, CellSpec> = {
  red: place('red', +1, 7),
  green: place('green', +1, 7),
  yellow: place('yellow', +1, 7),
};

/** Colored rounded pad behind the four base spots, just beyond the arm tip. */
export const BASE_PAD: Record<Ludo2Color, CellSpec> = {
  red: axisPoint('red', 44.5),
  green: axisPoint('green', 44.5),
  yellow: axisPoint('yellow', 44.5),
};
export const BASE_PAD_SIZE = { w: 12, h: 10 };

/** Rounded-rect silhouette behind each arm's cells. */
export const ARM_RECT: Record<Ludo2Color, CellSpec> = {
  red: axisPoint('red', 22.5),
  green: axisPoint('green', 22.5),
  yellow: axisPoint('yellow', 22.5),
};
export const ARM_RECT_SIZE = { w: 3 * CELL_PCT + 2.4, h: 38 };

/** Per-player score badges, centered in the three empty wedges. */
export const BADGE_XY: Record<Ludo2Color, [number, number]> = (() => {
  const out = {} as Record<Ludo2Color, [number, number]>;
  for (const color of PLAYER_COLORS) {
    const a = ((ARM_ANGLE[color] - 60) * Math.PI) / 180;
    out[color] = [50 - 33 * Math.sin(a), 50 + 33 * Math.cos(a)];
  }
  return out;
})();

export const HUB = { x: 50, y: 50, r: 7 };

/** Anchor for each color's pile of finished tokens, just inside the hub —
 * offset toward the color's own arm so the house icon stays visible. */
export const HOME_PILE: Record<Ludo2Color, [number, number]> = (() => {
  const out = {} as Record<Ludo2Color, [number, number]>;
  for (const color of PLAYER_COLORS) {
    const p = axisPoint(color, 4.2);
    out[color] = [p.x, p.y];
  }
  return out;
})();

/** Tiny per-token offsets so a full home pile reads as four counters. */
export const HOME_PILE_OFFSETS: [number, number][] = [
  [-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8],
];

// --- Token positioning (all coords are cell CENTERS in % of the board) ---

export function getTokenCoords(pos: TokenPosition, tokenIndex: number): [number, number] | null {
  if (pos === 'base') {
    const color = getTokenColor(tokenIndex);
    return BASE_XY[color][tokenIndex % TOKENS_PER_PLAYER];
  }
  if (pos.startsWith('track-')) {
    const trackNum = parseInt(pos.split('-')[1]);
    return TRACK_XY[trackNum] || null;
  }
  if (pos.startsWith('final-')) {
    const finalNum = parseInt(pos.split('-')[1]);
    const color = getTokenColor(tokenIndex);
    if (finalNum === 6) {
      const anchor = HOME_PILE[color];
      const off = HOME_PILE_OFFSETS[tokenIndex % TOKENS_PER_PLAYER];
      return [anchor[0] + off[0], anchor[1] + off[1]];
    }
    if (finalNum >= 1 && finalNum <= 5) return FINAL_XY[color][finalNum - 1];
  }
  return null;
}

/** Jitter co-located tokens into quadrants so stacks stay readable. */
export function getTokenOffset(tokens: TokenPosition[], tokenIndex: number): [number, number] {
  const pos = tokens[tokenIndex];
  if (pos === 'base' || pos === 'final-6') return [0, 0];

  const sameCell: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === pos) sameCell.push(i);
  }
  if (sameCell.length <= 1) return [0, 0];

  const myIdx = sameCell.indexOf(tokenIndex);
  const shift = CELL_PCT * 0.15;
  const offsets: [number, number][] = [
    [-shift, -shift],
    [shift, -shift],
    [-shift, shift],
    [shift, shift],
  ];
  return offsets[myIdx % offsets.length];
}

// --- Path computation for cell-by-cell animation (ported from v1; the walk
// logic is coordinate-agnostic, only the lookup tables changed) ---

export function computeMovePath(
  from: TokenPosition,
  to: TokenPosition,
  color: Ludo2Color
): [number, number][] {
  if (from === 'final-6') return [];
  if (to === 'base') return [];

  // Base → track: animate from base through start cell to destination
  if (from === 'base' && to.startsWith('track-')) {
    const trackNum = parseInt(to.split('-')[1]);
    const startCell = START_POSITIONS[color];
    if (trackNum === startCell) return [TRACK_XY[trackNum]];
    const path: [number, number][] = [TRACK_XY[startCell]];
    let cur = startCell;
    while (cur !== trackNum && path.length < TRACK_SIZE) {
      cur = (cur % TRACK_SIZE) + 1;
      path.push(TRACK_XY[cur]);
    }
    return path;
  }
  // Base → final: through start cell and track to home corridor
  if (from === 'base' && to.startsWith('final-')) {
    const startCell = START_POSITIONS[color];
    const entry = ENTRY_CELLS[color];
    const path: [number, number][] = [TRACK_XY[startCell]];
    let cur = startCell;
    while (cur !== entry && path.length < TRACK_SIZE) {
      cur = (cur % TRACK_SIZE) + 1;
      path.push(TRACK_XY[cur]);
    }
    const finalTarget = parseInt(to.split('-')[1]);
    for (let i = 1; i <= finalTarget; i++) {
      path.push(FINAL_XY[color][i - 1]);
    }
    return path;
  }
  if (from === 'base') return [];

  if (from.startsWith('track-') && to.startsWith('track-')) {
    const path: [number, number][] = [];
    let cur = parseInt(from.split('-')[1]);
    const target = parseInt(to.split('-')[1]);
    const fwd = target >= cur ? target - cur : TRACK_SIZE - cur + target;
    const bwd = cur >= target ? cur - target : TRACK_SIZE - target + cur;
    if (fwd <= bwd) {
      while (cur !== target && path.length < TRACK_SIZE) {
        cur = (cur % TRACK_SIZE) + 1;
        path.push(TRACK_XY[cur]);
      }
    } else {
      // Backward (knockback)
      while (cur !== target && path.length < TRACK_SIZE) {
        cur = cur === 1 ? TRACK_SIZE : cur - 1;
        path.push(TRACK_XY[cur]);
      }
    }
    return path;
  }

  if (from.startsWith('track-') && to.startsWith('final-')) {
    const path: [number, number][] = [];
    let cur = parseInt(from.split('-')[1]);
    const entry = ENTRY_CELLS[color];
    while (cur !== entry && path.length < TRACK_SIZE) {
      cur = (cur % TRACK_SIZE) + 1;
      path.push(TRACK_XY[cur]);
    }
    const finalTarget = parseInt(to.split('-')[1]);
    for (let i = 1; i <= finalTarget; i++) {
      path.push(FINAL_XY[color][i - 1]);
    }
    return path;
  }

  if (from.startsWith('final-') && to.startsWith('final-')) {
    const path: [number, number][] = [];
    const fromN = parseInt(from.split('-')[1]);
    const toN = parseInt(to.split('-')[1]);
    if (toN > fromN) {
      for (let i = fromN + 1; i <= toN; i++) path.push(FINAL_XY[color][i - 1]);
    } else {
      for (let i = fromN - 1; i >= toN; i--) path.push(FINAL_XY[color][i - 1]);
    }
    return path;
  }

  return [];
}
