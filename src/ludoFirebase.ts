import type { Unsubscribe } from 'firebase/database';
import { ensureInitialized, getDbModule, getFirebaseDatabase, markFirebaseActivity } from './firebase';

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

// --- Game code generation ---

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateGameCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
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
  const { ref, get, set, update } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `ludo/${code}`);
  const snapshot = await get(gameRef);

  if (!snapshot.exists()) {
    throw new Error('Game not found');
  }

  const state = snapshot.val() as LudoGameState;

  // Check if this session is already in the game (reconnection by sessionId)
  for (const color of ['red', ...JOIN_ORDER] as LudoColor[]) {
    const player = state.players[color];
    if (player && player.sessionId === sessionId) {
      return { state, assignedColor: color };
    }
  }

  // Check for reconnection by name (handles tab close → new sessionId)
  const normalName = userName.trim().toLowerCase();
  for (const color of ['red', ...JOIN_ORDER] as LudoColor[]) {
    const player = state.players[color];
    if (player && player.name.trim().toLowerCase() === normalName) {
      const playerRef = ref(db, `ludo/${code}/players/${color}/sessionId`);
      await set(playerRef, sessionId);
      return { state: { ...state, players: { ...state.players, [color]: { sessionId, name: player.name } } }, assignedColor: color as LudoColor };
    }
  }

  // Find next empty slot
  let assignedColor: LudoColor | null = null;
  const maxSlots = state.playerCount;
  const availableColors = JOIN_ORDER.slice(0, maxSlots - 1);

  for (const color of availableColors) {
    if (!state.players[color]) {
      assignedColor = color;
      break;
    }
  }

  if (!assignedColor) {
    throw new Error('Game is full');
  }

  const playerRef = ref(db, `ludo/${code}/players/${assignedColor}`);
  await set(playerRef, { sessionId, name: userName });

  // Check if all required players have joined — start the game
  const joinedCount = Object.values(state.players).filter(Boolean).length + 1;
  if (joinedCount >= maxSlots) {
    const activePlayers: LudoColor[] = (['red', 'green', 'yellow', 'blue'] as LudoColor[]).slice(0, maxSlots);
    const randomFirst = activePlayers[Math.floor(Math.random() * activePlayers.length)];
    await update(gameRef, { startedAt: Date.now(), turnStartedAt: Date.now(), currentTurn: randomFirst });
  }

  return {
    state: {
      ...state,
      players: { ...state.players, [assignedColor]: { sessionId, name: userName } },
    },
    assignedColor,
  };
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
  updates: LudoMoveUpdate
): Promise<void> {
  await ensureInitialized();
  const { ref, update } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `ludo/${code}`);
  await update(gameRef, updates);
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
  const randomFirst = activePlayers[Math.floor(Math.random() * activePlayers.length)];

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
