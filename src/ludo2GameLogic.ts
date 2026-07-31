// Pure game logic for Ludo2 (three-player, 42-cell Y-board).
//
// Forked from ludoGameLogic.ts and simplified for classic rules: no power-ups,
// no doubled rolls (a bonus roll is a plain 6), three colors. Deterministic,
// side-effect-free, independently testable.

import type { TokenPosition } from './ludoFirebase';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  START_POSITIONS,
  ENTRY_CELLS,
  SAFE_ZONES,
  PLAYER_COLORS,
  getTokenColor,
  getColorTokenIndices,
  getPlayerScore,
  type Ludo2Color,
} from './ludo2Board';

/**
 * Calculate where a token lands after moving `steps` spaces.
 * Returns null if the move is invalid (overshooting, etc.).
 */
export function calculateNewPosition(
  current: TokenPosition,
  steps: number,
  color: Ludo2Color
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
  color: Ludo2Color,
  diceValue: number
): { tokenIndex: number; newPosition: TokenPosition }[] {
  const indices = getColorTokenIndices(color);
  const moves: { tokenIndex: number; newPosition: TokenPosition }[] = [];

  for (const idx of indices) {
    const current = tokens[idx];

    if (current === 'base') {
      if (diceValue === 6) {
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
export function checkPlayerFinished(tokens: TokenPosition[], color: Ludo2Color): boolean {
  return getColorTokenIndices(color).every(i => tokens[i] === 'final-6');
}

/**
 * Get the set of colors that have finished all their tokens.
 */
export function getFinishedColors(tokens: TokenPosition[], playerCount: number): Set<Ludo2Color> {
  const finished = new Set<Ludo2Color>();
  for (const color of PLAYER_COLORS.slice(0, playerCount)) {
    if (checkPlayerFinished(tokens, color)) finished.add(color);
  }
  return finished;
}

/**
 * Find the next active (non-finished) player after the current one.
 */
export function findNextActivePlayer(
  current: Ludo2Color,
  playerCount: number,
  finishedColors: Set<Ludo2Color>
): Ludo2Color {
  const activePlayers = PLAYER_COLORS.slice(0, playerCount);
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
  currentColor: Ludo2Color,
  diceValue: number,
  consecutiveSixes: number,
  captured: boolean,
  reachedHome: boolean,
  playerCount: number,
  finishedColors: Set<Ludo2Color>
): { nextColor: Ludo2Color; nextSixes: number } {
  // If current player just finished all tokens, always advance
  if (finishedColors.has(currentColor)) {
    return {
      nextColor: findNextActivePlayer(currentColor, playerCount, finishedColors),
      nextSixes: 0,
    };
  }

  // Three consecutive 6s = move is used but no bonus turn
  if (diceValue === 6 && consecutiveSixes >= 2) {
    return {
      nextColor: findNextActivePlayer(currentColor, playerCount, finishedColors),
      nextSixes: 0,
    };
  }

  // Rolled a 6 = bonus turn
  if (diceValue === 6) {
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
  botColor: Ludo2Color,
  playerCount: number,
  leaderColor?: Ludo2Color | null,
): number {
  let score = 0;
  const curPos = currentTokens[tokenIdx];

  const botIndices = getColorTokenIndices(botColor);
  const tokensInPlay = botIndices.filter(i => {
    const p = currentTokens[i];
    return p !== 'base' && p !== 'final-6';
  }).length;

  // Deploy from base: valuable but decreasing as more tokens are already in play.
  if (curPos === 'base') score += 90 - tokensInPlay * 20;

  // Moving into final corridor is very valuable (safe from all threats)
  if (targetPos.startsWith('final-')) {
    const finalNum = parseInt(targetPos.split('-')[1]);
    score += 100 + finalNum * 20;
    // Reaching home grants a bonus turn — worth ~35 points
    if (finalNum === 6) score += 35;
  }

  if (targetPos.startsWith('track-')) {
    const targetCell = parseInt(targetPos.split('-')[1]);

    // Compute leader if not provided by caller
    let leader = leaderColor;
    if (leader === undefined) {
      let leaderScore = -1;
      for (const c of PLAYER_COLORS.slice(0, playerCount)) {
        if (c === botColor) continue;
        const s = getPlayerScore(currentTokens, c);
        if (s > leaderScore) { leaderScore = s; leader = c; }
      }
    }

    // Capture opponent — prioritize the leader, and value advanced victims more.
    for (let i = 0; i < TOTAL_TOKENS; i++) {
      if (getTokenColor(i) === botColor) continue;
      if (currentTokens[i] === targetPos && !SAFE_ZONES.has(targetCell)) {
        const victimColor = getTokenColor(i);
        const victimStart = START_POSITIONS[victimColor];
        const victimDist = targetCell >= victimStart
          ? targetCell - victimStart
          : (TRACK_SIZE - victimStart) + targetCell;
        score += (victimColor === leader ? 160 : 80) + 35 + Math.floor(victimDist / 3);
      }
    }

    // Prefer safe zones (immune to capture)
    if (SAFE_ZONES.has(targetCell)) score += 15;

    // Advance further along the track
    const start = START_POSITIONS[botColor];
    const dist = targetCell >= start
      ? targetCell - start
      : (TRACK_SIZE - start) + targetCell;
    score += dist;

    // Danger assessment: penalize proportional to token progress.
    if (!SAFE_ZONES.has(targetCell)) {
      for (let i = 0; i < TOTAL_TOKENS; i++) {
        if (getTokenColor(i) === botColor) continue;
        const p = currentTokens[i];
        if (p.startsWith('track-')) {
          const oppCell = parseInt(p.split('-')[1]);
          const fwdDist = targetCell >= oppCell
            ? targetCell - oppCell
            : (TRACK_SIZE - oppCell) + targetCell;
          if (fwdDist >= 1 && fwdDist <= 6) {
            score -= 10 + Math.floor(dist / 4);
          }
        }
      }
    }

    // Escape bonus: reward moving a threatened token to a genuinely safer spot.
    if (curPos.startsWith('track-')) {
      const curCell = parseInt(curPos.split('-')[1]);
      if (!SAFE_ZONES.has(curCell)) {
        let wasInDanger = false;
        for (let i = 0; i < TOTAL_TOKENS; i++) {
          if (getTokenColor(i) === botColor) continue;
          const p = currentTokens[i];
          if (p.startsWith('track-')) {
            const oppCell = parseInt(p.split('-')[1]);
            const fwdDist = curCell >= oppCell
              ? curCell - oppCell
              : (TRACK_SIZE - oppCell) + curCell;
            if (fwdDist >= 1 && fwdDist <= 6) { wasInDanger = true; break; }
          }
        }
        if (wasInDanger) {
          let targetIsSafe = SAFE_ZONES.has(targetCell);
          if (!targetIsSafe) {
            targetIsSafe = true; // assume safe until proven otherwise
            for (let i = 0; i < TOTAL_TOKENS; i++) {
              if (getTokenColor(i) === botColor) continue;
              const p = currentTokens[i];
              if (p.startsWith('track-')) {
                const oppCell = parseInt(p.split('-')[1]);
                const fwdDist2 = targetCell >= oppCell
                  ? targetCell - oppCell
                  : (TRACK_SIZE - oppCell) + targetCell;
                if (fwdDist2 >= 1 && fwdDist2 <= 6) { targetIsSafe = false; break; }
              }
            }
          }
          if (targetIsSafe) {
            const curDist = curCell >= start
              ? curCell - start
              : (TRACK_SIZE - start) + curCell;
            score += 20 + Math.floor(curDist / 4);
          }
        }
      }
    }
  }

  return score;
}
