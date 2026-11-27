import { describe, expect, it } from 'vitest';
import { MOTES_AT_FULL, MOTE_SPEED, drawMotes, easeWind, moteCount, stepMotes } from '../components/slugs/slugWind';
import type { Mote, MotePen } from '../components/slugs/slugWind';

const view = { x0: 0, y0: 0, x1: 1000, y1: 500 };

/** A fixed run of numbers in [0, 1), so where a mote is put can be checked. */
function seq(...values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

const mote = (x: number, y: number, age = 1): Mote => ({ x, y, pace: 1, phase: 0, age });

function pen() {
  const lines: number[][] = [];
  const styles: number[][] = [];
  let clears = 0;
  const p: MotePen = {
    clear: () => clears++,
    lineStyle: (w, c, a) => styles.push([w, c, a ?? 1]),
    lineBetween: (...xy) => lines.push(xy),
  };
  return { p, lines, styles, clears: () => clears };
}

describe('easeWind', () => {
  it('moves towards the new step without reaching it at once, and settles on it', () => {
    const once = easeWind(0, 10, 100);
    expect(once).toBeGreaterThan(0.5);
    expect(once).toBeLessThan(1.5);
    let w = 0;
    for (let i = 0; i < 1000; i++) w = easeWind(w, -6, 16);
    expect(w).toBeCloseTo(-6, 3);
  });
});

describe('moteCount', () => {
  it('has none in a calm, more the stronger it blows either way, and no more past full', () => {
    expect(moteCount(0)).toBe(0);
    expect(moteCount(5)).toBe(MOTES_AT_FULL / 2);
    expect(moteCount(-5)).toBe(MOTES_AT_FULL / 2);
    expect(moteCount(10)).toBe(MOTES_AT_FULL);
    expect(moteCount(15)).toBe(MOTES_AT_FULL);
  });
});

describe('stepMotes', () => {
  it('carries motes downwind at the wind speed', () => {
    const ms = Array.from({ length: moteCount(4) }, (_, i) => mote(100 + i, 200));
    stepMotes(ms, 4, view, 1000, seq(0.5));
    expect(ms[0].x).toBeCloseTo(100 + 4 * MOTE_SPEED, 6);
    const back = Array.from({ length: moteCount(-4) }, () => mote(500, 200));
    stepMotes(back, -4, view, 500, seq(0.5));
    expect(back[0].x).toBeCloseTo(500 - 2 * MOTE_SPEED, 6);
  });

  it('adds motes as the wind gets up and drops them as it falls', () => {
    const ms: Mote[] = [];
    stepMotes(ms, 10, view, 16, seq(0.3));
    expect(ms.length).toBe(MOTES_AT_FULL);
    stepMotes(ms, 2, view, 16, seq(0.3));
    expect(ms.length).toBe(moteCount(2));
    stepMotes(ms, 0, view, 16, seq(0.3));
    expect(ms.length).toBe(0);
  });

  it('brings one blown out of the downwind side back in at the upwind side', () => {
    const right = Array.from({ length: moteCount(5) }, () => mote(500, 200));
    right[0] = mote(1011, 200);
    stepMotes(right, 5, view, 100, seq(0.5));
    expect(right[0].x).toBeLessThan(view.x0);
    expect(right[0].age).toBe(0);
    const left = Array.from({ length: moteCount(-5) }, () => mote(500, 200));
    left[0] = mote(-11, 200);
    stepMotes(left, -5, view, 100, seq(0.5));
    expect(left[0].x).toBeGreaterThan(view.x1);
  });

  it('puts one the view has moved away from back anywhere in the view', () => {
    const ms = Array.from({ length: moteCount(3) }, () => mote(500, 200));
    ms[0] = mote(500, 900);
    ms[1] = mote(-400, 200);
    stepMotes(ms, 3, view, 16, seq(0.25));
    expect(ms[0]).toMatchObject({ x: 250, y: 125, age: 0 });
    expect(ms[1]).toMatchObject({ x: 250, y: 125, age: 0 });
    expect(ms[2].x).toBeGreaterThan(500);
  });
});

describe('drawMotes', () => {
  it('draws each as a dash trailing upwind of it, longer in a stronger wind', () => {
    const light = pen();
    drawMotes(light.p, [mote(100, 50)], 2, 0xabcdef, 1, () => true);
    const strong = pen();
    drawMotes(strong.p, [mote(100, 50)], 10, 0xabcdef, 1, () => true);
    const [x1, , x2] = light.lines[0];
    expect(x1).toBe(100);
    expect(x2).toBeLessThan(100);
    expect(100 - strong.lines[0][2]).toBeGreaterThan(100 - x2);
    const against = pen();
    drawMotes(against.p, [mote(100, 50)], -2, 0xabcdef, 1, () => true);
    expect(against.lines[0][2]).toBe(100 + (100 - x2));
    expect(light.styles[0][1]).toBe(0xabcdef);
  });

  it('keeps a dash its size on screen at any zoom', () => {
    const near = pen();
    drawMotes(near.p, [mote(100, 50)], 6, 0, 1, () => true);
    const far = pen();
    drawMotes(far.p, [mote(100, 50)], 6, 0, 4, () => true);
    expect(100 - far.lines[0][2]).toBeCloseTo(4 * (100 - near.lines[0][2]), 6);
    expect(far.styles[0][0]).toBe(4 * near.styles[0][0]);
  });

  it('fades a new mote in, and skips one inside the land', () => {
    const d = pen();
    drawMotes(d.p, [mote(100, 50, 0), mote(200, 50, 0.25), mote(300, 50, 2), mote(400, 50, 2)], 5, 0, 1, (x) => x !== 400);
    expect(d.clears()).toBe(1);
    expect(d.lines.length).toBe(2);
    expect(d.lines.map((l) => l[0])).toEqual([200, 300]);
    expect(d.styles[0][2]).toBeLessThan(d.styles[1][2]);
  });
});
