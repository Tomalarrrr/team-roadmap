import { describe, it, expect } from 'vitest';
import { CLASSIC, MODE_IDS, MOST_SITES, SEATS, START_IDS, centreOf, newState, step, type ModeId, type Rules, type Seat, type SwarmMap } from '../swarmGameLogic';
import {
  PLAN_LAYOUTS,
  PLAN_MOST_HUTS,
  PLAN_PIECES,
  buildDrawn,
  changeOf,
  cutOffOf,
  drawPath,
  drawRiver,
  encodePlan,
  eraseAt,
  expand,
  homeSpots,
  imagesOf,
  layoutOf,
  parsePlan,
  placePiece,
  problemOf,
  undoChange,
  type PlanEdit,
  type PlanItem,
} from '../swarmPlan';

const TWO: Seat[] = ['a', 'b'];
const THREE: Seat[] = ['a', 'b', 'c'];
const FOUR: Seat[] = ['a', 'b', 'c', 'd'];
const rulesFor = (mode: ModeId): Rules => ({ ...CLASSIC, mode });

/** Makes the edits one after another, failing the test at the first refused. */
function draw(count: number, ...edits: ((items: PlanItem[], count: number) => PlanEdit)[]): PlanItem[] {
  return edits.reduce<PlanItem[]>((items, edit) => {
    const done = edit(items, count);
    if ('refusal' in done) throw new Error(`Refused: ${done.refusal}`);
    return done.items;
  }, []);
}
const refusalOf = (done: PlanEdit) => ('refusal' in done ? done.refusal : null);
const hut = (c: number, r: number) => (items: PlanItem[], count: number) => placePiece(items, count, 'hut', { c, r });
const road = (c: number, r: number, d: number, s: number) => (items: PlanItem[], count: number) => drawPath(items, count, 'road', { c, r }, { c: d, r: s });

/** A small map that plays for two or three: a hut each side of the middle, a big one in it where the third side does not start there, and one off to the side for each. */
const SAMPLE = (count: number) =>
  draw(
    count,
    hut(2, 2),
    (items, n) => (n === 3 ? { items } : placePiece(items, n, 'big', { c: 4, r: 2 })),
    hut(2, 0),
    road(0, 2, 2, 2),
    road(2, 2, 4, 2),
    road(0, 2, 2, 0),
  );

/** Whether every hut and path of the map has its image under each move the sides are dealt by. */
function isFair(map: SwarmMap): boolean {
  const { x: cx, y: cy } = centreOf(map);
  const moves = [(p: { x: number; y: number }) => ({ x: 2 * cx - p.x, y: 2 * cy - p.y })];
  if (map.sides.length === 4) moves.push((p) => ({ x: 2 * cx - p.x, y: p.y }), (p) => ({ x: p.x, y: 2 * cy - p.y }));
  const at = (p: { x: number; y: number }) => map.sites.findIndex((site) => site.x === p.x && site.y === p.y);
  return moves.every((move) =>
    map.sites.every((site) => at(move(site)) >= 0) &&
    map.paths.every((path) => {
      const [i, j] = [at(move(map.sites[path.a])), at(move(map.sites[path.b]))];
      return map.paths.some((other) => (other.a === i && other.b === j) || (other.a === j && other.b === i));
    }),
  );
}

describe('the drawing as stored', () => {
  it('reads back what it wrote', () => {
    const items = draw(2, hut(2, 2), road(0, 2, 2, 2), (it, n) => drawRiver(it, n, { c: 3, r: 0 }, { c: 3, r: 2 }));
    const text = encodePlan(items);
    expect(text).toBe('h22h02pr0222r3032');
    expect(parsePlan(text)).toEqual(items);
  });

  it('refuses a stored drawing it cannot read', () => {
    expect(() => parsePlan('h9')).toThrow('Unreadable map drawing');
    expect(() => parsePlan('h22z')).toThrow('Unreadable map drawing at 3');
    expect(() => parsePlan('h95')).toThrow();
    expect(() => parsePlan('pq0022')).toThrow();
  });
});

describe('copies for each side', () => {
  it('turns a cell about the middle for two or three sides and mirrors it to every corner for four', () => {
    expect(imagesOf({ c: 1, r: 0 }, 2)).toEqual([{ c: 1, r: 0 }, { c: 7, r: 4 }]);
    expect(imagesOf({ c: 1, r: 0 }, 4)).toEqual([{ c: 1, r: 0 }, { c: 7, r: 4 }, { c: 7, r: 0 }, { c: 1, r: 4 }]);
    expect(imagesOf({ c: 4, r: 2 }, 4)).toEqual([{ c: 4, r: 2 }]);
    expect(imagesOf({ c: 4, r: 0 }, 4)).toEqual([{ c: 4, r: 0 }, { c: 4, r: 4 }]);
  });

  it('lays a fair map for two, three and four sides', () => {
    for (const sides of [TWO, THREE]) expect(isFair(buildDrawn(1, encodePlan(SAMPLE(sides.length)), sides, undefined))).toBe(true);
    const four = draw(4, hut(2, 1), hut(4, 2), road(0, 0, 2, 1), road(2, 1, 4, 2), (items, n) => drawPath(items, n, 'road', { c: 2, r: 1 }, { c: 2, r: 3 }));
    expect(problemOf(encodePlan(four), FOUR, undefined, CLASSIC)).toBe(null);
    const map = buildDrawn(1, encodePlan(four), FOUR, undefined);
    expect(isFair(map)).toBe(true);
    expect(map.sites).toHaveLength(9);
  });

  it('starts each side on its own home, with the third in the middle', () => {
    const map = buildDrawn(1, encodePlan(SAMPLE(3)), THREE, undefined);
    expect(map.homes.map((home) => map.sites[home].owner)).toEqual(THREE);
    expect(map.sites[map.homes[2]]).toMatchObject(centreOf(map));
  });

  it('gives every client the same map: huts in grid order whatever order they were put down', () => {
    const one = layoutOf(draw(2, hut(2, 2), hut(2, 0), road(0, 2, 2, 2)), 2, 'medium');
    const other = layoutOf(draw(2, hut(2, 0), hut(2, 2), road(2, 2, 0, 2)), 2, 'medium');
    expect(other).toEqual(one);
    const ys = one.sites.map((site) => site.y * 10000 + site.x);
    expect(ys).toEqual([...ys].sort((p, q) => p - q));
  });
});

describe('putting pieces down', () => {
  it('will not put a piece where a side starts', () => {
    expect(refusalOf(placePiece([], 2, 'hut', homeSpots(2)[1]))).toBe('A side starts there.');
    expect(refusalOf(placePiece([], 4, 'cannon', { c: 8, r: 0 }))).toBe('A side starts there.');
  });

  it('swaps the piece on a cell, from it or from its copy, rather than stacking two', () => {
    const items = draw(2, hut(2, 2), (it, n) => placePiece(it, n, 'cannon', { c: 6, r: 2 }));
    expect(items).toEqual([{ is: 'piece', piece: 'cannon', at: { c: 6, r: 2 } }]);
    const map = buildDrawn(1, encodePlan(draw(2, (it, n) => placePiece(it, n, 'fort', { c: 4, r: 2 }), road(0, 2, 4, 2))), TWO, undefined);
    expect(map.sites.find((site) => site.fort)).toMatchObject({ n: 15, level: 2 });
  });

  it('stands every gun and building as the game has it, from a drawing read back', () => {
    // One piece at a time, each its own cell, read back from the stored text so every letter is tried.
    for (const piece of PLAN_PIECES) {
      const text = encodePlan(draw(2, (it, n) => placePiece(it, n, piece, { c: 2, r: 2 })));
      const [{ tower, fort, arm, building }] = layoutOf(parsePlan(text), 2, 'medium').sites.filter((each) => each.owner === null);
      const want = piece === 'hut' || piece === 'big' ? {}
        : piece === 'fort' ? { fort: true }
        : piece === 'cannon' ? { tower: true }
        : ['mortar', 'ballista', 'web', 'flame', 'longgun'].includes(piece) ? { tower: true, arm: piece }
        : { building: piece };
      expect(JSON.parse(JSON.stringify({ tower, fort, arm, building })), piece).toEqual(want);
    }
    expect(new Set(PLAN_PIECES.map((piece) => encodePlan([{ is: 'piece', piece, at: { c: 1, r: 1 } }])[0])).size).toBe(PLAN_PIECES.length);
  });

  it('holds a hut on every cell of the grid, which an order can still name', () => {
    expect(PLAN_MOST_HUTS).toBe(45);
    expect(PLAN_MOST_HUTS).toBeLessThanOrEqual(MOST_SITES - 2);
    // Half the board and the middle; the copies fill the rest. The homes are huts already.
    const cells: [number, number][] = [];
    for (let c = 0; c < 4; c++) for (let r = 0; r < 5; r++) if (c > 0 || r !== 2) cells.push([c, r]);
    const full = draw(2, ...cells.map(([c, r]) => hut(c, r)), hut(4, 0), hut(4, 1), hut(4, 2));
    expect(layoutOf(full, 2, 'medium').sites).toHaveLength(PLAN_MOST_HUTS);
  });
});

describe('drawing paths', () => {
  it('joins only huts', () => {
    expect(refusalOf(drawPath([], 2, 'road', { c: 0, r: 2 }, { c: 2, r: 2 }))).toBe('A path joins two huts.');
    expect(refusalOf(drawPath(draw(2, hut(2, 2)), 2, 'road', { c: 2, r: 2 }, { c: 2, r: 2 }))).toBe('A path joins two huts.');
  });

  it('keeps a hut under a path from a home, so the path still ends at one when the homes move', () => {
    const items = draw(2, hut(2, 0), road(0, 2, 2, 0));
    expect(items).toContainEqual({ is: 'piece', piece: 'hut', at: { c: 0, r: 2 } });
    expect(problemOf(encodePlan(items), FOUR, undefined, CLASSIC)).not.toBe('A path ends where there is no hut.');
  });

  it('will not cross another path or run over a hut', () => {
    const stacked = draw(2, hut(2, 0), hut(2, 2), hut(2, 4));
    expect(refusalOf(drawPath(stacked, 2, 'road', { c: 2, r: 0 }, { c: 2, r: 4 }))).toBe('A path cannot run over a hut.');
    expect(refusalOf(drawPath(stacked, 2, 'road', { c: 2, r: 0 }, { c: 2, r: 2 }))).toBe(null);
    const across = draw(2, hut(2, 0), hut(2, 4), hut(1, 1), hut(3, 1), road(1, 1, 3, 1));
    expect(refusalOf(drawPath(across, 2, 'road', { c: 2, r: 0 }, { c: 2, r: 4 }))).toBe('Two paths cannot cross.');
    expect(refusalOf(drawPath(across, 2, 'road', { c: 2, r: 0 }, { c: 3, r: 1 }))).toBe(null);
  });

  it('changes the kind of a path drawn again, from either end or from its copy', () => {
    const items = draw(2, hut(2, 2), road(0, 2, 2, 2), (it, n) => drawPath(it, n, 'spikes', { c: 6, r: 2 }, { c: 8, r: 2 }));
    expect(items.filter((item) => item.is === 'path')).toEqual([{ is: 'path', kind: 'spikes', a: { c: 6, r: 2 }, b: { c: 8, r: 2 } }]);
    expect(buildDrawn(1, encodePlan(items), TWO, undefined).paths.map((path) => path.kind)).toEqual(['spikes', 'spikes']);
  });
});

describe('rivers', () => {
  const RIVER = (it: PlanItem[], n: number) => drawRiver(it, n, { c: 2, r: 1 }, { c: 2, r: 4 });

  it('makes a path over one a bridge, but leaves a ford or a tunnel as it is', () => {
    const plan = (kind: 'road' | 'ford' | 'tunnel') => encodePlan(draw(2, hut(2, 2), RIVER, (it, n) => drawPath(it, n, kind, { c: 0, r: 2 }, { c: 2, r: 2 })));
    expect(buildDrawn(1, plan('road'), TWO, undefined).paths.map((path) => path.kind)).toEqual(['bridge', 'bridge']);
    expect(buildDrawn(1, plan('ford'), TWO, undefined).paths.map((path) => path.kind)).toEqual(['ford', 'ford']);
    expect(buildDrawn(1, plan('tunnel'), TWO, undefined).paths.map((path) => path.kind)).toEqual(['tunnel', 'tunnel']);
    expect(buildDrawn(1, plan('road'), TWO, undefined).rivers).toHaveLength(2);
  });

  it('will not lay a ford where there is no river, or a river through a hut', () => {
    expect(refusalOf(drawPath(draw(2, hut(2, 2)), 2, 'ford', { c: 0, r: 2 }, { c: 2, r: 2 }))).toBe('A ford has to cross a river.');
    expect(refusalOf(drawRiver(draw(2, hut(2, 2)), 2, { c: 2, r: 2 }, { c: 3, r: 3 }))).toBe('A river cannot run through a hut.');
    expect(refusalOf(drawRiver(draw(2, hut(2, 2)), 2, { c: 2, r: 2 }, { c: 2, r: 3 }))).toBe(null);
  });

  it('stores a stretch drawn twice once', () => {
    const items = draw(2, RIVER, (it, n) => drawRiver(it, n, { c: 7, r: 4 }, { c: 7, r: 1 }));
    expect(items).toHaveLength(1);
  });
});

describe('rubbing out', () => {
  it('takes a hut with every path to it, and its copy', () => {
    const items = SAMPLE(2);
    const left = eraseAt(items, 2, 6, 2)!;
    expect(left.some((item) => item.is === 'piece' && item.at.c === 2 && item.at.r === 2)).toBe(false);
    expect(left.filter((item) => item.is === 'path')).toEqual([{ is: 'path', kind: 'road', a: { c: 2, r: 0 }, b: { c: 0, r: 2 } }]);
  });

  it('takes the path or river nearest the point, and nothing when nothing is near', () => {
    const items = draw(2, hut(2, 2), road(0, 2, 2, 2), (it, n) => drawRiver(it, n, { c: 4, r: 0 }, { c: 4, r: 1 }));
    expect(eraseAt(items, 2, 1, 2)!.map((item) => item.is)).toEqual(['piece', 'piece', 'river']);
    expect(eraseAt(items, 2, 3.5, 0)!.map((item) => item.is)).toEqual(['piece', 'piece', 'path']);
    expect(eraseAt(items, 2, 2, 4)).toBe(null);
  });
});

describe('drawn for two sides, then played by four', () => {
  // Two huts drawn on their own for two sides are each other's copy for four.
  const twins = draw(2, hut(1, 0), hut(7, 0));

  it('rubs out a hut and every piece that stands on it', () => {
    expect(eraseAt(twins, 4, 1, 0)).toEqual([]);
    expect(eraseAt(twins, 2, 1, 0)).toEqual([{ is: 'piece', piece: 'hut', at: { c: 7, r: 0 } }]);
  });

  it('swaps the piece on a cell, however many pieces stood on it', () => {
    const swapped = draw(4, () => ({ items: twins }), (it, n) => placePiece(it, n, 'cannon', { c: 7, r: 4 }));
    expect(swapped).toEqual([{ is: 'piece', piece: 'cannon', at: { c: 7, r: 4 } }]);
  });

  it('rubs out a path with any drawn over it', () => {
    const items = draw(2, () => ({ items: twins }), hut(3, 1), hut(5, 1), road(1, 0, 3, 1), road(7, 0, 5, 1));
    const left = eraseAt(items, 4, 2, 0.5)!;
    expect(left.filter((item) => item.is === 'path')).toEqual([]);
    expect(left.filter((item) => item.is === 'piece')).toHaveLength(4);
    expect(eraseAt(items, 2, 2, 0.5)!.filter((item) => item.is === 'path')).toHaveLength(1);
  });
});

describe('undoing an edit', () => {
  /** An edit made, and what it changed. */
  function made(items: PlanItem[], count: number, edit: (items: PlanItem[], count: number) => PlanEdit | PlanItem[] | null) {
    const done = edit(items, count)!;
    const after = Array.isArray(done) ? done : 'items' in done ? done.items : [];
    return { after, change: changeOf(items, after) };
  }
  const undone = (items: PlanItem[], change: ReturnType<typeof changeOf>) => {
    const done = undoChange(items, 2, change);
    return 'items' in done ? done.items : done.refusal;
  };

  it('takes back a piece put down, and brings back the one it took the place of', () => {
    const { after, change } = made(SAMPLE(2), 2, (it, n) => placePiece(it, n, 'cannon', { c: 6, r: 2 }));
    expect(change.added).toEqual([{ is: 'piece', piece: 'cannon', at: { c: 6, r: 2 } }]);
    expect(change.removed).toEqual([{ is: 'piece', piece: 'hut', at: { c: 2, r: 2 } }]);
    expect(encodePlan(undone(after, change) as PlanItem[])).toBe(encodePlan(SAMPLE(2)).replace('h22', '') + 'h22');
  });

  it('brings back a hut rubbed out with its paths', () => {
    const { after, change } = made(SAMPLE(2), 2, (it, n) => eraseAt(it, n, 2, 0));
    expect(after).toHaveLength(SAMPLE(2).length - 2);
    expect(problemOf(encodePlan(undone(after, change) as PlanItem[]), TWO, undefined, CLASSIC)).toBe(null);
  });

  it('leaves alone what someone else drew after it', () => {
    const { after, change } = made([], 2, hut(2, 2));
    const theirs = draw(2, () => ({ items: after }), hut(2, 0));
    expect(undone(theirs, change)).toEqual([{ is: 'piece', piece: 'hut', at: { c: 2, r: 0 } }]);
  });

  it('does not put a piece back over one someone else put down since', () => {
    const { after, change } = made(draw(2, hut(2, 2)), 2, (it, n) => eraseAt(it, n, 2, 2));
    const theirs = draw(2, () => ({ items: after }), (it, n) => placePiece(it, n, 'cannon', { c: 6, r: 2 }));
    expect(undone(theirs, change)).toBe('Someone else has changed that since.');
  });

  it('does not put a path back to a hut someone else has rubbed out', () => {
    const items = SAMPLE(2);
    const { after, change } = made(items, 2, (it, n) => eraseAt(it, n, 3, 2));
    expect(change.removed).toEqual([{ is: 'path', kind: 'road', a: { c: 2, r: 2 }, b: { c: 4, r: 2 } }]);
    const theirs = eraseAt(after, 2, 4, 2)!;
    expect(undone(theirs, change)).toBe('Someone else has changed that since.');
    // With the hut still there, the path comes back.
    expect(undone(after, change)).toContainEqual(change.removed[0]);
  });

  it('refuses when what comes back would break the drawing', () => {
    const items = draw(2, hut(2, 0), hut(2, 4), hut(1, 1), hut(3, 1), road(1, 1, 3, 1));
    const { after, change } = made(items, 2, (it, n) => eraseAt(it, n, 2, 1));
    const theirs = draw(2, () => ({ items: after }), road(2, 0, 2, 4));
    expect(undone(theirs, change)).toBe('Two paths cannot cross.');
  });
});

describe('the ready-made layouts', () => {
  it('play for two, three and four sides under every mode and start', () => {
    expect(PLAN_LAYOUTS.length).toBeGreaterThan(0);
    for (const { name, plan } of PLAN_LAYOUTS) {
      expect(encodePlan(parsePlan(plan)), name).toBe(plan);
      for (const sides of [TWO, THREE, FOUR]) {
        for (const mode of MODE_IDS) {
          for (const start of START_IDS) expect(problemOf(plan, sides, undefined, { ...CLASSIC, mode, start }), `${name} ${sides.length} ${mode} ${start}`).toBe(null);
        }
      }
    }
  });

  it('lay the same huts whatever the count of sides', () => {
    for (const { name, plan } of PLAN_LAYOUTS) {
      const spots = (count: number) => [...expand(parsePlan(plan), count).huts.keys()].sort();
      expect(spots(3), name).toEqual(spots(2));
      expect(spots(4), name).toEqual(spots(2));
    }
  });
});

describe('what stops a drawing being played', () => {
  it('passes a drawing every way the lobby can start it', () => {
    for (const sides of [TWO, THREE]) {
      for (const mode of ['classic', 'hill', 'egg', 'blitz'] as ModeId[]) {
        expect(problemOf(encodePlan(SAMPLE(sides.length)), sides, undefined, rulesFor(mode)), `${sides.length} ${mode}`).toBe(null);
      }
    }
  });

  it('names huts no path reaches', () => {
    const items = draw(2, hut(2, 2), road(0, 2, 2, 2), hut(2, 0));
    expect(problemOf(encodePlan(items), TWO, undefined, CLASSIC)).toBe('There is no way between the homes yet.');
    expect(cutOffOf(items, 2)).toEqual([{ c: 6, r: 2 }, { c: 8, r: 2 }, { c: 2, r: 0 }, { c: 6, r: 4 }]);
    expect(problemOf('', TWO, undefined, CLASSIC)).toBe('There is no way between the homes yet.');
    const joined = draw(2, () => ({ items }), road(2, 2, 6, 2));
    expect(problemOf(encodePlan(joined), TWO, undefined, CLASSIC)).toBe('2 huts have no path to the rest.');
    expect(cutOffOf(joined, 2)).toEqual([{ c: 2, r: 0 }, { c: 6, r: 4 }]);
    expect(problemOf(encodePlan(draw(2, () => ({ items: joined }), road(0, 2, 2, 0))), TWO, undefined, CLASSIC)).toBe(null);
  });

  it('asks for a hut in the middle to play the hill or the egg', () => {
    const items = draw(2, hut(2, 2), road(0, 2, 2, 2), hut(4, 0), road(2, 2, 4, 0), (it, n) => drawPath(it, n, 'road', { c: 4, r: 0 }, { c: 6, r: 2 }));
    expect(problemOf(encodePlan(items), TWO, undefined, CLASSIC)).toBe(null);
    expect(problemOf(encodePlan(items), TWO, undefined, rulesFor('hill'))).toBe('Hill needs a hut in the middle of the map.');
    expect(problemOf(encodePlan(items), TWO, undefined, rulesFor('egg'))).toBe('Egg needs a hut in the middle of the map.');
  });

  it('puts what the third side needs in words', () => {
    const guarded = draw(3, (it, n) => placePiece(it, n, 'cannon', { c: 2, r: 2 }), road(0, 2, 2, 2), road(2, 2, 4, 2));
    expect(problemOf(encodePlan(guarded), THREE, undefined, CLASSIC)).toBe('The middle side needs two plain huts joined to its home, one each side of it.');
    const bare = draw(3, hut(2, 0), road(0, 2, 2, 0), road(2, 0, 4, 2));
    expect(problemOf(encodePlan(bare), THREE, undefined, CLASSIC)).toBe('Each side needs a plain hut to start with besides its home.');
    expect(problemOf(encodePlan(draw(3, () => ({ items: bare }), hut(2, 4), road(0, 2, 2, 4))), THREE, undefined, CLASSIC)).toBe(null);
  });
});

describe('playing a drawn map', () => {
  it('runs a game between computers on every ground', () => {
    for (const size of ['medium', 'large', 'huge'] as const) {
      const map = buildDrawn(7, encodePlan(SAMPLE(2)), TWO, size);
      const state = newState(map);
      for (let tick = 0; tick < 600 && !state.winner; tick++) step(state, map, {}, Object.fromEntries(SEATS.slice(0, 2).map((seat) => [seat, 0])));
      expect(state.tick).toBeGreaterThan(100);
      expect(state.huts.some((h, k) => h.owner === 'a' && k !== map.homes[0])).toBe(true);
    }
  });

  it('is played on medium when small is asked for', () => {
    expect(buildDrawn(1, encodePlan(SAMPLE(2)), TWO, 'small').size).toBe('medium');
  });
});
