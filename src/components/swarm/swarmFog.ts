// The fog twist, which is drawing only: every client runs the whole game, and
// this decides what of it the viewer is shown. A side sees round its own huts
// and its own units; outside that, other sides' units are hidden and a hut's
// count is what it was when last seen, or "?" when it never has been. Who
// holds a hut is always shown, so the board can still be read.

import { pathLength, type Seat, type SwarmEvent, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { pathPoint } from './swarmSceneKit';

/** World units a side sees round each of its huts, and round each of its units. */
export const SIGHT_HUT = 160;
export const SIGHT_UNIT = 90;
/** How far a watchtower sees for its owner. */
export const SIGHT_WATCH = 320;
/**
 * What was seen last tick stays seen this much further out. Without it a unit
 * walking along the edge of sight, or a hut on it while one of the viewer's
 * columns passes, blinks in and out from one tick to the next.
 */
export const SIGHT_SLACK = 20;
/** Units closer together than this make one eye: a column is hundreds of units, and they all see the same ground. */
const EYE_GRID = 12;

/** The sides whose sight `seat` shares: its own, when it is on the board. Allies will add theirs. */
export function seesFor(map: SwarmMap, seat: Seat): Seat[] {
  return map.sides.includes(seat) ? [seat] : [];
}

export interface Eye {
  x: number;
  y: number;
  r: number;
}

/** A hut's count the last time it was seen, and the tick that was. */
export interface Memory {
  n: number;
  tick: number;
}

/** What the viewer is shown of one tick. */
export interface Sight {
  state: SwarmState;
  /** Huts not in sight on this tick. */
  unseen: ReadonlySet<number>;
  /** Huts never in sight: their count is not known at all. */
  unknown: ReadonlySet<number>;
  memory: readonly (Memory | null)[];
  /** Where the viewer sees from, for the mist to be cleared round. Empty when the fog has lifted. */
  eyes: Eye[];
}

interface Seen {
  tick: number;
  huts: Set<number>;
  units: Set<number>;
}

export interface Fog {
  seat: Seat;
  memory: (Memory | null)[];
  /** What was in sight on the last tick worked out, and on the tick before that, for SIGHT_SLACK. */
  now: Seen | null;
  before: Seen | null;
  /** The last answer, kept while the frames ask about one tick of one state. */
  last: { state: SwarmState; tick: number; sight: Sight } | null;
}

/** A fog for `seat`'s screen, or null when the game is not played with one. */
export function newFog(map: SwarmMap, seat: Seat): Fog | null {
  if (!map.rules.twists.includes('fog')) return null;
  return { seat, memory: map.sites.map(() => null), now: null, before: null, last: null };
}

function eyesOf(map: SwarmMap, state: SwarmState, sides: readonly Seat[]): Eye[] {
  const eyes: Eye[] = [];
  state.huts.forEach((hut, at) => {
    if (hut.owner && sides.includes(hut.owner)) eyes.push({ x: map.sites[at].x, y: map.sites[at].y, r: hut.building === 'watch' ? SIGHT_WATCH : SIGHT_HUT });
  });
  const taken = new Set<number>();
  for (const unit of state.units) {
    if (!sides.includes(unit.seat)) continue;
    const p = pathPoint(map, unit.from, unit.to, unit.d / pathLength(map, unit.from, unit.to));
    const cell = Math.round(p.x / EYE_GRID) * 4096 + Math.round(p.y / EYE_GRID);
    if (taken.has(cell)) continue;
    taken.add(cell);
    eyes.push({ x: p.x, y: p.y, r: SIGHT_UNIT });
  }
  return eyes;
}

function inSight(eyes: Eye[], x: number, y: number, slack: number): boolean {
  for (const eye of eyes) {
    const r = eye.r + slack;
    const dx = eye.x - x;
    const dy = eye.y - y;
    if (dx * dx + dy * dy <= r * r) return true;
  }
  return false;
}

const NONE: ReadonlySet<number> = new Set();

/**
 * What `fog`'s viewer is shown of `state`. Worked out once a tick and kept, so
 * every frame of a tick shows the same; the memory of counts moves on only as
 * the ticks do.
 */
export function fogOf(fog: Fog, map: SwarmMap, state: SwarmState): Sight {
  if (fog.last && fog.last.state === state && fog.last.tick === state.tick) return fog.last.sight;
  const sides = seesFor(map, fog.seat);
  const mine = (seat: Seat | null) => seat !== null && sides.includes(seat);
  const { tick } = state;
  // Over, or nothing left to see with: the whole board is shown.
  const out = !state.huts.some((hut) => mine(hut.owner)) && !state.units.some((unit) => mine(unit.seat));
  if (state.winner !== null || out) {
    const sight: Sight = { state, unseen: NONE, unknown: NONE, memory: fog.memory, eyes: [] };
    fog.last = { state, tick, sight };
    return sight;
  }

  if (fog.now && fog.now.tick < tick) fog.before = fog.now;
  const before = fog.before && fog.before.tick < tick ? fog.before : null;
  const eyes = eyesOf(map, state, sides);
  const seen: Seen = { tick, huts: new Set(), units: new Set() };
  const unseen = new Set<number>();
  const unknown = new Set<number>();
  const huts = state.huts.map((hut, at) => {
    const site = map.sites[at];
    if (hut.drowned || mine(hut.owner) || inSight(eyes, site.x, site.y, before?.huts.has(at) ? SIGHT_SLACK : 0)) {
      seen.huts.add(at);
      const known = fog.memory[at];
      if (!known || known.tick <= tick) fog.memory[at] = { n: hut.n, tick };
      return hut;
    }
    unseen.add(at);
    const known = fog.memory[at];
    if (!known) unknown.add(at);
    return { ...hut, n: known ? known.n : 0, out: [], ...(hut.hurt !== undefined && { hurt: 0 }) };
  });
  const placed = (from: number, to: number, d: number) => pathPoint(map, from, to, d / pathLength(map, from, to));
  const units = state.units.filter((unit) => {
    if (mine(unit.seat)) return true;
    const p = placed(unit.from, unit.to, unit.d);
    if (!inSight(eyes, p.x, p.y, before?.units.has(unit.id) ? SIGHT_SLACK : 0)) return false;
    seen.units.add(unit.id);
    return true;
  });
  fog.now = seen;

  const visible = (x: number, y: number) => inSight(eyes, x, y, 0);
  const shown = (event: SwarmEvent): boolean => {
    switch (event.kind) {
      case 'clash':
      case 'toll': {
        const p = placed(event.from, event.to, event.d);
        return visible(p.x, p.y);
      }
      case 'hit':
        return seen.huts.has(event.hut);
      case 'power':
        // A decoy is a secret of its side's; a call is seen where it lands.
        if (mine(event.seat)) return true;
        if (event.power === 'decoy') return false;
        return event.power === 'rain' || seen.huts.has(event.to);
      default:
        return true;
    }
  };
  const fogged: SwarmState = {
    ...state,
    huts,
    units,
    events: state.events.filter(shown),
    shots: state.shots.filter((shot) => visible(shot.x, shot.y)),
  };
  const sight: Sight = { state: fogged, unseen, unknown, memory: fog.memory, eyes };
  fog.last = { state, tick, sight };
  return sight;
}

/** How long ago a hut was last seen, as the board writes it: "12s", then "3m". */
export function ageOf(memory: Memory, tick: number, tickMs: number): string {
  const secs = Math.floor(((tick - memory.tick) * tickMs) / 1000);
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m`;
}

/** World units to one pixel of the mist: it is soft-edged, so it is painted small and enlarged. */
const MIST_UNIT = 8;
/** How far inside the edge of sight the mist starts to thin, and how far past it the last of it clears. */
const MIST_IN = 28;
const MIST_OUT = 12;
const MIST = '#cfcdc4';
const MIST_ALPHA = 0.6;

export interface Mist {
  canvas: HTMLCanvasElement;
  /** The sight it was painted for: repainted once a tick, not once a frame. */
  sight: Sight | null;
  holes: Map<number, HTMLCanvasElement>;
}

export function newMist(map: SwarmMap): Mist {
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(map.w / MIST_UNIT);
  canvas.height = Math.ceil(map.h / MIST_UNIT);
  return { canvas, sight: null, holes: new Map() };
}

/** A soft round hole of sight `r`, in mist pixels, painted once for each radius. */
function holeOf(mist: Mist, r: number): HTMLCanvasElement {
  let hole = mist.holes.get(r);
  if (hole) return hole;
  const outer = (r + MIST_OUT) / MIST_UNIT;
  hole = document.createElement('canvas');
  hole.width = hole.height = Math.ceil(outer * 2);
  const ctx = hole.getContext('2d');
  if (ctx) {
    const gradient = ctx.createRadialGradient(outer, outer, 0, outer, outer, outer);
    gradient.addColorStop(0, '#000');
    gradient.addColorStop((r - MIST_IN) / (r + MIST_OUT), '#000');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, hole.width, hole.height);
  }
  mist.holes.set(r, hole);
  return hole;
}

/** The mist over what the viewer cannot see, with `ctx` in world units. Its edge is where units drop out of sight. */
export function drawMist(ctx: CanvasRenderingContext2D, mist: Mist, sight: Sight): void {
  if (sight.eyes.length === 0) return;
  const { canvas } = mist;
  if (mist.sight !== sight) {
    mist.sight = sight;
    const paint = canvas.getContext('2d');
    if (!paint) return;
    paint.globalCompositeOperation = 'source-over';
    paint.fillStyle = MIST;
    paint.fillRect(0, 0, canvas.width, canvas.height);
    paint.globalCompositeOperation = 'destination-out';
    for (const eye of sight.eyes) {
      const hole = holeOf(mist, eye.r);
      paint.drawImage(hole, eye.x / MIST_UNIT - hole.width / 2, eye.y / MIST_UNIT - hole.height / 2);
    }
  }
  ctx.globalAlpha = MIST_ALPHA;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(canvas, 0, 0, canvas.width * MIST_UNIT, canvas.height * MIST_UNIT);
  ctx.globalAlpha = 1;
}
