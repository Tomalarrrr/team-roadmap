import { describe, it, expect } from 'vitest';
import {
  ONE,
  SLUG_HALF_H,
  W,
  ZIP_HANG,
  advance,
  carve,
  cloneState,
  explode,
  newGame,
  px,
  stringZips,
  zipLength,
  zipPoint,
  type Input,
  type SlugEvent,
  type SlugsState,
} from '../slugsGameLogic';
import { MAP_DESIGN_IDS, buildMap } from '../slugsMaps';

const FLOOR = 400;
const LEFT = 1;
const RIGHT = 2;
const FIRE = 16;
const idle: Input = { keys: 0 };

/**
 * Two cliffs, the left one ending at x = 700 and the right one starting at x = 1000, both
 * topped at `rightTop`/FLOOR, with nothing below the gap down to the water. Slug 0's turn is
 * under way and it stands at x = 660 on the left cliff, facing right.
 */
function gorge(rightTop = FLOOR): SlugsState {
  const s = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1);
  s.terrain.fill(0);
  for (let x = 0; x < W; x++) {
    const top = x < 700 ? FLOOR : x >= 1000 ? rightTop : -1;
    if (top >= 0) for (let y = top; y < s.water + 40; y++) s.terrain[y * W + x] = 1;
  }
  s.zips = stringZips(s.terrain, s.water, 1);
  s.ride = null;
  s.objs = [];
  s.projs = [];
  s.activeTeam = 0;
  s.active = 0;
  s.phase = 'turn';
  s.phaseT = 0;
  s.wind = 0;
  stand(s, 0, 660);
  stand(s, 1, 1700, rightTop);
  return s;
}

function stand(s: SlugsState, id: number, x: number, floor = FLOOR): void {
  const slug = s.slugs[id];
  slug.x = x * ONE;
  slug.y = (floor - SLUG_HALF_H) * ONE;
  slug.vx = slug.vy = 0;
  slug.facing = 1;
  slug.mode = 'stand';
}

function run(s: SlugsState, n: number, input: Input = idle): SlugEvent[] {
  const events: SlugEvent[] = [];
  for (let i = 0; i < n; i++) {
    advance(s, input);
    events.push(...s.events);
  }
  return events;
}

/** Advance with `input` until `done` holds, at most `most` ticks; the ticks it took, or -1. */
function until(s: SlugsState, done: (s: SlugsState) => boolean, input: Input = idle, most = 2000): number {
  for (let i = 0; i < most; i++) {
    if (done(s)) return i;
    advance(s, input);
  }
  return done(s) ? most : -1;
}

/** Walk slug 0 right from 660 onto the left post's cable. */
function board(s: SlugsState): void {
  expect(until(s, (q) => q.slugs[0].mode === 'zip', { keys: RIGHT }, 400)).toBeGreaterThan(0);
}

const standing = (s: SlugsState) => s.slugs[0].mode === 'stand';

describe('stringZips', () => {
  it('strings one line across a gorge, its posts on the two lips', () => {
    const s = gorge();
    expect(s.zips).toHaveLength(1);
    const z = s.zips[0];
    // Posts stand on the last standing spots before each edge, their tops 16 px above a slug's centre there.
    expect(z.ax).toBeGreaterThan(680);
    expect(z.ax).toBeLessThan(700);
    expect(z.bx).toBeGreaterThanOrEqual(1000);
    expect(z.bx).toBeLessThan(1020);
    expect(z.ay).toBe(FLOOR - SLUG_HALF_H - ZIP_HANG - 4);
    expect(z.by).toBe(z.ay);
    expect(z.sag).toBe(Math.trunc((z.bx - z.ax) / 25));
    expect(z.cut).toBe(-1);
    expect(z.down).toBe(0);
  });

  it('strings nothing over unbroken ground, nor over a gap too narrow or too steep', () => {
    const flat = new Uint8Array(W * 696);
    flat.fill(1, FLOOR * W);
    expect(stringZips(flat, 626, 1)).toEqual([]);
    // 60 px across: under the shortest span.
    const narrow = new Uint8Array(W * 696);
    for (let y = FLOOR; y < 696; y++) for (let x = 0; x < W; x++) if (x < 700 || x >= 760) narrow[y * W + x] = 1;
    expect(stringZips(narrow, 626, 1)).toEqual([]);
    // The right lip 100 px higher across about 320: steeper than ZIP_TILT. At 80 higher it is strung.
    expect(gorge(FLOOR - 100).zips).toEqual([]);
    expect(gorge(FLOOR - 80).zips).toHaveLength(1);
  });

  it('strings nothing across a trough whose floor is in reach below a rider', () => {
    // Lips at FLOOR with a deep slot under each edge, and between them ground 34 px down.
    const t = new Uint8Array(W * 696);
    for (let x = 0; x < W; x++) {
      const top = x < 700 ? FLOOR : x < 720 ? -1 : x < 980 ? FLOOR + 34 : x < 1000 ? -1 : FLOOR;
      if (top >= 0) for (let y = top; y < 696; y++) t[y * W + x] = 1;
    }
    expect(stringZips(t, 626, 1)).toEqual([]);
    // The same lips with the floor dropped out are strung.
    for (let x = 720; x < 980; x++) for (let y = FLOOR + 34; y < 696; y++) t[y * W + x] = 0;
    expect(stringZips(t, 626, 1)).toHaveLength(1);
  });

  it('is the same for the same land and seed, and on real maps never more than two', () => {
    for (const id of MAP_DESIGN_IDS) {
      const t = buildMap(id, 5);
      const a = stringZips(t, 626, 5);
      expect(stringZips(t.slice(), 626, 5)).toEqual(a);
      expect(a.length).toBeLessThanOrEqual(2);
      for (const z of a) {
        expect(z.bx - z.ax).toBeGreaterThanOrEqual(120);
        expect(z.bx - z.ax).toBeLessThanOrEqual(560);
      }
    }
    // A positive control for the loop above: some designs do get lines.
    expect(stringZips(buildMap('spires', 5), 626, 5).length).toBeGreaterThan(0);
  }, 60000);

  it('is strung by newGame and copied, not shared, by cloneState', () => {
    const s = newGame(3, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1, { map: 'spires' });
    expect(s.zips.length).toBeGreaterThan(0);
    expect(s.zips).toEqual(stringZips(s.terrain, s.water, 3));
    s.ride = { zip: 0, slug: 0, s: ONE, v: 0 };
    const c = cloneState(s);
    c.zips[0].cut = 100;
    c.ride!.s = 5 * ONE;
    expect(s.zips[0].cut).toBe(-1);
    expect(s.ride.s).toBe(ONE);
  });
});

describe('riding a zip line', () => {
  it('catches a slug walking off the post towards the cable and carries it across with the keys held', () => {
    const s = gorge();
    const z = s.zips[0];
    const events: SlugEvent[] = [];
    for (let i = 0; i < 400 && s.slugs[0].mode !== 'zip'; i++) {
      advance(s, { keys: RIGHT });
      events.push(...s.events);
    }
    expect(s.ride).toMatchObject({ zip: 0, slug: 0 });
    expect(events).toContainEqual({ k: 'zip', id: 0, line: 0, on: true });
    // It hangs ZIP_HANG under the cable where its pulley is.
    const p = zipPoint(z, Math.trunc(s.ride!.s / zipLength(z)));
    expect(s.slugs[0].x).toBe(p.x);
    expect(s.slugs[0].y).toBe(p.y + ZIP_HANG * ONE);
    const took = until(s, (q) => q.ride === null, { keys: RIGHT }, 1000);
    expect(took).toBeGreaterThan(0);
    // Pulled hand over hand it crosses 324 px in well under the turn.
    expect(took).toBeLessThan(400);
    expect(until(s, standing, idle, 100)).toBeGreaterThanOrEqual(0);
    expect(px(s.slugs[0].x)).toBe(z.bx);
    expect(px(s.slugs[0].y)).toBe(FLOOR - SLUG_HALF_H);
    expect(s.slugs[0].hp).toBe(100);
  });

  it('runs downhill to the dip on its own, faster than a slug pulls', () => {
    const s = gorge();
    board(s);
    let fastest = 0;
    for (let i = 0; i < 60; i++) {
      advance(s, idle);
      fastest = Math.max(fastest, s.ride!.v);
    }
    // ZIP_CRAWL is 1.5 px a tick; gravity down the sag takes it past that.
    expect(fastest).toBeGreaterThan(1.5 * ONE);
  });

  it('pulls itself up a cable that climbs to a higher lip', () => {
    const s = gorge(FLOOR - 60);
    expect(s.zips).toHaveLength(1);
    const z = s.zips[0];
    expect(z.by).toBe(z.ay - 60);
    board(s);
    expect(until(s, (q) => q.ride === null, { keys: RIGHT }, 1500)).toBeGreaterThan(0);
    expect(until(s, standing, idle, 100)).toBeGreaterThanOrEqual(0);
    expect(px(s.slugs[0].x)).toBe(z.bx);
    expect(px(s.slugs[0].y)).toBe(FLOOR - 60 - SLUG_HALF_H);
  });

  it('left alone at the dip, it slides back and forth and stays on', () => {
    const s = gorge();
    board(s);
    run(s, 300);
    expect(s.slugs[0].mode).toBe('zip');
  });

  it('when the turn runs out, the rider pulls itself to the nearer post and gets off', () => {
    const s = gorge();
    board(s);
    run(s, 30, { keys: RIGHT });
    s.timeLeft = 1;
    const took = until(s, (q) => q.ride === null, idle, 1500);
    expect(took).toBeGreaterThan(0);
    expect(until(s, standing, idle, 100)).toBeGreaterThanOrEqual(0);
    expect([s.zips[0].ax, s.zips[0].bx]).toContain(px(s.slugs[0].x));
  });

  it('jump lets go mid-span, and the slug falls', () => {
    const s = gorge();
    board(s);
    run(s, 40, { keys: RIGHT });
    const x = px(s.slugs[0].x);
    expect(x).toBeGreaterThan(s.zips[0].ax + 20);
    const events = run(s, 1, { keys: 0, act: { t: 'jump' } });
    expect(events).toContainEqual({ k: 'zip', id: 0, line: 0, on: false });
    expect(s.ride).toBeNull();
    expect(s.slugs[0].mode).toBe('air');
    run(s, 20);
    expect(px(s.slugs[0].y)).toBeGreaterThan(FLOOR);
  });

  it('fire with a weapon that cannot be used aloft lets go too', () => {
    const s = gorge();
    board(s);
    run(s, 40, { keys: RIGHT });
    expect(s.weapon).toBe('bazooka');
    advance(s, { keys: 0, act: { t: 'weapon', w: 'jetpack' } });
    expect(s.weapon).toBe('jetpack');
    run(s, 1, { keys: FIRE });
    expect(s.ride).toBeNull();
    expect(s.slugs[0].mode).toBe('air');
  });

  it('a slug falling across the cable catches it and keeps most of its speed along', () => {
    const s = gorge();
    const slug = s.slugs[0];
    slug.x = 820 * ONE;
    slug.y = 320 * ONE;
    slug.vx = 2 * ONE;
    slug.vy = 0;
    slug.mode = 'air';
    expect(until(s, (q) => q.slugs[0].mode !== 'air', idle, 200)).toBeGreaterThan(0);
    expect(slug.mode).toBe('zip');
    expect(s.ride!.v).toBeGreaterThan(ONE);
  });

  it('a slug in the air above the cable, not yet down to it, is not caught', () => {
    const s = gorge();
    const slug = s.slugs[0];
    slug.x = 820 * ONE;
    slug.y = 300 * ONE;
    slug.vx = 2 * ONE;
    slug.vy = -2 * ONE;
    slug.mode = 'air';
    run(s, 5);
    expect(slug.mode).toBe('air');
    expect(px(slug.y)).toBeLessThan(300);
  });

  it('a blown slug, or one that is not the active slug, flies through the cable', () => {
    const s = gorge();
    const slug = s.slugs[0];
    slug.x = 820 * ONE;
    slug.y = 320 * ONE;
    slug.vx = 2 * ONE;
    slug.mode = 'air';
    slug.blown = true;
    run(s, 80);
    expect(s.ride).toBeNull();
    expect(px(slug.y)).toBeGreaterThan(FLOOR);
    const t = gorge();
    const other = t.slugs[1];
    other.x = 820 * ONE;
    other.y = 320 * ONE;
    other.vx = 2 * ONE;
    other.mode = 'air';
    run(t, 80);
    expect(t.ride).toBeNull();
  });

  it('a dropped line is not caught again for a second', () => {
    const s = gorge();
    board(s);
    expect(until(s, (q) => q.ride === null, { keys: RIGHT }, 1000)).toBeGreaterThan(0);
    const z = s.zips[0];
    const leftAt = z.left;
    expect(leftAt).toBe(s.tick);
    until(s, standing, idle, 100);
    // Walking straight back at the post it just left: it turns, and walks past without catching.
    run(s, 4, { keys: LEFT });
    expect(s.slugs[0].mode).not.toBe('zip');
    // Back on the lip once the second is up, walking at the post catches it again.
    stand(s, 0, z.bx + 12);
    s.slugs[0].facing = -1;
    run(s, Math.max(0, leftAt + 50 - s.tick));
    expect(until(s, (q) => q.slugs[0].mode === 'zip', { keys: LEFT }, 200)).toBeGreaterThan(0);
  });
});

describe('cutting a zip line', () => {
  it('a blast across the cable cuts it and drops its rider', () => {
    const s = gorge();
    board(s);
    run(s, 40, { keys: RIGHT });
    const z = s.zips[0];
    const mid = zipPoint(z, ONE / 2);
    s.events = [];
    explode(s, px(mid.x), px(mid.y), 0, 12, 0);
    expect(z.cut).toBeGreaterThan(ONE / 3);
    expect(z.cut).toBeLessThan((2 * ONE) / 3);
    expect(s.events.some((e) => e.k === 'zipcut' && e.line === 0)).toBe(true);
    expect(s.ride).toBeNull();
    expect(s.slugs[0].mode).toBe('air');
  });

  it('a blast that misses the cable leaves it whole', () => {
    const s = gorge();
    const z = s.zips[0];
    const mid = zipPoint(z, ONE / 2);
    explode(s, px(mid.x), px(mid.y) - 40, 0, 12, 0);
    expect(z.cut).toBe(-1);
    expect(z.down).toBe(0);
  });

  it('a cut line catches nobody', () => {
    const s = gorge();
    const z = s.zips[0];
    const mid = zipPoint(z, ONE / 2);
    explode(s, px(mid.x), px(mid.y), 0, 12, 0);
    stand(s, 0, 660);
    run(s, 200, { keys: RIGHT });
    expect(s.ride).toBeNull();
  });

  it('a post whose ground is dug away falls, and the line with it', () => {
    const s = gorge();
    const z = s.zips[0];
    carve(s.terrain, z.ax, z.ay + 24 + 4, 9);
    const events = run(s, 1);
    expect(z.down).toBe(1);
    expect(events).toContainEqual({ k: 'zipcut', line: 0, x: z.ax, y: z.ay });
    run(s, 300, { keys: RIGHT });
    expect(s.ride).toBeNull();
  });
});
