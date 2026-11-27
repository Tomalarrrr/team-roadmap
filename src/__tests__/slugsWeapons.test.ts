import { beforeAll, describe, expect, it } from 'vitest';
import {
  BACKJUMP,
  BOOST,
  CRATE_HEALTH,
  FLIP,
  GRAVITY,
  HOP,
  KEY,
  ONE,
  READY_TICKS,
  RETREAT_TICKS,
  H,
  SLUG_HALF_H,
  SLUG_HALF_W,
  SPEED_CAP,
  STEEL,
  W,
  WEAPON,
  WEAPONS,
  advance,
  canPickWeapon,
  cloneState,
  explode,
  fallDamage,
  fits,
  gravity,
  newGame,
  px,
  shotEnd,
  shotRange,
  type Input,
  type Obj,
  type SlugEvent,
  type SlugsState,
  type Gift,
  type WeaponId,
} from '../slugsGameLogic';
import { MAP_DESIGN_IDS } from '../slugsMaps';

const FLOOR = 400;
const idle: Input = { keys: 0 };
const { fire: FIRE, up: UP, left: LEFT, right: RIGHT } = KEY;

let base: SlugsState;

beforeAll(() => {
  const s = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 2, { weapons: 'all' });
  s.terrain.fill(0);
  s.terrain.fill(1, FLOOR * W);
  s.objs = [];
  s.projs = [];
  s.activeTeam = 0;
  s.active = 0;
  s.teams[0].last = 0;
  s.teams[1].last = 1;
  s.phase = 'turn';
  s.phaseT = 0;
  s.wind = 0;
  s.timeLeft = 45 * 50;
  // Team A is slugs 0 and 1, team B 2 and 3.
  stand(s, 0, 300);
  stand(s, 1, 120);
  stand(s, 2, 1500);
  stand(s, 3, 1700);
  base = s;
});

/** The flat lab: slug 0 (team A) at x 300 on its turn, its teammate at 120, the enemies at 1500 and 1700. */
const lab = () => cloneState(base);

function stand(s: SlugsState, id: number, x: number, floor = FLOOR): void {
  const slug = s.slugs[id];
  slug.x = x * ONE;
  slug.y = (floor - SLUG_HALF_H) * ONE;
  slug.vx = slug.vy = 0;
  slug.mode = 'stand';
}

function rock(s: SlugsState, x0: number, y0: number, x1: number, y1: number, v = 1): void {
  for (let y = y0; y < y1; y++) s.terrain.fill(v, y * W + x0, y * W + x1);
}

/** Every number the rules keep for a body is a whole number, and no living slug is inside the land. */
function checkTick(s: SlugsState): void {
  for (const g of s.slugs) {
    for (const v of [g.x, g.y, g.vx, g.vy, g.hp, g.aim]) if (!Number.isInteger(v)) throw new Error(`slug ${g.id} has ${v}`);
    if (g.alive && !fits(s.terrain, px(g.x), px(g.y))) throw new Error(`slug ${g.id} inside land at ${px(g.x)},${px(g.y)} tick ${s.tick}`);
  }
  for (const p of s.projs) for (const v of [p.x, p.y, p.vx, p.vy, p.fuse]) if (!Number.isInteger(v)) throw new Error(`${p.kind} has ${v}`);
  for (const o of s.objs) for (const v of [o.x, o.y, o.vx, o.vy, o.fuse, o.hp]) if (!Number.isInteger(v)) throw new Error(`${o.kind} has ${v}`);
}

function run(s: SlugsState, n: number, input: Input = idle): SlugEvent[] {
  const events: SlugEvent[] = [];
  for (let i = 0; i < n; i++) {
    advance(s, input);
    checkTick(s);
    events.push(...s.events);
  }
  return events;
}

const press = (s: SlugsState, act?: Input['act']) => [...run(s, 1, { keys: FIRE, act }), ...run(s, 1)];

function choose(s: SlugsState, w: WeaponId): void {
  advance(s, { keys: 0, act: { t: 'weapon', w } });
  expect(s.weapon).toBe(w);
}

/** Run until the next team's turn is under way (or the match is over), with every tick checked. */
function untilNextTurn(s: SlugsState, most = 6000): SlugEvent[] {
  const team = s.activeTeam;
  const events: SlugEvent[] = [];
  for (let i = 0; i < most; i++) {
    events.push(...run(s, 1));
    if (s.phase === 'over' || (s.phase === 'ready' && s.activeTeam !== team)) return events;
  }
  throw new Error(`turn never passed: phase ${s.phase}, projs ${s.projs.map((p) => p.kind)}`);
}

interface Shot {
  facing: 1 | -1;
  aim: number;
  power: number;
  fuse: number;
  wind: number;
}

/** Set off `w` from slug 0 the way its kind of weapon is used. */
function use(s: SlugsState, w: WeaponId, shot: Shot): SlugEvent[] {
  const slug = s.slugs[0];
  slug.facing = shot.facing;
  slug.aim = shot.aim;
  s.wind = shot.wind;
  choose(s, w);
  const spec = WEAPON[w];
  const events: SlugEvent[] = [];
  if (spec.fuse) advance(s, { keys: 0, act: { t: 'fuse', n: shot.fuse } });
  const tx = px(slug.x) + shot.facing * 150;
  if (spec.use === 'mark') advance(s, { keys: 0, act: { t: 'target', x: tx, y: FLOOR - 20 } });
  if (spec.use === 'charge' || spec.use === 'mark') {
    events.push(...run(s, shot.power, { keys: FIRE }), ...run(s, 1));
  } else if (spec.use === 'target') {
    events.push(...run(s, 1, { keys: 0, act: { t: 'target', x: tx, y: w === 'teleport' || w === 'girder' ? FLOOR - 60 : FLOOR - 10 } }));
  } else if (w === 'rope') {
    rock(s, 0, 100, 900, 120);
    events.push(...press(s), ...run(s, 40, { keys: RIGHT }), ...press(s));
  } else if (w === 'jetpack') {
    events.push(...press(s), ...run(s, 400, { keys: UP }));
  } else if (w === 'parachute') {
    slug.y = 100 * ONE;
    slug.mode = 'air';
    events.push(...run(s, 5), ...press(s));
  } else if (w === 'shotgun') {
    events.push(...press(s), ...press(s));
  } else {
    events.push(...press(s));
  }
  return events;
}

const SHOTS: Shot[] = [
  { facing: 1, aim: 45, power: 40, fuse: 3, wind: 0 },
  { facing: -1, aim: 20, power: 60, fuse: 1, wind: 10 },
  { facing: 1, aim: -90, power: 1, fuse: 5, wind: -10 },
  { facing: -1, aim: 89, power: 25, fuse: 2, wind: 5 },
];

describe('every weapon, fired a few ways on flat land', () => {
  // Utilities are only found in crates, so a team has none to fire; they are tried under 'utilities' below.
  for (const w of WEAPONS.filter((w) => WEAPON[w].ammo !== 0)) {
    it(`${w}: the shot ends, the turn passes, nothing is left flying or inside the land`, () => {
      for (const shot of SHOTS) {
        const s = lab();
        const before = s.teams[0].ammo[w];
        const events = use(s, w, shot);
        events.push(...untilNextTurn(s));
        expect(s.projs, `${w} ${JSON.stringify(shot)}`).toEqual([]);
        expect(s.using).toBeNull();
        expect(s.rope).toBeNull();
        expect(s.remote).toBe(-1);
        if (before > 0) expect(s.teams[0].ammo[w], `${w} ammo`).toBe(before - 1);
        else expect(s.teams[0].ammo[w]).toBe(-1);
        // A fall's damage comes as a 'fall' and then its 'hurt'; those are held to the fall's own cap instead.
        const hurt = events.filter((e, i): e is Extract<SlugEvent, { k: 'hurt' }> => e.k === 'hurt' && events[i - 1]?.k !== 'fall');
        const falls = events.filter((e): e is Extract<SlugEvent, { k: 'fall' }> => e.k === 'fall');
        for (const e of hurt) expect(e.dmg).toBeLessThanOrEqual(Math.max(WEAPON[w].damage, 50));
        for (const e of falls) expect(e.dmg).toBeLessThanOrEqual(fallDamage(SPEED_CAP));
        for (const g of s.slugs) if (g.alive) expect(g.hp).toBeGreaterThan(0);
      }
    }, 20_000);
  }
});


const ofKind = <K extends SlugEvent['k']>(events: SlugEvent[], k: K) => events.filter((e): e is Extract<SlugEvent, { k: K }> => e.k === k);

/** A fresh projectile for the lab, with only what a test sets differing. */
function proj(s: SlugsState, kind: 'shell' | 'grenade' | 'jar', x: number, y: number, more: Partial<SlugsState['projs'][number]> = {}): SlugsState['projs'][number] {
  return {
    id: s.nextId++, kind, x: x * ONE, y: y * ONE, vx: 0, vy: 0, fuse: -1, bounce: 0, wind: false, damage: 50, crater: 48, bias: 0,
    owner: 2, free: true, rest: false, age: 0, life: -1, tx: 0, ty: 0, dir: 1, dig: 0, hops: 0, ...more,
  };
}

function barrel(s: SlugsState, x: number, hp = 40, floor = FLOOR): SlugsState['objs'][number] {
  const o = { id: s.nextId++, kind: 'barrel' as const, x: x * ONE, y: (floor - 8) * ONE, vx: 0, vy: 0, rest: true, fuse: -1, delay: 0, dud: false, hp, arm: 0, gift: null, chute: false, laid: false };
  s.objs.push(o);
  return o;
}

describe('bugs found and fixed', () => {
  it('a bullet that hurts its own slug ends the turn at once, with no retreat time', () => {
    const s = lab();
    // A wall 7 px in front: the long shot's blast reaches back to the shooter.
    rock(s, 307, 300, 340, FLOOR);
    s.slugs[0].facing = 1;
    s.slugs[0].aim = 0;
    choose(s, 'longshot');
    const events = run(s, 1, { keys: FIRE });
    expect(ofKind(events, 'hurt').map((e) => e.id)).toContain(0);
    expect(s.phase).toBe('settle');
  });

  it('a blast pushes a projectile whether it comes before or after the one that burst', () => {
    for (const order of ['shell first', 'grenade first']) {
      const s = lab();
      s.phase = 'settle';
      const shell = proj(s, 'shell', 600, FLOOR - 4, { vy: 2 * ONE });
      const grenade = proj(s, 'grenade', 620, FLOOR - 3, { fuse: 500, rest: true });
      s.projs = order === 'shell first' ? [shell, grenade] : [grenade, shell];
      advance(s, idle);
      expect(s.projs.map((p) => p.kind), order).toEqual(['grenade']);
      expect(s.projs[0].vx, order).toBeGreaterThan(100_000);
      expect(s.projs[0].rest, order).toBe(false);
    }
  });

  it('a burst projectile is not pushed by its own blast', () => {
    const s = lab();
    s.phase = 'settle';
    const shell = proj(s, 'shell', 600, FLOOR - 4, { vy: 2 * ONE });
    s.projs = [shell];
    advance(s, idle);
    expect(s.projs).toEqual([]);
    expect([shell.vx, shell.rest]).toEqual([0, false]);
  });

  it('the blowtorch stops at steel instead of carrying the slug into it', () => {
    const s = lab();
    rock(s, 310, 300, 600, FLOOR);
    rock(s, 400, 300, 420, FLOOR, STEEL);
    s.slugs[0].facing = 1;
    choose(s, 'blowtorch');
    press(s);
    // checkTick in run throws if the slug is ever inside the land.
    run(s, 300);
    expect(s.using).toBeNull();
    expect(px(s.slugs[0].x)).toBeLessThan(400);
    expect(px(s.slugs[0].x)).toBeGreaterThan(380);
    expect(s.phase === 'retreat' || s.phase === 'settle').toBe(true);
  });

  it('a barrel lying still is taken by water that rises over it', () => {
    const s = lab();
    barrel(s, 700);
    s.water = FLOOR - 20;
    const events = run(s, 1);
    expect(s.objs).toEqual([]);
    expect(ofKind(events, 'splash').filter((e) => e.x === 700)).toHaveLength(1);
  });

  it('a shotgun hit on a barrel does the shot damage once, as it would to a slug', () => {
    const s = lab();
    const b = barrel(s, 400);
    s.slugs[0].facing = 1;
    s.slugs[0].aim = 0;
    choose(s, 'shotgun');
    press(s);
    expect(b.hp).toBe(40 - WEAPON.shotgun.damage);
  });
});

describe('the classic game\'s rules', () => {
  it('the round clock counts the whole match, retreat and settling as well', () => {
    const s = lab();
    s.roundT = 0;
    run(s, 20, { keys: FIRE });
    run(s, 1);
    expect(s.phase).toBe('retreat');
    untilNextTurn(s);
    expect(s.roundT).toBe(s.tick - base.tick);
  });

  it('sudden death comes after roundMinutes of play even when every turn is short', () => {
    const s = lab();
    s.opts = { ...s.opts, roundMinutes: 1 };
    s.roundT = 0;
    // Each turn is skipped at once, so hardly any of the minute is 'turn' time.
    let sudden = false;
    for (let turn = 0; turn < 40 && !sudden; turn++) {
      advance(s, { keys: 0, act: { t: 'skip' } });
      for (let i = 0; i < 2000 && s.phase !== 'ready' && s.phase !== 'over'; i++) advance(s, idle);
      for (let i = 0; i < READY_TICKS + 1 && s.phase === 'ready'; i++) advance(s, idle);
      sudden = s.sudden;
    }
    expect(sudden).toBe(true);
    expect(s.slugs.filter((g) => g.alive).every((g) => g.hp === 1)).toBe(true);
  }, 20_000);

  it('a forward jump lands where it comes down, with no skid', () => {
    const s = lab();
    advance(s, { keys: 0, act: { t: 'jump' } });
    const modes = new Set<string>();
    for (let i = 0; i < 120 && s.slugs[0].mode !== 'stand'; i++) {
      run(s, 1);
      modes.add(s.slugs[0].mode);
    }
    const landed = px(s.slugs[0].x);
    run(s, 50);
    expect(modes.has('slide')).toBe(false);
    expect(px(s.slugs[0].x)).toBe(landed);
    // The source's forward jump covers about 70 px.
    expect(landed - 300).toBeGreaterThanOrEqual(60);
    expect(landed - 300).toBeLessThanOrEqual(80);
  });

  it('a slug thrown by a blast still skids', () => {
    const s = lab();
    s.phase = 'settle';
    explode(s, 290, FLOOR - 4, 30, 30, 0);
    const modes = new Set<string>();
    for (let i = 0; i < 300; i++) {
      run(s, 1);
      modes.add(s.slugs[0].mode);
    }
    expect(modes.has('slide')).toBe(true);
  });

  /** Ground rising `rise` px for each `run` px from x 320 on, up to 200 px high: how far up slug 0 walks in 600 ticks. */
  function climbs(rise: number, runPx: number): number {
    const s = lab();
    for (let x = 320; x < 900; x++) {
      const top = FLOOR - Math.min(200, Math.floor(((x - 320 + 1) / runPx)) * rise);
      if (top < FLOOR) rock(s, x, top, x + 1, FLOOR);
    }
    run(s, 600, { keys: RIGHT });
    return FLOOR - SLUG_HALF_H - px(s.slugs[0].y);
  }

  it('walks up hills to 71 degrees but not up a wall of 8 px steps', () => {
    expect(climbs(1, 1)).toBeGreaterThan(100); // 45°
    expect(climbs(2, 1)).toBeGreaterThan(100); // 63°
    expect(climbs(3, 1)).toBeGreaterThan(100); // 71°
    expect(climbs(4, 1)).toBeLessThanOrEqual(14); // 76°
    expect(climbs(8, 1)).toBeLessThanOrEqual(14); // 83°, the stair wall
    // A single ledge of a full step is still climbed, and then the next.
    expect(climbs(8, 6)).toBeGreaterThan(100);
  }, 20_000);

  function readyGame(control: 'human' | 1 = 'human') {
    const s = newGame(1, [{ name: 'A', control }, { name: 'B', control: 'human' }], 1);
    expect(s.phase).toBe('ready');
    return s;
  }

  it('the hot seat waits up to 5 s, and the first key pressed starts the turn on that tick', () => {
    const idleOnly = readyGame();
    run(idleOnly, READY_TICKS - 1);
    expect(idleOnly.phase).toBe('ready');
    run(idleOnly, 1);
    expect(idleOnly.phase).toBe('turn');

    const s = readyGame();
    run(s, 10);
    const facing = s.slugs[s.active].facing;
    const key = facing === 1 ? LEFT : RIGHT;
    run(s, 1, { keys: key });
    expect(s.phase).toBe('turn');
    expect(s.slugs[s.active].facing).toBe(-facing);
    expect(s.timeLeft).toBe(s.opts.turnSeconds * 50 - 1);
  });

  it('a key already held when the turn comes round does not start it; an act does', () => {
    const s = readyGame();
    run(s, 50, { keys: UP });
    expect(s.phase).toBe('ready');
    advance(s, { keys: UP, act: { t: 'weapon', w: 'grenade' } });
    expect(s.phase).toBe('turn');
    expect(s.weapon).toBe('grenade');
  });

  it('fire pressed in the hot seat starts the turn and the charge together', () => {
    const s = readyGame();
    run(s, 5);
    run(s, 1, { keys: FIRE });
    expect([s.phase, s.charging]).toEqual(['turn', true]);
  });

  it('the computer\'s turn starts after 1.2 s, as it has no key to press', () => {
    const s = readyGame(1);
    expect(s.teams[s.activeTeam].control === 'human' ? 'human first' : 'cpu first').toBe('cpu first');
    run(s, 59);
    expect(s.phase).toBe('ready');
    run(s, 1);
    expect(s.phase).toBe('turn');
  });

  it('the rope fires twice a turn', () => {
    const s = lab();
    rock(s, 0, 100, 900, 120);
    s.slugs[0].aim = 80;
    choose(s, 'rope');
    let caught = 0;
    for (let i = 0; i < 4; i++) {
      caught += ofKind(press(s), 'rope').length;
      run(s, 10);
      press(s);
      for (let k = 0; k < 200 && s.slugs[0].mode !== 'stand'; k++) run(s, 1);
    }
    expect(caught).toBe(2);
    expect(s.ropeShots).toBe(0);
  }, 20_000);

  it('after firing from the rope, the rope can be shot again in the retreat', () => {
    const s = lab();
    rock(s, 0, 100, 900, 120);
    s.slugs[0].aim = 80;
    choose(s, 'rope');
    press(s);
    run(s, 20);
    expect(s.slugs[0].mode).toBe('rope');
    choose(s, 'grenade');
    advance(s, { keys: FIRE });
    run(s, 5, { keys: FIRE });
    run(s, 1);
    expect(s.phase).toBe('retreat');
    expect(s.weapon).toBe('rope');
    press(s);
    expect(s.slugs[0].mode).not.toBe('rope');
    const again = press(s);
    expect(ofKind(again, 'rope')).toHaveLength(1);
    expect(s.phase).toBe('retreat');
  }, 20_000);

  it('the slug may turn round between the shotgun\'s shots, but not walk', () => {
    const s = lab();
    s.slugs[0].aim = 0;
    s.slugs[0].facing = 1;
    choose(s, 'shotgun');
    const first = ofKind(press(s), 'shot')[0];
    run(s, 30, { keys: LEFT });
    expect(s.slugs[0].facing).toBe(-1);
    expect(px(s.slugs[0].x)).toBe(300);
    const second = ofKind(press(s), 'shot')[0];
    expect(first.x1).toBeGreaterThan(first.x0);
    expect(second.x1).toBeLessThan(second.x0);
    expect(second.id).toBe(0);
  });

  /** Where slug 0 lands after `t`, and the most it rose, in px. */
  function leap(t: 'jump' | 'flip' | 'backjump' | 'hop') {
    const s = lab();
    const y0 = px(s.slugs[0].y);
    advance(s, { keys: 0, act: { t } });
    let top = y0;
    for (let i = 0; i < 200 && s.slugs[0].mode !== 'stand'; i++) {
      run(s, 1);
      top = Math.min(top, px(s.slugs[0].y));
    }
    return { dx: px(s.slugs[0].x) - 300, up: y0 - top };
  }

  it('a backjump, a straight jump and a backflip each go where the source says', () => {
    const back = leap('backjump');
    expect(back.dx).toBeGreaterThanOrEqual(-32);
    expect(back.dx).toBeLessThanOrEqual(-24);
    const hop = leap('hop');
    expect(hop.dx).toBe(0);
    expect(hop.up).toBeGreaterThanOrEqual(37);
    expect(hop.up).toBeLessThanOrEqual(40);
    const flip = leap('flip');
    expect(flip.up).toBeGreaterThanOrEqual(69);
    expect(flip.up).toBeLessThanOrEqual(75);
    expect(flip.dx).toBeLessThan(0);
    expect([BACKJUMP.vx < 0, HOP.vx, FLIP.vx < 0]).toEqual([true, 0, true]);
  });
});

describe('what the scene and the panel read', () => {
  it('a boom says what went off', () => {
    const s = lab();
    barrel(s, 700, 0);
    const events = run(s, 1);
    expect(ofKind(events, 'boom').map((e) => e.src)).toEqual(['barrel']);
    s.slugs[0].aim = 45;
    expect(ofKind(use(s, 'bazooka', SHOTS[0]).concat(untilNextTurn(s)), 'boom')[0].src).toBe('shell');
  });

  it('the jetpack says which thrusters burn', () => {
    const s = lab();
    choose(s, 'jetpack');
    press(s);
    run(s, 3, { keys: UP | LEFT });
    expect(s.slugs[0].thrust).toBe(UP | LEFT);
    run(s, 1);
    expect(s.slugs[0].thrust).toBe(0);
    run(s, 2, { keys: UP });
    advance(s, { keys: UP, act: { t: 'skip' } });
    expect(s.slugs[0].thrust).toBe(0);
  });

  it('the thrusters go out with the fuel, though the key is still held', () => {
    const s = lab();
    choose(s, 'jetpack');
    press(s);
    for (let t = 0; t < 600 && s.slugs[0].mode === 'jet'; t++) advance(s, { keys: LEFT });
    expect(s.jetFuel).toBe(0);
    expect(s.slugs[0].mode).not.toBe('jet');
    expect(s.slugs[0].thrust).toBe(0);
  });

  it('a weapon may be picked in the hot seat and before the attack, and why not otherwise', () => {
    const ready = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1);
    expect(canPickWeapon(ready)).toBe(true);
    const s = lab();
    expect(canPickWeapon(s)).toBe(true);
    choose(s, 'shotgun');
    press(s);
    expect(canPickWeapon(s)).toBe('between shots');
    advance(s, { keys: 0, act: { t: 'weapon', w: 'grenade' } });
    expect(s.weapon).toBe('shotgun');
    const c = lab();
    run(c, 1, { keys: FIRE });
    expect(canPickWeapon(c)).toBe('busy');
    run(c, 1);
    expect(canPickWeapon(c)).toBe('used');
  });
});

describe('mines, edges, teleports and the jetpack', () => {
  const mineAt = (s: SlugsState, x: number): Obj => {
    const o: Obj = { id: 900, kind: 'mine', x: x * ONE, y: (FLOOR - 2) * ONE, vx: 0, vy: 0, rest: true, fuse: -1, delay: RETREAT_TICKS, dud: false, hp: 0, arm: 0, gift: null, chute: false, laid: false };
    s.objs.push(o);
    return o;
  };
  const clear = (s: SlugsState, x: number, y: number) => s.terrain[y * W + x] === 0;

  it('a dropped mine waits out the retreat before its dropper can trip it', () => {
    const s = lab();
    choose(s, 'mine');
    press(s);
    const mine = s.objs.find((o) => o.kind === 'mine') as Obj;
    expect(ofKind(run(s, RETREAT_TICKS - 5), 'mine')).toEqual([]);
    expect(mine.fuse).toBe(-1);
    // Armed now, with the dropper still beside it.
    expect(ofKind(run(s, 10), 'mine')).toHaveLength(1);
    expect(mine.fuse).toBeGreaterThan(0);
  });

  it('a blast in reach of a mine sets it off; one out of reach does not', () => {
    const s = lab();
    const near = mineAt(s, 700);
    const far = mineAt(s, 1000);
    far.id = 901;
    explode(s, 730, FLOOR - 5, 50, 48, 50);
    expect(near.fuse).toBeGreaterThan(0);
    expect(far.fuse).toBe(-1);
    expect(ofKind(s.events, 'mine').map((e) => e.id)).toEqual([900]);
  });

  it('the blowtorch stops at the map edge', () => {
    const s = lab();
    stand(s, 0, W - 40);
    s.slugs[0].facing = 1;
    s.slugs[0].aim = 0;
    choose(s, 'blowtorch');
    press(s);
    let most = 0;
    for (let t = 0; t < 300 && s.using; t++) {
      run(s, 1);
      most = Math.max(most, px(s.slugs[0].x));
    }
    expect(most).toBeGreaterThan(W - 30);
    expect(most).toBeLessThan(W - SLUG_HALF_W);
  });

  it('a teleport onto another slug is refused and spends nothing', () => {
    const s = lab();
    choose(s, 'teleport');
    const enemy = s.slugs[2];
    run(s, 1, { keys: 0, act: { t: 'target', x: px(enemy.x) + 3, y: px(enemy.y) } });
    expect(px(s.slugs[0].x)).toBe(300);
    expect(s.teams[0].ammo.teleport).toBe(WEAPON.teleport.ammo);
    expect(s.phase).toBe('turn');
    // The positive control: the same teleport beside the slug goes.
    run(s, 1, { keys: 0, act: { t: 'target', x: px(enemy.x) + 40, y: px(enemy.y) } });
    expect(px(s.slugs[0].x)).toBe(px(enemy.x) + 40);
  });

  for (const w of ['mine', 'dynamite'] as const) {
    it(`${w} dropped facing a wall lands outside the rock`, () => {
      const s = lab();
      rock(s, 300 + SLUG_HALF_W + 1, FLOOR - 60, 360, FLOOR);
      s.slugs[0].facing = 1;
      choose(s, w);
      press(s);
      run(s, 20);
      const body = w === 'mine' ? s.objs.find((o) => o.kind === 'mine') : s.projs.find((p) => p.kind === 'dynamite');
      expect(body?.kind).toBe(w);
      const b = body as { x: number; y: number };
      expect(clear(s, px(b.x), px(b.y))).toBe(true);
      expect(px(b.x)).toBeLessThanOrEqual(300 + SLUG_HALF_W);
    });
  }

  it('a jar wedged where a slope meets the floor comes to rest and goes off', () => {
    let wedged = 0;
    for (const slope of [0.25, 1, 2, 3]) {
      for (const [vx, vy] of [[1, -3], [1, 0], [3, 0], [3, 2]]) {
        const s = lab();
        for (let y = FLOOR - 60; y < FLOOR; y++) rock(s, 402 + Math.floor((FLOOR - y) * slope), y, 470, y + 1);
        // On its last fuse tick, so it goes off the moment it rests; 19661 is the jar's low bounce.
        s.projs.push(proj(s, 'jar', 401, FLOOR - 40, { x: 401 * ONE + 1234, vx: vx * ONE, vy: vy * ONE, fuse: 1, bounce: 19661, damage: 0, crater: 0 }));
        if (ofKind(run(s, 400), 'boom').length !== 1 || s.projs.length) wedged++;
      }
    }
    expect(wedged).toBe(0);
  });

  it('a jetpack that comes down on the land switches off and the slug stands', () => {
    const s = lab();
    choose(s, 'jetpack');
    press(s);
    run(s, 10, { keys: UP });
    expect(px(s.slugs[0].y)).toBeLessThan(FLOOR - SLUG_HALF_H - 5);
    const events = run(s, 120);
    expect(s.slugs[0].mode).toBe('stand');
    expect(ofKind(events, 'jet').map((e) => e.on)).toEqual([false]);
    expect(s.jetFuel).toBeGreaterThan(0);
  });
});

describe('edge cases', () => {
  it('a shot straight down at point blank blows a hole and the slug falls into it hurt', () => {
    const s = lab();
    s.slugs[0].aim = -90;
    choose(s, 'bazooka');
    const events = run(s, 2, { keys: FIRE }).concat(run(s, 1), untilNextTurn(s));
    expect(ofKind(events, 'hurt').some((e) => e.id === 0)).toBe(true);
    expect(s.slugs[0].y).toBeGreaterThan(base.slugs[0].y);
  });

  it('shots off the map edge end, and the turn passes', () => {
    const s = lab();
    stand(s, 0, 6);
    s.slugs[0].facing = -1;
    s.slugs[0].aim = 10;
    choose(s, 'grenade');
    run(s, 50, { keys: FIRE });
    untilNextTurn(s);
    expect(s.projs).toEqual([]);
  });

  it('a slug put in the water drowns at once, and a drowned active slug ends the turn', () => {
    const s = lab();
    s.slugs[0].y = (s.water + 2) * ONE;
    s.slugs[0].mode = 'air';
    const events = run(s, 1);
    expect(ofKind(events, 'drown').map((e) => e.id)).toEqual([0]);
    untilNextTurn(s);
    expect(s.activeTeam).toBe(1);
  });

  it('two blasts on one tick both land, and a barrel set off by one takes the next', () => {
    const s = lab();
    s.phase = 'settle';
    const near = barrel(s, 610);
    barrel(s, 630);
    s.projs = [proj(s, 'shell', 600, FLOOR - 4, { vy: 2 * ONE }), proj(s, 'shell', 900, FLOOR - 4, { vy: 2 * ONE })];
    const first = run(s, 1);
    expect(ofKind(first, 'boom').filter((e) => e.src === 'shell').map((e) => e.x)).toEqual([600, 900]);
    expect(near.hp).toBeLessThanOrEqual(0);
    const all = [...first, ...run(s, 200)];
    expect(ofKind(all, 'boom').filter((e) => e.src === 'barrel')).toHaveLength(2);
    expect(s.objs).toEqual([]);
  });

  it('a mine tripped by an enemy goes off (or fizzles) after its fuse, and a blast throws a mine aside', () => {
    const s = lab();
    s.phase = 'settle';
    const mine = { id: s.nextId++, kind: 'mine' as const, x: 1500 * ONE, y: (FLOOR - 2) * ONE, vx: 0, vy: 0, rest: true, fuse: -1, delay: 150, dud: false, hp: 0, arm: 0, gift: null, chute: false, laid: false };
    s.objs.push(mine);
    const events = run(s, 1);
    expect(ofKind(events, 'mine')).toHaveLength(1);
    const later = run(s, 160);
    expect(ofKind(later, 'boom').length + ofKind(later, 'dud').length).toBe(1);

    const t = lab();
    t.phase = 'settle';
    const other = { ...mine, id: t.nextId++, x: 1000 * ONE };
    t.objs.push(other);
    explode(t, 985, FLOOR - 2, 50, 48, 0);
    expect(other.rest).toBe(false);
    expect(other.vx).toBeGreaterThan(0);
  });

  it('the last slug of a team killed by falling ends the match', () => {
    const s = lab();
    s.slugs[1].hp = 0;
    s.slugs[1].alive = false;
    s.slugs[0].hp = 5;
    s.slugs[0].y = 0;
    s.slugs[0].mode = 'air';
    const events = untilNextTurn(s);
    expect(ofKind(events, 'fall').map((e) => e.id)).toEqual([0]);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(1);
  });

  it('the turn timer running out mid-charge ends the turn with nothing fired', () => {
    const s = lab();
    s.timeLeft = 5;
    choose(s, 'bazooka');
    const events = run(s, 70, { keys: FIRE });
    // The clock stops while charging, and the charge fires at full power.
    expect(ofKind(events, 'fire')).toHaveLength(1);
    const u = lab();
    u.timeLeft = 2;
    choose(u, 'bazooka');
    run(u, 2);
    expect(u.phase).toBe('settle');
    expect(ofKind(run(u, 5, { keys: FIRE }), 'fire')).toEqual([]);
  });

  it('skip and surrender while a shot is in flight leave it to land, and the turn passes', () => {
    for (const t of ['skip', 'surrender'] as const) {
      const s = lab();
      choose(s, 'grenade');
      run(s, 30, { keys: FIRE });
      run(s, 1);
      expect(s.projs).toHaveLength(1);
      advance(s, { keys: 0, act: { t } });
      expect(s.phase, t).toBe('settle');
      const events = untilNextTurn(s);
      expect(ofKind(events, 'boom').length, t).toBeGreaterThan(0);
      expect(s.projs).toEqual([]);
      if (t === 'surrender') expect([s.phase, s.winner]).toEqual(['over', 1]);
    }
  });
});

describe('no phase or physics loop that never ends', () => {
  /** A seeded mash of keys and acts: every weapon, jump, fuse, target and girder, but never a surrender. */
  function masher(seed: number) {
    let r = seed >>> 0;
    const next = (n: number) => {
      r = (Math.imul(r, 1664525) + 1013904223) >>> 0;
      return (r >>> 8) % n;
    };
    const acts = (): Input['act'] => {
      switch (next(9)) {
        case 0: return { t: 'jump' };
        case 1: return { t: 'flip' };
        case 2: return { t: 'backjump' };
        case 3: return { t: 'hop' };
        case 4: return { t: 'fuse', n: 1 + next(5) };
        case 5: return { t: 'bounce' };
        case 6: return { t: 'target', x: next(W), y: next(H) };
        case 7: return { t: 'girder', rot: next(8) };
        default: return { t: 'weapon', w: WEAPONS[next(WEAPONS.length)] };
      }
    };
    return (): Input => ({ keys: next(64), ...(next(25) === 0 && { act: acts() }) });
  }

  // Short turns and a fast flood end an honest match well inside this (mashed ones took 1-2k ticks); one that reaches it is stuck.
  const CAP = 60_000;

  it.each(MAP_DESIGN_IDS)('mashed matches on %s end inside the tick cap', (map) => {
    const start = newGame(7, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 2, {
      map, weapons: 'all', mines: 6, barrels: 4, turnSeconds: 5, roundMinutes: 1, waterRise: 100,
    });
    for (const seed of [1, 2, 3]) {
      const s = cloneState(start);
      const mash = masher(seed * 7919 + map.length);
      let turns = 0;
      while (s.phase !== 'over' && s.tick < CAP) {
        const was = s.phase;
        advance(s, mash());
        if (was === 'ready' && s.phase === 'turn') turns++;
      }
      expect(s.phase).toBe('over');
      expect(turns).toBeGreaterThan(1);
    }
  }, 30_000);
});

describe('determinism', () => {
  const INPUTS: Input[] = [
    { keys: 0, act: { t: 'weapon', w: 'cluster' } },
    ...Array.from({ length: 25 }, () => ({ keys: FIRE })),
    ...Array.from({ length: 40 }, () => ({ keys: LEFT })),
    { keys: 0, act: { t: 'backjump' } },
    ...Array.from({ length: 900 }, () => idle),
  ];

  const hashOf = (s: SlugsState) =>
    `${s.tick}:${s.rng}:${s.phase}:${s.slugs.map((g) => `${g.x},${g.y},${g.hp}`).join(';')}:${s.projs.map((p) => `${p.x},${p.y}`).join(';')}:${s.objs.map((o) => `${o.x},${o.y},${o.hp}`).join(';')}`;

  /** A hash of the board after each of INPUTS from `from` on. */
  function play(s: SlugsState, from = 0, to = INPUTS.length): string[] {
    const hashes: string[] = [];
    for (let i = from; i < to; i++) {
      advance(s, INPUTS[i]);
      hashes.push(hashOf(s));
    }
    return hashes;
  }

  it('the same inputs give the same board every tick, and a copy taken mid-way carries on the same', () => {
    const s = lab();
    barrel(s, 360);
    const a = cloneState(s);
    const b = cloneState(s);
    const once = play(a);
    expect(play(b)).toEqual(once);
    expect(b.terrain).toEqual(a.terrain);
    expect(new Set(once).size).toBeGreaterThan(100);
    const half = cloneState(s);
    const head = play(half, 0, 100);
    const copy = cloneState(half);
    expect([...head, ...play(copy, 100)]).toEqual(once);
    expect(copy.terrain).toEqual(a.terrain);
    // The copy is its own board: running it on leaves the original where it was.
    expect(half.tick).toBe(s.tick + 100);
  }, 20_000);
});

/** A crate lying on the flat lab's floor at `x`. */
function crate(s: SlugsState, x: number, gift: Gift): Obj {
  const o: Obj = { id: s.nextId++, kind: 'crate', x: x * ONE, y: (FLOOR - 6) * ONE, vx: 0, vy: 0, rest: true, fuse: -1, delay: 0, dud: false, hp: 1, arm: 0, gift, chute: false, laid: false };
  s.objs.push(o);
  return o;
}

/** Turns that run out on the clock with nothing fired, every tick checked and handed to `each`. */
function idleTurns(s: SlugsState, turns: number, each: (s: SlugsState) => void = () => {}): SlugEvent[] {
  const events: SlugEvent[] = [];
  for (let t = 0; t < turns; t++) {
    const team = s.activeTeam;
    for (let i = 0; ; i++) {
      if (i > 8000) throw new Error(`turn never passed: phase ${s.phase}`);
      if (s.phase === 'turn') s.timeLeft = Math.min(s.timeLeft, 1);
      events.push(...run(s, 1));
      each(s);
      if (s.phase === 'over') return events;
      if (s.phase === 'ready' && s.activeTeam !== team) break;
    }
  }
  return events;
}

/** The gift of each crate as it is dropped, taking every crate away again so the cap never stops the drops. */
function giftsDropped(s: SlugsState, turns: number): Gift[] {
  const gifts: Gift[] = [];
  const water = s.water;
  idleTurns(s, turns, (s) => {
    // In sudden death the water would rise each turn and drown the lab before many crates came.
    s.water = water;
    if (!s.events.some((e) => e.k === 'crate')) return;
    for (const o of s.objs) if (o.kind === 'crate' && o.gift) gifts.push(o.gift);
    s.objs = s.objs.filter((o) => o.kind !== 'crate');
  });
  return gifts;
}

describe('crates', () => {
  it('lose the parachute to a blast that shoves them, so they fall rather than float on', () => {
    const s = lab();
    s.phase = 'settle';
    const o = crate(s, 1000, 'health');
    o.y = 200 * ONE;
    o.rest = false;
    o.chute = true;
    explode(s, 1000 - 40, 200, 50, 30, 0);
    expect(o.vx).toBeGreaterThan(0);
    expect(o.chute).toBe(false);
    const far = crate(s, 1600, 'health');
    far.y = 200 * ONE;
    far.chute = true;
    explode(s, 1000, 200, 50, 30, 0);
    expect(far.chute).toBe(true);
  });

  it('parachute in between turns, never more than five, apart from everything, and come to rest on the land', () => {
    const s = lab();
    let most = 0;
    let dropped = 0;
    idleTurns(s, 40, (s) => {
      const crates = s.objs.filter((o) => o.kind === 'crate');
      most = Math.max(most, crates.length);
      if (!s.events.some((e) => e.k === 'crate')) return;
      dropped++;
      // The lab is flat, so every crate comes down to the same row.
      const c = s.objs[s.objs.length - 1];
      expect(c.kind).toBe('crate');
      expect(c.chute).toBe(true);
      expect(s.phase).toBe('ready');
      for (const o of s.objs) {
        if (o !== c) expect(Math.abs(px(o.x) - px(c.x)) + Math.abs(px(o.y) - (FLOOR - 6))).toBeGreaterThanOrEqual(64);
      }
    });
    expect(dropped).toBeGreaterThanOrEqual(5);
    expect(most).toBe(5);
    run(s, 600);
    for (const o of s.objs.filter((o) => o.kind === 'crate')) {
      expect(o.chute).toBe(false);
      expect(px(o.y)).toBe(FLOOR - 6);
    }
  }, 30_000);

  it('never land within 64 px of a barrel, mine or crate', () => {
    const s = lab();
    // Barrels 60 px apart along the whole floor leave nowhere far enough from one.
    for (let x = 10; x < W; x += 60) barrel(s, x);
    s.objs.forEach((o) => { o.hp = 1000; });
    expect(ofKind(idleTurns(s, 30), 'crate')).toEqual([]);
    // With two barrels in three gone, the gaps are 180 px and crates come into them.
    s.objs = s.objs.filter((_, i) => i % 3 === 0);
    const gaps = s.objs.map((o) => px(o.x));
    const drops = ofKind(idleTurns(s, 30), 'crate');
    expect(drops.length).toBeGreaterThan(0);
    for (const d of drops) expect(Math.min(...gaps.map((x) => Math.abs(x - d.x)))).toBeGreaterThanOrEqual(62);
  }, 30_000);

  it('do not come when the match has them off', () => {
    const s = lab();
    s.opts = { ...s.opts, crates: false };
    expect(ofKind(idleTurns(s, 30), 'crate')).toEqual([]);
  }, 30_000);

  it('hold weapons, health and utilities, and no health once sudden death has begun', () => {
    const gifts = giftsDropped(lab(), 60);
    expect(gifts.length).toBeGreaterThan(15);
    expect(gifts).toContain('health');
    expect(gifts.some((g) => g !== 'health' && WEAPON[g].category === 'utility')).toBe(true);
    expect(gifts.some((g) => g !== 'health' && WEAPON[g].category !== 'utility')).toBe(true);
    // A gift is something a team can be short of: never a weapon every team has without end.
    expect(gifts.every((g) => g === 'health' || WEAPON[g].ammo >= 0)).toBe(true);
    const late = lab();
    late.sudden = true;
    const lateGifts = giftsDropped(late, 60);
    expect(lateGifts.length).toBeGreaterThan(15);
    expect(lateGifts).not.toContain('health');
  }, 60_000);

  it('give health to the slug that reaches one, and a weapon to its team', () => {
    const s = lab();
    const hp = s.slugs[0].hp;
    crate(s, 330, 'health');
    const events = run(s, 200, { keys: RIGHT });
    expect(ofKind(events, 'gift')).toEqual([{ k: 'gift', id: 0, what: 'health', x: 330, y: FLOOR - 6 }]);
    expect(s.slugs[0].hp).toBe(hp + CRATE_HEALTH);
    expect(s.objs.some((o) => o.kind === 'crate')).toBe(false);

    const t = lab();
    const homing = t.teams[0].ammo.homing;
    const enemy = t.teams[1].ammo.homing;
    crate(t, px(t.slugs[2].x), 'homing');
    run(t, 2);
    expect(t.teams[1].ammo.homing).toBe(enemy + 1);
    expect(t.teams[0].ammo.homing).toBe(homing);
  });

  it('a utility found makes one the team can use, where before it had none to pick', () => {
    const s = lab();
    advance(s, { keys: 0, act: { t: 'weapon', w: 'laser' } });
    expect(s.weapon).not.toBe('laser');
    crate(s, px(s.slugs[0].x), 'laser');
    run(s, 2);
    expect(s.teams[0].ammo.laser).toBe(1);
    choose(s, 'laser');
  });

  it('a weapon crate that is shot goes off; a health crate is only broken', () => {
    for (const [gift, booms] of [['bazooka', 2], ['health', 1]] as const) {
      const s = lab();
      crate(s, 360, gift);
      s.slugs[0].facing = 1;
      s.slugs[0].aim = 0;
      choose(s, 'shotgun');
      const events = [...press(s), ...run(s, 5)];
      expect(ofKind(events, 'boom'), gift).toHaveLength(booms);
      expect(ofKind(events, 'gift')).toEqual([]);
      expect(s.objs.some((o) => o.kind === 'crate')).toBe(false);
    }
  });
});

describe('utilities', () => {
  /** Slug 0's team holding `n` of utility `w`, which it switches on. */
  function switchOn(s: SlugsState, w: 'lowgrav' | 'fastwalk' | 'laser' | 'double', n = 1): SlugEvent[] {
    s.teams[0].ammo[w] = n;
    choose(s, w);
    return press(s);
  }

  it('switch on without using up the turn, and put the weapon back in hand', () => {
    const s = lab();
    const events = switchOn(s, 'lowgrav', 2);
    expect(ofKind(events, 'boost')).toEqual([{ k: 'boost', id: 0, w: 'lowgrav' }]);
    expect(s.boost & BOOST.lowgrav).toBe(BOOST.lowgrav);
    expect(s.teams[0].ammo.lowgrav).toBe(1);
    expect(s.phase).toBe('turn');
    expect(s.weapon).toBe(s.teams[0].weapon);
    expect(s.teams[0].weapon).not.toBe('lowgrav');
    // One already on is not spent again.
    choose(s, 'lowgrav');
    expect(ofKind(press(s), 'boost')).toEqual([]);
    expect(s.teams[0].ammo.lowgrav).toBe(1);
    // The attack is still there to make.
    choose(s, 'shotgun');
    expect(ofKind(press(s), 'shot')).toHaveLength(1);
  });

  it('last until the next turn', () => {
    const s = lab();
    switchOn(s, 'double');
    expect(s.boost).toBe(BOOST.double);
    untilNextTurn(s);
    expect(s.boost).toBe(0);
  }, 20_000);

  it('low gravity halves gravity, so a jump stays up longer', () => {
    const airTime = (low: boolean) => {
      const s = lab();
      if (low) switchOn(s, 'lowgrav');
      expect(gravity(s)).toBe(low ? GRAVITY >> 1 : GRAVITY);
      advance(s, { keys: 0, act: { t: 'jump' } });
      let ticks = 0;
      while (s.slugs[0].mode !== 'stand' && ticks < 400) {
        run(s, 1);
        ticks++;
      }
      return ticks;
    };
    const normal = airTime(false);
    expect(normal).toBeGreaterThan(10);
    expect(airTime(true)).toBeGreaterThan(normal * 1.3);
  });

  it('fast walk covers twice the ground', () => {
    const walked = (fast: boolean) => {
      const s = lab();
      if (fast) switchOn(s, 'fastwalk');
      const x = px(s.slugs[0].x);
      run(s, 90, { keys: RIGHT });
      return px(s.slugs[0].x) - x;
    };
    const normal = walked(false);
    expect(normal).toBeGreaterThan(10);
    const fast = walked(true);
    expect(fast).toBeGreaterThanOrEqual(normal * 1.8);
    expect(fast).toBeLessThanOrEqual(normal * 2.2);
  });

  it('double damage doubles the attack, but not a barrel it sets off', () => {
    const shotgunDamage = (double: boolean) => {
      const s = lab();
      stand(s, 2, 380);
      if (double) switchOn(s, 'double');
      s.slugs[0].facing = 1;
      s.slugs[0].aim = 0;
      choose(s, 'shotgun');
      return ofKind(press(s), 'hurt').filter((e) => e.id === 2).reduce((n, e) => n + e.dmg, 0);
    };
    const normal = shotgunDamage(false);
    expect(normal).toBeGreaterThan(0);
    expect(shotgunDamage(true)).toBeGreaterThanOrEqual(2 * normal);

    const barrelDamage = (double: boolean) => {
      const s = lab();
      if (double) s.boost = BOOST.double;
      const before = s.slugs[2].hp;
      explode(s, px(s.slugs[2].x) + 6, FLOOR - 8, 30, 20, 0, 'barrel');
      return before - s.slugs[2].hp;
    };
    expect(barrelDamage(false)).toBeGreaterThan(0);
    expect(barrelDamage(true)).toBe(barrelDamage(false));
  });

  it("the laser sight's line ends where the shot does", () => {
    const s = lab();
    stand(s, 2, 380);
    switchOn(s, 'laser');
    const slug = s.slugs[0];
    slug.facing = 1;
    slug.aim = 0;
    const sight = shotEnd(s, slug, 0, shotRange('shotgun'));
    expect(sight.stop).toBe('hit');
    expect(Math.abs(sight.x1 - 380)).toBeLessThanOrEqual(4);
    choose(s, 'shotgun');
    const [shot] = ofKind(press(s), 'shot');
    expect([shot.x1, shot.y1]).toEqual([sight.x1, sight.y1]);
    expect(shotEnd(s, slug, 89, shotRange('shotgun')).stop).toBe('away');
  });

  it('can be switched on in flight, and the jetpack keeps flying', () => {
    const s = lab();
    s.teams[0].ammo.lowgrav = 1;
    choose(s, 'jetpack');
    press(s);
    run(s, 20, { keys: UP });
    expect(s.slugs[0].mode).toBe('jet');
    choose(s, 'lowgrav');
    const events = [...run(s, 1, { keys: FIRE | UP }), ...run(s, 1, { keys: UP })];
    expect(ofKind(events, 'boost')).toHaveLength(1);
    expect(s.slugs[0].mode).toBe('jet');
    expect(s.teams[0].ammo.lowgrav).toBe(0);
  });

  it('switched on while flying the last jetpack, leaves the jetpack in hand, so fire still switches it off', () => {
    const s = lab();
    s.teams[0].ammo.jetpack = 1;
    s.teams[0].ammo.double = 1;
    choose(s, 'jetpack');
    press(s);
    run(s, 20, { keys: UP });
    expect(s.teams[0].ammo.jetpack).toBe(0);
    choose(s, 'double');
    run(s, 1, { keys: FIRE | UP });
    run(s, 1, { keys: UP });
    expect(s.weapon).toBe('jetpack');
    const events = [...run(s, 1, { keys: FIRE }), ...run(s, 5)];
    expect(s.slugs[0].mode).toBe('air');
    expect(s.charging).toBe(false);
    expect(ofKind(events, 'fire')).toEqual([]);
    expect(s.phase).toBe('turn');
  });

  it('double damage counts for a mine laid this turn, not one already on the map, and the laying is forgotten next turn', () => {
    const mineDamage = (laid: boolean, double: boolean) => {
      const s = lab();
      if (double) s.boost = BOOST.double;
      s.dudBag = [0, 0];
      s.phase = 'settle';
      const x = px(s.slugs[2].x) + 10;
      s.objs.push({ id: s.nextId++, kind: 'mine', x: x * ONE, y: (FLOOR - 2) * ONE, vx: 0, vy: 0, rest: true, fuse: 1, delay: 1, dud: false, hp: 0, arm: 0, gift: null, chute: false, laid });
      const before = s.slugs[2].hp;
      expect(ofKind(run(s, 3), 'boom')).toHaveLength(1);
      return before - s.slugs[2].hp;
    };
    const normal = mineDamage(true, false);
    expect(normal).toBeGreaterThan(0);
    expect(mineDamage(true, true)).toBeGreaterThanOrEqual(2 * normal);
    expect(mineDamage(false, true)).toBe(mineDamage(false, false));

    const s = lab();
    choose(s, 'mine');
    press(s);
    const laid = s.objs.filter((o) => o.kind === 'mine' && o.laid);
    expect(laid).toHaveLength(1);
    // Never armed, so the slug that laid it cannot set it off before the next turn.
    laid[0].arm = 99999;
    untilNextTurn(s);
    expect(s.objs).toContain(laid[0]);
    expect(laid[0].laid).toBe(false);
  });
});
