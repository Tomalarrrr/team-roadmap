import type { Unsubscribe } from 'firebase/database';
import { ensureInitialized, getDbModule, getFirebaseDatabase, markFirebaseActivity } from './firebase';
import { generateGameCode } from './utils/gameUtils';

export interface ConnectFourPlayer {
  sessionId: string;
  name: string;
}

export interface ConnectFourGameState {
  board: string;
  currentTurn: 'red' | 'yellow';
  winner: string | null;
  winningCells: string | null;
  startingColor: 'red' | 'yellow';
  turnStartedAt: number;
  players: {
    red: ConnectFourPlayer;
    yellow?: ConnectFourPlayer | null;
  };
  createdAt: number;
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
        startingColor: 'red',
        turnStartedAt: Date.now(),
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
): Promise<{ state: ConnectFourGameState; assignedColor: 'red' | 'yellow' }> {
  await ensureInitialized();
  const { ref, runTransaction, get } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `connectFour/${code}`);
  let assignedColor: 'red' | 'yellow' = 'yellow';
  let joinError: string | null = null;

  await runTransaction(gameRef, (current: ConnectFourGameState | null) => {
    if (!current) {
      // Transaction gets null on first pass — abort and let it retry with real data
      return current;
    }

    const players = current.players;

    // Reconnection by sessionId (no mutation needed, just identify color)
    if (players.red?.sessionId === sessionId) {
      assignedColor = 'red';
      return current; // No change
    }
    if (players.yellow?.sessionId === sessionId) {
      assignedColor = 'yellow';
      return current; // No change
    }

    // Reconnection by name (handles tab close → new sessionId)
    const normalName = userName.trim().toLowerCase();
    if (players.yellow) {
      if (players.yellow.name.trim().toLowerCase() === normalName) {
        assignedColor = 'yellow';
        return { ...current, players: { ...players, yellow: { ...players.yellow, sessionId } } };
      }
      if (players.red.name.trim().toLowerCase() === normalName) {
        assignedColor = 'red';
        return { ...current, players: { ...players, red: { ...players.red, sessionId } } };
      }
      joinError = 'Game is full';
      return; // Abort transaction
    }

    // Claim yellow slot atomically
    assignedColor = 'yellow';
    return {
      ...current,
      players: { ...players, yellow: { sessionId, name: userName } },
      turnStartedAt: Date.now(),
    };
  });

  if (joinError) throw new Error(joinError);

  // Read final state after transaction
  const finalSnap = await get(gameRef);
  if (!finalSnap.exists()) throw new Error('Game not found');
  return { state: finalSnap.val() as ConnectFourGameState, assignedColor };
}

export async function spectateGame(code: string): Promise<ConnectFourGameState> {
  await ensureInitialized();
  const { ref, get } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `connectFour/${code}`);
  const snapshot = await get(gameRef);

  if (!snapshot.exists()) {
    throw new Error('Game not found');
  }

  return snapshot.val() as ConnectFourGameState;
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
      markFirebaseActivity();
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

/**
 * Validate that a new board state represents exactly one new piece placed
 * in a valid (gravity-respecting) position by the correct player.
 */
function validateMove(
  oldBoard: string,
  newBoard: string,
  expectedTurn: 'red' | 'yellow'
): boolean {
  if (newBoard.length !== 48) return false;
  if (!/^[.RY]+$/.test(newBoard)) return false;

  const ROWS = 6;
  const COLS = 8;
  const piece = expectedTurn === 'red' ? 'R' : 'Y';

  // Find exactly one new piece
  let diffCount = 0;
  let diffIndex = -1;
  for (let i = 0; i < 48; i++) {
    if (oldBoard[i] !== newBoard[i]) {
      diffCount++;
      diffIndex = i;
      // New cell must be the current player's piece, old must be empty
      if (oldBoard[i] !== '.' || newBoard[i] !== piece) return false;
    }
  }
  if (diffCount !== 1) return false;

  // Gravity check: the cell below must be occupied or this is the bottom row
  const row = Math.floor(diffIndex / COLS);
  if (row < ROWS - 1) {
    const belowIndex = diffIndex + COLS;
    if (newBoard[belowIndex] === '.') return false;
  }

  return true;
}

export async function makeMove(
  code: string,
  board: string,
  currentTurn: 'red' | 'yellow',
  winner: string | null,
  winningCells: string | null
): Promise<boolean> {
  await ensureInitialized();
  const { ref, runTransaction } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `connectFour/${code}`);
  const result = await runTransaction(gameRef, (current: ConnectFourGameState | null) => {
    if (!current) return current;

    // Reject move if game is already over
    if (current.winner) return;

    // Validate the move against current server state
    if (!validateMove(current.board, board, current.currentTurn)) return;

    return { ...current, board, currentTurn, winner, winningCells, turnStartedAt: Date.now() };
  });

  return result.committed;
}

export async function resetGame(code: string, nextStarter: 'red' | 'yellow'): Promise<void> {
  await ensureInitialized();
  const { ref, update } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `connectFour/${code}`);
  await update(gameRef, {
    board: '.'.repeat(48),
    currentTurn: nextStarter,
    startingColor: nextStarter,
    winner: null,
    winningCells: null,
    turnStartedAt: Date.now(),
  });
}
