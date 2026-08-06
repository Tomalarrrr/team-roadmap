import { describe, it, expect } from 'vitest';
import {
  CELL_PCT,
  TOKEN_PCT,
  STEP_DEG,
  R_RING,
  BASE_BAY_PCT,
  BASE_CENTRE,
  BASE_ARC_DEG,
  TRACK_XY,
  FINAL_XY,
  BASE_XY,
  HUB,
  ARM_ANGLE,
  RIM_DIP,
  RIM_BULGE,
  TRACK_BAND,
  rimRadiusAt,
  trackCellSpec,
  trackAngle,
  computeMovePath,
  getTokenCoords,
  getTokenOffset,
} from '../ludo4/ludo4Geometry';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  PLAYER_COLORS,
  START_POSITIONS,
  ENTRY_CELLS,
  SAFE_ZONES,
  colorIndex,
} from '../../ludo4Board';
import type { TokenPosition } from '../../ludoFirebase';

const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const fromCentre = (p: [number, number]) => Math.hypot(p[0] - 50, p[1] - 50);

/** Chord between neighbouring ring cells: 2·R·sin(step/2). */
const RING_PITCH = 2 * R_RING * Math.sin((STEP_DEG * Math.PI) / 360);

describe('ludo4 circular board geometry', () => {
  it('lays all 56 track cells on the ring, evenly spaced', () => {
    for (let t = 1; t <= TRACK_SIZE; t++) {
      expect(fromCentre(TRACK_XY[t])).toBeCloseTo(R_RING, 6);
    }
    for (let t = 1; t <= TRACK_SIZE; t++) {
      const next = (t % TRACK_SIZE) + 1;
      expect(dist(TRACK_XY[t], TRACK_XY[next])).toBeCloseTo(RING_PITCH, 6);
    }
  });

  it('keeps the ring tiles inside the disc with a gap between neighbours', () => {
    expect(R_RING + CELL_PCT / 2).toBeLessThan(50);
    // A tile is narrower than the pitch, so neighbouring tiles never touch.
    expect(CELL_PCT).toBeLessThan(RING_PITCH);
  });

  it('seats the tiles inside the band, and the band inside the dip', () => {
    // The band exists to frame the tiles; a band that any tile (or the run
    // home's first cell) pokes out of frames nothing.
    expect(TRACK_BAND.inner).toBeLessThan(R_RING - CELL_PCT / 2);
    expect(TRACK_BAND.outer).toBeGreaterThan(R_RING + CELL_PCT / 2);
    expect(TRACK_BAND.outer).toBeLessThan(RIM_DIP);
    for (const color of PLAYER_COLORS) {
      expect(fromCentre(FINAL_XY[color][0]) + CELL_PCT / 2).toBeLessThan(TRACK_BAND.inner);
    }
  });

  it('never overlaps two cells', () => {
    const cells: [number, number][] = [];
    for (let t = 1; t <= TRACK_SIZE; t++) cells.push(TRACK_XY[t]);
    for (const color of PLAYER_COLORS) cells.push(...FINAL_XY[color]);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(dist(cells[i], cells[j])).toBeGreaterThan(CELL_PCT * 0.6);
      }
    }
  });

  it('runs each spoke inward from the ring toward the hub', () => {
    for (const color of PLAYER_COLORS) {
      const spoke = FINAL_XY[color];
      // strictly inward, starting clear of the ring tiles
      for (let f = 0; f < spoke.length - 1; f++) {
        expect(fromCentre(spoke[f + 1])).toBeLessThan(fromCentre(spoke[f]));
      }
      expect(spoke).toHaveLength(FINAL_SIZE);
      expect(fromCentre(spoke[0]) + CELL_PCT / 2).toBeLessThan(R_RING - CELL_PCT / 2);
      // The last cell stops clear of the hub — the hub is the die's, and a
      // corridor that ran under it would bury its own deepest cell.
      const last = fromCentre(spoke[FINAL_SIZE - 1]);
      expect(last - CELL_PCT / 2).toBeGreaterThan(HUB.r);
      expect(last).toBeLessThan(HUB.r + CELL_PCT * 2);
      // and it lies on that colour's bearing (wrap-safe: 359.999° ≡ 0°)
      for (const p of spoke) {
        const ang = (Math.atan2(50 - p[0], p[1] - 50) * 180) / Math.PI;
        const off = (((ang - ARM_ANGLE[color]) % 360) + 540) % 360 - 180;
        expect(Math.abs(off)).toBeLessThan(0.001);
      }
    }
  });

  it('puts each entry cell one hop from its spoke', () => {
    for (const color of PLAYER_COLORS) {
      const entry = TRACK_XY[ENTRY_CELLS[color]];
      expect(dist(entry, FINAL_XY[color][0])).toBeLessThan(RING_PITCH * 2.6);
    }
  });

  /* The spoke has to point at the cell it is entered from, and the haven you
     come out on has to sit right at it. One cell apart is as close as the two
     can get: a counter standing *on* its entry cell turns for home on its next
     move, so start = entry would take a counter from the yard to home in two
     moves without it ever travelling the ring. */
  it('lands each entry cell on its own arm, with the start cell next to it', () => {
    for (const color of PLAYER_COLORS) {
      const entryDelta = trackAngle(ENTRY_CELLS[color]) - ARM_ANGLE[color];
      expect(((entryDelta % 360) + 360) % 360).toBeCloseTo(0, 6);

      const startDelta = trackAngle(START_POSITIONS[color]) - ARM_ANGLE[color];
      expect(((startDelta % 360) + 360) % 360).toBeCloseTo(STEP_DEG, 6);

      const gap = ((START_POSITIONS[color] - ENTRY_CELLS[color]) % TRACK_SIZE + TRACK_SIZE) % TRACK_SIZE;
      expect(gap).toBe(1);
      expect(START_POSITIONS[color]).not.toBe(ENTRY_CELLS[color]);
    }
  });

  /* Deploying onto a haven is the whole reason the start cell is where it is. */
  it('makes every start cell a haven', () => {
    for (const color of PLAYER_COLORS) {
      expect(SAFE_ZONES.has(START_POSITIONS[color])).toBe(true);
    }
  });

  it('parks the yards on the apron, clear of the track and of the rim', () => {
    for (const color of PLAYER_COLORS) {
      for (const spot of BASE_XY[color]) {
        const r = fromCentre(spot);
        // Clear of the ring tiles entirely — a yard drawn across the track
        // buries that colour's entry and start cells, the two it most needs
        // to see.
        expect(r - TOKEN_PCT / 2).toBeGreaterThan(R_RING + CELL_PCT / 2);
        expect(r + TOKEN_PCT / 2).toBeLessThan(49);
      }
      // and centred on the colour's own bearing
      const c = BASE_CENTRE[color];
      expect(fromCentre([c.x, c.y])).toBeCloseTo(fromCentre(BASE_XY[color][0]), 6);
    }
  });

  it('keeps yards, and the pieces in them, from touching each other', () => {
    const spots = PLAYER_COLORS.flatMap(c => BASE_XY[c]);
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        expect(dist(spots[i], spots[j])).toBeGreaterThan(TOKEN_PCT);
        expect(dist(spots[i], spots[j])).toBeGreaterThan(BASE_BAY_PCT);
      }
    }
    // each yard spans less than a quarter of the disc, so four of them fit
    expect(BASE_ARC_DEG * 2).toBeLessThan(90);
  });

  it('never lets a piece in a yard cover a track cell', () => {
    for (const color of PLAYER_COLORS) {
      for (const spot of BASE_XY[color]) {
        for (let t = 1; t <= TRACK_SIZE; t++) {
          expect(dist(spot, TRACK_XY[t])).toBeGreaterThan((TOKEN_PCT + CELL_PCT) / 2);
        }
      }
    }
  });

  it('leaves each colour its own entry cell to see', () => {
    for (const color of PLAYER_COLORS) {
      const entry = TRACK_XY[ENTRY_CELLS[color]];
      for (const c of PLAYER_COLORS) {
        for (const spot of BASE_XY[c]) {
          expect(dist(spot, entry)).toBeGreaterThan(CELL_PCT);
        }
      }
    }
  });

  it('keeps every drawn point inside the container', () => {
    const pts: [number, number][] = [];
    for (let t = 1; t <= TRACK_SIZE; t++) pts.push(TRACK_XY[t]);
    for (const color of PLAYER_COLORS) pts.push(...FINAL_XY[color], ...BASE_XY[color]);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThan(1);
      expect(x).toBeLessThan(99);
      expect(y).toBeGreaterThan(1);
      expect(y).toBeLessThan(99);
    }
  });

  it('carries each cell rotation so tiles stand radially', () => {
    expect(trackCellSpec(1).rot).toBeCloseTo(STEP_DEG, 6);
    expect(trackCellSpec(15).rot).toBeCloseTo(90 + STEP_DEG, 6);
    expect(trackCellSpec(29).rot).toBeCloseTo(180 + STEP_DEG, 6);
    expect(trackCellSpec(43).rot).toBeCloseTo(270 + STEP_DEG, 6);
  });

  it('is four-fold symmetric about the centre', () => {
    for (let n = 1; n <= 14; n++) {
      const r = fromCentre(TRACK_XY[n]);
      expect(fromCentre(TRACK_XY[n + 14])).toBeCloseTo(r, 6);
      expect(fromCentre(TRACK_XY[n + 28])).toBeCloseTo(r, 6);
      expect(fromCentre(TRACK_XY[n + 42])).toBeCloseTo(r, 6);
    }
  });

  it('holds everything inside the sculpted rim', () => {
    // The rim dips between arms and swells over the yards; nothing drawn may
    // poke through it. The ring lives inside the dip, the yards inside the
    // swell — with real margin, because a bay kissing the edge reads as a
    // mistake even when it technically fits.
    expect(rimRadiusAt(45)).toBeCloseTo(RIM_DIP, 6);
    expect(rimRadiusAt(0)).toBeCloseTo(RIM_BULGE, 6);
    expect(R_RING + CELL_PCT / 2).toBeLessThan(RIM_DIP - 1);
    for (const color of PLAYER_COLORS) {
      for (const spot of BASE_XY[color]) {
        const r = fromCentre(spot);
        const bearing = (Math.atan2(50 - spot[0], spot[1] - 50) * 180) / Math.PI;
        expect(r + BASE_BAY_PCT / 2).toBeLessThan(rimRadiusAt(bearing) - 0.5);
      }
    }
  });

  it('spins every seat onto an axis, with the local player at the bottom', () => {
    // The plate turns by −ARM_ANGLE[me], so your own arm always lands at
    // bearing 0 (pointing down at you, as Ludo2 seats you) and the rest at 90°
    // steps. There is deliberately no clear wedge above the hub — the status
    // line and clock live inside the hub, which is sized for them (see HUB).
    for (const my of PLAYER_COLORS) {
      const bearings = PLAYER_COLORS.map(
        other => (ARM_ANGLE[other] - ARM_ANGLE[my] + 360) % 360
      );
      expect(bearings[PLAYER_COLORS.indexOf(my)]).toBe(0);
      expect([...bearings].sort((a, b) => a - b)).toEqual([0, 90, 180, 270]);
    }
  });
});

describe('computeMovePath', () => {
  it('walks contiguous waypoints for a plain track move', () => {
    const path = computeMovePath('track-3', 'track-9', 'red');
    expect(path).toHaveLength(6);
    expect(path[5]).toEqual(TRACK_XY[9]);
    let prev = TRACK_XY[3];
    for (const wp of path) {
      expect(dist(prev, wp)).toBeCloseTo(RING_PITCH, 6);
      prev = wp;
    }
  });

  it('wraps across the seam (54 → 2)', () => {
    const path = computeMovePath('track-54', 'track-2', 'green');
    expect(path).toEqual([TRACK_XY[55], TRACK_XY[56], TRACK_XY[1], TRACK_XY[2]]);
  });

  it('takes the shorter backward route for knockbacks', () => {
    const path = computeMovePath('track-5', 'track-2', 'green');
    expect(path).toEqual([TRACK_XY[4], TRACK_XY[3], TRACK_XY[2]]);
  });

  /* Derived from ENTRY_CELLS rather than spelled out, so moving the turn for
     home cannot leave this test quietly asserting the old board. */
  it('enters the spoke through the entry cell', () => {
    const entry = ENTRY_CELLS.red;
    const path = computeMovePath('track-53', 'final-2', 'red');
    const ringLeg = [];
    for (let t = 54; t !== (entry % TRACK_SIZE) + 1; t = (t % TRACK_SIZE) + 1) {
      ringLeg.push(TRACK_XY[t]);
      if (t === entry) break;
    }
    expect(path).toEqual([...ringLeg, FINAL_XY.red[0], FINAL_XY.red[1]]);
    expect(path[ringLeg.length - 1]).toEqual(TRACK_XY[entry]);
  });

  it('deploy path starts at the start cell', () => {
    const path = computeMovePath('base', 'track-15', 'green');
    expect(path).toEqual([TRACK_XY[15]]);
  });
});

describe('getTokenCoords', () => {
  it('gives every piece a distinct yard bay', () => {
    const seen = new Set<string>();
    for (let i = 0; i < TOTAL_TOKENS; i++) {
      const c = getTokenCoords('base', i);
      expect(c).not.toBeNull();
      seen.add(c!.map(v => v.toFixed(3)).join(','));
    }
    expect(seen.size).toBe(TOTAL_TOKENS);
  });

  /* There is no pile at the centre: a counter is home standing in a run-home
     cell of its own, so every finishable position has to resolve to a cell. */
  it('places every counter of a colour in a run-home cell of its own', () => {
    for (const color of PLAYER_COLORS) {
      const seen = new Set<string>();
      for (let f = 1; f <= FINAL_SIZE; f++) {
        const c = getTokenCoords(`final-${f}` as TokenPosition, colorIndex(color) * FINAL_SIZE);
        expect(c).not.toBeNull();
        seen.add(c!.map(v => v.toFixed(3)).join(','));
      }
      expect(seen.size).toBe(FINAL_SIZE);
    }
    expect(getTokenCoords(`final-${FINAL_SIZE + 1}` as TokenPosition, 0)).toBeNull();
  });
});

/* The jitter exists so a stack on one cell stays countable. Sharing a position
   *string* is not the same as sharing a cell, though: the ring is one road every
   colour walks, so `track-17` is one place, but a run home belongs to its colour,
   so `final-3` is four separate places on four separate arms. */
describe('getTokenOffset', () => {
  const empty = (): TokenPosition[] => Array(TOTAL_TOKENS).fill('base') as TokenPosition[];
  const RED = 0;
  const GREEN = TOKENS_PER_PLAYER;
  const YELLOW = TOKENS_PER_PLAYER * 2;
  const BLUE = TOKENS_PER_PLAYER * 3;

  it('leaves a counter standing alone dead centre', () => {
    const tokens = empty();
    tokens[RED] = 'track-17';
    expect(getTokenOffset(tokens, RED)).toEqual([0, 0]);
  });

  it('does not nudge run-home counters of different colours apart', () => {
    // Regression inherited from Ludo2: matching on the string alone treated
    // each colour's third run-home cell as one shared cell and shoved a counter
    // off-centre in each of them while all were in fact standing alone.
    const tokens = empty();
    tokens[RED] = 'final-3';
    tokens[GREEN] = 'final-3';
    tokens[YELLOW] = 'final-3';
    tokens[BLUE] = 'final-3';
    for (const i of [RED, GREEN, YELLOW, BLUE]) {
      expect(getTokenOffset(tokens, i)).toEqual([0, 0]);
    }
  });

  it('still separates opposing counters sharing one cell of the ring', () => {
    const tokens = empty();
    tokens[RED] = 'track-17';
    tokens[GREEN] = 'track-17';
    expect(getTokenOffset(tokens, RED)).not.toEqual(getTokenOffset(tokens, GREEN));
  });

  it('gives a whole yard piled onto one cell a distinct slot each', () => {
    const tokens = empty();
    const mine = Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => RED + i);
    for (const i of mine) tokens[i] = 'track-9';
    const slots = new Set(mine.map(i => getTokenOffset(tokens, i).join(',')));
    expect(slots.size).toBe(TOKENS_PER_PLAYER);
  });
});
