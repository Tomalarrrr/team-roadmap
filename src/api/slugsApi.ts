// Slugs data access via the Vercel proxy (api/proxy.ts), on `slugs/{code}`.
//
// Laid out as Swarm's room is, and for the same reasons (see swarmApi.ts):
//   m                  the match: seats, settings, game, result. Changed only by transaction.
//   s/{seat}           one player's inputs for the game being played, and its
//                      promise `k`. Written by its own client, which can be two
//                      tabs or a page and its reload, so a write names the one
//                      it replaces (`base`) and the rules refuse it when that
//                      has moved on.
//   h/g{game}/{seat}   the same inputs, sealed in chunks of about a kilobyte
//                      once they are old (see slugsSync). A seat's write then
//                      carries only its newest inputs, not the whole match.

import { generateGameCode } from '../utils/gameUtils';
import { applyRoomEvent } from './swarmApi';
import { bust, getServerTimestamp, proxyGet, proxyPut, proxyRemove, proxyTransaction } from './dbProxy';

export const SEATS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
export type Seat = (typeof SEATS)[number];

/** People in one room. The room has six seats; the others are for the computer. */
export const MOST_PEOPLE = 2;

export interface SlugsPlayer {
  sessionId: string;
  name: string;
  /** Pressed by a guest in the lobby; the host starts once everyone else has. */
  ready?: true;
}

export interface SlugsMatch {
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
  seed: number;
  /** Counts the games started in this room, so a seat's inputs are known to be for this one. */
  game: number;
  players: Partial<Record<Seat, SlugsPlayer>>;
  /** Seats the computer plays, as their letters in order. */
  cpu?: string;
  /** The host's settings (see encodeSettings in slugsSync). Absent means every one is the default. */
  set?: string;
  winner?: Seat | 'draw';
  /** The seat that left a game of two, which the other then won. */
  gone?: Seat;
  /** In a game of more than two, a seat that left: the computer plays it from the tick after this one. */
  out?: Partial<Record<Seat, number>>;
}

export interface SlugsSeatState {
  seq: number;
  /** Server time of the write. */
  at: number;
  game: number;
  /** No input of this seat's will be added for a tick up to k. */
  k: number;
  /** Chunks of this seat's inputs sealed under h for this game. */
  n: number;
  /** Inputs after the sealed chunks. */
  in: string;
  /** The last chunk sealed, repeated here so the rules can check a seal against the inputs it replaces. */
  prev?: string;
  /** The `seq` of the write this one was built on. */
  base?: number;
}

export type SeatWrite = Omit<SlugsSeatState, 'at'>;

export interface SlugsRoom {
  m: SlugsMatch;
  s?: Partial<Record<Seat, SlugsSeatState>>;
  h?: Record<string, Partial<Record<Seat, Record<string, string>>>>;
}

const STALE_ROOM_AGE_MS = 24 * 60 * 60 * 1000;
/** Swarm's: five times the slowest a hidden tab writes. */
const HEARD_RECENTLY_MS = 5 * 60 * 1000;
const ROOM_CODE = /^[A-Z0-9]{4}$/;
/** Swarm's, for the reasons given there: inside the silence a seat is given up after, and not shorter. */
const LIVE_TIMEOUT_MS = 6000;

const roomPath = (code: string) => `slugs/${code}`;
const matchPath = (code: string) => `slugs/${code}/m`;
export const chunkKey = (index: number) => `c${index}`;
const gameKey = (game: number) => `g${game}`;
const newSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];

export function seatOf(match: Pick<SlugsMatch, 'players'>, sessionId: string): Seat | undefined {
  return SEATS.find((seat) => match.players[seat]?.sessionId === sessionId);
}

/** The person who chooses the settings: the one in the first seat taken, so the role passes on when they leave. */
export function hostOf(match: Pick<SlugsMatch, 'players'>): Seat | undefined {
  return SEATS.find((seat) => match.players[seat]);
}

/** The seats that play, in team order: each held by a person or the computer. */
export function teamSeats(match: Pick<SlugsMatch, 'players' | 'cpu'>): Seat[] {
  return SEATS.filter((seat) => match.players[seat] || match.cpu?.includes(seat));
}

const peopleIn = (match: Pick<SlugsMatch, 'players'>) => SEATS.filter((seat) => match.players[seat]).length;

export async function createRoom(sessionId: string, name: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();
    const room: SlugsRoom = {
      m: { status: 'waiting', createdAt: Date.now(), seed: newSeed(), game: 0, players: { a: { sessionId, name } } },
    };
    const result = await proxyTransaction<SlugsRoom>(roomPath(code), (current) => (current === null ? room : undefined));
    if (result.committed) {
      void cleanupStaleRooms();
      return code;
    }
  }
  throw new Error('Could not find a free room code. Try again.');
}

async function cleanupStaleRooms(): Promise<void> {
  try {
    const rooms = await proxyGet<Record<string, SlugsRoom>>('slugs');
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
        .map(([code]) => proxyRemove(roomPath(code)))
    );
  } catch (err) {
    console.warn('[Slugs] Stale room cleanup failed:', err);
  }
}

/**
 * Take an open seat, or the one this session already holds. A finished room
 * takes new players for the next game, and one who left the last game partway
 * and comes back is in the next.
 */
export async function joinRoom(code: string, sessionId: string, name: string): Promise<Seat> {
  // Typed by a person or read from a link, and it goes into the path of the request.
  if (!ROOM_CODE.test(code)) throw new Error('Room not found');
  let refusal = '';
  const result = await proxyTransaction<SlugsMatch>(matchPath(code), (current) => {
    refusal = 'Room not found';
    if (!current) return undefined;
    const held = seatOf(current, sessionId);
    if (held) return current.status === 'finished' ? withoutOut(current, held) : current;
    if (current.status === 'playing') {
      refusal = 'That room is in a game. Join when it ends.';
      return undefined;
    }
    const free = SEATS.find((seat) => !current.players[seat] && !current.cpu?.includes(seat));
    if (!free || peopleIn(current) >= MOST_PEOPLE) {
      refusal = 'That room is full';
      return undefined;
    }
    return { ...current, players: { ...current.players, [free]: { sessionId, name } } };
  });
  const seat = result.committed && result.snapshot ? seatOf(result.snapshot, sessionId) : undefined;
  if (!seat) throw new Error(refusal);
  return seat;
}

function withoutOut(match: SlugsMatch, seat: Seat): SlugsMatch {
  if (match.out?.[seat] === undefined) return match;
  const out = { ...match.out };
  delete out[seat];
  const rest = { ...match };
  delete rest.out;
  return Object.keys(out).length > 0 ? { ...rest, out } : rest;
}

/**
 * The match and the seats, without the sealed chunks: those never change once
 * written, so a client fetches each one once (getChunks) instead of on every read.
 */
export async function getRoom(code: string): Promise<SlugsRoom | null> {
  const [m, s] = await Promise.all([
    proxyGet<SlugsMatch>(matchPath(code), LIVE_TIMEOUT_MS),
    proxyGet<SlugsRoom['s']>(`${roomPath(code)}/s`, LIVE_TIMEOUT_MS),
  ]);
  if (!m) return null;
  return s ? { m, s } : { m };
}

/** Every chunk sealed so far for one seat in one game, by key (`c0`, `c1`, ...). */
export async function getChunks(code: string, game: number, seat: Seat): Promise<Record<string, string>> {
  return (await proxyGet<Record<string, string>>(`${roomPath(code)}/h/${gameKey(game)}/${seat}`, LIVE_TIMEOUT_MS)) ?? {};
}

/** A seat's sealed chunks for a game as the room holds them, from a read that included `h`. */
export function chunksIn(room: SlugsRoom, game: number, seat: Seat): Record<string, string> | undefined {
  return room.h?.[gameKey(game)]?.[seat];
}

/**
 * Follow the room over one held connection, as Swarm's followRoom does. A copy
 * rather than a shared function because the path is part of what that one is:
 * it opens `swarm/{code}` and its warnings say Swarm.
 */
export function followRoom(code: string, onRoom: (room: SlugsRoom | null) => void, onEnd: () => void): () => void {
  const source = new EventSource(bust(roomPath(code)));
  let tree: unknown = null;
  let ended = false;
  const take = (kind: 'put' | 'patch') => (event: MessageEvent<string>) => {
    if (ended) return;
    try {
      const { path, data } = JSON.parse(event.data) as { path: string; data: unknown };
      tree = applyRoomEvent(tree, kind, path, data);
    } catch (err) {
      // The room can no longer be known from this stream, so it is given up and the room read instead.
      console.warn('[Slugs] Room stream sent an event it could not apply:', err);
      end();
      return;
    }
    onRoom(tree === null ? null : (structuredClone(tree) as SlugsRoom));
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

/** `at` is stamped by the server. */
export function putSeat(code: string, seat: Seat, state: SeatWrite): Promise<void> {
  return proxyPut(`${roomPath(code)}/s/${seat}`, { ...state, at: getServerTimestamp() }, LIVE_TIMEOUT_MS);
}

/**
 * Seal a chunk. Written before the seat write that counts it, so a client
 * that reads that seat write can always fetch the chunk.
 */
export function putChunk(code: string, game: number, seat: Seat, index: number, text: string): Promise<void> {
  return proxyPut(`${roomPath(code)}/h/${gameKey(game)}/${seat}/${chunkKey(index)}`, text, LIVE_TIMEOUT_MS);
}

/** Change the match in the lobby as this session, refused with `refusal` when `change` returns undefined. */
async function inLobby(
  code: string,
  sessionId: string,
  change: (current: SlugsMatch, seat: Seat) => SlugsMatch | string
): Promise<void> {
  let refusal = '';
  const result = await proxyTransaction<SlugsMatch>(matchPath(code), (current) => {
    refusal = 'Room not found';
    const seat = current && seatOf(current, sessionId);
    if (!current || !seat) return undefined;
    if (current.status === 'playing') {
      refusal = 'A game is being played.';
      return undefined;
    }
    const next = change(current, seat);
    if (typeof next === 'string') {
      refusal = next;
      return undefined;
    }
    return next;
  });
  if (!result.committed) throw new Error(refusal);
}

export function setReady(code: string, sessionId: string, ready: boolean): Promise<void> {
  return inLobby(code, sessionId, (current, seat) => {
    const player: SlugsPlayer = { sessionId, name: current.players[seat]!.name };
    return { ...current, players: { ...current.players, [seat]: ready ? { ...player, ready: true } : player } };
  });
}

/** Everyone but the host, ready or not. A change to what they agreed to asks them again. */
const unready = (match: SlugsMatch): SlugsMatch['players'] =>
  Object.fromEntries(
    SEATS.filter((seat) => match.players[seat]).map((seat) => [seat, { sessionId: match.players[seat]!.sessionId, name: match.players[seat]!.name }])
  );

/** The host's settings, already encoded (encodeSettings). An empty string clears them back to the defaults. */
export function setSettings(code: string, sessionId: string, set: string): Promise<void> {
  return inLobby(code, sessionId, (current, seat) => {
    if (hostOf(current) !== seat) return 'Only the host chooses the settings.';
    if ((current.set ?? '') === set) return current;
    const rest = { ...current, players: unready(current) };
    delete rest.set;
    return set ? { ...rest, set } : rest;
  });
}

/** Let the computer play an empty seat, or stop it. Only the host. */
export function setComputer(code: string, sessionId: string, seat: Seat, on: boolean): Promise<void> {
  return inLobby(code, sessionId, (current, mine) => {
    if (hostOf(current) !== mine) return 'Only the host chooses the teams.';
    if (current.players[seat]) return 'That seat is taken.';
    const cpu = SEATS.filter((each) => (each === seat ? on : current.cpu?.includes(each))).join('');
    const rest = { ...current, players: unready(current) };
    delete rest.cpu;
    return cpu ? { ...rest, cpu } : rest;
  });
}

/**
 * Start a game, or a fresh one in a finished room: a new seed and the next
 * game number, so every client starts the same new game and no seat's inputs
 * from the last one count. Only the host, once every other person is ready.
 * Whoever left the last game partway and has not come back is not in this one.
 */
export async function startMatch(code: string, sessionId: string): Promise<void> {
  const seed = newSeed();
  let refusal = '';
  // The game before the one just ended is kept until now so that a client
  // still playing the end of it could read it; the one before that is let go.
  // Before the start, because the rules let a game's inputs go only between games.
  const before = await proxyGet<SlugsMatch>(matchPath(code), LIVE_TIMEOUT_MS);
  if (before && before.status !== 'playing' && before.game > 1) {
    await proxyRemove(`${roomPath(code)}/h/${gameKey(before.game - 1)}`).catch((err: unknown) => console.warn('[Slugs] Old inputs not removed:', err));
  }
  const result = await proxyTransaction<SlugsMatch>(matchPath(code), (current) => {
    refusal = 'Room not found';
    const seat = current && seatOf(current, sessionId);
    if (!current || !seat) return undefined;
    refusal = '';
    if (current.status === 'playing') return undefined;
    if (hostOf(current) !== seat) {
      refusal = 'Only the host starts the game.';
      return undefined;
    }
    const players: SlugsMatch['players'] = {};
    for (const each of SEATS) {
      const player = current.players[each];
      if (player && current.out?.[each] === undefined) players[each] = { sessionId: player.sessionId, name: player.name };
    }
    if (SEATS.some((each) => each !== seat && players[each] && !current.players[each]!.ready)) {
      refusal = 'Waiting for everyone to be ready.';
      return undefined;
    }
    if (teamSeats({ players, cpu: current.cpu }).length < 2) {
      refusal = 'A game needs two teams. Add the computer or invite someone.';
      return undefined;
    }
    // Rebuilt rather than spread: the last game's result must not carry over.
    return {
      status: 'playing',
      createdAt: current.createdAt,
      seed,
      game: current.game + 1,
      players,
      ...(current.cpu && { cpu: current.cpu }),
      ...(current.set && { set: current.set }),
    };
  });
  if (!result.committed) throw new Error(refusal || 'The game could not be started. Try again.');
}

/**
 * Record how game `game` ended. Every client calls this with the same winner,
 * read from its own state; the game check lets only the first one land.
 */
export async function recordResult(code: string, game: number, winner: Seat | 'draw'): Promise<void> {
  await proxyTransaction<SlugsMatch>(matchPath(code), (current) => {
    if (!current || current.status !== 'playing' || current.game !== game) return undefined;
    return { ...current, status: 'finished', winner };
  });
}

/** Swarm's: the seat's own write can land between its promise being read and the mark, which the rules then refuse. */
const VACATE_TRIES = 3;

/**
 * Take `seat` out of the room: it left, or it has been silent too long.
 *
 * Between games that frees the seat, and the room goes with its last person.
 * In a game of two teams the other team wins. In a game of more the game goes
 * on and the computer plays the seat from the tick after its last promise: `k`
 * as the caller last read it, or the room's own where that is further on.
 * Once no person is left playing, nobody is there to see the end and the room goes.
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
  const stored = await proxyGet<SlugsSeatState>(`${roomPath(code)}/s/${seat}`, LIVE_TIMEOUT_MS);
  let empty = false;
  await proxyTransaction<SlugsMatch>(matchPath(code), (current) => {
    empty = false;
    if (!current || !current.players[seat]) return undefined;
    if (current.status === 'playing') {
      const teams = teamSeats(current);
      if (teams.length === 2) {
        const [winner] = teams.filter((each) => each !== seat);
        return { ...current, status: 'finished', winner, gone: seat };
      }
      if (current.out?.[seat] !== undefined) return undefined;
      const out = { ...current.out, [seat]: Math.max(k, stored?.game === current.game ? stored.k : 0) };
      empty = !SEATS.some((each) => current.players[each] && out[each] === undefined);
      return { ...current, out };
    }
    const players = { ...current.players };
    for (const each of SEATS) if (each === seat || current.out?.[each] !== undefined) delete players[each];
    if (!SEATS.some((each) => players[each])) {
      empty = true;
      return undefined;
    }
    const rest = { ...current, players };
    delete rest.winner;
    delete rest.gone;
    delete rest.out;
    return { ...rest, status: 'waiting' };
  });
  // proxyTransaction reads a null return as an abort, so emptying is its own step.
  if (empty) await proxyRemove(roomPath(code));
}
