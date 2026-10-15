import { describe, it, expect } from 'vitest';
import { MAP_IDS, buildMap, type Seat } from '../../swarmGameLogic';
import { columnOf, startsOf, whereOf } from '../swarm/swarmStarts';

const SEEDS = [1, 99, 12345];
const FOUR: Seat[] = ['a', 'b', 'c', 'd'];

describe('where each side starts', () => {
  it.each(MAP_IDS)('puts four sides in four different corners of %s, two in each column', (id) => {
    for (const seed of SEEDS) {
      const starts = startsOf(buildMap(seed, id, FOUR));
      const words = FOUR.map((seat) => whereOf(starts[seat]!));
      expect(new Set(words).size).toBe(4);
      for (const said of words) expect(said).toMatch(/^in the (top|bottom) (left|right) corner$/);
      expect(FOUR.filter((seat) => columnOf(starts[seat]!) === 'left')).toHaveLength(2);
      expect(FOUR.filter((seat) => columnOf(starts[seat]!) === 'right')).toHaveLength(2);
    }
  });

  it.each(MAP_IDS)('puts the third of three sides in the middle of %s, and the other two either side', (id) => {
    for (const seed of SEEDS) {
      const starts = startsOf(buildMap(seed, id, ['a', 'b', 'c']));
      expect(whereOf(starts.c!)).toBe('in the middle');
      expect(columnOf(starts.c!)).toBe('middle');
      expect([columnOf(starts.a!), columnOf(starts.b!)].sort()).toEqual(['left', 'right']);
    }
  });

  it('takes the seats the game is played from, not the first letters', () => {
    const starts = startsOf(buildMap(1, 'meadow', ['b', 'd']));
    expect(Object.keys(starts).sort()).toEqual(['b', 'd']);
  });

  it('says a corner only for a start well up or down as well as across', () => {
    expect(whereOf({ x: -0.42, y: 0.38 })).toBe('in the bottom left corner');
    expect(whereOf({ x: 0.43, y: -0.34 })).toBe('in the top right corner');
    expect(whereOf({ x: -0.44, y: 0.21 })).toBe('on the left');
    expect(whereOf({ x: 0.41, y: 0 })).toBe('on the right');
    expect(whereOf({ x: -0.08, y: -0.34 })).toBe('at the top');
    expect(whereOf({ x: 0, y: 0 })).toBe('in the middle');
  });

  it('shows a start just off the middle line on its own side of the score line', () => {
    expect(columnOf({ x: -0.08, y: -0.34 })).toBe('left');
    expect(columnOf({ x: 0.08, y: 0.34 })).toBe('right');
    expect(columnOf({ x: 0.01, y: 0.3 })).toBe('middle');
  });
});
