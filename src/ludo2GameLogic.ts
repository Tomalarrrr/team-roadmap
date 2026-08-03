// Pure game logic for Ludo2 (three-player, 42-cell circular track).
//
// Forked from ludoGameLogic.ts and simplified for classic rules: no power-ups,
// no doubled rolls (a bonus roll is a plain 6), three colors. Deterministic,
// side-effect-free, independently testable.
//
// The run home has FINAL_SIZE cells and each player has exactly that many
// counters, so finishing means getting all of them into it. Counters walk in
// rather than having to land exactly: any number of them may share a cell, and
// a roll that would carry one past the end stops it on the last cell.
//
// An earlier version required an exact landing on an empty cell. It deadlocked:
// five counters needing five distinct cells means the tail of a game is mostly
// turns with no legal move at all, which reads as the dice doing nothing. Any
// counter off the yard now always has somewhere to go.

import type { TokenPosition } from './ludoFirebase';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  FINAL_SIZE,
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
 *
 * Returns null only for a counter still in the yard, which needs a 6 to come
 * out and is handled by getValidMoves. Anything already on the board has a
 * move: within the run home the roll is capped at the last cell rather than
 * refused, so a counter can never be stranded by being unable to land.
 */
export function calculateNewPosition(
  current: TokenPosition,
  steps: number,
  color: Ludo2Color
): TokenPosition | null {
  if (current === 'base') return null;

  const intoFinal = (cell: number): TokenPosition =>
    `final-${Math.min(cell, FINAL_SIZE)}`;

  if (current.startsWith('final-')) {
    const currentFinal = parseInt(current.split('-')[1]);
    return intoFinal(currentFinal + steps);
  }

  const currentTrack = parseInt(current.split('-')[1]);
  const entry = ENTRY_CELLS[color];

  if (currentTrack === entry) return intoFinal(steps);

  let stepsToEntry: number;
  if (currentTrack < entry) {
    stepsToEntry = entry - currentTrack;
  } else {
    stepsToEntry = (TRACK_SIZE - currentTrack) + entry;
  }

  if (steps <= stepsToEntry) {
    const newTrack = ((currentTrack - 1 + steps) % TRACK_SIZE) + 1;
    return `track-${newTrack}`;
  }
  return intoFinal(steps - stepsToEntry);
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

    const newPos = calculateNewPosition(current, diceValue, color);
    if (newPos === null) continue;
    // Capping at the last cell means a counter standing on it "moves" to where
    // it already is. That is not a move, and offering it would let a player
    // burn a turn on nothing.
    if (newPos === current) continue;

    moves.push({ tokenIndex: idx, newPosition: newPos });
  }

  return moves;
}

/**
 * Collapse moves that are the same move.
 *
 * Counters of a colour are interchangeable — nothing downstream reads a
 * counter's identity, only its position — so two moves sharing an origin and a
 * destination leave the board in the same state. The five counters in a yard on
 * a 6 are one choice offered five times: presented raw they turn a forced move
 * into a menu of identical options, and they stop the single-move auto-play
 * from ever firing on a deploy.
 */
export function distinctMoves(
  tokens: TokenPosition[],
  moves: { tokenIndex: number; newPosition: TokenPosition }[]
): { tokenIndex: number; newPosition: TokenPosition }[] {
  const seen = new Set<string>();
  const out: { tokenIndex: number; newPosition: TokenPosition }[] = [];
  for (const move of moves) {
    const key = `${tokens[move.tokenIndex]}>${move.newPosition}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(move);
  }
  return out;
}

/** getValidMoves with interchangeable duplicates collapsed — what the player is
 * actually being asked to choose between. */
export function getDistinctMoves(
  tokens: TokenPosition[],
  color: Ludo2Color,
  diceValue: number
): { tokenIndex: number; newPosition: TokenPosition }[] {
  return distinctMoves(tokens, getValidMoves(tokens, color, diceValue));
}

/**
 * Apply a token move: update positions, check for captures, check if the piece
 * has taken a cell in its run home (which it can never be dislodged from).
 */
export function applyMove(
  tokens: TokenPosition[],
  tokenIndex: number,
  newPosition: TokenPosition
): { newTokens: TokenPosition[]; captured: boolean; reachedHome: boolean } {
  const result = [...tokens] as TokenPosition[];
  const previous = tokens[tokenIndex];
  result[tokenIndex] = newPosition;
  let captured = false;
  // One bonus per counter: shuffling up the run home is not arriving in it.
  const reachedHome = newPosition.startsWith('final-') && !previous.startsWith('final-');

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

/** Check if a player has got every counter into their run home. */
export function checkPlayerFinished(tokens: TokenPosition[], color: Ludo2Color): boolean {
  return getColorTokenIndices(color).every(i => tokens[i].startsWith('final-'));
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
    return p !== 'base' && !p.startsWith('final-');
  }).length;

  // Deploy from base: valuable but decreasing as more tokens are already in play.
  if (curPos === 'base') score += 90 - tokensInPlay * 20;

  if (targetPos.startsWith('final-')) {
    const finalNum = parseInt(targetPos.split('-')[1]);
    if (curPos.startsWith('final-')) {
      // Shuffling deeper *inside* the run home. Depth is worth nothing under
      // the walk-in rule: winning is having all five counters in, at any depth,
      // and a counter already in is already safe from everything. So this is a
      // turn spent on nothing, and it has to rank below every move that isn't.
      //
      // It scored 100 + depth × 20, from back when a counter had to land on a
      // distinct cell and the deep ones were the hard ones to claim. Left
      // there, the bot preferred pushing a home counter from cell 1 to cell 4
      // (180) over walking a second one home (155) — it was talking itself out
      // of its own win, every time both were on offer.
      score += 4 + finalNum;
    } else {
      // Arriving. This is the move that wins games: one of the five, safe from
      // capture for good, and a bonus turn on top. Depth only breaks ties.
      score += 150 + finalNum;
    }
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
