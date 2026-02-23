import type { Unsubscribe } from 'firebase/database';
import { ensureInitialized, getDbModule, getFirebaseDatabase } from './firebase';

export interface ConnectFourPlayer {
  sessionId: string;
  name: string;
}

export interface ConnectFourGameState {
  board: string;
  currentTurn: 'red' | 'yellow';
  winner: string | null;
  winningCells: string | null;
  players: {
    red: ConnectFourPlayer;
    yellow?: ConnectFourPlayer | null;
  };
  createdAt: number;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion

function generateGameCode(): string {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

export async function createGame(sessionId: string, userName: string): Promise<string> {
  await ensureInitialized();
  const { ref, get, set } = getDbModule();
  const db = getFirebaseDatabase();

  // Try up to 5 codes to avoid collisions
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGameCode();
    const gameRef = ref(db, `connectFour/${code}`);
    const snapshot = await get(gameRef);

    if (!snapshot.exists()) {
      const initialState: ConnectFourGameState = {
        board: '.'.repeat(48),
        currentTurn: 'red',
        winner: null,
        winningCells: null,
        players: {
          red: { sessionId, name: userName },
        },
        createdAt: Date.now(),
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
): Promise<ConnectFourGameState> {
  await ensureInitialized();
  const { ref, get, set } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `connectFour/${code}`);
  const snapshot = await get(gameRef);

  if (!snapshot.exists()) {
    throw new Error('Game not found');
  }

  const state = snapshot.val() as ConnectFourGameState;

  if (state.players.yellow) {
    throw new Error('Game is full');
  }

  const yellowRef = ref(db, `connectFour/${code}/players/yellow`);
  await set(yellowRef, { sessionId, name: userName });

  return { ...state, players: { ...state.players, yellow: { sessionId, name: userName } } };
}

export async function subscribeToGame(
  code: string,
  callback: (state: ConnectFourGameState | null) => void
): Promise<Unsubscribe> {
  await ensureInitialized();
  const { ref, onValue } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `connectFour/${code}`);

  const unsubscribe = onValue(
    gameRef,
    (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      callback(snapshot.val() as ConnectFourGameState);
    },
    (error) => {
      console.error('[ConnectFour] Listener error:', error);
      callback(null);
    }
  );

  return unsubscribe;
}

export async function makeMove(
  code: string,
  board: string,
  currentTurn: 'red' | 'yellow',
  winner: string | null,
  winningCells: string | null
): Promise<void> {
  await ensureInitialized();
  const { ref, update } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `connectFour/${code}`);
  await update(gameRef, { board, currentTurn, winner, winningCells });
}

export async function resetGame(code: string): Promise<void> {
  await ensureInitialized();
  const { ref, update } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `connectFour/${code}`);
  await update(gameRef, {
    board: '.'.repeat(48),
    currentTurn: 'red',
    winner: null,
    winningCells: null,
  });
}
