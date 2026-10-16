import { describe, it, expect } from 'vitest';
import { CLASSIC, MAP_IDS, START_IDS, buildMap, type Seat, type MapId, type StartId } from '../../swarmGameLogic';
import { columnOf, startsOf, whereOf } from '../swarm/swarmStarts';

const SEEDS = [1, 99, 12345];
const FOUR: Seat[] = ['a', 'b', 'c', 'd'];

const startsOn = (seed: number, id: MapId, sides: Seat[], start: StartId = 'home') => {
  const map = buildMap(seed, id, sides, undefined, { ...CLASSIC, start, nests: { a: 'many' } });
  return startsOf(map, map.homes);
};

describe('where each side starts', () => {
  it.each(MAP_IDS)('puts four sides in four different corners of %s, two in each column', (id) => {
    for (const seed of SEEDS) {
      const starts = startsOn(seed, id, FOUR);
      const words = FOUR.map((seat) => whereOf(starts[seat]!));
      expect(new Set(words).size).toBe(4);
      for (const said of words) expect(said).toMatch(/^in the (top|bottom) (left|right) corner$/);
      expect(FOUR.filter((seat) => columnOf(starts[seat]!) === 'left')).toHaveLength(2);
      expect(FOUR.filter((seat) => columnOf(starts[seat]!) === 'right')).toHaveLength(2);
    }
  });

  it.each(MAP_IDS)('puts the third of three sides in the middle of %s, and the other two either side', (id) => {
    for (const seed of SEEDS) {
      const starts = startsOn(seed, id, ['a', 'b', 'c']);
      expect(whereOf(starts.c!)).toBe('in the middle');
      expect(columnOf(starts.c!)).toBe('middle');
      expect([columnOf(starts.a!), columnOf(starts.b!)].sort()).toEqual(['left', 'right']);
    }
  });

  // The close start moves homes in towards the middle, where the corners and edges no longer say it.
  it.each(START_IDS)('tells every side where it starts apart from the rest with the %s start', (start) => {
    for (const id of MAP_IDS) {
      for (const sides of [['a', 'b'], ['a', 'b', 'c'], FOUR] as Seat[][]) {
        for (const seed of SEEDS) {
          const starts = startsOn(seed, id, sides, start);
          const words = sides.map((seat) => whereOf(starts[seat]!));
          expect(new Set(words).size, `${id} ${sides.length} ${seed}: ${words.join(', ')}`).toBe(sides.length);
          if (sides.length === 3) expect(words[2]).toBe('in the middle');
        }
      }
    }
  });

  it('takes the seats the game is played from, not the first letters', () => {
    const starts = startsOn(1, 'meadow', ['b', 'd']);
    expect(Object.keys(starts).sort()).toEqual(['b', 'd']);
  });

  it('puts each side where the homes it is given are, not where the map started them', () => {
    const map = buildMap(1, 'meadow', ['a', 'b']);
    const swapped = startsOf(map, [map.homes[1], map.homes[0]]);
    const kept = startsOf(map, map.homes);
    expect(swapped.a).toEqual(kept.b);
    expect(swapped.b).toEqual(kept.a);
  });

  it('says a corner only for a start well up or down as well as across', () => {
    expect(whereOf({ x: -0.42, y: 0.38 })).toBe('in the bottom left corner');
    expect(whereOf({ x: 0.43, y: -0.34 })).toBe('in the top right corner');
    expect(whereOf({ x: -0.44, y: 0.08 })).toBe('on the left');
    expect(whereOf({ x: 0.41, y: 0 })).toBe('on the right');
    expect(whereOf({ x: 0.01, y: -0.34 })).toBe('at the top');
  });

  it('says which half an edge start is in when it stands well off the middle line', () => {
    expect(whereOf({ x: -0.44, y: 0.21 })).toBe('on the left, below the middle');
    expect(whereOf({ x: 0.3, y: -0.12 })).toBe('on the right, above the middle');
    expect(whereOf({ x: 0.15, y: 0.36 })).toBe('at the bottom, right of the middle');
    expect(whereOf({ x: -0.08, y: -0.34 })).toBe('at the top, left of the middle');
    expect(whereOf({ x: 0, y: 0 })).toBe('in the middle');
  });

  it('says which way off the middle a start near it stands', () => {
    expect(whereOf({ x: -0.12, y: 0.01 })).toBe('just left of the middle');
    expect(whereOf({ x: 0.15, y: 0 })).toBe('just right of the middle');
    expect(whereOf({ x: 0, y: -0.2 })).toBe('just above the middle');
    expect(whereOf({ x: 0.01, y: 0.25 })).toBe('just below the middle');
    expect(whereOf({ x: -0.1, y: 0.2 })).toBe('just below and left of the middle');
    expect(whereOf({ x: 0.019, y: -0.019 })).toBe('in the middle');
  });

  it('shows a start just off the middle line on its own side of the score line', () => {
    expect(columnOf({ x: -0.08, y: -0.34 })).toBe('left');
    expect(columnOf({ x: 0.08, y: 0.34 })).toBe('right');
    expect(columnOf({ x: 0.01, y: 0.3 })).toBe('middle');
  });
});
