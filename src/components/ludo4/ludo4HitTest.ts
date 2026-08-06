// Which counter a press on the board means.
//
// Its own module rather than part of Ludo4Board because it is not a component
// and not board geometry either — it works in screen pixels, off what the
// browser actually laid out. Same design as Ludo2's hit test; see that module
// for the full derivation of the nearest-centre approach.

/**
 * How far from a counter's centre a press still counts, as a multiple of the
 * counter's own width.
 *
 * A counter is TOKEN_PCT (3.25%) of the board and the ring puts its cells
 * 360/56° apart — 4.40% of the board between neighbouring centres. A target drawn as a
 * *box* therefore cannot grow much past the counter before two of them overlap
 * and the wrong one takes the press. Nearest-centre lifts that ceiling: overlap
 * stops being a problem when the counter whose centre is closest wins, so the
 * catchment can be opened past the piece and the boundary between two
 * neighbours lands exactly where it should — halfway between them.
 *
 * 0.85 of a counter's width as a radius makes the target 1.7× the piece across
 * while still not reaching a neighbouring cell's centre, so a press well away
 * from any playable piece still does nothing. Moves cannot be taken back; a
 * catchment that grabbed from across the board would be a worse bug than the
 * one it fixes.
 *
 * Kept in step with the `.tokenClickable::before` halo in Ludo4Game.module.css,
 * which is only there so the cursor turns to a hand over the area that actually
 * answers to it.
 */
export const HIT_RADIUS_FACTOR = 0.85;

/**
 * Which playable counter a press at (x, y) means, or null for none.
 *
 * `root` is any element containing the counters; playable ones carry
 * `data-token`. Works off each counter's rendered rect rather than board maths,
 * so it owes nothing to the plate's rotation, the popup's size or the counter's
 * hop animation — a circle turned about its own centre still has that centre in
 * the middle of its bounding box.
 */
export function pickNearestToken(root: HTMLElement, x: number, y: number): number | null {
  let bestIdx: number | null = null;
  let bestDist = Infinity;
  // The winner's own radius, not whichever counter the loop happened to end on.
  // Every counter is the same size today, so the two agree — but a catchment
  // measured against a different piece than the one it selects is a bug waiting
  // for the first counter that is drawn any other size.
  let bestRadius = 0;
  for (const el of root.querySelectorAll<HTMLElement>('[data-token]')) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const dx = x - (r.left + r.width / 2);
    const dy = y - (r.top + r.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist < bestDist) {
      bestDist = dist;
      bestRadius = r.width * HIT_RADIUS_FACTOR;
      bestIdx = Number(el.dataset.token);
    }
  }
  return bestIdx !== null && bestDist <= bestRadius ? bestIdx : null;
}
