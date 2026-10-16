import { describe, it, expect } from 'vitest';
import {
  CLASSIC,
  DRAFT_TICKS,
  KNOBS,
  MATCH_TICKS,
  SEATS,
  STANDARD_TUNE,
  advance,
  buildMap,
  clampKnob,
  cpuPickTick,
  drafting,
  encodeTune,
  lastTick,
  newState,
  paceOn,
  parseTune,
  rulesOf,
  step,
  upgradeCost,
  type Computer,
  type Rules,
  type Seat,
  type Site,
  type SwarmMap,
  type SwarmState,
  type Tune,
} from '../swarmGameLogic';

const tuned = (tune: Partial<Tune>): Rules => ({ ...CLASSIC, tune: { ...STANDARD_TUNE, ...tune } });

describe('the tune a match stores', () => {
  it('stores nothing for the standard game, and reads nothing as standard', () => {
    expect(encodeTune(STANDARD_TUNE)).toBe('');
    expect(parseTune('')).toEqual(STANDARD_TUNE);
    expect(parseTune(undefined)).toEqual(STANDARD_TUNE);
    expect(STANDARD_TUNE).toMatchObject({ len: 10, grow: 100, start: 5, range: 110, reload: 6 });
  });

  it('stores only the knobs off standard, in table order, and reads back what it stored', () => {
    const tune = { ...STANDARD_TUNE, reload: 12, len: 15, grow: 150 };
    expect(encodeTune(tune)).toBe('len=15;grow=150;reload=12');
    expect(parseTune(encodeTune(tune))).toEqual(tune);
    for (const knob of KNOBS) {
      const one = { ...STANDARD_TUNE, [knob.id]: knob.max };
      expect(parseTune(encodeTune(one))).toEqual(one);
    }
  });

  it('holds every value to its knob\'s range, whole, and skips what it cannot read', () => {
    expect(parseTune('len=999;grow=1')).toEqual({ ...STANDARD_TUNE, len: 30, grow: 25 });
    expect(parseTune('len=abc;zzz=5;grow;cap=-3')).toEqual(STANDARD_TUNE);
    expect(clampKnob('cap', 77.6)).toBe(78);
    expect(clampKnob('reload', 0)).toBe(2);
    for (const knob of KNOBS) {
      expect(knob.standard).toBeGreaterThanOrEqual(knob.min);
      expect(knob.standard).toBeLessThanOrEqual(knob.max);
    }
  });

  it('comes with the rules of the match', () => {
    const match = { status: 'waiting' as const, createdAt: 0, seed: 1, players: { a: { sessionId: 's', name: 'A' } }, game: 1, startAt: 0 };
    expect(rulesOf(match).tune).toEqual(STANDARD_TUNE);
    expect(rulesOf({ ...match, tune: 'len=4;cost=50' }).tune).toEqual({ ...STANDARD_TUNE, len: 4, cost: 50 });
  });
});

function hashOf(state: SwarmState): string {
  const text = JSON.stringify([state.huts, state.units, state.army, state.tick, state.winner, state.tolls]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16);
}

function played(rules: Rules): string {
  const sides = SEATS.slice(0, 2);
  const map = buildMap(1, 'meadow', sides, undefined, rules);
  const state = newState(map);
  const cpu: Computer = { a: 0, b: 0 };
  advance(state, map, {}, 1500, cpu);
  return hashOf(state);
}

describe('a tuned match', () => {
  it('plays the standard tune as the classic game, and a tuned one otherwise', () => {
    // The hash of this game in swarmClassic.test.ts.
    expect(played(tuned({}))).toBe('637a3104');
    expect(played(tuned({ grow: 200 }))).not.toBe('637a3104');
    expect(played(tuned({ speed: 150 }))).not.toBe('637a3104');
  });

  it('runs the clock to the tuned length, plus what four sides and the large ground add', () => {
    expect(buildMap(1, 'meadow', ['a', 'b']).ticks).toBe(MATCH_TICKS);
    const short = buildMap(1, 'meadow', ['a', 'b'], undefined, tuned({ len: 3 }));
    expect(short.ticks).toBe(1800);
    expect(buildMap(1, 'meadow', SEATS, undefined, tuned({ len: 3 })).ticks).toBe(1800 + 1800);
    // Two people who give no orders: level on huts at the tuned clock, so overtime runs out and calls it a draw, and not before.
    const state = newState(short);
    for (let tick = 0; tick < lastTick(short) - 1; tick++) step(state, short, {});
    expect(state.tick).toBe(1800 + 599);
    expect(state.winner).toBe(null);
    step(state, short, {});
    expect(state.winner).toBe('draw');
  });

  it('plays the tuned overtime, and none at 0', () => {
    const short = buildMap(1, 'meadow', ['a', 'b'], undefined, tuned({ len: 3, overtime: 0 }));
    expect(lastTick(short)).toBe(1800);
    const state = newState(short);
    advance(state, short, {}, 1799);
    expect(state.winner).toBe(null);
    step(state, short, {});
    expect(state.winner).toBe('draw');
    expect(lastTick(buildMap(1, 'meadow', ['a', 'b'], undefined, tuned({ len: 3, overtime: 100 })))).toBe(1900);
  });

  it('gives a big nest its tuned units', () => {
    const nests = (bigNest: number) => {
      const map = buildMap(7, 'thorns', ['a', 'b'], undefined, { ...tuned({ bigNest }), start: 'nests', nests: { b: 'many' } });
      return map.homes.map((home) => map.sites[home].n);
    };
    expect(nests(37)).toEqual([37, 5]);
    expect(nests(20)).toEqual([20, 5]);
  });

  it('drafts for the tuned time, the computer picking half way', () => {
    const map = buildMap(7, 'thorns', ['a', 'b'], undefined, { ...tuned({ draftTicks: 41 }), start: 'draft' });
    expect(cpuPickTick(map)).toBe(20);
    expect(drafting(map, 41)).toBe(true);
    expect(drafting(map, 42)).toBe(false);
  });

  it('gives each side its tuned starting units in its first hut, and leaves the rest', () => {
    const plain = buildMap(7, 'thorns', ['a', 'b']);
    const rich = buildMap(7, 'thorns', ['a', 'b'], undefined, tuned({ start: 25 }));
    expect(plain.homes.map((home) => plain.sites[home].n)).toEqual([5, 5]);
    expect(rich.homes.map((home) => rich.sites[home].n)).toEqual([25, 25]);
    expect(rich.sites.filter((_, at) => !rich.homes.includes(at))).toEqual(plain.sites.filter((_, at) => !plain.homes.includes(at)));
  });

  it('gives a side that drafts another hut its tuned starting units there', () => {
    const map = buildMap(7, 'thorns', ['a', 'b'], undefined, { ...tuned({ start: 25 }), start: 'draft' });
    const pick = map.sites.findIndex((site) => site.owner === null && !site.tower);
    const state = newState(map);
    advance(state, map, { a: [{ tick: 10, kind: 'nest', from: pick, to: pick }] }, DRAFT_TICKS);
    expect(state.homes[0]).toBe(pick);
    expect(state.huts[pick]).toMatchObject({ owner: 'a', n: 25 });
  });

  // a's home, a tower of a's, and b's home, in a row.
  function row(rules: Rules, towerOwner: Seat | null = 'a'): SwarmMap {
    const sites: Site[] = [
      { x: 100, y: 300, owner: 'a', n: 10, level: 1 },
      { x: 400, y: 300, owner: towerOwner, n: 10, level: 1, tower: true },
      { x: 900, y: 300, owner: 'b', n: 10, level: 1 },
    ];
    const links = [[1], [0, 2], [1]];
    const paths = [{ a: 0, b: 1, kind: 'road' as const }, { a: 1, b: 2, kind: 'road' as const }];
    return { id: 'meadow', scene: 'meadow', sites, links, paths, rivers: [], w: 1000, h: 660, sides: ['a', 'b'], homes: [0, 2], size: 'small', ticks: MATCH_TICKS, rules };
  }

  it('breeds, fills and prices huts by the tune', () => {
    const count = (rules: Rules, ticks: number) => {
      const map = row(rules);
      const state = newState(map);
      state.huts[0].n = 0;
      for (let tick = 0; tick < ticks; tick++) step(state, map, {});
      return state.huts[0].n;
    };
    expect(count(tuned({}), 50)).toBe(5);
    expect(count(tuned({ grow: 200 }), 50)).toBe(10);
    expect(count(tuned({ grow: 50 }), 50)).toBe(2);
    expect(count(tuned({ grow: 400, cap: 50 }), 1000)).toBe(15);
    const map = row(tuned({ cost: 200 }));
    const state = newState(map);
    expect(upgradeCost(row(CLASSIC), state, 0, 'hut')).toBe(15);
    expect(upgradeCost(map, state, 0, 'hut')).toBe(30);
    expect(upgradeCost(map, state, 0, 'speed')).toBe(40);
  });

  it('marches at the tuned speed', () => {
    expect(paceOn(row(CLASSIC), 1, 2, 0)).toBe(6);
    expect(paceOn(row(tuned({ speed: 50 })), 1, 2, 0)).toBe(3);
    expect(paceOn(row(tuned({ speed: 200 })), 1, 2, 3)).toBe(24);
  });

  it('shoots as far and as often as the tune says', () => {
    // A unit of b's 150 from the tower: out of the standard range, inside a range of 200.
    const shotAt = (rules: Rules) => {
      const map = row(rules);
      const state = newState(map);
      state.units = [{ id: 1, seat: 'b', from: 2, to: 1, dest: 0, d: 350 }];
      state.nextId = 2;
      step(state, map, {});
      return { shots: state.shots.length, reload: state.huts[1].reload };
    };
    expect(shotAt(tuned({}))).toEqual({ shots: 0, reload: 0 });
    expect(shotAt(tuned({ range: 200 }))).toEqual({ shots: 1, reload: 6 });
    expect(shotAt(tuned({ range: 200, reload: 20 }))).toEqual({ shots: 1, reload: 20 });
  });
});
