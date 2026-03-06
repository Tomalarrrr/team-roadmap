import type { Unsubscribe } from 'firebase/database';
import { ensureInitialized, getDbModule, getFirebaseDatabase, markFirebaseActivity } from './firebase';
import { generateGameCode } from './utils/gameUtils';

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
  playerCount: number
): Promise<string> {
  await ensureInitialized();
  const { ref, get, set } = getDbModule();
  const db = getFirebaseDatabase();

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();
    const gameRef = ref(db, `ludo/${code}`);
    const snapshot = await get(gameRef);

    if (!snapshot.exists()) {
      const initialState: LudoGameState = {
        players: {
          red: { sessionId, name: userName },
        },
        tokens: INITIAL_TOKENS,
        currentTurn: 'red',
        turnPhase: 'roll',
        diceValue: null,
        consecutiveSixes: 0,
        winner: null,
        finishOrder: '',
        createdAt: Date.now(),
        startedAt: null,
        turnStartedAt: Date.now(),
        playerCount,
      };
      await set(gameRef, initialState);
      return code;
    }
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
  let assignedColor: LudoColor = 'green';
  let joinError: string | null = null;

  await runTransaction(gameRef, (current: LudoGameState | null) => {
    if (!current) return current; // Retry with real data

    const allColors: LudoColor[] = ['red', ...JOIN_ORDER];

    // Reconnection by sessionId
    for (const color of allColors) {
      const player = current.players[color];
      if (player && player.sessionId === sessionId) {
        assignedColor = color;
        return current; // No change
      }
    }

    // Reconnection by name
    const normalName = userName.trim().toLowerCase();
    for (const color of allColors) {
      const player = current.players[color];
      if (player && player.name.trim().toLowerCase() === normalName) {
        assignedColor = color;
        return {
          ...current,
          players: { ...current.players, [color]: { ...player, sessionId } },
        };
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

    assignedColor = foundColor;
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

  // Read final state
  const finalSnap = await get(gameRef);
  if (!finalSnap.exists()) throw new Error('Game not found');
  return { state: finalSnap.val() as LudoGameState, assignedColor };
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
  const { ref, update } = getDbModule();
  const db = getFirebaseDatabase();

  const activePlayers: LudoColor[] = (['red', 'green', 'yellow', 'blue'] as LudoColor[]).slice(0, playerCount);
  const arr = new Uint8Array(1);
  crypto.getRandomValues(arr);
  const randomFirst = activePlayers[arr[0] % activePlayers.length];

  const gameRef = ref(db, `ludo/${code}`);
  await update(gameRef, {
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
  });
}
