// What the scoreboard says about a match's mode and twists while it is played,
// what is said at the end, and which changes are worth a callout. All of it is
// read off the state the game keeps; nothing here keeps a record of its own.

import {
  HILL_TICKS,
  TICK_MS,
  eggHome,
  frenzied,
  goldenAt,
  middleOf,
  type Seat,
  type SwarmMap,
  type SwarmState,
} from '../../swarmGameLogic';
import type { CalloutKey } from './swarmFeel';

/** The golden hut is counted down to from this many ticks before it opens. */
export const GOLDEN_WARN_TICKS = 300;

/** A line on the scoreboard: words, then each side it is about with a figure, if any. */
export interface ModeNote {
  label: string;
  sides: { seat: Seat; text: string }[];
}

/** The side that holds the egg, carried or in a hut, or null while it lies in a neutral one. */
export function eggHolder(state: SwarmState): Seat | null {
  if (state.egg >= 0) return state.huts[state.egg].owner;
  return state.units.find((unit) => unit.egg)?.seat ?? null;
}

const seconds = (ticks: number): number => Math.floor((ticks * TICK_MS) / 1000);

/** A time into the match, as the clock would have shown it counting up. */
export function clockAt(tick: number): string {
  const secs = seconds(tick);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
}

export function modeNotes(map: SwarmMap, state: SwarmState): ModeNote[] {
  const { mode, twists } = map.rules;
  const notes: ModeNote[] = [];
  if (mode === 'hill') {
    notes.push({ label: `Hill, ${seconds(HILL_TICKS)}s wins`, sides: map.sides.map((seat) => ({ seat, text: `${seconds(state.held[seat])}s` })) });
  }
  if (mode === 'egg') {
    const holder = eggHolder(state);
    const carried = state.egg < 0;
    notes.push({ label: carried ? 'Egg carried by' : holder ? 'Egg held by' : 'Egg unclaimed', sides: holder ? [{ seat: holder, text: '' }] : [] });
  }
  if (mode === 'bounty') {
    notes.push(state.leader ? { label: `Bounty +${state.bounty} on`, sides: [{ seat: state.leader, text: '' }] } : { label: 'Bounty: no leader', sides: [] });
  }
  if (twists.includes('golden')) {
    const left = goldenAt(map) - state.tick;
    if (left > 0 && left <= GOLDEN_WARN_TICKS) notes.push({ label: `Golden hut in ${Math.ceil((left * TICK_MS) / 1000)}s`, sides: [] });
  }
  if (frenzied(map, state.tick)) notes.push({ label: 'Frenzy', sides: [] });
  return notes;
}

/** How the side is named in a sentence: "You" or "The ants", and "Your" or "The ants'". */
export type Names = (seat: Seat) => { name: string; whose: string };

const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** What the mode adds to the result, each line with the figure that tells it. */
export function modeStory(map: SwarmMap, state: SwarmState, names: Names): string[] {
  const { mode } = map.rules;
  const winner = state.winner === 'draw' ? null : state.winner;
  const lines: string[] = [];
  if (mode === 'hill') {
    const held = map.sides.filter((seat) => state.held[seat] > 0).sort((p, q) => state.held[q] - state.held[p]);
    for (const seat of held) lines.push(`${names(seat).name} held the hill ${seconds(state.held[seat])}s`);
  }
  if (mode === 'regicide') {
    const fallen = map.sides.filter((seat) => state.fallen[seat] > 0).sort((p, q) => state.fallen[p] - state.fallen[q]);
    for (const seat of fallen) lines.push(`${names(seat).whose} queen fell at ${clockAt(state.fallen[seat])}`);
    const rivals = map.sides.filter((seat) => seat !== winner);
    if (winner && rivals.every((seat) => state.fallen[seat] > 0)) lines.push(`${names(winner).name} took the last queen`);
  }
  if (mode === 'bounty') {
    const claimed = map.sides.filter((seat) => state.claimed[seat] > 0).sort((p, q) => state.claimed[q] - state.claimed[p]);
    for (const seat of claimed) lines.push(`${names(seat).name} collected the bounty ${times(state.claimed[seat])}`);
  }
  // With three sides the egg starts in the middle side's home, and lying there at the end says nothing about who carried it.
  if (mode === 'egg' && winner && eggHome(map, state) === winner && state.egg !== middleOf(map)) {
    lines.push(`${names(winner).name} got the egg home at ${clockAt(state.tick)}`);
  }
  return lines;
}

/** The mode's news for `seat` in the step from `before` to `after`. Like every callout, each is a change, not a condition. */
export function modeCallouts(before: SwarmState, after: SwarmState, map: SwarmMap, seat: Seat): CalloutKey[] {
  const { mode, twists } = map.rules;
  const due: CalloutKey[] = [];
  if (mode === 'hill') {
    const crown = middleOf(map);
    const was = before.huts[crown].owner;
    const now = after.huts[crown].owner;
    if (was !== seat && now === seat) due.push('hillTaken');
    if (was === seat && now !== seat) due.push('hillLost');
  }
  if (mode === 'egg') {
    const was = eggHolder(before);
    const now = eggHolder(after);
    if (was !== seat && now === seat) due.push('eggTaken');
    if (was === seat && now !== seat && now !== null) due.push('eggLost');
  }
  if (mode === 'regicide' || twists.includes('queens')) {
    const home = after.homes[map.sides.indexOf(seat)];
    if (before.huts[home].owner === seat && after.huts[home].owner !== seat) due.push('queenLost');
  }
  if (twists.includes('golden') && !before.huts.some((hut) => hut.gold) && after.huts.some((hut) => hut.gold)) due.push('goldenHut');
  if (!frenzied(map, before.tick) && frenzied(map, after.tick)) due.push('frenzy');
  return due;
}
