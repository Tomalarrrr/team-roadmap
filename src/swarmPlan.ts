// A map the players of a room draw together in the lobby: huts, cannons and
// forts put on a grid, paths drawn between them and rivers along the grid's
// edges. Everything put down is put down for every side at once, turned
// about the middle for two or three sides and mirrored into all four
// corners for four, so the map is as fair as the designed ones.
//
// The drawing is stored on the match as a string (see encodePlan) and every
// client builds the same map from it, so a site's index, which orders name,
// comes from its place on the grid and nothing else.

import {
  CLASSIC,
  FIELD_TOP,
  MOST_SITES,
  SEATS,
  START_UNITS,
  WORLDS,
  BUILDINGS,
  GUN_TYPES,
  buildMap,
  centreOf,
  meetsOf,
  nearOf,
  sideOf,
  sizeOf,
  withPiece,
  type Building,
  type Drawn,
  type GunType,
  type Path,
  type PathKind,
  type Point,
  type Rules,
  type Seat,
  type Site,
  type SizeId,
  type SwarmMap,
} from './swarmGameLogic';

/** Huts stand on a grid this many across and down. Odd both ways, so its middle cell is the middle of the board. */
export const PLAN_COLS = 9;
export const PLAN_ROWS = 5;
/**
 * The most huts a drawing holds, copies for each side counted: a hut on every
 * cell, unless that is more than the designed maps grow to (two short of the
 * most an order can name, as swarmGameLogic keeps them). The grid is the smaller today.
 */
export const PLAN_MOST_HUTS = Math.min(PLAN_COLS * PLAN_ROWS, MOST_SITES - 2);
/** The longest drawing stored. The database holds a room's to the same length. */
export const PLAN_MOST_CHARS = 600;

/**
 * Drawings to start from rather than an empty board. Each is drawn the same
 * in all four corners, so it lays the same map for two, three or four sides,
 * and plays under every mode and start.
 */
export const PLAN_LAYOUTS: readonly { name: string; plan: string }[] = [
  {
    name: 'Diamond',
    plan: 'h00h04h02h21h23h40h44m42pr0021pr2304pr2102pr0223pr4021pr2344pr2142pr4223pr4061pr6344pr6142pr4263pr8061pr6384pr6182pr8263',
  },
  {
    name: 'Two rivers',
    plan: 'h00h04h02h20h24h22h40h44m42pr0020pr0424pr0222pr2022pr2224pr2040pr2444pf2242pr4042pr4244pr4060pr4464pf4262pr6062pr6264pr6080pr6484pr6282r3035r6065',
  },
  {
    name: 'Towers',
    plan: 'h00h04h02h20h24h22t31t33f40f44m42pr0020pr0424pw0222pr2040pr2444ps2242pn2031pn3324pn3142pn4233pr4060pr4464ps4262pr6080pr6484pw6282pn6051pn5364pn5142pn4253pr0002pr0204',
  },
];

export type PlanPiece = 'hut' | 'big' | 'fort' | 'cannon' | GunType | Building;
export const PLAN_PIECES: readonly PlanPiece[] = ['hut', 'big', 'fort', 'cannon', ...GUN_TYPES, ...BUILDINGS];
// Never p or r, which lead a path and a river. The database rules list the same letters.
const PIECE_CHAR: Record<PlanPiece, string> = {
  hut: 'h',
  big: 'm',
  fort: 'f',
  cannon: 't',
  mortar: 'o',
  ballista: 'b',
  web: 'w',
  flame: 'l',
  longgun: 'g',
  trap: 'x',
  barracks: 'k',
  granary: 'y',
  beacon: 'e',
  hall: 'a',
  watch: 'v',
  burrow: 'u',
};

/** The paths that can be drawn. One drawn over a river is a bridge, but for a ford or a tunnel, which keep their own kind. */
export type PlanPath = 'road' | 'wide' | 'narrow' | 'spikes' | 'tunnel' | 'ford';
export const PLAN_PATHS: readonly PlanPath[] = ['road', 'wide', 'narrow', 'spikes', 'tunnel', 'ford'];
const PATH_CHAR: Record<PlanPath, string> = { road: 'r', wide: 'w', narrow: 'n', spikes: 's', tunnel: 'u', ford: 'f' };

/** A cell of the grid, or for a river a corner between cells: corner (k, j) is the one up and left of cell (k, j). */
export interface Spot {
  c: number;
  r: number;
}

export type PlanItem =
  | { is: 'piece'; piece: PlanPiece; at: Spot }
  | { is: 'path'; kind: PlanPath; a: Spot; b: Spot }
  | { is: 'river'; a: Spot; b: Spot };

const same = (p: Spot, q: Spot) => p.c === q.c && p.r === q.r;
const keyOf = (p: Spot) => `${p.c},${p.r}`;
/** A path or river's two ends in one order, so the same line drawn either way is stored once. */
const ordered = (a: Spot, b: Spot): [Spot, Spot] => (a.r < b.r || (a.r === b.r && a.c < b.c) ? [a, b] : [b, a]);

export function encodePlan(items: readonly PlanItem[]): string {
  return items
    .map((item) =>
      item.is === 'piece'
        ? `${PIECE_CHAR[item.piece]}${item.at.c}${item.at.r}`
        : `${item.is === 'path' ? `p${PATH_CHAR[item.kind]}` : 'r'}${item.a.c}${item.a.r}${item.b.c}${item.b.r}`,
    )
    .join('');
}

/** Reads a drawing back. The database lets only well-formed ones be stored, so a bad one is an error, not a gap. */
export function parsePlan(text: string): PlanItem[] {
  const items: PlanItem[] = [];
  const cell = (k: number, corner: boolean): Spot => {
    const c = Number(text[k]);
    const r = Number(text[k + 1]);
    if (!(c >= 0 && r >= 0 && c < PLAN_COLS + (corner ? 1 : 0) && r < PLAN_ROWS + (corner ? 1 : 0))) throw new Error(`Unreadable map drawing at ${k}`);
    return { c, r };
  };
  for (let k = 0; k < text.length; ) {
    const lead = text[k];
    const piece = PLAN_PIECES.find((each) => PIECE_CHAR[each] === lead);
    if (piece) {
      items.push({ is: 'piece', piece, at: cell(k + 1, false) });
      k += 3;
    } else if (lead === 'p') {
      const kind = PLAN_PATHS.find((each) => PATH_CHAR[each] === text[k + 1]);
      if (!kind) throw new Error(`Unreadable map drawing at ${k}`);
      items.push({ is: 'path', kind, a: cell(k + 2, false), b: cell(k + 4, false) });
      k += 6;
    } else if (lead === 'r') {
      items.push({ is: 'river', a: cell(k + 1, true), b: cell(k + 3, true) });
      k += 5;
    } else {
      throw new Error(`Unreadable map drawing at ${k}`);
    }
  }
  return items;
}

/** Where each side starts: the ends of the middle row for two or three, the third in the middle; the corners for four. */
export function homeSpots(count: number): Spot[] {
  const mid = (PLAN_ROWS - 1) / 2;
  if (count === 4) return [{ c: 0, r: 0 }, { c: PLAN_COLS - 1, r: PLAN_ROWS - 1 }, { c: PLAN_COLS - 1, r: 0 }, { c: 0, r: PLAN_ROWS - 1 }];
  const ends = [{ c: 0, r: mid }, { c: PLAN_COLS - 1, r: mid }];
  return count === 3 ? [...ends, { c: (PLAN_COLS - 1) / 2, r: mid }] : ends;
}

/**
 * A cell and its copies for `count` sides, itself first: its half-turn, and
 * for four its mirrors left to right and top to bottom, in the order the
 * homes are. A cell on a line of the symmetry is its own copy and stands once.
 * `corner` takes corners, of which there is one more each way.
 */
export function imagesOf(p: Spot, count: number, corner = false): Spot[] {
  const right = PLAN_COLS - 1 + (corner ? 1 : 0);
  const bottom = PLAN_ROWS - 1 + (corner ? 1 : 0);
  const all = [p, { c: right - p.c, r: bottom - p.r }];
  if (count === 4) all.push({ c: right - p.c, r: p.r }, { c: p.c, r: bottom - p.r });
  return all.filter((q, k) => all.findIndex((other) => same(other, q)) === k);
}

/** The same move applied to both ends of a line: a path's or river's copies. */
export function lineImages(a: Spot, b: Spot, count: number, corner: boolean): [Spot, Spot][] {
  // imagesOf drops a copy that lands on itself, which would pair the wrong ends, so each move is applied to both ends here.
  const right = PLAN_COLS - 1 + (corner ? 1 : 0);
  const bottom = PLAN_ROWS - 1 + (corner ? 1 : 0);
  const full = (p: Spot, k: number): Spot =>
    k === 0 ? p : k === 1 ? { c: right - p.c, r: bottom - p.r } : k === 2 ? { c: right - p.c, r: p.r } : { c: p.c, r: bottom - p.r };
  const moves = count === 4 ? 4 : 2;
  const lines: [Spot, Spot][] = [];
  for (let k = 0; k < moves; k++) {
    const line = ordered(full(a, k), full(b, k));
    if (!lines.some((other) => same(other[0], line[0]) && same(other[1], line[1]))) lines.push(line);
  }
  return lines;
}

/** Everything the drawing puts down for `count` sides, copies and homes included. */
export interface Expanded {
  /** Each hut by its cell's key. A home is a hut whose piece is the side's. */
  huts: Map<string, { at: Spot; piece: PlanPiece | Seat }>;
  paths: { a: Spot; b: Spot; kind: PlanPath }[];
  rivers: { a: Spot; b: Spot }[];
}

export function expand(items: readonly PlanItem[], count: number): Expanded {
  const huts: Expanded['huts'] = new Map();
  const paths: Expanded['paths'] = [];
  const rivers: Expanded['rivers'] = [];
  for (const item of items) {
    if (item.is === 'piece') {
      for (const at of imagesOf(item.at, count)) huts.set(keyOf(at), { at, piece: item.piece });
    } else if (item.is === 'path') {
      for (const [a, b] of lineImages(item.a, item.b, count, false)) {
        const was = paths.findIndex((path) => same(path.a, a) && same(path.b, b));
        if (was >= 0) paths.splice(was, 1);
        paths.push({ a, b, kind: item.kind });
      }
    } else {
      for (const [a, b] of lineImages(item.a, item.b, count, true)) {
        if (!rivers.some((river) => same(river.a, a) && same(river.b, b))) rivers.push({ a, b });
      }
    }
  }
  homeSpots(count).forEach((at, k) => huts.set(keyOf(at), { at, piece: SEATS[k] }));
  return { huts, paths, rivers };
}

/** The grid's step on a ground, and where a cell or a corner of it stands in the world. */
export function gridOf(size: SizeId) {
  const { w, h } = WORLDS[size];
  const { x: cx, y: cy } = centreOf({ w, h });
  // The same edges the grown maps keep their huts inside.
  const left = 75;
  const top = FIELD_TOP + 75;
  const sx = Math.floor((w - 2 * left) / (PLAN_COLS - 1));
  const sy = Math.floor((2 * (cy - top)) / (PLAN_ROWS - 1));
  const midC = (PLAN_COLS - 1) / 2;
  const midR = (PLAN_ROWS - 1) / 2;
  return {
    sx,
    sy,
    cell: (p: Spot): Point => ({ x: cx + (p.c - midC) * sx, y: cy + (p.r - midR) * sy }),
    corner: (p: Spot): Point => ({ x: cx + (p.c - midC - 0.5) * sx, y: cy + (p.r - midR - 0.5) * sy }),
  };
}

/** The checks below are made on the medium ground, the one the grid is laid for; the bigger ones only spread it out. */
const CHECK = gridOf('medium');
/** How near a path may run to a hut it does not end at, and a river to any hut. */
const CLEAR = 60;

const crosses = (p: Point, q: Point, u: Point, v: Point) => sideOf(p, q, u) * sideOf(p, q, v) < 0 && sideOf(u, v, p) * sideOf(u, v, q) < 0;
const overRiver = (a: Spot, b: Spot, rivers: Expanded['rivers']) =>
  rivers.some((river) => meetsOf(CHECK.cell(a), CHECK.cell(b), [CHECK.corner(river.a), CHECK.corner(river.b)]) > 0);

/** What is wrong with these paths and rivers where they meet each other and the huts, or null. */
function clashOf(huts: Expanded['huts'], paths: Expanded['paths'], rivers: Expanded['rivers']): string | null {
  for (const [k, path] of paths.entries()) {
    const p = CHECK.cell(path.a);
    const q = CHECK.cell(path.b);
    for (const hut of huts.values()) {
      if (!same(hut.at, path.a) && !same(hut.at, path.b) && nearOf(CHECK.cell(hut.at), p, q) < CLEAR * CLEAR) return 'A path cannot run over a hut.';
    }
    if (paths.slice(0, k).some((other) => crosses(p, q, CHECK.cell(other.a), CHECK.cell(other.b)))) return 'Two paths cannot cross.';
    if (path.kind === 'ford' && !overRiver(path.a, path.b, rivers)) return 'A ford has to cross a river.';
  }
  for (const river of rivers) {
    for (const hut of huts.values()) {
      if (nearOf(CHECK.cell(hut.at), CHECK.corner(river.a), CHECK.corner(river.b)) < CLEAR * CLEAR) return 'A river cannot run through a hut.';
    }
  }
  return null;
}

/** A drawing, or why the change asked of it was refused. */
export type PlanEdit = { items: PlanItem[] } | { refusal: string };

function checked(items: PlanItem[], count: number): PlanEdit {
  if (encodePlan(items).length > PLAN_MOST_CHARS) return { refusal: 'The drawing is full.' };
  const all = expand(items, count);
  if (all.huts.size > PLAN_MOST_HUTS) return { refusal: `A map holds ${PLAN_MOST_HUTS} huts, copies for each side counted.` };
  const clash = clashOf(all.huts, all.paths, all.rivers);
  return clash ? { refusal: clash } : { items };
}

const isHome = (at: Spot, count: number) => homeSpots(count).some((home) => same(home, at));
/**
 * The drawn pieces whose copies cover this spot. Usually one, but two drawn
 * for two sides can be copies of each other once a third and fourth side join.
 */
const ownersOf = (items: readonly PlanItem[], at: Spot, count: number) =>
  items.flatMap((item, k) => (item.is === 'piece' && imagesOf(item.at, count).some((p) => same(p, at)) ? [k] : []));
/** Whether two paths, or two river stretches, lie on the same line once each is copied. */
const sameLine = (one: { a: Spot; b: Spot }, other: { a: Spot; b: Spot }, count: number, corner: boolean) =>
  lineImages(one.a, one.b, count, corner).some(([p, q]) => lineImages(other.a, other.b, count, corner).some(([u, v]) => same(p, u) && same(q, v)));

/** Puts a piece on a cell and its copies, in place of whatever piece stood there. */
export function placePiece(items: readonly PlanItem[], count: number, piece: PlanPiece, at: Spot): PlanEdit {
  if (isHome(at, count)) return { refusal: 'A side starts there.' };
  const was = ownersOf(items, at, count);
  const rest = items.filter((_, k) => !was.includes(k));
  return checked([...rest, { is: 'piece', piece, at }], count);
}

/**
 * Draws a path between two huts and its copies, or changes the kind of one
 * already there. A path from a home puts a plain hut under it too, so that
 * with another count of sides, when the homes stand elsewhere, it still ends at a hut.
 */
export function drawPath(items: readonly PlanItem[], count: number, kind: PlanPath, from: Spot, to: Spot): PlanEdit {
  if (same(from, to)) return { refusal: 'A path joins two huts.' };
  const huts = expand(items, count).huts;
  if (!huts.has(keyOf(from)) || !huts.has(keyOf(to))) return { refusal: 'A path joins two huts.' };
  const [a, b] = ordered(from, to);
  const rest = items.filter((item) => item.is !== 'path' || !sameLine(item, { a, b }, count, false));
  const under = [from, to].filter((end) => isHome(end, count) && ownersOf(items, end, count).length === 0).map((at): PlanItem => ({ is: 'piece', piece: 'hut', at }));
  return checked([...rest, ...under, { is: 'path', kind, a, b }], count);
}

/** Draws a stretch of river between two corners of the grid, and its copies. */
export function drawRiver(items: readonly PlanItem[], count: number, from: Spot, to: Spot): PlanEdit {
  if (same(from, to)) return { refusal: 'A river runs between two corners.' };
  const [a, b] = ordered(from, to);
  if (items.some((item) => item.is === 'river' && sameLine(item, { a, b }, count, true))) return { items: [...items] };
  return checked([...items, { is: 'river', a, b }], count);
}

/**
 * Takes away what is at a point of the board, in grid units (cell (c, r) is
 * at c, r): a hut and every path to it, or else the nearest path or river
 * stretch within reach, with any drawn again over it. Null when nothing is near enough.
 */
export function eraseAt(items: readonly PlanItem[], count: number, x: number, y: number): PlanItem[] | null {
  const at = { c: Math.round(x), r: Math.round(y) };
  const point = { x: CHECK.cell({ c: 0, r: 0 }).x + x * CHECK.sx, y: CHECK.cell({ c: 0, r: 0 }).y + y * CHECK.sy };
  const huts = ownersOf(items, at, count);
  if (huts.length > 0 && Math.hypot(x - at.c, y - at.r) < 0.35) {
    const gone = huts.flatMap((k) => imagesOf((items[k] as { at: Spot }).at, count));
    const touches = (p: Spot) => gone.some((q) => same(p, q));
    return items.filter((item, k) => !huts.includes(k) && (item.is !== 'path' || lineImages(item.a, item.b, count, false).every(([a, b]) => !touches(a) && !touches(b))));
  }
  let best = -1;
  let least = (0.3 * CHECK.sx) ** 2;
  items.forEach((item, k) => {
    if (item.is === 'piece') return;
    const corner = item.is === 'river';
    const spot = corner ? CHECK.corner : CHECK.cell;
    for (const [a, b] of lineImages(item.a, item.b, count, corner)) {
      const near = nearOf(point, spot(a), spot(b));
      if (near < least) {
        least = near;
        best = k;
      }
    }
  });
  if (best < 0) return null;
  const line = items[best] as Extract<PlanItem, { a: Spot }>;
  return items.filter((item) => item.is !== line.is || !sameLine(item, line, count, line.is === 'river'));
}

/** What one edit put down and took away, item by item, so it can be taken back without touching anyone else's. */
export interface PlanChange {
  added: PlanItem[];
  removed: PlanItem[];
}

const codeOf = (item: PlanItem) => encodePlan([item]);
/** The items less one of each of `others`, matched by how they are stored. */
function without(items: readonly PlanItem[], others: readonly PlanItem[]): PlanItem[] {
  const left = others.map(codeOf);
  return items.filter((item) => {
    const k = left.indexOf(codeOf(item));
    if (k >= 0) left.splice(k, 1);
    return k < 0;
  });
}

export function changeOf(before: readonly PlanItem[], after: readonly PlanItem[]): PlanChange {
  return { added: without(after, before), removed: without(before, after) };
}

/**
 * Takes one edit back from the drawing as it stands now, which others in the
 * room may have drawn on since: what the edit put down goes if it is still
 * there, and what it took away comes back where nothing has been put since. A
 * path that comes back with no hut left at an end stays away.
 */
export function undoChange(items: readonly PlanItem[], count: number, change: PlanChange): PlanEdit {
  const kept = without(items, change.added);
  const back: PlanItem[] = [];
  for (const item of change.removed) {
    const now = [...kept, ...back];
    const taken =
      item.is === 'piece'
        ? ownersOf(now, item.at, count).length > 0
        : now.some((other) => other.is === item.is && sameLine(other, item, count, item.is === 'river'));
    if (!taken) back.push(item);
  }
  const huts = expand([...kept, ...back], count).huts;
  const next = [...kept, ...back.filter((item) => item.is !== 'path' || (huts.has(keyOf(item.a)) && huts.has(keyOf(item.b))))];
  const moved = changeOf(items, next);
  if (moved.added.length === 0 && moved.removed.length === 0) return { refusal: 'Someone else has changed that since.' };
  return checked(next, count);
}

const HUT: Site = { x: 0, y: 0, owner: null, n: 10, level: 1 };

/** The site a piece stands as, before it is put where it goes. Guns and buildings stand on a plain hut. */
function siteOf(piece: PlanPiece | Seat): Site {
  if (isSeat(piece)) return { ...HUT, owner: piece, n: START_UNITS };
  if (piece === 'big') return { ...HUT, n: 20, level: 2 };
  if (piece === 'fort') return { ...HUT, n: 15, level: 2, fort: true };
  return withPiece(HUT, piece);
}

const isSeat = (piece: PlanPiece | Seat): piece is Seat => (SEATS as readonly string[]).includes(piece);

/** The huts, paths and rivers a drawing lays for `count` sides on a ground. Sites go in grid order, row by row. */
export function layoutOf(items: readonly PlanItem[], count: number, size: SizeId): Drawn {
  const grid = gridOf(size);
  const all = expand(items, count);
  const spots = [...all.huts.values()].sort((p, q) => p.at.r - q.at.r || p.at.c - q.at.c);
  const index = new Map(spots.map((spot, k) => [keyOf(spot.at), k]));
  const sites = spots.map(({ at, piece }): Site => ({ ...siteOf(piece), ...grid.cell(at) }));
  const paths = all.paths
    .map(({ a, b, kind }): Path => {
      const [i, j] = [index.get(keyOf(a))!, index.get(keyOf(b))!].sort((p, q) => p - q);
      const wet = overRiver(a, b, all.rivers);
      const built: PathKind = wet && kind !== 'tunnel' && kind !== 'ford' ? 'bridge' : kind;
      return { a: i, b: j, kind: built };
    })
    .sort((p, q) => p.a - q.a || p.b - q.b);
  const rivers = all.rivers.map((river) => [grid.corner(river.a), grid.corner(river.b)]);
  return { sites, paths, rivers };
}

/** The map a drawing plays as. Throws, with the reason, when it cannot be played by these sides and rules. */
export function buildDrawn(seed: number, plan: string, sides: readonly Seat[], size: SizeId | undefined, rules: Rules = CLASSIC): SwarmMap {
  const ground = sizeOf('drawn', sides.length, size);
  return buildMap(seed, 'drawn', sides, ground, rules, layoutOf(parsePlan(plan), sides.length, ground));
}

/** The huts no path leads to from the first side's home, other homes among them: what is left to join up. */
export function cutOffOf(items: readonly PlanItem[], count: number): Spot[] {
  const all = expand(items, count);
  const next = new Map<string, string[]>();
  for (const { a, b } of all.paths) {
    next.set(keyOf(a), [...(next.get(keyOf(a)) ?? []), keyOf(b)]);
    next.set(keyOf(b), [...(next.get(keyOf(b)) ?? []), keyOf(a)]);
  }
  const reached = new Set([keyOf(homeSpots(count)[0])]);
  for (const at of reached) for (const to of next.get(at) ?? []) reached.add(to);
  return [...all.huts.values()].filter((hut) => !reached.has(keyOf(hut.at))).map((hut) => hut.at);
}

/**
 * Why a drawing cannot be played by these sides and rules, in words for the
 * lobby, or null when it can. The common reasons are named here; anything
 * else the map's own building refuses is passed on as it says it.
 */
export function problemOf(plan: string, sides: readonly Seat[], size: SizeId | undefined, rules: Rules): string | null {
  const items = parsePlan(plan);
  const count = sides.length;
  const all = expand(items, count);
  if (all.huts.size > PLAN_MOST_HUTS) return `There are ${all.huts.size} huts with the copies for ${count} sides, and a map holds ${PLAN_MOST_HUTS}.`;
  for (const path of all.paths) if (!all.huts.has(keyOf(path.a)) || !all.huts.has(keyOf(path.b))) return 'A path ends where there is no hut.';
  const clash = clashOf(all.huts, all.paths, all.rivers);
  if (clash) return clash;
  const middle = keyOf({ c: (PLAN_COLS - 1) / 2, r: (PLAN_ROWS - 1) / 2 });
  if (count !== 3 && (rules.mode === 'hill' || rules.mode === 'egg') && !all.huts.has(middle)) return `${rules.mode === 'hill' ? 'Hill' : 'Egg'} needs a hut in the middle of the map.`;
  const cut = cutOffOf(items, count);
  if (cut.some((at) => isHome(at, count))) return 'There is no way between the homes yet.';
  if (cut.length > 0) return cut.length === 1 ? '1 hut has no path to the rest.' : `${cut.length} huts have no path to the rest.`;
  try {
    buildDrawn(0, plan, sides, size, rules);
  } catch (err) {
    const said = (err as Error).message;
    return SAID.find(([start]) => said.startsWith(start))?.[1] ?? said;
  }
  return null;
}

/** The start's refusals the lobby can put better for a drawing, by how the map's building words them. */
const SAID: [string, string][] = [
  ['No pair of huts by the middle', 'The middle side needs two plain huts joined to its home, one each side of it.'],
  ['No hut to give the first seat', 'Each side needs a plain hut to start with besides its home.'],
  ['No close start', 'The close start needs a hut two paths from the other side. Draw a longer way between the homes.'],
];

/**
 * The drawing as the editor shows it: its huts, paths and rivers with each
 * side on its home, before any start or mode moves them. Unlike buildDrawn it
 * never refuses, so a drawing half made can still be shown.
 */
export function sketchOf(items: readonly PlanItem[], sides: readonly Seat[], size: SizeId | undefined): SwarmMap {
  const ground = sizeOf('drawn', sides.length, size);
  const layout = layoutOf(items, sides.length, ground);
  const sites = layout.sites.map((site) => (site.owner ? { ...site, owner: sides[SEATS.indexOf(site.owner)] } : site));
  const links: number[][] = sites.map(() => []);
  for (const path of layout.paths) {
    links[path.a].push(path.b);
    links[path.b].push(path.a);
  }
  const { w, h } = WORLDS[ground];
  const homes = sides.map((seat) => sites.findIndex((site) => site.owner === seat));
  return { id: 'drawn', scene: 'meadow', sites, links, paths: layout.paths, rivers: layout.rivers, sides, homes, size: ground, w, h, ticks: 0, rules: CLASSIC };
}
