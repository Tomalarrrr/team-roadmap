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
// tip spot is deliberately vacant (the track cuts the corner) and renders as an
// inert blank. Each color's base tray sits outside the arm, level with its
// start cell at (-1, 6).

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

/** Cell size as % of the (square) board container. Everything else on the board
 * is a multiple of this, so it is the single knob for how large the Y draws. */
export const CELL_PCT = 5.6;
/** Radial gap from the hub to the inner edge of row 1. At 1×CELL_PCT the
 * arm-to-arm hop at the junction is 1.6 cells; shrink it and the three arms'
 * innermost cells collide. */
const HUB_GAP = CELL_PCT;

/** Only the local player's tray is drawn, and the plate always turns so that
 * tray lands bottom-left — so the figure every player actually sees is three
 * arms plus one tray, which is not centred on the hub. Offsetting the hub up
 * and a touch right squares that view up. (A spectator, who sees all three
 * trays, gets a slightly looser fit; the numbers are held back from a perfect
 * one-tray centring so their top tray never crowds the board edge.) */
const ORIGIN_X = 49.6;
const ORIGIN_Y = 44.2;

export const ARM_ANGLE: Record<Ludo2Color, number> = { red: 0, green: 120, yellow: 240 };

export interface CellSpec {
  x: number;
  y: number;
  rot: number;
}

/** Arm-local frame → board %: dx is lateral (− is the start-cell side), dy radial. */
function armPoint(color: Ludo2Color, dx: number, dy: number): CellSpec {
  const a = (ARM_ANGLE[color] * Math.PI) / 180;
  return {
    x: ORIGIN_X + dx * Math.cos(a) - dy * Math.sin(a),
    y: ORIGIN_Y + dx * Math.sin(a) + dy * Math.cos(a),
    rot: ARM_ANGLE[color],
  };
}

function place(color: Ludo2Color, lane: number, row: number): CellSpec {
  return armPoint(color, lane * CELL_PCT, HUB_GAP + (row - 0.5) * CELL_PCT);
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

// --- Base tray -------------------------------------------------------------
// The tray sits *beside* the start cell it feeds — level with (−1, 6), pushed
// far enough sideways to clear the arm silhouette entirely, so a resting pawn
// never overlaps the track. (It used to sit beyond the arm tip, where the two
// inner sockets fouled the tip cells.)

/** Lateral offset of the tray centre. The arm silhouette is 1.74 cells to each
 * side and the tray 1.21, so 3.24 leaves a ~0.3-cell gutter between them. */
const BASE_LATERAL = 3.24 * CELL_PCT;
/** Radial offset: dead level with the start cell at (−1, 6). */
const BASE_RADIAL = HUB_GAP + 5.5 * CELL_PCT;
/** Centre-to-centre spacing of the four resting sockets. */
const BASE_SPOT_GAP = CELL_PCT;
/** Socket diameter. Deliberately smaller than a pawn (0.70 × CELL_PCT) so an
 * occupied socket disappears completely under its piece and an empty one reads
 * as a dimple in the tray — it used to be larger, which made every pawn look
 * like it was floating in a hole and made empty sockets read as grey pieces. */
export const BASE_SPOT_PCT = CELL_PCT * 0.58;

export function baseSpotSpec(color: Ludo2Color, i: number): CellSpec {
  return armPoint(
    color,
    -BASE_LATERAL + (i % 2 === 0 ? -0.5 : 0.5) * BASE_SPOT_GAP,
    BASE_RADIAL + (i < 2 ? -0.5 : 0.5) * BASE_SPOT_GAP
  );
}

/** A point on the arm axis at radial distance `dy`, e.g. for silhouettes. */
function axisPoint(color: Ludo2Color, dy: number): CellSpec {
  return armPoint(color, 0, dy);
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

/** The vacant (+1, 7) tip spot — the track cuts the corner from (+1, 6) to the
 * middle tip cell, so this slot is rendered as an inert blank. */
export const TIP_BLANK: Record<Ludo2Color, CellSpec> = {
  red: place('red', +1, 7),
  green: place('green', +1, 7),
  yellow: place('yellow', +1, 7),
};

/** Neutral rounded tray holding the four base sockets, beside the start cell. */
export const BASE_TRAY: Record<Ludo2Color, CellSpec> = {
  red: armPoint('red', -BASE_LATERAL, BASE_RADIAL),
  green: armPoint('green', -BASE_LATERAL, BASE_RADIAL),
  yellow: armPoint('yellow', -BASE_LATERAL, BASE_RADIAL),
};
const BASE_TRAY_SIDE = BASE_SPOT_GAP + BASE_SPOT_PCT + 0.6 * CELL_PCT;
export const BASE_TRAY_SIZE = { w: BASE_TRAY_SIDE, h: BASE_TRAY_SIDE };

/** Rounded-rect silhouette behind each arm's cells. */
export const ARM_RECT: Record<Ludo2Color, CellSpec> = {
  red: axisPoint('red', 4.5 * CELL_PCT),
  green: axisPoint('green', 4.5 * CELL_PCT),
  yellow: axisPoint('yellow', 4.5 * CELL_PCT),
};
export const ARM_RECT_SIZE = { w: 3.48 * CELL_PCT, h: 7.6 * CELL_PCT };

export const HUB = { x: ORIGIN_X, y: ORIGIN_Y, r: 1.4 * CELL_PCT };

/** Anchor for each color's pile of finished tokens, just inside the hub —
 * offset toward the color's own arm so the three piles never collide. */
export const HOME_PILE: Record<Ludo2Color, [number, number]> = (() => {
  const out = {} as Record<Ludo2Color, [number, number]>;
  for (const color of PLAYER_COLORS) {
    const p = axisPoint(color, 0.62 * CELL_PCT);
    out[color] = [p.x, p.y];
  }
  return out;
})();

/** Tiny per-token offsets so a full home pile reads as four counters. */
const PILE_OFF = 0.2 * CELL_PCT;
export const HOME_PILE_OFFSETS: [number, number][] = [
  [-PILE_OFF, -PILE_OFF], [PILE_OFF, -PILE_OFF], [-PILE_OFF, PILE_OFF], [PILE_OFF, PILE_OFF],
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
