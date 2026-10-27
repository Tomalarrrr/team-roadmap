import { describe, it, expect } from 'vitest';
import { CLASSIC, MODE_IDS, SEATS, START_IDS, WORLDS, centreOf, newState, step, type ModeId, type Rules, type Seat, type SwarmMap } from '../swarmGameLogic';
import {
  EMPTY_PLAN,
  PLAN_LAYOUTS,
  PLAN_MOST_HUTS,
  PLAN_PIECES,
  buildDrawn,
  changeOf,
  cutOffOf,
  drawPath,
  drawRiver,
  encodePlan,
  encodePointer,
  eraseAt,
  expand,
  homesOf,
  layoutOf,
  movePiece,
  parsePlan,
  parsePointer,
  placePiece,
  problemOf,
  removePiece,
  setMirror,
  setPiece,
  spotOf,
  turnOf,
  undoChange,
  worldOf,
  type Plan,
  type PlanEdit,
  type PlanPath,
  type PlanPiece,
} from '../swarmPlan';

const TWO: Seat[] = ['a', 'b'];
const THREE: Seat[] = ['a', 'b', 'c'];
const FOUR: Seat[] = ['a', 'b', 'c', 'd'];
const rulesFor = (mode: ModeId): Rules => ({ ...CLASSIC, mode });

type Edit = (plan: Plan, count: number) => PlanEdit;

/** Makes the edits one after another from `start`, failing the test at the first refused. */
function drawOn(start: Plan, count: number, ...edits: Edit[]): Plan {
  return edits.reduce((plan, edit) => {
    const done = edit(plan, count);
    if ('refusal' in done) throw new Error(`Refused: ${done.refusal}`);
    return done.plan;
  }, start);
}
const draw = (count: number, ...edits: Edit[]) => drawOn(EMPTY_PLAN, count, ...edits);
const refusalOf = (done: PlanEdit | null) => (done && 'refusal' in done ? done.refusal : null);
const planOf = (done: PlanEdit | null) => {
  if (!done || 'refusal' in done) throw new Error(`No drawing: ${done && done.refusal}`);
  return done.plan;
};

const copying: Edit = (plan, count) => setMirror(plan, count, true);
const hut = (x: number, y: number, piece: PlanPiece = 'hut'): Edit => (plan, count) => placePiece(plan, count, piece, { x, y });
/** A path between two huts by id, the second's copy `copy` away (see turnOf). Homes are 0 to 3; huts drawn are 4, 5 and on, in order. */
const road = (a: string, b: string, kind: PlanPath = 'road', copy = 0): Edit => (plan, count) => drawPath(plan, count, kind, { id: a, copy: 0 }, { id: b, copy });

/** Where each hut stands, by its key, sorted so the order things were drawn in does not matter. */
const spots = (plan: Plan, count: number) => expand(plan, count).huts.map((each) => `${each.at.x},${each.at.y}`).sort();
const piecesAt = (plan: Plan, count: number, x: number, y: number) => expand(plan, count).huts.filter((each) => each.at.x === x && each.at.y === y).map((each) => each.piece);
const joins = (plan: Plan, count: number) => {
  const all = expand(plan, count);
  return all.paths.map(({ a, b }) => [all.huts[a].at, all.huts[b].at].map((p) => `${p.x},${p.y}`).sort().join('-')).sort();
};

/** A small map that plays for two: a hut off each home, joined through a big one in the middle, copied for the other side. */
const SAMPLE = () => draw(2, copying, hut(25, 30), hut(49, 49, 'big'), road('0', '4'), road('4', '5'));
/** The same for three, whose third side starts in the middle: a plain hut each side of it, which its start needs. */
const SAMPLE_THREE = () => draw(3, copying, hut(25, 30), hut(30, 49), road('0', '4'), road('0', '5'), road('2', '5'), road('4', '5'));

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
  it('reads back what it wrote, and writes each piece, home, path and river at a fixed width', () => {
    const plan = drawOn(draw(2, hut(30, 20), road('0', '4'), (p, n) => drawRiver(p, n, { x: 60, y: 0 }, { x: 60, y: 98 })), 2, (p, n) => movePiece(p, n, { id: '1', copy: 0 }, { x: 98, y: 70 }));
    const text = encodePlan(plan);
    expect(text).toBe('h43020pr040r60006098s19870');
    expect(parsePlan(text)).toEqual(plan);
    expect(encodePlan(drawOn(plan, 2, copying))).toBe(`M${text}`);
    expect(parsePlan('')).toEqual(EMPTY_PLAN);
  });

  it('refuses a stored drawing it cannot read, saying where', () => {
    expect(() => parsePlan('h4302')).toThrow('Unreadable map drawing at 2');
    expect(() => parsePlan('h43020z')).toThrow('Unreadable map drawing at 6');
    expect(() => parsePlan('h03020')).toThrow('Unreadable map drawing at 1');
    expect(() => parsePlan('h49920')).toThrow('Unreadable map drawing at 2');
    expect(() => parsePlan('s43020')).toThrow();
    expect(() => parsePlan('pq040')).toThrow();
    expect(() => parsePlan('pr044')).toThrow();
  });

  it('gives every letter of a piece back as the same piece', () => {
    const plan: Plan = { mirror: false, items: PLAN_PIECES.map((piece, k) => ({ is: 'piece', piece, id: '456789abcdefghijk'[k], at: { x: k * 5, y: 10 } })) };
    expect(parsePlan(encodePlan(plan))).toEqual(plan);
  });
});

describe('the board', () => {
  it('stands a spot and its copy at exactly each other’s mirror on every ground', () => {
    for (const size of ['medium', 'large', 'huge'] as const) {
      const { x: cx, y: cy } = centreOf(WORLDS[size]);
      for (const p of [{ x: 13, y: 7 }, { x: 0, y: 98 }, { x: 37, y: 61 }]) {
        const [u, v] = [worldOf(p, size), worldOf(turnOf(p, 1), size)];
        expect(u.x + v.x, `${size} ${p.x}`).toBe(2 * cx);
        expect(u.y).toBe(v.y);
        expect(u.y + worldOf(turnOf(p, 2), size).y).toBe(2 * cy);
        expect(worldOf(turnOf(p, 3), size)).toEqual({ x: v.x, y: worldOf(turnOf(p, 2), size).y });
      }
    }
  });

  it('finds the spot under a point of the board, and spots off it for a point beyond the edge', () => {
    for (const size of ['medium', 'large', 'huge'] as const) {
      for (const p of [{ x: 0, y: 0 }, { x: 98, y: 98 }, { x: 40, y: 13 }]) expect(spotOf(worldOf(p, size), size)).toEqual(p);
      expect(spotOf({ x: 0, y: 0 }, size).x).toBeLessThan(0);
    }
  });

  it('copies by mirror and half-turn, each move undoing itself', () => {
    const p = { x: 10, y: 30 };
    expect([0, 1, 2, 3].map((move) => turnOf(p, move))).toEqual([p, { x: 88, y: 30 }, { x: 10, y: 68 }, { x: 88, y: 68 }]);
    for (const move of [1, 2, 3]) expect(turnOf(turnOf(p, move), move)).toEqual(p);
  });
});

describe('homes', () => {
  it('start at the ends of the middle row for two or three, the third in the middle, and in the corners for four', () => {
    expect(homesOf(EMPTY_PLAN, 2)).toEqual([{ x: 0, y: 49 }, { x: 98, y: 49 }]);
    expect(homesOf(EMPTY_PLAN, 3)).toEqual([{ x: 0, y: 49 }, { x: 98, y: 49 }, { x: 49, y: 49 }]);
    expect(homesOf(EMPTY_PLAN, 4)).toEqual([{ x: 0, y: 0 }, { x: 98, y: 98 }, { x: 98, y: 0 }, { x: 0, y: 98 }]);
  });

  it('move one at a time, anywhere, with copying off', () => {
    const plan = draw(2, (p, n) => movePiece(p, n, { id: '1', copy: 0 }, { x: 60, y: 10 }));
    expect(homesOf(plan, 2)).toEqual([{ x: 0, y: 49 }, { x: 60, y: 10 }]);
  });

  it('move all together with copying on, but for the third of three, who keeps the middle', () => {
    const plan = draw(4, copying, (p, n) => movePiece(p, n, { id: '2', copy: 0 }, { x: 90, y: 10 }));
    expect(homesOf(plan, 4)).toEqual([{ x: 8, y: 10 }, { x: 90, y: 88 }, { x: 90, y: 10 }, { x: 8, y: 88 }]);
    expect(homesOf(plan, 3)[2]).toEqual({ x: 49, y: 49 });
    expect(refusalOf(movePiece(drawOn(EMPTY_PLAN, 3, copying), 3, { id: '2', copy: 0 }, { x: 40, y: 49 }))).toBe('While the map is copied, the middle side starts in the middle.');
    expect(homesOf(planOf(movePiece(EMPTY_PLAN, 3, { id: '2', copy: 0 }, { x: 40, y: 20 })), 3)[2]).toEqual({ x: 40, y: 20 });
  });

  it('cannot be rubbed out or made into something else', () => {
    expect(refusalOf(removePiece(EMPTY_PLAN, 2, '0'))).toBe('A side always starts on its home.');
    expect(refusalOf(setPiece(EMPTY_PLAN, 2, '1', 'cannon'))).toBe('A side’s home stays its home.');
  });
});

describe('putting pieces down', () => {
  it('puts a piece anywhere, once, with copying off', () => {
    const plan = draw(2, hut(13, 77, 'mortar'));
    expect(plan.items).toEqual([{ is: 'piece', id: '4', piece: 'mortar', at: { x: 13, y: 77 } }]);
    expect(expand(plan, 2).huts).toHaveLength(3);
    expect(piecesAt(plan, 4, 13, 77)).toEqual(['mortar']);
  });

  it('puts one down for every side with copying on: turned for two or three, in every corner for four', () => {
    expect(piecesAt(draw(2, copying, hut(20, 30)), 2, 78, 68)).toEqual(['hut']);
    expect(spots(draw(2, copying, hut(20, 30)), 2)).toEqual(['0,49', '20,30', '78,68', '98,49']);
    const four = draw(4, copying, hut(20, 30));
    for (const [x, y] of [[20, 30], [78, 30], [20, 68], [78, 68]]) expect(piecesAt(four, 4, x, y), `${x},${y}`).toEqual(['hut']);
  });

  it('settles a piece by a line of the copy onto the line, where it stands once, and one by the middle into it', () => {
    const near = draw(4, copying, hut(47, 20));
    expect(near.items).toContainEqual({ is: 'piece', id: '4', piece: 'hut', at: { x: 49, y: 20 } });
    expect(expand(near, 4).huts).toHaveLength(4 + 2);
    expect(draw(2, hut(50, 48)).items[0]).toMatchObject({ at: { x: 49, y: 49 } });
    expect(draw(2, hut(40, 48)).items[0]).toMatchObject({ at: { x: 40, y: 48 } });
  });

  it('refuses a piece too close to another hut, a home among them', () => {
    expect(refusalOf(placePiece(EMPTY_PLAN, 2, 'hut', { x: 3, y: 49 }))).toBe('That is too close to another hut.');
    expect(refusalOf(placePiece(draw(2, hut(30, 30)), 2, 'hut', { x: 33, y: 35 }))).toBe('That is too close to another hut.');
    expect(refusalOf(placePiece(draw(2, hut(30, 30)), 2, 'hut', { x: 42, y: 30 }))).toBe(null);
  });

  it('holds the board’s edge, wherever a piece is let go', () => {
    expect(draw(2, hut(-20, 130)).items[0]).toMatchObject({ at: { x: 0, y: 98 } });
  });

  it('gives each new hut the first name free, so a path names its ends the same after a hut is gone', () => {
    const plan = draw(2, hut(20, 20), hut(40, 20), hut(60, 20), (p, n) => removePiece(p, n, '5'), hut(40, 80));
    expect(plan.items.map((item) => item.is === 'piece' && item.id)).toEqual(['4', '6', '5']);
  });

  it('stands every gun and building as the game has it, from a drawing read back', () => {
    for (const piece of PLAN_PIECES) {
      const text = encodePlan(draw(2, hut(30, 30, piece)));
      const [{ tower, fort, arm, building }] = layoutOf(parsePlan(text), 2, 'medium').sites.filter((each) => each.owner === null);
      const want = piece === 'hut' || piece === 'big' ? {}
        : piece === 'fort' ? { fort: true }
        : piece === 'cannon' ? { tower: true }
        : ['mortar', 'ballista', 'web', 'flame', 'longgun'].includes(piece) ? { tower: true, arm: piece }
        : { building: piece };
      expect(JSON.parse(JSON.stringify({ tower, fort, arm, building })), piece).toEqual(want);
    }
  });

  it('changes what a hut is, with its copies, and keeps where it stands', () => {
    const plan = drawOn(draw(2, copying, hut(20, 30)), 2, (p, n) => setPiece(p, n, '4', 'fort'));
    expect(piecesAt(plan, 2, 20, 30)).toEqual(['fort']);
    expect(piecesAt(plan, 2, 78, 68)).toEqual(['fort']);
  });
});

describe('a full board', () => {
  // Rows 14 apart, every other one moved half a step along: no two closer than a hut's gap on the medium ground.
  const lattice: [number, number][] = [];
  for (let y = 0; y <= 98; y += 14) for (let x = (y / 14) % 2 ? 15 : 10; x <= 90; x += 10) lattice.push([x, y]);

  /** Puts a hut on every spot of the lattice that takes one, with what each spot that did not was refused for. */
  function fill(count: number) {
    let plan = EMPTY_PLAN;
    const refused: string[] = [];
    for (const [x, y] of lattice) {
      const done = placePiece(plan, count, 'hut', { x, y });
      if ('plan' in done) plan = done.plan;
      else refused.push(done.refusal);
    }
    return { plan, refused: [...new Set(refused)].sort() };
  }

  it(`holds ${PLAN_MOST_HUTS} huts, homes counted, spread over the whole board`, () => {
    expect(PLAN_MOST_HUTS).toBe(60);
    const { plan, refused } = fill(2);
    expect(expand(plan, 2).huts).toHaveLength(PLAN_MOST_HUTS);
    expect(layoutOf(plan, 2, 'medium').sites).toHaveLength(PLAN_MOST_HUTS);
    expect(refused).toEqual(['That is too close to another hut.', 'The drawing is full.']);
  });

  it('counts the homes for the sides playing, and refuses one past the most', () => {
    const { plan, refused } = fill(4);
    expect(expand(plan, 4).huts).toHaveLength(PLAN_MOST_HUTS);
    expect(refused).toEqual([`A map holds ${PLAN_MOST_HUTS} huts, copies for each side and homes counted.`, 'That is too close to another hut.']);
  });
});

describe('drawing paths', () => {
  it('joins two huts, and only huts', () => {
    expect(joins(draw(2, hut(30, 30), road('0', '4')), 2)).toEqual(['0,49-30,30']);
    expect(refusalOf(drawPath(EMPTY_PLAN, 2, 'road', { id: '0', copy: 0 }, { id: '4', copy: 0 }))).toBe('A path joins two huts.');
    expect(refusalOf(drawPath(EMPTY_PLAN, 2, 'road', { id: '0', copy: 0 }, { id: '0', copy: 0 }))).toBe('A path joins two huts.');
  });

  it('is copied with the huts it joins, and can join a hut to its own copy', () => {
    const plan = draw(2, copying, hut(30, 30), road('0', '4'), road('4', '4', 'road', 3));
    expect(joins(plan, 2)).toEqual(['0,49-30,30', '30,30-68,68', '68,68-98,49']);
  });

  it('will not cross another path or run over a hut', () => {
    const stacked = draw(2, hut(40, 10), hut(40, 49), hut(40, 88));
    expect(refusalOf(drawPath(stacked, 2, 'road', { id: '4', copy: 0 }, { id: '6', copy: 0 }))).toBe('A path cannot run over a hut.');
    const across = draw(2, hut(40, 10), hut(40, 88), hut(20, 49), hut(60, 49), road('6', '7'));
    expect(refusalOf(drawPath(across, 2, 'road', { id: '4', copy: 0 }, { id: '5', copy: 0 }))).toBe('Two paths cannot cross.');
    expect(refusalOf(drawPath(across, 2, 'road', { id: '4', copy: 0 }, { id: '7', copy: 0 }))).toBe(null);
  });

  it('changes the kind of a path drawn again, from either end', () => {
    const plan = draw(2, hut(30, 30), road('0', '4'), road('4', '0', 'spikes'));
    expect(plan.items.filter((item) => item.is === 'path')).toEqual([{ is: 'path', kind: 'spikes', a: '0', b: '4', turn: 0 }]);
  });
});

describe('rivers', () => {
  const RIVER: Edit = (p, n) => drawRiver(p, n, { x: 20, y: 10 }, { x: 20, y: 90 });

  it('makes a path over one a bridge, but leaves a ford or a tunnel as it is', () => {
    const kinds = (kind: PlanPath) => buildDrawn(1, encodePlan(draw(2, copying, hut(40, 49, 'big'), RIVER, road('0', '4', kind))), TWO, undefined).paths.map((path) => path.kind);
    expect(kinds('road')).toEqual(['bridge', 'bridge']);
    expect(kinds('ford')).toEqual(['ford', 'ford']);
    expect(kinds('tunnel')).toEqual(['tunnel', 'tunnel']);
  });

  it('will not lay a ford where there is no river, a river through a hut, or one too short to see', () => {
    expect(refusalOf(drawPath(draw(2, hut(40, 49)), 2, 'ford', { id: '0', copy: 0 }, { id: '4', copy: 0 }))).toBe('A ford has to cross a river.');
    expect(refusalOf(drawRiver(draw(2, hut(40, 49)), 2, { x: 40, y: 10 }, { x: 40, y: 90 }))).toBe('A river cannot run through a hut.');
    expect(refusalOf(drawRiver(EMPTY_PLAN, 2, { x: 40, y: 10 }, { x: 42, y: 11 }))).toBe('Draw a river longer than that.');
  });

  it('copies a stretch with the rest, and lays a stretch drawn over its own copy once', () => {
    expect(expand(draw(2, copying, RIVER), 2).rivers).toHaveLength(2);
    expect(expand(draw(2, copying, (p, n) => drawRiver(p, n, { x: 49, y: 0 }, { x: 49, y: 98 })), 4).rivers).toHaveLength(1);
  });
});

describe('rubbing out', () => {
  it('takes a hut with every path to it, and its copies', () => {
    const left = planOf(eraseAt(SAMPLE(), 2, { x: 26, y: 31 }));
    expect(spots(left, 2)).toEqual(['0,49', '49,49', '98,49']);
    expect(joins(left, 2)).toEqual([]);
  });

  it('takes the path or river nearest the point, and nothing when nothing is near', () => {
    const plan = draw(2, hut(30, 49), road('0', '4'), (p, n) => drawRiver(p, n, { x: 70, y: 10 }, { x: 70, y: 90 }));
    expect(planOf(eraseAt(plan, 2, { x: 15, y: 49 })).items.map((item) => item.is)).toEqual(['piece', 'river']);
    expect(planOf(eraseAt(plan, 2, { x: 70, y: 30 })).items.map((item) => item.is)).toEqual(['piece', 'path']);
    expect(eraseAt(plan, 2, { x: 45, y: 10 })).toBe(null);
  });
});

describe('moving a hut', () => {
  it('takes its copies and its paths with it', () => {
    const plan = draw(2, copying, hut(25, 30, 'mortar'), road('0', '4'));
    const moved = planOf(movePiece(plan, 2, { id: '4', copy: 0 }, { x: 30, y: 20 }));
    expect(piecesAt(moved, 2, 30, 20)).toEqual(['mortar']);
    expect(piecesAt(moved, 2, 68, 78)).toEqual(['mortar']);
    expect(joins(moved, 2)).toEqual(['0,49-30,20', '68,78-98,49']);
  });

  it('moves the same when its copy is the one picked up', () => {
    const plan = draw(2, copying, hut(25, 30), road('0', '4'));
    const moved = planOf(movePiece(plan, 2, { id: '4', copy: 3 }, { x: 68, y: 78 }));
    expect(spots(moved, 2)).toEqual(['0,49', '30,20', '68,78', '98,49']);
  });

  it('leaves behind a path that would run over a hut from where it now stands', () => {
    const plan = draw(2, hut(30, 49), hut(20, 20), road('0', '4'));
    const moved = planOf(movePiece(plan, 2, { id: '4', copy: 0 }, { x: 40, y: 0 }));
    expect(piecesAt(moved, 2, 40, 0)).toEqual(['hut']);
    expect(joins(moved, 2)).toEqual([]);
  });

  it('refuses a spot too close to another hut, and a hut that has gone', () => {
    const plan = draw(2, hut(30, 49), hut(30, 20));
    expect(refusalOf(movePiece(plan, 2, { id: '4', copy: 0 }, { x: 32, y: 24 }))).toBe('That is too close to another hut.');
    expect(refusalOf(movePiece(plan, 2, { id: '9', copy: 0 }, { x: 60, y: 60 }))).toBe('That hut has gone.');
    expect(movePiece(plan, 2, { id: '4', copy: 0 }, { x: 30, y: 49 })).toEqual({ plan });
  });

  it('is undone by the change it made', () => {
    const plan = draw(2, hut(30, 49), road('0', '4'));
    const moved = planOf(movePiece(plan, 2, { id: '4', copy: 0 }, { x: 35, y: 30 }));
    const back = planOf(undoChange(moved, 2, changeOf(plan, moved)));
    expect(spots(back, 2)).toEqual(spots(plan, 2));
    expect(joins(back, 2)).toEqual(joins(plan, 2));
  });
});

describe('copying turned on and off', () => {
  it('turned off keeps the map as it was, each copy a hut that moves by itself', () => {
    const plan = SAMPLE();
    const off = planOf(setMirror(plan, 2, false));
    expect(off.mirror).toBe(false);
    expect(layoutOf(off, 2, 'medium')).toEqual(layoutOf(plan, 2, 'medium'));
    const copy = expand(off, 2).huts.find((each) => each.at.x === 73 && each.at.y === 68)!;
    const moved = planOf(movePiece(off, 2, copy, { x: 80, y: 80 }));
    expect(spots(moved, 2)).toContain('25,30');
    expect(spots(moved, 2)).toContain('80,80');
  });

  it('turned on copies what is there, and refuses where a copy would land on something', () => {
    expect(spots(planOf(setMirror(draw(2, hut(20, 30)), 2, true)), 2)).toEqual(['0,49', '20,30', '78,68', '98,49']);
    expect(refusalOf(setMirror(draw(2, hut(20, 30), hut(80, 68)), 2, true))).toBe('Copied for every side, some of it would land on something. That is too close to another hut.');
  });
});

describe('where a player points', () => {
  it('reads back what it wrote, to the spot', () => {
    expect(parsePointer(encodePointer({ x: 3.4, y: 1.6 }, null))).toEqual({ at: { x: 3, y: 2 }, carry: null });
    expect(parsePointer(encodePointer({ x: 0, y: 98 }, 'longgun'))).toEqual({ at: { x: 0, y: 98 }, carry: 'longgun' });
    expect(parsePointer(encodePointer({ x: 70, y: 20 }, 'river'))).toEqual({ at: { x: 70, y: 20 }, carry: 'river' });
  });

  it('holds a pointer off the board to just beyond it, never below 0 as stored', () => {
    expect(encodePointer({ x: -30, y: 200 }, 'road')).toBe('0 118 road');
    expect(parsePointer(encodePointer({ x: -30, y: 200 }, 'road'))).toEqual({ at: { x: -10, y: 108 }, carry: 'road' });
  });

  it('reads nothing from a shape it does not know', () => {
    expect(parsePointer('10 10 dragon')).toBe(null);
    expect(parsePointer('10')).toBe(null);
    expect(parsePointer('ten 10')).toBe(null);
    expect(parsePointer('1000 10')).toBe(null);
  });
});

describe('undoing an edit', () => {
  const made = (plan: Plan, edit: Edit) => {
    const after = planOf(edit(plan, 2));
    return { after, change: changeOf(plan, after) };
  };
  const undone = (plan: Plan, change: ReturnType<typeof changeOf>) => {
    const done = undoChange(plan, 2, change);
    return 'plan' in done ? encodePlan(done.plan) : done.refusal;
  };

  it('takes back a piece put down', () => {
    const { after, change } = made(SAMPLE(), hut(25, 70, 'cannon'));
    expect(change.added).toEqual([{ is: 'piece', id: '6', piece: 'cannon', at: { x: 25, y: 70 } }]);
    expect(undone(after, change)).toBe(encodePlan(SAMPLE()));
  });

  it('brings back a hut rubbed out with its paths', () => {
    const { after, change } = made(SAMPLE(), (p, n) => eraseAt(p, n, { x: 25, y: 30 })!);
    expect(problemOf(undone(after, change), TWO, undefined, CLASSIC)).toBe(null);
  });

  it('takes back copying turned on', () => {
    const { after, change } = made(draw(2, hut(20, 30)), copying);
    expect(undone(after, change)).toBe('h42030');
  });

  it('leaves alone what someone else drew after it', () => {
    const { after, change } = made(EMPTY_PLAN, hut(30, 30));
    const theirs = drawOn(after, 2, hut(30, 70));
    expect(undone(theirs, change)).toBe('h53070');
  });

  it('does not put a hut back where someone else has put one since', () => {
    const { after, change } = made(draw(2, hut(30, 30)), (p, n) => removePiece(p, n, '4'));
    const theirs = drawOn(after, 2, hut(60, 60));
    expect(undone(theirs, change)).toBe('Someone else has changed that since.');
  });

  it('does not put a path back to a hut someone else has rubbed out', () => {
    const plan = draw(2, hut(30, 49), hut(60, 49), road('0', '4'), road('4', '5'));
    const { after, change } = made(plan, (p, n) => eraseAt(p, n, { x: 45, y: 49 })!);
    expect(change.removed).toEqual([{ is: 'path', kind: 'road', a: '4', b: '5', turn: 0 }]);
    expect(undone(planOf(removePiece(after, 2, '5')), change)).toBe('Someone else has changed that since.');
    expect(undone(after, change)).toBe(encodePlan(plan));
  });

  it('refuses when what comes back would break the drawing', () => {
    const plan = draw(2, hut(40, 10), hut(40, 88), hut(20, 49), hut(60, 49), road('6', '7'));
    const { after, change } = made(plan, (p, n) => eraseAt(p, n, { x: 40, y: 49 })!);
    const theirs = drawOn(after, 2, road('4', '5'));
    expect(undone(theirs, change)).toBe('Two paths cannot cross.');
  });
});

describe('the ready-made layouts', () => {
  it('play for two, three and four sides under every mode and start', () => {
    expect(PLAN_LAYOUTS.length).toBeGreaterThan(0);
    for (const { name, plan } of PLAN_LAYOUTS) {
      for (const sides of [TWO, THREE, FOUR]) {
        const text = plan(sides.length);
        expect(encodePlan(parsePlan(text)), name).toBe(text);
        for (const mode of MODE_IDS) {
          for (const start of START_IDS) expect(problemOf(text, sides, undefined, { ...CLASSIC, mode, start }), `${name} ${sides.length} ${mode} ${start}`).toBe(null);
        }
      }
    }
  });

  it('lay a fair map', () => {
    for (const { name, plan } of PLAN_LAYOUTS) for (const sides of [TWO, THREE, FOUR]) expect(isFair(buildDrawn(1, plan(sides.length), sides, undefined)), `${name} ${sides.length}`).toBe(true);
  });
});

describe('copying lays a fair map', () => {
  it('for two, three and four sides', () => {
    expect(isFair(buildDrawn(1, encodePlan(SAMPLE()), TWO, undefined))).toBe(true);
    expect(isFair(buildDrawn(1, encodePlan(SAMPLE_THREE()), THREE, undefined))).toBe(true);
    const four = draw(4, copying, hut(25, 25), hut(49, 49, 'big'), road('0', '4'), road('4', '5'));
    expect(isFair(buildDrawn(1, encodePlan(four), FOUR, undefined))).toBe(true);
  });

  it('starts each side on its own home, with the third in the middle', () => {
    const map = buildDrawn(1, encodePlan(SAMPLE_THREE()), THREE, undefined);
    expect(map.homes.map((home) => map.sites[home].owner)).toEqual(THREE);
    expect(map.sites[map.homes[2]]).toMatchObject(centreOf(map));
  });

  it('gives every client the same map: huts in board order whatever order they were put down', () => {
    const one = layoutOf(draw(2, hut(30, 30), hut(30, 70), road('0', '4')), 2, 'medium');
    const other = layoutOf(draw(2, hut(30, 70), hut(30, 30), road('5', '0')), 2, 'medium');
    expect(other).toEqual(one);
    const order = one.sites.map((site) => site.y * 10000 + site.x);
    expect(order).toEqual([...order].sort((p, q) => p - q));
  });
});

describe('what stops a drawing being played', () => {
  it('passes a drawing every way the lobby can start it', () => {
    for (const mode of ['classic', 'hill', 'egg', 'blitz'] as ModeId[]) expect(problemOf(encodePlan(SAMPLE()), TWO, undefined, rulesFor(mode)), mode).toBe(null);
    expect(problemOf(encodePlan(SAMPLE_THREE()), THREE, undefined, CLASSIC)).toBe(null);
  });

  it('names huts no path reaches', () => {
    expect(problemOf('', TWO, undefined, CLASSIC)).toBe('There is no way between the homes yet.');
    const half = draw(2, hut(30, 49), hut(60, 49), hut(30, 10), road('0', '4'));
    expect(problemOf(encodePlan(half), TWO, undefined, CLASSIC)).toBe('There is no way between the homes yet.');
    expect(cutOffOf(half, 2).map((each) => each.key)).toEqual(['10', '50', '60']);
    const joined = drawOn(half, 2, road('4', '5'), road('5', '1'));
    expect(problemOf(encodePlan(joined), TWO, undefined, CLASSIC)).toBe('1 hut has no path to the rest.');
    expect(problemOf(encodePlan(drawOn(joined, 2, road('6', '4'))), TWO, undefined, CLASSIC)).toBe(null);
  });

  it('asks for a hut in the very middle to play the hill or the egg', () => {
    const plan = draw(2, hut(30, 49), hut(68, 49), road('0', '4'), road('4', '5'), road('5', '1'));
    expect(problemOf(encodePlan(plan), TWO, undefined, CLASSIC)).toBe(null);
    expect(problemOf(encodePlan(plan), TWO, undefined, rulesFor('hill'))).toBe('Hill needs a hut in the very middle of the map.');
    expect(problemOf(encodePlan(plan), TWO, undefined, rulesFor('egg'))).toBe('Egg needs a hut in the very middle of the map.');
  });

  it('names two huts too close together, as a drawing for fewer sides can leave them when more sit down', () => {
    const plan = draw(2, hut(4, 4), road('0', '4'));
    expect(problemOf(encodePlan(plan), FOUR, undefined, CLASSIC)).toBe('Two huts are too close together.');
  });

  it('puts what the third side needs in words', () => {
    const lopsided = draw(3, hut(30, 49), hut(68, 30), road('0', '4'), road('4', '2'), road('1', '5'), road('5', '2'));
    expect(problemOf(encodePlan(lopsided), THREE, undefined, CLASSIC)).toBe('The middle side needs two plain huts joined to its home, each the mirror of the other through it. Copying for every side lays them.');
    const shared = draw(3, copying, hut(25, 30), road('0', '4'), road('4', '2'));
    expect(problemOf(encodePlan(shared), THREE, undefined, CLASSIC)).toBe('Each side needs a plain hut to start with besides its home.');
  });
});

describe('playing a drawn map', () => {
  it('runs a game between computers on every ground', () => {
    for (const size of ['medium', 'large', 'huge'] as const) {
      const map = buildDrawn(7, encodePlan(SAMPLE()), TWO, size);
      const state = newState(map);
      for (let tick = 0; tick < 600 && !state.winner; tick++) step(state, map, {}, Object.fromEntries(SEATS.slice(0, 2).map((seat) => [seat, 0])));
      expect(state.tick).toBeGreaterThan(100);
      expect(state.huts.some((h, k) => h.owner === 'a' && k !== map.homes[0])).toBe(true);
    }
  });

  it('is played on medium when small is asked for', () => {
    expect(buildDrawn(1, encodePlan(SAMPLE()), TWO, 'small').size).toBe('medium');
  });
});
