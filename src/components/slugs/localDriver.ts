// A match played on one machine: against the computer, or by people taking
// turns at the same keyboard. Every human team is this machine's, so whatever
// is pressed goes to whichever human team is playing.

import { advance, newGame, TICK_MS } from '../../slugsGameLogic';
import type { Act, Input, SlugEvent, SlugsOptions, SlugsState, TeamSetup } from '../../slugsGameLogic';
import type { GameDriver } from './driver';

/**
 * Most ticks one call runs. A tab put in the background stops being drawn, and
 * on its return the match carries on from where it was rather than racing
 * through the minutes it missed; a slow frame still catches up in full.
 */
const CATCH_UP_MOST = 10;

export function localDriver(seed: number, setups: TeamSetup[], perTeam: number, options: Partial<SlugsOptions>): GameDriver {
  const state = newGame(seed, setups, perTeam, options);
  const mine = setups.flatMap((setup, i) => (setup.control === 'human' ? [i] : []));
  let clock: number | null = null;
  // A press can land on a frame that runs no tick (a screen faster than 50 Hz):
  // it waits here for the next one rather than being lost.
  const acts: Act[] = [];
  // `newGame` already raised the first turn's events.
  let pending: SlugEvent[] = state.events;
  let held = false;

  return {
    mine,
    tick(now: number, input: Input): SlugsState {
      if (input.act) acts.push(input.act);
      if (held) {
        // Drawn already: handed back again, they would be drawn twice.
        state.events = [];
        return state;
      }
      if (clock === null) clock = now;
      let due = Math.floor((now - clock) / TICK_MS);
      if (due > CATCH_UP_MOST) {
        clock = now - CATCH_UP_MOST * TICK_MS;
        due = CATCH_UP_MOST;
      }
      const events = pending;
      pending = [];
      for (let i = 0; i < due; i++) {
        advance(state, { keys: input.keys, act: acts.shift() });
        events.push(...state.events);
      }
      clock += due * TICK_MS;
      // `advance` keeps only its own tick's events; the screen is handed all
      // of them since it last asked, so a blast on a tick it never drew still
      // carves the picture of the ground.
      state.events = events;
      return state;
    },
    hold(on: boolean) {
      held = on;
      // Picked up from the next call's time, so the held seconds are not caught up afterwards.
      if (!on) clock = null;
    },
    restartClock() {
      clock = null;
    },
    // Nothing outside this closure to let go of: no timers, no connection.
    dispose() {},
  };
}
