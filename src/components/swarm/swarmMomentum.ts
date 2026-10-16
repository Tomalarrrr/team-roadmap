// The callouts that are about a run of play and not a single tick: a burst
// of captures, a column on your hut that died to the last unit, a hut held
// against a column that got to its door. Each says the real number.

import { TICK_MS, paceOn, pathLength, type Seat, type SwarmMap, type SwarmState } from '../../swarmGameLogic';

/** Captures from another side each within this many ticks of the one before are one run. */
export const RUN_TICKS = 100;
/** Captures in a run before it is called, and the count it is called again at each time it grows by two. */
export const RUN_LEAST = 3;
/** A column on your hut this large, killed before any of it reached the door, is a rout. */
export const ROUT_LEAST = 12;
/** A column this large that reached the door and still did not take the hut was held against. */
export const HELD_LEAST = 15;

interface Assault {
  hut: number;
  side: Seat;
  /** Every unit of the column seen so far: so "of 20" is how many set out, not how many were on the road at once. */
  ids: Set<number>;
  /** How many of them got to the door. */
  door: number;
}

export interface Momentum {
  /** The ticks of this run's captures. */
  run: number[];
  /** The longest the run has been called at. */
  called: number;
  assaults: Map<string, Assault>;
}

export const newMomentum = (): Momentum => ({ run: [], called: 0, assaults: new Map() });

export type MomentumKey = 'run' | 'rout' | 'held';

/** Called with each step of the game in order, from the viewer's side. */
export function momentumStep(momentum: Momentum, map: SwarmMap, before: SwarmState, after: SwarmState, seat: Seat): { key: MomentumKey; text: string }[] {
  const said: { key: MomentumKey; text: string }[] = [];

  for (const event of after.events) {
    if (event.kind !== 'capture' || event.seat !== seat) continue;
    const was = before.huts[event.hut].owner;
    // Huts nobody held are taken by the handful at the start of every game: not news.
    if (was === null || was === seat || map.sites[event.hut].tower) continue;
    const last = momentum.run[momentum.run.length - 1];
    if (last !== undefined && after.tick - last > RUN_TICKS) {
      momentum.run = [];
      momentum.called = 0;
    }
    momentum.run.push(after.tick);
  }
  const run = momentum.run.length;
  if (run >= RUN_LEAST && run >= momentum.called + 2) {
    momentum.called = run;
    const secs = Math.max(1, Math.ceil(((momentum.run[run - 1] - momentum.run[0]) * TICK_MS) / 1000));
    said.push({ key: 'run', text: `${run} huts in ${secs}s` });
  }

  // Columns of other sides on huts this side holds, followed until the last of them is gone.
  const walking = new Set<string>();
  for (const unit of after.units) {
    if (unit.seat === seat || after.huts[unit.dest].owner !== seat) continue;
    const key = `${unit.dest}${unit.seat}`;
    walking.add(key);
    let assault = momentum.assaults.get(key);
    if (!assault) momentum.assaults.set(key, (assault = { hut: unit.dest, side: unit.seat, ids: new Set(), door: 0 }));
    assault.ids.add(unit.id);
  }
  for (const hut of after.huts) {
    if (!hut.owner || hut.owner === seat) continue;
    for (const line of hut.out) if (line.n > 0 && after.huts[line.dest].owner === seat) walking.add(`${line.dest}${hut.owner}`);
  }
  if (before.tick === after.tick - 1) {
    const alive = new Set<number>();
    for (const unit of after.units) alive.add(unit.id);
    for (const unit of before.units) {
      if (alive.has(unit.id) || unit.to !== unit.dest) continue;
      const assault = momentum.assaults.get(`${unit.dest}${unit.seat}`);
      if (assault && unit.d + paceOn(map, unit.from, unit.to, after.army[unit.seat].speed) >= pathLength(map, unit.from, unit.to)) assault.door++;
    }
  }
  for (const [key, assault] of momentum.assaults) {
    if (walking.has(key)) continue;
    momentum.assaults.delete(key);
    if (after.huts[assault.hut].owner !== seat) continue;
    const n = assault.ids.size;
    if (assault.door === 0 && n >= ROUT_LEAST) said.push({ key: 'rout', text: `Rout: a column of ${n} wiped out` });
    else if (assault.door > 0 && n >= HELD_LEAST) said.push({ key: 'held', text: `Held against ${n}` });
  }
  return said;
}
