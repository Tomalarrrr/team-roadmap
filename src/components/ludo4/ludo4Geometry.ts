// Ludo4 circular-board geometry.
//
// The same idea as Ludo3's ring, one seat wider: 56 track cells (4 players ×
// 14) laid out as the ring they are, so nothing in ludo4GameLogic changes.
//
//   track  t = 1..56   one full turn of the ring, one step = 360/56
//   final  f = 1..5    a radial spoke running from the ring into the centre
//
// Each colour owns a bearing (ARM_ANGLE) and everything of that colour lives in
// that one wedge, at three different radii so nothing ever overlaps: its yard
// (five sockets) out on the apron beyond the track, its entry cell on the track
// itself, and its spoke running inward from there. Its start cell is the next
// one round, so a piece deploys just ahead of its own yard. Everything is
// polar: degrees, and radius in % of the square container, with 0° pointing
// down the screen so the plate can turn a player's own colour to face them.
//
// Like Ludo3 the board is drawn flat — no bore, no bridges, no moulding —
// so this module carries only positions and sizes, not lighting.

import type { TokenPosition } from '../../ludoFirebase';
import {
  TRACK_SIZE,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  START_POSITIONS,
  ENTRY_CELLS,
  PLAYER_COLORS,
  getTokenColor,
  type Ludo4Color,
} from '../../ludo4Board';

/** Degrees between neighbouring track cells. */
export const STEP_DEG = 360 / TRACK_SIZE;

/** Radius of the track ring, to tile centres. */
export const R_RING = 39.2;

/** Track tile. Arc spacing at R_RING is 2πR/56 ≈ 4.40; 3.95 fills most of the
 * pitch — the track is the board's main subject, and tile weight is a large
 * part of what says so. */
export const CELL_PCT = 3.95;
/** A piece — sized against a cell in the same ratio as Ludo3's counters, so a
 * counter covers its cell without burying the cell's own border. */
export const TOKEN_PCT = 3.25;

/** The band the track sits in: a flat toned annulus hugging the ring of cells.
 * The tiles are the whitest thing on the board and the band is what makes them
 * so. Cell half-width plus a little air each side. */
export const TRACK_BAND = { inner: 36.5, outer: 41.9 };

/** The run home is drawn in the same square cells as the ring: five of them
 * stepping inward on the colour's bearing, solid seat colour like the classic
 * board's corridors. Five squares plus the hub have to fit inside the ring. */
export const SPOKE_CELL = CELL_PCT;
const R_SPOKE_OUT = 33.5;
const SPOKE_STEP = 4.4;

/** The hub the four runs home point at. No counter ever stands here — it holds
 * the die, the status line and the turn ring. It is sized for that content:
 * with four arms and the local player's spun to the bottom, the opposite arm
 * owns the space above the hub, so the status cannot live out there the way
 * a three-seat board's would. Everything the player reads mid-turn lives at the
 * centre. */
export const HUB = { x: 50, y: 50, r: 13.4 };

/** The yard: one bay per counter, in a shallow arc on the apron *outside* the
 * track, centred on the colour's own bearing. Off the ring entirely — a yard
 * drawn across the track buries that colour's entry and start cells, which are
 * the two cells its owner most needs to see. */
const R_BASE = 45.9;
/** A bay, drawn a little wider than a track cell.
 *
 * A piece is the same size everywhere — what changes is what it stands in. A
 * track cell is a square, so a round counter has the corners to breathe into
 * and the flats read as clearance. A bay is a *ring*, concentric with the
 * counter all the way round, so the only clearance it has is the difference in
 * radius — and at a cell's width that came to half a device pixel, which the
 * renderer then rounded to one pixel on one side and none on the other. The
 * counters were dead centre; the sockets just looked like they were not.
 *
 * Sized so the white between counter and ring survives rounding at any board
 * size: BASE_BAY_PCT − 2·BASE_RING_PCT − TOKEN_PCT is a clear 0.26 of the
 * board, a couple of pixels at a normal popup. */
export const BASE_BAY_PCT = CELL_PCT + 0.35;

/** The socket ring's own thickness, in board %. Kept in step with the
 * `box-shadow` inset on `.baseBay` in Ludo4Game.module.css — the test suite
 * reads the stylesheet and checks the two agree, because the clearance above is
 * only correct if they do. */
export const BASE_RING_PCT = 0.26;
/** Degrees between neighbouring bays: one bay plus a hair, at R_BASE. */
const BASE_SPOT_STEP = 5.8;
/** Half the yard's angular span, sockets included. */
export const BASE_ARC_DEG = ((TOKENS_PER_PLAYER - 1) / 2) * BASE_SPOT_STEP;

export const ARM_ANGLE: Record<Ludo4Color, number> = {
  red: 0, green: 90, yellow: 180, blue: 270,
};

// --- The rim ----------------------------------------------------------------
// The board's silhouette is not a circle: the rim dips in on the diagonals and
// swells back out around each yard, so the shape itself houses the counters.
// One smooth four-lobed curve, r(θ) = mid + amp·cos(4θ) — its period is 90°,
// so it is invariant under the plate's quarter-turns and never needs to spin.

/** Rim radius between arms (the dip) and over each yard (the swell). */
export const RIM_DIP = 45.4;
export const RIM_BULGE = 49.6;

/** Rim radius at a board bearing, in % of the container. */
export function rimRadiusAt(bearingDeg: number): number {
  const mid = (RIM_DIP + RIM_BULGE) / 2;
  const amp = (RIM_BULGE - RIM_DIP) / 2;
  return mid + amp * Math.cos((4 * bearingDeg * Math.PI) / 180);
}

/** The rim as points, dense enough (2.5° steps) that the polyline reads as a
 * continuous curve at any board size. */
const RIM_POINTS: [number, number][] = Array.from({ length: 144 }, (_, i) => {
  const b = (i * 360) / 144;
  const r = rimRadiusAt(b);
  const a = (b * Math.PI) / 180;
  return [50 - r * Math.sin(a), 50 + r * Math.cos(a)];
});

/** SVG path for the rim, in the board's 0–100 viewBox. */
export const RIM_OUTLINE_PATH =
  `M ${RIM_POINTS.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(' L ')} Z`;

/** The same outline as a CSS clip-path, for layers (the apron wash) that have
 * to stop at the rim rather than run on to the old circle. */
export const RIM_CLIP_PATH =
  `polygon(${RIM_POINTS.map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(', ')})`;

export interface CellSpec {
  x: number;
  y: number;
  rot: number;
}

/** Polar → board %. 0° points down the screen; angles increase the way the
 * track is numbered. */
function polar(angleDeg: number, radius: number): CellSpec {
  const a = (angleDeg * Math.PI) / 180;
  return {
    x: 50 - radius * Math.sin(a),
    y: 50 + radius * Math.cos(a),
    rot: angleDeg,
  };
}

/** Bearing of track cell `t`.
 *
 * No offset is applied, and none is needed: with ENTRY_CELLS at start − 1,
 * every entry cell is a multiple of 14 (56, 14, 28, 42) and so lands exactly on
 * 0°, 90°, 180°, 270° — its own colour's bearing, and the foot of the spoke
 * that cell is for. Its start cell is then the next one round, which is why the
 * haven you come out on sits at the foot of your own run home.
 *
 * That alignment is a consequence of ENTRY_CELLS, not of anything here. Move
 * the entry cells off start − 1 and the spokes land between tiles: this
 * function needs the matching offset back. */
export function trackAngle(t: number): number {
  return t * STEP_DEG;
}

export function trackCellSpec(t: number): CellSpec {
  return polar(trackAngle(t), R_RING);
}

export function finalCellSpec(color: Ludo4Color, f: number): CellSpec {
  return polar(ARM_ANGLE[color], R_SPOKE_OUT - (f - 1) * SPOKE_STEP);
}

/** The bays spread along the apron arc, centred on the colour's bearing. */
export function baseSpotSpec(color: Ludo4Color, i: number): CellSpec {
  return polar(ARM_ANGLE[color] + (i - (TOKENS_PER_PLAYER - 1) / 2) * BASE_SPOT_STEP, R_BASE);
}

// --- Prebuilt lookup tables -------------------------------------------------

export const TRACK_XY: Record<number, [number, number]> = {};
for (let t = 1; t <= TRACK_SIZE; t++) {
  const s = trackCellSpec(t);
  TRACK_XY[t] = [s.x, s.y];
}

/** The run home, cell by cell. There is no pile beyond it: a counter is home
 * once it stands in a cell of its own, so the hub only carries the die. */
export const FINAL_XY: Record<Ludo4Color, [number, number][]> = {
  red: [], green: [], yellow: [], blue: [],
};
for (const color of PLAYER_COLORS) {
  for (let f = 1; f <= FINAL_SIZE; f++) {
    const s = finalCellSpec(color, f);
    FINAL_XY[color].push([s.x, s.y]);
  }
}

export const BASE_SPEC: Record<Ludo4Color, CellSpec[]> = {
  red: [], green: [], yellow: [], blue: [],
};
export const BASE_XY: Record<Ludo4Color, [number, number][]> = {
  red: [], green: [], yellow: [], blue: [],
};
for (const color of PLAYER_COLORS) {
  for (let i = 0; i < TOKENS_PER_PLAYER; i++) {
    const s = baseSpotSpec(color, i);
    BASE_SPEC[color].push(s);
    BASE_XY[color].push([s.x, s.y]);
  }
}

/** Midpoint of each colour's yard arc — where its label or tint is anchored. */
export const BASE_CENTRE: Record<Ludo4Color, CellSpec> = {
  red: polar(ARM_ANGLE.red, R_BASE),
  green: polar(ARM_ANGLE.green, R_BASE),
  yellow: polar(ARM_ANGLE.yellow, R_BASE),
  blue: polar(ARM_ANGLE.blue, R_BASE),
};

// --- Token positioning (all coords are cell CENTRES in % of the board) ------

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
    if (finalNum >= 1 && finalNum <= FINAL_SIZE) return FINAL_XY[color][finalNum - 1];
  }
  return null;
}

/** Jitter co-located pieces into quadrants so stacks stay readable, with the
 * fifth slot in the middle — four quadrants and modulo would draw two of a full
 * yard's five on top of each other, the one thing the jitter exists to prevent.
 * A run-home cell only ever holds one counter (exact landing), so this only
 * fires out on the track.
 *
 * Sharing a *position* is not the same as sharing a *cell*. Track cells are one
 * ring every colour walks, so `track-17` is one place; a run home belongs to its
 * colour, so `final-3` is four different places. Matching on the string alone
 * would nudge counters off-centre in run-home cells they are not sharing. */
export function getTokenOffset(tokens: TokenPosition[], tokenIndex: number): [number, number] {
  const pos = tokens[tokenIndex];
  if (pos === 'base') return [0, 0];

  const ownColor = pos.startsWith('final-') ? getTokenColor(tokenIndex) : null;
  const sameCell: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== pos) continue;
    if (ownColor !== null && getTokenColor(i) !== ownColor) continue;
    sameCell.push(i);
  }
  if (sameCell.length <= 1) return [0, 0];

  const myIdx = sameCell.indexOf(tokenIndex);
  const shift = CELL_PCT * 0.15;
  const offsets: [number, number][] = [
    [-shift, -shift], [shift, -shift], [-shift, shift], [shift, shift], [0, 0],
  ];
  return offsets[myIdx % offsets.length];
}

// --- Path computation for cell-by-cell animation ----------------------------
// Pure index arithmetic on the ring, so the redraw leaves it untouched.

export function computeMovePath(
  from: TokenPosition,
  to: TokenPosition,
  color: Ludo4Color
): [number, number][] {
  if (to === 'base') return [];

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
    for (let i = 1; i <= finalTarget; i++) path.push(FINAL_XY[color][i - 1]);
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
    for (let i = 1; i <= finalTarget; i++) path.push(FINAL_XY[color][i - 1]);
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
