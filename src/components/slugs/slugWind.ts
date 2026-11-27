// The wind made visible on the battlefield: bits of the land's crust (grass,
// sand, snow, ash, moss) carried across the view at the wind's speed, more of
// them the stronger it blows and none in a calm, and the speed the cloud layer
// drifts at. The rules' wind is a step from -10 to 10 that changes each turn;
// what is drawn eases to a new step over a second or so rather than jumping.

import { WIND_MOST } from '../../slugsGameLogic';

/** Motes on screen at full strength, whatever the zoom. */
export const MOTES_AT_FULL = 36;
/** World px a second a mote crosses per wind step, before its own pace. */
export const MOTE_SPEED = 16;
/** Seconds for the drawn wind to come most of the way to a new step. */
const EASE_S = 1.2;
/** Seconds a new mote takes to fade in, so a stronger wind adds them without popping. */
const FADE_IN_S = 0.5;

export interface Mote {
  x: number;
  y: number;
  /** 0.7 to 1.3 times the wind's speed, so they do not move as one sheet. */
  pace: number;
  /** Where in its flutter it is, radians. */
  phase: number;
  age: number;
}

/** The world rectangle on screen. */
export interface View {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The drawn wind's step towards `wind` over `dt` ms. */
export function easeWind(shown: number, wind: number, dt: number): number {
  return shown + (wind - shown) * (1 - Math.exp(-dt / 1000 / EASE_S));
}

/** How many motes a drawn wind of `wind` steps keeps on screen. */
export function moteCount(wind: number): number {
  return Math.round((Math.min(WIND_MOST, Math.abs(wind)) / WIND_MOST) * MOTES_AT_FULL);
}

function spawn(view: View, rand: () => number, x?: number): Mote {
  return {
    x: x ?? view.x0 + rand() * (view.x1 - view.x0),
    y: view.y0 + rand() * (view.y1 - view.y0),
    pace: 0.7 + rand() * 0.6,
    phase: rand() * Math.PI * 2,
    age: 0,
  };
}

/**
 * Move the motes `dt` ms on a drawn wind of `wind` steps, and keep as many as
 * it calls for. One blown out of the downwind side comes back in at the upwind
 * side; one left outside by the view moving is put back anywhere in it.
 */
export function stepMotes(motes: Mote[], wind: number, view: View, dt: number, rand: () => number): void {
  const s = dt / 1000;
  const want = moteCount(wind);
  while (motes.length > want) motes.pop();
  while (motes.length < want) motes.push(spawn(view, rand));
  const margin = 12;
  for (let i = 0; i < motes.length; i++) {
    const m = motes[i];
    m.x += wind * MOTE_SPEED * m.pace * s;
    m.phase += s * (2 + m.pace * 2);
    m.age += s;
    const downwind = wind > 0 ? m.x > view.x1 + margin : m.x < view.x0 - margin;
    if (downwind && m.y >= view.y0 && m.y <= view.y1) motes[i] = spawn(view, rand, wind > 0 ? view.x0 - margin : view.x1 + margin);
    else if (m.x < view.x0 - margin || m.x > view.x1 + margin || m.y < view.y0 || m.y > view.y1) motes[i] = spawn(view, rand);
  }
}

/** The part of a Phaser Graphics drawMotes uses, so it can be drawn without an engine. */
export interface MotePen {
  clear(): unknown;
  lineStyle(width: number, colour: number, alpha?: number): unknown;
  lineBetween(x1: number, y1: number, x2: number, y2: number): unknown;
}

/**
 * Each mote as a short dash along the wind, longer the harder it blows, with a
 * small flutter up and down. `unit` is world px per screen px, so a mote keeps
 * its size on screen at any zoom.
 */
export function drawMotes(pen: MotePen, motes: readonly Mote[], wind: number, colour: number, unit: number): void {
  pen.clear();
  const dir = Math.sign(wind);
  const len = (2 + Math.abs(wind) * 0.5) * unit;
  for (const m of motes) {
    const alpha = 0.6 * Math.min(1, m.age / FADE_IN_S);
    if (alpha <= 0) continue;
    const lift = Math.sin(m.phase) * 3 * unit;
    pen.lineStyle(1.5 * unit, colour, alpha);
    pen.lineBetween(m.x, m.y + lift, m.x - dir * len * m.pace, m.y + lift - Math.cos(m.phase) * unit);
  }
}

/** Screen widths a second the cloud layer drifts per wind step. */
export const CLOUD_PER_STEP = 0.0015;
