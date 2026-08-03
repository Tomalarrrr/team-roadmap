import { describe, it, expect } from 'vitest';
import {
  CELL_PCT,
  TOKEN_PCT,
  STEP_DEG,
  R_RING,
  RING_OUTER,
  RING_INNER,
  BASE_BAY_PCT,
  BASE_CENTRE,
  BASE_ARC_DEG,
  APERTURE,
  BRIDGE_RECT,
  BRIDGE_W,
  BRIDGE_LEN,
  TRACK_XY,
  FINAL_XY,
  BASE_XY,
  HUB,
  ARM_ANGLE,
  trackCellSpec,
  trackAngle,
  computeMovePath,
  getTokenCoords,
} from '../ludo2/ludo2Geometry';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  FINAL_SIZE,
  PLAYER_COLORS,
  START_POSITIONS,
  ENTRY_CELLS,
  SAFE_ZONES,
  colorIndex,
} from '../../ludo2Board';
import type { TokenPosition } from '../../ludoFirebase';

const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);
const fromCentre = (p: [number, number]) => Math.hypot(p[0] - 50, p[1] - 50);

/** Chord between neighbouring ring cells: 2·R·sin(step/2). */
const RING_PITCH = 2 * R_RING * Math.sin((STEP_DEG * Math.PI) / 360);

describe('ludo2 circular board geometry', () => {
  it('lays all 42 track cells on the ring, evenly spaced', () => {
    for (let t = 1; t <= TRACK_SIZE; t++) {
      expect(fromCentre(TRACK_XY[t])).toBeCloseTo(R_RING, 6);
    }
    for (let t = 1; t <= TRACK_SIZE; t++) {
      const next = (t % TRACK_SIZE) + 1;
      expect(dist(TRACK_XY[t], TRACK_XY[next])).toBeCloseTo(RING_PITCH, 6);
    }
  });

  it('keeps the track band inside the disc and the tiles inside the band', () => {
    expect(RING_OUTER).toBeLessThan(50);
    expect(R_RING + CELL_PCT / 2).toBeLessThan(RING_OUTER);
    expect(R_RING - CELL_PCT / 2).toBeGreaterThan(RING_INNER);
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

  it('runs each spoke inward from the ring to the centre', () => {
    for (const color of PLAYER_COLORS) {
      const spoke = FINAL_XY[color];
      // strictly inward, ending inside the home disc's reach
      for (let f = 0; f < spoke.length - 1; f++) {
        expect(fromCentre(spoke[f + 1])).toBeLessThan(fromCentre(spoke[f]));
      }
      expect(spoke).toHaveLength(FINAL_SIZE);
      expect(fromCentre(spoke[0])).toBeLessThan(RING_INNER);
      // The last cell stops clear of the hub — no counter ever stands on it,
      // so a run home that reached it would have nothing to land against.
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

  /* The middle of the board is bored out, so the runs home are carried on
     bridges. A deck that fails to reach the ring at one end or the hub at the
     other is a plank lying in a hole, and it looks like one. */
  it('lands every bridge on the ring at one end and the hub at the other', () => {
    for (const color of PLAYER_COLORS) {
      const mid = fromCentre([BRIDGE_RECT[color].x, BRIDGE_RECT[color].y]);
      expect(mid + BRIDGE_LEN / 2).toBeGreaterThan(APERTURE);
      expect(mid - BRIDGE_LEN / 2).toBeLessThan(HUB.r);
      // and it is wide enough to carry the cells laid on it
      expect(BRIDGE_W).toBeGreaterThan(CELL_PCT);
      // every run-home cell sits over its own deck, none hanging off the side
      for (const p of FINAL_XY[color]) {
        const r = fromCentre(p);
        expect(r + CELL_PCT / 2).toBeLessThan(mid + BRIDGE_LEN / 2);
        expect(r - CELL_PCT / 2).toBeGreaterThan(mid - BRIDGE_LEN / 2);
      }
    }
  });

  it('puts each entry cell one hop from its spoke', () => {
    for (const color of PLAYER_COLORS) {
      const entry = TRACK_XY[ENTRY_CELLS[color]];
      expect(dist(entry, FINAL_XY[color][0])).toBeLessThan(RING_PITCH * 2.6);
    }
  });

  /* The foot of a bridge has to land on the cell that bridge is for, and the
     haven you come out on has to sit right at it. One cell apart is as close as
     the two can get: a counter standing *on* its entry cell turns for home on
     its next move, so start = entry would take a counter from the yard to home
     in two moves without it ever travelling the ring. */
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
        // Outside the band entirely — a yard drawn across the track buries that
        // colour's entry and start cells, the two it most needs to see.
        expect(r - TOKEN_PCT / 2).toBeGreaterThan(RING_OUTER);
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
    // each yard spans less than a third of the disc, so three of them fit
    expect(BASE_ARC_DEG * 2).toBeLessThan(120);
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
    expect(trackCellSpec(15).rot).toBeCloseTo(120 + STEP_DEG, 6);
    expect(trackCellSpec(29).rot).toBeCloseTo(240 + STEP_DEG, 6);
  });

  it('is three-fold symmetric about the centre', () => {
    for (let n = 1; n <= 14; n++) {
      const r = fromCentre(TRACK_XY[n]);
      expect(fromCentre(TRACK_XY[n + 14])).toBeCloseTo(r, 6);
      expect(fromCentre(TRACK_XY[n + 28])).toBeCloseTo(r, 6);
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

  it('wraps across the seam (40 → 2)', () => {
    const path = computeMovePath('track-40', 'track-2', 'green');
    expect(path).toEqual([TRACK_XY[41], TRACK_XY[42], TRACK_XY[1], TRACK_XY[2]]);
  });

  it('takes the shorter backward route for knockbacks', () => {
    const path = computeMovePath('track-5', 'track-2', 'green');
    expect(path).toEqual([TRACK_XY[4], TRACK_XY[3], TRACK_XY[2]]);
  });

  /* Derived from ENTRY_CELLS rather than spelled out, so moving the turn for
     home cannot leave this test quietly asserting the old board. */
  it('enters the spoke through the entry cell', () => {
    const entry = ENTRY_CELLS.red;
    const path = computeMovePath('track-39', 'final-2', 'red');
    const ringLeg = [];
    for (let t = 40; t !== (entry % TRACK_SIZE) + 1; t = (t % TRACK_SIZE) + 1) {
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
