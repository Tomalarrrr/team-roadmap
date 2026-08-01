import { describe, it, expect } from 'vitest';
import {
  CELL_PCT,
  BASE_SPOT_PCT,
  TRACK_XY,
  FINAL_XY,
  BASE_XY,
  BASE_TRAY,
  BASE_TRAY_SIZE,
  ARM_RECT_SIZE,
  HUB,
  trackCellSpec,
  computeMovePath,
  getTokenCoords,
} from '../ludo2/ludo2Geometry';
import { ARM_ANGLE } from '../ludo2/ludo2Geometry';
import {
  TRACK_SIZE,
  PLAYER_COLORS,
  START_POSITIONS,
  ENTRY_CELLS,
} from '../../ludo2Board';

const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

// Cells are contiguous neighbours at exactly CELL_PCT; the hub hop between arms
// is 1.6 × CELL_PCT by construction. Anything between would mean overlap.
const MAX_STEP = CELL_PCT * 1.62;

function allCells(): [number, number][] {
  const cells: [number, number][] = [];
  for (let t = 1; t <= TRACK_SIZE; t++) cells.push(TRACK_XY[t]);
  for (const color of PLAYER_COLORS) cells.push(...FINAL_XY[color]);
  return cells;
}

describe('ludo2 board geometry', () => {
  it('defines all 42 track cells and 18 final cells inside the container', () => {
    for (const [x, y] of allCells()) {
      expect(x).toBeGreaterThanOrEqual(CELL_PCT / 2);
      expect(x).toBeLessThanOrEqual(100 - CELL_PCT / 2);
      expect(y).toBeGreaterThanOrEqual(CELL_PCT / 2);
      expect(y).toBeLessThanOrEqual(100 - CELL_PCT / 2);
    }
  });

  it('keeps base trays and their sockets inside the container', () => {
    for (const color of PLAYER_COLORS) {
      for (const [x, y] of BASE_XY[color]) {
        expect(x).toBeGreaterThan(2);
        expect(x).toBeLessThan(98);
        expect(y).toBeGreaterThan(0.5);
        expect(y).toBeLessThan(99.5);
      }
      // Each tray is rotated with its arm, so check its four actual corners
      // rather than a bounding circle — the circle is far too pessimistic.
      const tray = BASE_TRAY[color];
      const a = (tray.rot * Math.PI) / 180;
      const hw = BASE_TRAY_SIZE.w / 2;
      const hh = BASE_TRAY_SIZE.h / 2;
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const cx = tray.x + sx * hw * Math.cos(a) - sy * hh * Math.sin(a);
        const cy = tray.y + sx * hw * Math.sin(a) + sy * hh * Math.cos(a);
        expect(cx).toBeGreaterThan(1);
        expect(cx).toBeLessThan(99);
        expect(cy).toBeGreaterThan(1);
        expect(cy).toBeLessThan(99);
      }
    }
  });

  // The whole point of moving the tray beside the start cell: a resting pawn
  // must never sit on top of the track.
  it('keeps base sockets clear of every board cell', () => {
    const clearance = (CELL_PCT + BASE_SPOT_PCT) / 2;
    for (const color of PLAYER_COLORS) {
      for (const spot of BASE_XY[color]) {
        for (const cell of allCells()) {
          expect(dist(spot, cell)).toBeGreaterThan(clearance);
        }
      }
    }
  });

  it('keeps each base tray outside its own arm silhouette', () => {
    for (const color of PLAYER_COLORS) {
      const tray = BASE_TRAY[color];
      const a = (ARM_ANGLE[color] * Math.PI) / 180;
      // Project the tray centre back onto the arm-local lateral axis. The arms
      // radiate from the hub, which is not quite the board centre.
      const dx = (tray.x - HUB.x) * Math.cos(a) + (tray.y - HUB.y) * Math.sin(a);
      const gutter = Math.abs(dx) - BASE_TRAY_SIZE.w / 2 - ARM_RECT_SIZE.w / 2;
      expect(gutter).toBeGreaterThan(0.5);
    }
  });

  it('no two cells overlap (centers at least one cell apart, small tolerance)', () => {
    const cells = allCells();
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        expect(dist(cells[i], cells[j])).toBeGreaterThan(CELL_PCT * 0.98);
      }
    }
  });

  it('consecutive track cells are traversable steps', () => {
    for (let t = 1; t <= TRACK_SIZE; t++) {
      const next = (t % TRACK_SIZE) + 1;
      expect(dist(TRACK_XY[t], TRACK_XY[next])).toBeLessThanOrEqual(MAX_STEP);
    }
  });

  it('entry cells sit one step from each final column', () => {
    for (const color of PLAYER_COLORS) {
      const entry = TRACK_XY[ENTRY_CELLS[color]];
      expect(dist(entry, FINAL_XY[color][0])).toBeLessThanOrEqual(MAX_STEP);
      // Final column itself is contiguous
      for (let f = 0; f < 5; f++) {
        expect(dist(FINAL_XY[color][f], FINAL_XY[color][f + 1])).toBeCloseTo(CELL_PCT, 5);
      }
    }
  });

  it('start cells are adjacent to their base pads', () => {
    for (const color of PLAYER_COLORS) {
      const start = TRACK_XY[START_POSITIONS[color]];
      const nearest = Math.min(...BASE_XY[color].map(b => dist(b, start)));
      expect(nearest).toBeLessThan(CELL_PCT * 3);
    }
  });

  it('cells carry their arm rotation', () => {
    expect(trackCellSpec(1).rot).toBe(0); // red arm
    expect(trackCellSpec(15).rot).toBe(120); // green arm
    expect(trackCellSpec(29).rot).toBe(240); // yellow arm
  });

  it('three-fold symmetry: green/yellow arms are red rotated by 120/240', () => {
    for (let n = 1; n <= 14; n++) {
      const red = TRACK_XY[n];
      const green = TRACK_XY[n + 14];
      const yellow = TRACK_XY[n + 28];
      // Same radial distance from the hub for all three
      const r = Math.hypot(red[0] - HUB.x, red[1] - HUB.y);
      expect(Math.hypot(green[0] - HUB.x, green[1] - HUB.y)).toBeCloseTo(r, 5);
      expect(Math.hypot(yellow[0] - HUB.x, yellow[1] - HUB.y)).toBeCloseTo(r, 5);
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
      expect(dist(prev, wp)).toBeLessThanOrEqual(MAX_STEP);
      prev = wp;
    }
  });

  it('wraps across the seam (40 → 2)', () => {
    const path = computeMovePath('track-40', 'track-2', 'green');
    expect(path.map(p => p)).toEqual([TRACK_XY[41], TRACK_XY[42], TRACK_XY[1], TRACK_XY[2]]);
  });

  it('takes the shorter backward route for knockbacks', () => {
    const path = computeMovePath('track-5', 'track-2', 'green');
    expect(path).toEqual([TRACK_XY[4], TRACK_XY[3], TRACK_XY[2]]);
  });

  it('enters the final corridor through the entry cell', () => {
    const path = computeMovePath('track-39', 'final-2', 'red');
    expect(path).toEqual([
      TRACK_XY[40], TRACK_XY[41],
      FINAL_XY.red[0], FINAL_XY.red[1],
    ]);
  });

  it('deploy path starts at the start cell', () => {
    const path = computeMovePath('base', 'track-15', 'green');
    expect(path).toEqual([TRACK_XY[15]]);
  });
});

describe('getTokenCoords', () => {
  it('gives every token a distinct base spot', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const c = getTokenCoords('base', i);
      expect(c).not.toBeNull();
      seen.add(c!.map(v => v.toFixed(3)).join(','));
    }
    expect(seen.size).toBe(12);
  });

  it('stacks finished tokens inside the hub', () => {
    for (let i = 0; i < 12; i++) {
      const c = getTokenCoords('final-6', i)!;
      expect(Math.hypot(c[0] - HUB.x, c[1] - HUB.y)).toBeLessThan(HUB.r);
    }
  });
});
