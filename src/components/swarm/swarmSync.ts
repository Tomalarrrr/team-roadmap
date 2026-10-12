// What keeps two clients' games the same game.
//
// Its own module because none of it is drawing or rules, and because it has to
// be run without a browser to be believed: the tests play two clients against
// one room through these functions and compare the boards they end on.
//
// The room holds, for each seat, every order that seat has given and a promise
// `k`: nothing more will be added for a tick up to k. A client runs its
// confirmed state only as far as the other seat's promise, so what it has run
// is final. Everything below protects that one sentence.
//
// A seat is usually written by one tab, but not always: a reload leaves the
// old page's last write in flight behind the new page's first, and the same
// seat can be open twice. So a write names the write it was built on (`base`)
// and the rules refuse it when the room has moved on. Whoever is refused reads
// the room, takes in what it holds, and says its piece again on top of that.

import {
  advance,
  cloneState,
  MATCH_TICKS,
  decodeOrders,
  encodeOrders,
  newState,
  otherSeat,
  type Order,
  type Seat,
  type SwarmMap,
  type SwarmMatch,
  type SwarmSeatState,
  type SwarmState,
} from '../../swarmGameLogic';

export const POLL_LIVE_MS = 150;
export const POLL_IDLE_MS = 800;
/** Nobody is looking and nothing is being played: the room is only kept. */
export const POLL_AWAY_MS = 5000;
/** With no new order to send, a seat still writes this often, so that it is heard and its clock stays set. */
export const BEAT_LIVE_MS = 1000;
export const BEAT_IDLE_MS = 5000;
export const BEAT_AWAY_MS = 15_000;
/**
 * Short in a game, long outside one, as in Snake, but twice Snake's in a game:
 * an army keeps marching through a bad patch on a VPN, where a snake would
 * have died, so a slow connection is worth waiting out.
 */
export const SILENT_LIVE_MS = 20_000;
export const SILENT_IDLE_MS = 90_000;

/** What one client has heard of the other seat: its last write, and when that was first read. */
export interface Ear {
  seq: number | undefined;
  at: number;
  playing: boolean;
}

/**
 * Take in a read of the room, and say whether the other seat has now been
 * silent long enough to be given up.
 */
export function silent(ear: Ear, seated: boolean, seq: number | undefined, playing: boolean, now: number): boolean {
  // A game's silence is counted from its start. The seat was writing at the
  // lobby's rate until then, and in a hidden tab that is close to all a game allows.
  if (!seated || seq !== ear.seq || playing !== ear.playing) {
    ear.seq = seq;
    ear.at = now;
    ear.playing = playing;
    return false;
  }
  if (now - ear.at <= (playing ? SILENT_LIVE_MS : SILENT_IDLE_MS)) return false;
  ear.at = now;
  return true;
}

/**
 * How often to read the room and how often to write the seat with nothing new
 * to say. A game is paced the same in a hidden tab as in a shown one, or the
 * player who looked away would forfeit it. A clock not yet set writes at the
 * game's rate wherever it is, because a write is how it gets set.
 */
export function pace(playing: boolean, hidden: boolean, synced: boolean): { poll: number; beat: number } {
  if (playing) return { poll: POLL_LIVE_MS, beat: BEAT_LIVE_MS };
  const poll = hidden ? POLL_AWAY_MS : POLL_IDLE_MS;
  if (!synced) return { poll, beat: BEAT_LIVE_MS };
  return { poll, beat: hidden ? BEAT_AWAY_MS : BEAT_IDLE_MS };
}

// The same shape the database rules hold a seat's orders to. decodeOrders
// reads a character at a fixed place after the colon and throws when it is not
// there, and it is called every frame.
const ORDERS_SHAPE = /^([0-9a-z]{1,4}:[a-zA-Z][0-9a-z][0-9a-z](,[0-9a-z]{1,4}:[a-zA-Z][0-9a-z][0-9a-z])*)?$/;

/** Whether a seat's state as read from the room is one a game can be run on. Anyone can write there. */
export function sound(state: SwarmSeatState): boolean {
  return (
    Number.isInteger(state.game) &&
    Number.isInteger(state.k) &&
    state.k >= 0 &&
    typeof state.orders === 'string' &&
    ORDERS_SHAPE.test(state.orders)
  );
}

/**
 * The tick a new order takes effect on. Never at or before a tick this seat
 * has promised complete, never at or before one this client has already run
 * for good, and never out of order. The second is not implied by the first:
 * the promise moves when a report is sent and the confirmed state moves every
 * frame, and a server clock that steps back can put `earliest` behind both.
 */
export function orderTick(earliest: number, promised: number, confirmed: number, last: number): number {
  return Math.max(earliest, promised + 1, confirmed + 1, last);
}

const sameOrder = (a: Order, b: Order): boolean =>
  a.tick === b.tick && a.kind === b.kind && a.from === b.from && a.to === b.to && !a.risky === !b.risky;

/**
 * This seat's orders once what the room holds for it is taken in: `mine`
 * itself when that changes nothing. Otherwise the room's orders come first,
 * as the other client has them, and after them whatever this client gave that
 * the room's promise still leaves room for. An order the room does not hold
 * for a tick it has promised complete is dropped, even when the room's orders
 * are all here already: the other client may have run past that tick without
 * it. One tab never has such an order. A second tab on the same seat does.
 */
export function withStored(mine: Order[], stored: Pick<SwarmSeatState, 'k' | 'orders'>): Order[] {
  const kept = decodeOrders(stored.orders);
  let shared = 0;
  while (shared < mine.length && shared < kept.length && sameOrder(mine[shared], kept[shared])) shared++;
  const unsent = mine.slice(shared);
  if (shared === kept.length && unsent.every((order) => order.tick > stored.k)) return mine;
  return [...kept, ...unsent.filter((order) => order.tick > stored.k)];
}

/** A seat's state as it is sent: the server adds the time, and `base` is the write this one replaces. */
export type SeatWrite = Omit<SwarmSeatState, 'at'> & { base?: number };

/**
 * What a seat reports while it has no game running. In a game it could not
 * yet join (its clock is not set, as after a reload) it repeats what the room
 * holds for it: saying "no game" there would withdraw orders the other client
 * has already run.
 */
export function restingReport(match: SwarmMatch, stored: SwarmSeatState | undefined, seq: number): SeatWrite {
  if (match.status === 'playing' && stored?.game === match.game) {
    return { seq, game: stored.game, k: stored.k, orders: stored.orders, base: stored.seq };
  }
  return { seq, game: 0, k: 0, orders: '' };
}

/** One game's orders and states as one client holds them. */
export interface Lockstep {
  game: number;
  map: SwarmMap;
  orders: Record<Seat, Order[]>;
  /** Run to the other seat's promise: final, and the same on both clients. */
  confirmed: SwarmState;
  /** The confirmed state run on to now on the orders known so far. */
  shown: SwarmState;
  theirText: string;
  /** The write of this seat that this client's orders are built on: the last it took in from the room, or its own last to land. */
  ownSeq: number | undefined;
  /** Every write of this tab's in this game, oldest first: how it tells its own from another tab's on the same seat. */
  sent: number[];
  /** The last tick this seat promised its orders complete through. */
  promised: number;
}

/**
 * Whether a read of the room shows a write of this tab's older than one it
 * knows has landed since. Reads and writes cross on the wire all the time,
 * and going back to the older one would get the next write refused.
 */
function behind(game: Lockstep, seen: number): boolean {
  return game.ownSeq !== undefined && seen < game.ownSeq && game.sent.includes(seen) && game.sent.includes(game.ownSeq);
}

/** What this seat writes at `tick`. Sending it is a promise, so it is made here and not when the write lands. */
export function sending(game: Lockstep, seat: Seat, seq: number, tick: number): SeatWrite {
  game.promised = Math.max(game.promised, Math.min(tick, MATCH_TICKS), 0);
  game.sent.push(seq);
  return {
    seq,
    game: game.game,
    k: game.promised,
    orders: encodeOrders(game.orders[seat]),
    ...(game.ownSeq !== undefined && { base: game.ownSeq }),
  };
}

/**
 * Bring a client's game up to `tick` on what the room holds for both seats.
 *
 * The room's copy of this seat's own orders is read as well as the other
 * seat's. A tab that was reloaded starts with none and has to take them back,
 * and the same seat open in a second tab is giving orders this one has not
 * seen; either way the other client is running them.
 */
export function settle(
  game: Lockstep,
  seat: Seat,
  seats: Partial<Record<Seat, SwarmSeatState>> | undefined,
  tick: number,
  onStep?: (state: SwarmState) => void
): void {
  let rerun = false;
  const own = seats?.[seat];
  if (own && own.game === game.game && own.seq !== game.ownSeq && !behind(game, own.seq)) {
    game.ownSeq = own.seq;
    game.promised = Math.max(game.promised, own.k);
    const taken = withStored(game.orders[seat], own);
    if (taken !== game.orders[seat]) {
      game.orders[seat] = taken;
      // What was taken in can be for a tick already run, so it is all run again.
      game.confirmed = newState(game.map);
      rerun = true;
    }
  }

  const opp = otherSeat(seat);
  const theirs = seats?.[opp];
  let theirK = game.confirmed.tick;
  if (theirs && theirs.game === game.game) {
    theirK = theirs.k;
    if (theirs.orders !== game.theirText) {
      game.theirText = theirs.orders;
      game.orders[opp] = decodeOrders(theirs.orders);
    }
  }
  advance(game.confirmed, game.map, game.orders, Math.min(tick, theirK), null);
  if (rerun || game.shown.tick !== tick || game.shown.tick < game.confirmed.tick) {
    game.shown = cloneState(game.confirmed);
    advance(game.shown, game.map, game.orders, tick, null, onStep);
  }
}
