// Ludo game data access via the Vercel proxy (api/proxy.ts) instead of the
// Firebase SDK. Why: corporate VPNs (Imprivata) block Firebase's WebSocket, so
// the SDK-based game (src/ludoFirebase.ts) can't connect. This mirrors that
// module's interface but talks to /api/db/ludo/* over plain HTTPS.
//
// Two hard parts are emulated here:
//  - runTransaction → GET-with-ETag, run the updater, conditional PUT with
//    `if-match`; on 412 (someone else wrote first) re-read and retry.
//  - onValue (realtime) → polling (~1.2s while visible). Turn-based, so the
//    latency is acceptable.
//
// Pure helpers and types are re-exported from ludoFirebase so callers have a
// single import site.

import {
  serializeTokens,
  deserializeTokens,
  type LudoColor,
  type LudoPlayer,
  type LudoGameState,
  type LudoMoveUpdate,
  type TokenPosition,
  type TurnPhase,
} from '../ludoFirebase';
import { generateGameCode } from '../utils/gameUtils';
import {
  initMysteryBoxes,
  serializeMysteryBoxes,
  generateFlagCell,
  serializeFlag,
  initRollStats,
} from '../ludoPowerUps';

export { serializeTokens, deserializeTokens };
export type { LudoColor, LudoPlayer, LudoGameState, LudoMoveUpdate, TokenPosition, TurnPhase };

export type Unsubscribe = () => void;

const PROXY_BASE = '/api/db';
const POLL_INTERVAL_MS = 1200;
const HIDDEN_POLL_INTERVAL_MS = 15000;
const MAX_TXN_RETRIES = 12;

// Firebase REST honours the server-timestamp sentinel in write bodies, so we
// send it directly instead of the SDK's serverTimestamp() object.
export function getServerTimestamp(): object {
  return { '.sv': 'timestamp' };
}

// ---------- Low-level proxy helpers ----------

async function proxyGet<T = unknown>(path: string): Promise<T | null> {
  const res = await fetch(`${PROXY_BASE}/${path}`, { method: 'GET', cache: 'no-store' });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const text = await res.text();
  return text && text !== 'null' ? (JSON.parse(text) as T) : null;
}

async function proxyGetWithEtag<T = unknown>(path: string): Promise<{ value: T | null; etag: string }> {
  const res = await fetch(`${PROXY_BASE}/${path}`, {
    method: 'GET',
    headers: { 'X-Firebase-ETag': 'true' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GET ${path} (etag) failed: ${res.status}`);
  const etag = res.headers.get('ETag') ?? '';
  const text = await res.text();
  const value = text && text !== 'null' ? (JSON.parse(text) as T) : null;
  return { value, etag };
}

async function proxyRemove(path: string): Promise<void> {
  const res = await fetch(`${PROXY_BASE}/${path}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

interface TxnResult<T> {
  committed: boolean;
  snapshot: T | null;
}

/**
 * Emulate Firebase runTransaction over REST. `updater` receives the current
 * value and returns the new value, or `undefined` to abort (matching the SDK).
 * Uses ETag conditional writes so concurrent writers can't clobber each other.
 *
 * The updater returns `object | null | undefined` rather than strictly `T` to
 * match Firebase's untyped transaction callback — the returned shapes include
 * server-timestamp sentinels and explicit nulls that don't satisfy the strict
 * state type but serialize correctly for the REST write.
 */
async function proxyTransaction<T>(
  path: string,
  updater: (current: T | null) => object | null | undefined
): Promise<TxnResult<T>> {
  for (let attempt = 0; attempt < MAX_TXN_RETRIES; attempt++) {
    const { value, etag } = await proxyGetWithEtag<T>(path);
    const next = updater(value);
    // undefined = explicit abort; null is only ever returned as a "game doesn't
    // exist, can't proceed" signal — never to delete — so treat it as abort too.
    if (next === undefined || next === null) {
      return { committed: false, snapshot: value };
    }
    const res = await fetch(`${PROXY_BASE}/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': etag },
      body: JSON.stringify(next),
    });
    if (res.ok) {
      return { committed: true, snapshot: next as T };
    }
    if (res.status !== 412) {
      throw new Error(`Transaction PUT ${path} failed: ${res.status}`);
    }
    // 412 Precondition Failed → value changed under us; re-read and retry.
  }
  return { committed: false, snapshot: null };
}

// ---------- Constants (mirrored from ludoFirebase) ----------

const INITIAL_TOKENS = 'bas'.repeat(16);
const JOIN_ORDER: LudoColor[] = ['green', 'yellow', 'blue'];
const STALE_GAME_AGE_MS = 24 * 60 * 60 * 1000;
const BOT_NAMES: Record<LudoColor, string> = {
  red: 'Bot Red',
  green: 'Bot Green',
  yellow: 'Bot Yellow',
  blue: 'Bot Blue',
};

// ---------- Public API (mirrors ludoFirebase) ----------

export async function createGame(
  sessionId: string,
  userName: string,
  powerUpsEnabled = false
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();

    const initialState: LudoGameState = {
      players: { red: { sessionId, name: userName } },
      tokens: INITIAL_TOKENS,
      currentTurn: 'red',
      turnPhase: 'roll',
      diceValue: null,
      consecutiveSixes: 0,
      winner: null,
      finishOrder: '',
      createdAt: Date.now(),
      startedAt: null,
      turnStartedAt: getServerTimestamp() as unknown as number,
      playerCount: 4,
      rollStats: initRollStats(),
      ...(powerUpsEnabled
        ? {
            powerUpsEnabled: true,
            powerUps: '__'.repeat(4),
            boardEffects: '',
            activeBuffs: '',
            coins: '0:0:0:0',
            mysteryBoxes: serializeMysteryBoxes(initMysteryBoxes()),
            flag: serializeFlag({ cell: generateFlagCell(), carrier: null, used: false }),
          }
        : {}),
    };

    const result = await proxyTransaction<LudoGameState>(`ludo/${code}`, (current) => {
      if (current !== null) return undefined; // Code taken — abort
      return initialState;
    });
    if (result.committed) {
      cleanupStaleGames();
      return code;
    }
  }
  throw new Error('Failed to generate unique game code. Try again.');
}

export async function cleanupStaleGames(): Promise<void> {
  try {
    const games = await proxyGet<Record<string, LudoGameState>>('ludo');
    if (!games) return;
    const now = Date.now();
    const removals: Promise<void>[] = [];
    for (const [code, game] of Object.entries(games)) {
      if (game.createdAt && now - game.createdAt > STALE_GAME_AGE_MS) {
        removals.push(proxyRemove(`ludo/${code}`));
      }
    }
    if (removals.length > 0) {
      await Promise.all(removals);
      console.log(`[Ludo] Cleaned up ${removals.length} stale game(s)`);
    }
  } catch (err) {
    console.warn('[Ludo] Stale game cleanup failed:', err);
  }
}

export async function addBot(code: string, color: LudoColor): Promise<void> {
  await proxyTransaction<LudoGameState>(`ludo/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;
    if (current.players[color]) return undefined;
    return {
      ...current,
      players: { ...current.players, [color]: { sessionId: `bot-${color}`, name: BOT_NAMES[color] } },
    };
  });
}

export async function removeBot(code: string, color: LudoColor): Promise<void> {
  await proxyTransaction<LudoGameState>(`ludo/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;
    const player = current.players[color];
    if (!player || !player.sessionId.startsWith('bot-')) return undefined;
    const newPlayers = { ...current.players };
    delete newPlayers[color];
    return { ...current, players: newPlayers };
  });
}

export async function startGame(code: string): Promise<void> {
  await proxyTransaction<LudoGameState>(`ludo/${code}`, (current) => {
    if (!current) return current;
    if (current.startedAt) return undefined;

    const allColors: LudoColor[] = ['red', 'green', 'yellow', 'blue'];
    const filledColors = allColors.filter((c) => !!current.players[c]);
    if (filledColors.length < 2) return undefined;

    const lastFilledIdx = Math.max(...filledColors.map((c) => allColors.indexOf(c)));
    const playerCount = lastFilledIdx + 1;

    const newPlayers = { ...current.players };
    for (let i = 0; i < playerCount; i++) {
      const c = allColors[i];
      if (!newPlayers[c]) newPlayers[c] = { sessionId: `bot-${c}`, name: BOT_NAMES[c] };
    }

    const hasBots = Object.entries(newPlayers)
      .filter(([c]) => allColors.indexOf(c as LudoColor) < playerCount)
      .some(([, p]) => p && (p as LudoPlayer).sessionId.startsWith('bot-'));

    const activePlayers = allColors.slice(0, playerCount);
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
): Promise<{ state: LudoGameState; assignedColor: LudoColor }> {
  let joinError: string | null = null;

  await proxyTransaction<LudoGameState>(`ludo/${code}`, (current) => {
    joinError = null;
    if (!current) return current;

    const allColors: LudoColor[] = ['red', ...JOIN_ORDER];

    for (const color of allColors) {
      const player = current.players[color];
      if (player && player.sessionId === sessionId) {
        return current; // Reconnected by sessionId
      }
    }

    if (current.startedAt) {
      const availableColors = JOIN_ORDER.slice(0, current.playerCount - 1);
      let foundColor: LudoColor | null = null;
      for (const color of availableColors) {
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
    }

    let foundColor: LudoColor | null = null;
    for (const color of JOIN_ORDER) {
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

  const finalState = await proxyGet<LudoGameState>(`ludo/${code}`);
  if (!finalState) throw new Error('Game not found');

  const allColors: LudoColor[] = ['red', ...JOIN_ORDER];
  let confirmedColor: LudoColor | null = null;
  for (const color of allColors) {
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
  callback: (state: LudoGameState | null) => void
): Promise<Unsubscribe> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSerialized: string | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const state = await proxyGet<LudoGameState>(`ludo/${code}`);
      const serialized = JSON.stringify(state);
      if (serialized !== lastSerialized) {
        lastSerialized = serialized;
        callback(state);
      }
    } catch (err) {
      console.error('[Ludo] Poll error:', err);
      // Keep polling — a transient failure shouldn't drop the player out.
    } finally {
      if (!stopped) {
        const interval =
          document.visibilityState === 'hidden' ? HIDDEN_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
        timer = setTimeout(tick, interval);
      }
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !stopped) {
      if (timer) clearTimeout(timer);
      void tick();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  timer = setTimeout(tick, 0);

  const unsubscribe: Unsubscribe = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  return Promise.resolve(unsubscribe);
}

export async function makeMove(
  code: string,
  expectedTurn: LudoColor,
  updates: LudoMoveUpdate
): Promise<boolean> {
  const result = await proxyTransaction<LudoGameState>(`ludo/${code}`, (current) => {
    if (!current) return current;
    if (current.currentTurn !== expectedTurn) return undefined; // Not this player's turn
    if (current.winner != null) return undefined; // Game over
    return { ...current, ...updates };
  });
  return result.committed;
}

export async function toggleGamePause(code: string): Promise<void> {
  await proxyTransaction<LudoGameState>(`ludo/${code}`, (current) => {
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

export async function spectateGame(code: string): Promise<LudoGameState> {
  const state = await proxyGet<LudoGameState>(`ludo/${code}`);
  if (!state) throw new Error('Game not found');
  return state;
}

export async function resetGame(code: string, playerCount: number): Promise<void> {
  const activePlayers: LudoColor[] = (['red', 'green', 'yellow', 'blue'] as LudoColor[]).slice(0, playerCount);
  const arr = new Uint8Array(1);
  crypto.getRandomValues(arr);
  const randomFirst = activePlayers[arr[0] % activePlayers.length];

  await proxyTransaction<LudoGameState>(`ludo/${code}`, (current) => {
    if (!current) return current;
    const hasPowerUps = current.powerUpsEnabled === true;
    const allColors: LudoColor[] = ['red', 'green', 'yellow', 'blue'];
    const hasBots = allColors.slice(0, playerCount).some((c) => {
      const p = current.players[c];
      return p && p.sessionId.startsWith('bot-');
    });

    return {
      ...current,
      tokens: INITIAL_TOKENS,
      currentTurn: randomFirst,
      turnPhase: 'roll' as TurnPhase,
      diceValue: null,
      consecutiveSixes: 0,
      winner: null,
      finishOrder: '',
      startedAt: Date.now(),
      turnStartedAt: getServerTimestamp() as unknown as number,
      playerCount,
      paused: false,
      pausedAt: null,
      rollStats: initRollStats(),
      ...(hasBots ? { singlePlayer: true } : { singlePlayer: false }),
      ...(hasPowerUps
        ? {
            powerUps: '__'.repeat(4),
            boardEffects: '',
            activeBuffs: '',
            coins: '0:0:0:0',
            mysteryBoxes: serializeMysteryBoxes(initMysteryBoxes()),
            flag: serializeFlag({ cell: generateFlagCell(), carrier: null, used: false }),
          }
        : {}),
    };
  });
}

/**
 * Client-side dice roll. The SDK version tries a Cloud Function first, but that
 * endpoint is also blocked behind the VPN this proxy exists to work around, so
 * we roll locally. Acceptable for a hidden, casual game.
 */
export async function requestDiceRoll(
  _gameCode: string,
  _sessionId: string,
  count: 1 | 3 = 1
): Promise<{ rolls: number[]; serverGenerated: boolean }> {
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) rolls.push(Math.floor(Math.random() * 6) + 1);
  return { rolls, serverGenerated: false };
}
