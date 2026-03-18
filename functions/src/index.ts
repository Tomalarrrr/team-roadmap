import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

initializeApp();

interface RollDiceRequest {
  gameCode: string;
  sessionId: string;
  count?: number; // 1 for normal roll, 3 for Golden Mushroom
}

interface GameState {
  players: Record<string, { sessionId: string; name: string } | undefined>;
  currentTurn: string;
  turnPhase: string;
  winner: string | null;
  singlePlayer?: boolean;
  paused?: boolean;
}

/**
 * Server-side dice roll for Ludo Mario Edition.
 *
 * Verifies the caller is the current-turn player (by sessionId match),
 * generates cryptographically fair dice values, and returns them.
 *
 * Does NOT write game state — the client still manages state transitions
 * via the existing makeMove transaction. This function only controls the
 * source of randomness.
 */
export const rollDice = onCall<RollDiceRequest>(async (request) => {
  const { gameCode, sessionId, count = 1 } = request.data;

  // Input validation
  if (!gameCode || typeof gameCode !== 'string' || gameCode.length !== 4) {
    throw new HttpsError('invalid-argument', 'Invalid game code');
  }
  if (!sessionId || typeof sessionId !== 'string') {
    throw new HttpsError('invalid-argument', 'Missing session ID');
  }
  if (count !== 1 && count !== 3) {
    throw new HttpsError('invalid-argument', 'Count must be 1 or 3');
  }

  // Load game state
  const db = getDatabase();
  const snapshot = await db.ref(`ludo/${gameCode}`).get();
  if (!snapshot.exists()) {
    throw new HttpsError('not-found', 'Game not found');
  }

  const state = snapshot.val() as GameState;

  // Validate game is in a rollable state
  if (state.winner) {
    throw new HttpsError('failed-precondition', 'Game is over');
  }
  if (state.paused) {
    throw new HttpsError('failed-precondition', 'Game is paused');
  }
  if (state.turnPhase !== 'roll') {
    throw new HttpsError('failed-precondition', 'Not in roll phase');
  }

  // Verify caller identity: sessionId must match current turn's player
  const currentPlayer = state.players[state.currentTurn];
  if (!currentPlayer) {
    throw new HttpsError('internal', 'Current turn player not found');
  }

  const isCurrentPlayer = currentPlayer.sessionId === sessionId;

  // In single-player mode, the host client rolls for bots too.
  // Verify the caller is at least a player in the game.
  const isSinglePlayer = !!state.singlePlayer;
  const isHostRollingForBot = isSinglePlayer
    && currentPlayer.sessionId.startsWith('bot-')
    && Object.values(state.players).some(p => p && p.sessionId === sessionId);

  if (!isCurrentPlayer && !isHostRollingForBot) {
    throw new HttpsError('permission-denied', 'Not your turn');
  }

  // Generate rolls
  const rolls: number[] = [];
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(Math.random() * 6) + 1);
  }

  return { rolls };
});
