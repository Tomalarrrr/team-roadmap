import { describe, expect, it } from 'vitest';
import { BOOST, H, KEY, ONE, W, advance, cloneState, explode, fits, newGame, px, type Input, type SlugEvent, type SlugsState } from '../slugsGameLogic';

const idle: Input = { keys: 0 };
const WATER_LINE = 626;

/**
 * Land given as its top row per column, slug 0's turn under way with no wind and no clock. Both slugs
 * are parked on flat land at the far left, away from anything the test does.
 */
function world(top: (x: number) => number): SlugsState {
  const s = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1, { windScale: 0 });
  s.terrain.fill(0);
  for (let x = 0; x < W; x++) for (let y = Math.max(0, top(x)); y < H; y++) s.terrain[y * W + x] = 1;
  s.objs = [];
  s.projs = [];
  s.activeTeam = 0;
  s.active = 0;
  s.teams[0].last = 0;
  s.phase = 'turn';
  s.phaseT = 0;
  s.wind = 0;
  s.timeLeft = 99999;
  stand(s, 0, 100);
  stand(s, 1, 140);
  return s;
}

/** Flat at row 300 to x 600, then down at `degrees` to below the water. */
const hill = (degrees: number) => {
  const slope = Math.tan((degrees * Math.PI) / 180);
  return (x: number) => (x < 600 ? 300 : Math.min(H - 1, 300 + Math.trunc((x - 600) * slope)));
};

function stand(s: SlugsState, id: number, x: number): void {
  const slug = s.slugs[id];
  let y = 0;
  while (y < H && fits(s.terrain, x, y + 1)) y++;
  slug.x = x * ONE;
  slug.y = y * ONE;
  slug.vx = slug.vy = 0;
  slug.mode = 'stand';
  slug.blown = false;
}

/** Slug 0 set flying from where it stands, as a blast would leave it (`blown`) or as a jump would. */
function launch(s: SlugsState, x: number, vx: number, vy: number, blown: boolean): void {
  stand(s, 0, x);
  const slug = s.slugs[0];
  slug.vx = Math.trunc(vx * ONE);
  slug.vy = Math.trunc(vy * ONE);
  slug.mode = 'air';
  slug.blown = blown;
}

function run(s: SlugsState, n: number, input: Input = idle): SlugEvent[] {
  const events: SlugEvent[] = [];
  for (let i = 0; i < n; i++) {
    advance(s, input);
    events.push(...s.events);
  }
  return events;
}

function grenade(s: SlugsState, x: number, y: number): void {
  s.projs.push({
    id: s.nextId++, kind: 'grenade', x: x * ONE, y: y * ONE, vx: 0, vy: 0, fuse: 400, bounce: 39322, wind: false, damage: 50, crater: 48, bias: 10,
    owner: 0, free: true, rest: false, age: 0, life: -1, tx: 0, ty: 0, dir: 1, dig: 0, hops: 0,
  });
}

function mine(s: SlugsState, x: number, y: number): void {
  s.objs.push({ id: s.nextId++, kind: 'mine', x: x * ONE, y: y * ONE, vx: 0, vy: 0, rest: false, fuse: -1, delay: 150, dud: false, arm: 99999, hp: 0, gift: null, chute: false, laid: false });
}

describe('a thrown slug landing', () => {
  it('bounces back up off a hard landing, where a jump lands dead', () => {
    const rose = (blown: boolean) => {
      const s = world(() => 400);
      launch(s, 900, 2, 10, blown);
      let up = 0;
      for (let i = 0; i < 60; i++) {
        advance(s, idle);
        if (s.slugs[0].mode === 'air' && s.slugs[0].vy < 0) up++;
      }
      return up;
    };
    expect(rose(true)).toBeGreaterThan(3);
    expect(rose(false)).toBe(0);
  });

  it('slides on down a 30° slope into the water', () => {
    const s = world(hill(30));
    launch(s, 760, 1, -1, true);
    const events = run(s, 400);
    expect(events.some((e) => e.k === 'drown' && e.id === 0)).toBe(true);
  });

  it('given the same push on a 15° slope, comes to a stop on it', () => {
    const s = world(hill(15));
    launch(s, 760, 1, -1, true);
    run(s, 400);
    const slug = s.slugs[0];
    expect(slug.alive).toBe(true);
    expect(slug.mode).toBe('stand');
    expect(px(slug.x)).toBeGreaterThan(760);
    expect(px(slug.x)).toBeLessThan(860);
  });

  it('after a jump onto a 30° slope, stands where it lands', () => {
    const s = world(hill(30));
    launch(s, 760, 1, -1, false);
    for (let i = 0; i < 100 && s.slugs[0].mode !== 'stand'; i++) advance(s, idle);
    expect(s.slugs[0].mode).toBe('stand');
    const landed = s.slugs[0].x;
    run(s, 200);
    expect(s.slugs[0].mode).toBe('stand');
    expect(s.slugs[0].x).toBe(landed);
  });

  it('skidding into a wall bounces back off it', () => {
    const s = world((x) => (x > 930 ? 100 : 400));
    launch(s, 900, 4, 0.5, true);
    let back = false;
    for (let i = 0; i < 120; i++) {
      advance(s, idle);
      if (s.slugs[0].vx < 0) back = true;
    }
    expect(back).toBe(true);
    // Against the wall its body would end at x 926.
    expect(px(s.slugs[0].x)).toBeLessThan(916);
  });

  it('skidding off a ledge falls as thrown, with no steering', () => {
    const s = world((x) => (x < 1000 ? 400 : 600));
    launch(s, 900, 5, 0.5, true);
    for (let i = 0; i < 300 && !(s.slugs[0].mode === 'air' && px(s.slugs[0].x) > 1000); i++) advance(s, idle);
    expect(s.slugs[0].mode).toBe('air');
    const steered = cloneState(s);
    run(s, 40);
    run(steered, 40, { keys: KEY.left });
    expect(px(steered.slugs[0].x)).toBe(px(s.slugs[0].x));
  });
});

describe('rolling', () => {
  it('a grenade dropped on a 30° slope rolls down it into the water', () => {
    const s = world(hill(30));
    grenade(s, 800, 380);
    const events = run(s, 300);
    expect(s.projs).toEqual([]);
    expect(events.some((e) => e.k === 'splash')).toBe(true);
  });

  it('a grenade dropped on a 15° slope comes to rest on it', () => {
    const s = world(hill(15));
    grenade(s, 800, 330);
    run(s, 300);
    expect(s.projs).toHaveLength(1);
    expect(s.projs[0].rest).toBe(true);
    expect(px(s.projs[0].y)).toBeLessThan(WATER_LINE - 100);
  });

  it('a mine dropped on a 30° slope slides down it into the water', () => {
    const s = world(hill(30));
    mine(s, 760, 380);
    run(s, 400);
    expect(s.objs).toEqual([]);
  });

  it('a mine dropped on a 15° slope comes to rest on it', () => {
    const s = world(hill(15));
    mine(s, 760, 330);
    run(s, 300);
    expect(s.objs).toHaveLength(1);
    expect(s.objs[0].rest).toBe(true);
    expect(px(s.objs[0].y)).toBeLessThan(WATER_LINE - 100);
  });
});

describe('barrels', () => {
  it('a blast that throws a mine aside only lets a barrel at the same spot fall where it was', () => {
    const at = (kind: 'mine' | 'barrel') => {
      const s = world(() => 400);
      // Tough enough, and slow enough to go off, that neither goes off inside the test.
      s.objs.push({ id: s.nextId++, kind, x: 900 * ONE, y: (400 - (kind === 'mine' ? 2 : 8)) * ONE, vx: 0, vy: 0, rest: true, fuse: -1, delay: 9999, dud: false, arm: 99999, hp: 999, gift: null, chute: false, laid: false });
      explode(s, 880, 398, 50, 48, 0);
      const thrown = s.objs[0].vx;
      run(s, 150);
      return { thrown, x: px(s.objs[0].x) };
    };
    expect(at('mine').thrown).toBeGreaterThan(ONE);
    expect(at('barrel')).toEqual({ thrown: 0, x: 900 });
  });
});

describe('the rope', () => {
  /** Slug 0 roped to a roof 150 px up, swinging fast through the bottom of its arc. */
  function swinging(): SlugsState {
    const s = world(() => 600);
    for (let x = 0; x < W; x++) for (let y = 0; y < 300; y++) s.terrain[y * W + x] = 1;
    s.slugs[0].x = 900 * ONE;
    s.slugs[0].y = 450 * ONE;
    s.slugs[0].mode = 'air';
    s.weapon = 'rope';
    s.slugs[0].aim = 90;
    advance(s, { keys: KEY.fire });
    expect(s.rope).not.toBeNull();
    for (let i = 0; i < 400; i++) advance(s, { keys: s.slugs[0].vx >= 0 ? KEY.right : KEY.left });
    const slug = s.slugs[0];
    for (let i = 0; i < 300 && !(Math.abs(slug.vx) > 6 * ONE && Math.abs(slug.vy) < ONE); i++) advance(s, idle);
    expect(Math.abs(slug.vx)).toBeGreaterThan(6 * ONE);
    return s;
  }
  const speed = (s: SlugsState) => Math.hypot(s.slugs[0].vx, s.slugs[0].vy);

  it('reeling in speeds the swing up, and paying out slows it', () => {
    const still = swinging();
    const reelIn = cloneState(still);
    const payOut = cloneState(still);
    run(still, 10);
    run(reelIn, 10, { keys: KEY.up });
    run(payOut, 10, { keys: KEY.down });
    expect(speed(reelIn)).toBeGreaterThan(speed(still) * 1.1);
    expect(speed(payOut)).toBeLessThan(speed(still));
  });
});

describe('standing', () => {
  it('a slug standing on a 30° slope stays where it stands', () => {
    const s = world(hill(30));
    stand(s, 0, 760);
    const y = s.slugs[0].y;
    run(s, 200);
    expect(s.slugs[0].x).toBe(760 * ONE);
    expect(s.slugs[0].y).toBe(y);
  });
});

describe('coming to rest on a real map', () => {
  const pair = [{ name: 'A', control: 'human' as const }, { name: 'B', control: 'human' as const }];

  it('a mine wedged on a steep face of the forts map rests, so the turn can end', () => {
    // Found by a teammate: here the bounce took off what gravity put back each tick, and settle ran to its cap.
    const s = newGame(1013904226, pair, 4, { map: 'forts' });
    s.objs = [];
    mine(s, 0, 0);
    Object.assign(s.objs[0], { x: 70615860, y: 30995518, vx: 169151, vy: 276023, arm: 99999 });
    run(s, 100);
    expect(s.objs).toHaveLength(1);
    expect(s.objs[0].rest).toBe(true);
  });

  /** A grenade (bounce as a fraction of ONE) dropped from the top of a real map with the slugs moved off it; true if it comes to rest within 30 s. */
  const rests = (map: 'canyon' | 'wreck', seed: number, x: number, vx: number, vy: number, bounce: number) => {
    const s = newGame(seed, pair, 1, { map });
    for (const slug of s.slugs) slug.x = -999 * ONE;
    s.objs = [];
    s.phase = 'turn';
    s.timeLeft = 99999;
    grenade(s, x, 20);
    Object.assign(s.projs[0], { vx, vy, bounce, fuse: 99999 });
    for (let i = 0; i < 1500 && s.projs[0] && !s.projs[0].rest; i++) advance(s, idle);
    return s.projs[0]?.rest === true;
  };

  // Both found by dropping 900 grenades on every map; each hung on these rules before the fix and on none before the rolling rules.
  it('a grenade on the flat lip of a cliff rests there rather than bouncing on the spot', () => {
    expect(rests('canyon', 1002, 868, 0, 32768, 39322)).toBe(true);
  });

  it('a grenade wedged on a steep face rests', () => {
    expect(rests('wreck', 1001, 231, 98304, 16384, 19661)).toBe(true);
  });

  it('mines and barrels are set down where they stay, so nothing moves before anyone has played', () => {
    for (const [map, seed] of [['forts', 1013904226], ['classic', 12345], ['sky', 295865395]] as const) {
      const s = newGame(seed, pair, 4, { map, mines: 12, barrels: 4 });
      // To the pixel: each settles a fraction of one onto the ground under it.
      const where = () => s.objs.map((o) => [o.id, px(o.x), px(o.y)]);
      const placed = where();
      expect(placed.length).toBeGreaterThan(8);
      for (let i = 0; i < 3000 && s.phase !== 'settle'; i++) advance(s, idle);
      expect(s.phase).toBe('settle');
      expect(where()).toEqual(placed);
    }
  });

  // The V and the spike were found by the red team's shape sweep and fuzz; each held its turn open for ever before the fix.
  it('a mine dropped into a V, held from one side below with nothing straight under it, rests', () => {
    const left = Math.tan((10 * Math.PI) / 180), right = Math.tan((70 * Math.PI) / 180);
    const s = world((x) => Math.max(100, 450 - Math.trunc((x < 1000 ? 1000 - x : x - 1000) * (x < 1000 ? left : right))));
    let y = 100;
    while (!s.terrain[(y + 6) * W + 1030]) y++;
    mine(s, 1030, y - 10);
    run(s, 600);
    expect(s.objs).toHaveLength(1);
    expect(s.objs[0].rest).toBe(true);
  });

  /** Rough ground falling away to the right of x 600, from a fixed seed: a step of up to 3 px either way each column, and 1 down every `fall`. */
  const rough = (seed: number, fall: number) => {
    let r = seed;
    let y = 300;
    const tops: number[] = [];
    for (let x = 0; x < W; x++) {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      if (x >= 600) y = Math.min(H - 1, y + (r % 7) - 3 + (x % fall === 0 ? 1 : 0));
      tops.push(y);
    }
    return tops;
  };

  it('a mine sliding over rough ground is not stopped by a corner it only passes', () => {
    const tops = rough(7, 1);
    const s = world((x) => tops[x]);
    mine(s, 640, tops[640] - 20);
    run(s, 1500);
    // It ends at 667 on these rules and on the rules before a wedged mine could rest on a corner; letting
    // any slow mine rest on one stops it at 641, short of where it slid before.
    expect(s.objs[0].rest).toBe(true);
    expect(px(s.objs[0].x)).toBe(667);
  });

  it('a grenade rolling over rough ground is not stopped by a corner it only passes', () => {
    const tops = rough(4, 2);
    const s = world((x) => tops[x]);
    grenade(s, 640, tops[640] - 20);
    Object.assign(s.projs[0], { vx: ONE, bounce: 19661, fuse: 99999 });
    run(s, 1500);
    // 648 on these rules and on those before; resting on any corner while slow stops it at 646.
    expect(s.projs[0].rest).toBe(true);
    expect(px(s.projs[0].x)).toBe(648);
  });

  it('a jar wedged beside a 1-pixel spike in low gravity rests, so its fuse burns out', () => {
    const s = world((x) => (x === 886 ? 506 : 516));
    s.boost |= BOOST.lowgrav;
    grenade(s, 0, 0);
    Object.assign(s.projs[0], { kind: 'jar', x: 58009621, y: 33230916, vx: -95267, vy: 93453, bounce: 19661, fuse: 150 });
    const events = run(s, 400);
    expect(s.projs).toEqual([]);
    expect(events.some((e) => e.k === 'boom')).toBe(true);
  });
});
