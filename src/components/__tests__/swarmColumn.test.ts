// Where a unit of a marching column is drawn, decided without a canvas.
//
// What has to hold: units that left a door one after the other are never drawn
// on top of each other on the open road; the column uses the whole of its path
// and not two or three lines of it; it is a single file in a doorway and full
// width between; and a unit is not drawn at all while it is inside a hut.

import { describe, it, expect } from 'vitest';
import { RELEASE_TICKS, SPEED } from '../../swarmGameLogic';
import { LANE, fileOf, outOfDoors, spreadAt } from '../swarm/swarmSceneKit';

const SLOTS = Array.from({ length: 120 }, (_, slot) => slot);

describe('fileOf', () => {
  it('keeps every unit inside the column', () => {
    for (const slot of SLOTS) {
      expect(fileOf(slot)).toBeGreaterThanOrEqual(-1);
      expect(fileOf(slot)).toBeLessThan(1);
    }
  });

  it('puts a unit well to one side of the unit that left before it, and clear of the one before that', () => {
    const next = SLOTS.slice(1).map((slot) => Math.abs(fileOf(slot) - fileOf(slot - 1)));
    const second = SLOTS.slice(2).map((slot) => Math.abs(fileOf(slot) - fileOf(slot - 2)));
    expect(Math.min(...next)).toBeGreaterThan(0.76);
    expect(Math.min(...second)).toBeGreaterThan(0.47);
  });

  it('leaves no two units of a road column within a body length of each other', () => {
    const spacing = SPEED[0] * RELEASE_TICKS;
    const half = 7 * LANE.road;
    let nearest = Infinity;
    for (const p of SLOTS) {
      for (const q of SLOTS) {
        if (q <= p) continue;
        nearest = Math.min(nearest, Math.hypot((q - p) * spacing, (fileOf(q) - fileOf(p)) * half));
      }
    }
    expect(nearest).toBeGreaterThan(14);
  });

  it('fills the width of the path instead of walking a few lines of it', () => {
    const lines = new Set(SLOTS.slice(0, 45).map((slot) => Math.floor((fileOf(slot) + 1) * 7.5)));
    expect(lines.size).toBe(15);
  });
});

describe('spreadAt', () => {
  it('is a single file in both doorways and full width on the open road', () => {
    expect(spreadAt(0, 300)).toBe(0);
    expect(spreadAt(300, 300)).toBe(0);
    expect(spreadAt(60, 300)).toBe(1);
    expect(spreadAt(150, 300)).toBe(1);
    expect(spreadAt(240, 300)).toBe(1);
  });

  it('opens steadily out of a door and closes the same way on the next', () => {
    let last = 0;
    for (let d = 1; d <= 60; d++) {
      expect(spreadAt(d, 300)).toBeGreaterThan(last);
      expect(spreadAt(300 - d, 300)).toBeCloseTo(spreadAt(d, 300), 10);
      last = spreadAt(d, 300);
    }
    expect(spreadAt(30, 300)).toBeCloseTo(0.5, 10);
  });

  it('opens fully on a path too short to do it at the usual distance', () => {
    expect(spreadAt(40, 80)).toBe(1);
    expect(spreadAt(20, 80)).toBeCloseTo(0.5, 10);
  });
});

describe('outOfDoors', () => {
  it('hides a unit inside the hut it is leaving and inside the one it has reached', () => {
    expect(outOfDoors(0, 300, 40, 40)).toBe(0);
    expect(outOfDoors(18, 300, 40, 40)).toBe(0);
    expect(outOfDoors(300, 300, 40, 40)).toBe(0);
    expect(outOfDoors(282, 300, 40, 40)).toBe(0);
  });

  it('shows all of it on the road between', () => {
    expect(outOfDoors(28, 300, 40, 40)).toBe(1);
    expect(outOfDoors(150, 300, 40, 40)).toBe(1);
    expect(outOfDoors(272, 300, 40, 40)).toBe(1);
  });

  it('brings it through the doorway by degrees', () => {
    expect(outOfDoors(23, 300, 40, 40)).toBeCloseTo(0.5, 10);
    expect(outOfDoors(277, 300, 40, 40)).toBeCloseTo(0.5, 10);
  });

  it('measures each doorway by its own hut', () => {
    expect(outOfDoors(18, 300, 20, 60)).toBeCloseTo(0.9, 10);
    expect(outOfDoors(282, 300, 20, 60)).toBe(0);
    expect(outOfDoors(268, 300, 20, 60)).toBeCloseTo(0.5, 10);
  });
});
