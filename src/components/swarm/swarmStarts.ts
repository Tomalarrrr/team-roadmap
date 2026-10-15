// Where each side starts, in the words and the places the game shows it: the
// countdown says where to look for your first hut, and the score line puts
// each side on the same side of it as it is of the board.

import { centreOf, type Seat, type SwarmMap } from '../../swarmGameLogic';

/** Where a side's first hut stands, as a share of the board from the middle of the field. */
export interface Start {
  x: number;
  y: number;
}

export function startsOf(map: SwarmMap): Partial<Record<Seat, Start>> {
  const centre = centreOf(map);
  const starts: Partial<Record<Seat, Start>> = {};
  map.sides.forEach((seat, index) => {
    const home = map.sites[map.homes[index]];
    starts[seat] = { x: (home.x - centre.x) / map.w, y: (home.y - centre.y) / map.h };
  });
  return starts;
}

// Measured on 2026-10-15 over every map for two, three and four sides, three
// seeds each: starts stand 0.38 to 0.44 of the board's width either side of
// the middle, and four sides' 0.34 to 0.39 of its height above or below it.
// Two sides' can be level with the middle or as far off it as 0.34, and on Two
// Bridges one stood near the top middle (0.08 across, 0.34 up).
export function whereOf(start: Start): string {
  const across = start.x < -0.2 ? 'left' : start.x > 0.2 ? 'right' : '';
  const down = start.y < -0.3 ? 'top' : start.y > 0.3 ? 'bottom' : '';
  if (across && down) return `in the ${down} ${across} corner`;
  if (across) return `on the ${across}`;
  if (down) return `at the ${down}`;
  return 'in the middle';
}

/** Which part of the score line a side is shown in: the same side of it as its start is of the board. */
export function columnOf(start: Start): 'left' | 'middle' | 'right' {
  if (Math.abs(start.x) < 0.02) return 'middle';
  return start.x < 0 ? 'left' : 'right';
}
