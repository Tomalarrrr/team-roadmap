// Snake data access via the Vercel proxy (api/proxy.ts), on `snake/{code}`.
//
// A room is split in two so the fast path never contends with the slow one:
//   m          the match (seats, round, score). Changed only by transaction.
//   s/{seat}   one snake's live state. Written several times a second by its
//              own client and by nobody else, so a plain overwrite is safe.
// A transaction on `m` is conditional on `m` alone, so the stream of seat
// writes beside it cannot make it retry.

import {
  COUNTDOWN_MS,
  SEATS,
  WIN_ROUNDS,
  otherSeat,
  type RoundResult,
  type Seat,
  type SnakeMatch,
  type SnakeSeatState,
} from '../snakeGameLogic';
import { generateGameCode } from '../utils/gameUtils';
import { getServerTimestamp, proxyGet, proxyPut, proxyRemove, proxyTransaction } from './dbProxy';

export interface SnakeRoom {
  m: SnakeMatch;
  s?: Partial<Record<Seat, SnakeSeatState>>;
}

const STALE_ROOM_AGE_MS = 24 * 60 * 60 * 1000;
/** A beat to read the last round's result before the next countdown starts. */
const RESULT_PAUSE_MS = 1500;

const matchPath = (code: string) => `snake/${code}/m`;

function seatOf(match: SnakeMatch, sessionId: string): Seat | undefined {
  return SEATS.find((seat) => match.players[seat]?.sessionId === sessionId);
}

export async function createRoom(sessionId: string, name: string): Promise<string> {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();
    const room: SnakeRoom = {
      m: {
        status: 'waiting',
        createdAt: Date.now(),
        seed,
        players: { a: { sessionId, name } },
        round: 0,
        startAt: 0,
        scoreA: 0,
        scoreB: 0,
      },
    };
    const result = await proxyTransaction<SnakeRoom>(`snake/${code}`, (current) =>
      current === null ? room : undefined
    );
    if (result.committed) {
      void cleanupStaleRooms();
      return code;
    }
  }
  throw new Error('Could not find a free room code. Try again.');
}

async function cleanupStaleRooms(): Promise<void> {
  try {
    const rooms = await proxyGet<Record<string, SnakeRoom>>('snake');
    if (!rooms) return;
    const now = Date.now();
    await Promise.all(
      Object.entries(rooms)
        .filter(([, room]) => !room.m || now - room.m.createdAt > STALE_ROOM_AGE_MS)
        .map(([code]) => proxyRemove(`snake/${code}`))
    );
  } catch (err) {
    console.warn('[Snake] Stale room cleanup failed:', err);
  }
}

/** Take the free seat, or the one this session already holds. */
export async function joinRoom(code: string, sessionId: string, name: string): Promise<Seat> {
  let refusal = '';
  const result = await proxyTransaction<SnakeMatch>(matchPath(code), (current) => {
    refusal = 'Room not found';
    if (!current) return undefined;
    if (seatOf(current, sessionId)) return current;
    const free = SEATS.find((seat) => !current.players[seat]);
    if (!free || current.status !== 'waiting') {
      refusal = 'That room is full';
      return undefined;
    }
    return { ...current, players: { ...current.players, [free]: { sessionId, name } } };
  });
  const seat = result.snapshot && result.committed ? seatOf(result.snapshot, sessionId) : undefined;
  if (!seat) throw new Error(refusal);
  return seat;
}

export function getRoom(code: string): Promise<SnakeRoom | null> {
  return proxyGet<SnakeRoom>(`snake/${code}`);
}

/** `at` is stamped by the server; reading it back is how a client finds the server clock. */
export function putSeat(code: string, seat: Seat, state: Omit<SnakeSeatState, 'at'>): Promise<void> {
  return proxyPut(`snake/${code}/s/${seat}`, { ...state, at: getServerTimestamp() });
}

function nextRound(match: SnakeMatch, round: number, serverNow: number, pauseMs: number): SnakeMatch {
  return { ...match, status: 'playing', round, startAt: Math.round(serverNow + pauseMs + COUNTDOWN_MS) };
}

/** The match goes to `winner`, and onto the room's running tally. */
function wonBy(match: SnakeMatch, winner: Seat): SnakeMatch {
  // An absent count is a room that predates the tally, where none have been counted.
  return {
    ...match,
    winner,
    winsA: (match.winsA ?? 0) + (winner === 'a' ? 1 : 0),
    winsB: (match.winsB ?? 0) + (winner === 'b' ? 1 : 0),
  };
}

/** Start the match, or a fresh one in a finished room. Needs both seats filled. */
export async function startMatch(code: string, serverNow: number): Promise<void> {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  await proxyTransaction<SnakeMatch>(matchPath(code), (current) => {
    if (!current || current.status === 'playing' || !current.players.a || !current.players.b) return undefined;
    // Rebuilt rather than spread: the last match's winner must not carry over.
    const fresh: SnakeMatch = {
      status: 'playing',
      createdAt: current.createdAt,
      seed,
      players: current.players,
      round: 0,
      startAt: 0,
      scoreA: 0,
      scoreB: 0,
      ...(current.winsA === undefined ? {} : { winsA: current.winsA }),
      ...(current.winsB === undefined ? {} : { winsB: current.winsB }),
    };
    // Rounds keep counting across rematches. The seats still hold their last
    // published states, and a reused round number would let those settle the
    // new round before it began.
    return nextRound(fresh, current.round + 1, serverNow, 0);
  });
}

/**
 * Record a round's result and set up the next. Both clients call this with the
 * same result (see settleRound); the round check lets only the first one land.
 */
export async function recordRound(code: string, round: number, result: RoundResult, serverNow: number): Promise<void> {
  await proxyTransaction<SnakeMatch>(matchPath(code), (current) => {
    if (!current || current.status !== 'playing' || current.round !== round) return undefined;
    const scored: SnakeMatch = {
      ...current,
      scoreA: current.scoreA + (result.winner === 'a' ? 1 : 0),
      scoreB: current.scoreB + (result.winner === 'b' ? 1 : 0),
      lastWinner: result.winner,
      lastWhy: result.why,
    };
    if (result.winner !== 'draw' && Math.max(scored.scoreA, scored.scoreB) >= WIN_ROUNDS) {
      return wonBy({ ...scored, status: 'finished' }, result.winner);
    }
    return nextRound(scored, round + 1, serverNow, RESULT_PAUSE_MS);
  });
}

/**
 * Take `seat` out of the room: it left, or it has been silent too long.
 * Before the match that frees the seat; during it, the other player wins.
 */
export async function vacateSeat(code: string, seat: Seat): Promise<void> {
  let empty = false;
  await proxyTransaction<SnakeMatch>(matchPath(code), (current) => {
    empty = false;
    if (!current || !current.players[seat]) return undefined;
    if (current.status === 'playing') {
      return { ...wonBy({ ...current, status: 'finished' }, otherSeat(seat)), gone: seat };
    }
    const other = current.players[otherSeat(seat)];
    if (!other) {
      empty = true;
      return undefined;
    }
    const rest = { ...current };
    delete rest.winner;
    delete rest.gone;
    // The tally is between two players, and one of them has gone.
    delete rest.winsA;
    delete rest.winsB;
    return { ...rest, status: 'waiting', players: { [otherSeat(seat)]: other } };
  });
  // proxyTransaction reads a null return as an abort, so emptying is its own step.
  if (empty) await proxyRemove(`snake/${code}`);
}

/**
 * The server clock, estimated from this client's own writes.
 *
 * Both clients count ticks from one start time, so they need one clock, and
 * their own differ. Each seat write is stamped by the server (`at`); the stamp
 * comes back on the next room read, where it is set against the local times the
 * write was sent and acknowledged. The stamp fell somewhere in that window, so
 * the midpoint is off by at most half the round trip; the tightest of the
 * recent samples is kept.
 */
export function createServerClock(localNow: () => number) {
  const pending = new Map<number, { sent: number; acked?: number }>();
  let samples: { offset: number; rtt: number }[] = [];
  let offset: number | null = null;

  return {
    sent(seq: number) {
      pending.set(seq, { sent: localNow() });
    },
    acked(seq: number) {
      const entry = pending.get(seq);
      if (entry) entry.acked = localNow();
    },
    failed(seq: number) {
      pending.delete(seq);
    },
    /** A room read showed this client's write `seq` stamped `at`. */
    seen(seq: number, at: number) {
      const entry = pending.get(seq);
      if (!entry || entry.acked === undefined) return;
      for (const key of pending.keys()) if (key <= seq) pending.delete(key);
      samples = [...samples, { offset: at - (entry.sent + entry.acked) / 2, rtt: entry.acked - entry.sent }].slice(-8);
      offset = samples.reduce((best, sample) => (sample.rtt < best.rtt ? sample : best)).offset;
    },
    /** Server time now, or null until the first sample is in. */
    now(): number | null {
      return offset === null ? null : localNow() + offset;
    },
  };
}
