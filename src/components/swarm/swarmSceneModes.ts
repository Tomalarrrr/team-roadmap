// What a mode or twist puts on the board over the huts: the crown on the hill
// with each side's time on it, each side's queen, the idle huts of a side
// that has lost hers, the bounty on the leader's huts, the egg where it lies
// or on the unit carrying it, and the ring round a golden hut.
//
// All of it is read from the state each frame, and none of it moves on its
// own: it marks what the rules are counting, nothing more.

import { TICK_MS, middleOf, paceOn, pathLength, queenlessOf, type Site, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { BADGE, ellipse, fontOf, growOf, pathPoint, siteRadius } from './swarmSceneKit';

const INK = 'rgba(28, 22, 14, 0.86)';
const GOLD = '#d9a521';
const EGG = '#f1e8d2';
const EGG_LINE = '#4a3a22';

/** The least size, in CSS px, a chip's figures are drawn at, as with the counts over the huts. */
const CHIP_MIN_PX = 9;

/** A crown of three points, `s` wide, standing on x, y. */
function crownPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const h = s * 0.7;
  ctx.beginPath();
  ctx.moveTo(x - s / 2, y);
  ctx.lineTo(x - s / 2, y - h);
  ctx.lineTo(x - s / 4, y - h * 0.45);
  ctx.lineTo(x, y - h);
  ctx.lineTo(x + s / 4, y - h * 0.45);
  ctx.lineTo(x + s / 2, y - h);
  ctx.lineTo(x + s / 2, y);
  ctx.closePath();
}

/** An egg `s` tall, its middle at x, y, wider below than above. */
function egg(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  const w = s * 0.38;
  ctx.beginPath();
  ctx.moveTo(x, y - s / 2);
  ctx.bezierCurveTo(x + w, y - s / 2, x + w * 1.25, y + s * 0.42, x, y + s / 2);
  ctx.bezierCurveTo(x - w * 1.25, y + s * 0.42, x - w, y - s / 2, x, y - s / 2);
  ctx.fillStyle = EGG;
  ctx.fill();
  ctx.strokeStyle = EGG_LINE;
  ctx.lineWidth = s * 0.1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(120, 96, 60, 0.75)';
  ellipse(ctx, x - w * 0.3, y + s * 0.08, s * 0.07, s * 0.06);
  ctx.fill();
  ellipse(ctx, x + w * 0.35, y - s * 0.12, s * 0.05, s * 0.05);
  ctx.fill();
}

interface Chip {
  text: string;
  fill: string;
  ink: string;
  crown?: string;
}

/** A row of chips centred under a hut's foot, each a figure, a crown or both. */
function chipRow(ctx: CanvasRenderingContext2D, map: SwarmMap, site: Site, level: number, chips: Chip[], g: number) {
  const tall = 14 * g;
  const gap = 3 * g;
  ctx.font = fontOf(700, 11 * g);
  const widths = chips.map((chip) => (chip.text ? ctx.measureText(chip.text).width + 8 * g : 0) + (chip.crown ? 14 * g : 0) + (chip.text && chip.crown ? -2 * g : 0));
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (chips.length - 1);
  // Under the foot, unless that runs off the bottom of the board, when it goes over the badge's side of the hut instead.
  const below = site.y + siteRadius(site, level) * 0.45 + 4 * g;
  const top = below + tall > map.h ? site.y - siteRadius(site, level) * 0.45 - tall - 4 * g : below;
  let x = site.x - total / 2;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  chips.forEach((chip, k) => {
    ctx.beginPath();
    ctx.roundRect(x, top, widths[k], tall, 4 * g);
    ctx.fillStyle = chip.fill;
    ctx.fill();
    let at = x + 4 * g;
    if (chip.crown) {
      crownPath(ctx, at + 5 * g, top + tall * 0.78, 10 * g);
      ctx.fillStyle = chip.crown;
      ctx.fill();
      at += 12 * g;
    }
    if (chip.text) {
      ctx.fillStyle = chip.ink;
      ctx.fillText(chip.text, at, top + tall / 2 + 0.5 * g);
    }
    x += widths[k] + gap;
  });
}

export function drawModes(ctx: CanvasRenderingContext2D, map: SwarmMap, state: SwarmState, alpha: number, px: number): void {
  const { mode, twists } = map.rules;
  const g = growOf(11, CHIP_MIN_PX, px);
  const rows = new Map<number, Chip[]>();
  const add = (at: number, chip: Chip) => rows.set(at, [...(rows.get(at) ?? []), chip]);

  if (twists.includes('golden')) {
    for (const [at, hut] of state.huts.entries()) {
      if (!hut.gold) continue;
      const site = map.sites[at];
      const r = siteRadius(site, hut.level);
      ctx.strokeStyle = 'rgba(217, 165, 33, 0.28)';
      ctx.lineWidth = 7;
      ellipse(ctx, site.x, site.y, r * 1.12, r * 0.48);
      ctx.stroke();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 2.2;
      ellipse(ctx, site.x, site.y, r * 1.12, r * 0.48);
      ctx.stroke();
    }
  }

  if (twists.includes('queens')) {
    const idle = queenlessOf(map, state);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(60, 58, 52, 0.8)';
    ctx.lineWidth = 2;
    for (const [at, hut] of state.huts.entries()) {
      if (!hut.owner || !idle.includes(hut.owner) || map.sites[at].tower) continue;
      const site = map.sites[at];
      const r = siteRadius(site, hut.level);
      ellipse(ctx, site.x, site.y, r * 1.05, r * 0.44);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  if (mode === 'hill') {
    const crown = middleOf(map);
    const holder = state.huts[crown].owner;
    add(crown, { text: '', fill: holder ? BADGE[holder].fill : BADGE.none.fill, ink: '', crown: GOLD });
    for (const seat of map.sides) {
      add(crown, { text: `${Math.floor((state.held[seat] * TICK_MS) / 1000)}s`, fill: BADGE[seat].fill, ink: BADGE[seat].text });
    }
  }

  if (mode === 'regicide' || twists.includes('queens')) {
    map.sides.forEach((seat, k) => {
      const home = map.homes[k];
      if (state.huts[home].owner === seat) add(home, { text: '', fill: BADGE[seat].fill, ink: '', crown: BADGE[seat].text });
    });
  }

  if (mode === 'bounty' && state.leader) {
    for (const [at, hut] of state.huts.entries()) {
      if (hut.owner === state.leader && !map.sites[at].tower) add(at, { text: `+${state.bounty}`, fill: INK, ink: '#ffffff' });
    }
  }

  for (const [at, chips] of rows) chipRow(ctx, map, map.sites[at], state.huts[at].level, chips, g);

  if (mode === 'egg') {
    const size = 11 * growOf(11, 8, px);
    if (state.egg >= 0) {
      const site = map.sites[state.egg];
      const r = siteRadius(site, state.huts[state.egg].level);
      egg(ctx, site.x + r * 0.72, site.y - size * 0.3, size);
    }
    const carrier = state.units.find((unit) => unit.egg);
    if (carrier) {
      const length = pathLength(map, carrier.from, carrier.to);
      // A carrier walks at half pace, so it is drawn on at half the rate between ticks too.
      const d = Math.min(length, carrier.d + (paceOn(map, carrier.from, carrier.to, state.army[carrier.seat].speed) >> 1) * alpha);
      const p = pathPoint(map, carrier.from, carrier.to, d / length);
      egg(ctx, p.x, p.y - size * 0.9, size);
    }
  }
}
