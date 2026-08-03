// Ludo2 circular-board geometry.
//
// The rules were always played on a 42-cell *ring* (3 players × 14) — the
// Y-board was only one way of drawing it. This lays the same 42 cells out as
// the ring they actually are, so nothing in ludo2GameLogic changes.
//
//   track  t = 1..42   one full turn of the ring, one step = 360/42
//   final  f = 1..5    a radial spoke running from the ring into the centre
//
// Each colour owns a bearing (ARM_ANGLE) and everything of that colour lives in
// that one wedge, at three different radii so nothing ever overlaps: its yard
// (five sockets) out on the apron beyond the track, its entry cell on the track
// itself, and its spoke running inward from there. Its start cell is the next
// one round, so a piece deploys just ahead of its own yard. Everything is
// polar: degrees, and radius in % of the square container, with 0° pointing
// down the screen so the plate can turn a player's own colour to face them.

import type { TokenPosition } from '../../ludoFirebase';
import {
  TRACK_SIZE,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  START_POSITIONS,
  ENTRY_CELLS,
  PLAYER_COLORS,
  getTokenColor,
  type Ludo2Color,
} from '../../ludo2Board';

/** Degrees between neighbouring track cells. */
export const STEP_DEG = 360 / TRACK_SIZE;

/** Radius of the track ring, to tile centres. */
export const R_RING = 39.2;
/** The raised band the track sits in. It hugs the tiles: a band much wider than
 * what it holds reads as a blank moat, not as a track. */
export const RING_OUTER = 42.6;
export const RING_INNER = 35.8;

/** Track tile. Arc spacing at R_RING is 2πR/42 ≈ 5.86, so 5.0 leaves a gap. */
export const CELL_PCT = 5.0;
/** A piece. Sized against a ring tile's *inner* edge, not its width: the tiles
 * are arc segments, so a counter cut to the outer edge overhangs the narrow
 * end and covers the rim of the cell it is standing on. */
export const TOKEN_PCT = 4.1;

/** The run home is drawn in the same square cells as the ring: five of them
 * stepping inward on the colour's bearing. Long thin bars sitting in a washed
 * channel read as a different kind of object; the run home is just the track
 * turning a corner, so it is drawn as track. Everything downstream is sized off
 * that one decision — five squares plus the hub have to fit inside the ring. */
export const SPOKE_CELL = CELL_PCT;
const R_SPOKE_OUT = 32.3;
const SPOKE_STEP = 5.2;

/** The hub the three runs home land on. Whatever the five cells leave: no
 * counter ever stands here, so it only has to carry the mark. */
export const HUB = { x: 50, y: 50, r: 7.6 };

/** The board is cut away inside the track. What is left is a ring, a hub island
 * floating at its centre, and three bridges carrying the runs home across the
 * gap — which is what the runs home always were. */
export const APERTURE = RING_INNER;

/** A bridge deck: wider than the cells it carries, and long enough to land on
 * the ring at one end and tuck under the hub at the other. A deck that stops
 * short of either is not a bridge, it is a plank lying in a hole. */
export const BRIDGE_W = SPOKE_CELL + 1.9;
/** Both ends run well past what you see of them, because both are drawn *under*
 * the thing they land on — the ring band at one end, the hub island at the
 * other. A deck that stopped at the edge of the bore would put its own straight
 * end across the band's curve, and a straight cut across an arc is the ugliest
 * join on a round board. Let the arc do the cutting. */
const BRIDGE_OUT = APERTURE + 2.6;
const BRIDGE_IN = HUB.r - 1.6;
export const BRIDGE_LEN = BRIDGE_OUT - BRIDGE_IN;

/** The yard: one bay per counter, in a shallow arc on the apron *outside* the
 * track, centred on the colour's own bearing. Off the ring entirely — a yard
 * drawn across the track buries that colour's entry and start cells, which are
 * the two cells its owner most needs to see. Bays rather than loose sockets,
 * because five circles adrift on an apron read as five stray marks. */
const R_BASE = 45.9;
/** A bay is a track cell's twin, so a piece looks the same size everywhere. */
export const BASE_BAY_PCT = CELL_PCT;
/** Degrees between neighbouring bays: one bay plus a hair, at R_BASE. */
const BASE_SPOT_STEP = 7.4;
/** Half the yard's angular span, sockets included. */
export const BASE_ARC_DEG = ((TOKENS_PER_PLAYER - 1) / 2) * BASE_SPOT_STEP;

export const ARM_ANGLE: Record<Ludo2Color, number> = { red: 0, green: 120, yellow: 240 };

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
 * No offset is applied, and none is needed: with ENTRY_CELLS at start − 1, every
 * entry cell is a multiple of 14 (42, 14, 28) and so lands exactly on 0°, 120°,
 * 240° — its own colour's bearing, and the foot of the bridge that cell is for.
 * Its start cell is then the next one round, which is why the haven you come out
 * on sits at the foot of your own run home.
 *
 * That alignment is a consequence of ENTRY_CELLS, not of anything here. Move the
 * entry cells off start − 1 and the bridges land between tiles: this function
 * needs the matching offset back. */
export function trackAngle(t: number): number {
  return t * STEP_DEG;
}

export function trackCellSpec(t: number): CellSpec {
  return polar(trackAngle(t), R_RING);
}

export function finalCellSpec(color: Ludo2Color, f: number): CellSpec {
  return polar(ARM_ANGLE[color], R_SPOKE_OUT - (f - 1) * SPOKE_STEP);
}

/** The bays spread along the apron arc, centred on the colour's bearing. */
export function baseSpotSpec(color: Ludo2Color, i: number): CellSpec {
  return polar(ARM_ANGLE[color] + (i - (TOKENS_PER_PLAYER - 1) / 2) * BASE_SPOT_STEP, R_BASE);
}

// --- Prebuilt lookup tables -------------------------------------------------

export const TRACK_XY: Record<number, [number, number]> = {};
for (let t = 1; t <= TRACK_SIZE; t++) {
  const s = trackCellSpec(t);
  TRACK_XY[t] = [s.x, s.y];
}

/** The run home, cell by cell. There is no pile beyond it: a counter is home
 * once it stands in a cell of its own, so the hub is the thing the bridges land
 * on rather than a tray that counters end up in. */
export const FINAL_XY: Record<Ludo2Color, [number, number][]> = {
  red: [], green: [], yellow: [],
};
for (const color of PLAYER_COLORS) {
  for (let f = 1; f <= FINAL_SIZE; f++) {
    const s = finalCellSpec(color, f);
    FINAL_XY[color].push([s.x, s.y]);
  }
}

export const BASE_SPEC: Record<Ludo2Color, CellSpec[]> = {
  red: [], green: [], yellow: [],
};
export const BASE_XY: Record<Ludo2Color, [number, number][]> = {
  red: [], green: [], yellow: [],
};
for (const color of PLAYER_COLORS) {
  for (let i = 0; i < TOKENS_PER_PLAYER; i++) {
    const s = baseSpotSpec(color, i);
    BASE_SPEC[color].push(s);
    BASE_XY[color].push([s.x, s.y]);
  }
}

export const BRIDGE_RECT: Record<Ludo2Color, CellSpec> = {
  red: polar(ARM_ANGLE.red, (BRIDGE_IN + BRIDGE_OUT) / 2),
  green: polar(ARM_ANGLE.green, (BRIDGE_IN + BRIDGE_OUT) / 2),
  yellow: polar(ARM_ANGLE.yellow, (BRIDGE_IN + BRIDGE_OUT) / 2),
};

/** Midpoint of each colour's yard arc — where its label or tint is anchored. */
export const BASE_CENTRE: Record<Ludo2Color, CellSpec> = {
  red: polar(ARM_ANGLE.red, R_BASE),
  green: polar(ARM_ANGLE.green, R_BASE),
  yellow: polar(ARM_ANGLE.yellow, R_BASE),
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

/** Jitter co-located pieces into quadrants so stacks stay readable. A run-home
 * cell only ever holds one counter, so this only fires out on the track — where
 * a whole yard of five can pile onto one cell, hence the fifth slot in the
 * middle: four quadrants and modulo would draw two of them on top of each
 * other, which is the one thing the jitter exists to prevent.
 *
 * Sharing a *position* is not the same as sharing a *cell*. Track cells are one
 * ring every colour walks, so `track-17` is one place; a run home belongs to its
 * colour, so `final-3` is three different places and only counters of the same
 * colour are actually stacked. Matching on the string alone nudged a red counter
 * and a green one off-centre in run-home cells neither was sharing. */
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
  color: Ludo2Color
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
