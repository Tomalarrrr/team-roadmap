// The game's record for the summary at its end, kept as it is played.
//
// It is fed the confirmed state only, the one every client has the same, so
// the numbers at the end are the game's own and the same on every screen. A
// game cannot be played again to count them afterwards: the whole of one is
// a second or two of work, at the moment someone wants to press Play again.
//
// Every number is a count of something that happened, not an estimate. What
// is not counted is units lost: a unit dies in clashes on the road and at the
// door, to tolls and to towers, and telling those apart from outside the rules
// would mean guessing.

import { TICK_MS, countOf, type Owner, type Seat, type SwarmMap, type SwarmState } from '../../swarmGameLogic';

/** Huts held are sampled every this many ticks for the chart: a second. */
export const SAMPLE_TICKS = 10;

/** A tick count as the clock shows it. */
export function clockOf(ticks: number): string {
  const secs = Math.round((ticks * TICK_MS) / 1000);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

export interface SideTally {
  /** Huts held at every SAMPLE_TICKS ticks from the start, and at the end. */
  huts: number[];
  /** Huts it took, from anyone or nobody. Towers are not huts, as in the count. */
  taken: number;
  /** Huts another side took from it. One given up under the white flag was not taken. */
  lost: number;
  /** The most of its units at one moment on the road to one hut it did not hold, or waiting at home to set out for it. */
  column: number;
  /** The longest it held a hut it took, in ticks, to the hut's loss or the end. */
  hold: number;
}

export interface Tally {
  tick: number;
  sides: Partial<Record<Seat, SideTally>>;
  owners: Owner[];
  /** The tick each hut was taken by its holder; -1 for a hut held from the start, or nobody's. */
  since: number[];
  /** The tick of each sample in every side's `huts`. */
  sampled: number[];
}

export function newTally(map: SwarmMap, start: SwarmState): Tally {
  const sides: Partial<Record<Seat, SideTally>> = {};
  for (const side of map.sides) sides[side] = { huts: [countOf(start, side).huts], taken: 0, lost: 0, column: 0, hold: 0 };
  return { tick: start.tick, sides, owners: start.huts.map((hut) => hut.owner), since: start.huts.map(() => -1), sampled: [start.tick] };
}

/** Takes in the state after the next tick. A tick out of order is a bug in the caller, and a tally kept through one would be wrong. */
export function tallyStep(tally: Tally, map: SwarmMap, state: SwarmState): void {
  if (state.tick !== tally.tick + 1) throw new Error(`Swarm tally: tick ${state.tick} after ${tally.tick}`);
  tally.tick = state.tick;

  state.huts.forEach((hut, at) => {
    const was = tally.owners[at];
    if (hut.owner === was) return;
    tally.owners[at] = hut.owner;
    if (map.sites[at].tower) return;
    if (was) {
      const holder = tally.sides[was]!;
      if (tally.since[at] !== -1) holder.hold = Math.max(holder.hold, state.tick - tally.since[at]);
      if (hut.owner) holder.lost++;
    }
    tally.since[at] = -1;
    if (hut.owner) {
      tally.sides[hut.owner]!.taken++;
      tally.since[at] = state.tick;
    }
  });

  for (const side of map.sides) {
    const on = state.huts.map(() => 0);
    for (const unit of state.units) if (unit.seat === side && state.huts[unit.dest].owner !== side) on[unit.dest]++;
    // A column leaves a unit at a time, so on a short road most of it is still at home.
    for (const hut of state.huts) {
      if (hut.owner !== side) continue;
      for (const line of hut.out) if (state.huts[line.dest].owner !== side) on[line.dest] += line.n;
    }
    const record = tally.sides[side]!;
    record.column = Math.max(record.column, ...on);
  }

  if (state.tick % SAMPLE_TICKS === 0 || state.winner !== null) {
    tally.sampled.push(state.tick);
    for (const side of map.sides) tally.sides[side]!.huts.push(countOf(state, side).huts);
  }
  if (state.winner !== null) {
    // Holds still going at the end count to the end.
    tally.since.forEach((since, at) => {
      const owner = tally.owners[at];
      if (since !== -1 && owner) tally.sides[owner]!.hold = Math.max(tally.sides[owner]!.hold, state.tick - since);
    });
  }
}
