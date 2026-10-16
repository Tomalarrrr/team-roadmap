// What the scoreboard and the result say about a mode: each figure is the one
// the game counted, said only in the mode that counts it.

import { describe, it, expect } from 'vitest';
import { CLASSIC, buildMap, goldenAt, middleOf, newState, type ModeId, type Rules, type Seat, type Twist } from '../../swarmGameLogic';
import { clockAt, eggHolder, modeNotes, modeStory, type Names } from '../swarm/swarmModes';

const rulesFor = (mode: ModeId, twists: Twist[] = []): Rules => ({ ...CLASSIC, mode, twists });
const mapFor = (rules: Rules, sides: Seat[] = ['a', 'b']) => buildMap(7, 'meadow', sides, undefined, rules);
const NAMES: Names = (seat) => (seat === 'a' ? { name: 'You', whose: 'Your' } : { name: 'The bees', whose: "The bees'" });

describe('modeNotes', () => {
  it('says nothing in classic', () => {
    const map = mapFor(CLASSIC);
    const state = newState(map);
    state.tick = 5000;
    expect(modeNotes(map, state)).toEqual([]);
  });

  it('gives each side its time on the hill', () => {
    const map = mapFor(rulesFor('hill'));
    const state = newState(map);
    state.held.a = 412;
    expect(modeNotes(map, state)).toEqual([{ label: 'Hill, 60s wins', sides: [{ seat: 'a', text: '41s' }, { seat: 'b', text: '0s' }] }]);
  });

  it('names the egg holder, in a hut or carried, and nobody while it lies in a neutral hut', () => {
    const map = mapFor(rulesFor('egg'));
    const state = newState(map);
    expect(modeNotes(map, state)).toEqual([{ label: 'Egg unclaimed', sides: [] }]);
    state.huts[middleOf(map)].owner = 'b';
    expect(modeNotes(map, state)).toEqual([{ label: 'Egg held by', sides: [{ seat: 'b', text: '' }] }]);
    state.egg = -1;
    state.units = [{ id: 1, seat: 'a', from: 0, to: 1, dest: 1, d: 3, egg: true }];
    expect(eggHolder(state)).toBe('a');
    expect(modeNotes(map, state)).toEqual([{ label: 'Egg carried by', sides: [{ seat: 'a', text: '' }] }]);
  });

  it('marks the bounty leader and what taking from them pays', () => {
    const map = mapFor(rulesFor('bounty'));
    const state = newState(map);
    expect(modeNotes(map, state)).toEqual([{ label: 'Bounty: no leader', sides: [] }]);
    state.leader = 'b';
    state.bounty = 14;
    expect(modeNotes(map, state)).toEqual([{ label: 'Bounty +14 on', sides: [{ seat: 'b', text: '' }] }]);
  });

  it('counts down to the golden hut from 30s before, and not before that or after', () => {
    const map = mapFor(rulesFor('classic', ['golden']));
    const state = newState(map);
    const at = goldenAt(map);
    const label = (tick: number) => {
      state.tick = tick;
      return modeNotes(map, state).map((note) => note.label);
    };
    expect([label(at - 301), label(at - 300), label(at - 1), label(at)]).toEqual([[], ['Golden hut in 30s'], ['Golden hut in 1s'], []]);
  });

  it('shows the frenzy for its last minute only', () => {
    const map = mapFor(rulesFor('classic', ['frenzy']));
    const state = newState(map);
    state.tick = map.ticks - 600;
    expect(modeNotes(map, state)).toEqual([]);
    state.tick++;
    expect(modeNotes(map, state)).toEqual([{ label: 'Frenzy', sides: [] }]);
  });
});

describe('modeStory', () => {
  it('tells the hill by each side\'s time on it, longest first', () => {
    const map = mapFor(rulesFor('hill'));
    const state = newState(map);
    state.held = { a: 205, b: 600, c: 0, d: 0 };
    state.winner = 'b';
    expect(modeStory(map, state, NAMES)).toEqual(['The bees held the hill 60s', 'You held the hill 20s']);
  });

  it('tells when each queen fell, and who took the last one', () => {
    const map = mapFor(rulesFor('regicide'), ['a', 'b', 'c']);
    const state = newState(map);
    state.fallen = { a: 1340, b: 0, c: 820, d: 0 };
    state.tick = 1340;
    state.winner = 'b';
    expect(clockAt(1340)).toBe('2:14');
    expect(modeStory(map, state, NAMES)).toEqual(["The bees' queen fell at 1:22", 'Your queen fell at 2:14', 'The bees took the last queen']);
    // With a's queen still standing, b won on the clock and took no last queen.
    state.fallen.a = 0;
    state.tick = map.ticks;
    expect(modeStory(map, state, NAMES)).toEqual(["The bees' queen fell at 1:22"]);
  });

  it('counts each side\'s bounties', () => {
    const map = mapFor(rulesFor('bounty'));
    const state = newState(map);
    state.claimed = { a: 3, b: 1, c: 0, d: 0 };
    state.winner = 'a';
    expect(modeStory(map, state, NAMES)).toEqual(['You collected the bounty 3 times', 'The bees collected the bounty once']);
  });

  it('tells an egg got home with the time, and says nothing when the game was won another way', () => {
    const map = mapFor(rulesFor('egg'));
    const state = newState(map);
    state.winner = 'a';
    state.tick = 2520;
    expect(modeStory(map, state, NAMES)).toEqual([]);
    state.egg = map.homes[0];
    expect(modeStory(map, state, NAMES)).toEqual(['You got the egg home at 4:12']);
    state.huts[map.homes[0]].owner = 'b';
    expect(modeStory(map, state, NAMES)).toEqual([]);
  });

  it('adds nothing in classic, whatever the counters hold', () => {
    const map = mapFor(CLASSIC);
    const state = newState(map);
    state.held.a = 300;
    state.claimed.a = 2;
    state.winner = 'a';
    expect(modeStory(map, state, NAMES)).toEqual([]);
  });
});
