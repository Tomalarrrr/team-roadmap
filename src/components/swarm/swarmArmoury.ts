// The armoury's part of the drawing: the tokens a tower and a full hut offer,
// a refitted tower's look, and what each type's shot looks like. A mortar's
// shell is drawn in the air for the whole of its flight with the ring it will
// land in under it, which is the warning a column has to get out from under it.

import {
  HOLD_TICKS,
  KIT_KINDS,
  MORTAR_BLIND,
  MORTAR_FLIGHT,
  MORTAR_SPLASH,
  NARROW_PERCENT,
  REACH_STEP,
  BOLT_PIERCE,
  TICK_MS,
  TOWER_TYPES,
  armed,
  atWar,
  isTower,
  paceOn,
  pathLength,
  reachOf,
  spotOf,
  unitSpeed,
  upgradeCost,
  type ArmouryKind,
  type Hut,
  type Site,
  type SwarmEvent,
  type SwarmMap,
  type SwarmState,
  type Unit,
  type Upgrade,
} from '../../swarmGameLogic';
import { SHOT_LAND_MS } from './swarmFeel';
import { TOWER_BALL, TOWER_H, ellipse, pathPoint } from './swarmSceneKit';
import type { Scene } from './swarmRender';

const CLASSIC: Upgrade[] = ['hut', 'speed', 'strength'];

/**
 * The tokens shown for a hut in hand, in the order they are laid out. The
 * three every hut has keep their places; what the armoury adds follows them,
 * and only while it can still be bought, so a refitted tower shows its kit alone.
 */
export function tokenKinds(map: SwarmMap, state: SwarmState, hut: number): Upgrade[] {
  if (!armed(map)) return CLASSIC;
  const on = (kinds: readonly ArmouryKind[]) => kinds.filter((kind) => upgradeCost(map, state, hut, kind) !== null);
  if (isTower(state.huts[hut])) return [...KIT_KINDS, ...on(TOWER_TYPES)];
  return [...CLASSIC, ...on(['carapace', 'tower'])];
}

const FLIGHT_SECS = (MORTAR_FLIGHT * TICK_MS) / 1000;

/** One line each, under the board while a hut is in hand: the price is on the token. */
export const ARMOURY_NOTE: Record<ArmouryKind, string> = {
  range: `Range: reaches ${REACH_STEP} further`,
  rate: 'Rate: shoots again sooner',
  armour: 'Armour: each defender takes one more kill',
  mortar: `Mortar: shell lands ${FLIGHT_SECS} s later and kills all round it, not close in`,
  ballista: `Ballista: bolt goes through ${BOLT_PIERCE} in a line, slow to load`,
  web: 'Web: holds one, slows the rest, kills none',
  tower: 'Tower: stops breeding, shoots',
  carapace: 'Carapace: every unit lives through one tower hit',
};

/** What each of the armoury's tokens for the hut in hand does, in the order they are laid out. */
export function notesOf(map: SwarmMap, state: SwarmState, hut: number): string[] {
  return tokenKinds(map, state, hut).flatMap((kind) => (kind === 'hut' || kind === 'speed' || kind === 'strength' || upgradeCost(map, state, hut, kind) === null ? [] : [ARMOURY_NOTE[kind]]));
}

/**
 * How far each unit is drawn walking on the next tick, so the frames between
 * two ticks show it as the engine will move it: not at all in silk, slowed in
 * a web's reach, and no further than a unit in silk ahead of it on its path.
 */
export function paceShown(map: SwarmMap, state: SwarmState): (unit: Unit) => number {
  const plain = (unit: Unit) => paceOn(map, unit.from, unit.to, unitSpeed(state, unit), state.tick + 1 <= state.rain);
  if (!armed(map)) return plain;
  const webs = state.huts.flatMap((hut, at) => (hut.type === 'web' ? [at] : []));
  const held = state.units.filter((unit) => unit.held !== undefined);
  return (unit) => {
    if (unit.held !== undefined) return 0;
    let pace = plain(unit);
    const spot = spotOf(map, unit);
    const caught = webs.some((at) => {
      if (!atWar(map, state.huts[at].owner, at, unit)) return false;
      const site = map.sites[at];
      return (spot.x - site.x) ** 2 + (spot.y - site.y) ** 2 <= reachOf(map, state.huts[at]) ** 2;
    });
    if (caught) pace = Math.max(1, Math.floor((pace * NARROW_PERCENT) / 100));
    for (const ahead of held) {
      const behind = ahead.d > unit.d || (ahead.d === unit.d && ahead.id < unit.id);
      if (ahead.seat === unit.seat && ahead.from === unit.from && ahead.to === unit.to && behind) pace = Math.min(pace, ahead.d - unit.d);
    }
    return pace;
  };
}

/**
 * The map as it is to be drawn: a hut built up into a tower is drawn as one.
 * Checked every frame, so a game joined late shows what was built before.
 */
export function buildUp(scene: Scene, state: SwarmState): void {
  const { sites } = scene.map;
  if (!state.huts.some((hut, at) => isTower(hut) && !sites[at].tower)) return;
  scene.map = { ...scene.map, sites: sites.map((site, at) => (isTower(state.huts[at]) && !site.tower ? { ...site, tower: true } : site)) };
  scene.sprites.clear();
}

interface Mark {
  kind: 'blast' | 'bolt' | 'glance' | 'cast';
  x: number;
  y: number;
  /** Where a bolt or a strand of silk came from. */
  fromX: number;
  fromY: number;
  at: number;
}

const MARK_MS: Record<Mark['kind'], number> = { blast: 420, bolt: 240, glance: 320, cast: 260 };
/** How high over the board a shell goes, and how high on its tower it leaves from. */
const LOB = 120;
const MUZZLE = TOWER_H + TOWER_BALL;

const marksOf = new WeakMap<Scene, Mark[]>();

/** Called with each tick's events, after the cannon's shots are put in. */
export function noteArmoury(scene: Scene, state: SwarmState, events: SwarmEvent[], now: number): void {
  let marks = marksOf.get(scene);
  if (!marks) marksOf.set(scene, (marks = []));
  const { sites } = scene.map;
  const top = (at: number) => ({ fromX: sites[at].x, fromY: sites[at].y - MUZZLE });
  // A cannon's ball takes its time to come down, and the shell glances off only when it does.
  for (const shot of state.shots) {
    if (shot.spared) marks.push({ kind: 'glance', x: shot.x, y: shot.y, ...top(shot.tower), at: now + (shot.type ? 0 : SHOT_LAND_MS) });
  }
  for (const event of events) {
    if (event.kind === 'blast') marks.push({ kind: 'blast', x: event.x, y: event.y, ...top(event.hut), at: now });
    else if (event.kind === 'bolt') {
      marks.push({ kind: 'bolt', x: event.x, y: event.y, ...top(event.hut), at: now });
      scene.firedAt[event.hut] = now;
    }
  }
  state.huts.forEach((hut, at) => {
    if (hut.shell && hut.shell.at === state.tick + MORTAR_FLIGHT) scene.firedAt[at] = now;
  });
  for (const unit of state.units) {
    if (unit.held !== HOLD_TICKS) continue;
    const web = webOn(scene.map, state, unit);
    if (web === null) continue;
    const p = drawnAt(scene.map, unit);
    marks.push({ kind: 'cast', x: p.x, y: p.y, ...top(web), at: now });
  }
}

const drawnAt = (map: SwarmMap, unit: Unit) => pathPoint(map, unit.from, unit.to, unit.d / pathLength(map, unit.from, unit.to));

/** The nearest web at war with a unit that reaches it: the one that caught it. */
function webOn(map: SwarmMap, state: SwarmState, unit: Unit): number | null {
  const spot = spotOf(map, unit);
  let best: number | null = null;
  let bestGap = Infinity;
  state.huts.forEach((hut, at) => {
    if (hut.type !== 'web' || !atWar(map, hut.owner, at, unit)) return;
    const gap = (spot.x - map.sites[at].x) ** 2 + (spot.y - map.sites[at].y) ** 2;
    if (gap <= reachOf(map, hut) ** 2 && gap < bestGap) {
      best = at;
      bestGap = gap;
    }
  });
  return best;
}

/** Shells in the air, units in silk, and the marks of shots: over the units, under the counts. */
export function drawArmoury(ctx: CanvasRenderingContext2D, scene: Scene, state: SwarmState, now: number, alpha: number): void {
  const { map } = scene;
  if (!armed(map)) return;
  const ice = map.scene === 'ice';
  const line = ice ? 'rgba(30, 54, 92, 0.7)' : 'rgba(255, 255, 255, 0.75)';

  state.huts.forEach((hut, at) => {
    const shell = hut.shell;
    if (!shell) return;
    const site = map.sites[at];
    const f = Math.min(1, Math.max(0, (state.tick + alpha - (shell.at - MORTAR_FLIGHT)) / MORTAR_FLIGHT));
    // Where it will land, the whole time it is up: this is what a column sees coming and walks out of.
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.5 + 0.5 * f;
    ellipse(ctx, shell.x, shell.y, MORTAR_SPLASH, MORTAR_SPLASH);
    ctx.stroke();
    ctx.setLineDash([]);
    const x = site.x + (shell.x - site.x) * f;
    const ground = site.y + (shell.y - site.y) * f;
    const y = ground - MUZZLE * (1 - f) - LOB * 4 * f * (1 - f);
    ctx.globalAlpha = 0.15 + 0.3 * f;
    ctx.fillStyle = '#16190e';
    ellipse(ctx, x, ground, 5, 2.4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#17181a';
    ellipse(ctx, x, y, 4.6, 4.6);
    ctx.fill();
  });

  // Silk wound round what a web holds, thinning as it wears through.
  ctx.strokeStyle = '#f4f2ea';
  ctx.lineWidth = 0.8;
  for (const unit of state.units) {
    if (unit.held === undefined) continue;
    const p = drawnAt(map, unit);
    ctx.globalAlpha = 0.35 + (0.55 * unit.held) / HOLD_TICKS;
    for (let turn = 0; turn < 3; turn++) {
      ellipse(ctx, p.x, p.y - 1, 5.5 - turn * 0.6, 2.6, 0.5 + turn * 1.05);
      ctx.stroke();
    }
  }

  const marks = marksOf.get(scene);
  if (!marks) return;
  let kept = 0;
  for (const mark of marks) if (now - mark.at < MARK_MS[mark.kind]) marks[kept++] = mark;
  marks.length = kept;
  for (const mark of marks) {
    const t = (now - mark.at) / MARK_MS[mark.kind];
    if (t < 0) continue;
    if (mark.kind === 'blast') {
      // The shell's ring, struck once, and the dust of it.
      ctx.globalAlpha = 0.5 * (1 - t);
      ctx.fillStyle = ice ? '#eef4f8' : '#4a3a28';
      ellipse(ctx, mark.x, mark.y, MORTAR_SPLASH * (0.5 + 0.5 * t), MORTAR_SPLASH * (0.25 + 0.2 * t));
      ctx.fill();
      ctx.globalAlpha = 0.8 * (1 - t);
      ctx.strokeStyle = line;
      ctx.lineWidth = 1.4;
      ellipse(ctx, mark.x, mark.y, MORTAR_SPLASH, MORTAR_SPLASH);
      ctx.stroke();
    } else if (mark.kind === 'bolt') {
      // Straight and quick: the whole line it flew down, gone in a quarter of a second.
      const head = Math.min(1, t * 3);
      ctx.globalAlpha = 0.85 * (1 - t);
      ctx.strokeStyle = '#3a2c1c';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(mark.fromX, mark.fromY);
      ctx.lineTo(mark.fromX + (mark.x - mark.fromX) * head, mark.fromY + (mark.y - mark.fromY) * head);
      ctx.stroke();
    } else if (mark.kind === 'cast') {
      ctx.globalAlpha = 0.7 * (1 - t);
      ctx.strokeStyle = '#f4f2ea';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(mark.fromX, mark.fromY);
      ctx.quadraticCurveTo((mark.fromX + mark.x) / 2, Math.max(mark.fromY, mark.y) + 10, mark.x, mark.y);
      ctx.stroke();
    } else {
      // A hit that a carapace turned: two chips of shell flying off, and nothing left on the ground.
      ctx.globalAlpha = 0.9 * (1 - t);
      ctx.strokeStyle = '#f6efdc';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const side of [-1, 1]) {
        ctx.moveTo(mark.x + side * (3 + t * 5), mark.y - 4 - t * 6);
        ctx.lineTo(mark.x + side * (5 + t * 7), mark.y - 6 - t * 9);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

/** Iron hoops for each level of armour, and on a refitted tower what it was refitted with, in place of the ball. */
export function drawKit(ctx: CanvasRenderingContext2D, site: Site, hut: Hut): void {
  if (!isTower(hut)) return;
  const { x, y } = site;
  ctx.strokeStyle = '#2f3234';
  ctx.lineWidth = 2.4;
  for (let level = 0; level < (hut.armour ?? 0); level++) {
    const at = y - 8 - level * 36;
    const half = 21 + ((at - y) / TOWER_H) * 8 + 0.5;
    ctx.beginPath();
    ctx.moveTo(x - half, at);
    ctx.quadraticCurveTo(x, at + 6, x + half, at);
    ctx.stroke();
  }
  if (!hut.type) return;
  const cx = x;
  const cy = y - TOWER_H - TOWER_BALL * 0.8;
  if (hut.type === 'mortar') {
    // A squat barrel on the rim, its mouth to the sky.
    ctx.fillStyle = '#26292b';
    ctx.beginPath();
    ctx.moveTo(cx - 12, cy + 12);
    ctx.lineTo(cx - 14, cy - 6);
    ctx.lineTo(cx + 14, cy - 6);
    ctx.lineTo(cx + 12, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0b0c0d';
    ellipse(ctx, cx, cy - 6, 14, 5);
    ctx.fill();
    ctx.strokeStyle = '#6d7276';
    ctx.lineWidth = 1;
    ellipse(ctx, cx, cy - 6, 14, 5);
    ctx.stroke();
  } else if (hut.type === 'ballista') {
    // A bow laid across the rim with a bolt on it.
    ctx.strokeStyle = '#6b4a2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy + 6);
    ctx.quadraticCurveTo(cx, cy - 10, cx + 20, cy + 6);
    ctx.stroke();
    ctx.strokeStyle = '#e8e0cc';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx - 20, cy + 6);
    ctx.lineTo(cx + 20, cy + 6);
    ctx.stroke();
    ctx.strokeStyle = '#2b241a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 10);
    ctx.lineTo(cx, cy - 12);
    ctx.stroke();
  } else {
    // Spokes and a spiral strung over the top.
    ctx.strokeStyle = 'rgba(246, 244, 236, 0.9)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (let spoke = 0; spoke < 8; spoke++) {
      const angle = (spoke * Math.PI) / 4;
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(angle) * 17, cy + Math.sin(angle) * 17);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let step = 0; step <= 48; step++) {
      const angle = (step * Math.PI) / 8;
      const r = 3 + step * 0.28;
      if (step === 0) ctx.moveTo(cx + r, cy);
      else ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
    ctx.stroke();
  }
}

/** A mortar shows the ground it cannot hit as well as the ground it can. */
export function drawBlind(ctx: CanvasRenderingContext2D, site: Site, hut: Hut): void {
  if (hut.type !== 'mortar') return;
  ellipse(ctx, site.x, site.y, MORTAR_BLIND, MORTAR_BLIND);
  ctx.stroke();
}

// The tokens' pictures, drawn in the token's own units with the ink and line already set.

const TOKEN_INK = '#2b241a';

/** A tower, and the reach it gains in two arcs. */
function rangeIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#8a8c86';
  ctx.fillRect(-11, -8, 5, 11);
  ctx.strokeRect(-11, -8, 5, 11);
  ctx.beginPath();
  ctx.arc(-8.5, -3, 9, -1.2, 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-8.5, -3, 15, -1.0, 0.5);
  ctx.stroke();
}

/** A clock with its hand moved on. */
function rateIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#e9e2cf';
  ellipse(ctx, 0, -3.5, 8.5, 8.5);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -3.5);
  ctx.lineTo(0, -9.5);
  ctx.moveTo(0, -3.5);
  ctx.lineTo(4.5, -1);
  ctx.stroke();
}

/** A tower hooped in iron. */
function armourIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#9a9b94';
  ctx.beginPath();
  ctx.moveTo(-7, 3);
  ctx.lineTo(-5, -11);
  ctx.lineTo(5, -11);
  ctx.lineTo(7, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(-6.6, 0);
  ctx.lineTo(6.6, 0);
  ctx.moveTo(-5.6, -7);
  ctx.lineTo(5.6, -7);
  ctx.stroke();
}

/** A squat barrel and the high arc of its shell. */
function mortarIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#3a3d40';
  ctx.beginPath();
  ctx.moveTo(-10, 3);
  ctx.lineTo(-11, -4);
  ctx.lineTo(-3, -4);
  ctx.lineTo(-4, 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(-7, -6);
  ctx.quadraticCurveTo(1, -22, 9, 0);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#17181a';
  ellipse(ctx, 9, 1, 2.6, 2.6);
  ctx.fill();
}

/** A bolt through three in a row. */
function ballistaIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#7a6a52';
  for (const x of [-5, 0, 5]) {
    ellipse(ctx, x, -3.5, 2, 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(-12, -3.5);
  ctx.lineTo(11, -3.5);
  ctx.stroke();
  ctx.fillStyle = TOKEN_INK;
  ctx.beginPath();
  ctx.moveTo(12.5, -3.5);
  ctx.lineTo(8, -6.5);
  ctx.lineTo(8, -0.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-12, -3.5);
  ctx.lineTo(-14, -6);
  ctx.moveTo(-12, -3.5);
  ctx.lineTo(-14, -1);
  ctx.stroke();
}

/** Spokes and a spiral. */
function webIcon(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let spoke = 0; spoke < 6; spoke++) {
    const angle = (spoke * Math.PI) / 3 + 0.3;
    ctx.moveTo(0, -3.5);
    ctx.lineTo(Math.cos(angle) * 10, -3.5 + Math.sin(angle) * 10);
  }
  ctx.stroke();
  ctx.beginPath();
  for (let step = 0; step <= 30; step++) {
    const angle = (step * Math.PI) / 6;
    const r = 1.5 + step * 0.27;
    ctx.lineTo(Math.cos(angle) * r, -3.5 + Math.sin(angle) * r);
  }
  ctx.stroke();
}

/** A stone tower with its ball. */
function towerIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#9a9b94';
  ctx.beginPath();
  ctx.moveTo(-6, 4);
  ctx.lineTo(-4.5, -7);
  ctx.lineTo(4.5, -7);
  ctx.lineTo(6, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#17181a';
  ellipse(ctx, 0, -10.5, 4, 4);
  ctx.fill();
}

/** A beetle's shell, split down the middle. */
function carapaceIcon(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#6e5a3a';
  ctx.beginPath();
  ctx.moveTo(-9, 2);
  ctx.bezierCurveTo(-9, -12, 9, -12, 9, 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -8.5);
  ctx.lineTo(0, 2);
  ctx.moveTo(-6.5, -2);
  ctx.quadraticCurveTo(-3, -4, -1, -2);
  ctx.moveTo(6.5, -2);
  ctx.quadraticCurveTo(3, -4, 1, -2);
  ctx.stroke();
}

export const ARMOURY_ICON: Record<ArmouryKind, (ctx: CanvasRenderingContext2D) => void> = {
  range: rangeIcon,
  rate: rateIcon,
  armour: armourIcon,
  mortar: mortarIcon,
  ballista: ballistaIcon,
  web: webIcon,
  tower: towerIcon,
  carapace: carapaceIcon,
};
