// Pure game logic for Ludo4 (four-player, 56-cell circular track).
//
// Forked from ludo3GameLogic and re-pointed at the four-seat board constants:
// classic rules, no power-ups, no doubled rolls (a bonus roll is a plain 6).
// Deterministic, side-effect-free, independently testable.
//
// One rule of its own, shared with Ludo3: the run home has FINAL_SIZE cells
// and each player has exactly that many counters, so finishing means standing
// one counter in every cell of it. A counter may pass over cells that are
// already taken but has to land on an empty one, exactly — otherwise that
// counter simply cannot move, and sits out on the track waiting to be sent home
// by an opponent. Being stuck in the open is the whole tension of the endgame,
// not a fault in it (see ludo3FinishSim for the simulation numbers).

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
  getOccupiedFinals,
  getPlayerScore,
  type Ludo4Color,
} from './ludo4Board';

/**
 * Calculate where a token lands after moving `steps` spaces.
 * Returns null if the move is invalid: overshooting the end of the run home, or
 * landing on a cell of it that one of this colour's own counters already holds.
 */
export function calculateNewPosition(
  current: TokenPosition,
  steps: number,
  color: Ludo4Color,
  tokens: TokenPosition[]
): TokenPosition | null {
  if (current === 'base') return null;

  const occupied = getOccupiedFinals(tokens, color);
  const intoFinal = (cell: number): TokenPosition | null =>
    cell > FINAL_SIZE || occupied.has(cell) ? null : `final-${cell}`;

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
  color: Ludo4Color,
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

    const newPos = calculateNewPosition(current, diceValue, color, tokens);
    if (newPos === null) continue;

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
  color: Ludo4Color,
  diceValue: number
): { tokenIndex: number; newPosition: TokenPosition }[] {
  return distinctMoves(tokens, getValidMoves(tokens, color, diceValue));
}

/**
 * The die faces that would give this colour something to do.
 *
 * Under the exact-landing rule "no moves" stops being one situation. It can be a
 * yard waiting on a 6, a counter at the mouth of the run home that needs a 4 and
 * nothing else, or a board where genuinely nothing helps and only an opponent's
 * capture will free it. Those want different things said to the player, and the
 * only honest way to tell them apart is to ask the rules — so ask all six.
 */
export function helpfulRolls(tokens: TokenPosition[], color: Ludo4Color): number[] {
  const faces: number[] = [];
  for (let face = 1; face <= 6; face++) {
    if (getValidMoves(tokens, color, face).length > 0) faces.push(face);
  }
  return faces;
}

/**
 * What to tell a player whose roll did nothing.
 *
 * Naming the face they need is the difference between a rule that feels sharp
 * and one that feels broken. "No moves" invites the reading that the dice are
 * ignoring you — which is exactly what players reported the last time this
 * rule shipped without it.
 */
export function describeNoMove(tokens: TokenPosition[], color: Ludo4Color): string {
  const faces = helpfulRolls(tokens, color);
  if (faces.length === 0) {
    // Defensive. No reachable position has all six faces dead: a counter short
    // of its turning can always walk on down the ring, and one standing on the
    // turning has at most four of its own ahead of it, so a cell is always free
    // and the roll that reaches it is legal. Asserted over every seat on every
    // turn of the simulated games in ludo4FinishSim.
    return 'Nothing can move — an opponent has to send one of yours back';
  }
  const allInYard = getColorTokenIndices(color).every(i => tokens[i] === 'base');
  if (faces.length === 1 && faces[0] === 6 && allInYard) return 'Need a 6 to come out';
  const list = faces.length === 1
    ? `a ${faces[0]}`
    : `${faces.slice(0, -1).join(', ')} or ${faces[faces.length - 1]}`;
  return `Need ${list}`;
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
export function checkPlayerFinished(tokens: TokenPosition[], color: Ludo4Color): boolean {
  return getColorTokenIndices(color).every(i => tokens[i].startsWith('final-'));
}

/**
 * Get the set of colors that have finished all their tokens.
 */
export function getFinishedColors(tokens: TokenPosition[], playerCount: number): Set<Ludo4Color> {
  const finished = new Set<Ludo4Color>();
  for (const color of PLAYER_COLORS.slice(0, playerCount)) {
    if (checkPlayerFinished(tokens, color)) finished.add(color);
  }
  return finished;
}

/**
 * Find the next active (non-finished) player after the current one.
 */
export function findNextActivePlayer(
  current: Ludo4Color,
  playerCount: number,
  finishedColors: Set<Ludo4Color>
): Ludo4Color {
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
  currentColor: Ludo4Color,
  diceValue: number,
  consecutiveSixes: number,
  captured: boolean,
  reachedHome: boolean,
  playerCount: number,
  finishedColors: Set<Ludo4Color>
): { nextColor: Ludo4Color; nextSixes: number } {
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
  botColor: Ludo4Color,
  playerCount: number,
  leaderColor?: Ludo4Color | null,
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

  // Taking a cell in the run home is valuable — safe from everything, and one of
  // the five a player needs. The `finalNum` term prefers the deep cells: a
  // deterministic tie-break, not a measured edge: deep-first, shallow-first and
  // no preference at all all score a fair share over 2400 measured games.
  if (targetPos.startsWith('final-')) {
    const finalNum = parseInt(targetPos.split('-')[1]);
    score += 100 + finalNum * 20;
    // Arriving in the run home grants a bonus turn — worth ~35 points
    if (!curPos.startsWith('final-')) score += 35;
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
