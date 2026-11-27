// The instant replay: a shot that kills or hurts badly is shown again, slowed,
// before the tally. It is picture only. The rules are run again on a copy of
// an earlier state with the inputs this machine recorded, and the copy is what
// gets drawn; the match itself is never touched, so a lockstep match could not
// be split by it (and online matches do not replay at all: see the scene).
//
// Re-running a whole turn would be slow: a computer's turn costs about half a
// millisecond a tick to think. So the log keeps a copy of the state every
// SNAP_EVERY ticks and pins the one from just before the shot; the replay runs
// from there, and the ticks after a shot cost next to nothing.

import { advance } from '../../slugsGameLogic';
import type { Input, SlugEvent, SlugsState } from '../../slugsGameLogic';

/** Ticks between kept copies of the state, and how many are kept, so one is always LEAD_IN or more before a shot. */
const SNAP_EVERY = 25;
const SNAPS_KEPT = 3;
/** Ticks of the turn shown before the shot: the aim, then the throw. */
export const LEAD_IN = 25;
/** Most match ticks a replay shows: 5 s of match, 10 s on screen at REPLAY_RATE. */
export const REPLAY_MOST = 250;
/** Match ticks shown per tick of wall time. */
export const REPLAY_RATE = 0.5;

export interface TurnLog {
  /** Tick of the state the log began at; inputs[i] was given on tick from + i + 1. */
  from: number;
  inputs: Input[];
  snaps: SlugsState[];
  /** The copy a replay of this turn starts from, set by the last shot before anyone was hurt. */
  pin: SlugsState | null;
  harmed: boolean;
}

export interface Replay {
  /** The copy being drawn. */
  state: SlugsState;
  end: number;
  from: number;
  inputs: Input[];
}

const attacks = (events: SlugEvent[]) => events.some((e) => e.k === 'fire' || e.k === 'shot' || e.k === 'blow');
const harms = (events: SlugEvent[]) => events.some((e) => e.k === 'hurt' || e.k === 'drown');

/** A log for the turn that has just begun in `state`. */
export function startLog(state: SlugsState): TurnLog {
  return { from: state.tick, inputs: [], snaps: [structuredClone(state)], pin: null, harmed: false };
}

/**
 * Called once a live frame, after its ticks, with the input each of those ticks
 * was given. `state.events` holds every event of those ticks.
 */
export function noteFrame(log: TurnLog, state: SlugsState, given: Input[]) {
  log.inputs.push(...given);
  if (log.harmed) return;
  if (attacks(state.events)) {
    const before = state.tick - given.length - LEAD_IN;
    // No copy that early means the shot came straight after the turn began, whose copy is the oldest.
    log.pin = log.snaps[0];
    for (const s of log.snaps) if (s.tick <= before) log.pin = s;
  }
  if (harms(state.events)) {
    log.harmed = true;
    return;
  }
  if (state.tick - log.snaps[log.snaps.length - 1].tick >= SNAP_EVERY) {
    log.snaps.push(structuredClone(state));
    if (log.snaps.length > SNAPS_KEPT) log.snaps.shift();
  }
}

/**
 * Whether what happened between `before` and `after` is worth showing again: a slug
 * killed or drowned, or half a slug's starting health lost across everyone. The
 * classic game's own trigger is not known (research doc M16); this one is ours.
 */
export function worthReplay(before: SlugsState, after: SlugsState): boolean {
  let lost = 0;
  for (const was of before.slugs) {
    if (!was.alive) continue;
    const now = after.slugs[was.id];
    if (!now.alive || now.hp <= 0) return true;
    lost += was.hp - now.hp;
  }
  return lost * 2 >= after.opts.startHp;
}

/** Whether two states are the same match at the same moment, as far as the picture goes. */
function sameMatch(a: SlugsState, b: SlugsState): boolean {
  if (a.tick !== b.tick || a.rng !== b.rng || a.phase !== b.phase) return false;
  if (a.projs.length !== b.projs.length || a.objs.length !== b.objs.length) return false;
  if (a.slugs.some((s, i) => s.x !== b.slugs[i].x || s.y !== b.slugs[i].y || s.hp !== b.slugs[i].hp || s.alive !== b.slugs[i].alive)) return false;
  return a.terrain.every((v, i) => v === b.terrain[i]);
}

function step(state: SlugsState, from: number, inputs: Input[]) {
  advance(state, inputs[state.tick - from]);
}

/**
 * The replay of the turn `log` recorded, now that `live` has reached its tally,
 * or null when there is nothing worth showing. The rules are run from the pin to
 * `live` first, to find where the shot's story ends and to check the recording
 * comes out where the match did; a replay that would show something else is not
 * shown.
 */
export function planReplay(log: TurnLog, live: SlugsState): Replay | null {
  if (!log.pin || !worthReplay(log.pin, live)) return null;
  const check = structuredClone(log.pin);
  let tally = -1;
  while (check.tick < live.tick) {
    step(check, log.from, log.inputs);
    if (tally < 0 && check.phase === 'tally') tally = check.tick;
  }
  if (!sameMatch(check, live)) {
    console.warn(`[Slugs] replay of tick ${log.pin.tick} to ${live.tick} came out different from the match; not shown`);
    return null;
  }
  const state = structuredClone(log.pin);
  state.events = [];
  return { state, end: Math.min(tally, log.pin.tick + REPLAY_MOST), from: log.from, inputs: log.inputs };
}

/** Run the replay on one tick. False once it has shown everything. */
export function stepReplay(r: Replay): boolean {
  if (r.state.tick >= r.end) return false;
  step(r.state, r.from, r.inputs);
  return true;
}
