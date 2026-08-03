// Which counter a press on the board means.
//
// Its own module rather than part of Ludo2Board because it is not a component
// and not board geometry either — it works in screen pixels, off what the
// browser actually laid out.

/**
 * How far from a counter's centre a press still counts, as a multiple of the
 * counter's own width.
 *
 * A counter is TOKEN_PCT (4.1%) of the board and the ring puts its cells 360/42°
 * apart — 5.86% of the board between neighbouring centres. So a target drawn as
 * a *box* cannot be made bigger than about 1.4× the counter without two of them
 * overlapping and the wrong one taking the press: on a 600px board that is a
 * 34px target, under every touch-target guideline there is, and players could
 * not reliably press their own pieces.
 *
 * Nearest-centre lifts that ceiling. Overlap stops being a problem when the
 * counter whose centre is closest wins, so the catchment can be opened past the
 * piece and the boundary between two neighbours lands exactly where it should —
 * halfway between them.
 *
 * 0.85 of a counter's width as a radius makes the target 1.7× the piece across —
 * a little over 40px where it used to be 29 — while still not reaching a
 * neighbouring cell's centre, so a press well away from any playable piece still
 * does nothing. Moves cannot be taken back; a catchment that grabbed from across
 * the board would be a worse bug than the one it fixes.
 *
 * Kept in step with the `.tokenClickable::before` halo in Ludo2Game.module.css,
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
