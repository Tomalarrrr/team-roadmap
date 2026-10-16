/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The swarm rules run here against a small stand-in for the database's own
// evaluator, because the fake proxy the API tests use does not read them and
// a rule that refuses too much fails silently in production. What it models:
// `.write` grants cascade down the path; `.validate` runs on the node written,
// everything under it and every node above it, and not on a node being
// deleted; `root` and `data` are the room before the write and `newData`
// after it. A rule that throws (a method called on a missing value) refuses,
// as it does on the server.

type RuleNode = { [key: string]: RuleNode | string | boolean };
type Tree = { [key: string]: unknown };

const RULES = (JSON.parse(readFileSync(resolve(process.cwd(), 'database.rules.json'), 'utf-8')) as { rules: RuleNode }).rules;

class Snap {
  private readonly tree: unknown;
  private readonly path: string[];
  constructor(tree: unknown, path: string[]) {
    this.tree = tree;
    this.path = path;
  }
  private at(): unknown {
    let value = this.tree;
    for (const key of this.path) {
      if (value === null || typeof value !== 'object') return null;
      value = (value as Tree)[key] ?? null;
    }
    return value ?? null;
  }
  val(): unknown {
    return this.at();
  }
  exists(): boolean {
    return this.at() !== null;
  }
  child(path: string): Snap {
    return new Snap(this.tree, [...this.path, ...path.split('/')]);
  }
  parent(): Snap {
    return new Snap(this.tree, this.path.slice(0, -1));
  }
  hasChild(path: string): boolean {
    return this.child(path).exists();
  }
  hasChildren(keys?: string[]): boolean {
    const value = this.at();
    if (value === null || typeof value !== 'object') return false;
    return keys ? keys.every((key) => this.hasChild(key)) : true;
  }
  isNumber(): boolean {
    return typeof this.at() === 'number';
  }
  isString(): boolean {
    return typeof this.at() === 'string';
  }
  isBoolean(): boolean {
    return typeof this.at() === 'boolean';
  }
}

type Vars = { $code?: string; $seat?: string };

function holds(rule: string | boolean, before: unknown, after: unknown, path: string[], vars: Vars, now: number): boolean {
  if (typeof rule === 'boolean') return rule;
  const js = rule
    .replace(/\.matches\(/g, '.match(')
    .replace(/\.contains\(/g, '.includes(')
    .replace(/\.beginsWith\(/g, '.startsWith(')
    .replace(/([!=])=/g, '$1==');
  const run = new Function('root', 'data', 'newData', 'now', '$code', '$seat', `return !!(${js});`);
  try {
    return run(new Snap(before, []), new Snap(before, path), new Snap(after, path), now, vars.$code, vars.$seat) as boolean;
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }
}

function descend(node: RuleNode, key: string, vars: Vars): [RuleNode, Vars] | null {
  const named = node[key];
  if (typeof named === 'object') return [named, vars];
  const wild = Object.keys(node).find((each) => each.startsWith('$'));
  if (!wild) return null;
  return [node[wild] as RuleNode, { ...vars, [wild]: key }];
}

function put(tree: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const copy: Tree = tree !== null && typeof tree === 'object' ? { ...(tree as Tree) } : {};
  const next = put(copy[path[0]] ?? null, path.slice(1), value);
  if (next === null || (typeof next === 'object' && Object.keys(next as Tree).length === 0)) delete copy[path[0]];
  else copy[path[0]] = next;
  return Object.keys(copy).length === 0 ? null : copy;
}

/** Whether the rules let `value` be set at `at` (slash-separated) on the database `before`. */
function allowed(before: unknown, at: string, value: unknown, now = NOW): boolean {
  const path = at.split('/');
  const after = put(before, path, value);
  const valid = (node: RuleNode, here: string[], vars: Vars): boolean =>
    new Snap(after, here).val() === null || node['.validate'] === undefined || holds(node['.validate'] as string | boolean, before, after, here, vars, now);

  let node: RuleNode | null = RULES;
  let vars: Vars = {};
  let granted = false;
  for (let i = 0; node; i++) {
    const here = path.slice(0, i);
    if (node['.write'] !== undefined && holds(node['.write'] as string | boolean, before, after, here, vars, now)) granted = true;
    if (i > 0 && i < path.length && !valid(node, here, vars)) return false;
    if (i === path.length) break;
    const down: [RuleNode, Vars] | null = descend(node, path[i], vars);
    if (!down) {
      node = null;
      break;
    }
    [node, vars] = down;
  }
  if (!granted) return false;
  if (!node) return true;

  const subtree = (rules: RuleNode, here: string[], vars: Vars): boolean => {
    if (!valid(rules, here, vars)) return false;
    const value = new Snap(after, here).val();
    if (value === null || typeof value !== 'object') return true;
    return Object.keys(value as Tree).every((key) => {
      const down = descend(rules, key, vars);
      return !down || subtree(down[0], [...here, key], down[1]);
    });
  };
  return subtree(node, path, vars);
}

const NOW = 1_800_000_000_000;
const CODE = 'ROOM';
const M = `swarm/${CODE}/m`;

const person = (sessionId: string, name: string, extra: object = {}) => ({ sessionId, name, ...extra });

function waitingRoom(extra: Tree = {}): Tree {
  return {
    status: 'waiting',
    createdAt: NOW - 600_000,
    seed: 7,
    game: 1,
    startAt: NOW - 300_000,
    players: { a: person('sa', 'Ann') },
    ...extra,
  };
}

/** A game of three people and the computer in seat d, with seats a and c having written this game. */
function playingRoom(extra: Tree = {}): Tree {
  return {
    status: 'playing',
    createdAt: NOW - 600_000,
    seed: 7,
    game: 2,
    startAt: NOW - 20_000,
    map: 'crossroads',
    size: 'large',
    cpu: 'd',
    players: { a: person('sa', 'Ann'), b: person('sb', 'Bo'), c: person('sc', 'Cy') },
    ...extra,
  };
}

const seatState = (game: number, k: number, extra: Tree = {}) => ({ seq: 3, at: NOW - 100, game, k, orders: '', ...extra });

function db(m: Tree, s: Tree = { a: seatState(2, 120), c: seatState(2, 90) }): Tree {
  return { swarm: { [CODE]: { m, s } } };
}

describe('the swarm rules: who sits where', () => {
  it('seats four people, each with one of the four creatures', () => {
    const players = { a: person('sa', 'Ann'), b: person('sb', 'Bo', { kind: 'bee' }), c: person('sc', 'Cy'), d: person('sd', 'Di', { kind: 'spider' }) };
    expect(allowed(db(waitingRoom()), M, waitingRoom({ players }))).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/players/d/kind`, 'beetle')).toBe(false);
    expect(allowed(db(waitingRoom({ players })), `${M}/players/d/kind`, 'beetle')).toBe(true);
  });

  it('refuses a creature that is not one of the four, and a fifth seat', () => {
    expect(allowed(db(waitingRoom()), `${M}/players/a/kind`, 'dragon')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/players/a/kind`, 'ant')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/players/e`, person('se', 'Ed'))).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/players/a/colour`, 'red')).toBe(false);
  });

  it('refuses a person in a seat the computer plays', () => {
    const two = { a: person('sa', 'Ann'), b: person('sb', 'Bo') };
    expect(allowed(db(waitingRoom()), M, waitingRoom({ players: two, cpu: 'b' }))).toBe(false);
    expect(allowed(db(waitingRoom()), M, waitingRoom({ players: two, cpu: 'c' }))).toBe(true);
    // With no computer at all the seat check reads a missing value and has to cope with it.
    expect(allowed(db(waitingRoom()), M, waitingRoom({ players: two }))).toBe(true);
  });

  it('holds the computer seats to letters in seat order', () => {
    expect(allowed(db(waitingRoom()), `${M}/cpu`, 'bd')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/cpu`, 'bcd')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/cpu`, 'db')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/cpu`, 'bb')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/cpu`, 'e')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/cpu`, 2)).toBe(false);
  });

  it('takes one of three sizes and no third flag', () => {
    expect(allowed(db(waitingRoom()), `${M}/size`, 'large')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/size`, 'huge')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/third`, true)).toBe(false);
  });

  it('takes one of the eight modes and five starts', () => {
    for (const mode of ['classic', 'blitz', 'hill', 'regicide', 'bounty', 'egg', 'teams', 'survival']) expect(allowed(db(waitingRoom()), `${M}/mode`, mode)).toBe(true);
    for (const start of ['home', 'close', 'scattered', 'draft', 'nests']) expect(allowed(db(waitingRoom()), `${M}/start`, start)).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/mode`, 'warren')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/mode`, 1)).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/start`, 'middle')).toBe(false);
  });

  it('holds the twists to one letter each in their order', () => {
    expect(allowed(db(waitingRoom()), `${M}/twists`, 'fopgzcbq')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/twists`, 'fq')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/twists`, 'qf')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/twists`, 'ff')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/twists`, 'x')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/twists`, true)).toBe(false);
  });

  it('takes the rules chosen in the lobby as a whole match, and their clearing back to classic', () => {
    const chosen = waitingRoom({ mode: 'survival', start: 'scattered', twists: 'gzc', cpu: 'b' });
    expect(allowed(db(waitingRoom()), M, chosen)).toBe(true);
    expect(allowed(db(chosen), M, waitingRoom({ cpu: 'b' }))).toBe(true);
    expect(allowed(db(waitingRoom()), M, waitingRoom({ mode: 'chess' }))).toBe(false);
  });

  it('takes the host\'s numbers as knob=value pairs, and nothing shaped otherwise', () => {
    expect(allowed(db(waitingRoom()), `${M}/tune`, 'len=15')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/tune`, 'len=15;grow=150;reload=12')).toBe(true);
    expect(allowed(db(waitingRoom()), M, waitingRoom({ tune: 'cap=200' }))).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/tune`, '')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/tune`, 'len=15;')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/tune`, 'len=-5')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/tune`, 'len=12345')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/tune`, 'LEN=15')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/tune`, 'len=1.5')).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/tune`, 15)).toBe(false);
    expect(allowed(db(waitingRoom()), `${M}/tune`, Array.from({ length: 20 }, () => 'speed=100').join(';'))).toBe(false);
  });

  it('takes a nest of big or many on a player', () => {
    expect(allowed(db(waitingRoom()), `${M}/players/a/nest`, 'many')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/players/a/nest`, 'big')).toBe(true);
    expect(allowed(db(waitingRoom()), `${M}/players/a/nest`, 'huge')).toBe(false);
  });
});

describe('the swarm rules: starting and playing', () => {
  const start = (extra: Tree) => waitingRoom({ status: 'playing', game: 2, startAt: NOW + 4000, ...extra });

  it('starts a game only with two sides, people or the computer', () => {
    expect(allowed(db(waitingRoom()), M, start({}))).toBe(false);
    expect(allowed(db(waitingRoom()), M, start({ players: { d: person('sd', 'Di') } }))).toBe(false);
    expect(allowed(db(waitingRoom()), M, start({ cpu: 'c' }))).toBe(true);
    expect(allowed(db(waitingRoom()), M, start({ players: { a: person('sa', 'Ann'), d: person('sd', 'Di') } }))).toBe(true);
  });

  it('starts a game with nobody marked out, even one carried from the last', () => {
    const finished = playingRoom({ status: 'finished', winner: 'a', out: { c: 90 } });
    const rematch = { ...playingRoom({ game: 3, startAt: NOW + 4000 }) };
    expect(allowed(db(finished), M, rematch)).toBe(true);
    expect(allowed(db(finished), M, { ...rematch, out: { c: 90 } })).toBe(false);
  });

  it('fixes the computer, the size, the map and who sits where for the length of a game', () => {
    const before = db(playingRoom());
    expect(allowed(before, M, playingRoom())).toBe(true);
    expect(allowed(before, M, playingRoom({ cpu: '' }))).toBe(false);
    expect(allowed(before, M, playingRoom({ cpu: 'cd' }))).toBe(false);
    expect(allowed(before, M, playingRoom({ size: 'small' }))).toBe(false);
    expect(allowed(before, M, playingRoom({ map: 'open' }))).toBe(false);
    const swapped = { a: person('sa', 'Ann'), b: person('sb', 'Bo'), c: person('sx', 'Cy') };
    expect(allowed(before, M, playingRoom({ players: swapped }))).toBe(false);
  });

  it('fixes the mode, the start, the twists and every nest for the length of a game', () => {
    const chosen = { mode: 'blitz', start: 'nests', twists: 'fo', tune: 'len=20', players: { a: person('sa', 'Ann', { nest: 'many' }), b: person('sb', 'Bo'), c: person('sc', 'Cy') } };
    const before = db(playingRoom(chosen));
    expect(allowed(before, M, playingRoom(chosen))).toBe(true);
    expect(allowed(before, M, playingRoom({ ...chosen, status: 'finished', winner: 'a' }))).toBe(true);
    expect(allowed(before, M, playingRoom({ ...chosen, mode: 'hill' }))).toBe(false);
    expect(allowed(before, M, playingRoom({ ...chosen, start: 'home' }))).toBe(false);
    expect(allowed(before, M, playingRoom({ ...chosen, twists: 'f' }))).toBe(false);
    expect(allowed(before, M, playingRoom({ ...chosen, tune: 'len=2' }))).toBe(false);
    expect(allowed(before, `${M}/twists`, 'fop')).toBe(false);
    expect(allowed(before, `${M}/players/a/nest`, 'big')).toBe(false);
    expect(allowed(before, `${M}/players/b/nest`, 'many')).toBe(false);
    expect(allowed(db(playingRoom()), `${M}/mode`, 'blitz')).toBe(false);
    // Between games they are anyone's to change.
    const finished = db(playingRoom({ ...chosen, status: 'finished', winner: 'a' }));
    expect(allowed(finished, `${M}/players/a/nest`, 'big')).toBe(true);
    expect(allowed(finished, M, playingRoom({ ...chosen, mode: 'hill', twists: 'q', tune: 'grow=50', game: 3, startAt: NOW + 4000 }))).toBe(true);
  });

  it('records any of four seats as the winner, and any as the one who left', () => {
    const before = db(playingRoom());
    expect(allowed(before, M, playingRoom({ status: 'finished', winner: 'd' }))).toBe(true);
    expect(allowed(before, M, playingRoom({ status: 'finished', winner: 'e' }))).toBe(false);
    expect(allowed(before, M, playingRoom({ status: 'finished', winner: 'a', gone: 'c' }))).toBe(true);
    expect(allowed(before, M, playingRoom({ status: 'finished', winner: 'c', gone: 'c' }))).toBe(false);
    expect(allowed(before, M, playingRoom({ status: 'finished', winner: 'draw', gone: 'c' }))).toBe(false);
  });
});

describe('the swarm rules: a seat that leaves a game of more than two', () => {
  it('marks it out no earlier than its own promise', () => {
    const before = db(playingRoom());
    expect(allowed(before, M, playingRoom({ out: { c: 90 } }))).toBe(true);
    expect(allowed(before, M, playingRoom({ out: { c: 300 } }))).toBe(true);
    expect(allowed(before, M, playingRoom({ out: { c: 89 } }))).toBe(false);
    expect(allowed(before, M, playingRoom({ out: { c: 90.5 } }))).toBe(false);
  });

  it('takes any tick for a seat whose promise is from an earlier game', () => {
    const before = db(playingRoom(), { a: seatState(2, 120), c: seatState(1, 900) });
    expect(allowed(before, M, playingRoom({ out: { c: 0 } }))).toBe(true);
  });

  it('marks it once', () => {
    const before = db(playingRoom({ out: { c: 90 } }));
    expect(allowed(before, M, playingRoom({ out: { c: 90 } }))).toBe(true);
    expect(allowed(before, M, playingRoom({ out: { c: 95 } }))).toBe(false);
    expect(allowed(before, M, playingRoom())).toBe(false);
  });

  it('marks only a seat a person sat in, and only during a game', () => {
    expect(allowed(db(playingRoom()), M, playingRoom({ out: { d: 0 } }))).toBe(false);
    expect(allowed(db(playingRoom({ status: 'finished', winner: 'a' })), M, playingRoom({ status: 'finished', winner: 'a', out: { c: 90 } }))).toBe(false);
    expect(allowed(db(waitingRoom()), M, waitingRoom({ out: { a: 0 } }))).toBe(false);
  });

  it('refuses the seat a promise past the tick it was marked out at', () => {
    const write = (k: number) => ({ seq: 4, at: NOW, game: 2, k, orders: '', base: 3 });
    const out = db(playingRoom({ out: { c: 90 } }));
    expect(allowed(out, `swarm/${CODE}/s/c`, write(91))).toBe(false);
    expect(allowed(out, `swarm/${CODE}/s/c`, write(90))).toBe(true);
    expect(allowed(db(playingRoom()), `swarm/${CODE}/s/c`, write(91))).toBe(true);
  });
});

describe('the swarm rules: what a seat writes', () => {
  const S = `swarm/${CODE}/s`;
  const before = db(playingRoom(), { a: seatState(2, 120, { orders: '1a:M01' }), c: seatState(2, 90) });
  const write = (extra: Tree) => ({ seq: 4, at: NOW, game: 2, k: 130, orders: '1a:M01,2b:M02', base: 3, ...extra });

  it('takes a write from seats c and d, and none past d', () => {
    expect(allowed(before, `${S}/d`, write({ orders: '', base: undefined }))).toBe(true);
    expect(allowed(before, `${S}/e`, write({ orders: '', base: undefined }))).toBe(false);
  });

  it('still holds a write to its promise, its orders, its base and the server time', () => {
    expect(allowed(before, `${S}/a`, write({}))).toBe(true);
    expect(allowed(before, `${S}/a`, write({ k: 119 }))).toBe(false);
    expect(allowed(before, `${S}/a`, write({ orders: '2b:M02' }))).toBe(false);
    expect(allowed(before, `${S}/a`, write({ base: 2 }))).toBe(false);
    expect(allowed(before, `${S}/a`, write({ at: NOW - 1 }))).toBe(false);
  });
});

describe('the swarm rules: closing a room', () => {
  const ROOM = `swarm/${CODE}`;

  it('closes a game once every person in it is out', () => {
    expect(allowed(db(playingRoom({ out: { a: 120, b: 0, c: 90 } })), ROOM, null)).toBe(true);
    expect(allowed(db(playingRoom({ out: { a: 120, c: 90 } })), ROOM, null)).toBe(false);
    const four = { a: person('sa', 'Ann'), b: person('sb', 'Bo'), c: person('sc', 'Cy'), d: person('sd', 'Di') };
    expect(allowed(db(playingRoom({ cpu: '', players: four, out: { a: 120, b: 0, c: 90 } })), ROOM, null)).toBe(false);
  });

  it('closes an old game only when every seat, d included, has gone quiet', () => {
    const old = playingRoom({ createdAt: NOW - 2 * 86_400_000 });
    const quiet = { a: seatState(2, 120, { at: NOW - 400_000 }), c: seatState(2, 90, { at: NOW - 400_000 }) };
    expect(allowed(db(old, quiet), ROOM, null)).toBe(true);
    expect(allowed(db(old, { ...quiet, d: seatState(2, 5, { at: NOW - 1000 }) }), ROOM, null)).toBe(false);
    expect(allowed(db(playingRoom(), quiet), ROOM, null)).toBe(false);
  });
});
