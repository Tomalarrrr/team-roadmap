// The powers on the board. Rain is weather over everything for as long as it
// slows the paths. A call is rings in the caller's colour closing on the hut
// it is on, and one ring out from each hut that answered. A decoy is drawn by
// the units: faint to its own side, and like any other column to everyone else.

import { RAIN_TICKS, type Seat, type SwarmEvent, type SwarmMap, type SwarmState } from '../../swarmGameLogic';
import { BADGE, ellipse } from './swarmSceneKit';

export interface CallFx {
  seat: Seat;
  at: number;
  to: { x: number; y: number };
  from: { x: number; y: number }[];
}

const CALL_MS = 1400;
/** Rings closing on the hut called on, one after another. */
const CALL_RINGS = 3;

/** A call seen on this tick goes on the board; rain needs nothing, being read off the state. */
export function addPowerFx(calls: CallFx[], map: SwarmMap, event: SwarmEvent, now: number): void {
  if (event.kind !== 'power' || event.power !== 'call') return;
  const site = (at: number) => ({ x: map.sites[at].x, y: map.sites[at].y });
  calls.push({ seat: event.seat, at: now, to: site(event.to), from: event.from.map(site) });
}

export function drawCalls(ctx: CanvasRenderingContext2D, calls: CallFx[], now: number): void {
  let kept = 0;
  for (const call of calls) if (now - call.at < CALL_MS) calls[kept++] = call;
  calls.length = kept;
  for (const call of calls) {
    const t = (now - call.at) / CALL_MS;
    ctx.strokeStyle = BADGE[call.seat].fill;
    ctx.lineWidth = 2.4;
    for (let k = 0; k < CALL_RINGS; k++) {
      const s = t * 1.6 - k * 0.3;
      if (s <= 0 || s >= 1) continue;
      const r = 90 * (1 - s) + 22;
      ctx.globalAlpha = 0.85 * Math.sin(Math.PI * s);
      ellipse(ctx, call.to.x, call.to.y, r, r * 0.45);
      ctx.stroke();
    }
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = 0.7 * (1 - t);
    for (const p of call.from) {
      const r = 24 + t * 30;
      ellipse(ctx, p.x, p.y + 2, r, r * 0.42);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Streaks of rain over the board, each falling the height of it on its own line. */
const RAIN_STREAKS = 160;
/** Ticks the rain takes to set in and to clear. */
const RAIN_EASE = 8;

/** The rain, with `ctx` in world units. `tick` is the frame's tick with its fraction. */
export function drawRain(ctx: CanvasRenderingContext2D, map: SwarmMap, state: SwarmState, tick: number, now: number): void {
  if (state.rain === 0) return;
  const start = state.rain - RAIN_TICKS + 1;
  const fall = Math.min(1, (tick - start + 1) / RAIN_EASE, (state.rain + 1 - tick) / RAIN_EASE);
  if (fall <= 0) return;
  ctx.globalAlpha = 0.12 * fall;
  ctx.fillStyle = '#4c5e6e';
  ctx.fillRect(0, 0, map.w, map.h);
  ctx.globalAlpha = 0.4 * fall;
  ctx.strokeStyle = '#3e5060';
  ctx.lineWidth = 0.9;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < RAIN_STREAKS; i++) {
    const own = Math.imul(i + 1, 0x9e3779b1) >>> 0;
    const speed = 0.5 + ((own >>> 24) / 255) * 0.25;
    const y = (((own & 0xffff) / 0xffff) * map.h + now * speed) % (map.h + 20) - 10;
    const x = ((((own >>> 8) & 0xffff) / 0xffff) * map.w + y * 0.25) % map.w;
    ctx.moveTo(x, y);
    ctx.lineTo(x - 2.5, y - 10);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
