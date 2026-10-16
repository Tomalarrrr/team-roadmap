import { describe, it, expect } from 'vitest';
import {
  CLASSIC,
  GOLDEN_TICK,
  MAP_IDS,
  MATCH_TICKS,
  SEATS,
  SIZE_IDS,
  SPEED,
  advance,
  buildMap,
  centreOf,
  frenzied,
  goldenAt,
  middleOf,
  newState,
  nextHop,
  pathLength,
  takesToll,
  type ModeId,
  type Path,
  type Rules,
  type Seat,
  type Site,
  type SwarmMap,
  type Twist,
} from '../swarmGameLogic';

const rulesFor = (mode: ModeId, twists: Twist[] = []): Rules => ({ ...CLASSIC, mode, twists });
const HILL = rulesFor('hill');
const EGG = rulesFor('egg');

type Point = { x: number; y: number };
const byNumber = (p: number, q: number) => p - q;
const sideOf = (p: Point, q: Point, r: Point) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
const meet = (p: Point, q: Point, r: Point, s: Point) => sideOf(p, q, r) * sideOf(p, q, s) <= 0 && sideOf(r, s, p) * sideOf(r, s, q) <= 0;
const cross = (p: Point, q: Point, r: Point, s: Point) => sideOf(p, q, r) * sideOf(p, q, s) < 0 && sideOf(r, s, p) * sideOf(r, s, q) < 0;

/** Every move of the board that the map is its own image under: the half-turn, and with four sides both mirrors too. */
function movesOf(map: SwarmMap): ((p: Point) => Point)[] {
  const { x: cx, y: cy } = centreOf(map);
  const turn = (p: Point) => ({ x: 2 * cx - p.x, y: 2 * cy - p.y });
  if (map.sides.length !== 4) return [turn];
  return [turn, (p) => ({ x: 2 * cx - p.x, y: p.y }), (p) => ({ x: p.x, y: 2 * cy - p.y })];
}

const CROWN_SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

describe.each(MAP_IDS)('the %s map played for the middle', (id) => {
  const layouts = [
    ...SIZE_IDS.flatMap((size) => [2, 4].map((count) => ({ size, sides: SEATS.slice(0, count) }))),
    { size: undefined, sides: SEATS.slice(0, 2) },
  ];

  it('has a neutral crown of 20 at level 2 in the very middle, for two and four sides at every size', () => {
    for (const { size, sides } of layouts) {
      for (const seed of CROWN_SEEDS) {
        const map = buildMap(seed, id, sides, size, HILL);
        const crown = middleOf(map);
        const label = `${id} ${map.size} ${sides.length} ${seed}`;
        expect(crown, label).toBeGreaterThanOrEqual(0);
        expect(map.sites[crown], label).toMatchObject({ ...centreOf(map), owner: null, n: 20, level: 2 });
        expect(map.sites[crown].tower, label).toBeUndefined();
        expect(map.links[crown].length, label).toBeGreaterThan(0);
        expect(buildMap(seed, id, sides, size, EGG), label).toEqual({ ...map, rules: EGG });
      }
    }
  }, 60_000);

  it('stays its own image, joined up without a toll, its huts apart, the roads to the crown crossing none, and every river crossed by a bridge or a ford', () => {
    for (const { size, sides } of layouts) {
      for (const seed of CROWN_SEEDS) {
        const map = buildMap(seed, id, sides, size, HILL);
        const { sites, links } = map;
        const label = `${id} ${map.size} ${sides.length} ${seed}`;
        const crown = middleOf(map);
        for (const move of movesOf(map)) {
          const twinOf = (i: number) => sites.findIndex((s) => s.x === move(sites[i]).x && s.y === move(sites[i]).y);
          sites.forEach((site, i) => {
            const twin = twinOf(i);
            expect(twin, label).not.toBe(-1);
            expect({ ...sites[twin], owner: null }, label).toStrictEqual({ ...site, ...move(site), owner: null });
            expect(links[twin].slice().sort(byNumber), label).toEqual(links[i].map(twinOf).sort(byNumber));
          });
        }
        const seen = new Set([0]);
        for (const at of seen) for (const next of links[at]) if (!takesToll(map.paths.find((p) => p.a === Math.min(at, next) && p.b === Math.max(at, next))!.kind)) seen.add(next);
        expect(seen.size, label).toBe(sites.length);
        sites.forEach((p, i) => {
          for (const q of sites.slice(i + 1)) if (!p.tower && !q.tower) expect((p.x - q.x) ** 2 + (p.y - q.y) ** 2, label).toBeGreaterThanOrEqual(150 * 150);
        });
        for (const path of map.paths) {
          const crossed = map.rivers.flatMap((river) => river.slice(1).filter((point, k) => meet(sites[path.a], sites[path.b], river[k], point))).length;
          expect(crossed > 0, label).toBe(path.kind === 'bridge' || path.kind === 'ford');
          for (const other of map.paths) {
            const shared = [other.a, other.b].includes(path.a) || [other.a, other.b].includes(path.b);
            // A tunnel runs under the roads, so only the ways over the ground can cross.
            const under = path.kind === 'tunnel' || other.kind === 'tunnel';
            if (!shared && !under && (path.a === crown || path.b === crown)) expect(cross(sites[path.a], sites[path.b], sites[other.a], sites[other.b]), label).toBe(false);
          }
          expect([nextHop(map, path.a, path.b, true), nextHop(map, path.b, path.a, true)], label).toEqual([path.b, path.a]);
        }
      }
    }
  }, 60_000);

  it('is the same map as ever when the match is not played for the middle', () => {
    for (const mode of ['classic', 'blitz', 'regicide', 'bounty'] as const) {
      for (const seed of CROWN_SEEDS.slice(0, 6)) {
        const sides: Seat[] = ['a', 'b'];
        const played = buildMap(seed, id, sides, undefined, rulesFor(mode));
        const classic = buildMap(seed, id, sides);
        // Only the rules, the clock and the starting garrisons may differ.
        expect({ ...played, rules: classic.rules, ticks: classic.ticks, sites: classic.sites }).toEqual(classic);
        expect(played.sites.map((site) => ({ ...site, n: 0 }))).toEqual(classic.sites.map((site) => ({ ...site, n: 0 })));
        expect(played.rules.mode).toBe(mode);
      }
    }
  });
});

const W = 1000;
const H = 660;
const MID = centreOf({ w: W, h: H });

// A board of the huts and links given, every path a road, its homes the first hut each side holds.
function boardOf(sites: Site[], links: number[][], rules: Rules, sides: Seat[] = ['a', 'b']): SwarmMap {
  const paths: Path[] = [];
  links.forEach((linked, a) => {
    for (const b of linked) if (a < b) paths.push({ a, b, kind: 'road' });
  });
  const homes = sides.map((seat) => sites.findIndex((site) => site.owner === seat));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: W, h: H, sides, homes, size: 'small', ticks: MATCH_TICKS, rules };
}

const hut = (x: number, owner: Seat | null, n: number, level = 1, y = MID.y): Site => ({ x, y, owner, n, level });

describe('a blitz', () => {
  it('lasts three minutes, four with four sides, from starts of 10 with armies a speed level up', () => {
    const two = buildMap(1, 'meadow', ['a', 'b'], undefined, rulesFor('blitz'));
    expect(two.ticks).toBe(1800);
    expect(buildMap(1, 'meadow', SEATS, undefined, rulesFor('blitz')).ticks).toBe(2400);
    expect(two.homes.map((at) => two.sites[at].n)).toEqual([10, 10]);
    expect(newState(two).army.a.speed).toBe(1);
    expect(newState(buildMap(1, 'meadow')).army.a.speed).toBe(0);
  });

  it('breeds a unit in a level 1 hut every 7 ticks rather than 10', () => {
    for (const [mode, every] of [['blitz', 7], ['classic', 10]] as const) {
      const board = boardOf([hut(200, 'a', 5), hut(800, 'b', 5)], [[], []], rulesFor(mode));
      const state = newState(board);
      advance(state, board, {}, every - 1);
      expect(state.huts[0].n, mode).toBe(5);
      advance(state, board, {}, every);
      expect(state.huts[0].n, mode).toBe(6);
    }
  });
});

describe('king of the hill', () => {
  const hill = (rules: Rules, sides: Seat[] = ['a', 'b'], holder: Seat = 'a') =>
    boardOf([hut(200, 'a', 5), { ...MID, owner: holder, n: 20, level: 2 }, hut(800, 'b', 5), hut(500, 'c', 5, 1, MID.y + 200)], [[1], [0, 2], [1], []], rules, sides);

  it('is won by the side that has held the crown for 600 ticks, there and then', () => {
    const board = hill(HILL);
    const state = newState(board);
    advance(state, board, {}, 599);
    expect([state.winner, state.held.a, state.held.b]).toEqual([null, 599, 0]);
    advance(state, board, {}, 700);
    expect([state.winner, state.tick, state.held.a]).toEqual(['a', 600, 600]);
  });

  it('on the clock goes to the side that held it longest, even with fewer huts', () => {
    const board = { ...hill(HILL), ticks: 100 };
    const state = newState(board);
    state.huts[0].owner = 'b';
    state.huts[3].owner = 'b';
    advance(state, board, {}, 100);
    expect(state.winner).toBe('a');
    const classic = { ...board, rules: CLASSIC };
    const counted = newState(classic);
    counted.huts[0].owner = 'b';
    counted.huts[3].owner = 'b';
    advance(counted, classic, {}, 100);
    expect(counted.winner).toBe('b');
  });

  it("counts at half speed for the middle side, whose base the crown is", () => {
    const board = hill(HILL, ['a', 'b', 'c'], 'c');
    expect(board.homes[2]).toBe(1);
    const state = newState(board);
    advance(state, board, {}, 20);
    expect(state.held.c).toBe(10);
  });
});

describe('regicide', () => {
  const realm = (rules: Rules, sides: Seat[]) =>
    boardOf([hut(200, 'a', 30), hut(260, 'b', 1), hut(800, 'b', 5), hut(500, 'c', 5, 1, MID.y + 200)], [[1], [0, 2], [1], []], rules, sides);

  it('puts a side out when its home falls: its huts go neutral and its units off the board', () => {
    const board = realm(rulesFor('regicide'), ['a', 'b', 'c']);
    const state = newState(board);
    state.units.push({ id: state.nextId++, seat: 'b', from: 2, to: 1, dest: 1, d: 0 });
    state.huts[1].owner = 'a';
    advance(state, board, {}, 1);
    expect(state.fallen).toMatchObject({ a: 0, b: 1, c: 0 });
    expect(state.huts[2]).toMatchObject({ owner: null, n: 5 });
    expect(state.units.filter((unit) => unit.seat === 'b')).toEqual([]);
    expect(state.winner).toBeNull();
  });

  it('is won by taking the last other queen, whatever else that side holds', () => {
    const board = realm(rulesFor('regicide'), ['a', 'b']);
    const state = newState(board);
    advance(state, board, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }] }, 200);
    expect(state.winner).toBe('a');
    expect(state.fallen.b).toBe(state.tick);
    const classic = { ...board, rules: CLASSIC };
    const played = newState(classic);
    advance(played, classic, { a: [{ tick: 1, kind: 'all', from: 0, to: 1 }] }, state.tick);
    expect(played.winner).toBeNull();
  });
});

describe('the queens twist', () => {
  it('stops every hut of a side that has lost its home from breeding until it takes it back', () => {
    const board = boardOf([hut(200, 'a', 5), hut(400, 'a', 5), hut(800, 'b', 5)], [[], [], []], rulesFor('classic', ['queens']));
    const state = newState(board);
    state.huts[0].owner = 'b';
    advance(state, board, {}, 30);
    expect([state.huts[0].n, state.huts[1].n, state.huts[2].n]).toEqual([8, 5, 8]);
    state.huts[0].owner = 'a';
    advance(state, board, {}, 60);
    expect(state.huts[1].n).toBe(8);
  });
});

describe('bounty', () => {
  const field = () => boardOf([hut(200, 'a', 5), hut(260, 'a', 1), hut(400, 'a', 5), hut(320, 'b', 30), hut(800, 'b', 5, 1, MID.y + 200)], [[], [3], [], [1], []], rulesFor('bounty'));

  it('marks the side with the most huts every 50 ticks, and the bounty grows a unit a second up to 20', () => {
    const board = field();
    const state = newState(board);
    advance(state, board, {}, 49);
    expect([state.leader, state.bounty]).toEqual([null, 10]);
    advance(state, board, {}, 50);
    expect([state.leader, state.bounty]).toEqual(['a', 11]);
    advance(state, board, {}, 100);
    expect(state.bounty).toBe(16);
    advance(state, board, {}, 300);
    expect(state.bounty).toBe(20);
  });

  it('marks nobody when two sides hold as many huts', () => {
    const board = field();
    const state = newState(board);
    state.huts[0].owner = null;
    advance(state, board, {}, 100);
    expect([state.leader, state.bounty]).toEqual([null, 10]);
  });

  it('pays the bounty into a hut taken from the leader, and starts it again', () => {
    const board = field();
    const state = newState(board);
    let paid = -1;
    let before = 0;
    advance(state, board, { b: [{ tick: 120, kind: 'all', from: 3, to: 1 }] }, 300, {}, (s) => {
      if (paid < 0 && s.huts[1].owner === 'b') paid = s.huts[1].n;
      else if (paid < 0) before = s.bounty;
    });
    expect(before).toBeGreaterThan(10);
    expect(paid).toBe(1 + before);
    expect(state.claimed).toMatchObject({ a: 0, b: 1 });
  });
});

describe('the egg', () => {
  const nest = (sides: Seat[] = ['a', 'b'], keeper: Seat = 'a', n = 10) =>
    boardOf([hut(100, 'a', 5), { ...MID, owner: keeper, n, level: 2 }, hut(900, 'b', 5), hut(500, 'c', 5, 1, MID.y + 200)], [[1], [0, 2], [1], []], EGG, sides);

  it('lies in the middle hut at the start and goes with the first unit sent from it, at half pace', () => {
    const board = nest();
    const state = newState(board);
    expect(state.egg).toBe(1);
    advance(state, board, { a: [{ tick: 1, kind: 'all', from: 1, to: 0 }] }, 10);
    const [carrier, next] = state.units;
    expect([state.egg, carrier.egg, next.egg]).toEqual([-1, true, undefined]);
    expect([carrier.d, next.d]).toEqual([9 * (SPEED[0] >> 1), 7 * SPEED[0]]);
  });

  it('wins for the side that carries it into its own home, when the carrier gets there', () => {
    const board = nest();
    const state = newState(board);
    advance(state, board, { a: [{ tick: 1, kind: 'all', from: 1, to: 0 }] }, 400);
    expect(state.winner).toBe('a');
    expect(state.tick).toBe(1 + Math.ceil(pathLength(board, 1, 0) / (SPEED[0] >> 1)));
  });

  it('drops back where it came from when its carrier is shot before the middle of the path', () => {
    const sites = [hut(100, 'a', 5), { ...MID, owner: 'a' as const, n: 1, level: 2 }, hut(900, 'b', 5), { x: MID.x - 30, y: MID.y - 60, owner: 'b' as const, n: 5, level: 1, tower: true }];
    const board = boardOf(sites, [[1], [0, 2], [1], []], EGG);
    const state = newState(board);
    advance(state, board, { a: [{ tick: 1, kind: 'all', from: 1, to: 0 }] }, 30);
    expect([state.units.length, state.egg, state.winner]).toEqual([0, 1, null]);
  });

  it('drops into the hut ahead when its carrier is shot past the middle', () => {
    const sites = [hut(900, 'a', 5, 1, MID.y + 200), { ...MID, owner: 'a' as const, n: 1, level: 2 }, hut(100, null, 5), hut(900, 'b', 5), { x: 170, y: MID.y - 60, owner: 'b' as const, n: 5, level: 1, tower: true }];
    const board = boardOf(sites, [[], [2], [1], [], []], EGG);
    const state = newState(board);
    advance(state, board, { a: [{ tick: 1, kind: 'all', from: 1, to: 2 }] }, 300);
    expect([state.units.length, state.egg, state.winner]).toEqual([0, 2, null]);
  });

  it("stays put in the middle side's base, which is its nest, when that side sends from it", () => {
    const board = nest(['a', 'b', 'c'], 'c');
    const state = newState(board);
    advance(state, board, { c: [{ tick: 1, kind: 'all', from: 1, to: 2 }] }, 10);
    expect(state.units.length).toBeGreaterThan(0);
    expect(state.units.some((unit) => unit.egg)).toBe(false);
    expect(state.egg).toBe(1);
  });
});

describe('the golden twist', () => {
  const GOLDEN = rulesFor('classic', ['golden']);
  const field = (owner: Seat | null) =>
    boardOf(
      [hut(100, 'a', 5), hut(900, 'b', 5), hut(MID.x - 150, owner, 5), hut(MID.x + 150, owner, 5), hut(MID.x, null, 5, 1, MID.y + 250), { ...MID, owner: null, n: 5, level: 1, tower: true }],
      [[], [], [], [], [], []],
      GOLDEN
    );

  it('turns the neutral huts nearest the middle golden at 3:00, never a tower', () => {
    const board = field(null);
    const state = newState(board);
    advance(state, board, {}, GOLDEN_TICK - 1);
    expect(state.huts.some((h) => h.gold)).toBe(false);
    advance(state, board, {}, GOLDEN_TICK);
    expect(state.huts.map((h) => h.gold === true)).toEqual([false, false, true, true, false, false]);
  });

  it('turns them golden whoever holds them when none is left neutral', () => {
    const board = { ...field('a'), sites: field('a').sites.map((site, at) => (at === 4 ? { ...site, owner: 'b' as const } : site)) };
    const state = newState(board);
    advance(state, board, {}, GOLDEN_TICK);
    expect(state.huts.map((h) => h.gold === true)).toEqual([false, false, true, true, false, false]);
  });

  it('comes three tenths of the way through a blitz', () => {
    expect(goldenAt(buildMap(1, 'meadow', ['a', 'b'], undefined, rulesFor('blitz', ['golden'])))).toBe(540);
  });

  it('makes a golden hut breed in a third of the time and hold half as many again', () => {
    const board = field('a');
    const state = newState(board);
    state.huts[2].gold = true;
    state.huts[2].n = 40;
    advance(state, board, {}, 4);
    expect([state.huts[2].n, state.huts[3].n]).toEqual([41, 5]);
    advance(state, board, {}, 40);
    expect(state.huts[2].n).toBe(45);
  });
});

describe('the frenzy twist', () => {
  const FRENZY = rulesFor('classic', ['frenzy']);

  it('halves the time to breed in the last minute', () => {
    const board = { ...boardOf([hut(200, 'a', 0), hut(800, 'b', 0)], [[], []], FRENZY), ticks: 1000 };
    const state = newState(board);
    advance(state, board, {}, 400);
    expect(state.huts[0].n).toBe(30);
    state.huts[0].n = 0;
    advance(state, board, {}, 500);
    expect(state.huts[0].n).toBe(20);
  });

  it('starts on the first tick of the last minute and not the one before', () => {
    const board = { ...boardOf([hut(200, 'a', 0), hut(800, 'b', 0)], [[], []], FRENZY), ticks: 1000 };
    expect([frenzied(board, 400), frenzied(board, 401), frenzied(board, 1000)]).toEqual([false, true, true]);
    expect(frenzied({ ...board, rules: CLASSIC }, 900)).toBe(false);
  });

  it('reloads a tower in 3 ticks rather than 6', () => {
    for (const [rules, reload] of [[FRENZY, 3], [CLASSIC, 6]] as const) {
      const sites = [hut(200, 'a', 20), hut(800, 'b', 5, 1, MID.y + 250), { x: 500, y: MID.y - 60, owner: 'b' as const, n: 5, level: 1, tower: true }, hut(800, null, 50)];
      const board = { ...boardOf(sites, [[3], [], [], [0]], rules), ticks: 400 };
      const state = newState(board);
      const reloads: number[] = [];
      advance(state, board, { a: [{ tick: 1, kind: 'all', from: 0, to: 3 }] }, 200, {}, (s) => {
        if (s.shots.length) reloads.push(s.huts[2].reload!);
      });
      expect(reloads.length, rules.mode).toBeGreaterThan(1);
      expect(new Set(reloads), rules.mode).toEqual(new Set([reload]));
    }
  });
});

describe('the comeback twist', () => {
  it('makes a side two huts behind breed in four fifths of the time', () => {
    const board = boardOf([hut(100, 'a', 5), hut(700, 'b', 5), hut(800, 'b', 5), hut(900, 'b', 5)], [[], [], [], []], rulesFor('classic', ['comeback']));
    const state = newState(board);
    advance(state, board, {}, 8);
    expect([state.huts[0].n, state.huts[1].n]).toEqual([6, 5]);
    state.huts[3].owner = 'a';
    state.huts[0].n = 5;
    advance(state, board, {}, 24);
    expect(state.huts[0].n).toBe(6);
  });
});

describe('a match with modes and twists', () => {
  const CONFIGS: [string, Rules, number][] = [
    ['blitz', rulesFor('blitz', ['golden']), 2],
    ['hill', HILL, 2],
    ['hill for four', HILL, 4],
    ['regicide', rulesFor('regicide', ['queens']), 3],
    ['bounty', rulesFor('bounty', ['comeback']), 2],
    ['egg', EGG, 4],
    ['frenzy', rulesFor('classic', ['frenzy']), 2],
  ];

  it.each(CONFIGS)('%s plays out the same twice from the same seed', (_, rules, count) => {
    const runOf = () => {
      const sides = SEATS.slice(0, count);
      const map = { ...buildMap(5, 'meadow', sides, undefined, rules), ticks: 1200 };
      const state = newState(map);
      advance(state, map, {}, 1200, Object.fromEntries(sides.map((seat) => [seat, 0])));
      return state;
    };
    const first = runOf();
    expect(first.tick).toBeGreaterThan(100);
    expect(JSON.stringify(runOf())).toBe(JSON.stringify(first));
  });

  it('plays a golden or frenzy match tick for tick as classic until the twist comes in', () => {
    for (const twist of ['golden', 'frenzy'] as const) {
      const states = [CLASSIC, rulesFor('classic', [twist])].map((rules) => {
        const map = buildMap(3, 'thorns', ['a', 'b'], undefined, rules);
        const state = newState(map);
        advance(state, map, {}, 1500, { a: 0, b: 0 });
        return state;
      });
      expect(states[0].tick, twist).toBeGreaterThan(500);
      expect(JSON.stringify(states[1]), twist).toBe(JSON.stringify(states[0]));
    }
  });

  it('keeps no count of a mode that is not being played', () => {
    const map = buildMap(3, 'thorns');
    const state = newState(map);
    advance(state, map, {}, 1500, { a: 0, b: 0 });
    expect([state.held, state.leader, state.bounty, state.claimed, state.egg, state.fallen]).toEqual([
      { a: 0, b: 0, c: 0, d: 0 },
      null,
      0,
      { a: 0, b: 0, c: 0, d: 0 },
      -1,
      { a: 0, b: 0, c: 0, d: 0 },
    ]);
  });
});
