import { describe, it, expect } from 'vitest';
import { H, ONE, SLUG_HALF_H, W, WATER_START, advance, buildTerrain, cloneState, newGame, px, type SlugsState } from '../slugsGameLogic';
import { buildMap, MAP_DESIGN_IDS, type MapDesignId } from '../slugsMaps';

// Each design takes about 60 ms to build, so the per-seed checks share these lands.
const SEEDS = Array.from({ length: 12 }, (_, i) => i + 1);
const built = new Map<string, Uint8Array>();
const land = (id: MapDesignId, seed: number) => {
  const key = `${id}:${seed}`;
  if (!built.has(key)) built.set(key, buildMap(id, seed));
  return built.get(key)!;
};

// toEqual walks a 1.3 MB mask element by element with diff bookkeeping and takes seconds; this takes a millisecond.
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const solid = (t: Uint8Array, x: number, y: number) => t[y * W + x] !== 0;
const top = (t: Uint8Array, x: number) => {
  for (let y = 0; y < WATER_START; y++) if (solid(t, x, y)) return y;
  return WATER_START;
};
const highest = (t: Uint8Array, a: number, b: number) => {
  let m = WATER_START;
  for (let x = a; x < b; x++) m = Math.min(m, top(t, x));
  return m;
};
/** Widths of the separate stretches of land along row y. */
const runs = (t: Uint8Array, y: number) => {
  const out: number[] = [];
  let len = 0;
  for (let x = 0; x <= W; x++) {
    if (x < W && solid(t, x, y)) len++;
    else {
      if (len >= 6) out.push(len);
      len = 0;
    }
  }
  return out;
};
const cover = (t: Uint8Array, y: number, a: number, b: number) => {
  let n = 0;
  for (let x = a; x < b; x++) if (solid(t, x, y)) n++;
  return n / (b - a);
};
/** Longest stretch of air along row y in the middle 40% of the map. */
const middleGap = (t: Uint8Array, y: number) => {
  let best = 0;
  let len = 0;
  for (let x = (W * 3) / 10; x < (W * 7) / 10; x++) {
    if (!solid(t, x, y)) best = Math.max(best, ++len);
    else len = 0;
  }
  return best;
};
/** Air below the surface in the middle 40%: tubes, rooms, the crater bowl under a plug. */
const innerAir = (t: Uint8Array) => {
  let n = 0;
  for (let x = (W * 3) / 10; x < (W * 7) / 10; x++) for (let y = top(t, x); y < WATER_START; y++) if (!solid(t, x, y)) n++;
  return n;
};
/** Columns with rock, then at least 40 px of air, then rock again: somewhere to shelter under. */
const overhangs = (t: Uint8Array) => {
  let n = 0;
  for (let x = 0; x < W; x++) {
    let y = top(t, x);
    while (y < WATER_START && solid(t, x, y)) y++;
    const gapFrom = y;
    while (y < WATER_START && !solid(t, x, y)) y++;
    if (y < WATER_START && y - gapFrom >= 40) n++;
  }
  return n;
};
/** Longest air drop straight under the first rock in the middle third, for a rock whose top is above y 400. */
const span = (t: Uint8Array) => {
  let best = 0;
  for (let x = W / 3; x < (2 * W) / 3; x++) {
    let y = top(t, x);
    if (y >= 400) continue;
    while (y < WATER_START && solid(t, x, y)) y++;
    const from = y;
    while (y < WATER_START && !solid(t, x, y)) y++;
    best = Math.max(best, y - from);
  }
  return best;
};
/** Share of the outer thirds that matches its mirror image. */
const mirror = (t: Uint8Array) => {
  let same = 0;
  let all = 0;
  for (let y = 0; y < WATER_START; y++)
    for (let x = 0; x < W / 3; x++) {
      const a = solid(t, x, y);
      const b = solid(t, W - 1 - x, y);
      if (a || b) {
        all++;
        if (a === b) same++;
      }
    }
  return same / all;
};
/** Land masses of 1500+ px whose lowest pixel is 40+ px clear of the water. */
const floaters = (t: Uint8Array) => {
  const seen = new Uint8Array(W * WATER_START);
  const stack: number[] = [];
  let n = 0;
  for (let i = 0; i < W * WATER_START; i++) {
    if (!t[i] || seen[i]) continue;
    let size = 0;
    let low = 0;
    seen[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      size++;
      const x = j % W;
      const y = (j / W) | 0;
      low = Math.max(low, y);
      const next = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < WATER_START - 1 ? j + W : -1];
      for (const k of next) if (k >= 0 && t[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
    if (size >= 1500 && low < WATER_START - 40) n++;
  }
  return n;
};
/** How far the deepest point within 160 px of the summit sits below it: the crater. */
const crater = (t: Uint8Array) => {
  let peak = WATER_START;
  let at = 0;
  for (let x = W / 4; x < (3 * W) / 4; x++) {
    const y = top(t, x);
    if (y < peak) {
      peak = y;
      at = x;
    }
  }
  let left = 0;
  let right = 0;
  for (let x = at - 160; x < at; x++) left = Math.max(left, top(t, x));
  for (let x = at; x < at + 160; x++) right = Math.max(right, top(t, x));
  // A crater has the summit on one rim and the bowl on one side of it, so the deeper side counts.
  return Math.max(left, right) - peak;
};
/**
 * Air pockets above the water that reach none of: the top row, a side, the
 * water. A map closed everywhere may keep one, its playing room.
 */
const sealedPockets = (t: Uint8Array) => {
  const label = new Int32Array(W * WATER_START).fill(-1);
  const stack: number[] = [];
  let open = 0;
  let shut = 0;
  for (let i = 0; i < W * WATER_START; i++) {
    if (t[i] || label[i] >= 0) continue;
    let edge = false;
    label[i] = 1;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % W;
      if (j < W || x === 0 || x === W - 1 || j >= W * (WATER_START - 1)) edge = true;
      const next = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j >= W ? j - W : -1, j + W < W * WATER_START ? j + W : -1];
      for (const k of next) if (k >= 0 && !t[k] && label[k] < 0) { label[k] = 1; stack.push(k); }
    }
    if (edge) open++;
    else shut++;
  }
  return open > 0 ? shut : Math.max(0, shut - 1);
};

const rockAt = (t: Uint8Array, x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H && t[y * W + x] !== 0;
const LEFT = 1;
const RIGHT = 2;

/**
 * What is wrong with ground for a slug-sized thing with its feet on row
 * `foot` at x, or '' if nothing: every column 6 px either side meets rock
 * within a walking step (8 px) of the foot, nothing sits at its shoulders or
 * in the 24 px over its head, and it is 30 px from the side.
 */
function badGround(t: Uint8Array, x: number, foot: number): string {
  if (x < 30 || x > W - 30) return 'at the edge';
  for (let dx = -6; dx <= 6; dx++) {
    let ground = foot - 9;
    while (ground <= foot + 8 && !rockAt(t, x + dx, ground)) ground++;
    if (ground > foot + 8) return `no ground within 8 px under dx ${dx}`;
    if (ground === foot - 9) return `a step over 8 px at dx ${dx}`;
    for (let y = foot - 16 - 24; y < foot - 9; y++) if (rockAt(t, x + dx, y)) return `rock ${foot - y} px up at dx ${dx}`;
  }
  return '';
}

/**
 * Whether slug `id` has 100 px of room, left and right together, in a turn of
 * its own by the real controls: walking, and when a wall stops it, backing off
 * and jumping or backflipping over it as a player would. Dropping more than
 * 16 px below where it started (off a ledge, so out of any hole it stood in),
 * into the water or off the side counts as out. Slugs walk through each
 * other; the mines and barrels are taken away so only the land can hold it.
 */
function walksOut(game: SlugsState, id: number): boolean {
  // Ticks to back off before each try: a forward jump needs a run-up, a backflip goes up nearly straight.
  const tries: [number, 'jump' | 'flip'][] = [[40, 'jump'], [8, 'flip'], [90, 'jump']];
  const x0 = px(game.slugs[id].x);
  const y0 = px(game.slugs[id].y);
  const out = (s: SlugsState) => {
    const me = s.slugs[id];
    return Math.abs(px(me.x) - x0) >= 100 || px(me.y) - y0 > 16 || px(me.y) + SLUG_HALF_H >= WATER_START || !me.alive;
  };
  let room = 0;
  for (const keys of [LEFT, RIGHT]) {
    const dir = keys === LEFT ? -1 : 1;
    let far = 0;
    let s = cloneState(game);
    s.objs = [];
    s.activeTeam = s.slugs[id].team;
    s.active = id;
    s.teams[s.activeTeam].last = id;
    s.phase = 'turn';
    s.phaseT = 0;
    s.wind = 0;
    let stall = 0;
    let lastX = x0;
    for (let k = 0; k < 1500; k++) {
      advance(s, { keys });
      if (out(s)) return true;
      const x = px(s.slugs[id].x);
      far = Math.max(far, (x - x0) * dir);
      stall = x === lastX && s.slugs[id].mode === 'stand' ? stall + 1 : 0;
      lastX = x;
      if (stall < 20) continue;
      // A wall: back off and go over it, or this way is shut.
      const wall = x;
      const over = tries
        .map(([ticks, move]) => {
          const at = cloneState(s);
          for (let i = 0; i < ticks; i++) advance(at, { keys: keys === LEFT ? RIGHT : LEFT });
          if (move === 'jump') advance(at, { keys });
          advance(at, { keys: 0, act: { t: move } });
          for (let i = 0; i < 200 && at.slugs[id].mode !== 'stand' && !out(at); i++) advance(at, { keys: 0 });
          return at;
        })
        .find((at) => out(at) || (px(at.slugs[id].x) - wall) * dir > 6);
      if (!over) break;
      if (out(over)) return true;
      s = over;
      stall = 0;
      lastX = px(s.slugs[id].x);
    }
    room += far;
  }
  return room >= 100;
}

function badStarts(game: SlugsState, escapes: boolean): string[] {
  const t = game.terrain;
  const out: string[] = [];
  game.slugs.forEach((g, id) => {
    const why = badGround(t, px(g.x), px(g.y) + SLUG_HALF_H) || (escapes && !walksOut(game, id) ? 'in a pit' : '');
    if (why) out.push(`slug at ${px(g.x)},${px(g.y)}: ${why}`);
  });
  for (const o of game.objs) {
    const half = o.kind === 'mine' ? 2 : 8;
    const why = badGround(t, px(o.x), px(o.y) + half);
    if (why) out.push(`${o.kind} at ${px(o.x)},${px(o.y)}: ${why}`);
    for (const g of game.slugs) if (Math.abs(px(g.x) - px(o.x)) < 16 && Math.abs(px(g.y) - px(o.y)) < 20) out.push(`${o.kind} touches a slug`);
  }
  return out;
}

const SIGNATURE: Record<Exclude<MapDesignId, 'classic'>, (t: Uint8Array) => boolean> = {
  cavern: (t) => cover(t, 4, 0, W) >= 0.9,
  sky: (t) => floaters(t) >= 6 && cover(t, WATER_START - 12, 0, W) < 0.15,
  forts: (t) => mirror(t) >= 0.95 && highest(t, 0, W / 3) <= 240 && highest(t, (2 * W) / 3, W) <= 240,
  canyon: (t) =>
    Math.min(middleGap(t, 450), middleGap(t, 560)) >= 40 &&
    Math.min(cover(t, 300, 0, W / 3), cover(t, 300, (2 * W) / 3, W)) >= 0.75,
  hive: (t) => runs(t, WATER_START - 12).length === 1 && innerAir(t) >= 60000,
  spires: (t) => runs(t, WATER_START - 12).length >= 7 && highest(t, 0, W) <= 240,
  arch: (t) => span(t) >= 200 && Math.min(cover(t, 400, 0, W / 6), cover(t, 400, (5 * W) / 6, W)) >= 0.82,
  toadstools: (t) => overhangs(t) >= 600,
  wreck: (t) => t.filter((v) => v === 2).length >= 20000,
  volcano: (t) => highest(t, W / 3, (2 * W) / 3) <= 200 && crater(t) >= 60 && innerAir(t) >= 8000,
  archipelago: (t) => runs(t, WATER_START - 12).length >= 8 && Math.max(...runs(t, WATER_START - 12)) <= 200 && highest(t, 0, W) >= 260,
};

const START_SEEDS = 16;

describe('the start checks', () => {
  const flat = () => {
    const game = newGame(1, [{ name: 'A', control: 'human' }, { name: 'B', control: 'human' }], 1);
    game.terrain.fill(0);
    game.terrain.fill(1, 500 * W);
    game.objs = [];
    game.slugs.forEach((slug, i) => {
      slug.x = (600 + 700 * i) * ONE;
      slug.y = (500 - SLUG_HALF_H) * ONE;
      slug.mode = 'stand';
    });
    return game;
  };

  it('pass a slug on open flat ground', () => {
    expect(badStarts(flat(), true)).toEqual([]);
  });

  it('catch a perch, an overhang, a low roof and the map edge', () => {
    const spike = flat();
    spike.terrain.fill(0, 490 * W, 510 * W);
    for (let y = 490; y < 510; y++) spike.terrain[y * W + 600] = 1;
    spike.slugs[0].y = (490 - SLUG_HALF_H) * ONE;
    expect(badGround(spike.terrain, 600, 490)).toMatch(/no ground/);
    const ledge = flat();
    for (let y = 500; y < 520; y++) ledge.terrain.fill(0, y * W + 603, y * W + 700);
    expect(badGround(ledge.terrain, 600, 500)).toMatch(/no ground within 8 px under dx 3/);
    const roof = flat();
    roof.terrain.fill(1, 470 * W + 590, 470 * W + 610);
    expect(badGround(roof.terrain, 600, 500)).toMatch(/rock 30 px up/);
    expect(badGround(flat().terrain, 20, 500)).toBe('at the edge');
  });

  it('catch a slug in a pit with walls taller than a jump', () => {
    const pit = flat();
    for (let y = 440; y < 500; y++) {
      pit.terrain.fill(1, y * W + 560, y * W + 570);
      pit.terrain.fill(1, y * W + 630, y * W + 640);
    }
    expect(badStarts(pit, true)).toEqual([expect.stringMatching(/in a pit/)]);
    // A wall a jump clears is no pit.
    const low = flat();
    for (let y = 480; y < 500; y++) low.terrain.fill(1, y * W + 630, y * W + 640);
    for (let y = 440; y < 500; y++) low.terrain.fill(1, y * W + 560, y * W + 570);
    expect(badStarts(low, true)).toEqual([]);
  });
});

describe('slugs map designs', () => {
  it('classic is the original island land', () => {
    for (const s of [1, 2, 3]) expect(same(land('classic', s), buildTerrain(s))).toBe(true);
  });

  for (const id of MAP_DESIGN_IDS) {
    describe(id, () => {
      it('is the same land for the same seed and a different land for each seed', () => {
        for (const s of [1, 7, 13]) expect(same(buildMap(id, s), land(id, s))).toBe(true);
        const prints = new Set(SEEDS.map((s) => Array.from(land(id, s).filter((_, i) => i % 97 === 0)).join('')));
        expect(prints.size).toBe(SEEDS.length);
      }, 30000);

      it('fits the map and uses only the four mask values', () => {
        for (const s of SEEDS.slice(0, 5)) {
          const t = land(id, s);
          expect(t.length).toBe(W * H);
          expect(t.every((v) => v <= 3)).toBe(true);
        }
      });

      // Classic is the original land, caves carved shut and all; changing it would change every existing game.
      if (id !== 'classic') {
        it('leaves no air pocket sealed off from the open', () => {
          for (const s of SEEDS) expect(sealedPockets(land(id, s)), `seed ${s}`).toBe(0);
        }, 30000);
      }

      it('seats 2 and 6 teams of 8 on its own land, apart and above the water', () => {
        for (const s of SEEDS.slice(0, 5)) {
          for (const teams of [2, 6]) {
            const setups = Array.from({ length: teams }, (_, i) => ({ name: `T${i}`, control: 'human' as const }));
            const game = newGame(s, setups, 8, { map: id });
            // newGame swaps in another land when this one cannot seat everyone. Classic's rolling hills
            // sometimes leave too little level ground for 48 and may take the one swap the original game took.
            const own = same(game.terrain, land(id, s));
            const swapped = id === 'classic' && !own && same(game.terrain, buildMap(id, (s + 7919) >>> 0));
            expect(own || swapped, `seed ${s}, ${teams} teams`).toBe(true);
            expect(game.slugs.length).toBe(teams * 8);
            let nearestEnemy = Infinity;
            for (const a of game.slugs) {
              expect(px(a.y)).toBeLessThan(WATER_START);
              for (const b of game.slugs) {
                if (a.team === b.team) continue;
                nearestEnemy = Math.min(nearestEnemy, Math.hypot(px(a.x) - px(b.x), px(a.y) - px(b.y)));
              }
            }
            // The rules halve the 140 px enemy gap at most twice.
            expect(nearestEnemy).toBeGreaterThanOrEqual(35);
          }
        }
      }, 60000);

      it('starts every slug, mine and barrel on firm ground with headroom, off the edge and out of pits', () => {
        const setups = Array.from({ length: 4 }, (_, i) => ({ name: `T${i}`, control: 'human' as const }));
        let objs = 0;
        for (let s = 1; s <= START_SEEDS; s++) {
          const game = newGame(s, setups, 4, { map: id, mines: 6, barrels: 4 });
          objs += game.objs.length;
          expect(badStarts(game, true), `seed ${s}`).toEqual([]);
        }
        // Mines and barrels keep well clear of slugs, so a crowded land lays fewer; at least half laid means their starts were checked.
        expect(objs).toBeGreaterThanOrEqual(START_SEEDS * 10 * 0.5);
      }, 120000);

      if (id !== 'classic') {
        it('has its signature shape on every seed', () => {
          for (const s of SEEDS) expect(SIGNATURE[id](land(id, s)), `seed ${s}`).toBe(true);
        });
      }
    });
  }

  it('each signature rejects the original islands, so the checks can fail', () => {
    for (const check of Object.values(SIGNATURE)) for (const s of [1, 2, 3]) expect(check(land('classic', s))).toBe(false);
  });

  it('designs with an exclusive signature are not matched by any other design', () => {
    const exclusive = ['cavern', 'sky', 'forts', 'canyon', 'wreck', 'archipelago'] as const;
    for (const id of exclusive)
      for (const other of MAP_DESIGN_IDS)
        if (other !== id) expect(SIGNATURE[id](land(other, 1)), `${id} on ${other}`).toBe(false);
  });
});
