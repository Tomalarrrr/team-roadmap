// A match shared with a friend online: the GameDriver the screen runs, over
// the lockstep in slugsSync and the room in slugsApi. The network side is
// Swarm's (SwarmGame.tsx): the room is followed over its stream while that
// delivers and read on a timer while it does not, one seat write is in flight
// at a time, and a seat silent for 90 seconds is given up.

import {
  followRoom,
  getChunks,
  getRoom,
  putChunk,
  putSeat,
  recordResult,
  seatOf,
  vacateSeat,
} from '../../api/slugsApi';
import type { Seat, SlugsMatch, SlugsRoom } from '../../api/slugsApi';
import type { Input, SlugEvent, SlugsState } from '../../slugsGameLogic';
import { BEAT_LIVE_MS, POLL_LIVE_MS, silent, SILENT_LIVE_MS } from '../swarm/swarmSync';
import type { Ear } from '../swarm/swarmSync';
import type { GameDriver } from './driver';
import { addChunks, frame, landed, newLockstep, reportDue, resultOf, sealed, sending, takeRoom } from './slugsSync';

/** rAF stops in a hidden tab; this keeps the match running and the seat reporting from there. */
const BACKGROUND_PUMP_MS = 250;
/** Swarm's stream timings; see SwarmGame.tsx. */
const STREAM_FIRST_MS = 3000;
const STREAM_GRACE_MS = 2000;
const REFOLLOW_MS = 5000;
const REFOLLOW_MAX_MS = 60_000;
/** Reads failing in a row before the link is shown as lost. */
const FAILURES_LOST = 3;
/** A seat that wrote nothing for this long is shown as reconnecting: three of its beats. */
const QUIET_MS = 3 * BEAT_LIVE_MS;

const ROOM_KEY = 'slugs-room';

/** The room this tab is in, so a reload goes straight back to it. */
export function recallRoom(): string {
  try {
    return sessionStorage.getItem(ROOM_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberRoom(code: string | null) {
  try {
    if (code) sessionStorage.setItem(ROOM_KEY, code);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    // sessionStorage blocked (private browsing): rejoin by hand
  }
}

export interface OtherSeat {
  seat: Seat;
  name: string;
  state: 'here' | 'reconnecting' | 'left';
  /** While reconnecting: seconds before the seat is given up. */
  secondsLeft?: number;
}

export interface OnlineStatus {
  /** Whether this client can read the room. */
  link: 'connected' | 'lost';
  others: OtherSeat[];
  /** Once the match is decided: by the rules, or by a forfeit when the other person left. */
  result: { winner: Seat | 'draw'; forfeit: boolean; mine: boolean } | null;
  /** The room has started a newer game than this one. */
  next: boolean;
}

export interface OnlineDriver extends GameDriver {
  readonly code: string;
  readonly seat: Seat;
  status(): OnlineStatus;
  /** Leave the match on purpose. In a game of two that is a forfeit. */
  leave(): Promise<void>;
}

/**
 * Throws when this session has no seat in `match`, or `match` was set up by a
 * newer version: either way this client cannot play it.
 */
export function onlineDriver(code: string, sessionId: string, match: SlugsMatch): OnlineDriver {
  const seat = seatOf(match, sessionId);
  if (!seat) throw new Error('You do not have a seat in that match.');
  const ls = newLockstep(match, seat);
  const mine = [ls.seats.indexOf(seat)];
  const names = new Map(ls.seats.map((each, i) => [each, ls.setups[i].name]));

  let room: SlugsRoom | null = null;
  /** No write goes until the room has been read once: a reload has to take back its own inputs first. */
  let heard = false;
  let failures = 0;
  let seq = Math.floor(Math.random() * 1e9);
  let putBusy = false;
  let sentAt = -Infinity;
  let resultSent = false;
  const ears: Partial<Record<Seat, Ear>> = {};
  const fetching = new Set<Seat>();
  /** Events run by the background pump that the screen has not been given. */
  let unseen: SlugEvent[] = [];
  let lastKeys = 0;

  let running = false;
  let pollTimer = 0;
  let pumpTimer = 0;
  let unfollow: (() => void) | null = null;
  let followedAt = 0;
  let heardAt = 0;
  let followAt = 0;
  let refollow = REFOLLOW_MS;

  const forfeited = () => room?.m.game === ls.game && room.m.status === 'finished' && room.m.gone !== undefined;

  const take = (next: SlugsRoom | null) => {
    failures = 0;
    if (!next) return;
    room = next;
    heard = true;
    const missing = next.m.game === ls.game ? takeRoom(ls, next) : [];
    for (const each of missing) fetchChunks(each);

    const now = performance.now();
    const playing = next.m.status === 'playing' && next.m.game === ls.game;
    const away = next.m.out?.[seat] !== undefined;
    for (const other of ls.seats) {
      if (other === seat || !next.m.players[other]) continue;
      const ear = (ears[other] ??= { seq: undefined, at: now, playing: false });
      const theirs = next.s?.[other];
      const seated = next.m.out?.[other] === undefined && !away;
      if (silent(ear, seated, theirs?.seq, playing, now)) {
        const k = theirs?.game === ls.game ? theirs.k : 0;
        vacateSeat(code, other, k).catch((err) => console.warn('[Slugs] Could not release the silent seat:', err));
      }
    }
  };

  const fetchChunks = (each: Seat) => {
    if (fetching.has(each)) return;
    fetching.add(each);
    getChunks(code, ls.game, each)
      .then((byKey) => {
        addChunks(ls, each, byKey);
        if (room) take(room);
      })
      .catch((err) => console.warn('[Slugs] Could not read sealed inputs:', err))
      .finally(() => fetching.delete(each));
  };

  const follow = () => {
    followedAt = performance.now();
    unfollow = followRoom(
      code,
      (next) => {
        if (!running) return;
        heardAt = performance.now();
        refollow = REFOLLOW_MS;
        take(next);
        pump();
      },
      () => {
        if (running) dropStream(heardAt === 0);
      }
    );
  };

  const dropStream = (neverDelivered: boolean) => {
    unfollow?.();
    unfollow = null;
    heardAt = 0;
    followAt = performance.now() + (neverDelivered ? refollow : 0);
    if (neverDelivered) refollow = Math.min(refollow * 2, REFOLLOW_MAX_MS);
  };

  const poll = async () => {
    const now = performance.now();
    if (unfollow && (heardAt ? now - heardAt > BEAT_LIVE_MS * 2 + STREAM_GRACE_MS : now - followedAt > STREAM_FIRST_MS)) {
      console.warn(heardAt ? '[Slugs] Room stream went quiet; reading the room instead' : '[Slugs] Room stream sent nothing; reading the room instead');
      dropStream(heardAt === 0);
    }
    if (!unfollow && now >= followAt && typeof EventSource !== 'undefined') follow();
    if (!heardAt) {
      try {
        const next = await getRoom(code);
        if (!running) return;
        if (!heardAt) take(next);
      } catch (err) {
        if (!running) return;
        console.warn('[Slugs] Room read failed:', err);
        failures++;
        // Silence is only counted against the other seats while this one can hear.
        for (const ear of Object.values(ears)) ear.at = performance.now();
      }
    }
    pump();
    if (running) pollTimer = window.setTimeout(poll, POLL_LIVE_MS);
  };

  const advanceTo = (now: number, input: Input) => {
    if (!heard || forfeited()) return;
    const state = frame(ls, now, input);
    unseen.push(...state.events);
    state.events = [];
  };

  const report = () => {
    if (!heard || putBusy || !reportDue(ls, performance.now() - sentAt)) return;
    const { write, seal } = sending(ls, ++seq);
    putBusy = true;
    sentAt = performance.now();
    const sealFirst = seal ? putChunk(code, ls.game, seat, seal.index, seal.text).then(() => sealed(ls, seal)) : Promise.resolve();
    sealFirst
      .then(() => putSeat(code, seat, write))
      .then(
        () => landed(ls, write),
        // The next write is due straight away and carries everything this one did.
        (err) => {
          console.warn('[Slugs] Report failed:', err);
          sentAt = -Infinity;
        }
      )
      .finally(() => {
        putBusy = false;
      });
  };

  const settle = () => {
    const winner = resultOf(ls);
    if (winner === null || resultSent || room?.m.status !== 'playing' || room.m.game !== ls.game) return;
    resultSent = true;
    recordResult(code, ls.game, winner).catch((err) => {
      console.warn('[Slugs] Could not record the result:', err);
      resultSent = false;
    });
  };

  // The background half of a frame: the screen's own frames do the same while it is drawn.
  const pump = () => {
    advanceTo(performance.now(), { keys: lastKeys });
    settle();
    report();
  };

  const start = () => {
    if (running) return;
    running = true;
    void poll();
    pumpTimer = window.setInterval(pump, BACKGROUND_PUMP_MS);
  };

  const stop = () => {
    running = false;
    window.clearTimeout(pollTimer);
    window.clearInterval(pumpTimer);
    unfollow?.();
    unfollow = null;
    heardAt = 0;
  };

  return {
    code,
    seat,
    mine,
    tick(now: number, input: Input): SlugsState {
      // The screen is mounted twice in development (StrictMode) and disposes the first.
      start();
      lastKeys = input.keys;
      advanceTo(now, input);
      settle();
      report();
      ls.state.events = unseen;
      unseen = [];
      return ls.state;
    },
    status(): OnlineStatus {
      const m = room?.m;
      const now = performance.now();
      const others: OtherSeat[] = [];
      for (const other of ls.seats) {
        if (other === seat || !match.players[other]) continue;
        const name = names.get(other)!;
        const left = !m || m.game !== ls.game ? false : !m.players[other] || m.out?.[other] !== undefined || m.gone === other;
        const ear = ears[other];
        if (left) others.push({ seat: other, name, state: 'left' });
        else if (ear && heard && m?.status === 'playing' && now - ear.at > QUIET_MS) {
          others.push({ seat: other, name, state: 'reconnecting', secondsLeft: Math.max(0, Math.ceil((SILENT_LIVE_MS - (now - ear.at)) / 1000)) });
        } else others.push({ seat: other, name, state: 'here' });
      }
      let result: OnlineStatus['result'] = null;
      if (m && forfeited()) result = { winner: m.winner!, forfeit: true, mine: m.winner === seat };
      else {
        const winner = resultOf(ls);
        if (winner !== null) result = { winner, forfeit: false, mine: winner === seat };
      }
      return {
        link: failures >= FAILURES_LOST ? 'lost' : 'connected',
        others,
        result,
        next: Boolean(m && m.game > ls.game),
      };
    },
    async leave() {
      stop();
      rememberRoom(null);
      await vacateSeat(code, seat, ls.promised);
    },
    // Not a forfeit: the screen disposes on unmount, which a reload or StrictMode also does.
    dispose: stop,
  };
}

