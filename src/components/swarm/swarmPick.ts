// Which hut a press or a drag on the board means.
//
// Its own module, like the Ludo hit tests, because it is neither drawing nor
// rules: it turns a pointer into an intention. Everything here is in world
// units; the one thing taken from the screen is how wide the board was laid out.

interface Point {
  x: number;
  y: number;
}

/** The smallest thing a finger can be asked to hit, across, in CSS px. */
export const MIN_TARGET_PX = 44;

/**
 * How far from a centre a press still counts, in world units. A world is as
 * many units wide as its map says however small it is drawn, so with 1000 of
 * them on a phone a 44px target is some 65 units across each way and on a
 * desktop about 22.
 */
export function reachOf(boardWidthPx: number, worldWidth: number): number {
  return ((MIN_TARGET_PX / 2) * worldWidth) / boardWidthPx;
}

/** The point nearest to x, y that is no further than `reach` from it. `skip` is never the answer. */
export function nearest(points: Point[], x: number, y: number, reach: number, skip: number | null): number | null {
  let best: number | null = null;
  let bestD = reach;
  points.forEach((point, index) => {
    const d = Math.hypot(point.x - x, point.y - y);
    if (index !== skip && d <= bestD) {
      best = index;
      bestD = d;
    }
  });
  return best;
}

/**
 * How near a dragged pointer has to come to a hut for the arrow to jump to it.
 * Under half the 150 units the map keeps between any two huts, so two huts'
 * pulls only overlap where a small board widens them to a finger's reach.
 */
export const MAGNET = 70;
/** A hut that has the arrow keeps it out to this many times the pull. */
const RELEASE = 1.35;
/** Inside that, another hut takes the arrow only by being this much nearer. */
const SWITCH = 0.7;

/**
 * The hut a drag is aimed at, given the one it was aimed at a moment ago.
 *
 * `over` is the hut whose picture is under the pointer, which is a bigger and
 * taller shape than a circle round its site. Without the memory, a pointer on
 * the line between two neighbours would flick the arrow from one to the other
 * with every pixel of wobble.
 */
export function latch(
  sites: Point[],
  held: number | null,
  over: number | null,
  x: number,
  y: number,
  reach: number,
  skip: number | null
): number | null {
  const pull = Math.max(MAGNET, reach);
  const near = over !== null && over !== skip ? over : nearest(sites, x, y, pull, skip);
  if (held === null || held === skip || near === held) return near;
  const d = (hut: number) => Math.hypot(sites[hut].x - x, sites[hut].y - y);
  if (d(held) > pull * RELEASE) return near;
  if (near !== null && d(near) < d(held) * SWITCH) return near;
  return held;
}
