import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  contrast,
  drawWaterInto,
  fbm,
  layerTones,
  paintBackground,
  sampleLine,
  skyDrift,
  waterLook,
  type WaterPen,
  type WaterView,
} from '../components/slugs/slugBackdrop';
import { THEME_IDS, THEMES } from '../components/slugs/slugThemes';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as unknown as readonly [number, number, number];

/**
 * jsdom has no 2D canvas: each canvas gets a context that records the calls
 * made on it, with their numeric arguments, under that canvas.
 */
const logs = new Map<HTMLCanvasElement, string[]>();

class RecordingPath {
  constructor() {
    return new Proxy(this, { get: () => () => undefined });
  }
}

function useRecordingCanvas() {
  vi.stubGlobal('Path2D', RecordingPath);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const log: string[] = [];
    logs.set(this, log);
    const target: Record<string, unknown> = { canvas: this };
    const gradient = { addColorStop: (...a: unknown[]) => log.push(`stop(${a.join(',')})`) };
    return new Proxy(target, {
      get(_, key: string) {
        if (key in target) return target[key];
        if (key === 'createImageData') {
          return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        }
        return (...args: unknown[]) => {
          log.push(`${key}(${args.filter((a) => typeof a === 'number').map((a) => (a as number).toFixed(2)).join(',')})`);
          return key.startsWith('create') ? gradient : undefined;
        };
      },
      set(_, key: string, value) {
        target[key] = value;
        log.push(`${key}=${typeof value === 'object' ? 'gradient' : String(value)}`);
        return true;
      },
    }) as unknown as RenderingContext;
  } as typeof HTMLCanvasElement.prototype.getContext);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  logs.clear();
});

describe('paintBackground', () => {
  it('paints sky, far, middle and near at the size asked for, every layer drawn on, for every theme', () => {
    useRecordingCanvas();
    for (const theme of THEME_IDS) {
      const layers = paintBackground(theme, 640, 360);
      expect(layers.map((c) => [c.width, c.height]), theme).toEqual([[640, 360], [640, 360], [640, 360], [640, 360]]);
      for (const [i, c] of layers.entries()) {
        const fills = (logs.get(c) ?? []).filter((l) => /^fill(Rect)?\(/.test(l)).length;
        expect(fills, `${theme} layer ${i}`).toBeGreaterThan(0);
      }
    }
  });

  it('paints an upright phone view as a landscape scene set on its horizon, not stretched to the height', () => {
    useRecordingCanvas();
    for (const theme of THEME_IDS) {
      const layers = paintBackground(theme, 360, 780);
      expect(layers.map((c) => [c.width, c.height]), theme).toEqual([[360, 780], [360, 780], [360, 780], [360, 780]]);
      // Painted 270 high (three quarters of the width), set 0.68 × (780 - 270) = 347 down so the horizons meet.
      for (const c of layers.slice(1)) expect(logs.get(c), theme).toContain('drawImage(0.00,347.00)');
    }
    const wide = paintBackground('tropical', 640, 360);
    for (const c of wide.slice(1)) expect(logs.get(c) ?? []).not.toContain('drawImage(0.00,347.00)');
  });

  it('backs a cave with its own far rock, so lowering the layers never uncovers a sky', () => {
    useRecordingCanvas();
    for (const [w, h] of [[640, 360], [360, 780]]) {
      const cave = paintBackground('caves', w, h);
      expect(logs.get(cave[0]), `${w}x${h}`).toContain(`drawImage(0.00,0.00,${w}.00,1.00,0.00,0.00,${w}.00,${h}.00)`);
    }
    for (const theme of THEME_IDS.filter((t) => THEMES[t].horizon !== 'cave')) {
      expect((logs.get(paintBackground(theme, 640, 360)[0]) ?? []).filter((l) => l.startsWith('drawImage(0.00,0.00,640.00,1.00')), theme).toEqual([]);
    }
  });

  it('is the same picture for the same seed and a different one for another seed', () => {
    useRecordingCanvas();
    const drawn = (seed: number) => paintBackground('snow', 400, 240, seed).map((c) => (logs.get(c) ?? []).join(';'));
    const a = drawn(7);
    expect(drawn(7)).toEqual(a);
    const b = drawn(8);
    expect(b[1]).not.toBe(a[1]);
    expect(b[3]).not.toBe(a[3]);
  });
});

describe('aerial perspective', () => {
  it('sets each skyline layer further into the haze than the one in front of it', () => {
    for (const theme of THEME_IDS) {
      const haze = rgb(THEMES[theme].haze);
      const [far, mid, near] = layerTones(theme).map((t) => contrast(t.body, haze));
      expect(far, theme).toBeLessThan(mid);
      expect(mid, theme).toBeLessThan(near);
    }
  });

  it('keeps the far layer within a soft step of the haze so it never competes with the land', () => {
    for (const theme of THEME_IDS) {
      expect(contrast(layerTones(theme)[0].body, rgb(THEMES[theme].haze)), theme).toBeLessThan(2);
    }
  });
});

describe('noise and skylines', () => {
  it('fbm stays in [0, 1], repeats every width, and changes with the seed', () => {
    let differs = false;
    for (let x = 0; x < 500; x += 7) {
      const v = fbm(x, 500, 6, 4, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(fbm(x + 500, 500, 6, 4, 3)).toBeCloseTo(v, 9);
      expect(fbm(x, 500, 6, 4, 3, true)).toBeGreaterThanOrEqual(0);
      if (Math.abs(fbm(x, 500, 6, 4, 4) - v) > 0.01) differs = true;
    }
    expect(differs).toBe(true);
  });

  it('sampleLine closes the loop so the tiled layer has no seam', () => {
    const l = sampleLine(800, (x) => 100 + x * 0.1);
    expect(l.ys.length).toBe(201);
    expect(l.step).toBe(4);
    expect(l.ys[200]).toBe(l.ys[0]);
    expect(l.ys[100]).toBeCloseTo(140, 4);
  });

  it('drifts clouds only where the theme has clouds', () => {
    expect(skyDrift('caves')).toBe(0);
    expect(skyDrift('tropical')).toBeGreaterThan(0);
  });
});

describe('drawWaterInto', () => {
  function pen() {
    const calls: { name: string; args: number[] }[] = [];
    const p = new Proxy({} as WaterPen, {
      get: (_, name: string) => (...args: number[]) => calls.push({ name, args }),
    });
    return { p, calls, count: (n: string) => calls.filter((c) => c.name === n).length };
  }
  const view = (lean: boolean): WaterView => ({ level: 600, x0: 0, x1: 1200, bottom: 1500, now: 1234, lean });

  function drawn(lean: boolean) {
    const back = pen();
    const front = pen();
    drawWaterInto(back.p, front.p, waterLook('tropical'), view(lean));
    return { back, front };
  }

  /** How far down the front water's flat fills reach. */
  const reach = (calls: { name: string; args: number[] }[]) =>
    Math.max(...calls.filter((c) => c.name === 'fillRect').map((c) => c.args[1] + c.args[3]));

  it('in full: a smooth deepening, an opaque body to the bottom, soft patches and a crest line', () => {
    const { back, front } = drawn(false);
    expect(back.count('fillPath')).toBe(1);
    expect(front.count('fillGradientStyle')).toBe(1);
    expect(front.count('fillRect')).toBe(2);
    expect(front.count('fillEllipse')).toBeGreaterThan(0);
    expect(front.count('strokePath')).toBe(1);
    expect(reach(front.calls)).toBe(1500);
  });

  it('is opaque from a few px under the crest to the bottom', () => {
    const { front } = drawn(false);
    const fills = front.calls.filter((c) => c.name === 'fillRect');
    const gradient = front.calls.find((c) => c.name === 'fillGradientStyle')!;
    expect(gradient.args[4]).toBe(1);
    const flat = front.calls[front.calls.findIndex((c) => c === fills[1]) - 1];
    expect(flat.name).toBe('fillStyle');
    expect(flat.args[1]).toBe(1);
    // The two fills meet with no gap, starting no more than 4 px under the water line.
    expect(fills[0].args[1]).toBeLessThanOrEqual(604);
    expect(fills[0].args[1] + fills[0].args[3]).toBe(fills[1].args[1]);
  });

  it('deepens from the surface colour to the deep one', () => {
    const look = waterLook('tropical');
    const { front } = drawn(false);
    const g = front.calls.find((c) => c.name === 'fillGradientStyle')!.args;
    expect(g.slice(0, 4)).toEqual([look.surface, look.surface, look.deep, look.deep]);
    expect(look.surface).not.toBe(look.deep);
  });

  it('lean: half the wave points, no patches, no crest, and still reaches the bottom', () => {
    const full = drawn(false);
    const lean = drawn(true);
    expect(lean.front.count('strokePath')).toBe(0);
    expect(lean.front.count('fillEllipse')).toBe(0);
    expect(lean.back.count('lineTo')).toBeLessThan(full.back.count('lineTo') * 0.55);
    expect(lean.front.count('lineTo')).toBeLessThan(full.front.count('lineTo') * 0.3);
    expect(reach(lean.front.calls)).toBe(1500);
  });

  it('keeps its light patches in place in the world as the view pans', () => {
    const at = (x0: number) => {
      const front = pen();
      drawWaterInto(pen().p, front.p, waterLook('tropical'), { ...view(false), x0, x1: x0 + 1200 });
      return front.calls.filter((c) => c.name === 'fillEllipse').map((c) => `${c.args[0].toFixed(3)},${c.args[1].toFixed(3)}`);
    };
    const a = new Set(at(0));
    const b = at(300);
    expect(b.filter((p) => a.has(p)).length).toBeGreaterThan(10);
  });

  it('keeps the lit surface band above where the water starts to deepen, whatever the swell', () => {
    for (let now = 0; now < 20000; now += 997) {
      const front = pen();
      drawWaterInto(pen().p, front.p, waterLook('coast'), { ...view(false), now });
      const wave = front.calls.filter((c) => c.name === 'lineTo').map((c) => c.args[1]);
      const band = front.calls.filter((c) => c.name === 'fillRect')[0].args[1];
      expect(Math.max(...wave)).toBeLessThanOrEqual(band);
    }
  });
});
