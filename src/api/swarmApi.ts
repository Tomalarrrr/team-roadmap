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
  sidesOf,
  type Kind,
  type MapId,
  type ModeId,
  type Nest,
  type Seat,
  type SizeId,
  type StartId,
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

/**
 * Take an open seat, or the one this session already holds. A finished room
 * takes new players for the next game, and one who was taken out of the last
 * game and comes back to it is in the next.
 */
export async function joinRoom(code: string, sessionId: string, name: string): Promise<Seat> {
  // The code is typed by a person or read from a link, and it goes into the path of the request.
  if (!ROOM_CODE.test(code)) throw new Error('Room not found');
  let refusal = '';
  const result = await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    refusal = 'Room not found';
    if (!current) return undefined;
    const held = seatOf(current, sessionId);
    if (held) return current.status === 'finished' ? withoutOut(current, held) : current;
    if (current.status === 'playing') {
      refusal = 'That room is in a game. Join when it ends.';
      return undefined;
    }
    const free = SEATS.find((seat) => !current.players[seat] && !current.cpu?.includes(seat));
    if (!free) {
      refusal = 'That room is full';
      return undefined;
    }
    return { ...current, players: { ...current.players, [free]: { sessionId, name } } };
  });
  const seat = result.snapshot && result.committed ? seatOf(result.snapshot, sessionId) : undefined;
  if (!seat) throw new Error(refusal);
  return seat;
}

function withoutOut(match: SwarmMatch, seat: Seat): SwarmMatch {
  if (match.out?.[seat] === undefined) return match;
  const out = { ...match.out };
  delete out[seat];
  const rest = { ...match };
  delete rest.out;
  return Object.keys(out).length > 0 ? { ...rest, out } : rest;
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

/** Choose the creature this session plays as. Only in the lobby, and only one nobody else has chosen. */
export async function setKind(code: string, sessionId: string, kind: Kind): Promise<void> {
  let refusal = '';
  const result = await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    refusal = 'Room not found';
    const seat = current && seatOf(current, sessionId);
    if (!current || !seat) return undefined;
    if (current.status !== 'waiting') {
      refusal = 'The creatures are chosen before a game starts.';
      return undefined;
    }
    if (SEATS.some((each) => each !== seat && current.players[each]?.kind === kind)) {
      refusal = 'Another player has chosen that one.';
      return undefined;
    }
    return { ...current, players: { ...current.players, [seat]: { ...current.players[seat], kind } } };
  });
  if (!result.committed) throw new Error(refusal);
}

/** Choose how this session starts when the start is nests. Only in the lobby. */
export async function setNest(code: string, sessionId: string, nest: Nest): Promise<void> {
  let refusal = '';
  const result = await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    refusal = 'Room not found';
    const seat = current && seatOf(current, sessionId);
    if (!current || !seat) return undefined;
    if (current.status !== 'waiting') {
      refusal = 'The nests are chosen before a game starts.';
      return undefined;
    }
    return { ...current, players: { ...current.players, [seat]: { ...current.players[seat], nest } } };
  });
  if (!result.committed) throw new Error(refusal);
}

/**
 * The person who chooses the room's rules: the one in the first seat taken,
 * which is the room's maker until they leave it.
 */
export function hostOf(match: Pick<SwarmMatch, 'players'>): Seat | undefined {
  return SEATS.find((seat) => match.players[seat]);
}

/**
 * Choose the mode, start, twists and settings (`tune`, see encodeTune) the
 * room's games are played by. Only the host, and only in the lobby. One that
 * is the default is not stored, so a room with none chosen plays classic. Like the creature pick, this is held
 * to by the clients; the database checks only the values.
 */
export async function setRules(code: string, sessionId: string, rules: { mode: ModeId; start: StartId; twists: string; tune: string }): Promise<void> {
  let refusal = '';
  const result = await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    refusal = 'Room not found';
    const seat = current && seatOf(current, sessionId);
    if (!current || !seat) return undefined;
    if (current.status !== 'waiting') {
      refusal = 'The rules are chosen before a game starts.';
      return undefined;
    }
    if (seat !== hostOf(current)) {
      refusal = 'The host chooses the rules.';
      return undefined;
    }
    const rest = { ...current };
    delete rest.mode;
    delete rest.start;
    delete rest.twists;
    delete rest.tune;
    return {
      ...rest,
      ...(rules.mode !== 'classic' && { mode: rules.mode }),
      ...(rules.start !== 'home' && { start: rules.start }),
      ...(rules.twists && { twists: rules.twists }),
      ...(rules.tune && { tune: rules.tune }),
    };
  });
  if (!result.committed) throw new Error(refusal);
}

/**
 * Put the computer in an open seat, or take it out again. Only between games,
 * and never in a seat a person sits in.
 */
export async function setComputer(code: string, seat: Seat, on: boolean): Promise<void> {
  await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    if (!current || current.status === 'playing' || current.players[seat]) return undefined;
    const cpu = SEATS.filter((each) => (each === seat ? on : current.cpu?.includes(each))).join('');
    const rest = { ...current };
    delete rest.cpu;
    return cpu ? { ...rest, cpu } : rest;
  });
}

/**
 * Start a game, or a fresh one in a finished room. Needs two sides at least,
 * people or the computer. `map` and `size` are the ones chosen, or null to
 * leave the map to the seed and the size to the map. The mode, start,
 * twists and settings are the room's own (see setRules), so a rematch plays by them too;
 * one that is the default is not stored.
 */
export async function startMatch(code: string, serverNow: number, map: MapId | null, size: SizeId | null): Promise<void> {
  const seed = newSeed();
  await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    if (!current || current.status === 'playing') return undefined;
    // Whoever left the last game partway through, and has not come back, is not in this one.
    const players: SwarmMatch['players'] = {};
    for (const seat of SEATS) {
      const player = current.players[seat];
      if (player && current.out?.[seat] === undefined) players[seat] = player;
    }
    if (sidesOf({ players, cpu: current.cpu }).length < 2) return undefined;
    const { mode, start, twists, tune } = current;
    // Rebuilt rather than spread: the last game's result must not carry over.
    return {
      status: 'playing',
      createdAt: current.createdAt,
      seed,
      players,
      game: current.game + 1,
      startAt: Math.round(serverNow + COUNTDOWN_MS),
      ...(map && { map }),
      ...(size && { size }),
      ...(current.cpu && { cpu: current.cpu }),
      ...(mode && mode !== 'classic' && { mode }),
      ...(start && start !== 'home' && { start }),
      ...(twists && { twists }),
      ...(tune && { tune }),
    };
  });
}

/**
 * Record how game `game` ended. Every client calls this with the same winner,
 * read from the confirmed state; the game check lets only the first one land.
 */
export async function recordResult(code: string, game: number, winner: Seat | 'draw'): Promise<void> {
  await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    if (!current || current.status !== 'playing' || current.game !== game) return undefined;
    return { ...current, status: 'finished', winner };
  });
}

/**
 * A write of the seat's own can land between its promise being read and the
 * seat being marked out, and the rules refuse a mark behind that promise. The
 * promise is read again and the mark tried again.
 */
const VACATE_TRIES = 3;

/**
 * Take `seat` out of the room: it left, or it has been silent too long.
 *
 * Between games that frees the seat, and the room goes with its last person.
 * In a game of two sides the other side wins. In a game of more the game goes
 * on, and the computer plays the seat from the tick after its last promise:
 * `k` as the caller last read it, or the room's own where that is further on.
 * Once no person is left playing nobody is there to see the end, and the room
 * goes.
 */
export async function vacateSeat(code: string, seat: Seat, k: number): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await vacateOnce(code, seat, k);
      return;
    } catch (err) {
      if (attempt === VACATE_TRIES) throw err;
    }
  }
}

async function vacateOnce(code: string, seat: Seat, k: number): Promise<void> {
  const stored = await proxyGet<SwarmSeatState>(`swarm/${code}/s/${seat}`, LIVE_TIMEOUT_MS);
  let empty = false;
  await proxyTransaction<SwarmMatch>(matchPath(code), (current) => {
    empty = false;
    if (!current || !current.players[seat]) return undefined;
    if (current.status === 'playing') {
      const sides = sidesOf(current);
      if (sides.length === 2) {
        const [winner] = sides.filter((each) => each !== seat);
        return { ...current, status: 'finished', winner, gone: seat };
      }
      if (current.out?.[seat] !== undefined) return undefined;
      const out = { ...current.out, [seat]: Math.max(k, stored?.game === current.game ? stored.k : 0) };
      empty = !SEATS.some((each) => current.players[each] && out[each] === undefined);
      return { ...current, out };
    }
    // Back to waiting, where nobody is out: whoever left the last game partway through and has not come back goes too.
    const players = { ...current.players };
    for (const each of SEATS) if (each === seat || current.out?.[each] !== undefined) delete players[each];
    if (!SEATS.some((each) => players[each])) {
      empty = true;
      return undefined;
    }
    const rest = { ...current };
    delete rest.winner;
    delete rest.gone;
    delete rest.out;
    return { ...rest, status: 'waiting', players };
  });
  // proxyTransaction reads a null return as an abort, so emptying is its own step.
  if (empty) await proxyRemove(`swarm/${code}`);
}
