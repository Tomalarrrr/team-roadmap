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
  const { ref, get, set, runTransaction } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `snakes/${code}`);
  // Prime the local cache so runTransaction gets real data on first pass
  const snapshot = await get(gameRef);

  if (!snapshot.exists()) {
    throw new Error('Game not found');
  }

  const state = snapshot.val() as SnakesGameState;
  const players = state.players || {};

  // Reconnection by sessionId (no write needed)
  for (let i = 0; i < state.playerCount; i++) {
    const key = `p${i}`;
    if (players[key]?.sessionId === sessionId) {
      return { state, assignedSlot: i };
    }
  }

  // Reconnection by name (handles tab close → new sessionId)
  for (let i = 0; i < state.playerCount; i++) {
    const key = `p${i}`;
    if (players[key]?.name === userName) {
      const playerRef = ref(db, `snakes/${code}/players/${key}/sessionId`);
      await set(playerRef, sessionId);
      return {
        state: { ...state, players: { ...players, [key]: { sessionId, name: userName } } },
        assignedSlot: i,
      };
    }
  }

  // Atomically claim an empty slot via transaction (prevents two players grabbing the same slot)
  let assignedSlot = -1;
  const result = await runTransaction(gameRef, (current: SnakesGameState | null) => {
    if (!current) return undefined;
    const curPlayers = current.players || {};

    // Find next empty slot
    let slot = -1;
    for (let i = 1; i < current.playerCount; i++) {
      if (!curPlayers[`p${i}`]) { slot = i; break; }
    }
    if (slot === -1) return undefined; // full — abort

    assignedSlot = slot;
    const updated = { ...current, players: { ...curPlayers, [`p${slot}`]: { sessionId, name: userName } } };

    // Start the game if all players have now joined
    const joinedCount = Object.values(updated.players).filter(Boolean).length;
    if (joinedCount >= current.playerCount && !current.startedAt) {
      updated.startedAt = Date.now();
      updated.turnStartedAt = Date.now();
      updated.currentTurn = Math.floor(Math.random() * current.playerCount);
    }
    return updated;
  });

  if (!result.committed || assignedSlot === -1) {
    throw new Error('Game is full');
  }

  const newState = result.snapshot.val() as SnakesGameState;
  return { state: newState, assignedSlot };
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
  expectedTurn: number,
  updates: SnakesMoveUpdate
): Promise<boolean> {
  await ensureInitialized();
  const { ref, runTransaction } = getDbModule();
  const db = getFirebaseDatabase();

  const gameRef = ref(db, `snakes/${code}`);
  const result = await runTransaction(gameRef, (current: SnakesGameState | null) => {
    if (!current) return undefined;
    // Only apply if the game state matches what the client expects
    if (current.currentTurn !== expectedTurn) return undefined;
    if (current.winner !== null) return undefined;
    return { ...current, ...updates };
  });

  return result.committed;
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

// --- Emoji Reactions ---

export async function sendReaction(
  code: string,
  player: number,
  emoji: string,
): Promise<void> {
  await ensureInitialized();
  const { ref, push, set } = getDbModule();
  const db = getFirebaseDatabase();
  const reactionsRef = ref(db, `snakes/${code}/reactions`);
  const newRef = push(reactionsRef);
  await set(newRef, { player, emoji, ts: Date.now() });
}

export async function subscribeToReactions(
  code: string,
  callback: (reaction: { player: number; emoji: string; ts: number; key: string }) => void,
): Promise<Unsubscribe> {
  await ensureInitialized();
  const { ref, onChildAdded, query, orderByChild, startAt } = getDbModule();
  const db = getFirebaseDatabase();
  const reactionsRef = ref(db, `snakes/${code}/reactions`);
  const q = query(reactionsRef, orderByChild('ts'), startAt(Date.now()));
  const unsubscribe = onChildAdded(q, (snapshot: { val: () => { player: number; emoji: string; ts: number } | null; key: string | null }) => {
    const val = snapshot.val();
    if (val) callback({ ...val, key: snapshot.key! });
  });
  return unsubscribe;
}

export async function cleanupOldReactions(code: string): Promise<void> {
  await ensureInitialized();
  const { ref, get, remove, query, orderByChild, endAt } = getDbModule();
  const db = getFirebaseDatabase();
  const reactionsRef = ref(db, `snakes/${code}/reactions`);
  const cutoff = Date.now() - 10000;
  const q = query(reactionsRef, orderByChild('ts'), endAt(cutoff));
  const snapshot = await get(q);
  snapshot.forEach((child: { ref: unknown }) => { remove(child.ref as ReturnType<typeof ref>); });
}

// --- Game cleanup (TTL) ---

export async function cleanupOldGames(): Promise<void> {
  await ensureInitialized();
  const { ref, get, remove } = getDbModule();
  const db = getFirebaseDatabase();

  const snakesRef = ref(db, 'snakes');
  const snapshot = await get(snakesRef);
  if (!snapshot.exists()) return;

  const now = Date.now();
  const TTL = 24 * 60 * 60 * 1000; // 24 hours

  snapshot.forEach((child: { val: () => SnakesGameState | null; ref: unknown }) => {
    const game = child.val();
    if (game?.createdAt && now - game.createdAt > TTL) {
      remove(child.ref as ReturnType<typeof ref>);
    }
  });
}

// --- Server time offset ---

export async function subscribeToServerTimeOffset(
  callback: (offset: number) => void,
): Promise<() => void> {
  await ensureInitialized();
  const { ref, onValue } = getDbModule();
  const db = getFirebaseDatabase();
  const offsetRef = ref(db, '.info/serverTimeOffset');
  return onValue(offsetRef, (snap: { val: () => number | null }) => callback(snap.val() || 0));
}
