import type { Unsubscribe } from 'firebase/database';
import { ensureInitialized, getDbModule, getFirebaseDatabase } from './firebase';
import { serializePositions } from './utils/snakesLogic';

// --- Types ---

export interface SnakesPlayer {
  sessionId: string;
  name: string;
}

export interface SnakesGameState {
  players: Record<string, SnakesPlayer>;
  positions: string;
  currentTurn: number;
  diceValue: number | null;
  consecutiveSixes: number;
  winner: number | null;
  createdAt: number;
  startedAt: number | null;
  turnStartedAt: number;
  playerCount: number;
  moveLog: string;
}

export interface SnakesMoveUpdate {
  positions: string;
  currentTurn: number;
  diceValue: number | null;
  consecutiveSixes: number;
  winner: number | null;
  turnStartedAt: number;
  moveLog: string;
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
    const gameRef = ref(db, `snakes/${code}`);
    const snapshot = await get(gameRef);

    if (!snapshot.exists()) {
      const initialPositions = serializePositions(new Array(playerCount).fill(0));
      const initialState: SnakesGameState = {
        players: {
          p0: { sessionId, name: userName },
        },
        positions: initialPositions,
        currentTurn: 0,
        diceValue: null,
        consecutiveSixes: 0,
        winner: null,
        createdAt: Date.now(),
        startedAt: null,
        turnStartedAt: Date.now(),
        playerCount,
        moveLog: '',
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
): Promise<{ state: SnakesGameState; assignedSlot: number }> {
  await ensureInitialized();
  const { ref, get, set, update } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `snakes/${code}`);
  const snapshot = await get(gameRef);

  if (!snapshot.exists()) {
    throw new Error('Game not found');
  }

  const state = snapshot.val() as SnakesGameState;

  // Reconnection by sessionId
  for (let i = 0; i < state.playerCount; i++) {
    const key = `p${i}`;
    const player = state.players[key];
    if (player && player.sessionId === sessionId) {
      return { state, assignedSlot: i };
    }
  }

  // Reconnection by name
  for (let i = 0; i < state.playerCount; i++) {
    const key = `p${i}`;
    const player = state.players[key];
    if (player && player.name === userName) {
      const playerRef = ref(db, `snakes/${code}/players/${key}/sessionId`);
      await set(playerRef, sessionId);
      return {
        state: {
          ...state,
          players: { ...state.players, [key]: { sessionId, name: userName } },
        },
        assignedSlot: i,
      };
    }
  }

  // Find next empty slot
  let assignedSlot: number | null = null;
  for (let i = 1; i < state.playerCount; i++) {
    const key = `p${i}`;
    if (!state.players[key]) {
      assignedSlot = i;
      break;
    }
  }

  if (assignedSlot === null) {
    throw new Error('Game is full');
  }

  const playerRef = ref(db, `snakes/${code}/players/p${assignedSlot}`);
  await set(playerRef, { sessionId, name: userName });

  // Check if all required players have joined — start the game
  const joinedCount = Object.values(state.players).filter(Boolean).length + 1;
  if (joinedCount >= state.playerCount) {
    const randomFirst = Math.floor(Math.random() * state.playerCount);
    await update(gameRef, { startedAt: Date.now(), turnStartedAt: Date.now(), currentTurn: randomFirst });
  }

  return {
    state: {
      ...state,
      players: { ...state.players, [`p${assignedSlot}`]: { sessionId, name: userName } },
    },
    assignedSlot,
  };
}

export async function spectateGame(code: string): Promise<SnakesGameState> {
  await ensureInitialized();
  const { ref, get } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `snakes/${code}`);
  const snapshot = await get(gameRef);

  if (!snapshot.exists()) {
    throw new Error('Game not found');
  }

  return snapshot.val() as SnakesGameState;
}

export async function subscribeToGame(
  code: string,
  callback: (state: SnakesGameState | null) => void
): Promise<Unsubscribe> {
  await ensureInitialized();
  const { ref, onValue } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `snakes/${code}`);

  const unsubscribe = onValue(
    gameRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      callback(snapshot.val() as SnakesGameState);
    },
    (error) => {
      console.error('[Snakes] Listener error:', error);
      callback(null);
    }
  );

  return unsubscribe;
}

export async function makeMove(
  code: string,
  updates: SnakesMoveUpdate
): Promise<void> {
  await ensureInitialized();
  const { ref, update } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `snakes/${code}`);
  await update(gameRef, updates);
}

export async function resetGame(code: string, playerCount: number): Promise<void> {
  await ensureInitialized();
  const { ref, update } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `snakes/${code}`);
  const initialPositions = serializePositions(new Array(playerCount).fill(0));
  const randomFirst = Math.floor(Math.random() * playerCount);
  await update(gameRef, {
    positions: initialPositions,
    currentTurn: randomFirst,
    diceValue: null,
    consecutiveSixes: 0,
    winner: null,
    startedAt: Date.now(),
    turnStartedAt: Date.now(),
    moveLog: '',
  });
}
