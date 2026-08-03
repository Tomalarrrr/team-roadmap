// The board's press resolution.
//
// A counter is 4.1% of the board — under 30px at any realistic popup size, and
// breathing up and down under the finger. Sized as a plain box the target
// cannot be grown past about 1.4× the piece, because the ring puts neighbouring
// cell centres only 5.86% apart and the boxes would start stealing each other's
// presses. Picking the *nearest* playable counter instead removes that ceiling
// and puts the boundary between two neighbours exactly halfway between them.
//
// These are the two properties that has to have: the nearest one wins, and a
// press that is not near anything does nothing at all.

import { describe, it, expect } from 'vitest';
import { pickNearestToken, HIT_RADIUS_FACTOR } from '../ludo2/ludo2HitTest';

const W = 30; // a counter's rendered width, near enough to the real thing
const RADIUS = W * HIT_RADIUS_FACTOR;

/** A stand-in for the board, holding counters at the given screen centres. */
function board(centres: Record<number, [number, number]>): HTMLElement {
  const nodes = Object.entries(centres).map(([idx, [cx, cy]]) => ({
    dataset: { token: idx },
    getBoundingClientRect: () => ({
      left: cx - W / 2, top: cy - W / 2, width: W, height: W,
    }),
  }));
  return { querySelectorAll: () => nodes } as unknown as HTMLElement;
}

describe('pickNearestToken', () => {
  it('answers a press dead on a counter with that counter', () => {
    expect(pickNearestToken(board({ 4: [100, 100] }), 100, 100)).toBe(4);
  });

  it('reaches well past the edge of the piece', () => {
    // The whole point: a press this far out missed entirely before.
    const b = board({ 4: [100, 100] });
    expect(pickNearestToken(b, 100 + W * 0.7, 100)).toBe(4);
    expect(pickNearestToken(b, 100, 100 - W * 0.8)).toBe(4);
  });

  it('ignores a press that is near nothing', () => {
    // Or the catchment would reach across the board, and a move cannot be
    // taken back.
    expect(pickNearestToken(board({ 4: [100, 100] }), 100 + RADIUS + 2, 100)).toBeNull();
  });

  it('splits two neighbours exactly halfway between them', () => {
    // Neighbouring ring cells are about 1.4 counter-widths apart, so their
    // catchments overlap — which is fine precisely because of this.
    const b = board({ 0: [100, 100], 1: [100 + W * 1.4, 100] });
    expect(pickNearestToken(b, 100 + W * 0.6, 100)).toBe(0);
    expect(pickNearestToken(b, 100 + W * 0.8, 100)).toBe(1);
  });

  it('picks the nearer of a whole yard stacked along an arc', () => {
    // Five bays, and the press is nearest the fourth.
    const b = board(Object.fromEntries(
      [0, 1, 2, 3, 4].map(i => [i, [100 + i * W * 1.45, 200] as [number, number]]),
    ));
    expect(pickNearestToken(b, 100 + 3 * W * 1.45 + 4, 200)).toBe(3);
  });

  it('does nothing when no counter is playable', () => {
    expect(pickNearestToken(board({}), 100, 100)).toBeNull();
  });

  it('measures the catchment against the counter it picked, not the last one', () => {
    // A press just inside the near counter's own radius, with a much larger
    // counter listed after it. Judged against the wrong piece's width this
    // reads as a hit on nothing (or a hit from far too far away).
    const nodes = [
      { dataset: { token: '1' }, getBoundingClientRect: () => ({ left: 100 - W / 2, top: 100 - W / 2, width: W, height: W }) },
      { dataset: { token: '2' }, getBoundingClientRect: () => ({ left: 900, top: 900, width: W * 4, height: W * 4 }) },
    ];
    const b = { querySelectorAll: () => nodes } as unknown as HTMLElement;
    expect(pickNearestToken(b, 100 + RADIUS - 1, 100)).toBe(1);
    expect(pickNearestToken(b, 100 + RADIUS + 2, 100)).toBeNull();
  });
});
