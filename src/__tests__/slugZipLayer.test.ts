import { describe, expect, it } from 'vitest';
import { cableAt, cableLength, cableSlope, chainAlong, kickChain, stepChain } from '../components/slugs/slugZipLayer';
import type { Chain } from '../components/slugs/slugZipLayer';
import { H, ONE, W, zipPoint } from '../slugsGameLogic';
import type { Zip } from '../slugsGameLogic';

const zip = (over: Partial<Zip> = {}): Zip => ({ id: 0, ax: 690, ay: 376, bx: 1014, by: 376, sag: 12, cut: -1, down: 0, left: -50, ...over });
const empty = () => new Uint8Array(W * H);

/** Steps until the chain has rested STILL_STEPS steps running, or `most`; returns the steps taken. */
function settle(c: Chain, t: Uint8Array, most = 3000) {
  let k = 0;
  for (; k < most && c.still < 50; k++) stepChain(c, t);
  return k;
}

const linkLengths = (c: Chain) =>
  Array.from({ length: c.xs.length - 1 }, (_, i) => Math.hypot(c.xs[i + 1] - c.xs[i], c.ys[i + 1] - c.ys[i]));

describe('the cable drawn where the rules hang it', () => {
  it("follows the rules' zipPoint, a level cable and a sloping one", () => {
    for (const z of [zip(), zip({ by: 330, bx: 900, sag: 8 })]) {
      for (const u of [0, 0.1, 0.37, 0.5, 0.9, 1]) {
        const want = zipPoint(z, Math.round(u * ONE));
        const got = cableAt(z, u);
        expect(Math.abs(got.x - want.x / ONE)).toBeLessThan(0.01);
        expect(Math.abs(got.y - want.y / ONE)).toBeLessThan(0.01);
      }
    }
    expect(cableAt(zip(), 0.5).y).toBe(376 + 12);
  });

  it('slopes down into the dip from the left post, is level at the bottom, and climbs out', () => {
    expect(cableSlope(zip(), 0)).toBeCloseTo(Math.atan(48 / 324), 6);
    expect(cableSlope(zip(), 0.5)).toBe(0);
    expect(cableSlope(zip(), 1)).toBeCloseTo(-Math.atan(48 / 324), 6);
  });

  it('is longer than the span by its sag', () => {
    const len = cableLength(zip(), 0, 1);
    // A parabola of span 324 and sag 12 is 324 + 8·12²/(3·324) ≈ 325.19 long.
    expect(len).toBeGreaterThan(325);
    expect(len).toBeLessThan(325.3);
    expect(cableLength(zip(), 1, 0.5)).toBeCloseTo(len / 2, 2);
  });
});

describe('a cut cable', () => {
  it('starts as the length of cable it was, from the post to the cut', () => {
    const z = zip();
    const c = chainAlong(z, 1, 0.4, true);
    expect(c.xs[0]).toBe(1014);
    expect(c.ys[0]).toBe(376);
    const end = cableAt(z, 0.4);
    expect(c.xs[c.xs.length - 1]).toBeCloseTo(end.x, 6);
    expect(c.ys[c.ys.length - 1]).toBeCloseTo(end.y, 6);
    const total = linkLengths(c).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(cableLength(z, 0.4, 1), 1);
    expect(c.link).toBeGreaterThan(5);
    expect(c.link).toBeLessThan(7);
  });

  it('swings down to hang straight below its post, at its own length, and then rests', () => {
    const c = chainAlong(zip(), 0, 0.5, true);
    const len = cableLength(zip(), 0, 0.5);
    const steps = settle(c, empty());
    expect(steps).toBeLessThan(3000);
    const n = c.xs.length - 1;
    expect(c.xs[0]).toBe(690);
    expect(c.ys[0]).toBe(376);
    expect(Math.abs(c.xs[n] - 690)).toBeLessThan(1.5);
    // Within 2% of its length: the links stretch under their own weight, but not so a player could see.
    expect(c.ys[n] - 376).toBeGreaterThan(len * 0.98);
    expect(c.ys[n] - 376).toBeLessThan(len * 1.02);
    for (const l of linkLengths(c)) expect(Math.abs(l - c.link)).toBeLessThan(c.link * 0.05);
  });

  it('comes to rest on the ground under it, never inside it', () => {
    const t = empty();
    const floor = 420;
    for (let x = 0; x < W; x++) for (let y = floor; y < H; y++) t[y * W + x] = 1;
    const c = chainAlong(zip(), 0, 0.5, true);
    settle(c, t);
    let low = 0;
    for (let i = 0; i < c.xs.length; i++) {
      expect(t[Math.round(c.ys[i]) * W + Math.round(c.xs[i])]).toBe(0);
      low = Math.max(low, c.ys[i]);
    }
    // 160 px of cable from 44 px up: it reaches the ground and lies along it.
    expect(low).toBeGreaterThan(floor - 2);
    const lying = Array.from(c.ys).filter((y) => y > floor - 2).length;
    expect(lying).toBeGreaterThan(c.xs.length / 2);
  });

  it('thrown at a wall, stops against it and never goes into it', () => {
    const c = chainAlong(zip(), 0, 0.5, false);
    const right = Math.ceil(Math.max(...c.xs));
    const t = empty();
    for (let y = 0; y < H; y++) for (let x = right + 3; x < W; x++) t[y * W + x] = 1;
    // Moving right at 6 px a tick, three times what the gap allows in a step.
    for (let i = 0; i < c.xs.length; i++) c.ox[i] = c.xs[i] - 6;
    let nearest = 0;
    for (let k = 0; k < 60; k++) {
      stepChain(c, t);
      for (let i = 0; i < c.xs.length; i++) expect(t[Math.round(c.ys[i]) * W + Math.round(c.xs[i])], `step ${k}, point ${i}`).toBe(0);
      nearest = Math.max(nearest, ...c.xs);
    }
    // It got to the wall: the land starts 3 px past where it set off, and a point rounds into it from half a px short.
    expect(nearest).toBeGreaterThan(right + 1.5);
  });

  it('let go at both ends, falls as everything does', () => {
    const c = chainAlong(zip(), 0, 0.5, false);
    const before = Array.from(c.ys);
    for (let k = 0; k < 40; k++) stepChain(c, empty());
    // From rest, 40 ticks of the rules' gravity (0.24 px a tick a tick) is about 190 px, a little less for the damping.
    for (let i = 0; i < c.ys.length; i++) {
      expect(c.ys[i] - before[i]).toBeGreaterThan(150);
      expect(c.ys[i] - before[i]).toBeLessThan(200);
    }
  });

  it('is swung away from a blast near it, and only near it', () => {
    const hang = () => {
      const c = chainAlong(zip(), 0, 0.5, true);
      settle(c, empty());
      return c;
    };
    const calm = hang();
    const hit = hang();
    const n = calm.xs.length - 1;
    // A blast just right of the hanging end.
    kickChain(hit, calm.xs[n] + 20, calm.ys[n], 30);
    expect(hit.still).toBe(0);
    stepChain(calm, empty());
    stepChain(hit, empty());
    expect(hit.xs[n]).toBeLessThan(calm.xs[n] - 0.5);
    expect(hit.xs[0]).toBe(690);
    // The top links, 150 px above, are beyond its reach.
    expect(Math.abs(hit.xs[1] - calm.xs[1])).toBeLessThan(0.05);
  });
});
