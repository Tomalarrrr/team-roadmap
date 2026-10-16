// Where each side starts, in the words and the places the game shows it: the
// countdown says where to look for your first hut and what you hold, and the
// score line puts each side on the same side of it as it is of the board.

import { centreOf, type Seat, type SwarmMap, type SwarmState } from '../../swarmGameLogic';

/** Where a side's first hut stands, as a share of the board from the middle of the field. */
export interface Start {
  x: number;
  y: number;
}

/** `homes` are the huts the sides start from, in the map's order of them: the state's, which a draft can move off the map's. */
export function startsOf(map: SwarmMap, homes: readonly number[]): Partial<Record<Seat, Start>> {
  const centre = centreOf(map);
  const starts: Partial<Record<Seat, Start>> = {};
  map.sides.forEach((seat, index) => {
    const home = map.sites[homes[index]];
    starts[seat] = { x: (home.x - centre.x) / map.w, y: (home.y - centre.y) / map.h };
  });
  return starts;
}

// Measured on 2026-10-15 over every map for two, three and four sides, three
// seeds each: starts stand 0.38 to 0.44 of the board's width either side of
// the middle, and four sides' 0.34 to 0.39 of its height above or below it.
// Two sides' can be level with the middle or as far off it as 0.34, and on Two
// Bridges one stood near the top middle (0.08 across, 0.34 up).
//
// The close start pulls them in. Measured the same day over every map and
// size, seeds 1 to 20, four sides' close starts stand 0.08 to 0.46 across and
// 0.11 to 0.41 up or down, so two on the left are told apart by which of them
// is above the middle, and two at the top by which side of the middle they
// are, as near it as the score line tells (see columnOf). The draft can start
// a side anywhere, the middle too.
export function whereOf(start: Start): string {
  const across = start.x < -0.2 ? 'left' : start.x > 0.2 ? 'right' : '';
  const down = start.y < -0.3 ? 'top' : start.y > 0.3 ? 'bottom' : '';
  const side = start.x < -0.02 ? 'left' : start.x > 0.02 ? 'right' : '';
  const level = start.y < -0.02 ? 'above' : start.y > 0.02 ? 'below' : '';
  if (across && down) return `in the ${down} ${across} corner`;
  if (across) return Math.abs(start.y) < 0.1 ? `on the ${across}` : `on the ${across}, ${level} the middle`;
  if (down) return side ? `at the ${down}, ${side} of the middle` : `at the ${down}`;
  if (side && level) return `just ${level} and ${side} of the middle`;
  if (side) return `just ${side} of the middle`;
  if (level) return `just ${level} the middle`;
  return 'in the middle';
}

/**
 * What a side holds besides one hut of level 1, said under where it starts:
 * the scattered start and a nest of many give it more huts, a big nest a hut
 * of level 3, and the middle of three a few huts or towers. Null when one
 * hut of level 1 is all it holds.
 */
export function holdingOf(map: SwarmMap, state: SwarmState, seat: Seat): string | null {
  const held = map.sites.filter((_, at) => state.huts[at].owner === seat);
  const towers = held.filter((site) => site.tower).length;
  const huts = held.length - towers;
  const level = state.huts[state.homes[map.sides.indexOf(seat)]].level;
  if (huts === 1 && towers === 0) return level > 1 ? `Your hut is level ${level}` : null;
  const also = towers === 0 ? '' : ` and ${towers} ${towers === 1 ? 'tower' : 'towers'}`;
  return `You hold ${huts} ${huts === 1 ? 'hut' : 'huts'}${also}`;
}

/** Which part of the score line a side is shown in: the same side of it as its start is of the board. */
export function columnOf(start: Start): 'left' | 'middle' | 'right' {
  if (Math.abs(start.x) < 0.02) return 'middle';
  return start.x < 0 ? 'left' : 'right';
}
