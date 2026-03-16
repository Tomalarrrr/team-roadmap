import type { Unsubscribe } from 'firebase/database';
import { ensureInitialized, getDbModule, getFirebaseDatabase, markFirebaseActivity } from './firebase';
import { generateGameCode } from './utils/gameUtils';
import { initMysteryBoxes, serializeMysteryBoxes } from './ludoPowerUps';

// --- Types ---

export type LudoColor = 'red' | 'green' | 'yellow' | 'blue';
export type TokenPosition = 'base' | `track-${number}` | `final-${number}`;
export type TurnPhase = 'roll' | 'move';

export interface LudoPlayer {
  sessionId: string;
  name: string;
}

export interface LudoGameState {
  players: {
    red: LudoPlayer;
    green?: LudoPlayer | null;
    yellow?: LudoPlayer | null;
    blue?: LudoPlayer | null;
  };
  tokens: string;
  currentTurn: LudoColor;
  turnPhase: TurnPhase;
  diceValue: number | null;
  consecutiveSixes: number;
  winner: LudoColor | null;
  finishOrder: string;
  createdAt: number;
  startedAt: number | null;
  turnStartedAt: number;
  playerCount: number;
  // Mario Mode power-up fields (optional for backwards compat)
  powerUpsEnabled?: boolean;
  powerUps?: string;        // Serialized inventory (2-char codes, 4 players × 1 slot)
  boardEffects?: string;    // Persistent board effects (banana peels, etc.)
  activeBuffs?: string;     // Duration-based buffs (star, lightning, etc.)
  coins?: string;           // Coin counts per player "R:G:Y:B"
  mysteryBoxes?: string;    // Active mystery box cells + cooldowns "cell:cd,cell:cd,..."
  paused?: boolean;         // Per-game pause state
  pausedAt?: number;        // Timestamp when paused (to adjust turnStartedAt on resume)
  singlePlayer?: boolean;   // 1-player mode with AI bots
}

export interface LudoMoveUpdate {
  tokens: string;
  currentTurn: LudoColor;
  turnPhase: TurnPhase;
  diceValue: number | null;
  consecutiveSixes: number;
  winner: LudoColor | null;
  finishOrder: string;
  turnStartedAt: number;
  // Mario Mode fields (optional)
  powerUps?: string;
  boardEffects?: string;
  activeBuffs?: string;
  coins?: string;
  mysteryBoxes?: string;
}

// --- Serialization ---

const INITIAL_TOKENS = 'bas'.repeat(16);

export function serializeTokens(tokens: TokenPosition[]): string {
  return tokens.map(t => {
    if (t === 'base') return 'bas';
    if (t.startsWith('track-')) {
      const n = parseInt(t.split('-')[1]);
      return 't' + String(n).padStart(2, '0');
    }
    if (t.startsWith('final-')) {
      const n = parseInt(t.split('-')[1]);
      return 'f' + String(n).padStart(2, '0');
    }
    return 'bas';
  }).join('');
}

export function deserializeTokens(str: string): TokenPosition[] {
  const tokens: TokenPosition[] = [];
  for (let i = 0; i < str.length; i += 3) {
    const chunk = str.substring(i, i + 3);
    if (chunk === 'bas') {
      tokens.push('base');
    } else if (chunk[0] === 't') {
      tokens.push(`track-${parseInt(chunk.substring(1))}`);
    } else if (chunk[0] === 'f') {
      tokens.push(`final-${parseInt(chunk.substring(1))}`);
    } else {
      tokens.push('base');
    }
  }
  return tokens;
}

// --- Firebase API ---

const JOIN_ORDER: LudoColor[] = ['green', 'yellow', 'blue'];

export async function createGame(
  sessionId: string,
  userName: string,
  playerCount: number,
  powerUpsEnabled = false
): Promise<string> {
  await ensureInitialized();
  const { ref, runTransaction } = getDbModule();
  const db = getFirebaseDatabase();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();
    const gameRef = ref(db, `ludo/${code}`);

    const isSolo = playerCount === 1;
    const actualPlayerCount = isSolo ? 4 : playerCount;
    const botNames = ['Bot Green', 'Bot Yellow', 'Bot Blue'];
    const initialState: LudoGameState = {
      players: {
        red: { sessionId, name: userName },
        ...(isSolo ? {
          green: { sessionId: 'bot-green', name: botNames[0] },
          yellow: { sessionId: 'bot-yellow', name: botNames[1] },
          blue: { sessionId: 'bot-blue', name: botNames[2] },
        } : {}),
      },
      tokens: INITIAL_TOKENS,
      currentTurn: 'red',
      turnPhase: 'roll',
      diceValue: null,
      consecutiveSixes: 0,
      winner: null,
      finishOrder: '',
      createdAt: Date.now(),
      startedAt: isSolo ? Date.now() : null,
      turnStartedAt: Date.now(),
      playerCount: actualPlayerCount,
      ...(isSolo ? { singlePlayer: true } : {}),
      ...(powerUpsEnabled ? {
        powerUpsEnabled: true,
        powerUps: '__'.repeat(4),
        boardEffects: '',
        activeBuffs: '',
        coins: '0:0:0:0',
        mysteryBoxes: serializeMysteryBoxes(initMysteryBoxes()),
      } : {}),
    };

    // Atomic create: only succeeds if code doesn't already exist
    const result = await runTransaction(gameRef, (current: LudoGameState | null) => {
      if (current !== null) return; // Abort — code already taken
      return initialState;
    });
    if (result.committed) return code;
  }

  throw new Error('Failed to generate unique game code. Try again.');
}

export async function joinGame(
  code: string,
  sessionId: string,
  userName: string
): Promise<{ state: LudoGameState; assignedColor: LudoColor }> {
  await ensureInitialized();
  const { ref, runTransaction, get } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `ludo/${code}`);
  let joinError: string | null = null;

  await runTransaction(gameRef, (current: LudoGameState | null) => {
    if (!current) return current; // Retry with real data

    const allColors: LudoColor[] = ['red', ...JOIN_ORDER];

    // Reconnection by sessionId
    for (const color of allColors) {
      const player = current.players[color];
      if (player && player.sessionId === sessionId) {
        return current; // No change — reconnected by sessionId
      }
    }

    // Find empty slot
    const maxSlots = current.playerCount;
    const availableColors = JOIN_ORDER.slice(0, maxSlots - 1);
    let foundColor: LudoColor | null = null;
    for (const color of availableColors) {
      if (!current.players[color]) {
        foundColor = color;
        break;
      }
    }

    if (!foundColor) {
      joinError = 'Game is full';
      return; // Abort
    }

    const updated: LudoGameState = {
      ...current,
      players: { ...current.players, [foundColor]: { sessionId, name: userName } },
    };

    // Start game if all players joined
    const joinedCount = Object.values(current.players).filter(Boolean).length + 1;
    if (joinedCount >= maxSlots) {
      const activePlayers: LudoColor[] = (['red', 'green', 'yellow', 'blue'] as LudoColor[]).slice(0, maxSlots);
      const arr = new Uint8Array(1);
      crypto.getRandomValues(arr);
      const randomFirst = activePlayers[arr[0] % activePlayers.length];
      updated.startedAt = Date.now();
      updated.turnStartedAt = Date.now();
      updated.currentTurn = randomFirst;
    }

    return updated;
  });

  if (joinError) throw new Error(joinError);

  // Read final committed state and determine color from it (avoids stale closure on retry)
  const finalSnap = await get(gameRef);
  if (!finalSnap.exists()) throw new Error('Game not found');
  const finalState = finalSnap.val() as LudoGameState;

  // Determine assigned color from final state (authoritative, not closure)
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

export async function subscribeToGame(
  code: string,
  callback: (state: LudoGameState | null) => void
): Promise<Unsubscribe> {
  await ensureInitialized();
  const { ref, onValue } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `ludo/${code}`);

  const unsubscribe = onValue(
    gameRef,
    (snapshot) => {
      markFirebaseActivity();
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      callback(snapshot.val() as LudoGameState);
    },
    (error) => {
      console.error('[Ludo] Listener error:', error);
      callback(null);
    }
  );

  return unsubscribe;
}

export async function makeMove(
  code: string,
  expectedTurn: LudoColor,
  updates: LudoMoveUpdate
): Promise<boolean> {
  await ensureInitialized();
  const { ref, runTransaction } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `ludo/${code}`);
  const result = await runTransaction(gameRef, (current: LudoGameState | null) => {
    if (!current) return current;
    if (current.currentTurn !== expectedTurn) return; // Abort: not this player's turn
    if (current.winner != null) return; // Abort: game over

    return { ...current, ...updates };
  });

  return result.committed;
}

export async function toggleGamePause(code: string): Promise<void> {
  await ensureInitialized();
  const { ref, runTransaction } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `ludo/${code}`);
  await runTransaction(gameRef, (current: LudoGameState | null) => {
    if (!current) return current;
    const isPaused = !current.paused;
    if (isPaused) {
      // Pausing: record when we paused
      return { ...current, paused: true, pausedAt: Date.now() };
    } else {
      // Resuming: adjust turnStartedAt by how long we were paused
      const pauseDuration = current.pausedAt ? Date.now() - current.pausedAt : 0;
      return {
        ...current,
        paused: false,
        pausedAt: null,
        turnStartedAt: (current.turnStartedAt || 0) + pauseDuration,
      };
    }
  });
}

export async function spectateGame(code: string): Promise<LudoGameState> {
  await ensureInitialized();
  const { ref, get } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `ludo/${code}`);
  const snapshot = await get(gameRef);

  if (!snapshot.exists()) {
    throw new Error('Game not found');
  }

  return snapshot.val() as LudoGameState;
}

export async function resetGame(code: string, playerCount: number): Promise<void> {
  await ensureInitialized();
  const { ref, runTransaction } = getDbModule();
  const db = getFirebaseDatabase();

  const activePlayers: LudoColor[] = (['red', 'green', 'yellow', 'blue'] as LudoColor[]).slice(0, playerCount);
  const arr = new Uint8Array(1);
  crypto.getRandomValues(arr);
  const randomFirst = activePlayers[arr[0] % activePlayers.length];

  const gameRef = ref(db, `ludo/${code}`);

  await runTransaction(gameRef, (current: LudoGameState | null) => {
    if (!current) return current;
    const hasPowerUps = current.powerUpsEnabled === true;
    const isSolo = current.singlePlayer === true;

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
      turnStartedAt: Date.now(),
      playerCount,
      paused: false,
      pausedAt: null,
      ...(isSolo ? { singlePlayer: true } : {}),
      ...(hasPowerUps ? {
        powerUps: '__'.repeat(4),
        boardEffects: '',
        activeBuffs: '',
        coins: '0:0:0:0',
        mysteryBoxes: serializeMysteryBoxes(initMysteryBoxes()),
      } : {}),
    };
  });
}
