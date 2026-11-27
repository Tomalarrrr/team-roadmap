// What the game screen runs a match through, so the same screen plays a match
// on one machine or one shared with a friend online. The screen draws whatever
// state the driver hands back and never advances the rules itself.

import type { Input, SlugsState } from '../../slugsGameLogic';

export interface GameDriver {
  /**
   * Bring the match up to wall-clock `now` (ms) and return the state to draw.
   * `input` is what this machine's player is pressing; the driver gives it to
   * the rules only on ticks where a team this machine controls is playing.
   */
  tick(now: number, input: Input): SlugsState;
  /** Team indices this machine's player controls. */
  readonly mine: readonly number[];
  /**
   * Stop the match where it is, or let it go on from there. Only a match on
   * this machine has one: online, the others' clocks would run on regardless.
   */
  hold?(on: boolean): void;
  dispose(): void;
}
