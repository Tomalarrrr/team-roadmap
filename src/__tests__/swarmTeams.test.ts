import { describe, it, expect } from 'vitest';
import {
  CLASSIC,
  MAP_IDS,
  MATCH_TICKS,
  RALLY_UNITS,
  SEATS,
  WAVE_TICKS,
  WAVE_UNITS,
  advance,
  allied,
  buildMap,
  centreOf,
  cpuOrders,
  newState,
  rulesOf,
  step,
  teamOf,
  type Computer,
  type Order,
  type Rules,
  type Seat,
  type Site,
  type SwarmEvent,
  type SwarmMap,
  type SwarmMatch,
  type SwarmState,
} from '../swarmGameLogic';

const TEAMS: Rules = { ...CLASSIC, mode: 'teams' };
const survival = (computer: Seat[]): Rules => ({ ...CLASSIC, mode: 'survival', computer });

function mapOf(sites: Site[], links: number[][], sides: Seat[], rules: Rules, ticks = MATCH_TICKS): SwarmMap {
  const paths = links.flatMap((linked, a) => linked.filter((b) => a < b).map((b) => ({ a, b, kind: 'road' as const })));
  return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides, homes: sides.map((seat) => sites.findIndex((site) => site.owner === seat)), size: 'small', ticks, rules };
}

// A full hut breeds no more, so every change to its count is a unit coming in or dying.
const full = (x: number, owner: Seat | null, extra: Partial<Site> = {}): Site => ({ x, y: 100, owner, n: owner ? 30 : 0, level: 1, ...extra });

/** b and c far off with nothing joining them to anything, so the game goes on while a and d are tried. */
const others = (): Site[] => [full(800, 'b', { y: 500 }), full(900, 'c', { y: 600 })];

function play(map: SwarmMap, state: SwarmState, to: number, orders: Partial<Record<Seat, Order[]>> = {}, cpu: Computer = {}) {
  const events: SwarmEvent[] = [];
  let shots = 0;
  advance(state, map, orders, to, cpu, (s) => {
    events.push(...s.events);
    shots += s.shots.length;
  });
  return { events, shots };
}

/** Run until no unit is on the road: a hut that changes hands breeds again from then, so its count is read on the tick. */
function land(map: SwarmMap, state: SwarmState, orders: Partial<Record<Seat, Order[]>> = {}) {
  const events: SwarmEvent[] = [];
  while (state.units.length > 0 && state.tick < 200) {
    step(state, map, orders);
    events.push(...state.events);
  }
  return events;
}

describe('allies in teams', () => {
  // a's and d's huts, a path between them. Two units walk it at each other.
  function passing(rules: Rules) {
    const map = mapOf([full(100, 'a'), full(300, 'd'), ...others()], [[1], [0], [], []], SEATS.slice(), rules);
    const state = newState(map);
    state.units.push({ id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 0 }, { id: 2, seat: 'd', from: 1, to: 0, dest: 0, d: 0 });
    state.nextId = 3;
    return { map, state, ...play(map, state, 60) };
  }

  it('pair a with d and b with c, the left and the right of the board', () => {
    const map = buildMap(1, 'meadow', SEATS, undefined, TEAMS);
    expect(map.sides.map((seat) => teamOf(map, seat))).toEqual(['a', 'b', 'b', 'a']);
    expect(allied(map, 'a', 'd')).toBe(true);
    expect(allied(map, 'a', 'b')).toBe(false);
    expect(allied(map, 'a', null)).toBe(false);
  });

  it('are nobody in a game of three, or in classic', () => {
    const three = buildMap(1, 'meadow', ['a', 'b', 'c'], undefined, TEAMS);
    expect(['a', 'b', 'c'].map((seat) => teamOf(three, seat as Seat))).toEqual(['a', 'b', 'c']);
    const classic = buildMap(1, 'meadow', SEATS);
    expect(allied(classic, 'a', 'd')).toBe(false);
  });

  it.each(MAP_IDS)('start on one half of %s, partner beside partner', (id) => {
    const map = buildMap(7, id, SEATS, undefined, TEAMS);
    const { x } = centreOf(map);
    for (const seat of map.sides) {
      const ally = map.sides.find((other) => other !== seat && allied(map, other, seat))!;
      const left = (side: Seat) => map.sites[map.homes[map.sides.indexOf(side)]].x < x;
      expect(left(ally)).toBe(left(seat));
    }
  });

  it('pass on a path without a fight, and each joins the other one’s garrison', () => {
    const { state, events } = passing(TEAMS);
    expect(events.filter((event) => event.kind === 'clash')).toEqual([]);
    expect(state.units).toEqual([]);
    expect(state.huts.slice(0, 2).map((hut) => [hut.owner, hut.n])).toEqual([
      ['a', 31],
      ['d', 31],
    ]);
  });

  it('fight on that path when the game is classic', () => {
    const { state, events } = passing(CLASSIC);
    expect(events.some((event) => event.kind === 'clash')).toBe(true);
    expect(state.huts[0].n + state.huts[1].n).toBeLessThan(62);
  });

  it('pass each other on a path where one of the other team walks too, and only that one is fought', () => {
    const map = mapOf([full(100, 'a'), full(400, 'd'), ...others()], [[1], [0], [], []], SEATS.slice(), TEAMS);
    const state = newState(map);
    // d's unit is ahead of b's, so a's unit meets d's first, halfway between them, and b's after.
    state.units.push({ id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 0 }, { id: 2, seat: 'd', from: 1, to: 0, dest: 0, d: 60 }, { id: 3, seat: 'b', from: 1, to: 0, dest: 0, d: 0 });
    state.nextId = 4;
    const clashes = land(map, state).filter((event) => event.kind === 'clash');
    expect(clashes).toEqual([{ kind: 'clash', from: 0, to: 1, d: 150 }]);
  });

  // a and d both march on one empty hut between them and get there on one tick.
  function meeting(rules: Rules) {
    const map = mapOf([full(100, 'a'), full(200, null), full(300, 'd'), ...others()], [[1], [0, 2], [1], [], []], SEATS.slice(), rules);
    const state = newState(map);
    state.units.push({ id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 0 }, { id: 2, seat: 'd', from: 2, to: 1, dest: 1, d: 0 });
    state.nextId = 3;
    return { state, events: land(map, state) };
  }

  it('walk in at one door together', () => {
    const { state, events } = meeting(TEAMS);
    expect(events.filter((event) => event.kind === 'clash')).toEqual([]);
    expect(state.huts[1].n).toBe(2);
    expect(['a', 'd']).toContain(state.huts[1].owner);
  });

  it('fight at that door when the game is classic', () => {
    const { state, events } = meeting(CLASSIC);
    expect(events.some((event) => event.kind === 'clash')).toBe(true);
    expect(state.huts[1].n).toBeLessThan(2);
  });

  // a sends one unit on through d's hut to a hut of b's beyond it.
  function through(rules: Rules) {
    const map = mapOf([full(100, 'a'), full(200, 'd'), full(300, 'b'), full(900, 'c', { y: 600 })], [[1], [0, 2], [1], []], SEATS.slice(), rules);
    const state = newState(map);
    state.units.push({ id: 1, seat: 'a', from: 0, to: 1, dest: 2, d: 0 });
    state.nextId = 2;
    const hits = land(map, state).flatMap((event) => (event.kind === 'hit' ? [event.hut] : []));
    return { state, hits };
  }

  it('let each other’s units walk on through their huts', () => {
    const { state, hits } = through(TEAMS);
    expect(hits).toEqual([2]);
    expect(state.huts[1]).toMatchObject({ owner: 'd', n: 30 });
  });

  it('do not, in classic: the unit fights the garrison it comes to first', () => {
    expect(through(CLASSIC).hits).toEqual([1]);
  });

  function underTower(rules: Rules) {
    const map = mapOf([full(100, 'a'), full(300, 'a'), full(200, 'd', { y: 150, n: 10, tower: true }), ...others()], [[1], [0], [], [], []], SEATS.slice(), rules);
    const state = newState(map);
    state.units.push({ id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 0 });
    state.nextId = 2;
    return { state, ...play(map, state, 60) };
  }

  it('have towers that never shoot at each other', () => {
    const { state, shots } = underTower(TEAMS);
    expect(shots).toBe(0);
    expect(state.huts[1].n).toBe(31);
  });

  it('control: that tower shoots in classic', () => {
    expect(underTower(CLASSIC).shots).toBe(1);
  });
});

describe('the computer in teams', () => {
  // a's computer beside a weak hut of d's, and b's column on the way to it when `attacked`.
  function board(rules: Rules, attacked: boolean) {
    const map = mapOf([full(200, 'a'), full(250, 'd', { n: 2 }), full(400, 'b'), full(900, 'c', { y: 600 })], [[1], [0, 2], [1], []], SEATS.slice(), rules);
    const state = newState(map);
    if (attacked) for (let id = 1; id <= 10; id++) state.units.push({ id, seat: 'b', from: 2, to: 1, dest: 1, d: 0 });
    state.nextId = 11;
    return { map, state };
  }
  const sentTo = (orders: Order[], to: number) => orders.filter((order) => (order.kind === 'half' || order.kind === 'all') && order.to === to).length;

  it('never attacks an ally, though it attacks the same hut in classic', () => {
    const teams = board(TEAMS, false);
    expect(sentTo(cpuOrders(teams.state, teams.map, 'a'), 1)).toBe(0);
    const classic = board(CLASSIC, false);
    expect(sentTo(cpuOrders(classic.state, classic.map, 'a'), 1)).toBeGreaterThan(0);
  });

  it('sends help to an ally’s hut that is under attack', () => {
    const { map, state } = board(TEAMS, true);
    expect(sentTo(cpuOrders(state, map, 'a'), 1)).toBeGreaterThan(0);
  });
});

describe('judging teams', () => {
  const judged = (sites: Site[], ticks = 1) => {
    const map = mapOf(sites, sites.map(() => []), SEATS.slice(), TEAMS, ticks);
    const state = newState(map);
    step(state, map, {});
    return state.winner;
  };

  it('gives the game to the team left, named by its first seat, when only the second of it lives', () => {
    expect(judged([full(100, 'c')], 100)).toBe('b');
  });

  it('counts a team’s huts together on the clock, where classic would give it to the biggest side', () => {
    const sites = [full(100, 'a'), full(150, 'a'), full(200, 'd'), full(250, 'd'), full(300, 'b'), full(350, 'b'), full(400, 'b')];
    expect(judged(sites)).toBe('a');
    const map = mapOf(sites, sites.map(() => []), SEATS.slice(), CLASSIC, 1);
    const state = newState(map);
    step(state, map, {});
    expect(state.winner).toBe('b');
  });

  it('calls it a draw when the teams hold as much as each other', () => {
    expect(judged([full(100, 'a'), full(200, 'd'), full(300, 'b'), full(400, 'c')])).toBe('draw');
  });
});

describe('the rally', () => {
  // d's last hut, nearly empty, with a column of b's on the way to it; a holds a hut and a tower.
  function falling(rules: Rules, orders: Partial<Record<Seat, Order[]>> = {}) {
    const map = mapOf([full(100, 'a'), full(150, 'a', { n: 10, tower: true }), full(500, 'd', { n: 0 }), full(600, 'b'), full(900, 'c', { y: 600 })], [[], [], [3], [2], []], SEATS.slice(), rules);
    const state = newState(map);
    for (let id = 1; id <= 8; id++) state.units.push({ id, seat: 'b', from: 3, to: 2, dest: 2, d: 0 });
    state.nextId = 9;
    return { state, events: land(map, state, orders) };
  }

  it('puts RALLY_UNITS into every hut of the ally left standing, past the cap and not into its towers', () => {
    const { state, events } = falling(TEAMS);
    expect(state.huts[2].owner).toBe('b');
    expect(events.filter((event) => event.kind === 'rally')).toEqual([{ kind: 'rally', seat: 'a', huts: [0] }]);
    expect(state.huts[0].n).toBe(30 + RALLY_UNITS);
    expect(state.huts[1].n).toBe(10);
  });

  it('is not given for a side that raised the white flag', () => {
    const { state, events } = falling(TEAMS, { d: [{ tick: 1, kind: 'flag', from: 0, to: 0 }] });
    expect(state.yielded).toEqual(['d']);
    expect(events.filter((event) => event.kind === 'rally')).toEqual([]);
    expect(state.huts[0].n).toBe(30);
  });

  it('is not given in classic', () => {
    const { state, events } = falling(CLASSIC);
    expect(state.huts[2].owner).toBe('b');
    expect(events.filter((event) => event.kind === 'rally')).toEqual([]);
    expect(state.huts[0].n).toBe(30);
  });
});

describe('survival', () => {
  // The people's hut, and two of the computer's and a tower of its, none joined to anything.
  function board(rules: Rules) {
    const map = mapOf([full(100, 'a'), full(300, 'b'), full(500, 'c'), full(700, 'b', { n: 10, tower: true })], [[], [], [], []], ['a', 'b', 'c'], rules);
    return { map, state: newState(map) };
  }

  it('is the people against the computer: the computer’s sides are one team', () => {
    const { map } = board(survival(['b', 'c']));
    expect(teamOf(map, 'c')).toBe('b');
    expect(allied(map, 'b', 'c')).toBe(true);
    expect(allied(map, 'a', 'b')).toBe(false);
  });

  it('lands wave k every WAVE_TICKS: WAVE_UNITS times k into each of the computer’s huts, past the cap, none into a tower', () => {
    const { map, state } = board(survival(['b', 'c']));
    advance(state, map, {}, WAVE_TICKS - 1);
    expect(state.huts.map((hut) => hut.n)).toEqual([30, 30, 30, 10]);
    step(state, map, {});
    expect(state.events).toEqual([{ kind: 'wave', k: 1, huts: [1, 2] }]);
    expect(state.huts.map((hut) => hut.n)).toEqual([30, 30 + WAVE_UNITS, 30 + WAVE_UNITS, 10]);
    advance(state, map, {}, 2 * WAVE_TICKS);
    expect(state.events).toEqual([{ kind: 'wave', k: 2, huts: [1, 2] }]);
    expect(state.huts.map((hut) => hut.n)).toEqual([30, 30 + 3 * WAVE_UNITS, 30 + 3 * WAVE_UNITS, 10]);
  });

  it('control: no wave in classic', () => {
    const { map, state } = board(CLASSIC);
    const { events } = play(map, state, WAVE_TICKS);
    expect(events.filter((event) => event.kind === 'wave')).toEqual([]);
    expect(state.huts[1].n).toBe(30);
  });

  it('goes to the people at the clock however little they hold', () => {
    const map = mapOf([full(100, 'a', { n: 1 }), full(300, 'b', { n: 30 }), full(500, 'b', { n: 30 })], [[], [], []], ['a', 'b'], survival(['b']), 5);
    const state = newState(map);
    advance(state, map, {}, 10);
    expect([state.tick, state.winner]).toEqual([5, 'a']);
  });

  it('is won by the people’s team, named by its first seat, while any one of theirs lives', () => {
    const sites = [full(200, 'd'), full(300, 'b'), full(500, 'c')];
    const map = mapOf(sites, [[], [], []], SEATS.slice(), survival(['b', 'c']), 5);
    const state = newState(map);
    advance(state, map, {}, 10);
    expect(state.winner).toBe('a');
  });

  it('goes to the computer, by its first seat, once no person is left playing', () => {
    const map = mapOf([full(100, 'a'), full(300, 'b')], [[], []], ['a', 'b'], survival(['b']));
    const state = newState(map);
    advance(state, map, {}, 20, { a: 5, b: 0 });
    expect([state.tick, state.winner]).toEqual([6, 'b']);
  });

  it('takes the computer’s seats from the match, and only survival does', () => {
    const match: SwarmMatch = { status: 'waiting', createdAt: 0, seed: 1, players: { a: { sessionId: 's1', name: 'A' } }, cpu: 'bc', game: 1, startAt: 0 };
    expect(rulesOf({ ...match, mode: 'survival' }).computer).toEqual(['b', 'c']);
    expect('computer' in rulesOf({ ...match, mode: 'teams' })).toBe(false);
  });
});

describe('teams and survival played by the computer', () => {
  const run = (rules: Rules, sides: readonly Seat[]) => {
    const map = buildMap(42, 'crossroads', sides, undefined, rules);
    const state = newState(map);
    const events: SwarmEvent[] = [];
    advance(state, map, {}, 2 * WAVE_TICKS, Object.fromEntries(sides.map((seat) => [seat, 0])), (s) => events.push(...s.events));
    return { text: JSON.stringify(state), events };
  };

  it('play out the same twice', () => {
    const teams = run(TEAMS, SEATS);
    expect(run(TEAMS, SEATS).text).toBe(teams.text);
    const alone = run(survival(['b', 'c', 'd']), SEATS);
    expect(run(survival(['b', 'c', 'd']), SEATS).text).toBe(alone.text);
    expect(alone.events.filter((event) => event.kind === 'wave').map((event) => event.kind === 'wave' && event.k)[0]).toBe(1);
  });
});
