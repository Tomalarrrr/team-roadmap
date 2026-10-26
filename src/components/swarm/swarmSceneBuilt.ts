// The buildings twist, burning bridges and the warren's tunnels, as drawn.
// The engine keeps one state for every side. What a side cannot see here,
// a column underground or a trap, is hidden from the eye and nothing else.

import { BURN_FUSE, CLOSED_FOREVER, pathLength, pathOf, type Building, type Seat, type SwarmEvent, type SwarmMap, type SwarmState, type Unit } from '../../swarmGameLogic';
import { TUNNEL_MOUTH } from './swarmSceneGround';
import { BADGE, PALETTE, PATH_W, crossingsOf, ellipse, fontOf, growOf, pathPoint, siteRadius, type Crossing, type Ctx, type River } from './swarmSceneKit';

/** Of a tunnel's length, the last share over which the other sides see a column coming up. */
export const SURFACE = 0.15;
/** How solid a side's own column looks while it is underground. */
const OWN_UNDER = 0.4;
/** Of a tunnel's length, how far the head of a column has come before its exit starts to glow. */
const GLOW_FROM = 0.6;
/** How long the count over a sprung trap stays up, and the puff over a bridge that went down or was put out. */
const SPRUNG_MS = 2600;
const FLARE_MS = 4000;
/** How long the line under a building stays up after the viewer first takes one of its kind. */
const TELL_MS = 5000;

const INK = '#2b241a';

export interface Built {
  /** Each bridge's crossing, worked out once: it takes a walk along every path to find. */
  crossings: Crossing[];
  sprung: { hut: number; dead: number; at: number }[];
  flares: { path: number; kind: 'burn' | 'doused'; at: number }[];
  /** The kinds the viewer has taken one of, and the last one taken while it is being explained. */
  told: Set<Building>;
  telling: { hut: number; at: number } | null;
}

export function newBuilt(map: SwarmMap, rivers: River[]): Built {
  return { crossings: crossingsOf(map, rivers).filter((crossing) => crossing.path.kind === 'bridge'), sprung: [], flares: [], told: new Set(), telling: null };
}

export function builtEvents(built: Built, state: SwarmState, events: SwarmEvent[], now: number, seat: Seat): void {
  for (const event of events) {
    if (event.kind === 'trap') built.sprung.push({ hut: event.hut, dead: event.dead, at: now });
    else if (event.kind === 'burn' || event.kind === 'doused') built.flares.push({ path: event.path, kind: event.kind, at: now });
    else if (event.kind === 'capture' && event.seat === seat) {
      const building = state.huts[event.hut].building;
      if (building && !built.told.has(building)) {
        built.told.add(building);
        built.telling = { hut: event.hut, at: now };
      }
    }
  }
  built.sprung = built.sprung.filter((sprung) => now - sprung.at < SPRUNG_MS);
  built.flares = built.flares.filter((flare) => now - flare.at < FLARE_MS);
}

/**
 * How much of a unit at `d` along its path is seen from `seat`'s side of the
 * board: all of it on anything but a tunnel. Underground its own side sees it
 * faintly, and the others see nothing until the last SURFACE of the way,
 * where it comes up into view by the time it reaches the hole.
 */
export function tunnelSight(map: SwarmMap, unit: Unit, d: number, length: number, seat: Seat): number {
  if (pathOf(map, unit.from, unit.to)!.kind !== 'tunnel') return 1;
  if (unit.seat === seat) {
    const under = Math.min(d - TUNNEL_MOUTH, length - TUNNEL_MOUTH - d);
    return 1 - (1 - OWN_UNDER) * Math.min(1, Math.max(0, under / 8));
  }
  const up = length * (1 - SURFACE);
  return Math.min(1, Math.max(0, (d - up) / (length - TUNNEL_MOUTH - up)));
}

/**
 * What the other sides are told of a column underground: that one is in this
 * tunnel and which way, and nothing of how many. A dotted line runs along the
 * seam towards the hole it will come out of, and that hole starts to glow once
 * the head of the column is most of the way there.
 */
function drawBurrows(ctx: Ctx, map: SwarmMap, state: SwarmState, seat: Seat, now: number) {
  map.paths.forEach((path) => {
    if (path.kind !== 'tunnel') return;
    const length = pathLength(map, path.a, path.b);
    for (const [from, to] of [[path.a, path.b], [path.b, path.a]]) {
      let lead = -1;
      let side: Seat | null = null;
      for (const unit of state.units) {
        if (unit.from !== from || unit.to !== to || unit.seat === seat) continue;
        const f = unit.d / length;
        if (f < 1 - SURFACE && f > lead) {
          lead = f;
          side = unit.seat;
        }
      }
      if (side === null) continue;
      const mouth = TUNNEL_MOUTH / length;
      ctx.save();
      ctx.strokeStyle = BADGE[side].fill;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.setLineDash([0.1, 9]);
      // The dots creep the way the column is going.
      ctx.lineDashOffset = -(now * 0.012) % 9.1;
      ctx.beginPath();
      for (let i = 0; i <= 32; i++) {
        const p = pathPoint(map, from, to, mouth + ((1 - 2 * mouth) * i) / 32);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.restore();
      if (lead < GLOW_FROM) continue;
      const exit = pathPoint(map, from, to, 1 - mouth);
      const strength = Math.min(1, (lead - GLOW_FROM) / (1 - SURFACE - GLOW_FROM)) * (0.85 + 0.15 * Math.sin(now * 0.008));
      const glow = ctx.createRadialGradient(exit.x, exit.y, 0, exit.x, exit.y, 18);
      glow.addColorStop(0, `rgba(255, 232, 178, ${0.55 * strength})`);
      glow.addColorStop(1, 'rgba(255, 232, 178, 0)');
      ctx.fillStyle = glow;
      ellipse(ctx, exit.x, exit.y, 18, 11);
      ctx.fill();
    }
  });
}

/** A bridge's deck, as the ground painted it: centred on the crossing and turned along the path from `a` to `b`, with its length and half its width. */
function deckOf(map: SwarmMap, crossing: Crossing) {
  const { path } = crossing;
  const mid = pathPoint(map, path.a, path.b, (crossing.f0 + crossing.f1) / 2);
  return { mid, span: Math.max(50, (crossing.f1 - crossing.f0) * pathLength(map, path.a, path.b) + 22), half: PATH_W.bridge / 2 + 1 };
}

function flame(ctx: Ctx, x: number, y: number, h: number, sway: number) {
  ctx.fillStyle = 'rgba(232, 118, 46, 0.9)';
  ctx.beginPath();
  ctx.moveTo(x - h * 0.32, y);
  ctx.quadraticCurveTo(x - h * 0.4, y - h * 0.55, x + sway, y - h);
  ctx.quadraticCurveTo(x + h * 0.4, y - h * 0.55, x + h * 0.32, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(250, 206, 112, 0.95)';
  ctx.beginPath();
  ctx.moveTo(x - h * 0.16, y);
  ctx.quadraticCurveTo(x - h * 0.2, y - h * 0.35, x + sway * 0.6, y - h * 0.6);
  ctx.quadraticCurveTo(x + h * 0.2, y - h * 0.35, x + h * 0.16, y);
  ctx.closePath();
  ctx.fill();
}

/** A count in a dark pill, the way prices are shown. */
export function pill(ctx: Ctx, text: string, x: number, y: number, grow: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(grow, grow);
  ctx.font = fontOf(700, 10);
  const w = Math.max(16, ctx.measureText(text).width + 10);
  ctx.fillStyle = INK;
  ctx.strokeStyle = '#f6efdc';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.roundRect(-w / 2, -7, w, 14, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fbf7ee';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 0.5);
  ctx.restore();
}

/**
 * A lit bridge burns from the end it was lit at towards the other, with the
 * seconds left over it; a burnt one is a gap of charred stumps over the water
 * until it is built again, which is when the engine opens it.
 */
function drawBridges(ctx: Ctx, map: SwarmMap, state: SwarmState, built: Built, now: number, alpha: number, grow: number) {
  for (const crossing of built.crossings) {
    const at = map.paths.indexOf(crossing.path);
    const fuse = state.fuses.find((lit) => lit.path === at);
    const until = state.closed[at];
    const burnt = until >= state.tick && until !== CLOSED_FOREVER;
    const flare = built.flares.find((one) => one.path === at);
    if (!fuse && !burnt && !flare) continue;
    const { mid, span, half } = deckOf(map, crossing);
    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.rotate(mid.angle);
    if (burnt) {
      const gap = span * 0.42;
      ctx.fillStyle = PALETTE[map.scene].water.mid;
      ctx.fillRect(-gap / 2, -half, gap, half * 2);
      ctx.fillStyle = 'rgba(26, 18, 10, 0.88)';
      for (const end of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(end * (span / 2), -half);
        for (let k = 0; k <= 6; k++) ctx.lineTo(end * (gap / 2 + ((k * 7) % 5)), -half + (half * 2 * k) / 6);
        ctx.lineTo(end * (span / 2), half);
        ctx.closePath();
        ctx.fill();
      }
    }
    if (fuse) {
      const left = fuse.burns - state.tick - alpha;
      const done = Math.min(1, Math.max(0, 1 - left / BURN_FUSE));
      const lit = fuse.from === crossing.path.a ? -1 : 1;
      const reach = span * (0.15 + 0.85 * done);
      for (let x = 0; x <= reach; x += 6) {
        const h = 6 + 4 * Math.abs(Math.sin(now * 0.013 + x));
        ctx.save();
        ctx.translate(lit * (span / 2 - x), 0);
        ctx.rotate(-mid.angle);
        flame(ctx, 0, half * 0.4, h, Math.sin(now * 0.02 + x * 0.7) * 1.5);
        ctx.restore();
      }
    }
    ctx.restore();
    if (fuse) pill(ctx, String(Math.max(1, Math.ceil((fuse.burns - state.tick - alpha) / 10))), mid.x, mid.y - half - 14 * grow, grow);
    if (flare) {
      const age = (now - flare.at) / FLARE_MS;
      // Smoke off what went down, or off what was put out before it did.
      ctx.fillStyle = flare.kind === 'burn' ? `rgba(46, 40, 34, ${0.35 * (1 - age)})` : `rgba(200, 196, 188, ${0.45 * (1 - age)})`;
      for (let k = 0; k < 4; k++) {
        ellipse(ctx, mid.x + (k - 1.5) * 9 + Math.sin(k * 2.3) * 3, mid.y - 6 - age * 30 - k * 3, 6 + age * 10, 4 + age * 6);
        ctx.fill();
      }
    }
  }
}

/** Crossed spears: what leaves it has been drilled. */
function barracksIcon(ctx: Ctx) {
  ctx.strokeStyle = '#7a5530';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-6, 6);
  ctx.lineTo(5, -5);
  ctx.moveTo(6, 6);
  ctx.lineTo(-5, -5);
  ctx.stroke();
  ctx.fillStyle = '#8f9497';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.8;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 8, -8);
    ctx.lineTo(side * 3.2, -5.6);
    ctx.lineTo(side * 5.6, -3.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/** A sheaf of corn, tied. */
function granaryIcon(ctx: Ctx) {
  ctx.strokeStyle = '#8a6a2c';
  ctx.lineWidth = 1.1;
  for (const lean of [-1, 0, 1]) {
    ctx.beginPath();
    ctx.moveTo(lean * 1.5, 7);
    ctx.lineTo(lean * 4.5, -4);
    ctx.stroke();
    ctx.fillStyle = '#d8b04e';
    ellipse(ctx, lean * 4.8, -5.5, 1.8, 3.4, lean * 0.35);
    ctx.fill();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-2.6, 1.5);
  ctx.lineTo(2.6, 1.5);
  ctx.stroke();
}

/** A fire in a raised bowl, which is what columns are hurried past. */
function beaconIcon(ctx: Ctx) {
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-3.5, 8);
  ctx.lineTo(0, 2);
  ctx.lineTo(3.5, 8);
  ctx.stroke();
  ctx.fillStyle = '#6a6460';
  ctx.beginPath();
  ctx.moveTo(-6, -1);
  ctx.quadraticCurveTo(0, 6, 6, -1);
  ctx.closePath();
  ctx.fill();
  flame(ctx, 0, -1, 9, 0.8);
}

/** The flame on the token that sets a bridge on fire. */
export function flameIcon(ctx: Ctx) {
  flame(ctx, 0, 4, 14, 1.2);
}

const BUILT_ICON: Record<Exclude<Building, 'trap'>, (ctx: Ctx) => void> = { barracks: barracksIcon, granary: granaryIcon, beacon: beaconIcon };

/** What each building does, in one line under it. */
export const BUILT_LINE: Record<Exclude<Building, 'trap'>, string> = {
  barracks: 'Never breeds. What leaves it or walks through survives one fight',
  granary: 'Never breeds. Your huts next to it hold half as many again',
  beacon: 'Never breeds. What leaves it or walks through goes one speed faster',
};

/**
 * A disc at the foot of each building with its sign on it. A trap has none:
 * it looks like any other hut until it is taken, and then it is one.
 */
function drawSigns(ctx: Ctx, map: SwarmMap, state: SwarmState, grow: number) {
  state.huts.forEach((hut, at) => {
    if (!hut.building || hut.building === 'trap') return;
    const site = map.sites[at];
    const r = siteRadius(site, hut.level);
    ctx.save();
    ctx.translate(site.x + r * 0.95, site.y - r * 0.1);
    ctx.scale(grow, grow);
    ctx.fillStyle = 'rgba(20, 16, 10, 0.35)';
    ellipse(ctx, 0, 1.5, 10, 10);
    ctx.fill();
    ctx.fillStyle = '#f6efdc';
    ellipse(ctx, 0, 0, 10, 10);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.scale(0.75, 0.75);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    BUILT_ICON[hut.building](ctx);
    ctx.restore();
  });
}

/** The ground falls in under a trap that has gone off, and what it took rises off it. */
function drawSprung(ctx: Ctx, map: SwarmMap, state: SwarmState, built: Built, now: number, grow: number) {
  const dig = PALETTE[map.scene].dig;
  for (const sprung of built.sprung) {
    const site = map.sites[sprung.hut];
    const r = siteRadius(site, state.huts[sprung.hut].level);
    const age = Math.max(0, now - sprung.at) / SPRUNG_MS;
    const fall = Math.min(1, age * 4);
    ctx.globalAlpha = 1 - age;
    ctx.strokeStyle = dig.bank;
    ctx.lineWidth = 3 * (1 - fall) + 1;
    ellipse(ctx, site.x, site.y, r * (0.8 + fall * 0.9), r * (0.4 + fall * 0.45));
    ctx.stroke();
    ctx.globalAlpha = Math.min(1, (1 - age) * 3);
    pill(ctx, `Trap took ${sprung.dead}`, site.x, site.y - r * 2.4 - age * 14, grow);
    ctx.globalAlpha = 1;
  }
}

/** The line that says what the building in hand does, under it; or under the first of a kind the viewer has taken, for a while. */
function drawLine(ctx: Ctx, map: SwarmMap, state: SwarmState, built: Built, selected: number | null, now: number, grow: number) {
  const telling = built.telling && now - built.telling.at < TELL_MS ? built.telling.hut : null;
  const at = selected !== null && state.huts[selected].building ? selected : telling;
  if (at === null) return;
  const building = state.huts[at].building;
  if (!building || building === 'trap') return;
  const site = map.sites[at];
  const r = siteRadius(site, state.huts[at].level);
  const fade = at === selected ? 1 : Math.min(1, (TELL_MS - (now - built.telling!.at)) / 600);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.font = fontOf(600, 11 * grow);
  const text = BUILT_LINE[building];
  const w = ctx.measureText(text).width + 14 * grow;
  const x = Math.min(map.w - w / 2 - 4, Math.max(w / 2 + 4, site.x));
  const y = site.y + r * 0.55 + 14 * grow;
  ctx.fillStyle = 'rgba(246, 239, 220, 0.94)';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 9 * grow, w, 18 * grow, 4 * grow);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5 * grow);
  ctx.restore();
}

/** Under the units: what is underground, and the bridges on fire or gone. */
export function drawBuiltUnder(ctx: Ctx, map: SwarmMap, state: SwarmState, built: Built, seat: Seat, now: number, alpha: number, px: number) {
  drawBurrows(ctx, map, state, seat, now);
  drawBridges(ctx, map, state, built, now, alpha, growOf(10, 9, px));
}

/** Over the units: the signs on the buildings, a trap's count, and the line under a building. */
export function drawBuiltOver(ctx: Ctx, map: SwarmMap, state: SwarmState, built: Built, selected: number | null, now: number, px: number) {
  const grow = growOf(10, 9, px);
  drawSigns(ctx, map, state, grow);
  drawSprung(ctx, map, state, built, now, grow);
  drawLine(ctx, map, state, built, selected, now, grow);
}


