// Swarm data access via the Vercel proxy (api/proxy.ts), on `swarm/{code}`.
//
// Split the way Snake's room is, and for the same reason:
//   m          the match (seats, game, result). Changed only by transaction.
//   s/{seat}   one player's orders. Written by its own client, which can be
//              two tabs or a page and its reload, so a write names the one
//              it replaces and the rules refuse it when that has moved on.

import {
  COUNTDOWN_MS,
  SEATS,
  otherSeat,
  type MapId,
  type Seat,
  type Side,
  type SwarmMatch,
  type SwarmSeatState,
} from '../swarmGameLogic';
import { generateGameCode } from '../utils/gameUtils';
import { bust, getServerTimestamp, proxyGet, proxyPut, proxyRemove, proxyTransaction } from './dbProxy';

export interface SwarmRoom {
  m: SwarmMatch;
  s?: Partial<Record<Seat, SwarmSeatState>>;
}

const STALE_ROOM_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * A seat written this recently has a tab open on it, however old the room is.
 * Five times the slowest a tab writes: a hidden one is throttled by the
 * browser to about once a minute.
 */
const HEARD_RECENTLY_MS = 5 * 60 * 1000;
const ROOM_CODE = /^[A-Z0-9]{4}$/;

/**
 * How long a room read or a seat write may hang before it is dropped and sent
 * again. It has to sit well inside the silence a seat is given up after (see
 * SwarmGame), or one stuck request reads to the other player as having left.
 * Not shorter: through the proxy 11 of 300 requests took over 2s from home
 * broadband, and dropping a slow one costs a fresh connection, which on a
 * corporate VPN is slower again, so a 2s limit fed its own timeouts.
 */
const LIVE_TIMEOUT_MS = 6000;

const matchPath = (code: string) => `swarm/${code}/m`;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export function seatOf(match: SwarmMatch, sessionId: string): Seat | undefined {
  return SEATS.find((seat) => match.players[seat]?.sessionId === sessionId);
}

export async function createRoom(sessionId: string, name: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();
    const room: SwarmRoom = {
      m: {
        status: 'waiting',
        createdAt: Date.now(),
        seed: newSeed(),
        players: { a: { sessionId, name } },
        game: 0,
        startAt: 0,
      },
    };
    const result = await proxyTransaction<SwarmRoom>(`swarm/${code}`, (current) =>
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
    const rooms = await proxyGet<Record<string, SwarmRoom>>('swarm');
    if (!rooms) return;
    const now = Date.now();
    await Promise.all(
      Object.entries(rooms)
        .filter(
          ([, room]) =>
            !room.m ||
            (now - room.m.createdAt > STALE_ROOM_AGE_MS &&
              !Object.values(room.s ?? {}).some((seat) => now - seat.at < HEARD_RECENTLY_MS))
        )
        .map(([code]) => proxyRemove(`swarm/${code}`))
    );
  } catch (err) {
    console.warn('[Swarm] Stale room cleanup failed:', err);
  }
}

/** Take the free seat, or the one this session already holds. */
export async function joinRoom(code: string, sessionId: string, name: string): Promise<Seat> {
  // The code is typed by a person or read from a link, and it goes into the path of the request.
  if (!ROOM_CODE.test(code)) throw new Error('Room not found');
  let refusal = '';
  const result = await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
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

export function getRoom(code: string): Promise<SwarmRoom | null> {
  return proxyGet<SwarmRoom>(`swarm/${code}`, LIVE_TIMEOUT_MS);
}

type Tree = { [key: string]: unknown };
const isTree = (value: unknown): value is Tree => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `tree` with `data` written at `path`, as the database would hold it: null
 * removes, and a node left with no children goes too. Copies along the path
 * and shares the rest.
 */
export function putAt(tree: unknown, path: string, data: unknown): unknown {
  const keys = path.split('/').filter(Boolean);
  const write = (node: unknown, depth: number): unknown => {
    if (depth === keys.length) return data ?? null;
    const copy: Tree = isTree(node) ? { ...node } : {};
    const child = write(copy[keys[depth]], depth + 1);
    if (child === null) delete copy[keys[depth]];
    else copy[keys[depth]] = child;
    return Object.keys(copy).length ? copy : null;
  };
  return write(tree, 0);
}

/**
 * The room after one event from its stream. A `put` replaces what is at
 * `path`; a `patch` holds paths under it, each replaced.
 */
export function applyRoomEvent(tree: unknown, kind: 'put' | 'patch', path: string, data: unknown): unknown {
  if (kind === 'put') return putAt(tree, path, data);
  if (!isTree(data)) throw new Error(`patch at ${path} is not an object`);
  return Object.entries(data).reduce((next, [key, value]) => putAt(next, `${path}/${key}`, value), tree);
}

/**
 * Follow the room over one held connection: `onRoom` is given the whole room
 * after every change, its own copy each time, and null once the room is gone.
 * `onEnd` is called once if the stream breaks or is refused, and nothing
 * follows it. Firebase's first event is the room as it stands.
 */
export function followRoom(code: string, onRoom: (room: SwarmRoom | null) => void, onEnd: () => void): () => void {
  const source = new EventSource(bust(`swarm/${code}`));
  let tree: unknown = null;
  let ended = false;
  const take = (kind: 'put' | 'patch') => (event: MessageEvent<string>) => {
    if (ended) return;
    try {
      const { path, data } = JSON.parse(event.data) as { path: string; data: unknown };
      tree = applyRoomEvent(tree, kind, path, data);
    } catch (err) {
      // The room can no longer be known from this stream, so it is given up and the room read instead.
      console.warn('[Swarm] Room stream sent an event it could not apply:', err);
      end();
      return;
    }
    onRoom(tree === null ? null : (structuredClone(tree) as SwarmRoom));
  };
  const end = () => {
    if (ended) return;
    ended = true;
    source.close();
    onEnd();
  };
  source.addEventListener('put', take('put'));
  source.addEventListener('patch', take('patch'));
  // An EventSource reconnects by itself, but quietly and on its own clock; the caller chooses instead.
  source.addEventListener('error', end);
  source.addEventListener('cancel', end);
  return () => {
    ended = true;
    source.close();
  };
}

/**
 * `at` is stamped by the server; reading it back is how a client finds the
 * server clock. `base` is the `seq` of the write this one was built on.
 */
export function putSeat(
  code: string,
  seat: Seat,
  state: Omit<SwarmSeatState, 'at'> & { base?: number }
): Promise<void> {
  return proxyPut(`swarm/${code}/s/${seat}`, { ...state, at: getServerTimestamp() }, LIVE_TIMEOUT_MS);
}

/**
 * Start a game, or a fresh one in a finished room. Needs both seats filled.
 * `map` is the map chosen, or null to leave it to the seed. With `third` the
 * computer plays a third side.
 */
export async function startMatch(code: string, serverNow: number, map: MapId | null, third: boolean): Promise<void> {
  const seed = newSeed();
  await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    if (!current || current.status === 'playing' || !current.players.a || !current.players.b) return undefined;
    // Rebuilt rather than spread: the last game's winner must not carry over.
    return {
      status: 'playing',
      createdAt: current.createdAt,
      seed,
      players: current.players,
      game: current.game + 1,
      startAt: Math.round(serverNow + COUNTDOWN_MS),
      ...(map && { map }),
      ...(third && { third: true }),
    };
  });
}

/**
 * Record how game `game` ended. Both clients call this with the same winner,
 * read from the confirmed state; the game check lets only the first one land.
 */
export async function recordResult(code: string, game: number, winner: Side | 'draw'): Promise<void> {
  await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    if (!current || current.status !== 'playing' || current.game !== game) return undefined;
    return { ...current, status: 'finished', winner };
  });
}

/**
 * Take `seat` out of the room: it left, or it has been silent too long.
 * Before the game that frees the seat; during it, the other player wins.
 */
export async function vacateSeat(code: string, seat: Seat): Promise<void> {
  let empty = false;
  await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    empty = false;
    if (!current || !current.players[seat]) return undefined;
    if (current.status === 'playing') {
      return { ...current, status: 'finished', winner: otherSeat(seat), gone: seat };
    }
    const other = current.players[otherSeat(seat)];
    if (!other) {
      empty = true;
      return undefined;
    }
    const rest = { ...current };
    delete rest.winner;
    delete rest.gone;
    return { ...rest, status: 'waiting', players: { [otherSeat(seat)]: other } };
  });
  // proxyTransaction reads a null return as an abort, so emptying is its own step.
  if (empty) await proxyRemove(`swarm/${code}`);
}
