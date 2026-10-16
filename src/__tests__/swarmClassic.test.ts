import { describe, it, expect } from 'vitest';
import { CLASSIC, SEATS, STANDARD_TUNE, TWISTS, advance, buildMap, newState, rulesOf, twistLetters, type Computer, type MapId, type SwarmMatch, type SwarmState } from '../swarmGameLogic';

// Classic games played by the computer on every side, hashed at the end. The
// hashes were taken from the code before modes, starts and twists came in, so
// a change that moves a classic game by one unit on one tick shows here. Only
// the fields a classic game has always had are hashed: a field added to the
// state for something else changes its JSON without changing the game.

const TICKS = 1500;

function hashOf(state: SwarmState): string {
  const text = JSON.stringify([state.huts, state.units, state.army, state.tick, state.winner, state.tolls]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return hash.toString(16);
}

const GAMES: [seed: number, id: MapId, sides: number, hash: string][] = [
  [1, 'meadow', 2, '637a3104'],
  [7, 'thorns', 2, 'db3dc3e9'],
  [42, 'bridges', 2, '715c000d'],
  [3, 'guns', 3, '7655244d'],
  [99, 'hill', 3, 'e225f73'],
  [1234, 'crossroads', 3, 'ba6e210'],
  [2, 'meadow', 4, 'a85c1781'],
  [7, 'bridges', 4, 'a805f87f'],
  [42, 'hill', 4, 'dd0cdbbd'],
];

describe('a classic game', () => {
  it.each(GAMES)('seed %i on %s with %i sides plays out as it always has', (seed, id, count, hash) => {
    const sides = SEATS.slice(0, count);
    const map = buildMap(seed, id, sides);
    const state = newState(map);
    const cpu: Computer = Object.fromEntries(sides.map((seat) => [seat, 0]));
    advance(state, map, {}, TICKS, cpu);
    expect(state.units.length + state.huts.length).toBeGreaterThan(0);
    expect(hashOf(state)).toBe(hash);
  });
});

describe('the rules of a match', () => {
  const match: SwarmMatch = { status: 'waiting', createdAt: 0, seed: 1, players: { a: { sessionId: 's1', name: 'A' }, b: { sessionId: 's2', name: 'B' } }, game: 1, startAt: 0 };

  it('are classic when the match chose nothing, and a map built without rules is classic', () => {
    expect(rulesOf(match)).toEqual(CLASSIC);
    expect(buildMap(1, 'meadow').rules).toBe(CLASSIC);
  });

  it('are what the match chose, the twists in their fixed order and a nest for each seat that picked one', () => {
    const chosen = { ...match, mode: 'teams' as const, start: 'nests' as const, twists: 'fzq', players: { ...match.players, b: { sessionId: 's2', name: 'B', nest: 'many' as const } } };
    const rules = rulesOf(chosen);
    expect(rules).toEqual({ mode: 'teams', start: 'nests', twists: ['flood', 'frenzy', 'queens'], nests: { b: 'many' }, tune: STANDARD_TUNE });
    expect(buildMap(1, 'meadow', ['a', 'b'], undefined, rules).rules).toBe(rules);
  });

  it('store the twists as letters in one order, whatever order they were picked in', () => {
    expect(twistLetters(['queens', 'flood', 'fog'])).toBe('foq');
    expect(twistLetters([...TWISTS].reverse())).toBe('fopgzcbqa');
    expect(twistLetters([])).toBe('');
    expect(rulesOf({ ...match, twists: twistLetters([...TWISTS]) }).twists).toEqual(TWISTS);
  });
});
