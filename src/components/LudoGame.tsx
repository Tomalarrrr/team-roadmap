import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createGame,
  joinGame,
  spectateGame,
  subscribeToGame,
  makeMove,
  resetGame,
  serializeTokens,
  deserializeTokens,
  type LudoColor,
  type LudoGameState,
  type LudoMoveUpdate,
  type TokenPosition,
  type TurnPhase,
} from '../ludoFirebase';
import styles from './LudoGame.module.css';

// --- Constants ---

const TRACK_SIZE = 52;
const TOKENS_PER_PLAYER = 4;
const TOTAL_TOKENS = 16;
const TURN_SECONDS = 30;

const TURN_ORDER: LudoColor[] = ['red', 'green', 'yellow', 'blue'];

const START_POSITIONS: Record<LudoColor, number> = {
  red: 1, green: 14, yellow: 27, blue: 40,
};

const SAFE_ZONES = new Set([1, 9, 14, 22, 27, 35, 40, 48]);

const ENTRY_CELLS: Record<LudoColor, number> = {
  red: 51, green: 12, yellow: 25, blue: 38,
};

const COLOR_OFFSET: Record<LudoColor, number> = {
  red: 0, green: 4, yellow: 8, blue: 12,
};

// Track cell → [gridRow, gridCol] (1-indexed for CSS grid)
const TRACK_COORDS: Record<number, [number, number]> = {
  1: [7, 2],   2: [7, 3],   3: [7, 4],   4: [7, 5],   5: [7, 6],
  6: [6, 7],   7: [5, 7],   8: [4, 7],   9: [3, 7],   10: [2, 7],
  11: [1, 7],  12: [1, 8],  13: [1, 9],
  14: [2, 9],  15: [3, 9],  16: [4, 9],  17: [5, 9],  18: [6, 9],
  19: [7, 10], 20: [7, 11], 21: [7, 12], 22: [7, 13], 23: [7, 14], 24: [7, 15],
  25: [8, 15], 26: [9, 15],
  27: [9, 14], 28: [9, 13], 29: [9, 12], 30: [9, 11], 31: [9, 10],
  32: [10, 9], 33: [11, 9], 34: [12, 9], 35: [13, 9], 36: [14, 9], 37: [15, 9],
  38: [15, 8], 39: [15, 7],
  40: [14, 7], 41: [13, 7], 42: [12, 7], 43: [11, 7], 44: [10, 7],
  45: [9, 6],  46: [9, 5],  47: [9, 4],  48: [9, 3],  49: [9, 2],  50: [9, 1],
  51: [8, 1],  52: [7, 1],
};

// Home corridor coordinates: final-1 through final-6
const FINAL_COORDS: Record<LudoColor, [number, number][]> = {
  red:    [[8, 2], [8, 3], [8, 4], [8, 5], [8, 6], [8, 7]],
  green:  [[2, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8]],
  yellow: [[8, 14], [8, 13], [8, 12], [8, 11], [8, 10], [8, 9]],
  blue:   [[14, 8], [13, 8], [12, 8], [11, 8], [10, 8], [9, 8]],
};

// Base token positions (4 spots in each base quadrant)
const BASE_TOKEN_POSITIONS: Record<LudoColor, [number, number][]> = {
  red:    [[2, 2], [2, 5], [5, 2], [5, 5]],
  green:  [[2, 11], [2, 14], [5, 11], [5, 14]],
  yellow: [[11, 11], [11, 14], [14, 11], [14, 14]],
  blue:   [[11, 2], [11, 5], [14, 2], [14, 5]],
};

const START_CELL_COLORS: Record<number, LudoColor> = {
  1: 'red', 14: 'green', 27: 'yellow', 40: 'blue',
};

const ENTRY_ARROW_COLORS: Record<number, LudoColor> = {
  51: 'red', 12: 'green', 25: 'yellow', 38: 'blue',
};

const COLOR_LABELS: Record<LudoColor, string> = {
  red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue',
};

const COLOR_HEX: Record<LudoColor, string> = {
  red: '#ea4330', green: '#34a853', yellow: '#fbbc05', blue: '#4285f4',
};

// Absolute-positioning constants (percentages of board size)
const CELL_PCT = 100 / 15;
const TOKEN_SIZE_PCT = CELL_PCT * 0.7;
const TOKEN_PAD_PCT = (CELL_PCT - TOKEN_SIZE_PCT) / 2;

// --- Pure game logic ---

function getTokenColor(index: number): LudoColor {
  if (index < 4) return 'red';
  if (index < 8) return 'green';
  if (index < 12) return 'yellow';
  return 'blue';
}

function getColorTokenIndices(color: LudoColor): number[] {
  const offset = COLOR_OFFSET[color];
  return [offset, offset + 1, offset + 2, offset + 3];
}

function calculateNewPosition(
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

function getValidMoves(
  tokens: TokenPosition[],
  color: LudoColor,
  diceValue: number
): { tokenIndex: number; newPosition: TokenPosition }[] {
  const indices = getColorTokenIndices(color);
  const moves: { tokenIndex: number; newPosition: TokenPosition }[] = [];

  for (const idx of indices) {
    const current = tokens[idx];

    if (current === 'base') {
      if (diceValue === 6) {
        const startPos: TokenPosition = `track-${START_POSITIONS[color]}`;
        const ownOnStart = indices.some(i => i !== idx && tokens[i] === startPos);
        if (!ownOnStart) {
          moves.push({ tokenIndex: idx, newPosition: startPos });
        }
      }
      continue;
    }

    if (current === 'final-6') continue;

    const newPos = calculateNewPosition(current, diceValue, color);
    if (newPos === null) continue;

    if (newPos !== 'base' && newPos !== 'final-6') {
      const ownOnTarget = indices.some(i => i !== idx && tokens[i] === newPos);
      if (ownOnTarget) continue;
    }

    moves.push({ tokenIndex: idx, newPosition: newPos });
  }

  return moves;
}

function applyMove(
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

function checkPlayerFinished(tokens: TokenPosition[], color: LudoColor): boolean {
  return getColorTokenIndices(color).every(i => tokens[i] === 'final-6');
}

function getFinishedColors(tokens: TokenPosition[], playerCount: number): Set<LudoColor> {
  const finished = new Set<LudoColor>();
  for (const color of TURN_ORDER.slice(0, playerCount)) {
    if (checkPlayerFinished(tokens, color)) finished.add(color);
  }
  return finished;
}

function findNextActivePlayer(
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

function getNextTurn(
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

  // Three consecutive 6s = lose turn
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

function getTokenCoords(pos: TokenPosition, tokenIndex: number): [number, number] | null {
  if (pos === 'base') {
    const color = getTokenColor(tokenIndex);
    const localIdx = tokenIndex % TOKENS_PER_PLAYER;
    return BASE_TOKEN_POSITIONS[color][localIdx];
  }
  if (pos.startsWith('track-')) {
    const trackNum = parseInt(pos.split('-')[1]);
    return TRACK_COORDS[trackNum] || null;
  }
  if (pos.startsWith('final-')) {
    const finalNum = parseInt(pos.split('-')[1]);
    const color = getTokenColor(tokenIndex);
    if (finalNum >= 1 && finalNum <= 6) return FINAL_COORDS[color][finalNum - 1];
  }
  return null;
}

function getTokenOffset(tokens: TokenPosition[], tokenIndex: number): [number, number] {
  const pos = tokens[tokenIndex];
  if (pos === 'base' || pos === 'final-6') return [0, 0];

  const sameCell: number[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === pos) sameCell.push(i);
  }
  if (sameCell.length <= 1) return [0, 0];

  const myIdx = sameCell.indexOf(tokenIndex);
  const shift = CELL_PCT * 0.15;
  const offsets: [number, number][] = [
    [-shift, -shift],
    [shift, -shift],
    [-shift, shift],
    [shift, shift],
  ];
  return offsets[myIdx % offsets.length];
}

// --- Dice face component ---

const TOKEN_STYLE: Record<LudoColor, string> = {
  red: styles.tokenRed,
  green: styles.tokenGreen,
  yellow: styles.tokenYellow,
  blue: styles.tokenBlue,
};

// Standard dice pip positions on a 3×3 grid [row, col]
const DICE_PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [[1, 3], [3, 1]],
  3: [[1, 3], [2, 2], [3, 1]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]],
};

function DiceFace({ value }: { value: number }) {
  const pips = DICE_PIPS[value] || DICE_PIPS[1];
  return (
    <div className={styles.diceFace}>
      {pips.map(([r, c], i) => (
        <span
          key={i}
          className={styles.pip}
          style={{ gridRow: r, gridColumn: c }}
        />
      ))}
    </div>
  );
}

// --- Component ---

interface LudoGameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

export function LudoGame({ onClose, isSearchOpen }: LudoGameProps) {
  const sessionId = sessionStorage.getItem('roadmap-user-id') || 'anonymous';
  const userName = sessionStorage.getItem('roadmap-user-name') || 'Player';

  // Multiplayer state
  const [gamePhase, setGamePhase] = useState<'lobby' | 'waiting' | 'playing'>('lobby');
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [myColor, setMyColor] = useState<LudoColor | null>(null);
  const [isSpectating, setIsSpectating] = useState(false);
  const [playerNames, setPlayerNames] = useState<Partial<Record<LudoColor, string>>>({});
  const [playerCount, setPlayerCount] = useState(4);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Game state (driven by Firebase)
  const [tokens, setTokens] = useState<TokenPosition[]>(
    () => Array(TOTAL_TOKENS).fill('base') as TokenPosition[]
  );
  const [currentTurn, setCurrentTurn] = useState<LudoColor>('red');
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('roll');
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const [consecutiveSixes, setConsecutiveSixes] = useState(0);
  const [winner, setWinner] = useState<LudoColor | null>(null);
  const [finishOrder, setFinishOrder] = useState<LudoColor[]>([]);
  const [activePlayerCount, setActivePlayerCount] = useState(4);

  // UI state
  const [validMoves, setValidMoves] = useState<Map<number, TokenPosition>>(new Map());
  const [isRolling, setIsRolling] = useState(false);
  const [rollingFace, setRollingFace] = useState(1);
  const [lastMovedToken, setLastMovedToken] = useState<number | null>(null);
  const [showBurst, setShowBurst] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(TURN_SECONDS);

  // Drag state
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (window.innerWidth - 560) / 2),
    y: Math.max(0, (window.innerHeight - 600) / 2),
  }));
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  // --- Refs for timer/callback safety (avoids stale closures) ---
  const moveInFlightRef = useRef(false);
  const isRollingRef = useRef(false);
  const turnStartedAtRef = useRef<number>(Date.now());
  const prevTokensRef = useRef('bas'.repeat(16));
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const movedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const diceAnimKeyRef = useRef(0);

  const gameCodeRef = useRef(gameCode);
  gameCodeRef.current = gameCode;
  const myColorRef = useRef(myColor);
  myColorRef.current = myColor;
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const currentTurnRef = useRef(currentTurn);
  currentTurnRef.current = currentTurn;
  const turnPhaseRef = useRef(turnPhase);
  turnPhaseRef.current = turnPhase;
  const diceValueRef = useRef(diceValue);
  diceValueRef.current = diceValue;
  const consecutiveSixesRef = useRef(consecutiveSixes);
  consecutiveSixesRef.current = consecutiveSixes;
  const finishOrderRef = useRef(finishOrder);
  finishOrderRef.current = finishOrder;
  const activePlayerCountRef = useRef(activePlayerCount);
  activePlayerCountRef.current = activePlayerCount;
  const winnerRef = useRef(winner);
  winnerRef.current = winner;

  // --- Cleanup all timeouts on unmount ---
  useEffect(() => {
    return () => {
      clearTimeout(hintTimeoutRef.current);
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(movedTimeoutRef.current);
    };
  }, []);

  // --- Utility ---

  const showHint = useCallback((msg: string) => {
    setStatusHint(msg);
    clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => setStatusHint(null), 2000);
  }, []);

  // --- Dice rolling animation (rapid face cycling) ---

  useEffect(() => {
    if (!isRolling) return;
    const interval = setInterval(() => {
      setRollingFace(Math.floor(Math.random() * 6) + 1);
    }, 80);
    return () => clearInterval(interval);
  }, [isRolling]);

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSearchOpen) onClose();
      if ((e.key === ' ' || e.key === 'Enter') && gamePhase === 'playing') {
        e.preventDefault();
        handleRollDiceRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSearchOpen, gamePhase]);

  // --- Firebase subscription ---

  useEffect(() => {
    if (!gameCode) return;

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    subscribeToGame(gameCode, (state: LudoGameState | null) => {
      if (cancelled || !state) return;

      const parsedTokens = deserializeTokens(state.tokens);

      // Reset moveInFlight on any state change (token or turn change)
      if (state.tokens !== prevTokensRef.current || state.turnStartedAt !== turnStartedAtRef.current) {
        moveInFlightRef.current = false;
      }
      prevTokensRef.current = state.tokens;

      setTokens(parsedTokens);
      setCurrentTurn(state.currentTurn);
      setTurnPhase(state.turnPhase);
      setDiceValue(state.diceValue);
      setConsecutiveSixes(state.consecutiveSixes);
      setActivePlayerCount(state.playerCount);
      turnStartedAtRef.current = state.turnStartedAt;

      if (state.winner) {
        setWinner(state.winner);
        setShowBurst(true);
      } else {
        setWinner(null);
        setShowBurst(false);
      }

      setFinishOrder(
        state.finishOrder ? (state.finishOrder.split(',').filter(Boolean) as LudoColor[]) : []
      );

      // Update player names
      const names: Partial<Record<LudoColor, string>> = {};
      for (const color of TURN_ORDER) {
        const player = state.players[color];
        if (player) names[color] = player.name;
      }
      setPlayerNames(names);

      // Recompute valid moves when it's my turn in move phase (handles reconnection)
      if (
        state.turnPhase === 'move' &&
        state.currentTurn === myColorRef.current &&
        state.diceValue !== null
      ) {
        const moves = getValidMoves(parsedTokens, state.currentTurn, state.diceValue);
        setValidMoves(new Map(moves.map(m => [m.tokenIndex, m.newPosition])));
      } else {
        setValidMoves(new Map());
      }

      // Transition waiting → playing
      const joinedCount = Object.values(state.players).filter(Boolean).length;
      if (joinedCount >= state.playerCount && state.startedAt) {
        setGamePhase(prev => prev === 'waiting' ? 'playing' : prev);
      }
    }).then(unsub => {
      if (cancelled) {
        unsub();
      } else {
        unsubscribe = unsub;
      }
    }).catch(() => {
      // Silently handle subscription errors (e.g. network failure)
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [gameCode]);

  // --- Game handlers (all read from refs to avoid stale closures) ---

  const executeMove = useCallback(async (
    tokenIndex: number,
    newPosition: TokenPosition,
    roll: number
  ) => {
    const gc = gameCodeRef.current;
    if (!gc) return;

    const currentTokens = tokensRef.current;
    const curColor = currentTurnRef.current;
    const curSixes = consecutiveSixesRef.current;
    const curFinishOrder = finishOrderRef.current;
    const curPlayerCount = activePlayerCountRef.current;

    const { newTokens, captured, reachedHome } = applyMove(currentTokens, tokenIndex, newPosition);

    const moverColor = getTokenColor(tokenIndex);
    const updatedFinishOrder = [...curFinishOrder];
    if (checkPlayerFinished(newTokens, moverColor) && !curFinishOrder.includes(moverColor)) {
      updatedFinishOrder.push(moverColor);
    }

    const finishedColors = getFinishedColors(newTokens, curPlayerCount);

    // Check for game end
    const activePlayers = TURN_ORDER.slice(0, curPlayerCount);
    const unfinishedPlayers = activePlayers.filter(c => !finishedColors.has(c));
    const gameWinner = unfinishedPlayers.length <= 1 ? updatedFinishOrder[0] || null : null;

    const { nextColor, nextSixes } = getNextTurn(
      curColor, roll, curSixes, captured, reachedHome,
      curPlayerCount, finishedColors
    );

    // Show feedback
    if (roll === 6 && curSixes >= 2) showHint('Three 6s — turn lost!');
    else if (captured) showHint('Captured! Bonus turn');
    else if (reachedHome) showHint('Home! Bonus turn');
    else if (roll === 6 && nextColor === curColor) showHint('Rolled 6! Bonus turn');

    setLastMovedToken(tokenIndex);
    clearTimeout(movedTimeoutRef.current);
    movedTimeoutRef.current = setTimeout(() => setLastMovedToken(null), 400);
    setValidMoves(new Map());

    const update: LudoMoveUpdate = {
      tokens: serializeTokens(newTokens),
      currentTurn: gameWinner ? curColor : nextColor,
      turnPhase: 'roll',
      diceValue: roll,
      consecutiveSixes: nextSixes,
      winner: gameWinner,
      finishOrder: updatedFinishOrder.join(','),
      turnStartedAt: Date.now(),
    };

    try {
      await makeMove(gc, update);
    } catch {
      moveInFlightRef.current = false;
    }
  }, [showHint]);

  const handleRollDice = useCallback(async () => {
    const gc = gameCodeRef.current;
    const mc = myColorRef.current;
    if (!gc || !mc) return;
    if (currentTurnRef.current !== mc || turnPhaseRef.current !== 'roll') return;
    if (winnerRef.current || isRollingRef.current || moveInFlightRef.current) return;

    moveInFlightRef.current = true;
    isRollingRef.current = true;
    setIsRolling(true);

    const roll = Math.floor(Math.random() * 6) + 1;

    rollTimeoutRef.current = setTimeout(async () => {
      setIsRolling(false);
      isRollingRef.current = false;
      setDiceValue(roll);
      diceAnimKeyRef.current += 1;

      const currentTokens = tokensRef.current;
      const curColor = currentTurnRef.current;
      const curSixes = consecutiveSixesRef.current;
      const curFinishOrder = finishOrderRef.current;
      const curPlayerCount = activePlayerCountRef.current;
      const finishedColors = getFinishedColors(currentTokens, curPlayerCount);

      // Three consecutive 6s penalty
      if (roll === 6 && curSixes >= 2) {
        showHint('Three 6s — turn lost!');
        const nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
        const update: LudoMoveUpdate = {
          tokens: serializeTokens(currentTokens),
          currentTurn: nextColor,
          turnPhase: 'roll',
          diceValue: roll,
          consecutiveSixes: 0,
          winner: null,
          finishOrder: curFinishOrder.join(','),
          turnStartedAt: Date.now(),
        };
        try { await makeMove(gc, update); } catch { moveInFlightRef.current = false; }
        return;
      }

      // Check valid moves
      const moves = getValidMoves(currentTokens, curColor, roll);

      if (moves.length === 0) {
        // No valid moves — provide context-aware feedback
        const colorIndices = getColorTokenIndices(curColor);
        const hasTokensInCorridor = colorIndices.some(i => {
          const t = currentTokens[i];
          return t.startsWith('final-') && t !== 'final-6';
        });
        let nextColor: LudoColor;
        let nextSixes: number;
        if (roll === 6) {
          nextColor = curColor;
          nextSixes = curSixes + 1;
          showHint('No moves, but rolled 6!');
        } else {
          nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
          nextSixes = 0;
          showHint(hasTokensInCorridor ? 'Need exact roll to finish' : 'No valid moves');
        }

        const update: LudoMoveUpdate = {
          tokens: serializeTokens(currentTokens),
          currentTurn: nextColor,
          turnPhase: 'roll',
          diceValue: roll,
          consecutiveSixes: nextSixes,
          winner: null,
          finishOrder: curFinishOrder.join(','),
          turnStartedAt: Date.now(),
        };
        try { await makeMove(gc, update); } catch { moveInFlightRef.current = false; }
        return;
      }

      // Single valid move: auto-select
      if (moves.length === 1) {
        await executeMove(moves[0].tokenIndex, moves[0].newPosition, roll);
        return;
      }

      // Multiple valid moves: let player choose
      setValidMoves(new Map(moves.map(m => [m.tokenIndex, m.newPosition])));
      const update: LudoMoveUpdate = {
        tokens: serializeTokens(currentTokens),
        currentTurn: curColor,
        turnPhase: 'move',
        diceValue: roll,
        consecutiveSixes: curSixes,
        winner: null,
        finishOrder: curFinishOrder.join(','),
        turnStartedAt: Date.now(),
      };
      try { await makeMove(gc, update); } catch { moveInFlightRef.current = false; }
    }, 600);
  }, [executeMove, showHint]);

  const handleMoveToken = useCallback((tokenIndex: number) => {
    const mc = myColorRef.current;
    if (!mc) return;
    if (currentTurnRef.current !== mc || turnPhaseRef.current !== 'move') return;
    if (winnerRef.current || moveInFlightRef.current) return;

    const dice = diceValueRef.current;
    if (dice === null) return;

    // Recompute valid moves from refs to avoid stale state
    const moves = getValidMoves(tokensRef.current, currentTurnRef.current, dice);
    const move = moves.find(m => m.tokenIndex === tokenIndex);
    if (!move) return;

    moveInFlightRef.current = true;
    executeMove(move.tokenIndex, move.newPosition, dice);
  }, [executeMove]);

  // Refs for handler functions (timer uses these)
  const handleRollDiceRef = useRef(handleRollDice);
  handleRollDiceRef.current = handleRollDice;
  const executeMoveRef = useRef(executeMove);
  executeMoveRef.current = executeMove;

  // --- Turn timer (30s countdown, auto-roll/auto-move on expiry) ---
  // Primary: current player's client auto-acts at 0s.
  // Backup: any other client force-skips at -15s (45s total) to prevent
  // permanent stalls when the active player disconnects.

  const BACKUP_GRACE = 15;

  useEffect(() => {
    if (gamePhase !== 'playing') return;

    const tick = () => {
      if (winnerRef.current) {
        setTimeLeft(TURN_SECONDS);
        return;
      }

      const elapsed = Math.floor((Date.now() - turnStartedAtRef.current) / 1000);
      const remaining = TURN_SECONDS - elapsed;
      setTimeLeft(Math.max(0, remaining));

      const isCurrentPlayer = myColorRef.current === currentTurnRef.current;

      // Primary: current player auto-acts at 0s
      if (
        remaining <= 0 &&
        isCurrentPlayer &&
        !moveInFlightRef.current &&
        !isRollingRef.current
      ) {
        if (turnPhaseRef.current === 'roll') {
          handleRollDiceRef.current();
        } else if (turnPhaseRef.current === 'move') {
          const dice = diceValueRef.current;
          if (dice !== null) {
            const moves = getValidMoves(tokensRef.current, currentTurnRef.current, dice);
            if (moves.length > 0) {
              moveInFlightRef.current = true;
              const randomMove = moves[Math.floor(Math.random() * moves.length)];
              executeMoveRef.current(randomMove.tokenIndex, randomMove.newPosition, dice);
            }
          }
        }
      }

      // Backup: any non-current client force-skips after 45s total
      if (
        remaining <= -BACKUP_GRACE &&
        !isCurrentPlayer &&
        myColorRef.current !== null &&
        !moveInFlightRef.current
      ) {
        moveInFlightRef.current = true;
        const gc = gameCodeRef.current;
        if (gc) {
          const currentTokens = tokensRef.current;
          const curColor = currentTurnRef.current;
          const curPlayerCount = activePlayerCountRef.current;
          const curFinishOrder = finishOrderRef.current;
          const finishedColors = getFinishedColors(currentTokens, curPlayerCount);
          const nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
          const update: LudoMoveUpdate = {
            tokens: serializeTokens(currentTokens),
            currentTurn: nextColor,
            turnPhase: 'roll',
            diceValue: null,
            consecutiveSixes: 0,
            winner: null,
            finishOrder: curFinishOrder.join(','),
            turnStartedAt: Date.now(),
          };
          makeMove(gc, update).catch(() => { moveInFlightRef.current = false; });
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gamePhase]);

  // --- Lobby handlers ---

  const handleCreateGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const code = await createGame(sessionId, userName, playerCount);
      setGameCode(code);
      setMyColor('red');
      setGamePhase('waiting');
      prevTokensRef.current = 'bas'.repeat(16);
    } catch {
      setError('Failed to create game. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, userName, playerCount]);

  const handleJoinGame = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) {
      setError('Enter a 4-character game code');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { assignedColor, state } = await joinGame(code, sessionId, userName);
      setGameCode(code);
      setMyColor(assignedColor);
      setActivePlayerCount(state.playerCount);
      prevTokensRef.current = 'bas'.repeat(16);
      const joinedCount = Object.values(state.players).filter(Boolean).length;
      setGamePhase(joinedCount >= state.playerCount ? 'playing' : 'waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode, sessionId, userName]);

  const handleSpectateGame = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) {
      setError('Enter a 4-character game code');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const state = await spectateGame(code);
      setGameCode(code);
      setMyColor(null);
      setIsSpectating(true);
      setPlayerCount(state.playerCount);
      setActivePlayerCount(state.playerCount);
      prevTokensRef.current = 'bas'.repeat(16);
      setGamePhase(state.startedAt ? 'playing' : 'waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode]);

  const handleNewGame = useCallback(async () => {
    const gc = gameCodeRef.current;
    if (!gc) return;
    try {
      moveInFlightRef.current = false;
      await resetGame(gc, activePlayerCountRef.current);
      prevTokensRef.current = 'bas'.repeat(16);
    } catch {
      // Silent failure for easter egg
    }
  }, []);

  const handleBackToLobby = useCallback(() => {
    // Clear pending timeouts to prevent stale Firebase writes
    clearTimeout(rollTimeoutRef.current);
    clearTimeout(movedTimeoutRef.current);
    clearTimeout(hintTimeoutRef.current);
    setGamePhase('lobby');
    setGameCode(null);
    setMyColor(null);
    setIsSpectating(false);
    setPlayerNames({});
    setError(null);
    setTokens(Array(TOTAL_TOKENS).fill('base') as TokenPosition[]);
    setCurrentTurn('red');
    setTurnPhase('roll');
    setDiceValue(null);
    setConsecutiveSixes(0);
    setWinner(null);
    setFinishOrder([]);
    setValidMoves(new Map());
    setIsRolling(false);
    setShowBurst(false);
    setStatusHint(null);
    prevTokensRef.current = 'bas'.repeat(16);
    moveInFlightRef.current = false;
    isRollingRef.current = false;
  }, []);

  // --- Drag ---

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.closeBtn}`)) return;
    e.preventDefault();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: Math.max(0, dragStartRef.current.posY + dy),
      });
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [position]);

  // --- Derived values ---

  const isMyTurn = myColor === currentTurn;
  const diceCanRoll = isMyTurn && turnPhase === 'roll' && !isRolling && !winner;
  const showRollReminder = diceCanRoll && timeLeft <= TURN_SECONDS - 5;

  const statusMessage = isSpectating
    ? winner
      ? `${playerNames[winner] || COLOR_LABELS[winner]} wins!`
      : `${playerNames[currentTurn] || COLOR_LABELS[currentTurn]}'s turn`
    : winner
      ? (winner === myColor ? 'You win!' : `${playerNames[winner] || COLOR_LABELS[winner]} wins!`)
      : isMyTurn
        ? (turnPhase === 'roll' ? 'Your turn — Roll!' : `Rolled ${diceValue} — Pick a token`)
        : `${playerNames[currentTurn] || COLOR_LABELS[currentTurn]}'s turn`;

  // --- Render helpers ---

  function renderTrackCell(cellNum: number) {
    const [row, col] = TRACK_COORDS[cellNum];
    const isSafe = SAFE_ZONES.has(cellNum);
    const startColor = START_CELL_COLORS[cellNum];
    const entryColor = ENTRY_ARROW_COLORS[cellNum];

    const classes = [
      styles.cell,
      isSafe ? styles.safeZone : '',
      startColor === 'red' ? styles.startRed : '',
      startColor === 'green' ? styles.startGreen : '',
      startColor === 'yellow' ? styles.startYellow : '',
      startColor === 'blue' ? styles.startBlue : '',
      entryColor === 'red' ? styles.entryRed : '',
      entryColor === 'green' ? styles.entryGreen : '',
      entryColor === 'yellow' ? styles.entryYellow : '',
      entryColor === 'blue' ? styles.entryBlue : '',
    ].filter(Boolean).join(' ');

    return (
      <div
        key={`track-${cellNum}`}
        className={classes}
        style={{ gridRow: row, gridColumn: col }}
      />
    );
  }

  function renderToken(idx: number) {
    const pos = tokens[idx];
    if (pos === 'base' || pos === 'final-6') return null;

    const color = getTokenColor(idx);
    const localIdx = idx % TOKENS_PER_PLAYER;
    const isClickable = validMoves.has(idx) && isMyTurn && turnPhase === 'move';
    const isArriving = lastMovedToken === idx;
    const coords = getTokenCoords(pos, idx);
    if (!coords) return null;

    const [dx, dy] = getTokenOffset(tokens, idx);

    return (
      <div
        key={`token-${idx}`}
        className={[
          styles.token,
          TOKEN_STYLE[color],
          isClickable ? styles.tokenClickable : '',
          isArriving ? styles.tokenArriving : '',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${(coords[1] - 1) * CELL_PCT + TOKEN_PAD_PCT + dx}%`,
          top: `${(coords[0] - 1) * CELL_PCT + TOKEN_PAD_PCT + dy}%`,
        }}
        onClick={() => isClickable && handleMoveToken(idx)}
        role="button"
        aria-label={`${COLOR_LABELS[color]} token ${localIdx + 1}`}
      />
    );
  }

  function renderBaseQuadrant(color: LudoColor) {
    const baseClass = color === 'red' ? styles.baseRed
      : color === 'green' ? styles.baseGreen
      : color === 'yellow' ? styles.baseYellow
      : styles.baseBlue;
    const indices = getColorTokenIndices(color);

    return (
      <div key={`base-${color}`} className={`${styles.base} ${baseClass}`}>
        <div className={styles.baseInner}>
          {indices.map(idx => {
            const pos = tokens[idx];
            if (pos !== 'base') {
              return <div key={`empty-${idx}`} className={styles.baseSlotEmpty} />;
            }
            const localIdx = idx % TOKENS_PER_PLAYER;
            const isClickable = validMoves.has(idx) && isMyTurn && turnPhase === 'move';
            return (
              <div
                key={`base-token-${idx}`}
                className={[
                  styles.baseToken,
                  TOKEN_STYLE[color],
                  isClickable ? styles.baseTokenClickable : '',
                ].filter(Boolean).join(' ')}
                onClick={() => isClickable && handleMoveToken(idx)}
                role="button"
                aria-label={`${COLOR_LABELS[color]} token ${localIdx + 1} (in base)`}
              />
            );
          })}
        </div>
      </div>
    );
  }

  function renderHomeCount(color: LudoColor) {
    const indices = getColorTokenIndices(color);
    const count = indices.filter(i => tokens[i] === 'final-6').length;
    if (count === 0) return null;
    return (
      <span
        key={`home-${color}`}
        className={styles.homeCount}
        style={{ background: COLOR_HEX[color] }}
      >
        {count}
      </span>
    );
  }

  // --- Render ---

  return (
    <div className={styles.popup} style={{ left: position.x, top: position.y }}>
      {/* Title bar */}
      <div className={styles.titleBar} onMouseDown={handleDragStart}>
        <span className={styles.titleText}>
          <span>🎲</span>
          Ludo
          {gameCode && gamePhase === 'playing' && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              #{gameCode}
            </span>
          )}
          {isSpectating && gamePhase === 'playing' && (
            <span className={styles.spectateBadge}>Spectating</span>
          )}
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close Ludo">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className={styles.gameArea}>

        {/* === LOBBY === */}
        {gamePhase === 'lobby' && (
          <div className={styles.lobby}>
            <div className={styles.playerCountSelector}>
              <span className={styles.playerCountLabel}>Players:</span>
              {[2, 3, 4].map(n => (
                <button
                  key={n}
                  className={`${styles.playerCountBtn} ${playerCount === n ? styles.playerCountBtnActive : ''}`}
                  onClick={() => setPlayerCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <button
              className={styles.createBtn}
              onClick={handleCreateGame}
              disabled={isLoading}
            >
              {isLoading ? 'Creating...' : 'Create Game'}
            </button>
            <span className={styles.lobbyDivider}>or</span>
            <div className={styles.joinSection}>
              <input
                className={styles.codeInput}
                placeholder="CODE"
                value={joinCode}
                onChange={e => { setJoinCode(e.target.value.toUpperCase().slice(0, 4)); setError(null); }}
                maxLength={4}
                onKeyDown={e => e.key === 'Enter' && handleJoinGame()}
              />
              <button
                className={styles.joinBtn}
                onClick={handleJoinGame}
                disabled={isLoading}
              >
                {isLoading ? 'Joining...' : 'Join'}
              </button>
              <button
                className={styles.spectateBtn}
                onClick={handleSpectateGame}
                disabled={isLoading}
              >
                Spectate
              </button>
            </div>
            {error && <div className={styles.errorText}>{error}</div>}
          </div>
        )}

        {/* === WAITING === */}
        {gamePhase === 'waiting' && (
          <div className={styles.lobby}>
            <div className={styles.waitingText}>
              Waiting for {playerCount - Object.keys(playerNames).length} more player{playerCount - Object.keys(playerNames).length !== 1 ? 's' : ''}...
            </div>
            <div
              className={styles.gameCodeDisplay}
              onClick={() => {
                if (gameCode) {
                  navigator.clipboard.writeText(gameCode).then(() => showHint('Copied!'));
                }
              }}
              role="button"
              title="Click to copy"
            >
              {gameCode}
            </div>
            <div className={styles.shareHint}>Tap code to copy — share with your opponents</div>
            <div className={styles.playerList}>
              {TURN_ORDER.slice(0, playerCount).map(color => (
                <div
                  key={color}
                  className={`${styles.playerSlot} ${!playerNames[color] ? styles.playerSlotEmpty : ''}`}
                >
                  <span className={styles.playerDot} style={{ background: COLOR_HEX[color] }} />
                  {playerNames[color] || 'Waiting...'}
                  {color === myColor && ' (you)'}
                </div>
              ))}
            </div>
            <button className={styles.resetBtn} onClick={handleBackToLobby} style={{ marginTop: 8 }}>
              Back
            </button>
          </div>
        )}

        {/* === PLAYING === */}
        {gamePhase === 'playing' && (
          <>
            {/* Status */}
            <div className={styles.status}>
              <div className={styles.turnIndicator}>
                {winner ? (
                  <span className={styles.winText}>
                    <span className={`${styles.statusDot} ${styles[winner]}`} />
                    {' '}{statusMessage} 🎉
                  </span>
                ) : (
                  <>
                    <span className={`${styles.statusDot} ${styles[currentTurn]}`} />
                    <span>{statusMessage}</span>
                    <span className={`${styles.timer} ${timeLeft <= 10 ? styles.timerUrgent : ''}`}>
                      {timeLeft}s
                    </span>
                  </>
                )}
              </div>
              <div className={styles.diceArea}>
                {statusHint && (
                  <span className={styles.statusHint}>{statusHint}</span>
                )}
                {showRollReminder && (
                  <span className={styles.rollReminder}>Roll!</span>
                )}
                <button
                  className={[
                    styles.dice,
                    isRolling ? styles.diceRolling : '',
                    diceCanRoll ? styles.diceActive : '',
                  ].filter(Boolean).join(' ')}
                  onClick={handleRollDice}
                  disabled={!isMyTurn || turnPhase !== 'roll' || isRolling || !!winner}
                  aria-label="Roll dice"
                >
                  {isRolling ? (
                    <DiceFace value={rollingFace} />
                  ) : diceValue ? (
                    <span key={diceAnimKeyRef.current} className={styles.diceResult}>
                      <DiceFace value={diceValue} />
                    </span>
                  ) : (
                    <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>🎲</span>
                  )}
                </button>
              </div>
            </div>

            {/* Player bar */}
            <div className={styles.playerBar}>
              {TURN_ORDER.slice(0, activePlayerCount).map(color => {
                const isFinished = finishOrder.includes(color);
                return (
                  <div
                    key={color}
                    className={[
                      styles.playerChip,
                      currentTurn === color && !winner ? styles.playerChipActive : '',
                      isFinished ? styles.playerChipFinished : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className={styles.playerChipDot} style={{ background: COLOR_HEX[color] }} />
                    {playerNames[color] || COLOR_LABELS[color]}
                    {color === myColor && <span className={styles.youBadge}>you</span>}
                  </div>
                );
              })}
            </div>

            {/* Board */}
            <div className={styles.boardWrapper}>
              <div className={styles.board}>
                {/* Base quadrants */}
                {TURN_ORDER.map(color => renderBaseQuadrant(color))}

                {/* Center home */}
                <div className={styles.home}>
                  {TURN_ORDER.map(color => renderHomeCount(color))}
                </div>

                {/* Home corridors */}
                <div className={styles.redFinal}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <div key={`rf-${n}`} className={styles.finalInnerCell} />
                  ))}
                  <div className={`${styles.finalInnerCell} ${styles.finalInnerTransparent}`} />
                </div>
                <div className={styles.greenFinal}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <div key={`gf-${n}`} className={styles.finalInnerCell} />
                  ))}
                  <div className={`${styles.finalInnerCell} ${styles.finalInnerTransparent}`} />
                </div>
                <div className={styles.yellowFinal}>
                  <div className={`${styles.finalInnerCell} ${styles.finalInnerTransparent}`} />
                  {[5, 4, 3, 2, 1].map(n => (
                    <div key={`yf-${n}`} className={styles.finalInnerCell} />
                  ))}
                </div>
                <div className={styles.blueFinal}>
                  <div className={`${styles.finalInnerCell} ${styles.finalInnerTransparent}`} />
                  {[5, 4, 3, 2, 1].map(n => (
                    <div key={`bf-${n}`} className={styles.finalInnerCell} />
                  ))}
                </div>

                {/* Track cells */}
                {Array.from({ length: TRACK_SIZE }, (_, i) => renderTrackCell(i + 1))}

                {/* Tokens on track and final corridor */}
                {Array.from({ length: TOTAL_TOKENS }, (_, i) => renderToken(i))}

                {/* Winner burst */}
                {winner && (
                  <div
                    className={[
                      styles.burst,
                      winner === 'red' ? styles.burstRed
                        : winner === 'green' ? styles.burstGreen
                        : winner === 'yellow' ? styles.burstYellow
                        : styles.burstBlue,
                      showBurst ? styles.burstActive : '',
                    ].filter(Boolean).join(' ')}
                    style={{ gridRow: '1 / -1', gridColumn: '1 / -1' }}
                  />
                )}
              </div>
            </div>

            {/* Controls */}
            {isSpectating ? (
              <div className={styles.controls}>
                <button className={styles.resetBtn} onClick={handleBackToLobby}>
                  Leave
                </button>
              </div>
            ) : winner ? (
              <div className={styles.controls}>
                <button className={styles.resetBtn} onClick={handleNewGame}>
                  New Game
                </button>
                <button className={styles.resetBtn} onClick={handleBackToLobby}>
                  Leave
                </button>
              </div>
            ) : null}

            {/* Finish order */}
            {finishOrder.length > 0 && (
              <div className={styles.finishOrder}>
                Finished:&nbsp;
                {finishOrder.map((c, i) => (
                  <span key={c}>
                    {i > 0 && ', '}
                    <span className={styles.finishDot} style={{ background: COLOR_HEX[c] }} />
                    {playerNames[c] || COLOR_LABELS[c]}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
