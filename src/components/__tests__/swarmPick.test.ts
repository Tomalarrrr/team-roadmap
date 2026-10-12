// The board's press and drag resolution.
//
// What has to hold: a finger's reach grows as the board shrinks, the nearest
// of two candidates wins and a press near nothing means nothing, and an arrow
// that has found a hut does not flick to its neighbour on a wobble.

import { describe, it, expect } from 'vitest';
import { MAGNET, MIN_TARGET_PX, latch, nearest, reachOf } from '../swarm/swarmPick';

// Two huts as close as the map ever puts them.
const SITES = [
  { x: 300, y: 300 },
  { x: 450, y: 300 },
];

describe('reachOf', () => {
  it('is half a 44px target in world units, at the size the board is drawn', () => {
    expect(MIN_TARGET_PX).toBe(44);
    expect(reachOf(1000)).toBe(22);
    expect(reachOf(500)).toBe(44);
    expect(reachOf(250)).toBe(88);
  });
});

describe('nearest', () => {
  it('takes the nearer of two points that are both in reach', () => {
    expect(nearest(SITES, 370, 300, 100, null)).toBe(0);
    expect(nearest(SITES, 380, 300, 100, null)).toBe(1);
  });

  it('counts a press at exactly the reach and not one past it', () => {
    expect(nearest(SITES, 322, 300, 22, null)).toBe(0);
    expect(nearest(SITES, 322.5, 300, 22, null)).toBe(null);
  });

  it('never answers with the skipped point, however near', () => {
    expect(nearest(SITES, 300, 300, 22, 0)).toBe(null);
    expect(nearest(SITES, 370, 300, 100, 0)).toBe(1);
  });
});

describe('latch', () => {
  const aim = (held: number | null, x: number, over: number | null = null, reach = 22, skip: number | null = null) =>
    latch(SITES, held, over, x, 300, reach, skip);

  it('jumps to a hut inside the magnet and to nothing outside it', () => {
    expect(aim(null, 450 - MAGNET)).toBe(1);
    expect(aim(null, 450 - MAGNET - 1)).toBe(null);
  });

  it('takes the hut whose picture is under the pointer even outside the magnet', () => {
    expect(latch(SITES, null, 1, 450, 300 - MAGNET - 20, 22, null)).toBe(1);
  });

  it('keeps the hut it has past the magnet, and lets go past the release', () => {
    expect(aim(1, 450 - MAGNET - 20, null, 22, 0)).toBe(1);
    expect(aim(1, 450 - MAGNET * 1.35 - 1, null, 22, 0)).toBe(null);
  });

  it('does not change hands across the midline between two neighbours', () => {
    // 375 is the midline. From either side, a few units over it changes nothing.
    expect(aim(0, 380)).toBe(0);
    expect(aim(1, 370)).toBe(1);
    // The same two pointers with no memory would have answered the other way.
    expect(aim(null, 380)).toBe(1);
    expect(aim(null, 370)).toBe(0);
  });

  it('changes hands once the neighbour is clearly nearer', () => {
    // 0.7 of the way: 150 * 0.7 / 1.7 = 61.8 units from the neighbour.
    expect(aim(0, 450 - 62)).toBe(0);
    expect(aim(0, 450 - 61)).toBe(1);
  });

  it('widens the magnet to a finger on a small board', () => {
    expect(aim(null, 450 - 85, null, 88, 0)).toBe(1);
    expect(aim(null, 450 - 85, null, 22, 0)).toBe(null);
  });

  it('never aims a lone source at itself', () => {
    expect(aim(null, 300, 0, 22, 0)).toBe(null);
    expect(aim(null, 370, 0, 22, 0)).toBe(null);
    expect(aim(null, 381, 0, 22, 0)).toBe(1);
    // A drag whose other sources fell while it was aimed at this one.
    expect(aim(0, 310, 0, 22, 0)).toBe(null);
  });
});
