// Swarm's orders as they are drawn: the ribbon a drag lays along the paths its
// units will walk, the same ribbon answering a release, and the fainter ones
// under every column of the player's that is still on its way.
//
// What is sent from several huts to one place runs together like streams: where
// two ways share a path they are one ribbon, as wide as what will walk it. The
// working out of that is here without a canvas, and the drawing is below it.

import { TOLL_EVERY, nextHop, pathLength, pathOf, sendSize, takesToll, type SceneId, type Seat, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { BADGE, controlOf, fontOf, pathPoint, siteRadius, siteTop, type Ctx } from './swarmSceneKit';
import type { View } from './swarmRender';

const TAU = Math.PI * 2;

export const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** An order to send, as it has to be known to draw it: who sends how many, where to, and whether by the paths that cost lives. */
export interface Sending {
  from: number[];
  /** How many each hut of `from` sends, in the same order. */
  n: number[];
  to: number;
  risky: boolean;
}

/** One path walked one way by `n` units. */
export interface Leg {
  from: number;
  to: number;
  n: number;
}

export interface Stretch extends Leg {
  /** How many of the `n` came in by other paths and were not sent from `from` itself. */
  joined: number;
  /** World units still to walk once `to` is reached. */
  left: number;
  /** The path is spikes or a ford. */
  toll: boolean;
}

/** The huts a column walks through from `from` to `to`, both included: none when no paths join them. */
export function routeOf(map: SwarmMap, from: number, to: number, risky: boolean): number[] {
  // No hop also covers a hut asked the way to itself.
  if (nextHop(map, from, to, risky) === -1) return [];
  const huts = [from];
  while (huts[huts.length - 1] !== to) huts.push(nextHop(map, huts[huts.length - 1], to, risky));
  return huts;
}

/**
 * The part of an order the engine will act on: it drops a send from a hut with
 * nothing to give or with no way to walk. Told the rest was sent, a player
 * waits for a column that never sets out.
 */
export function carriedOf(map: SwarmMap, order: Sending): Sending {
  const kept = order.from.map((_, index) => index).filter((index) => order.n[index] > 0 && nextHop(map, order.from[index], order.to, order.risky) !== -1);
  return { ...order, from: kept.map((index) => order.from[index]), n: kept.map((index) => order.n[index]) };
}

/**
 * Every path the order will be walked on, once each, with how many will walk it.
 * All of it is bound for one hut by one table of ways, so two columns that meet
 * stay together from there on: no hut has more than one stretch leading out.
 */
export function flowOf(map: SwarmMap, order: Sending): Stretch[] {
  const flow = new Map<number, Stretch>();
  order.from.forEach((source, index) => {
    const huts = routeOf(map, source, order.to, order.risky);
    let left = 0;
    for (let i = huts.length - 2; i >= 0; i--) {
      let stretch = flow.get(huts[i]);
      if (!stretch) {
        stretch = { from: huts[i], to: huts[i + 1], n: 0, joined: 0, left, toll: takesToll(pathOf(map, huts[i], huts[i + 1])!.kind) };
        flow.set(huts[i], stretch);
      }
      stretch.n += order.n[index];
      if (i > 0) stretch.joined += order.n[index];
      left += pathLength(map, huts[i], huts[i + 1]);
    }
  });
  return [...flow.values()];
}

/**
 * The paths `seat` has units still to walk: those waiting in a hut to leave, and
 * those on a path with more paths after it. The path a unit is on is left out,
 * since the unit is there to be seen.
 */
export function standingOf(map: SwarmMap, state: SwarmState, seat: Seat): Leg[] {
  const legs = new Map<number, Leg>();
  const add = (from: number, dest: number, risky: boolean | undefined, n: number) => {
    const huts = routeOf(map, from, dest, Boolean(risky));
    for (let i = 0; i < huts.length - 1; i++) {
      const key = huts[i] * 64 + huts[i + 1];
      const leg = legs.get(key);
      if (leg) leg.n += n;
      else legs.set(key, { from: huts[i], to: huts[i + 1], n });
    }
  };
  state.huts.forEach((hut, index) => {
    if (hut.owner !== seat) return;
    for (const queue of hut.out) add(index, queue.dest, queue.risky, queue.n);
  });
  for (const unit of state.units) {
    if (unit.seat === seat && unit.to !== unit.dest) add(unit.to, unit.dest, unit.risky, 1);
  }
  return [...legs.values()];
}

const RIBBON_MAX = 20;
/** A ribbon nothing will walk: the way is shown, and that it is empty. */
const RIBBON_EMPTY = 3;

/** How wide the ribbon under `n` units is, in world units. By the root, so a column of eighty is not sixteen times one of five. */
export function ribbonWidth(n: number): number {
  return n === 0 ? RIBBON_EMPTY : Math.min(RIBBON_MAX, 5 + Math.sqrt(n) * 1.5);
}

// --- The drawing ---

const SENT_MS = 320;
export const REFUSED_MS = 260;
/** A rest shorter than this share of the hold is a pointer passing by, and draws nothing. */
const HOLD_SHOWN = 0.25;

const RIM = 'rgba(255, 255, 255, 0.85)';
const INK = '#2b241a';
const PAPER = '#fbf7ee';
/** What an order is drawn on the ground in: ink where the ground is pale, chalk where it is dark, and the other of the two for what is drawn on the ribbon itself. */
const MARK: Record<SceneId, { line: string; cut: string }> = {
  meadow: { line: PAPER, cut: INK },
  valley: { line: PAPER, cut: INK },
  scrub: { line: INK, cut: PAPER },
  ice: { line: INK, cut: PAPER },
  terrace: { line: INK, cut: PAPER },
};

const SAMPLES = 14;
/** A ribbon that starts at its hut starts at this share of its width. */
const TAIL = 0.3;
/** The share of a path over which a ribbon comes to its full width. */
const SWELL = 0.45;
/** The head stops this far short of the hut it points at, clear of its door. */
const HEAD_BACK = 40;
/** And at least this far in CSS px from a hut a finger is on, so the head is not under the fingertip. */
const FINGER_CLEAR_PX = 44;
/** World units between two chevrons, and how many of them a chevron moves in a millisecond. */
const CHEVRON_GAP = 26;
const CHEVRON_PACE = 0.014;
/** The middle of spikes or a ford, as shares of its path: where the toll is taken, and where the ribbon is striped. */
const TOLL_FROM = 0.3;
const TOLL_TO = 0.7;

interface Ribbon {
  stretch: Stretch;
  length: number;
  /** Where along the path the ribbon ends, and where the point of its head is when it has one. */
  f1: number;
  tip: number;
  /** Per sample: x, y, the normal to the path, and half the ribbon's width. */
  pts: number[];
}

/** Everything the two layers of an order's drawing share for one frame. */
export interface Aim {
  order: Sending;
  ribbons: Ribbon[];
  /** 1 while it is being aimed; falling to 0 as a sent or refused order leaves the board. */
  fade: number;
  /** How far the pulse of a sent order has run, 0 to 1, or null when there is none. */
  pulse: number | null;
}

function headOf(stretch: Stretch): { length: number; half: number } {
  const width = ribbonWidth(stretch.n);
  return { length: 9 + width * 0.75, half: width * 0.5 + 5.5 };
}

function ribbonOf(map: SwarmMap, stretch: Stretch, target: number, back: number, sway: number): Ribbon {
  const length = pathLength(map, stretch.from, stretch.to);
  const tip = stretch.to === target ? Math.max(0.3, 1 - back / length) : 1;
  // A ribbon with a head ends in the notch at the back of it.
  const f1 = stretch.to === target && stretch.n > 0 ? tip - (headOf(stretch).length * 0.7) / length : tip;
  const w1 = ribbonWidth(stretch.n);
  const w0 = stretch.joined > 0 ? ribbonWidth(stretch.joined) : w1 * TAIL;
  const pts: number[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const f = (f1 * i) / SAMPLES;
    const p = pathPoint(map, stretch.from, stretch.to, f);
    const swell = Math.min(1, f / SWELL);
    const nx = -Math.sin(p.angle);
    const ny = Math.cos(p.angle);
    pts.push(p.x + nx * sway, p.y + ny * sway, nx, ny, (w0 + (w1 - w0) * swell * swell * (3 - 2 * swell)) / 2);
  }
  return { stretch, length, f1, tip, pts };
}

/**
 * The order to draw this frame: the one being aimed, or the one just sent or
 * just refused while its answer is still on the board. `px` is world units to a
 * CSS pixel, which is what a finger is measured in.
 */
export function aimOf(map: SwarmMap, state: SwarmState, view: View, px: number): Aim | null {
  let order: Sending | null = null;
  let fade = 1;
  let pulse: number | null = null;
  let sway = 0;
  let back = HEAD_BACK;
  const { drag } = view;
  if (drag) {
    if (drag.target === null) return null;
    const { target } = drag;
    const from = drag.sources.filter((hut) => hut !== target);
    order = { from, n: from.map((hut) => sendSize(state.huts[hut], view.sendAll ? 'all' : 'half')), to: target, risky: drag.risky };
    if (drag.finger) back = Math.max(HEAD_BACK, FINGER_CLEAR_PX * px);
  } else if (view.sent && view.now - view.sent.at < SENT_MS) {
    const t = (view.now - view.sent.at) / SENT_MS;
    order = view.sent.order;
    // The pulse is home while the ribbon is still whole, and only then does the ribbon go.
    pulse = Math.min(1, t / 0.7);
    fade = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
  } else if (view.refused?.order && view.now - view.refused.at < REFUSED_MS) {
    const t = (view.now - view.refused.at) / REFUSED_MS;
    // In step with the hut's count, which shakes its head for the same refusal.
    order = { ...view.refused.order, n: view.refused.order.n.map(() => 0) };
    sway = Math.sin(t * Math.PI * 5) * 4 * (1 - t);
    fade = 1 - t;
  }
  if (!order) return null;
  const { to } = order;
  const ribbons = flowOf(map, order).map((stretch) => ribbonOf(map, stretch, to, back, sway));
  return ribbons.length > 0 ? { order, ribbons, fade, pulse } : null;
}

function traceRibbon(ctx: Ctx, ribbon: Ribbon, grow: number, i0 = 0, i1 = SAMPLES) {
  const { pts } = ribbon;
  for (let i = i0; i <= i1; i++) {
    const k = i * 5;
    const half = pts[k + 4] + grow;
    if (i === i0) ctx.moveTo(pts[k] + pts[k + 2] * half, pts[k + 1] + pts[k + 3] * half);
    else ctx.lineTo(pts[k] + pts[k + 2] * half, pts[k + 1] + pts[k + 3] * half);
  }
  for (let i = i1; i >= i0; i--) {
    const k = i * 5;
    const half = pts[k + 4] + grow;
    ctx.lineTo(pts[k] - pts[k + 2] * half, pts[k + 1] - pts[k + 3] * half);
  }
  ctx.closePath();
}

function fillRibbons(ctx: Ctx, ribbons: Ribbon[], grow: number, empty: boolean) {
  ctx.beginPath();
  for (const ribbon of ribbons) {
    if ((ribbon.stretch.n === 0) === empty) traceRibbon(ctx, ribbon, grow);
  }
  ctx.fill();
}

/** Chevrons a fixed way apart all the way to the target, counted from it, so they run on unbroken from one path into the next. */
function traceChevrons(ctx: Ctx, map: SwarmMap, ribbon: Ribbon, now: number) {
  const { stretch, length, f1, pts } = ribbon;
  if (stretch.n === 0) return;
  const moved = (now * CHEVRON_PACE) % CHEVRON_GAP;
  const nearest = stretch.left + (1 - f1) * length + 5;
  for (let left = Math.ceil((nearest + moved) / CHEVRON_GAP) * CHEVRON_GAP - moved; left <= stretch.left + length; left += CHEVRON_GAP) {
    const f = 1 - (left - stretch.left) / length;
    if (stretch.toll && f > TOLL_FROM - 0.04 && f < TOLL_TO + 0.04) continue;
    const half = pts[Math.round((f / f1) * SAMPLES) * 5 + 4] * 0.58;
    // Too thin to carry one: the tail of a ribbon by its own hut.
    if (half < 1.6) continue;
    const p = pathPoint(map, stretch.from, stretch.to, f);
    const dx = Math.cos(p.angle) * half * 0.55;
    const dy = Math.sin(p.angle) * half * 0.55;
    const nx = -Math.sin(p.angle) * half;
    const ny = Math.cos(p.angle) * half;
    ctx.moveTo(p.x - dx + nx, p.y - dy + ny);
    ctx.lineTo(p.x + dx, p.y + dy);
    ctx.lineTo(p.x - dx - nx, p.y - dy - ny);
  }
}

/** Bars across the ribbon where the path takes its toll, which no other stretch has: seen without telling one colour from another. */
function traceToll(ctx: Ctx, ribbon: Ribbon) {
  const { pts } = ribbon;
  for (let i = Math.ceil(TOLL_FROM * SAMPLES); i < TOLL_TO * SAMPLES; i++) {
    const k = i * 5;
    const next = k + 5;
    ctx.moveTo(pts[k] + pts[k + 2] * pts[k + 4], pts[k + 1] + pts[k + 3] * pts[k + 4]);
    ctx.lineTo(pts[next] - pts[next + 2] * pts[next + 4], pts[next + 1] - pts[next + 3] * pts[next + 4]);
  }
}

/** The stretch of a ribbon the pulse of a sent order is on. The pulse is measured in what is left to walk, so it reaches the far hut and the near one at their own times and the target last. */
function tracePulse(ctx: Ctx, ribbon: Ribbon, lead: number, tail: number) {
  const { stretch, length, f1 } = ribbon;
  const leftAt = (i: number) => stretch.left + (1 - (f1 * i) / SAMPLES) * length;
  let i0 = 0;
  let i1 = SAMPLES;
  while (i0 < SAMPLES && leftAt(i0) > tail) i0++;
  while (i1 > 0 && leftAt(i1) < lead) i1--;
  if (i1 > i0) traceRibbon(ctx, ribbon, 0, i0, i1);
}

const RING_GAP = 0.34;

/** A thin ring drawn on the ground round a hut. One in `parts` is broken at the four points of the compass, which is how a hut to be attacked is told from any other. */
function groundRing(ctx: Ctx, x: number, y: number, r: number, parts: 1 | 4) {
  const rx = r * 1.3;
  const ry = r * 0.5;
  ctx.beginPath();
  for (let part = 0; part < parts; part++) {
    const a0 = parts === 1 ? 0 : (part / parts) * TAU + RING_GAP;
    const a1 = parts === 1 ? TAU : ((part + 1) / parts) * TAU - RING_GAP;
    ctx.moveTo(x + rx * Math.cos(a0), y + 2 + ry * Math.sin(a0));
    ctx.ellipse(x, y + 2, rx, ry, 0, a0, a1);
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = parts === 1 ? 1.6 : 2.4;
  ctx.stroke();
}

/** A line from a hut to the pointer while the drag has found no hut to send to: it says which huts are in hand and promises no route. */
function leash(ctx: Ctx, x0: number, y0: number, x1: number, y1: number) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  ctx.setLineDash([5, 6]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/**
 * What lies on the ground, under the huts and the units: the columns still to
 * walk, the huts in hand, the hut aimed at, and the ribbon of the order itself.
 */
export function drawAimUnder(ctx: Ctx, map: SwarmMap, state: SwarmState, view: View, standing: Leg[], aim: Aim | null) {
  const mark = MARK[map.scene];
  const radius = (hut: number) => siteRadius(map.sites[hut], state.huts[hut].level);
  const ring = (hut: number, parts: 1 | 4) => groundRing(ctx, map.sites[hut].x, map.sites[hut].y, radius(hut), parts);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = mark.line;
  ctx.fillStyle = mark.line;

  // Fainter than an order being aimed and the same hand, so a board full of marches does not talk over the one being given.
  ctx.lineCap = 'butt';
  for (const leg of standing) {
    const from = map.sites[leg.from];
    const to = map.sites[leg.to];
    const c = controlOf(map, leg.from, leg.to);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo(c.x, c.y, to.x, to.y);
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = ribbonWidth(leg.n) * 0.4;
    ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, CHEVRON_GAP - 4]);
    ctx.lineDashOffset = -((view.now * CHEVRON_PACE) % CHEVRON_GAP);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const { drag } = view;
  // Until it has moved, a press is aimed at its own hut, which is then only in hand.
  const target = drag && drag.target !== null && !(drag.sources.length === 1 && drag.sources[0] === drag.target) ? drag.target : null;
  if (drag) {
    for (const hut of drag.sources) {
      if (hut === target) continue;
      ctx.globalAlpha = 0.55;
      if (drag.target === null) leash(ctx, map.sites[hut].x, map.sites[hut].y, drag.x, drag.y);
      else if (target !== null && routeOf(map, hut, target, drag.risky).length === 0) {
        // A hut no path joins to the target: the order would do nothing there.
        ctx.globalAlpha = 0.25;
        leash(ctx, map.sites[hut].x, map.sites[hut].y, map.sites[target].x, map.sites[target].y);
      }
    }
  }

  if (aim) {
    const { ribbons } = aim;
    // A wash a little wider than the stroke under it, which is what softens the edge of a mark made on the ground.
    ctx.globalAlpha = aim.fade * 0.12;
    fillRibbons(ctx, ribbons, 1.6, false);
    ctx.globalAlpha = aim.fade * 0.46;
    fillRibbons(ctx, ribbons, 0, false);
    ctx.globalAlpha = aim.fade * 0.32;
    fillRibbons(ctx, ribbons, 0, true);
    if (aim.pulse !== null) {
      // The order going: the ribbon darkens from the huts that send to the hut sent to, once.
      let reach = 0;
      for (const ribbon of ribbons) reach = Math.max(reach, ribbon.stretch.left + ribbon.length);
      const lead = reach * (1 - easeOut(aim.pulse));
      ctx.globalAlpha = aim.fade * 0.3;
      ctx.beginPath();
      for (const ribbon of ribbons) {
        if (ribbon.stretch.n > 0) tracePulse(ctx, ribbon, lead, lead + reach * 0.22);
      }
      ctx.fill();
    }
    ctx.strokeStyle = mark.cut;
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = aim.fade * 0.6;
    ctx.beginPath();
    for (const ribbon of ribbons) {
      if (ribbon.stretch.toll && ribbon.stretch.n > 0) traceToll(ctx, ribbon);
    }
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = aim.fade * 0.5;
    ctx.beginPath();
    for (const ribbon of ribbons) traceChevrons(ctx, map, ribbon, view.now);
    ctx.stroke();
    ctx.strokeStyle = mark.line;
    ctx.globalAlpha = aim.fade * 0.7;
    // A hut in the way that is not the player's is fought for like the one aimed at.
    for (const ribbon of ribbons) {
      const { to } = ribbon.stretch;
      if (to !== aim.order.to && state.huts[to].owner !== view.seat) ring(to, 4);
    }
    if (!drag) {
      for (const hut of aim.order.from) ring(hut, 1);
    }
  }

  ctx.globalAlpha = 0.7;
  if (drag) {
    for (const hut of drag.sources) {
      if (hut !== target) ring(hut, 1);
    }
  } else if (view.selected !== null) {
    ring(view.selected, 1);
  }
  if (target !== null) {
    ring(target, state.huts[target].owner === view.seat ? 1 : 4);
    if (view.hold > HOLD_SHOWN) {
      // The one line in the player's colour: it closes round the target as the rest turns half into all.
      const site = map.sites[target];
      const r = radius(target);
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = BADGE[view.seat].fill;
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.ellipse(site.x, site.y + 2, r * 1.3, r * 0.5, 0, -Math.PI / 2, -Math.PI / 2 + TAU * ((view.hold - HOLD_SHOWN) / (1 - HOLD_SHOWN)));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function pillWidth(ctx: Ctx, text: string, size: number): number {
  return Math.max(size * 2, ctx.measureText(text).width + size * 1.1);
}

/** A count on a rounded plate, from its left edge. The font is set by the caller, who has measured with it. */
function pill(ctx: Ctx, left: number, y: number, width: number, text: string, tone: { fill: string; text: string }, size: number) {
  const height = size * 1.5;
  ctx.fillStyle = 'rgba(20, 16, 10, 0.4)';
  ctx.beginPath();
  ctx.roundRect(left, y - height / 2 + size * 0.12, width, height, height / 2);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(left, y - height / 2, width, height, height / 2);
  ctx.strokeStyle = RIM;
  ctx.lineWidth = size * 0.14;
  ctx.stroke();
  ctx.fillStyle = tone.fill;
  ctx.fill();
  ctx.fillStyle = tone.text;
  ctx.fillText(text, left + width / 2, y + size * 0.04);
}

/** How far over a hut's roof the readout stands: clear of the hut's own count, which is there already. */
const READOUT_RISE = 60;
/** How far in CSS px the readout is kept from the middle of a fingertip, and how tall its figures are made for a board held in a hand. */
const READOUT_CLEAR_PX = 58;
const READOUT_FINGER_PX = 13;
/** The least height in CSS px of the figures under a mouse: the toll and each hut's share, and the readout over the target. */
const LABEL_MIN_PX = 9;
const READOUT_MIN_PX = 11;

/**
 * What stands over everything: the head of each ribbon where it reaches its
 * hut, how many each hut sends, the toll on a way that takes one, and over the
 * target how many are sent against how many hold it.
 */
export function drawAimOver(ctx: Ctx, map: SwarmMap, state: SwarmState, view: View, aim: Aim, px: number) {
  const tone = BADGE[view.seat];
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = aim.fade;

  for (const ribbon of aim.ribbons) {
    const { stretch } = ribbon;
    if (stretch.to !== aim.order.to || stretch.n === 0) continue;
    const head = headOf(stretch);
    const p = pathPoint(map, stretch.from, stretch.to, ribbon.tip);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-head.length, head.half);
    ctx.lineTo(-head.length * 0.7, 0);
    ctx.lineTo(-head.length, -head.half);
    ctx.closePath();
    // The head is the one part of the ribbon in the player's colour, edged in the ribbon's own.
    ctx.strokeStyle = MARK[map.scene].line;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = tone.fill;
    ctx.fill();
    ctx.restore();
  }

  const tollSize = Math.max(10, LABEL_MIN_PX * px);
  ctx.font = fontOf(700, tollSize);
  for (const ribbon of aim.ribbons) {
    const { stretch } = ribbon;
    if (!stretch.toll || stretch.n === 0) continue;
    const p = pathPoint(map, stretch.from, stretch.to, 0.5);
    // On the side of the path that is up the board, where a hand reaching in from below does not cover it.
    const side = Math.cos(p.angle) > 0 ? -1 : 1;
    const text = `1 in ${TOLL_EVERY} lost`;
    const width = pillWidth(ctx, text, tollSize);
    pill(ctx, p.x - Math.sin(p.angle) * side * 22 - width / 2, p.y + Math.cos(p.angle) * side * 22, width, text, { fill: INK, text: PAPER }, tollSize);
  }

  const { drag } = view;
  if (!drag) {
    ctx.restore();
    return;
  }

  const shareSize = Math.max(11, LABEL_MIN_PX * px);
  ctx.font = fontOf(700, shareSize);
  let total = 0;
  aim.order.from.forEach((hut, index) => {
    const n = aim.order.n[index];
    total += n;
    const ribbon = aim.ribbons.find((r) => r.stretch.from === hut);
    if (n === 0 || !ribbon) return;
    // Just outside its own door, on the path it leaves by.
    const p = pathPoint(map, hut, ribbon.stretch.to, Math.min(0.45, (siteRadius(map.sites[hut], state.huts[hut].level) + 26) / ribbon.length));
    const text = String(n);
    const width = pillWidth(ctx, text, shareSize);
    pill(ctx, p.x - width / 2, p.y, width, text, tone, shareSize);
  });

  if (total > 0) {
    const site = map.sites[aim.order.to];
    const hut = state.huts[aim.order.to];
    // A finger covers the hut it is on and some way round it, so there the readout is lifted clear and drawn at a size a held phone can be read at.
    const size = Math.max(13, (drag.finger ? READOUT_FINGER_PX : READOUT_MIN_PX) * px);
    let x = site.x;
    let y = site.y - siteTop(site, hut.level) - READOUT_RISE;
    if (drag.finger) y = Math.min(y, drag.y - READOUT_CLEAR_PX * px);
    if (y < size) {
      // No room over it: beside it, on the side with more of the board.
      y = size;
      x += (site.x < map.w / 2 ? 1 : -1) * (drag.finger ? READOUT_CLEAR_PX * px + size * 2 : siteRadius(site, hut.level) + 34);
    }
    ctx.font = fontOf(700, size);
    const own = hut.owner === view.seat;
    const sent = own ? `+${total}` : String(total);
    const sentWidth = pillWidth(ctx, sent, size);
    // Against a hut that is not the player's, the two numbers and no verdict: what is held breeds on, a fort's defenders die twice, and towers and tolls thin a column on its way.
    const held = String(hut.n);
    const heldWidth = own ? 0 : pillWidth(ctx, held, size) + size * 0.2;
    const left = Math.min(Math.max(x - (sentWidth + heldWidth) / 2, 4), map.w - 4 - sentWidth - heldWidth);
    pill(ctx, left, y, sentWidth, sent, tone, size);
    if (!own) pill(ctx, left + sentWidth + size * 0.2, y, heldWidth - size * 0.2, held, BADGE[hut.owner ?? 'none'], size);
  }
  ctx.restore();
}
