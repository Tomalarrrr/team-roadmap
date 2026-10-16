// What the score line and the power pills say of the flood and the powers.
// Read off the state the board shows, each frame, so the pills and the board
// never disagree.

import { POWERS, TICK_MS, floodDue, floodsOf, type Order, type Power, type Seat, type SwarmMap, type SwarmState } from '../../swarmGameLogic';

/**
 * - ready: it can be used;
 * - armed: picked, and waiting for the tap or the drag that aims it;
 * - sent: ordered, and the order has not reached its tick;
 * - running: used, and still at work: `left` says how much;
 * - used: spent and done with.
 */
export type PillState = 'ready' | 'armed' | 'sent' | 'running' | 'used';

export interface PowerPill {
  power: Power;
  state: PillState;
  /** While it runs: seconds of rain, or units of the call or the decoy still on the road. */
  left?: string;
}

/**
 * The pills for `seat`, or null when the game has no powers. `calledOn` is
 * the hut its call went to, which the state does not keep.
 */
export function pillsOf(map: SwarmMap, state: SwarmState, orders: readonly Order[], seat: Seat, armed: Power | null, calledOn: number | null): PowerPill[] | null {
  if (!map.rules.twists.includes('powers')) return null;
  const used = state.powers[seat];
  return POWERS.map((power) => {
    if (!used.includes(power)) {
      if (orders.some((order) => order.kind === power && order.tick > state.tick)) return { power, state: 'sent' };
      return { power, state: armed === power ? 'armed' : 'ready' };
    }
    let left = 0;
    if (power === 'rain' && state.rain >= state.tick) {
      return { power, state: 'running', left: `${Math.ceil(((state.rain - state.tick + 1) * TICK_MS) / 1000)}s` };
    }
    if (power === 'call' && calledOn !== null) {
      for (const unit of state.units) if (unit.seat === seat && !unit.decoy && unit.dest === calledOn) left++;
      for (const hut of state.huts) if (hut.owner === seat) for (const line of hut.out) if (line.dest === calledOn) left += line.n;
    }
    if (power === 'decoy') {
      for (const unit of state.units) if (unit.seat === seat && unit.decoy) left++;
      for (const decoy of state.decoys) if (decoy.seat === seat) left += decoy.n;
    }
    return left > 0 ? { power, state: 'running', left: String(left) } : { power, state: 'used' };
  });
}

/**
 * Seconds until the next ring of the flood goes under, 'over' once the last
 * has gone, and null in a game with no flood. Shown from the start, so the
 * line under the clock is there all game and the board never moves under it.
 */
export function floodIn(map: SwarmMap, tick: number): number | 'over' | null {
  if (floodsOf(map).length === 0) return null;
  const due = floodDue(map, tick + 1);
  if (!due) return 'over';
  return Math.ceil(((due.tick - tick) * TICK_MS) / 1000);
}
