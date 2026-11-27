import { beforeAll, describe, expect, it } from 'vitest';
import {
  ONE,
  SLUG_HALF_H,
  SLUG_HALF_W,
  STEEL,
  W,
  WEAPON,
  WEAPONS,
  advance,
  cloneState,
  newGame,
  newPlan,
  px,
  type Control,
  type Input,
  type SlugsOptions,
  type SlugsState,
  type WeaponId,
} from '../slugsGameLogic';
import { MAP_DESIGN_IDS, type MapDesignId } from '../slugsMaps';

const idle: Input = { keys: 0 };
const FLOOR = 400;
/** Ticks a computer-only match may take: about 50 minutes of play. */
const MATCH_TICKS = 150_000;

function fnv(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193) >>> 0;
  return h;
}

const hashOf = (s: SlugsState) => JSON.stringify({ ...s, terrain: fnv(s.terrain) });

interface Played {
  map: MapDesignId;
  levels: [number, number];
  ticks: number;
  winnerLevel: number | null;
  /** Per level: the computer's turns, its own side's and the other side's hp lost in them, and turns its slug died in. */
  turns: Record<number, { turns: number; ownLost: number; enemyLost: number; died: number }>;
  /** Ticks the computer spent thinking, each timed on its own. */
  thinkMs: number[];
  fired: Set<WeaponId>;
  moved: number;
}

function play(seed: number, map: MapDesignId, levels: [number, number], options: Partial<SlugsOptions> = {}): Played {
  const s = newGame(seed, [{ name: 'A', control: levels[0] as Control }, { name: 'B', control: levels[1] as Control }], 2, { map, ...options });
  const out: Played = { map, levels, ticks: 0, winnerLevel: null, turns: {}, thinkMs: [], fired: new Set(), moved: 0 };
  let team = -1;
  let active = -1;
  let hpAt: number[] = [];
  const close = () => {
    if (team < 0) return;
    const level = s.teams[team].control as number;
    const t = (out.turns[level] ??= { turns: 0, ownLost: 0, enemyLost: 0, died: 0 });
    t.turns++;
    for (const g of s.slugs) {
      const lost = Math.max(0, hpAt[g.id] - (g.alive ? Math.max(0, g.hp) : 0));
      if (g.team === team) t.ownLost += lost;
      else t.enemyLost += lost;
    }
    if (hpAt[active] > 0 && !s.slugs[active].alive) t.died++;
  };
  while (s.phase !== 'over' && s.tick < MATCH_TICKS) {
    const stage = s.plan?.stage;
    const thinking = s.phase === 'turn' && stage !== 'move' && stage !== 'aim';
    const t0 = performance.now();
    advance(s, idle);
    if (thinking) out.thinkMs.push(performance.now() - t0);
    if (s.plan?.stage === 'move' && stage !== 'move') out.moved++;
    for (const e of s.events) if (e.k === 'fire') out.fired.add(e.w);
    if (s.events.some((e) => e.k === 'turn')) {
      close();
      team = s.activeTeam;
      active = s.active;
      hpAt = s.slugs.map((g) => (g.alive ? Math.max(0, g.hp) : 0));
    }
  }
  close();
  out.ticks = s.tick;
  if (s.phase === 'over' && s.winner !== null) out.winnerLevel = s.teams[s.winner].control as number;
  return out;
}

const total = (games: Played[], level: number) => {
  const t = { turns: 0, ownLost: 0, enemyLost: 0, died: 0 };
  for (const g of games) {
    const l = g.turns[level];
    if (!l) continue;
    t.turns += l.turns;
    t.ownLost += l.ownLost;
    t.enemyLost += l.enemyLost;
    t.died += l.died;
  }
  return t;
};

describe('the computer against itself, on every map design', () => {
  const games: Played[] = [];
  beforeAll(() => {
    // Sides swap from map to map, so going first is no help to either level.
    MAP_DESIGN_IDS.forEach((map, i) => games.push(play(3, map, i % 2 ? [1, 5] : [5, 1])));
  }, 240_000);

  it('plays every match to a finish inside the tick budget', () => {
    expect(games).toHaveLength(MAP_DESIGN_IDS.length);
    expect(games.filter((g) => g.winnerLevel === null).map((g) => `${g.map} ${g.ticks}`)).toEqual([]);
    for (const g of games) expect(g.ticks).toBeLessThan(MATCH_TICKS);
  });

  it('level 5 beats level 1 in most matches', () => {
    expect(games.filter((g) => g.winnerLevel === 5).length).toBeGreaterThanOrEqual(10);
  });

  it('hurts its own side rarely, even at level 1', () => {
    for (const level of [1, 5]) {
      const t = total(games, level);
      expect(t.turns).toBeGreaterThan(20);
      expect(t.ownLost / t.turns).toBeLessThan(0.5);
      expect(t.died).toBeLessThanOrEqual(1);
    }
  });

  it('level 1 lands far less of its fire than level 5, but still lands some', () => {
    const l1 = total(games, 1);
    const l5 = total(games, 5);
    expect(l1.enemyLost / l1.turns).toBeGreaterThan(1);
    expect(l1.enemyLost / l1.turns).toBeLessThan((l5.enemyLost / l5.turns) / 2);
  });

  it('thinks a piece a tick, never long on one', () => {
    const ms = games.flatMap((g) => g.thinkMs).sort((a, b) => a - b);
    expect(ms.length).toBeGreaterThan(1000);
    // Percentiles, as any one tick can stall behind a busy machine in a full run.
    expect(ms[ms.length >> 1]).toBeLessThan(15);
    expect(ms[Math.floor(ms.length * 0.99)]).toBeLessThan(80);
  });

  it('uses each of the classic weapons somewhere', () => {
    const fired = new Set(games.flatMap((g) => [...g.fired]));
    for (const w of ['bazooka', 'grenade', 'cluster', 'airstrike'] as const) expect(fired).toContain(w);
    expect(games.reduce((n, g) => n + g.moved, 0)).toBeGreaterThan(0);
  });
});

describe('the computer with every weapon', () => {
  const games: Played[] = [];
  beforeAll(() => {
    for (const map of MAP_DESIGN_IDS) games.push(play(5, map, [3, 3], { weapons: 'all', mines: 4, barrels: 3 }));
  }, 240_000);

  it('plays every match to a finish and hurts itself rarely', () => {
    expect(games.filter((g) => g.winnerLevel === null).map((g) => `${g.map} ${g.ticks}`)).toEqual([]);
    const t = total(games, 3);
    expect(t.ownLost / t.turns).toBeLessThan(1.5);
    expect(t.died).toBeLessThanOrEqual(1);
  });

  it('reaches past the bazooka and the grenade', () => {
    const fired = new Set(games.flatMap((g) => [...g.fired]));
    const others = WEAPONS.filter((w) => w !== 'bazooka' && w !== 'grenade' && fired.has(w));
    expect(others.length).toBeGreaterThanOrEqual(5);
  });
});

describe('the same match twice', () => {
  it('replays identically, and a copy taken mid-turn carries on the same', () => {
    const start = () => newGame(8, [{ name: 'A', control: 4 }, { name: 'B', control: 2 }], 2, { map: 'forts', weapons: 'all', mines: 4 });
    const a = start();
    const b = start();
    let copy: SlugsState | null = null;
    while (a.phase !== 'over' && a.tick < MATCH_TICKS) {
      advance(a, idle);
      // Partway through the computer's thinking, so its plan must carry the search.
      if (!copy && a.plan && a.plan.stage === 'shots' && a.plan.step === 3) copy = cloneState(a);
    }
    while (b.phase !== 'over' && b.tick < MATCH_TICKS) advance(b, idle);
    expect(a.phase).toBe('over');
    expect(hashOf(b)).toBe(hashOf(a));
    expect(copy).not.toBeNull();
    const c = copy as SlugsState;
    while (c.tick < a.tick) advance(c, idle);
    expect(hashOf(c)).toBe(hashOf(a));
  }, 120_000);
});

// --- Set pieces ---

/**
 * Slug 0 (the computer at level 5) at x on flat ground at FLOOR, slug 1 (a
 * person) at enemyX, slug 0's turn just begun, no wind, and only `weapons`
 * in stock.
 */
function lab(x: number, enemyX: number, weapons: WeaponId[]): SlugsState {
  const s = newGame(1, [{ name: 'A', control: 5 }, { name: 'B', control: 'human' }], 1);
  s.terrain.fill(0);
  s.terrain.fill(1, FLOOR * W);
  s.objs = [];
  s.projs = [];
  s.activeTeam = 0;
  s.active = 0;
  s.phase = 'turn';
  s.phaseT = 0;
  s.wind = 0;
  s.plan = null;
  for (const w of WEAPONS) s.teams[0].ammo[w] = weapons.includes(w) ? -1 : 0;
  s.weapon = weapons[0];
  for (const [id, at] of [[0, x], [1, enemyX]]) {
    const g = s.slugs[id];
    g.x = at * ONE;
    g.y = (FLOOR - SLUG_HALF_H) * ONE;
    g.mode = 'stand';
    g.facing = 1;
  }
  return s;
}

function fill(s: SlugsState, x0: number, y0: number, x1: number, y1: number, v: number): void {
  for (let y = Math.max(0, y0); y < y1; y++) s.terrain.fill(v, y * W + x0, y * W + x1);
}

/** Run the computer's turn until the damage is counted, and say how far it got from where it started. */
function playTurn(s: SlugsState) {
  const x0 = px(s.slugs[0].x);
  let furthest = x0;
  while (s.phase === 'turn' || s.phase === 'retreat' || s.phase === 'settle') {
    advance(s, idle);
    furthest = Math.max(furthest, px(s.slugs[0].x));
  }
  return { furthest, end: px(s.slugs[0].x) };
}

/** A steel tunnel over the enemy, too low to lob into and too thick to blast through: only a straight shot from close enough reaches it. */
function tunnel(s: SlugsState): void {
  fill(s, 900, FLOOR - 140, W, FLOOR - 26, STEEL);
}

describe('moving to get a shot', () => {
  it('walks, jumping a step too high to climb, until the shotgun reaches', () => {
    const s = lab(480, 1500, ['shotgun', 'bazooka']);
    tunnel(s);
    fill(s, 560, FLOOR - 20, 566, FLOOR, STEEL);
    const { furthest } = playTurn(s);
    expect(furthest).toBeGreaterThan(600);
    expect(s.slugs[0].hp).toBe(100);
    expect(s.slugs[1].hp).toBeLessThan(100);
  }, 30_000);

  it('does not walk off a cliff into the water for it', () => {
    const s = lab(480, 1500, ['shotgun', 'bazooka']);
    tunnel(s);
    fill(s, 540, 0, 640, s.water + 40, 0);
    const { furthest } = playTurn(s);
    expect(s.slugs[0].alive).toBe(true);
    expect(s.slugs[0].hp).toBe(100);
    expect(furthest).toBeLessThan(540);
  }, 30_000);

  it('drops dynamite by an enemy and walks clear of it', () => {
    const s = lab(300, 318, ['dynamite']);
    const { end } = playTurn(s);
    expect(s.slugs[1].hp).toBeLessThan(100);
    expect(s.slugs[0].hp).toBe(100);
    expect(Math.abs(end - 300)).toBeGreaterThan(60);
  }, 30_000);

  it('walks clear of its own dynamite only as far as a cliff edge', () => {
    // The retreat is not rehearsed, so the walk itself must refuse the drop.
    const s = lab(300, 900, ['dynamite']);
    fill(s, 200, 0, 270, s.water + 40, 0);
    s.plan = { ...newPlan(), weapon: 'dynamite', tx: 320, ty: FLOOR - SLUG_HALF_H };
    s.phase = 'retreat';
    s.timeLeft = WEAPON.dynamite.retreat;
    const { end } = playTurn(s);
    expect(s.slugs[0].alive).toBe(true);
    expect(end).toBeLessThan(290);
    expect(end).toBeGreaterThanOrEqual(270 - SLUG_HALF_W);
  }, 30_000);
});
