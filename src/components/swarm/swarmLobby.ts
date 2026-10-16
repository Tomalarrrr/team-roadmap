// What the lobby holds a game's rules to before it starts: the sides a mode
// needs, the twists a mode leaves with nothing to do, and the Surprise draw,
// which keeps to both. The database takes any mix, so nothing else does.

import { CLASSIC, MODE_IDS, START_IDS, TWISTS, mulberry32, type ModeId, type Rules, type Twist } from '../../swarmGameLogic';

export type RulesChoice = Pick<Rules, 'mode' | 'start' | 'twists'>;

/** What a mode needs of the sides, and what Start says when they fall short. */
const NEEDS: Partial<Record<ModeId, (people: number, computers: number) => string | null>> = {
  teams: (people, computers) => (people + computers === 4 ? null : `Teams needs 4 sides; there are ${people + computers}.`),
  survival: (people, computers) =>
    computers === 0 ? 'Survival needs a computer side to hold out against.' : people === 0 ? 'Survival needs a person to play it.' : null,
};

/** Why a mode cannot be played by the sides there are, or null when it can. */
export function unfit(mode: ModeId, people: number, computers: number): string | null {
  const needs = NEEDS[mode];
  return needs ? needs(people, computers) : null;
}

/** A twist that would change nothing in a mode, and what its pill says instead of what it does. */
const CLASHES: { twist: Twist; mode: ModeId; why: string }[] = [
  { twist: 'queens', mode: 'regicide', why: 'Queens does nothing in Regicide: losing your home hut already puts you out.' },
];

export function clashOf(twist: Twist, mode: ModeId): string | null {
  const clash = CLASHES.find((each) => each.twist === twist && each.mode === mode);
  return clash ? clash.why : null;
}

/**
 * A mode, a start and two twists drawn from `seed` and `roll`, so a draw is
 * the same wherever it is made. Classic and Home are left out, as drawing the
 * game as it always is would be no surprise, and so is a mode the sides there
 * cannot play (`fits`) or a twist with nothing to do in the mode drawn.
 */
export function surpriseOf(seed: number, roll: number, fits: (mode: ModeId) => boolean): RulesChoice {
  const rnd = mulberry32((seed ^ Math.imul(roll + 1, 0x9e3779b1)) >>> 0);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  // Blitz needs nothing of the sides, so this is never empty.
  const mode = pick(MODE_IDS.filter((each) => each !== CLASSIC.mode && fits(each)));
  const start = pick(START_IDS.filter((each) => each !== CLASSIC.start));
  const open = TWISTS.filter((twist) => !clashOf(twist, mode));
  const first = pick(open);
  const second = pick(open.filter((twist) => twist !== first));
  return { mode, start, twists: TWISTS.filter((twist) => twist === first || twist === second) };
}
