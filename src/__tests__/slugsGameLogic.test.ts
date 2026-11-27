import { describe, it, expect } from 'vitest';
import {
  CHARGE_TICKS,
  DEFAULT_OPTIONS,
  GRAVITY,
  H,
  ONE,
  READY_TICKS,
  RETREAT_TICKS,
  SLUG_HALF_H,
  SPEED_CAP,
  STEEL,
  W,
  WATER_START,
  WEAPON,
  WEAPONS,
  advance,
  blastDamage,
  carve,
  cloneState,
  explode,
  fallDamage,
  fits,
  newGame,
  placeSlugs,
  predict,
  px,
  solidAt,
  type Input,
  type SlugEvent,
  type SlugsOptions,
  type SlugsState,
  type WeaponId,
} from '../slugsGameLogic';

const FLOOR = 400;
const idle: Input = { keys: 0 };
const FIRE = 16;
const UP = 4;
const LEFT = 1;
const RIGHT = 2;

/**
 * Two human teams of one slug each on flat ground at y = FLOOR, slug 0 at
 * x = 300 and slug 1 at x = 1500, slug 0's turn under way, no wind.
 */
function lab(options: Partial<SlugsOptions> = {}): SlugsState {
  const s = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1, options);
  s.terrain.fill(0);
  s.terrain.fill(1, FLOOR * W);
  s.objs = [];
  s.projs = [];
  s.activeTeam = 0;
  s.active = 0;
  s.teams[0].last = 0;
  s.phase = 'turn';
  s.phaseT = 0;
  s.wind = 0;
  stand(s, 0, 300);
  stand(s, 1, 1500);
  return s;
}

function stand(s: SlugsState, id: number, x: number, floor = FLOOR): void {
  const slug = s.slugs[id];
  slug.x = x * ONE;
  slug.y = (floor - SLUG_HALF_H) * ONE;
  slug.vx = slug.vy = 0;
  slug.mode = 'stand';
}

/** Advance n ticks with the same input, returning every event. */
function run(s: SlugsState, n: number, input: Input = idle): SlugEvent[] {
  const events: SlugEvent[] = [];
  for (let i = 0; i < n; i++) {
    advance(s, input);
    events.push(...s.events);
  }
  return events;
}

/** Hold fire for `ticks` then let go, which fires a charged weapon at that power. */
function charge(s: SlugsState, ticks: number): SlugEvent[] {
  return [...run(s, ticks, { keys: FIRE }), ...run(s, 1)];
}

function choose(s: SlugsState, w: WeaponId): void {
  advance(s, { keys: 0, act: { t: 'weapon', w } });
  expect(s.weapon).toBe(w);
}

function fnv(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return h;
}

const hashOf = (s: SlugsState) => JSON.stringify({ ...s, terrain: fnv(s.terrain) });

const cpuGame = (seed: number) => newGame(seed, [{ name: 'A', control: 3 }, { name: 'B', control: 3 }], 2);

function playOut(s: SlugsState, most: number, every?: (s: SlugsState) => void): void {
  while (s.phase !== 'over' && s.tick < most) {
    advance(s, idle);
    every?.(s);
  }
}

describe('determinism', () => {
  it('replays a CPU match identically from the same seed, to a winner, inside 200k ticks', () => {
    const a = cpuGame(11);
    const b = cpuGame(11);
    const marks: string[] = [];
    playOut(a, 200_000, (s) => {
      if (s.tick % 500 === 0) marks.push(hashOf(s));
    });
    let k = 0;
    playOut(b, 200_000, (s) => {
      if (s.tick % 500 === 0) expect(hashOf(s)).toBe(marks[k++]);
    });
    expect(a.phase).toBe('over');
    expect(a.winner).not.toBeNull();
    expect(k).toBe(marks.length);
    expect(k).toBeGreaterThan(2);
    expect(hashOf(b)).toBe(hashOf(a));
  }, 60_000);

  it('gives a different match from a different seed', () => {
    const a = cpuGame(11);
    const b = cpuGame(12);
    run(a, 2000);
    run(b, 2000);
    expect(hashOf(a)).not.toBe(hashOf(b));
  });

  it('a clone taken mid-match carries on exactly as the original does', () => {
    const a = cpuGame(5);
    run(a, 3000);
    const b = cloneState(a);
    run(a, 3000);
    run(b, 3000);
    expect(hashOf(b)).toBe(hashOf(a));
  });

  it('a clone shares nothing with the original', () => {
    const a = cpuGame(5);
    const b = cloneState(a);
    b.terrain[0] = 9;
    b.slugs[0].hp = -50;
    b.teams[0].ammo.bazooka = 3;
    b.teams[0].slugs.push(99);
    expect(a.terrain[0]).not.toBe(9);
    expect(a.slugs[0].hp).toBe(100);
    expect(a.teams[0].ammo.bazooka).toBe(-1);
    expect(a.teams[0].slugs).toHaveLength(2);
  });

  it('a 2v2 CPU match finishes for several seeds, the board always settles, and a plan takes under 150 ms', () => {
    const rich = { weapons: 'all', mines: 6, barrels: 4 } as const;
    for (const [seed, options] of [[1, {}], [2, {}], [3, rich], [4, rich], [5, rich]] as const) {
      const s = newGame(seed, [{ name: 'A', control: 3 }, { name: 'B', control: 3 }], 2, options);
      let longestSettle = 0;
      const plans: number[] = [];
      while (s.phase !== 'over' && s.tick < 200_000) {
        const planning = s.plan === null;
        const t0 = performance.now();
        advance(s, idle);
        if (planning && s.plan !== null) plans.push(performance.now() - t0);
        if (s.phase === 'settle') longestSettle = Math.max(longestSettle, s.phaseT);
      }
      expect(plans.length).toBeGreaterThan(2);
      // The median, as one plan can stall behind a busy machine in a full run; a plan ten times slower still fails.
      plans.sort((a, b) => a - b);
      expect(plans[plans.length >> 1]).toBeLessThan(150);
      expect(s.phase).toBe('over');
      expect(s.winner).not.toBeNull();
      expect(longestSettle).toBeGreaterThan(0);
      expect(longestSettle).toBeLessThan(1000);
    }
  }, 60_000);

  it('replays a match with mines, barrels and every weapon identically', () => {
    const rich = (seed: number) => newGame(seed, [{ name: 'A', control: 2 }, { name: 'B', control: 4 }], 3, { weapons: 'all', mines: 8, barrels: 5 });
    const a = rich(21);
    const b = rich(21);
    playOut(a, 200_000);
    playOut(b, 200_000);
    expect(a.phase).toBe('over');
    expect(hashOf(b)).toBe(hashOf(a));
  }, 60_000);
});

describe('explosions', () => {
  it('carves a crater of exactly the blast radius', () => {
    const s = lab();
    explode(s, 800, FLOOR + 60, 50, 48, 0);
    expect(solidAt(s.terrain, 800, FLOOR + 60)).toBe(false);
    expect(solidAt(s.terrain, 800 + 47, FLOOR + 60)).toBe(false);
    expect(solidAt(s.terrain, 800 + 49, FLOOR + 60)).toBe(true);
    expect(solidAt(s.terrain, 800, FLOOR + 60 + 47)).toBe(false);
    expect(solidAt(s.terrain, 800, FLOOR + 60 + 49)).toBe(true);
  });

  it('does full damage at the centre, falling off in a straight line to none at the edge', () => {
    expect(blastDamage(50, 48, 0)).toBe(50);
    expect(blastDamage(50, 48, 24)).toBe(25);
    expect(blastDamage(50, 48, 47)).toBe(2);
    expect(blastDamage(50, 48, 48)).toBe(0);
  });

  it('hurts a slug by its distance from the blast', () => {
    const s = lab();
    // 14 px to the side of slug 1's body (half width 4).
    explode(s, 1500 + 4 + 14, FLOOR - SLUG_HALF_H, 50, 48, 0);
    expect(s.slugs[1].hp).toBe(100 - blastDamage(50, 48, 14));
    expect(s.slugs[0].hp).toBe(100);
  });

  it('throws a slug away from the blast, and up when hit from beside at ground level', () => {
    const s = lab();
    stand(s, 1, 1000);
    explode(s, 1000 - 20, FLOOR - 2, 50, 48, 50);
    expect(s.slugs[1].vx).toBeGreaterThan(0);
    expect(s.slugs[1].vy).toBeLessThan(0);
    expect(s.slugs[1].mode).toBe('air');
    const t = lab();
    stand(t, 1, 1000);
    explode(t, 1000 + 20, FLOOR - 2, 50, 48, 50);
    expect(t.slugs[1].vx).toBeLessThan(0);
  });
});

describe('falling', () => {
  it('fall damage is 67 at the 32 px/frame cap and none at or below 8', () => {
    expect(fallDamage(SPEED_CAP)).toBe(67);
    expect(fallDamage(8 * ONE)).toBe(0);
    expect(fallDamage(8 * ONE + 1)).toBe(1);
    expect(fallDamage(9 * ONE)).toBe(3);
    // The +1 in the formula only shows where (impact - 8 px) * 50 sits just under a multiple of 18 px.
    expect(fallDamage(8 * ONE + 23592)).toBe(2);
  });

  it('a slug landing at the cap loses 67 hp', () => {
    const s = lab();
    const slug = s.slugs[1];
    slug.mode = 'air';
    slug.y = (FLOOR - SLUG_HALF_H - 20) * ONE;
    slug.vy = SPEED_CAP;
    const events = run(s, 1);
    expect(events).toContainEqual({ k: 'fall', id: 1, dmg: 67 });
    expect(slug.hp).toBe(33);
    expect(slug.mode).toBe('stand');
  });

  it('the first landing after a blast does not hurt, the next one does', () => {
    const s = lab();
    const slug = s.slugs[1];
    slug.mode = 'air';
    slug.blown = true;
    slug.y = (FLOOR - SLUG_HALF_H - 20) * ONE;
    slug.vy = SPEED_CAP;
    run(s, 1);
    expect(slug.hp).toBe(100);
    slug.mode = 'air';
    slug.y = (FLOOR - SLUG_HALF_H - 20) * ONE;
    slug.vy = SPEED_CAP;
    run(s, 1);
    expect(slug.hp).toBe(33);
  });

  it('a slug whose ground is blown away falls', () => {
    const s = lab();
    carve(s.terrain, 1500, FLOOR, 30);
    run(s, 1);
    expect(s.slugs[1].mode).toBe('air');
    run(s, 80);
    expect(s.slugs[1].mode).toBe('stand');
    expect(px(s.slugs[1].y)).toBeGreaterThan(FLOOR - SLUG_HALF_H + 20);
    expect(s.slugs[1].hp).toBe(100);
  });

  it('a slug below the water line drowns', () => {
    const s = lab();
    const slug = s.slugs[1];
    slug.mode = 'air';
    slug.y = (s.water - 4) * ONE;
    const events = run(s, 1);
    expect(slug.alive).toBe(false);
    expect(slug.drowned).toBe(true);
    expect(events).toContainEqual({ k: 'drown', id: 1 });
  });

  it('nothing blows up a slug a hair above the water', () => {
    const s = lab();
    s.terrain.fill(0);
    s.terrain.fill(1, (s.water - 2) * W);
    stand(s, 1, 1500, s.water - 2);
    run(s, 5);
    expect(s.slugs[1].alive).toBe(true);
  });
});

describe('walking', () => {
  function stepTo(height: number) {
    const s = lab();
    for (let y = FLOOR - height; y < FLOOR; y++) s.terrain.fill(1, y * W + 320, y * W + 420);
    run(s, 200, { keys: RIGHT });
    return s.slugs[0];
  }

  it('climbs a step of 8 px', () => {
    const slug = stepTo(8);
    expect(px(slug.x)).toBeGreaterThan(340);
    expect(px(slug.y)).toBe(FLOOR - 8 - SLUG_HALF_H);
  });

  it('stops at a wall of 9 px', () => {
    const slug = stepTo(9);
    expect(px(slug.x)).toBeLessThan(320);
    expect(px(slug.y)).toBe(FLOOR - SLUG_HALF_H);
  });

  it('turns round on the first tick of walking the other way, then walks', () => {
    const s = lab();
    s.slugs[0].facing = 1;
    run(s, 1, { keys: LEFT });
    expect(s.slugs[0].facing).toBe(-1);
    expect(px(s.slugs[0].x)).toBe(300);
    run(s, 40, { keys: LEFT });
    expect(px(s.slugs[0].x)).toBeLessThan(290);
  });
});

describe('turns', () => {
  it("keeps each team's weapon, fuse and bounce for its own next turn", () => {
    const s = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1, { turnSeconds: 5 });
    const nextTurn = () => {
      const was = s.activeTeam;
      while (s.activeTeam === was || s.phase !== 'turn') advance(s, idle);
    };
    run(s, READY_TICKS);
    const first = s.activeTeam;
    choose(s, 'grenade');
    advance(s, { keys: 0, act: { t: 'fuse', n: 5 } });
    advance(s, { keys: 0, act: { t: 'bounce' } });
    nextTurn();
    expect([s.weapon, s.fuse, s.bounceHigh]).toEqual(['bazooka', 3, false]);
    choose(s, 'shotgun');
    advance(s, { keys: 0, act: { t: 'fuse', n: 1 } });
    nextTurn();
    expect(s.activeTeam).toBe(first);
    expect([s.weapon, s.fuse, s.bounceHigh]).toEqual(['grenade', 5, true]);
    nextTurn();
    expect([s.weapon, s.fuse, s.bounceHigh]).toEqual(['shotgun', 1, false]);
  });

  it("does not hand the computer's choice to the human who plays next", () => {
    const s = newGame(3, [{ name: 'A', control: 3 }, { name: 'B', control: 'human' }], 1);
    while (s.phase !== 'over' && !(s.teams[s.activeTeam].control === 'human' && s.phase === 'turn' && s.teams[0].weapon !== 'bazooka')) advance(s, idle);
    expect(s.phase).toBe('turn');
    expect(s.weapon).toBe(s.teams[1].weapon);
    expect(s.weapon).not.toBe(s.teams[0].weapon);
  }, 30_000);

  it('ends on the timer', () => {
    const s = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1, { turnSeconds: 10 });
    expect(s.phase).toBe('ready');
    run(s, READY_TICKS + 500 - 2);
    expect(s.phase).toBe('turn');
    run(s, 2);
    expect(s.phase).toBe('settle');
  });

  it('ends when retreat time runs out after firing, and nothing more can be fired', () => {
    const s = lab();
    const fired = charge(s, 20).filter((e) => e.k === 'fire');
    expect(fired).toHaveLength(1);
    expect(s.phase).toBe('retreat');
    const again = charge(s, 20).filter((e) => e.k === 'fire');
    expect(again).toHaveLength(0);
    run(s, RETREAT_TICKS - 21 - 2);
    expect(s.phase).toBe('retreat');
    run(s, 2);
    expect(s.phase).toBe('settle');
  });

  it('ends at once when the active slug is hurt', () => {
    const s = lab();
    explode(s, 300 + 20, FLOOR - 4, 50, 48, 0);
    expect(s.phase).toBe('settle');
  });

  it('the shotgun fires twice, then not again', () => {
    const s = lab();
    choose(s, 'shotgun');
    const shots = () => s.events.filter((e) => e.k === 'shot').length;
    let n = 0;
    for (let i = 0; i < 6; i++) {
      run(s, 1, { keys: FIRE });
      n += shots();
      run(s, 1);
    }
    expect(n).toBe(2);
    expect(s.phase).toBe('retreat');
  });

  it('passes to the other team once the board settles', () => {
    const s = lab();
    advance(s, { keys: 0, act: { t: 'skip' } });
    for (let i = 0; i < 2000 && s.activeTeam === 0; i++) advance(s, idle);
    expect(s.activeTeam).toBe(1);
    expect(s.active).toBe(1);
    expect(s.phase).toBe('ready');
  });

  it('a team with no slug left is out and the other team wins', () => {
    const s = lab();
    s.slugs[1].hp = 0;
    advance(s, { keys: 0, act: { t: 'skip' } });
    const events = run(s, 2000);
    expect(events).toContainEqual({ k: 'die', id: 1 });
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
    expect(s.teams[1].out).toBe(true);
  });

  it('sudden death sets every slug to 1 hp, then the water rises each turn', () => {
    const s = lab();
    s.roundT = DEFAULT_OPTIONS.roundMinutes * 3000;
    advance(s, { keys: 0, act: { t: 'skip' } });
    for (let i = 0; i < 2000 && s.activeTeam === 0; i++) advance(s, idle);
    expect(s.sudden).toBe(true);
    expect(s.slugs.map((g) => g.hp)).toEqual([1, 1]);
    expect(s.water).toBe(WATER_START);
    s.phase = 'turn';
    advance(s, { keys: 0, act: { t: 'skip' } });
    for (let i = 0; i < 2000 && s.activeTeam === 1; i++) advance(s, idle);
    expect(s.water).toBe(WATER_START - 20);
  });
});

describe('shots in flight', () => {
  function landing(s: SlugsState, w: WeaponId, wind: number) {
    s.wind = wind;
    const at = predict(s, w, s.slugs[0], 1, 45, 40, 5);
    expect(at).not.toBeNull();
    return (at as { x: number }).x;
  }

  it('wind carries the bazooka and not the grenade', () => {
    const s = lab();
    const still = landing(s, 'bazooka', 0);
    expect(landing(s, 'bazooka', 3)).toBeGreaterThan(still + 20);
    expect(landing(s, 'bazooka', -3)).toBeLessThan(still - 20);
    const calm = landing(s, 'grenade', 0);
    expect(landing(s, 'grenade', 3)).toBe(calm);
    expect(landing(s, 'grenade', -3)).toBe(calm);
  });

  it('the wind option scales the wind, and 0 turns it off', () => {
    const s = lab({ windScale: 0 });
    const still = landing(s, 'bazooka', 0);
    expect(landing(s, 'bazooka', 3)).toBe(still);
  });

  it('a 3 s grenade goes off on the 150th tick of flight', () => {
    const s = lab();
    choose(s, 'grenade');
    advance(s, { keys: 0, act: { t: 'fuse', n: 3 } });
    run(s, 20, { keys: FIRE });
    advance(s, idle);
    expect(s.projs).toHaveLength(1);
    const thrown = s.tick;
    let boomAt = -1;
    for (let i = 0; i < 300 && boomAt < 0; i++) {
      advance(s, idle);
      if (s.events.some((e) => e.k === 'boom')) boomAt = s.tick;
    }
    expect(boomAt - thrown).toBe(149);
  });

  it('predicting a shot leaves the state as it was', () => {
    const s = lab();
    const before = hashOf(s);
    predict(s, 'grenade', s.slugs[0], 1, 30, CHARGE_TICKS, 3);
    expect(hashOf(s)).toBe(before);
  });

  it('gravity is 0.24 px a tick squared', () => {
    expect(GRAVITY / ONE).toBeCloseTo(0.24, 3);
  });
});

describe('a new landscape', () => {
  it('never seats a slug in rock, in the air or under water, and keeps enemies apart', () => {
    let tight = Infinity;
    for (let seed = 1; seed <= 16; seed++) {
      const s = newGame(seed, [{ name: 'A', control: 1 }, { name: 'B', control: 1 }, { name: 'C', control: 1 }], 4);
      for (const slug of s.slugs) {
        const x = px(slug.x);
        const y = px(slug.y);
        expect(fits(s.terrain, x, y)).toBe(true);
        expect(fits(s.terrain, x, y + 1)).toBe(false);
        expect(y + SLUG_HALF_H).toBeLessThan(s.water);
        for (const other of s.slugs) {
          if (other.team === slug.team) continue;
          const d = Math.hypot(px(other.x) - x, px(other.y) - y);
          tight = Math.min(tight, d);
        }
      }
    }
    expect(tight).toBeGreaterThanOrEqual(70);
  });

  it('is the same land and seating for the same seed', () => {
    const a = newGame(9, [{ name: 'A', control: 1 }, { name: 'B', control: 1 }], 3);
    const b = newGame(9, [{ name: 'A', control: 1 }, { name: 'B', control: 1 }], 3);
    expect(hashOf(a)).toBe(hashOf(b));
    expect(a.terrain.length).toBe(W * H);
  });
});

describe('seating on other shapes of land', () => {
  /** A fresh game's slugs seated afresh on hand-built land, with the generator set to `rng`. */
  function seatOn(build: (t: Uint8Array) => void, rng: number, perTeam = 3) {
    const s = newGame(1, [{ name: 'A', control: 1 }, { name: 'B', control: 1 }], perTeam);
    s.terrain.fill(0);
    build(s.terrain);
    s.rng = rng;
    expect(placeSlugs(s)).toBe(true);
    return s;
  }
  const box = (t: Uint8Array, x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y < y1; y++) t.fill(v, y * W + x0, y * W + x1);
  };
  const inBox = (s: SlugsState, x0: number, y0: number, x1: number, y1: number) =>
    s.slugs.filter((g) => px(g.x) >= x0 && px(g.x) < x1 && px(g.y) >= y0 && px(g.y) < y1).length;
  const nearestEnemy = (s: SlugsState) =>
    Math.min(...s.slugs.flatMap((a) => s.slugs.filter((b) => b.team !== a.team).map((b) => Math.hypot(px(a.x) - px(b.x), px(a.y) - px(b.y)))));

  it('never seats a slug in a pocket sealed in rock', () => {
    // Flat ground, and a block of rock with a hollow inside it as wide as the open ground.
    const land = (t: Uint8Array) => {
      t.fill(1, 400 * W);
      box(t, 200, 100, 1700, 400, 1);
      box(t, 220, 120, 1680, 300, 0);
    };
    let outside = 0;
    for (let rng = 1; rng <= 20; rng++) {
      const s = seatOn(land, rng);
      expect(inBox(s, 220, 120, 1680, 300)).toBe(0);
      outside += s.slugs.length;
    }
    expect(outside).toBe(120);
  }, 30_000);

  it('seats slugs inside a closed cavern, in its largest room', () => {
    const land = (t: Uint8Array) => {
      t.fill(1);
      box(t, 100, 100, 1800, 400, 0);
      box(t, 1820, 100, 1900, 300, 0);
    };
    for (let rng = 1; rng <= 10; rng++) {
      const s = seatOn(land, rng);
      expect(inBox(s, 100, 100, 1800, 400)).toBe(6);
      expect(nearestEnemy(s)).toBeGreaterThanOrEqual(70);
    }
  });

  it('seats slugs on islands in the sky and on tower tops, apart and above the water', () => {
    const islands = (t: Uint8Array) => {
      for (let i = 0; i < 6; i++) box(t, 100 + i * 300, 200 + (i % 2) * 150, 260 + i * 300, 240 + (i % 2) * 150, 1);
    };
    const towers = (t: Uint8Array) => {
      for (let i = 0; i < 8; i++) box(t, 80 + i * 230, 150 + (i % 3) * 60, 140 + i * 230, H, 1);
    };
    for (const land of [islands, towers]) {
      for (let rng = 1; rng <= 10; rng++) {
        const s = seatOn(land, rng);
        for (const slug of s.slugs) {
          expect(fits(s.terrain, px(slug.x), px(slug.y))).toBe(true);
          expect(fits(s.terrain, px(slug.x), px(slug.y) + 1)).toBe(false);
          expect(px(slug.y) + SLUG_HALF_H).toBeLessThan(s.water);
        }
        expect(nearestEnemy(s)).toBeGreaterThanOrEqual(70);
      }
    }
  }, 60_000);

  it('says so when the land has nowhere to stand', () => {
    const s = newGame(1, [{ name: 'A', control: 1 }, { name: 'B', control: 1 }], 2);
    s.terrain.fill(0);
    expect(placeSlugs(s)).toBe(false);
  });
});

describe('settling after a shot', () => {
  // Point-blank shots on awkward ground, with mines and barrels dropped round the shooter.
  const grounds: Record<string, (t: Uint8Array) => void> = {
    flat: () => {},
    wall: (t) => {
      for (let y = 250; y < FLOOR; y++) t.fill(1, y * W + 320, y * W + 360);
    },
    pit: (t) => {
      for (let y = FLOOR; y < FLOOR + 60; y++) t.fill(0, y * W + 285, y * W + 315);
    },
    slope: (t) => {
      for (let x = 0; x < 600; x++) for (let y = FLOOR - (x >> 1); y < FLOOR; y++) t[y * W + x] = 1;
    },
    ledge: (t) => {
      for (let y = 300; y < FLOOR; y++) t.fill(1, y * W, y * W + 310);
    },
  };

  const stock = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1, { mines: 4, barrels: 4 }).objs;

  function scene(build: (t: Uint8Array) => void, things: boolean): SlugsState {
    const s = lab();
    s.objs = things ? stock.map((o) => ({ ...o })) : [];
    build(s.terrain);
    for (const [id, x] of [[0, 300], [1, 1500]]) {
      const slug = s.slugs[id];
      slug.x = x * ONE;
      slug.y = 0;
      slug.mode = 'air';
    }
    // Mines just outside the reach that trips them, barrels close enough to be blown about.
    s.objs.forEach((o, i) => {
      o.x = (300 + (i % 2 ? 1 : -1) * ((o.kind === 'mine' ? 52 : 16) + 6 * i)) * ONE;
      o.y = 200 * ONE;
      o.vx = o.vy = 0;
      o.rest = false;
    });
    run(s, 400);
    s.phase = 'turn';
    s.phaseT = 0;
    s.timeLeft = 3000;
    return s;
  }

  it('ends by going quiet, in a few seconds, never by the 30 s cap', () => {
    let longest = 0;
    let shots = 0;
    for (const [name, build] of Object.entries(grounds)) {
      for (const things of [false, true]) {
        for (const facing of [1, -1] as const) {
          for (const aim of [-90, -45, 0]) {
            for (const power of [1, 15]) {
              const s = scene(build, things);
              const slug = s.slugs[0];
              expect(slug.mode, name).toBe('stand');
              slug.facing = facing;
              slug.aim = aim;
              const booms = charge(s, power).filter((e) => e.k === 'fire').length;
              for (let i = 0; i < 4000 && s.phase !== 'settle'; i++) advance(s, idle);
              let settle = 0;
              while (s.phase === 'settle') {
                advance(s, idle);
                settle++;
              }
              shots += booms;
              longest = Math.max(longest, settle);
            }
          }
        }
      }
    }
    expect(stock.map((o) => o.kind).sort()).toEqual(['barrel', 'barrel', 'barrel', 'barrel', 'mine', 'mine', 'mine', 'mine']);
    expect(shots).toBe(120);
    expect(longest).toBeGreaterThan(25);
    expect(longest).toBeLessThan(400);
  }, 60_000);
});

describe('steel', () => {
  it('is solid, and blasts and tunnels carve the land round it but never it', () => {
    const s = lab();
    for (let y = 380; y < 420; y++) s.terrain.fill(STEEL, y * W + 700, y * W + 720);
    expect(solidAt(s.terrain, 710, 390)).toBe(true);
    explode(s, 710, 400, 50, 60, 50);
    let steel = 0;
    for (let y = 380; y < 420; y++) for (let x = 700; x < 720; x++) steel += s.terrain[y * W + x] === STEEL ? 1 : 0;
    expect(steel).toBe(20 * 40);
    expect(solidAt(s.terrain, 680, 410)).toBe(false);
    carve(s.terrain, 710, 400, 30);
    expect(s.terrain[400 * W + 710]).toBe(STEEL);
  });
});

describe('options', () => {
  it('defaults match a game started without options', () => {
    const setups = [{ name: 'A', control: 1 as const }, { name: 'B', control: 1 as const }];
    expect(hashOf(newGame(3, setups, 2, DEFAULT_OPTIONS))).toBe(hashOf(newGame(3, setups, 2)));
  });

  it('the classic set stocks only the first six weapons', () => {
    const s = lab();
    const stocked = WEAPONS.filter((w) => s.teams[0].ammo[w] !== 0);
    expect(stocked).toEqual(['bazooka', 'grenade', 'cluster', 'airstrike', 'dynamite', 'shotgun'].sort((a, b) => WEAPONS.indexOf(a as WeaponId) - WEAPONS.indexOf(b as WeaponId)));
  });

  it('the full set stocks every weapon, and an empty weapon cannot be chosen', () => {
    const s = lab({ weapons: 'all' });
    expect(WEAPONS.every((w) => s.teams[0].ammo[w] === WEAPON[w].ammo)).toBe(true);
    const c = lab();
    advance(c, { keys: 0, act: { t: 'weapon', w: 'homing' } });
    expect(c.weapon).toBe('bazooka');
  });

  it('start hp, slugs per team and objects on the map follow the options', () => {
    const s = newGame(4, [{ name: 'A', control: 1 }, { name: 'B', control: 1 }], 3, { startHp: 150, mines: 5, barrels: 3 });
    expect(s.slugs).toHaveLength(6);
    expect(s.slugs.every((g) => g.hp === 150 && g.shown === 150)).toBe(true);
    expect(s.objs.filter((o) => o.kind === 'mine')).toHaveLength(5);
    expect(s.objs.filter((o) => o.kind === 'barrel')).toHaveLength(3);
  });

  it('every weapon has a name, a plain description, a category and a way to use it', () => {
    for (const w of WEAPONS) {
      const spec = WEAPON[w];
      expect(spec.name.length).toBeGreaterThan(2);
      expect(spec.desc.length).toBeGreaterThan(10);
      expect(['explosive', 'special', 'firearm', 'melee', 'tool']).toContain(spec.category);
      expect(['charge', 'shot', 'drop', 'target', 'mark']).toContain(spec.use);
    }
    expect(Object.keys(WEAPON).sort()).toEqual([...WEAPONS].sort());
  });
});


describe('the arsenal', () => {
  /** Run until a 'boom' event, returning every boom of that tick. */
  function untilBoom(s: SlugsState, most = 1500) {
    for (let i = 0; i < most; i++) {
      advance(s, idle);
      const booms = s.events.filter((e) => e.k === 'boom');
      if (booms.length) return booms as Extract<SlugEvent, { k: 'boom' }>[];
    }
    throw new Error('nothing went off');
  }

  function aimAt(s: SlugsState, deg: number) {
    const slug = s.slugs[0];
    while (slug.aim < deg) advance(s, { keys: UP });
    while (slug.aim > deg) advance(s, { keys: 8 });
  }

  function press(s: SlugsState, act?: Input['act']): SlugEvent[] {
    return [...run(s, 1, { keys: FIRE, act }), ...run(s, 1)];
  }

  it('a homing missile steers to the marked point', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    choose(s, 'homing');
    charge(s, 10);
    expect(s.projs).toHaveLength(0);
    advance(s, { keys: 0, act: { t: 'target', x: 1000, y: FLOOR - 1 } });
    aimAt(s, 30);
    charge(s, 30);
    const [boom] = untilBoom(s);
    expect(Math.abs(boom.x - 1000)).toBeLessThan(30);
  });

  it('a mortar throws bomblets where it lands', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    choose(s, 'mortar');
    aimAt(s, 80);
    press(s);
    untilBoom(s);
    expect(s.projs.filter((p) => p.kind === 'bit')).toHaveLength(5);
  });

  it('a seed pod splits into four seeds with fuses', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    choose(s, 'seedpod');
    aimAt(s, 45);
    charge(s, 30);
    untilBoom(s);
    const seeds = s.projs.filter((p) => p.kind === 'seed');
    expect(seeds).toHaveLength(4);
    expect(seeds.every((p) => p.fuse >= 49 && p.fuse <= 100)).toBe(true);
  });

  it('the pickle jar goes off with a 99 px blast only once it has stopped', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    choose(s, 'jar');
    aimAt(s, 30);
    charge(s, 40);
    const jar = s.projs[0];
    const [boom] = untilBoom(s);
    expect(boom.r).toBe(99);
    expect(jar.rest).toBe(true);
    expect(jar.age).toBeGreaterThanOrEqual(150);
  });

  it('a pickle jar thrown flat is slowed by rolling on the floor', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    choose(s, 'jar');
    aimAt(s, 0);
    charge(s, 60);
    const jar = s.projs[0];
    const [boom] = untilBoom(s, 900);
    expect(jar.rest).toBe(true);
    // Bounces alone stop it at 578; the rolling friction stops it 12 px sooner.
    expect(boom.x).toBe(566);
  });

  it('a borer tunnels into the land before it bursts', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    choose(s, 'borer');
    aimAt(s, -30);
    charge(s, 40);
    const [boom] = untilBoom(s);
    expect(boom.y).toBeGreaterThan(FLOOR + 40);
  });

  it('a mine trips when a slug is near and goes off (or fizzles) 3 s later', () => {
    const s = lab({ weapons: 'all' });
    choose(s, 'mine');
    const events = [...press(s), ...run(s, RETREAT_TICKS + 5)];
    expect(s.objs).toHaveLength(1);
    const tripped = events.find((e) => e.k === 'mine');
    expect(tripped).toEqual({ k: 'mine', id: s.objs[0].id, fuse: 150 });
    const later = run(s, 160);
    const outcome = later.filter((e) => e.k === 'boom' || e.k === 'dud');
    expect(outcome).toHaveLength(1);
  });

  it('one mine in six is a dud', () => {
    const s = lab();
    let duds = 0;
    for (let i = 0; i < 12; i++) {
      s.objs = [{ id: 900 + i, kind: 'mine', x: 1500 * ONE, y: (FLOOR - 2) * ONE, vx: 0, vy: 0, rest: true, fuse: 1, delay: 1, dud: false, hp: 0, arm: 0 }];
      s.slugs[1].hp = 100;
      if (run(s, 1).some((e) => e.k === 'dud')) duds++;
      s.terrain.fill(1, FLOOR * W);
      stand(s, 1, 1500);
    }
    expect(duds).toBe(2);
  });

  it('a barrel that takes enough damage bursts', () => {
    const s = lab();
    s.objs = [{ id: 900, kind: 'barrel', x: 800 * ONE, y: (FLOOR - 8) * ONE, vx: 0, vy: 0, rest: true, fuse: -1, delay: 0, dud: false, hp: 40, arm: 0 }];
    explode(s, 800 - 10, FLOOR - 8, 50, 48, 0);
    expect(s.objs[0].hp).toBeLessThanOrEqual(0);
    const events = run(s, 1);
    expect(events.filter((e) => e.k === 'boom')).toHaveLength(1);
    expect(s.objs).toHaveLength(0);
  });

  it('a snail crawls the way its slug faces and goes off when fire is pressed', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    choose(s, 'snail');
    press(s);
    const snail = s.projs[0];
    expect(snail.kind).toBe('snail');
    const x0 = px(snail.x);
    run(s, 60);
    expect(px(snail.x)).toBeGreaterThan(x0 + 40);
    expect(s.phase).toBe('retreat');
    const t = s.timeLeft;
    run(s, 20);
    expect(s.timeLeft).toBe(t);
    const events = press(s);
    expect(events.some((e) => e.k === 'boom')).toBe(true);
  });

  it('the millstone bursts down through the land', () => {
    const s = lab({ weapons: 'all' });
    choose(s, 'millstone');
    advance(s, { keys: 0, act: { t: 'target', x: 900, y: 100 } });
    const booms = run(s, 400).filter((e) => e.k === 'boom');
    expect(booms.length).toBeGreaterThan(3);
    expect(solidAt(s.terrain, 900, FLOOR + 150)).toBe(false);
  });

  it('an air strike comes down on the point picked', () => {
    const s = lab();
    s.slugs[0].facing = 1;
    choose(s, 'airstrike');
    advance(s, { keys: 0, act: { t: 'target', x: 1500, y: FLOOR - 8 } });
    const booms = run(s, 400).filter((e) => e.k === 'boom') as Extract<SlugEvent, { k: 'boom' }>[];
    expect(booms).toHaveLength(5);
    expect(booms.some((b) => Math.abs(b.x - 1500) < 15)).toBe(true);
    expect(s.slugs[1].hp).toBeLessThan(100);
  });

  it('the long shot crosses the map and hits for 35', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    choose(s, 'longshot');
    press(s);
    expect(s.slugs[1].hp).toBeLessThanOrEqual(100 - 30);
  });

  it('the handgun and machine gun fire 6 and 10 rounds', () => {
    for (const [w, n] of [['handgun', 6], ['machinegun', 10], ['minigun', 20]] as const) {
      const s = lab({ weapons: 'all' });
      choose(s, w);
      const shots = [...press(s), ...run(s, 100)].filter((e) => e.k === 'shot');
      expect(shots).toHaveLength(n);
      expect(s.phase).toBe('retreat');
    }
  });

  it('close combat: the uppercut lifts, the spade throws far, the prod only nudges', () => {
    const cases = [['uppercut', 70], ['spade', 70], ['prod', 100]] as const;
    const speeds: number[] = [];
    for (const [w, hp] of cases) {
      const s = lab({ weapons: 'all' });
      s.slugs[0].facing = 1;
      stand(s, 1, 312);
      choose(s, w);
      if (w === 'spade') aimAt(s, 45);
      const events = press(s);
      expect(events).toContainEqual({ k: 'blow', w, id: 1 });
      expect(s.slugs[1].hp).toBe(hp);
      expect(s.slugs[1].vy).toBeLessThan(0);
      speeds.push(Math.abs(s.slugs[1].vx));
    }
    expect(speeds[1]).toBeGreaterThan(speeds[0]);
    expect(speeds[1]).toBeGreaterThan(speeds[2]);
  });

  it('close combat misses a slug out of reach', () => {
    const s = lab({ weapons: 'all' });
    s.slugs[0].facing = 1;
    stand(s, 1, 340);
    choose(s, 'uppercut');
    press(s);
    expect(s.slugs[1].hp).toBe(100);
  });

  it('teleport moves to a clear spot and ends the turn; into rock it does nothing', () => {
    const s = lab({ weapons: 'all' });
    choose(s, 'teleport');
    advance(s, { keys: 0, act: { t: 'target', x: 800, y: FLOOR + 50 } });
    expect(px(s.slugs[0].x)).toBe(300);
    expect(s.teams[0].ammo.teleport).toBe(2);
    advance(s, { keys: 0, act: { t: 'target', x: 800, y: 200 } });
    expect(s.events).toContainEqual({ k: 'teleport', id: 0, x0: 300, y0: FLOOR - 8, x1: 800, y1: 200 });
    expect(px(s.slugs[0].x)).toBe(800);
    expect(s.phase).toBe('settle');
    expect(s.teams[0].ammo.teleport).toBe(1);
  });

  it('a girder is solid land within reach, at the angle set, and refused out of reach', () => {
    const s = lab({ weapons: 'all' });
    choose(s, 'girder');
    advance(s, { keys: 0, act: { t: 'target', x: 700, y: 300 } });
    expect(s.teams[0].ammo.girder).toBe(3);
    advance(s, { keys: 0, act: { t: 'girder', rot: 2 } });
    advance(s, { keys: 0, act: { t: 'target', x: 400, y: 330 } });
    expect(s.terrain[330 * W + 400]).toBe(2);
    expect(solidAt(s.terrain, 400 + 20, 330 + 20)).toBe(true);
    expect(solidAt(s.terrain, 400 + 20, 330 - 20)).toBe(false);
    expect(s.teams[0].ammo.girder).toBe(2);
    expect(s.phase).toBe('retreat');
  });

  it('the drill digs about 158 px down in 5 s, and the blowtorch about 141 px forward', () => {
    const d = lab({ weapons: 'all' });
    choose(d, 'drill');
    press(d);
    run(d, 260);
    expect(px(d.slugs[0].y) - (FLOOR - 8)).toBeGreaterThan(150);
    expect(px(d.slugs[0].y) - (FLOOR - 8)).toBeLessThan(175);
    expect(d.phase).not.toBe('turn');

    const b = lab({ weapons: 'all' });
    b.slugs[0].facing = 1;
    for (let y = 300; y < FLOOR; y++) b.terrain.fill(1, y * W + 310, y * W + 600);
    choose(b, 'blowtorch');
    press(b);
    run(b, 260);
    expect(px(b.slugs[0].x) - 300).toBeGreaterThan(130);
    expect(px(b.slugs[0].x) - 300).toBeLessThan(150);
    expect(px(b.slugs[0].y)).toBe(FLOOR - 8);
  });

  it('a parachute slows the fall and lands without damage', () => {
    const s = lab({ weapons: 'all' });
    choose(s, 'parachute');
    const slug = s.slugs[0];
    slug.mode = 'air';
    slug.y = 60 * ONE;
    run(s, 10);
    press(s);
    expect(slug.mode).toBe('chute');
    let fastest = 0;
    for (let i = 0; i < 600 && s.slugs[0].mode === 'chute'; i++) {
      advance(s, idle);
      fastest = Math.max(fastest, slug.vy);
    }
    expect(slug.mode).toBe('stand');
    expect(slug.hp).toBe(100);
    expect(fastest).toBeLessThanOrEqual(2 * ONE);
  });

  it('the jetpack flies on limited fuel', () => {
    const s = lab({ weapons: 'all' });
    choose(s, 'jetpack');
    press(s);
    const slug = s.slugs[0];
    expect(slug.mode).toBe('jet');
    run(s, 60, { keys: UP });
    expect(px(slug.y)).toBeLessThan(FLOOR - 8 - 40);
    run(s, 300, { keys: UP });
    expect(s.jetFuel).toBe(0);
    expect(slug.mode).not.toBe('jet');
  });

  describe('the grapple', () => {
    /** A slab of rock overhead from y 100 to 120 across the left of the map. */
    function cave() {
      const s = lab({ weapons: 'all' });
      for (let y = 100; y <= 120; y++) s.terrain.fill(1, y * W, y * W + 900);
      s.slugs[0].facing = 1;
      choose(s, 'rope');
      return s;
    }

    const pivot = (s: SlugsState) => s.rope!.pts[s.rope!.pts.length - 1];
    const reach = (s: SlugsState) => {
      const p = pivot(s);
      return Math.hypot(s.slugs[0].x / ONE - p.x, s.slugs[0].y / ONE - p.y);
    };

    it('catches the rock overhead and holds the slug within the rope length while it swings', () => {
      const s = cave();
      aimAt(s, 80);
      const events = press(s);
      expect(events.find((e) => e.k === 'rope')).toMatchObject({ hit: true });
      expect(s.slugs[0].mode).toBe('rope');
      expect(pivot(s).y).toBeGreaterThanOrEqual(118);
      run(s, 60, { keys: UP });
      expect(px(s.slugs[0].y)).toBeLessThan(FLOOR - 8 - 20);
      let xs: number[] = [];
      for (let i = 0; i < 300; i++) {
        advance(s, { keys: i < 60 ? RIGHT : 0 });
        expect(reach(s)).toBeLessThanOrEqual(s.rope!.len / ONE + 1.5);
        xs.push(px(s.slugs[0].x));
      }
      xs = xs.slice(60);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40);
    });

    it('misses when nothing is in reach, and cannot be thrown downward', () => {
      const s = lab({ weapons: 'all' });
      choose(s, 'rope');
      aimAt(s, 60);
      const events = press(s);
      expect(events.find((e) => e.k === 'rope')).toMatchObject({ hit: false });
      expect(s.slugs[0].mode).toBe('stand');
    });

    it('letting go keeps the swing, and the next landing ends nothing', () => {
      const s = cave();
      aimAt(s, 80);
      press(s);
      run(s, 60, { keys: UP });
      run(s, 40, { keys: RIGHT });
      const vx = s.slugs[0].vx;
      expect(Math.abs(vx)).toBeGreaterThan(ONE);
      const events = run(s, 1, { keys: 0, act: { t: 'jump' } });
      expect(events).toContainEqual({ k: 'unrope', id: 0 });
      expect(s.slugs[0].mode).toBe('air');
      expect(Math.sign(s.slugs[0].vx)).toBe(Math.sign(vx));
      expect(s.phase).toBe('turn');
    });

    it('wraps round rock it swings across and unwraps on the way back', () => {
      const s = cave();
      aimAt(s, 90);
      press(s);
      const anchor = pivot(s);
      // A post hanging just right of the anchor line, so a swing right bends the rope round it.
      for (let y = 121; y <= 200; y++) s.terrain.fill(1, y * W + anchor.x + 14, y * W + anchor.x + 24);
      let most = 1;
      let back = false;
      for (let i = 0; i < 600; i++) {
        advance(s, { keys: i < 200 ? RIGHT : i < 400 ? LEFT : 0 });
        most = Math.max(most, s.rope!.pts.length);
        if (most > 1 && s.rope!.pts.length === 1) back = true;
        expect(reach(s)).toBeLessThanOrEqual(s.rope!.len / ONE + 1.5);
        for (const bend of s.rope!.pts.slice(1)) expect(solidAt(s.terrain, bend.x, bend.y)).toBe(false);
      }
      expect(most).toBeGreaterThan(1);
      expect(back).toBe(true);
    });

    it('fire lets go and a second rope can be thrown in the same turn', () => {
      const s = cave();
      aimAt(s, 80);
      press(s);
      run(s, 40, { keys: UP });
      press(s);
      expect(s.slugs[0].mode).toBe('air');
      expect(s.ropeShots).toBe(1);
      press(s);
      expect(s.slugs[0].mode).toBe('rope');
      expect(s.ropeShots).toBe(0);
    });
  });
});
