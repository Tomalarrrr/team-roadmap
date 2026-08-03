// Ludo2 (three-player) game data access via the Vercel proxy (api/proxy.ts).
// Same VPN-safe transport as Ludo v1 (see dbProxy.ts); this module is the
// game-specific layer on the `ludo2/{code}` namespace: three colors, 15
// tokens, classic rules only (no power-up fields).

import type { LudoPlayer, TurnPhase } from '../ludoFirebase';
import {
  INITIAL_TOKENS,
  PLAYER_COLORS,
  initRollStats,
  mergeRollStats,
  type Ludo2Color,
  type Ludo2GameState,
  type Ludo2MoveUpdate,
} from '../ludo2Board';
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
export type { Ludo2Color, Ludo2GameState, Ludo2MoveUpdate, Unsubscribe };

const STALE_GAME_AGE_MS = 24 * 60 * 60 * 1000;
// 'yellow' is the stored key for the third seat; it presents as blue.
const BOT_NAMES: Record<Ludo2Color, string> = {
  red: 'Bot Red',
  green: 'Bot Green',
  yellow: 'Bot Blue',
};

/** Seats are dealt at random rather than in board order, so creating a game
 * doesn't hand you red every time. The starting player is drawn separately in
 * startGame, so neither the colour nor the first move follows join order. */
function randomColor(): Ludo2Color {
  const arr = new Uint8Array(1);
  crypto.getRandomValues(arr);
  return PLAYER_COLORS[arr[0] % PLAYER_COLORS.length];
}

export async function createGame(
  sessionId: string,
  userName: string
): Promise<{ code: string; color: Ludo2Color }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();
    const color = randomColor();

    const initialState: Ludo2GameState = {
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
    };

    const result = await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
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
    const games = await proxyGet<Record<string, Ludo2GameState>>('ludo2');
    if (!games) return;
    const now = Date.now();
    const removals: Promise<void>[] = [];
    for (const [code, game] of Object.entries(games)) {
      if (game.createdAt && now - game.createdAt > STALE_GAME_AGE_MS) {
        removals.push(proxyRemove(`ludo2/${code}`));
      }
    }
    if (removals.length > 0) {
      await Promise.all(removals);
      console.log(`[Ludo2] Cleaned up ${removals.length} stale game(s)`);
    }
  } catch (err) {
    console.warn('[Ludo2] Stale game cleanup failed:', err);
  }
}

/** Whether `sessionId` holds the host seat. The UI already only offers the bot
 * controls to the host; this is the same rule where it can actually be relied
 * on, so a second tab or a stale client cannot reshape someone else's room. */
function isHost(state: Ludo2GameState, sessionId: string): boolean {
  const host = state.players[state.host ?? 'red'];
  return !!host && host.sessionId === sessionId;
}

export async function addBot(code: string, color: Ludo2Color, sessionId: string): Promise<void> {
  await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;
    if (!isHost(current, sessionId)) return undefined;
    if (current.players[color]) return undefined;
    return {
      ...current,
      players: { ...current.players, [color]: { sessionId: `bot-${color}`, name: BOT_NAMES[color] } },
    };
  });
}

export async function removeBot(code: string, color: Ludo2Color, sessionId: string): Promise<void> {
  await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;
    if (!isHost(current, sessionId)) return undefined;
    const player = current.players[color];
    if (!player || !player.sessionId.startsWith('bot-')) return undefined;
    const newPlayers = { ...current.players };
    delete newPlayers[color];
    return { ...current, players: newPlayers };
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

  await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
    roomIsEmpty = false;
    if (!current) return current;

    const seat = PLAYER_COLORS.find((c) => current.players[c]?.sessionId === sessionId);
    if (!seat) return undefined; // Not at this table

    const players = { ...current.players };
    if (current.startedAt) {
      players[seat] = { sessionId: `bot-${seat}`, name: BOT_NAMES[seat] };
    } else {
      delete players[seat];
    }

    const humansLeft = PLAYER_COLORS.filter(
      (c) => players[c] && !players[c]!.sessionId.startsWith('bot-')
    );
    if (humansLeft.length === 0) {
      roomIsEmpty = true;
      return { ...current, players };
    }

    const hostSeat = current.host ?? 'red';
    const nextHost = humansLeft.includes(hostSeat) ? hostSeat : humansLeft[0];

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
      await proxyRemove(`ludo2/${code}`);
    } catch (err) {
      console.warn('[Ludo2] Could not remove empty game:', err);
    }
  }
}

export async function startGame(code: string): Promise<void> {
  await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;

    const filledColors = PLAYER_COLORS.filter((c) => !!current.players[c]);
    if (filledColors.length < 2) return undefined;

    const lastFilledIdx = Math.max(...filledColors.map((c) => PLAYER_COLORS.indexOf(c)));
    const playerCount = lastFilledIdx + 1;

    const newPlayers = { ...current.players };
    for (let i = 0; i < playerCount; i++) {
      const c = PLAYER_COLORS[i];
      if (!newPlayers[c]) newPlayers[c] = { sessionId: `bot-${c}`, name: BOT_NAMES[c] };
    }

    const hasBots = Object.entries(newPlayers)
      .filter(([c]) => PLAYER_COLORS.indexOf(c as Ludo2Color) < playerCount)
      .some(([, p]) => p && (p as LudoPlayer).sessionId.startsWith('bot-'));

    const activePlayers = PLAYER_COLORS.slice(0, playerCount);
    const arr = new Uint8Array(1);
    crypto.getRandomValues(arr);
    const randomFirst = activePlayers[arr[0] % activePlayers.length];

    return {
      ...current,
      players: newPlayers,
      playerCount,
      startedAt: Date.now(),
      turnStartedAt: getServerTimestamp() as unknown as number,
      currentTurn: randomFirst,
      ...(hasBots ? { singlePlayer: true } : {}),
    };
  });
}

export async function joinGame(
  code: string,
  sessionId: string,
  userName: string
): Promise<{ state: Ludo2GameState; assignedColor: Ludo2Color }> {
  let joinError: string | null = null;

  await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
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
    let foundColor: Ludo2Color | null = null;
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
    return {
      ...current,
      players: { ...current.players, [foundColor]: { sessionId, name: userName } },
    };
  });

  if (joinError) throw new Error(joinError);

  const finalState = await proxyGet<Ludo2GameState>(`ludo2/${code}`);
  if (!finalState) throw new Error('Game not found');

  let confirmedColor: Ludo2Color | null = null;
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
  callback: (state: Ludo2GameState | null) => void,
  onConnectionChange?: (connected: boolean) => void
): Promise<Unsubscribe> {
  return subscribeToPath<Ludo2GameState>(`ludo2/${code}`, 'Ludo2', callback, onConnectionChange);
}

export async function makeMove(
  code: string,
  expectedTurn: Ludo2Color,
  updates: Ludo2MoveUpdate
): Promise<boolean> {
  const result = await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
    if (!current) return current;
    if (current.currentTurn !== expectedTurn) return undefined; // Not this player's turn
    if (current.winner != null) return undefined; // Game over
    return {
      ...current,
      ...updates,
      // Re-merge against the freshly-read value so a concurrent writer's rolls
      // aren't lost (see mergeRollStats in ludo2Board). Runs on every attempt.
      ...(updates.rollStats && current.rollStats
        ? { rollStats: mergeRollStats(current.rollStats, updates.rollStats) }
        : {}),
    };
  });
  return result.committed;
}

export async function toggleGamePause(code: string): Promise<void> {
  await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
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
  const arr = new Uint8Array(1);
  crypto.getRandomValues(arr);
  const randomFirst = activePlayers[arr[0] % activePlayers.length];

  await proxyTransaction<Ludo2GameState>(`ludo2/${code}`, (current) => {
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
      singlePlayer: hasBots,
    };
  });
}

/**
 * Client-side dice roll (the server-side roll endpoint is blocked behind the
 * VPNs this proxy exists to support — acceptable for a hidden, casual game).
 */
export async function requestDiceRoll(): Promise<{ rolls: number[]; serverGenerated: boolean }> {
  return { rolls: [Math.floor(Math.random() * 6) + 1], serverGenerated: false };
}
