// Ludo3 (three-player) game data access via the Vercel proxy (api/proxy.ts).
// Same VPN-safe transport as Ludo v1 and Ludo4 (see dbProxy.ts); this module is
// the game-specific layer on the `ludo3/{code}` namespace: three colors, 15
// tokens, classic rules only (no power-up fields).

import type { LudoPlayer, TurnPhase } from '../ludoFirebase';
import {
  INITIAL_TOKENS,
  PLAYER_COLORS,
  initRollStats,
  mergeRollStats,
  type Ludo3Color,
  type Ludo3GameState,
  type Ludo3MoveUpdate,
} from '../ludo3Board';
import { YARD_MISS_LIMIT } from '../ludo3GameLogic';
import { generateGameCode } from '../utils/gameUtils';
import {
  getServerTimestamp,
  proxyGet,
  proxyRemove,
  proxyTransaction,
  subscribeToPath,
  type Unsubscribe,
} from './dbProxy';

export { getServerTimestamp };
export type { Ludo3Color, Ludo3GameState, Ludo3MoveUpdate, Unsubscribe };

const STALE_GAME_AGE_MS = 24 * 60 * 60 * 1000;
const BOT_NAMES: Record<Ludo3Color, string> = {
  red: 'Bot Red',
  green: 'Bot Green',
  blue: 'Bot Blue',
};

/**
 * Uniform integer in [0, n).
 *
 * Not `arr[0] % n`: a byte covers 0..255, which no n that doesn't divide 256
 * splits evenly — for a die, 0..3 would come up 43 times against 42 for 4 and
 * 5, a bias of about 0.8% toward the low faces. This function also *is* the
 * die (see requestDiceRoll), so it is the one place fairness actually lives.
 * Reject the short tail and the remainder is exact.
 */
function randomInt(n: number): number {
  const limit = 256 - (256 % n);
  const arr = new Uint8Array(1);
  do {
    crypto.getRandomValues(arr);
  } while (arr[0] >= limit);
  return arr[0] % n;
}

/**
 * Pack the seated players onto the first colours, keeping their order.
 *
 * The turn rotation is a cycle over `PLAYER_COLORS.slice(0, playerCount)`, so a
 * gap in the middle is a seat nobody can play. That used to be closed at the
 * off, which meant the lobby could show you as blue and the game could start
 * you as green — you watched your own colour change as the board appeared, and
 * nothing on screen explained it. So close it *whenever the room changes*
 * instead: every seat is packed the moment it is taken or given up, the lobby
 * therefore always shows the colour you will actually play, and the pack-down
 * at the off has nothing left to do.
 *
 * The cost is that the creator is always red rather than drawn at random. That
 * is the smaller loss: which colour you get is a novelty, and having it change
 * under you is a bug. The draw that matters — who moves first — is still made
 * at random in startGame.
 *
 * A bot carries its seat in both its name and its id, so it is re-keyed rather
 * than carried across; otherwise the green chair spends the game labelled
 * "Bot Blue" beside a green dot.
 */
function packSeats(players: Ludo3GameState['players']): Ludo3GameState['players'] {
  const seated = PLAYER_COLORS.filter((c) => !!players[c]);
  const packed: Ludo3GameState['players'] = {};
  seated.forEach((from, i) => {
    const to = PLAYER_COLORS[i];
    const player = players[from] as LudoPlayer;
    packed[to] = player.sessionId.startsWith('bot-')
      ? { sessionId: `bot-${to}`, name: BOT_NAMES[to] }
      : player;
  });
  return packed;
}

/** Which colour a session is sitting on, after a re-seat. */
function seatOf(players: Ludo3GameState['players'], sessionId: string): Ludo3Color | undefined {
  return PLAYER_COLORS.find((c) => players[c]?.sessionId === sessionId);
}

export async function createGame(
  sessionId: string,
  userName: string
): Promise<{ code: string; color: Ludo3Color }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();
    // The first seat, not a random one — see packSeats.
    const color = PLAYER_COLORS[0];

    const initialState: Ludo3GameState = {
      players: { [color]: { sessionId, name: userName } },
      host: color,
      tokens: INITIAL_TOKENS,
      currentTurn: 'red',
      turnPhase: 'roll',
      diceValue: null,
      lastRoll: null,
      consecutiveSixes: 0,
      winner: null,
      finishOrder: '',
      createdAt: Date.now(),
      startedAt: null,
      turnStartedAt: getServerTimestamp() as unknown as number,
      playerCount: 3,
      rollStats: initRollStats(),
      yardMisses: PLAYER_COLORS.map(() => 0).join(','),
    };

    const result = await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
      if (current !== null) return undefined; // Code taken — abort
      return initialState;
    });
    if (result.committed) {
      cleanupStaleGames();
      return { code, color };
    }
  }
  throw new Error('Failed to generate unique game code. Try again.');
}

async function cleanupStaleGames(): Promise<void> {
  try {
    const games = await proxyGet<Record<string, Ludo3GameState>>('ludo3');
    if (!games) return;
    const now = Date.now();
    const removals: Promise<void>[] = [];
    for (const [code, game] of Object.entries(games)) {
      if (game.createdAt && now - game.createdAt > STALE_GAME_AGE_MS) {
        removals.push(proxyRemove(`ludo3/${code}`));
      }
    }
    if (removals.length > 0) {
      await Promise.all(removals);
      console.log(`[Ludo3] Cleaned up ${removals.length} stale game(s)`);
    }
  } catch (err) {
    console.warn('[Ludo3] Stale game cleanup failed:', err);
  }
}

/** Whether `sessionId` holds the host seat. The UI already only offers the bot
 * controls to the host; this is the same rule where it can actually be relied
 * on, so a second tab or a stale client cannot reshape someone else's room. */
function isHost(state: Ludo3GameState, sessionId: string): boolean {
  const host = state.players[state.host ?? 'red'];
  return !!host && host.sessionId === sessionId;
}

export async function addBot(code: string, color: Ludo3Color, sessionId: string): Promise<void> {
  await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;
    if (!isHost(current, sessionId)) return undefined;
    if (current.players[color]) return undefined;
    return {
      ...current,
      players: packSeats({
        ...current.players,
        [color]: { sessionId: `bot-${color}`, name: BOT_NAMES[color] },
      }),
    };
  });
}

export async function removeBot(code: string, color: Ludo3Color, sessionId: string): Promise<void> {
  await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;
    if (!isHost(current, sessionId)) return undefined;
    const player = current.players[color];
    if (!player || !player.sessionId.startsWith('bot-')) return undefined;
    const newPlayers = { ...current.players };
    delete newPlayers[color];
    const packed = packSeats(newPlayers);
    // The host may have slid down with everyone else; follow them by session.
    return { ...current, players: packed, host: seatOf(packed, sessionId) ?? current.host };
  });
}

/**
 * Give up a seat.
 *
 * Before the off this just empties the seat. Once play has started the seat
 * cannot simply vanish — the turn order is a fixed rotation over playerCount,
 * and an empty seat in it stalls every round until the other clients time it
 * out. So a leaver is replaced by a bot, which takes over their counters and
 * keeps the game moving. If the host leaves, the host seat moves to a remaining
 * human so the room still has someone who can restart it.
 */
export async function leaveGame(code: string, sessionId: string): Promise<void> {
  // Set by the updater so the caller can act on it once the write has landed.
  // proxyTransaction treats a null return as an abort rather than a delete, so
  // emptying the room has to be a separate step.
  let roomIsEmpty = false;

  await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
    roomIsEmpty = false;
    if (!current) return current;

    const seat = PLAYER_COLORS.find((c) => current.players[c]?.sessionId === sessionId);
    if (!seat) return undefined; // Not at this table

    // Read before anything moves: after a re-seat the host's *colour* may belong
    // to somebody else, so the host has to be followed by session.
    const hostSession = current.players[current.host ?? 'red']?.sessionId;

    let players = { ...current.players };
    if (current.startedAt) {
      players[seat] = { sessionId: `bot-${seat}`, name: BOT_NAMES[seat] };
    } else {
      delete players[seat];
      // Pack the gap out immediately rather than at the off. Left until then,
      // everyone below the empty chair changes colour the moment the board
      // appears — which is exactly the surprise packSeats exists to prevent.
      players = packSeats(players);
    }

    const humansLeft = PLAYER_COLORS.filter(
      (c) => players[c] && !players[c]!.sessionId.startsWith('bot-')
    );
    if (humansLeft.length === 0) {
      roomIsEmpty = true;
      return { ...current, players };
    }

    const hostSeatNow = hostSession ? seatOf(players, hostSession) : undefined;
    const nextHost = hostSeatNow && humansLeft.includes(hostSeatNow) ? hostSeatNow : humansLeft[0];

    return {
      ...current,
      players,
      host: nextHost,
      ...(current.startedAt ? { singlePlayer: true } : {}),
    };
  });

  // Nobody human left: drop the room rather than leave bots playing to an empty
  // table until the stale-game sweep gets round to it a day later.
  if (roomIsEmpty) {
    try {
      await proxyRemove(`ludo3/${code}`);
    } catch (err) {
      console.warn('[Ludo3] Could not remove empty game:', err);
    }
  }
}

/**
 * Kick off.
 *
 * The turn rotation is a cycle over `PLAYER_COLORS.slice(0, playerCount)`, so
 * the occupied seats have to be the first `playerCount` of them — a gap in the
 * middle would be a seat nobody can play. Seats are dealt at random, though, so
 * two people can easily end up on red and blue with green empty between them.
 * Close the gap: the seated players slide down onto the first colours, keeping
 * their order, and the count is simply how many of them there are. A player
 * whose colour moves is told by the state they are already subscribed to.
 *
 * That gap used to be plugged with a bot, which meant a share of all
 * two-player games silently acquired an opponent nobody asked for, decided
 * entirely by which colour the creator happened to draw. Bots now appear only
 * when the host actually adds one.
 */
export async function startGame(code: string, sessionId: string): Promise<void> {
  await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;
    // The same rule as addBot/removeBot, in the one place it can be relied on.
    // The Start button is only ever offered to the host; this is what stops a
    // second tab or a stale client starting somebody else's room for them.
    if (!isHost(current, sessionId)) return undefined;

    const seated = PLAYER_COLORS.filter((c) => !!current.players[c]);
    if (seated.length < 2) return undefined;

    /* Seats are only re-drawn when they have to be.
     *
     * With every arm taken, the seats are interchangeable: rotate the board and
     * one seat becomes another, which is why a full table measures 33.11 / 33.52 / 33.37 over 30,000 games.
     * Shuffling those does nothing for fairness and takes something real away —
     * the player watched the colour they had been given in the lobby change as
     * the board appeared, with nothing on screen to explain it. So a full table
     * keeps its seats exactly as the lobby showed them.
     *
     * Short-handed is a different board. On a ring, the player whose start cell
     * sits a third of a lap *behind* the other's passes the other's guns early
     * in its lap, when its counters have little to lose, while the other passes
     * them late, with a counter that has most of a lap invested in it. Measured
     * over 20,000 two-handed games, the seat 14 cells behind wins 52.6% against
     * 47.4% (chi2 55.6, df 1). That edge cannot be removed by seating — every
     * pair of arms on a three-fold board is a rotation of every other, and on
     * the four-seat board the fair pairing (opposite arms) is not a prefix of
     * the colours the turn rotation runs over. What it can be is a coin flip
     * rather than a fixture, so a short-handed table draws for it. The waiting
     * room says so before anyone presses Start.
     *
     * Either way nobody is moved to close a gap: seats are packed as they are
     * taken (see packSeats), so by here there is never a hole to close. */
    const shortHanded = seated.length < PLAYER_COLORS.length;
    const order = [...seated];
    if (shortHanded) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [order[i], order[j]] = [order[j], order[i]];
      }
    }

    const playerCount = seated.length;
    const newPlayers: Ludo3GameState['players'] = {};
    order.forEach((from, i) => {
      const to = PLAYER_COLORS[i];
      const player = current.players[from] as LudoPlayer;
      // A bot carries its seat in both its name and its id. Slid across without
      // re-keying, the green chair spends the rest of the game labelled "Bot
      // Blue" beside a green dot.
      newPlayers[to] = player.sessionId.startsWith('bot-')
        ? { sessionId: `bot-${to}`, name: BOT_NAMES[to] }
        : player;
    });

    const hasBots = seated.some((c) => current.players[c]!.sessionId.startsWith('bot-'));

    // The host moved with everyone else; follow them by session rather than by
    // colour, or the host seat is left pointing at whoever slid into it.
    const activePlayers = PLAYER_COLORS.slice(0, playerCount);
    const host = activePlayers.find((c) => newPlayers[c]?.sessionId === sessionId);

    return {
      ...current,
      players: newPlayers,
      playerCount,
      startedAt: Date.now(),
      turnStartedAt: getServerTimestamp() as unknown as number,
      currentTurn: activePlayers[randomInt(activePlayers.length)],
      ...(host ? { host } : {}),
      ...(hasBots ? { singlePlayer: true } : {}),
    };
  });
}

export async function joinGame(
  code: string,
  sessionId: string,
  userName: string
): Promise<{ state: Ludo3GameState; assignedColor: Ludo3Color }> {
  let joinError: string | null = null;

  await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
    joinError = null;
    if (!current) return current;

    for (const color of PLAYER_COLORS) {
      const player = current.players[color];
      if (player && player.sessionId === sessionId) {
        return current; // Reconnected by sessionId
      }
    }

    const openColors = current.startedAt
      ? PLAYER_COLORS.slice(0, current.playerCount)
      : PLAYER_COLORS;
    let foundColor: Ludo3Color | null = null;
    for (const color of openColors) {
      if (!current.players[color]) {
        foundColor = color;
        break;
      }
    }
    if (!foundColor) {
      joinError = 'Game is full';
      return undefined;
    }
    // Packed on the way in, so the seat shown in the lobby is the seat played.
    return {
      ...current,
      players: packSeats({ ...current.players, [foundColor]: { sessionId, name: userName } }),
    };
  });

  if (joinError) throw new Error(joinError);

  const finalState = await proxyGet<Ludo3GameState>(`ludo3/${code}`);
  if (!finalState) throw new Error('Game not found');

  let confirmedColor: Ludo3Color | null = null;
  for (const color of PLAYER_COLORS) {
    const player = finalState.players[color];
    if (player && player.sessionId === sessionId) {
      confirmedColor = color;
      break;
    }
  }
  if (!confirmedColor) throw new Error('Failed to join game');
  return { state: finalState, assignedColor: confirmedColor };
}

export function subscribeToGame(
  code: string,
  callback: (state: Ludo3GameState | null) => void,
  onConnectionChange?: (connected: boolean) => void
): Promise<Unsubscribe> {
  return subscribeToPath<Ludo3GameState>(`ludo3/${code}`, 'Ludo3', callback, onConnectionChange);
}

export async function makeMove(
  code: string,
  expectedTurn: Ludo3Color,
  updates: Ludo3MoveUpdate
): Promise<boolean> {
  const result = await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
    if (!current) return current;
    if (current.currentTurn !== expectedTurn) return undefined; // Not this player's turn
    if (current.winner != null) return undefined; // Game over
    return {
      ...current,
      ...updates,
      // Re-merge against the freshly-read value so a concurrent writer's rolls
      // aren't lost (see mergeRollStats in ludo3Board). Runs on every attempt.
      ...(updates.rollStats && current.rollStats
        ? { rollStats: mergeRollStats(current.rollStats, updates.rollStats) }
        : {}),
    };
  });
  return result.committed;
}

export async function toggleGamePause(code: string): Promise<void> {
  await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
    if (!current) return current;
    const isPaused = !current.paused;
    if (isPaused) {
      return { ...current, paused: true, pausedAt: Date.now() };
    }
    const pauseDuration = current.pausedAt ? Date.now() - current.pausedAt : 0;
    return {
      ...current,
      paused: false,
      pausedAt: null,
      turnStartedAt: (current.turnStartedAt || 0) + pauseDuration,
    };
  });
}

export async function resetGame(code: string, playerCount: number): Promise<void> {
  const activePlayers = PLAYER_COLORS.slice(0, playerCount);
  const randomFirst = activePlayers[randomInt(activePlayers.length)];

  await proxyTransaction<Ludo3GameState>(`ludo3/${code}`, (current) => {
    if (!current) return current;
    const hasBots = PLAYER_COLORS.slice(0, playerCount).some((c) => {
      const p = current.players[c];
      return p && p.sessionId.startsWith('bot-');
    });

    return {
      ...current,
      tokens: INITIAL_TOKENS,
      currentTurn: randomFirst,
      turnPhase: 'roll' as TurnPhase,
      diceValue: null,
      lastRoll: null,
      consecutiveSixes: 0,
      winner: null,
      finishOrder: '',
      startedAt: Date.now(),
      turnStartedAt: getServerTimestamp() as unknown as number,
      playerCount,
      paused: false,
      pausedAt: null,
      rollStats: initRollStats(),
      yardMisses: PLAYER_COLORS.map(() => 0).join(','),
      singlePlayer: hasBots,
    };
  });
}

/**
 * Client-side dice roll (the server-side roll endpoint is blocked behind the
 * VPNs this proxy exists to support — acceptable for a hidden, casual game).
 *
 * Exactly uniform over the six faces: crypto randomness through the same
 * rejection sampling the seat deal uses, not `Math.random() * 6`. And unlike
 * Ludo v1 there is no pity timer anywhere downstream quietly swapping
 * faces for 6s — the face this returns is the face that is played, so every
 * face is equally likely on every throw and the tally each seat card shows is
 * the truth about the die, not about the die plus a kindness.
 */
export async function requestDiceRoll(): Promise<{ rolls: number[]; serverGenerated: boolean }> {
  return { rolls: [1 + randomInt(6)], serverGenerated: false };
}

/**
 * The shut-in throw — the warm die the rules card describes.
 *
 * Stone fair before the first miss, then one twenty-fourth warmer per miss:
 * P(6) = (4 + misses) / 24 — 1/6, then 5/24, 6/24, 7/24, 8/24 — never past
 * double fair odds. Once YARD_MISS_LIMIT misses are served the wait is over
 * and the throw is simply a given 6. The other five faces always share the
 * remainder evenly: the draw is over 120 equally likely states (lcm of 24 and
 * 5), rejection-sampled exact like everything else in this file, so warming
 * the 6 never quietly biases the low faces against each other.
 *
 * Only ever thrown while allInYard — one counter out of the yard and it is
 * requestDiceRoll, no exceptions. Stated in full on the rules card, which is
 * what separates a rule from a thumb on the die; the fairness suite pins this
 * curve to numbers exactly as it pins the fair die's.
 */
export async function requestYardRoll(
  misses: number
): Promise<{ rolls: number[]; serverGenerated: boolean }> {
  if (misses >= YARD_MISS_LIMIT) return { rolls: [6], serverGenerated: false };
  const sixStates = (4 + Math.max(0, misses)) * 5; // of 120
  const r = randomInt(120);
  const face = r < sixStates ? 6 : 1 + ((r - sixStates) % 5);
  return { rolls: [face], serverGenerated: false };
}
