// Pure game logic for Ludo — extracted from LudoGame.tsx for decomposition.
// These functions are deterministic, side-effect-free, and independently testable.

import type { LudoColor, TokenPosition } from './ludoFirebase';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  START_POSITIONS,
  ENTRY_CELLS,
  SAFE_ZONES,
  getTokenColor,
  getColorTokenIndices,
  getPlayerScore,
  isEffectiveSix,
  type BoardEffect,
  type FlagState,
  colorIndex,
} from './ludoPowerUps';
const TURN_ORDER: LudoColor[] = ['red', 'green', 'yellow', 'blue'];

/**
 * Calculate where a token lands after moving `steps` spaces.
 * Returns null if the move is invalid (overshooting, etc.).
 */
export function calculateNewPosition(
  current: TokenPosition,
  steps: number,
  color: LudoColor
): TokenPosition | null {
  if (current === 'base') return null;
  if (current === 'final-6') return null;

  if (current.startsWith('final-')) {
    const currentFinal = parseInt(current.split('-')[1]);
    const newFinal = currentFinal + steps;
    if (newFinal > 6) return null;
    return `final-${newFinal}`;
  }

  const currentTrack = parseInt(current.split('-')[1]);
  const entry = ENTRY_CELLS[color];

  if (currentTrack === entry) {
    if (steps > 6) return null;
    return `final-${steps}`;
  }

  let stepsToEntry: number;
  if (currentTrack < entry) {
    stepsToEntry = entry - currentTrack;
  } else {
    stepsToEntry = (TRACK_SIZE - currentTrack) + entry;
  }

  if (steps <= stepsToEntry) {
    const newTrack = ((currentTrack - 1 + steps) % TRACK_SIZE) + 1;
    return `track-${newTrack}`;
  } else {
    const remaining = steps - stepsToEntry;
    if (remaining > 6) return null;
    return `final-${remaining}`;
  }
}

/**
 * Get all valid moves for a player given their tokens and dice value.
 */
export function getValidMoves(
  tokens: TokenPosition[],
  color: LudoColor,
  diceValue: number
): { tokenIndex: number; newPosition: TokenPosition }[] {
  const indices = getColorTokenIndices(color);
  const moves: { tokenIndex: number; newPosition: TokenPosition }[] = [];

  for (const idx of indices) {
    const current = tokens[idx];

    if (current === 'base') {
      if (isEffectiveSix(diceValue)) {
        const startPos: TokenPosition = `track-${START_POSITIONS[color]}`;
        moves.push({ tokenIndex: idx, newPosition: startPos });
      }
      continue;
    }

    if (current === 'final-6') continue;

    const newPos = calculateNewPosition(current, diceValue, color);
    if (newPos === null) continue;

    moves.push({ tokenIndex: idx, newPosition: newPos });
  }

  return moves;
}

/**
 * Apply a token move: update positions, check for captures, check if reached home.
 */
export function applyMove(
  tokens: TokenPosition[],
  tokenIndex: number,
  newPosition: TokenPosition
): { newTokens: TokenPosition[]; captured: boolean; reachedHome: boolean } {
  const result = [...tokens] as TokenPosition[];
  result[tokenIndex] = newPosition;
  let captured = false;
  const reachedHome = newPosition === 'final-6';

  if (newPosition.startsWith('track-')) {
    const trackNum = parseInt(newPosition.split('-')[1]);
    if (!SAFE_ZONES.has(trackNum)) {
      const moverColor = getTokenColor(tokenIndex);
      for (let i = 0; i < TOTAL_TOKENS; i++) {
        if (i === tokenIndex) continue;
        if (getTokenColor(i) === moverColor) continue;
        if (result[i] === newPosition) {
          result[i] = 'base';
          captured = true;
        }
      }
    }
  }

  return { newTokens: result, captured, reachedHome };
}

/**
 * Check if all 4 tokens for a player have reached home (final-6).
 */
export function checkPlayerFinished(tokens: TokenPosition[], color: LudoColor): boolean {
  return getColorTokenIndices(color).every(i => tokens[i] === 'final-6');
}

/**
 * Get the set of colors that have finished all their tokens.
 */
export function getFinishedColors(tokens: TokenPosition[], playerCount: number): Set<LudoColor> {
  const finished = new Set<LudoColor>();
  for (const color of TURN_ORDER.slice(0, playerCount)) {
    if (checkPlayerFinished(tokens, color)) finished.add(color);
  }
  return finished;
}

/**
 * Find the next active (non-finished) player after the current one.
 */
export function findNextActivePlayer(
  current: LudoColor,
  playerCount: number,
  finishedColors: Set<LudoColor>
): LudoColor {
  const activePlayers = TURN_ORDER.slice(0, playerCount);
  let idx = activePlayers.indexOf(current);
  for (let i = 0; i < activePlayers.length; i++) {
    idx = (idx + 1) % activePlayers.length;
    if (!finishedColors.has(activePlayers[idx])) return activePlayers[idx];
  }
  return current;
}

/**
 * Determine the next turn: who plays next and how many consecutive sixes.
 */
export function getNextTurn(
  currentColor: LudoColor,
  diceValue: number,
  consecutiveSixes: number,
  captured: boolean,
  reachedHome: boolean,
  playerCount: number,
  finishedColors: Set<LudoColor>
): { nextColor: LudoColor; nextSixes: number } {
  // If current player just finished all tokens, always advance
  if (finishedColors.has(currentColor)) {
    return {
      nextColor: findNextActivePlayer(currentColor, playerCount, finishedColors),
      nextSixes: 0,
    };
  }

  // Three consecutive 6s = move is used but no bonus turn (covers doubled 6 → 12)
  if (isEffectiveSix(diceValue) && consecutiveSixes >= 2) {
    return {
      nextColor: findNextActivePlayer(currentColor, playerCount, finishedColors),
      nextSixes: 0,
    };
  }

  // Rolled a 6 (or doubled 6) = bonus turn
  if (isEffectiveSix(diceValue)) {
    return { nextColor: currentColor, nextSixes: consecutiveSixes + 1 };
  }

  // Captured opponent = bonus turn
  if (captured) {
    return { nextColor: currentColor, nextSixes: 0 };
  }

  // Token reached home = bonus turn
  if (reachedHome) {
    return { nextColor: currentColor, nextSixes: 0 };
  }

  return {
    nextColor: findNextActivePlayer(currentColor, playerCount, finishedColors),
    nextSixes: 0,
  };
}

/**
 * Score a bot move for AI decision-making.
 * Higher score = better move. Pure function, no side effects.
 */
export function scoreBotMove(
  tokenIdx: number,
  targetPos: TokenPosition,
  currentTokens: TokenPosition[],
  botColor: LudoColor,
  playerCount: number,
  boardEffects: BoardEffect[],
  flagState: FlagState,
  leaderColor?: LudoColor | null,
): number {
  let score = 0;
  const curPos = currentTokens[tokenIdx];

  // Deploy from base is valuable
  if (curPos === 'base') score += 50;

  // Moving into final corridor is very valuable (safe from all threats)
  if (targetPos.startsWith('final-')) {
    const finalNum = parseInt(targetPos.split('-')[1]);
    score += 100 + finalNum * 20;
  }

  if (targetPos.startsWith('track-')) {
    const targetCell = parseInt(targetPos.split('-')[1]);

    // Compute leader if not provided by caller
    let leader = leaderColor;
    if (leader === undefined) {
      let leaderScore = -1;
      for (const c of TURN_ORDER.slice(0, playerCount)) {
        if (c === botColor) continue;
        const s = getPlayerScore(currentTokens, c);
        if (s > leaderScore) { leaderScore = s; leader = c; }
      }
    }

    // Capture opponent — prioritize the leader
    for (let i = 0; i < TOTAL_TOKENS; i++) {
      if (getTokenColor(i) === botColor) continue;
      if (currentTokens[i] === targetPos && !SAFE_ZONES.has(targetCell)) {
        score += getTokenColor(i) === leader ? 160 : 80;
      }
    }

    // Prefer safe zones (immune to capture)
    if (SAFE_ZONES.has(targetCell)) score += 15;

    // Avoid banana peels from opponents
    const bananaCells = new Set(boardEffects.filter(e => e.type === 'banana' && e.ownerColorIdx !== colorIndex(botColor)).map(e => e.cell));
    if (bananaCells.has(targetCell)) score -= 40;

    // Danger assessment: penalize landing near opponents who could capture next turn
    if (!SAFE_ZONES.has(targetCell)) {
      for (let i = 0; i < TOTAL_TOKENS; i++) {
        if (getTokenColor(i) === botColor) continue;
        const p = currentTokens[i];
        if (p.startsWith('track-')) {
          const oppCell = parseInt(p.split('-')[1]);
          const fwdDist = targetCell >= oppCell
            ? targetCell - oppCell
            : (TRACK_SIZE - oppCell) + targetCell;
          if (fwdDist >= 1 && fwdDist <= 6) score -= 15;
        }
      }
    }

    // Advance further along the track
    const start = START_POSITIONS[botColor];
    const dist = targetCell >= start
      ? targetCell - start
      : (TRACK_SIZE - start) + targetCell;
    score += dist;

    // Flag pickup: high priority
    if (!flagState.used && flagState.cell === targetCell && flagState.carrier === null) {
      score += 150;
    }
  }

  // Flag carrier heading home: boost final corridor moves
  if (!flagState.used && flagState.carrier === tokenIdx && targetPos.startsWith('final-')) {
    score += 200;
  }

  return score;
}
