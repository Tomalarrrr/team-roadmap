// A map the players of a room draw together in the lobby: huts, cannons and
// forts put down anywhere on the board, paths drawn between them and rivers
// across it. A side's home can be moved like any hut. With copying turned
// on, everything put down is put down for every side at once, turned about
// the middle for two or three sides and mirrored into all four corners for
// four, so the map is as fair as the designed ones.
//
// The drawing is stored on the match as a string (see encodePlan) and every
// client builds the same map from it, so a site's index, which orders name,
// comes from where it stands and nothing else.

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

/** A spot on the board runs from 0 to this each way, two digits stored. Even, so the middle is a spot of its own. */
export const PLAN_SPAN = 98;
const MID = PLAN_SPAN / 2;
/** The most huts a drawing holds, copies and homes counted: two short of the most an order can name, as the designed maps keep them. */
export const PLAN_MOST_HUTS = MOST_SITES - 2;
/** The longest drawing stored. The database holds a room's to the same length. */
export const PLAN_MOST_CHARS = 1500;

export type PlanPiece = 'hut' | 'big' | 'fort' | 'cannon' | GunType | Building;
export const PLAN_PIECES: readonly PlanPiece[] = ['hut', 'big', 'fort', 'cannon', ...GUN_TYPES, ...BUILDINGS];
// Never M, s, p or r, which lead the copying flag, a home, a path and a river. The database rules list the same letters.
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

/** A spot on the board, each way 0 to PLAN_SPAN. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * The homes are huts 0 to 3, the seats in order; drawn huts take the other
 * names an order can carry, so a path names its ends the same way whichever
 * hut has moved since.
 */
const HOME_IDS = '0123';
const HUT_IDS = '456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const isHomeId = (id: string) => HOME_IDS.includes(id);

export type PlanItem =
  | { is: 'piece'; id: string; piece: PlanPiece; at: Pt }
  /** A home moved from where it starts for this many sides (see homesOf). */
  | { is: 'home'; seat: number; at: Pt }
  /** A path from hut a to hut b's copy `turn` away from a's (see turnOf): 0 for b itself. */
  | { is: 'path'; kind: PlanPath; a: string; b: string; turn: number }
  | { is: 'river'; a: Pt; b: Pt };

export interface Plan {
  /** Whether what is put down is copied for every side. */
  mirror: boolean;
  items: PlanItem[];
}

export const EMPTY_PLAN: Plan = { mirror: false, items: [] };

const two = (v: number) => String(v).padStart(2, '0');
const spotCode = (p: Pt) => `${two(p.x)}${two(p.y)}`;

function itemCode(item: PlanItem): string {
  if (item.is === 'piece') return `${PIECE_CHAR[item.piece]}${item.id}${spotCode(item.at)}`;
  if (item.is === 'home') return `s${item.seat}${spotCode(item.at)}`;
  if (item.is === 'path') return `p${PATH_CHAR[item.kind]}${item.a}${item.b}${item.turn}`;
  return `r${spotCode(item.a)}${spotCode(item.b)}`;
}

export function encodePlan(plan: Plan): string {
  return (plan.mirror ? 'M' : '') + plan.items.map(itemCode).join('');
}

/** Reads a drawing back. The database lets only well-formed ones be stored, so a bad one is an error, not a gap. */
export function parsePlan(text: string): Plan {
  const bad = (k: number) => new Error(`Unreadable map drawing at ${k}`);
  const spot = (k: number): Pt => {
    const digits = text.slice(k, k + 4);
    if (!/^\d{4}$/.test(digits)) throw bad(k);
    const p = { x: Number(digits.slice(0, 2)), y: Number(digits.slice(2)) };
    if (p.x > PLAN_SPAN || p.y > PLAN_SPAN) throw bad(k);
    return p;
  };
  const id = (k: number, among: string) => {
    if (!among.includes(text[k] ?? '-')) throw bad(k);
    return text[k];
  };
  const mirror = text.startsWith('M');
  const items: PlanItem[] = [];
  for (let k = mirror ? 1 : 0; k < text.length; ) {
    const lead = text[k];
    const piece = PLAN_PIECES.find((each) => PIECE_CHAR[each] === lead);
    if (piece) {
      items.push({ is: 'piece', piece, id: id(k + 1, HUT_IDS), at: spot(k + 2) });
      k += 6;
    } else if (lead === 's') {
      items.push({ is: 'home', seat: Number(id(k + 1, HOME_IDS)), at: spot(k + 2) });
      k += 6;
    } else if (lead === 'p') {
      const kind = PLAN_PATHS.find((each) => PATH_CHAR[each] === text[k + 1]);
      if (!kind) throw bad(k);
      items.push({ is: 'path', kind, a: id(k + 2, HOME_IDS + HUT_IDS), b: id(k + 3, HOME_IDS + HUT_IDS), turn: Number(id(k + 4, '0123')) });
      k += 5;
    } else if (lead === 'r') {
      items.push({ is: 'river', a: spot(k + 1), b: spot(k + 5) });
      k += 9;
    } else {
      throw bad(k);
    }
  }
  return { mirror, items };
}

/**
 * The moves that copy a drawing, by number: 1 mirrors left to right, 2 top
 * to bottom, and 3, both, is the half-turn. Each undoes itself, and two
 * together are the one their numbers make bitwise apart.
 */
export function turnOf(p: Pt, move: number): Pt {
  return { x: move & 1 ? PLAN_SPAN - p.x : p.x, y: move & 2 ? PLAN_SPAN - p.y : p.y };
}
/** The moves a drawing is copied by for `count` sides: none unless copying is on, the half-turn for two or three, all four for four. */
export const turnsOf = (plan: Plan, count: number): number[] => (!plan.mirror ? [0] : count === 4 ? [0, 1, 2, 3] : [0, 3]);
/** The move from the first home to each of the others when copying: the half-turn to the second, the mirrors to the third and fourth. */
const HOME_TURN = [0, 3, 1, 2];
const MIDDLE: Pt = { x: MID, y: MID };

/** Where each side starts until a home is moved: the ends of the middle row for two or three, the third in the middle; the corners for four. */
export function startSpots(count: number): Pt[] {
  if (count === 4) return [{ x: 0, y: 0 }, { x: PLAN_SPAN, y: PLAN_SPAN }, { x: PLAN_SPAN, y: 0 }, { x: 0, y: PLAN_SPAN }];
  const ends = [{ x: 0, y: MID }, { x: PLAN_SPAN, y: MID }];
  return count === 3 ? [...ends, MIDDLE] : ends;
}

/**
 * Where each of `count` sides starts. Copying, the first home places the
 * rest, but for the third of three, who starts in the middle.
 */
export function homesOf(plan: Plan, count: number): Pt[] {
  const moved = (seat: number) => plan.items.find((item): item is Extract<PlanItem, { is: 'home' }> => item.is === 'home' && item.seat === seat)?.at;
  const starts = startSpots(count);
  if (!plan.mirror) return starts.map((start, k) => moved(k) ?? start);
  const first = moved(0) ?? starts[0];
  return starts.map((_, k) => (count === 3 && k === 2 ? MIDDLE : turnOf(first, HOME_TURN[k])));
}

/** A hut of the map as drawn for some count of sides: a home, a drawn hut, or one of its copies. */
export interface PlanHut {
  /** Which hut: its id and, after it, which copy (see turnOf), so it stays the same hut while it is moved. */
  key: string;
  id: string;
  copy: number;
  at: Pt;
  piece: PlanPiece | Seat;
}

/** Everything a drawing puts down for `count` sides, copies and homes included. */
export interface Expanded {
  turns: number[];
  huts: PlanHut[];
  /**
   * The hut standing for each drawn hut and copy, by id then copy. Two put
   * on the very same spot are one hut, a home first and then the one put
   * down first, so a hut drawn where a side starts for another count of
   * sides is that side's home while it plays.
   */
  node: Map<string, number>;
  /** Each between two huts, by their place in `huts`, with the drawn item it was copied from. */
  paths: { a: number; b: number; kind: PlanPath; from: number }[];
  rivers: { a: Pt; b: Pt; from: number }[];
}

const ptKey = (p: Pt) => `${p.x},${p.y}`;

export function expand(plan: Plan, count: number): Expanded {
  const turns = turnsOf(plan, count);
  const huts: PlanHut[] = [];
  const node = new Map<string, number>();
  const standing = new Map<string, number>();
  const put = (id: string, copy: number, at: Pt, piece: PlanPiece | Seat) => {
    const there = standing.get(ptKey(at));
    if (there !== undefined) return node.set(id + copy, there);
    standing.set(ptKey(at), huts.length);
    node.set(id + copy, huts.length);
    huts.push({ key: id + copy, id, copy, at, piece });
  };
  const homes = homesOf(plan, count);
  homes.forEach((at, k) => put(HOME_IDS[k], 0, at, SEATS[k]));
  homes.forEach((at, k) => turns.forEach((move) => put(HOME_IDS[k], move, turnOf(at, move), SEATS[k])));
  for (const item of plan.items) if (item.is === 'piece') for (const move of turns) put(item.id, move, turnOf(item.at, move), item.piece);
  const paths: Expanded['paths'] = [];
  const rivers: Expanded['rivers'] = [];
  plan.items.forEach((item, from) => {
    if (item.is === 'path') {
      for (const [a, b] of pairsOf(item, node, turns)) {
        const was = paths.findIndex((path) => path.a === a && path.b === b);
        if (was >= 0) paths.splice(was, 1);
        paths.push({ a, b, kind: item.kind, from });
      }
    } else if (item.is === 'river') {
      for (const move of turns) {
        const [a, b] = [turnOf(item.a, move), turnOf(item.b, move)];
        if (!rivers.some((river) => (same(river.a, a) && same(river.b, b)) || (same(river.a, b) && same(river.b, a)))) rivers.push({ a, b, from });
      }
    }
  });
  return { turns, huts, node, paths, rivers };
}

const same = (p: Pt, q: Pt) => p.x === q.x && p.y === q.y;

/** The pairs of huts, lower place first, a drawn path and its copies join. A path to a hut not on the map lays nothing. */
function pairsOf(item: Extract<PlanItem, { is: 'path' }>, node: Map<string, number>, turns: number[]): [number, number][] {
  const pairs: [number, number][] = [];
  if (!turns.includes(item.turn)) return pairs;
  for (const move of turns) {
    const a = node.get(item.a + move);
    const b = node.get(item.b + (move ^ item.turn));
    if (a === undefined || b === undefined || a === b) continue;
    const pair: [number, number] = a < b ? [a, b] : [b, a];
    if (!pairs.some(([p, q]) => p === pair[0] && q === pair[1])) pairs.push(pair);
  }
  return pairs;
}

/** Where a spot stands on a ground. Rounded away from the middle evenly both ways, so a copy stands at exactly the mirror of what it copies. */
export function worldOf(p: Pt, size: SizeId): Point {
  const { w, h } = WORLDS[size];
  const { x: cx, y: cy } = centreOf({ w, h });
  // The same edges the grown maps keep their huts inside.
  const left = 75;
  const top = FIELD_TOP + 75;
  const even = (v: number) => Math.sign(v) * Math.round(Math.abs(v));
  return { x: cx + even(((p.x - MID) * (w - 2 * left)) / PLAN_SPAN), y: cy + even(((p.y - MID) * 2 * (cy - top)) / PLAN_SPAN) };
}

/** The spot nearest a point of a ground, which may be off the board: the caller decides what that means. */
export function spotOf(point: Point, size: SizeId): Pt {
  const { w, h } = WORLDS[size];
  const { x: cx, y: cy } = centreOf({ w, h });
  const top = FIELD_TOP + 75;
  return { x: Math.round(MID + ((point.x - cx) * PLAN_SPAN) / (w - 150)), y: Math.round(MID + ((point.y - cy) * PLAN_SPAN) / (2 * (cy - top))) };
}

const onBoard = (p: Pt): Pt => ({ x: Math.min(PLAN_SPAN, Math.max(0, Math.round(p.x))), y: Math.min(PLAN_SPAN, Math.max(0, Math.round(p.y))) });

/** The checks below are made on the medium ground, the one drawn maps are played on but for the bigger ones, which only spread them out. */
const CHECK: SizeId = 'medium';
const at = (p: Pt) => worldOf(p, CHECK);
/** The nearest two huts may stand: the biggest hut's ring is 58 across from its middle, so two of them do not touch. */
const GAP = 120;
/** How near a path may run to a hut it does not end at, and a river to any hut. */
const CLEAR = 60;
/** How near a press must be to a hut to take it, and to a path or a river. */
const HUT_REACH = 55;
const LINE_REACH = 28;

const crosses = (p: Point, q: Point, u: Point, v: Point) => sideOf(p, q, u) * sideOf(p, q, v) < 0 && sideOf(u, v, p) * sideOf(u, v, q) < 0;
const overRiver = (a: Pt, b: Pt, rivers: Expanded['rivers']) => rivers.some((river) => meetsOf(at(a), at(b), [at(river.a), at(river.b)]) > 0);

/** Each thing wrong where the huts, paths and rivers meet, keyed by what it is between so an edit can be told from what was wrong before it. */
function clashesOf(all: Expanded): { key: string; said: string }[] {
  const clashes: { key: string; said: string }[] = [];
  const { huts, paths, rivers } = all;
  huts.forEach((hut, k) => {
    for (const other of huts.slice(0, k)) {
      const [p, q] = [at(hut.at), at(other.at)];
      if (Math.hypot(p.x - q.x, p.y - q.y) < GAP) clashes.push({ key: `gap ${other.key} ${hut.key}`, said: 'That is too close to another hut.' });
    }
  });
  const pathKey = (path: Expanded['paths'][number]) => `${huts[path.a].key}-${huts[path.b].key}`;
  paths.forEach((path, k) => {
    const [p, q] = [at(huts[path.a].at), at(huts[path.b].at)];
    huts.forEach((hut, j) => {
      if (j !== path.a && j !== path.b && nearOf(at(hut.at), p, q) < CLEAR * CLEAR) clashes.push({ key: `over ${pathKey(path)} ${hut.key}`, said: 'A path cannot run over a hut.' });
    });
    for (const other of paths.slice(0, k)) {
      if (crosses(p, q, at(huts[other.a].at), at(huts[other.b].at))) clashes.push({ key: `cross ${pathKey(other)} ${pathKey(path)}`, said: 'Two paths cannot cross.' });
    }
    if (path.kind === 'ford' && !overRiver(huts[path.a].at, huts[path.b].at, rivers)) clashes.push({ key: `ford ${pathKey(path)}`, said: 'A ford has to cross a river.' });
  });
  for (const river of rivers) {
    for (const hut of huts) {
      if (nearOf(at(hut.at), at(river.a), at(river.b)) < CLEAR * CLEAR) clashes.push({ key: `wet ${spotCode(river.a)}${spotCode(river.b)} ${hut.key}`, said: 'A river cannot run through a hut.' });
    }
  }
  return clashes;
}

/** A drawing, or why the change asked of it was refused. */
export type PlanEdit = { plan: Plan } | { refusal: string };

/**
 * The drawing after an edit, unless the edit made it too long, too full or
 * newly wrong somewhere. What was wrong before stays allowed, so a hut left
 * too near a home when another side sits down does not stop every other edit.
 */
function checked(before: Plan, after: Plan, count: number): PlanEdit {
  if (encodePlan(after).length > PLAN_MOST_CHARS) return { refusal: 'The drawing is full.' };
  const was = expand(before, count);
  const all = expand(after, count);
  if (all.huts.length > PLAN_MOST_HUTS && all.huts.length > was.huts.length) return { refusal: `A map holds ${PLAN_MOST_HUTS} huts, copies for each side and homes counted.` };
  const old = new Set(clashesOf(was).map((clash) => clash.key));
  const clash = clashesOf(all).find((each) => !old.has(each.key));
  return clash ? { refusal: clash.said } : { plan: after };
}

/** Whether a drawn hut and each of its copies stand as huts of their own, not on a spot another hut has. */
function standsAlone(all: Expanded, id: string): boolean {
  return all.turns.every((move) => {
    const k = all.node.get(id + move);
    return k !== undefined && all.huts[k].id === id;
  });
}

/**
 * Where a hut put down at `p` goes. Copying, one so near a line of the copy
 * that it would stand on its own copy goes on the line, where it stands once;
 * one put down by the very middle goes in it, where hill and egg are played.
 */
function settle(plan: Plan, count: number, p: Pt): Pt {
  let spot = onBoard(p);
  for (const move of turnsOf(plan, count).slice(1)) {
    const [u, v] = [at(spot), at(turnOf(spot, move))];
    if (Math.hypot(u.x - v.x, u.y - v.y) < GAP) spot = { x: move & 1 ? MID : spot.x, y: move & 2 ? MID : spot.y };
  }
  const [u, v] = [at(spot), at(MIDDLE)];
  return Math.hypot(u.x - v.x, u.y - v.y) < 30 ? MIDDLE : spot;
}

const TOO_CLOSE = { refusal: 'That is too close to another hut.' };

/** Puts a new piece down at a spot, and its copies. */
export function placePiece(plan: Plan, count: number, piece: PlanPiece, p: Pt): PlanEdit {
  const id = [...HUT_IDS].find((each) => !plan.items.some((item) => item.is === 'piece' && item.id === each));
  if (!id) return { refusal: 'The drawing is full.' };
  const after = { ...plan, items: [...plan.items, { is: 'piece' as const, id, piece, at: settle(plan, count, p) }] };
  if (!standsAlone(expand(after, count), id)) return TOO_CLOSE;
  return checked(plan, after, count);
}

/** Changes what a hut is, and its copies with it. A side's home stays a home. */
export function setPiece(plan: Plan, count: number, id: string, piece: PlanPiece): PlanEdit {
  if (isHomeId(id)) return { refusal: 'A side’s home stays its home.' };
  const items = plan.items.map((item) => (item.is === 'piece' && item.id === id ? { ...item, piece } : item));
  return checked(plan, { ...plan, items }, count);
}

/** Which hut was pressed: its id, and which copy of it. */
export interface HutRef {
  id: string;
  copy: number;
}

/**
 * Moves a hut, by whichever copy was taken, with its copies and its paths.
 * A path that would cross something where the hut now stands is left behind;
 * a hut too close to another refuses the move. Copying, a home moves every
 * home with it, but for the third of three, who stays in the middle.
 */
export function movePiece(plan: Plan, count: number, hut: HutRef, to: Pt): PlanEdit {
  const home = isHomeId(hut.id);
  if (home && plan.mirror && count === 3 && hut.id === '2') return { refusal: 'While the map is copied, the middle side starts in the middle.' };
  let moved: PlanItem[];
  if (home) {
    const seat = plan.mirror ? 0 : Number(hut.id);
    const spot = onBoard(plan.mirror ? turnOf(to, HOME_TURN[Number(hut.id)]) : to);
    moved = [...plan.items.filter((item) => item.is !== 'home' || item.seat !== seat), { is: 'home', seat, at: spot }];
  } else {
    const was = plan.items.find((item) => item.is === 'piece' && item.id === hut.id);
    if (!was) return { refusal: 'That hut has gone.' };
    const spot = settle(plan, count, turnOf(to, hut.copy));
    moved = plan.items.map((item) => (item === was ? { ...was, at: spot } : item));
  }
  const after = { ...plan, items: moved };
  if (encodePlan(after) === encodePlan(plan)) return { plan };
  const touches = (item: PlanItem) => item.is === 'path' && [item.a, item.b].some((end) => end === hut.id || (home && plan.mirror && isHomeId(end)));
  const bare = { ...plan, items: moved.filter((item) => !touches(item)) };
  const all = expand(bare, count);
  const alone = home ? homesOf(bare, count).every((spot, k) => all.huts[all.node.get(HOME_IDS[k] + 0)!].id === HOME_IDS[k] && !all.huts.some((other) => other.id !== HOME_IDS[k] && same(other.at, spot))) : standsAlone(all, hut.id);
  if (!alone) return TOO_CLOSE;
  const settled = checked(plan, bare, count);
  if ('refusal' in settled) return settled;
  let kept = settled.plan;
  for (const item of moved) {
    if (!touches(item)) continue;
    const tried = checked(plan, { ...kept, items: [...kept.items, item] }, count);
    if ('plan' in tried) kept = tried.plan;
  }
  return { plan: kept };
}

/** Takes away a hut, its copies and every path to them. */
export function removePiece(plan: Plan, count: number, id: string): PlanEdit {
  if (isHomeId(id)) return { refusal: 'A side always starts on its home.' };
  const items = plan.items.filter((item) => !(item.is === 'piece' && item.id === id) && !(item.is === 'path' && (item.a === id || item.b === id)));
  return checked(plan, { ...plan, items }, count);
}

/** The pairs of huts each drawn path of a drawing joins, so a path drawn over one already there takes its place. */
const sameLine = (all: Expanded, one: Extract<PlanItem, { is: 'path' }>, other: Extract<PlanItem, { is: 'path' }>) =>
  pairsOf(one, all.node, all.turns).some(([p, q]) => pairsOf(other, all.node, all.turns).some(([u, v]) => p === u && q === v));

/** Draws a path between two huts, and its copies, or changes the kind of one already there. */
export function drawPath(plan: Plan, count: number, kind: PlanPath, from: HutRef, to: HutRef): PlanEdit {
  const all = expand(plan, count);
  const [a, b] = [all.node.get(from.id + from.copy), all.node.get(to.id + to.copy)];
  if (a === undefined || b === undefined || a === b) return { refusal: 'A path joins two huts.' };
  const [first, second] = from.id <= to.id ? [from.id, to.id] : [to.id, from.id];
  const path = { is: 'path' as const, kind, a: first, b: second, turn: from.copy ^ to.copy };
  const items = plan.items.filter((item) => item.is !== 'path' || !sameLine(all, item, path));
  return checked(plan, { ...plan, items: [...items, path] }, count);
}

/** Draws a stretch of river between two spots, and its copies. */
export function drawRiver(plan: Plan, count: number, from: Pt, to: Pt): PlanEdit {
  const [a, b] = [onBoard(from), onBoard(to)];
  const [u, v] = [at(a), at(b)];
  if (Math.hypot(u.x - v.x, u.y - v.y) < GAP / 2) return { refusal: 'Draw a river longer than that.' };
  return checked(plan, { ...plan, items: [...plan.items, { is: 'river', a, b }] }, count);
}

/** The hut at a spot of the board, within reach of a press, or null. */
export function hutAt(all: Expanded, p: Pt): PlanHut | null {
  const point = at(p);
  let best: PlanHut | null = null;
  let least = HUT_REACH;
  for (const hut of all.huts) {
    const q = at(hut.at);
    const d = Math.hypot(point.x - q.x, point.y - q.y);
    if (d < least) {
      least = d;
      best = hut;
    }
  }
  return best;
}

/** Takes away what is at a spot: a hut and its paths, or else the nearest path or river within reach. Null when nothing is near enough. */
export function eraseAt(plan: Plan, count: number, p: Pt): PlanEdit | null {
  const all = expand(plan, count);
  const hut = hutAt(all, p);
  if (hut) return removePiece(plan, count, hut.id);
  const point = at(p);
  let best = -1;
  let least = LINE_REACH * LINE_REACH;
  const lines = [
    ...all.paths.map((path) => ({ from: path.from, a: all.huts[path.a].at, b: all.huts[path.b].at })),
    ...all.rivers,
  ];
  for (const line of lines) {
    const near = nearOf(point, at(line.a), at(line.b));
    if (near < least) {
      least = near;
      best = line.from;
    }
  }
  if (best < 0) return null;
  return checked(plan, { ...plan, items: plan.items.filter((_, k) => k !== best) }, count);
}

/**
 * Turns copying on or off. Off, every copy stays where it is as a hut of its
 * own, so the map looks the same and each copy can be moved by itself; on,
 * what is drawn is copied, refused where a copy would stand on something.
 */
export function setMirror(plan: Plan, count: number, on: boolean): PlanEdit {
  if (plan.mirror === on) return { plan };
  if (on) {
    const tried = checked(plan, { ...plan, mirror: true }, count);
    return 'refusal' in tried ? { refusal: `Copied for every side, some of it would land on something. ${tried.refusal}` } : tried;
  }
  const all = expand(plan, count);
  const free = [...HUT_IDS].filter((id) => !plan.items.some((item) => item.is === 'piece' && item.id === id));
  // Each hut keeps its id if it is drawn, and a copy takes the next one free; homes keep theirs.
  const idOf = all.huts.map((hut) => (isHomeId(hut.id) ? HOME_IDS[SEATS.indexOf(hut.piece as Seat)] : hut.copy === 0 ? hut.id : free.shift()!));
  const items: PlanItem[] = [
    ...homesOf(plan, count).map((spot, seat): PlanItem => ({ is: 'home', seat, at: spot })),
    ...all.huts.flatMap((hut, k): PlanItem[] => (isHomeId(hut.id) ? [] : [{ is: 'piece', id: idOf[k], piece: hut.piece as PlanPiece, at: hut.at }])),
    ...all.paths.map((path): PlanItem => {
      const [a, b] = [idOf[path.a], idOf[path.b]].sort();
      return { is: 'path', kind: path.kind, a, b, turn: 0 };
    }),
    ...all.rivers.map((river): PlanItem => ({ is: 'river', a: river.a, b: river.b })),
  ];
  return { plan: { mirror: false, items } };
}

/** What one edit put down and took away, item by item, so it can be taken back without touching anyone else's. */
export interface PlanChange {
  added: PlanItem[];
  removed: PlanItem[];
  /** Copying as it was before the edit, when the edit turned it on or off. */
  mirror: boolean | null;
}

/** The items less one of each of `others`, matched by how they are stored. */
function without(items: readonly PlanItem[], others: readonly PlanItem[]): PlanItem[] {
  const left = others.map(itemCode);
  return items.filter((item) => {
    const k = left.indexOf(itemCode(item));
    if (k >= 0) left.splice(k, 1);
    return k < 0;
  });
}

export function changeOf(before: Plan, after: Plan): PlanChange {
  return { added: without(after.items, before.items), removed: without(before.items, after.items), mirror: before.mirror === after.mirror ? null : before.mirror };
}

/** The place in a drawing an item holds, which only one can at a time: a hut's id, a home's seat, a path's two ends. */
function slotOf(item: PlanItem): string {
  if (item.is === 'piece') return `piece ${item.id}`;
  if (item.is === 'home') return `home ${item.seat}`;
  if (item.is === 'path') return `path ${item.a} ${item.b} ${item.turn}`;
  return itemCode(item);
}

/**
 * Takes one edit back from the drawing as it stands now, which others in the
 * room may have drawn on since: what the edit put down goes if it is still
 * there, and what it took away comes back where nothing has taken its place.
 * A path that comes back with a hut gone from an end stays away.
 */
export function undoChange(plan: Plan, count: number, change: PlanChange): PlanEdit {
  const kept = without(plan.items, change.added);
  const taken = new Set(kept.map(slotOf));
  const back = change.removed.filter((item) => !taken.has(slotOf(item)) && taken.add(slotOf(item)));
  const ids = new Set([...HOME_IDS, ...[...kept, ...back].flatMap((item) => (item.is === 'piece' ? [item.id] : []))]);
  const items = [...kept, ...back.filter((item) => item.is !== 'path' || (ids.has(item.a) && ids.has(item.b)))];
  const next = { mirror: change.mirror ?? plan.mirror, items };
  if (encodePlan(next) === encodePlan(plan)) return { refusal: 'Someone else has changed that since.' };
  return checked(plan, next, count);
}

const HUT: Site = { x: 0, y: 0, owner: null, n: 10, level: 1 };

/** The site a piece stands as, before it is put where it goes. Guns and buildings stand on a plain hut. */
export function siteOf(piece: PlanPiece | Seat): Site {
  if (isSeat(piece)) return { ...HUT, owner: piece, n: START_UNITS };
  if (piece === 'big') return { ...HUT, n: 20, level: 2 };
  if (piece === 'fort') return { ...HUT, n: 15, level: 2, fort: true };
  return withPiece(HUT, piece);
}

const isSeat = (piece: PlanPiece | Seat): piece is Seat => (SEATS as readonly string[]).includes(piece);

/** The huts, paths and rivers a drawing lays for `count` sides on a ground. Sites go in board order, row by row. */
export function layoutOf(plan: Plan, count: number, size: SizeId): Drawn {
  const all = expand(plan, count);
  const order = all.huts.map((_, k) => k).sort((p, q) => all.huts[p].at.y - all.huts[q].at.y || all.huts[p].at.x - all.huts[q].at.x);
  const index = new Map(order.map((k, place) => [k, place]));
  const sites = order.map((k): Site => ({ ...siteOf(all.huts[k].piece), ...worldOf(all.huts[k].at, size) }));
  const paths = all.paths
    .map(({ a, b, kind }): Path => {
      const [i, j] = [index.get(a)!, index.get(b)!].sort((p, q) => p - q);
      const wet = overRiver(all.huts[a].at, all.huts[b].at, all.rivers);
      const built: PathKind = wet && kind !== 'tunnel' && kind !== 'ford' ? 'bridge' : kind;
      return { a: i, b: j, kind: built };
    })
    .sort((p, q) => p.a - q.a || p.b - q.b);
  const rivers = all.rivers.map((river) => [worldOf(river.a, size), worldOf(river.b, size)]);
  return { sites, paths, rivers };
}

/** The map a drawing plays as. Throws, with the reason, when it cannot be played by these sides and rules. */
export function buildDrawn(seed: number, plan: string, sides: readonly Seat[], size: SizeId | undefined, rules: Rules = CLASSIC): SwarmMap {
  const ground = sizeOf('drawn', sides.length, size);
  return buildMap(seed, 'drawn', sides, ground, rules, layoutOf(parsePlan(plan), sides.length, ground));
}

/** The huts no path leads to from the first side's home, other homes among them: what is left to join up. */
export function cutOffOf(plan: Plan, count: number): PlanHut[] {
  const all = expand(plan, count);
  const next = all.huts.map((): number[] => []);
  for (const { a, b } of all.paths) {
    next[a].push(b);
    next[b].push(a);
  }
  const reached = new Set([all.node.get('00')!]);
  for (const k of reached) for (const to of next[k]) reached.add(to);
  return all.huts.filter((_, k) => !reached.has(k));
}

/**
 * Why a drawing cannot be played by these sides and rules, in words for the
 * lobby, or null when it can. The common reasons are named here; anything
 * else the map's own building refuses is passed on as it says it.
 */
export function problemOf(text: string, sides: readonly Seat[], size: SizeId | undefined, rules: Rules): string | null {
  const plan = parsePlan(text);
  const count = sides.length;
  const all = expand(plan, count);
  if (all.huts.length > PLAN_MOST_HUTS) return `There are ${all.huts.length} huts with the homes and copies for ${count} sides, and a map holds ${PLAN_MOST_HUTS}.`;
  const clash = clashesOf(all)[0];
  if (clash) return clash.said.startsWith('That') ? 'Two huts are too close together.' : clash.said;
  if (count !== 3 && (rules.mode === 'hill' || rules.mode === 'egg') && !all.huts.some((hut) => same(hut.at, MIDDLE)))
    return `${rules.mode === 'hill' ? 'Hill' : 'Egg'} needs a hut in the very middle of the map.`;
  const cut = cutOffOf(plan, count);
  if (cut.some((hut) => isSeat(hut.piece))) return 'There is no way between the homes yet.';
  if (cut.length > 0) return cut.length === 1 ? '1 hut has no path to the rest.' : `${cut.length} huts have no path to the rest.`;
  try {
    buildDrawn(0, text, sides, size, rules);
  } catch (err) {
    const said = (err as Error).message;
    return SAID.find(([start]) => said.startsWith(start))?.[1] ?? said;
  }
  return null;
}

/** The start's refusals the lobby can put better for a drawing, by how the map's building words them. */
const SAID: [string, string][] = [
  ['No pair of huts by the middle', 'The middle side needs two plain huts joined to its home, each the mirror of the other through it. Copying for every side lays them.'],
  ['No hut to give the first seat', 'Each side needs a plain hut to start with besides its home.'],
  ['No close start', 'The close start needs a hut two paths from the other side. Draw a longer way between the homes.'],
];

/**
 * The drawing as the editor shows it: its huts, paths and rivers with each
 * side on its home, before any start or mode moves them. Unlike buildDrawn it
 * never refuses, so a drawing half made can still be shown.
 */
export function sketchOf(plan: Plan, sides: readonly Seat[], size: SizeId | undefined): SwarmMap {
  const ground = sizeOf('drawn', sides.length, size);
  const layout = layoutOf(plan, sides.length, ground);
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

/** What a player's pointer over the board carries, if anything: a piece, a path or a river on its way down. */
export type Carry = PlanPiece | PlanPath | 'river';
const CARRIES: readonly Carry[] = [...PLAN_PIECES, ...PLAN_PATHS, 'river'];
/** The furthest a pointer is told to be off the board, either way. */
const POINTER_OUT = 10;

/** Where a player is pointing on the board, as the room stores it: the spot, moved on so it is never below 0, then what is carried. The database rules hold it to the same shape. */
export function encodePointer(p: Pt, carry: Carry | null): string {
  const shown = (v: number) => Math.round(Math.min(PLAN_SPAN + POINTER_OUT, Math.max(-POINTER_OUT, v)) + POINTER_OUT);
  const spot = `${shown(p.x)} ${shown(p.y)}`;
  return carry ? `${spot} ${carry}` : spot;
}

/** A pointer read back, or null for one in a shape this client does not know. */
export function parsePointer(text: string): { at: Pt; carry: Carry | null } | null {
  const [x, y, carry] = text.split(' ');
  const known = carry === undefined ? null : CARRIES.find((each) => each === carry);
  if (!/^\d{1,3}$/.test(x ?? '') || !/^\d{1,3}$/.test(y ?? '') || known === undefined) return null;
  return { at: { x: Number(x) - POINTER_OUT, y: Number(y) - POINTER_OUT }, carry: known };
}

/** A drawing to start from, laid by these steps, for when the board is empty. */
type Step = ['hut', string, PlanPiece, number, number] | ['path', string, string, number, PlanPath?] | ['river', number, number, number, number];

function laid(steps: readonly Step[]): string {
  const items = steps.map((step): PlanItem => {
    if (step[0] === 'hut') return { is: 'piece', id: step[1], piece: step[2], at: { x: step[3], y: step[4] } };
    if (step[0] === 'path') return { is: 'path', kind: step[4] ?? 'road', a: step[1], b: step[2], turn: step[3] };
    return { is: 'river', a: { x: step[1], y: step[2] }, b: { x: step[3], y: step[4] } };
  });
  return encodePlan({ mirror: true, items });
}

/**
 * Drawings to start from rather than an empty board, each drawn for the
 * count of sides it is picked with and copied for every side. They are
 * checked to play under every mode and start.
 */
export const PLAN_LAYOUTS: readonly { name: string; plan: (count: number) => string }[] = [
  {
    name: 'Diamond',
    plan: (count) =>
      count === 4
        ? laid([['hut', 'a', 'hut', 22, 26], ['hut', 'b', 'hut', 49, 18], ['hut', 'c', 'hut', 18, 49], ['hut', 'z', 'big', 49, 49], ['path', '0', 'a', 0], ['path', 'a', 'b', 0], ['path', 'a', 'c', 0], ['path', 'b', 'z', 0], ['path', 'c', 'z', 0]])
        : laid([['hut', 'a', 'hut', 18, 22], ['hut', 'b', 'hut', 18, 76], ['hut', 'g', 'hut', 32, 49], ['hut', 'e', 'hut', 49, 12], ['hut', 'z', 'big', 49, 49], ['path', '0', 'a', 0], ['path', '0', 'b', 0], ['path', 'a', 'g', 0], ['path', 'b', 'g', 0], ['path', 'a', 'e', 0], ['path', 'b', 'e', 3], ['path', 'g', 'z', 0]]),
  },
  {
    name: 'Two rivers',
    plan: (count) =>
      count === 4
        ? laid([['river', 32, 0, 32, 98], ['hut', 'a', 'hut', 14, 30], ['hut', 'b', 'hut', 49, 16], ['hut', 'c', 'hut', 49, 32], ['hut', 'z', 'big', 49, 49], ['path', '0', 'a', 0], ['path', '0', 'b', 0], ['path', 'a', 'c', 0, 'ford'], ['path', 'b', 'c', 0], ['path', 'c', 'z', 0], ['path', 'a', 'a', 2]])
        : laid([['river', 30, 0, 30, 98], ['hut', 'a', 'hut', 12, 22], ['hut', 'b', 'hut', 12, 76], ['hut', 'c', 'hut', 49, 18], ['hut', 'g', 'hut', 37, 49], ['hut', 'z', 'big', 49, 49], ['path', '0', 'a', 0], ['path', '0', 'b', 0], ['path', 'a', 'c', 0], ['path', 'b', 'c', 3], ['path', '0', 'g', 0, 'ford'], ['path', 'g', 'c', 0], ['path', 'g', 'c', 3], ['path', 'g', 'z', 0]]),
  },
  {
    name: 'Towers',
    plan: (count) =>
      count === 4
        ? laid([['hut', 'a', 'hut', 20, 24], ['hut', 'b', 'cannon', 49, 16], ['hut', 'c', 'fort', 16, 49], ['hut', 'd', 'mortar', 34, 40], ['hut', 'z', 'big', 49, 49], ['path', '0', 'a', 0], ['path', 'a', 'b', 0, 'narrow'], ['path', 'a', 'c', 0, 'wide'], ['path', 'a', 'd', 0], ['path', 'd', 'z', 0, 'spikes'], ['path', 'b', 'z', 0], ['path', 'c', 'z', 0]])
        : laid([['hut', 'a', 'hut', 16, 22], ['hut', 'b', 'hut', 16, 76], ['hut', 'g', 'fort', 30, 49], ['hut', 't', 'cannon', 40, 20], ['hut', 'e', 'hut', 49, 8], ['hut', 'z', 'big', 49, 49], ['path', '0', 'a', 0], ['path', '0', 'b', 0], ['path', 'a', 'g', 0, 'wide'], ['path', 'b', 'g', 0, 'wide'], ['path', 'a', 't', 0, 'narrow'], ['path', 't', 'e', 0], ['path', 'b', 'e', 3], ['path', 'g', 'z', 0, 'spikes'], ['path', 't', 'z', 0]]),
  },
];
