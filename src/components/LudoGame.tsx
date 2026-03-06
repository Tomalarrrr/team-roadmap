import { useState, useEffect, useCallback, useRef } from 'react';
import { useGamePause } from '../hooks/useGamePause';
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
const TOKEN_PAD_PCT = CELL_PCT * 0.15;
const STEP_MS = 200;
const BACKUP_GRACE = 15;

// Pre-allocated index arrays (avoid Array.from in render)
const TRACK_INDICES = Array.from({ length: TRACK_SIZE }, (_, i) => i + 1);
const TOKEN_INDICES = Array.from({ length: TOTAL_TOKENS }, (_, i) => i);

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

// --- Path computation for cell-by-cell animation ---

function computeMovePath(
  from: TokenPosition,
  to: TokenPosition,
  color: LudoColor
): [number, number][] {
  if (from === 'final-6') return [];
  if (to === 'base') return [];

  // Base → start cell: animate from base position to start cell
  if (from === 'base' && to.startsWith('track-')) {
    const trackNum = parseInt(to.split('-')[1]);
    // tokenIndex not available here — caller provides base coords when needed
    return [TRACK_COORDS[trackNum]];
  }
  if (from === 'base') return [];

  if (from.startsWith('track-') && to.startsWith('track-')) {
    const path: [number, number][] = [];
    let cur = parseInt(from.split('-')[1]);
    const target = parseInt(to.split('-')[1]);
    while (cur !== target && path.length < TRACK_SIZE) {
      cur = (cur % TRACK_SIZE) + 1;
      path.push(TRACK_COORDS[cur]);
    }
    return path;
  }

  if (from.startsWith('track-') && to.startsWith('final-')) {
    const path: [number, number][] = [];
    let cur = parseInt(from.split('-')[1]);
    const entry = ENTRY_CELLS[color];
    while (cur !== entry && path.length < TRACK_SIZE) {
      cur = (cur % TRACK_SIZE) + 1;
      path.push(TRACK_COORDS[cur]);
    }
    const finalTarget = parseInt(to.split('-')[1]);
    for (let i = 1; i <= finalTarget; i++) {
      path.push(FINAL_COORDS[color][i - 1]);
    }
    return path;
  }

  if (from.startsWith('final-') && to.startsWith('final-')) {
    const path: [number, number][] = [];
    const fromN = parseInt(from.split('-')[1]);
    const toN = parseInt(to.split('-')[1]);
    for (let i = fromN + 1; i <= toN; i++) {
      path.push(FINAL_COORDS[color][i - 1]);
    }
    return path;
  }

  return [];
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
  const { paused: gamePaused, togglePause: toggleGamePause } = useGamePause();
  const gamePausedRef = useRef(gamePaused);
  gamePausedRef.current = gamePaused;

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
  const [showGameOver, setShowGameOver] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(TURN_SECONDS);

  // Drag state
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (window.innerWidth - 800) / 2),
    y: Math.max(0, (window.innerHeight - 600) / 2),
  }));
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // --- Refs for timer/callback safety (avoids stale closures) ---
  const moveInFlightRef = useRef(false);
  const isRollingRef = useRef(false);
  const turnStartedAtRef = useRef<number>(Date.now());
  const prevTokensRef = useRef('bas'.repeat(16));
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const movedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const diceAnimKeyRef = useRef(0);
  const rolledThisTurnRef = useRef(false);
  const autoMoveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gameOverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const homeStuckRolls = useRef(0); // consecutive non-6 rolls while all tokens in base
  const pityThreshold = useRef(3 + Math.floor(Math.random() * 4)); // random 3-6
  const lastTwoRolls = useRef<[number, number]>([0, 0]); // anti-streak tracking

  // Cell-by-cell animation state
  const tokenAnimPos = useRef<Map<number, [number, number]>>(new Map());
  const tokenAnimParity = useRef<Map<number, number>>(new Map());
  const tokenAnimTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const capturedTokens = useRef<{ index: number; coords: [number, number]; color: LudoColor; ts: number }[]>([]);
  const captureShowTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Game effects (deploy sparkle, home celebration)
  const gameEffects = useRef<{ type: 'deploy' | 'home'; color: LudoColor; coords?: [number, number]; ts: number }[]>([]);
  const effectTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Stats tracking (dice roll distribution + captures)
  const [gameStats, setGameStats] = useState<Partial<Record<LudoColor, { rolls: number[]; captures: number }>>>({});
  const statsInitRef = useRef(false);
  const prevTurnPhaseRef = useRef<TurnPhase>('roll');

  // Intro animation state
  const [introPhase, setIntroPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const introPhaseRef = useRef<'idle' | 'running' | 'done'>('idle');
  const introTokenPositions = useRef<Map<LudoColor, [number, number]>>(new Map());
  const introTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [introTrigger, setIntroTrigger] = useState(0);
  const [, setRenderTick] = useState(0);

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

  // --- Cleanup all timeouts + listeners on unmount ---
  useEffect(() => {
    return () => {
      clearTimeout(hintTimeoutRef.current);
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(movedTimeoutRef.current);
      clearTimeout(autoMoveRef.current);
      clearTimeout(gameOverTimerRef.current);
      for (const timer of captureShowTimers.current) clearTimeout(timer);
      for (const timer of introTimersRef.current) clearTimeout(timer);
      for (const timer of effectTimers.current) clearTimeout(timer);
      for (const timer of tokenAnimTimers.current.values()) {
        clearTimeout(timer);
      }
      dragCleanupRef.current?.();
    };
  }, []);

  // --- Utility ---

  const showHint = useCallback((msg: string) => {
    setStatusHint(msg);
    clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => setStatusHint(null), 2000);
  }, []);

  // --- Cell-by-cell token animation ---

  const startTokenAnimation = useCallback((tokenIdx: number, waypoints: [number, number][]) => {
    const existing = tokenAnimTimers.current.get(tokenIdx);
    if (existing) clearTimeout(existing);

    if (waypoints.length === 0) return;

    let step = 0;
    let lastStepTime = performance.now();
    const advance = () => {
      if (step >= waypoints.length) {
        tokenAnimPos.current.delete(tokenIdx);
        tokenAnimParity.current.delete(tokenIdx);
        tokenAnimTimers.current.delete(tokenIdx);
        setRenderTick(n => n + 1);
        return;
      }
      // If steps are firing too rapidly (tab was backgrounded), skip to end
      const now = performance.now();
      if (step > 0 && now - lastStepTime < STEP_MS * 0.3) {
        tokenAnimPos.current.delete(tokenIdx);
        tokenAnimParity.current.delete(tokenIdx);
        tokenAnimTimers.current.delete(tokenIdx);
        setRenderTick(n => n + 1);
        return;
      }
      lastStepTime = now;
      tokenAnimPos.current.set(tokenIdx, waypoints[step]);
      tokenAnimParity.current.set(tokenIdx, step % 2);
      step++;
      setRenderTick(n => n + 1);
      tokenAnimTimers.current.set(tokenIdx, setTimeout(advance, STEP_MS));
    };

    advance();
  }, []);

  // --- Dice rolling animation (rapid face cycling) ---

  useEffect(() => {
    if (!isRolling) return;
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout>;
    const step = () => {
      setRollingFace(Math.floor(Math.random() * 6) + 1);
      frame++;
      const delay = 80 + frame * 15;
      if (delay < 300) {
        timeout = setTimeout(step, delay);
      }
    };
    timeout = setTimeout(step, 80);
    return () => clearTimeout(timeout);
  }, [isRolling]);

  // Auto-join from URL parameter (?ludo=CODE)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('ludo');
    if (code && code.length === 4 && gamePhase === 'lobby') {
      setJoinCode(code.toUpperCase());
      setTimeout(() => {
        joinGame(code.toUpperCase(), sessionId, userName)
          .then(({ assignedColor, state }) => {
            setGameCode(code.toUpperCase());
            setMyColor(assignedColor);
            setActivePlayerCount(state.playerCount);
            const joinedCount = Object.values(state.players).filter(Boolean).length;
            const gameInProgress = state.startedAt && state.tokens !== 'bas'.repeat(16);
            if (gameInProgress) {
              prevTokensRef.current = state.tokens;
              setIntroPhase('done');
              introPhaseRef.current = 'done';
            } else {
              prevTokensRef.current = 'bas'.repeat(16);
            }
            setGamePhase(joinedCount >= state.playerCount ? 'playing' : 'waiting');
            const url = new URL(window.location.href);
            url.searchParams.delete('ludo');
            window.history.replaceState({}, '', url.toString());
          })
          .catch(() => setError('Failed to join game from link'));
      }, 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSearchOpen) onClose();
      if ((e.key === ' ' || e.key === 'Enter') && gamePhase === 'playing' && introPhaseRef.current !== 'running') {
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
      setError(null); // Clear any connection errors on successful state update

      const parsedTokens = deserializeTokens(state.tokens);

      // Reset moveInFlight on any state change (token or turn change)
      if (state.tokens !== prevTokensRef.current || state.turnStartedAt !== turnStartedAtRef.current) {
        moveInFlightRef.current = false;
      }

      // Detect token moves and start cell-by-cell animations + capture effects
      if (state.tokens !== prevTokensRef.current) {
        const oldTokens = deserializeTokens(prevTokensRef.current);

        // Track animation paths for capturers (to compute capture delay)
        const animPaths = new Map<number, [number, number][]>();

        // Pass 1: Start animations for movers (skip captured tokens)
        for (let i = 0; i < TOTAL_TOKENS; i++) {
          if (oldTokens[i] !== parsedTokens[i]) {
            if (parsedTokens[i] === 'base' && oldTokens[i] !== 'base') continue; // capture — handled in pass 2
            const path = computeMovePath(oldTokens[i], parsedTokens[i], getTokenColor(i));
            // For base→track deployment, prepend base coords so the token
            // visually starts at the base and slides smoothly to the start cell
            if (oldTokens[i] === 'base' && path.length > 0) {
              const baseCoords = getTokenCoords('base', i);
              if (baseCoords) path.unshift(baseCoords);
            }
            if (path.length > 1) {
              animPaths.set(i, path);
              startTokenAnimation(i, path);
            }
          }
        }

        // Game effects: deploy sparkle + home celebration
        for (const timer of effectTimers.current) clearTimeout(timer);
        effectTimers.current = [];
        for (let i = 0; i < TOTAL_TOKENS; i++) {
          if (oldTokens[i] === parsedTokens[i]) continue;
          const color = getTokenColor(i);
          // Deploy: base → track (sparkle at departure point)
          if (oldTokens[i] === 'base' && parsedTokens[i].startsWith('track-')) {
            const baseCoords = getTokenCoords('base', i);
            if (baseCoords) {
              const effect = { type: 'deploy' as const, color, coords: baseCoords, ts: Date.now() };
              gameEffects.current.push(effect);
              setRenderTick(n => n + 1);
              const timer = setTimeout(() => {
                gameEffects.current = gameEffects.current.filter(e => e !== effect);
                setRenderTick(n => n + 1);
              }, 600);
              effectTimers.current.push(timer);
            }
          }
          // Home arrival: final-N → final-6 (star burst at home center)
          if (parsedTokens[i] === 'final-6' && oldTokens[i].startsWith('final-')) {
            const path = animPaths.get(i);
            const delay = path ? (path.length - 1) * STEP_MS : 0;
            const effect = { type: 'home' as const, color, ts: Date.now() + delay };
            const showTimer = setTimeout(() => {
              gameEffects.current.push(effect);
              setRenderTick(n => n + 1);
              const cleanupTimer = setTimeout(() => {
                gameEffects.current = gameEffects.current.filter(e => e !== effect);
                setRenderTick(n => n + 1);
              }, 800);
              effectTimers.current.push(cleanupTimer);
            }, delay);
            effectTimers.current.push(showTimer);
          }
        }

        // Pass 2: Schedule capture ghosts with delay until the capturer arrives
        for (const timer of captureShowTimers.current) clearTimeout(timer);
        captureShowTimers.current = [];

        for (let i = 0; i < TOTAL_TOKENS; i++) {
          if (oldTokens[i] === parsedTokens[i]) continue;
          if (!(parsedTokens[i] === 'base' && oldTokens[i] !== 'base')) continue;

          // Find the capturer: the token whose NEW position matches this token's OLD position
          let capturerDelay = 0;
          for (let j = 0; j < TOTAL_TOKENS; j++) {
            if (j === i) continue;
            if (parsedTokens[j] === oldTokens[i] && oldTokens[j] !== parsedTokens[j]) {
              const path = animPaths.get(j);
              if (path) capturerDelay = (path.length - 1) * STEP_MS;
              // Track capture in stats
              const capturerColor = getTokenColor(j);
              setGameStats(prev => {
                const entry = prev[capturerColor] || { rolls: [0, 0, 0, 0, 0, 0], captures: 0 };
                return { ...prev, [capturerColor]: { ...entry, captures: entry.captures + 1 } };
              });
              break;
            }
          }

          const coords = getTokenCoords(oldTokens[i], i);
          if (coords) {
            const captureData = { index: i, coords, color: getTokenColor(i), ts: Date.now() + capturerDelay };
            const showTimer = setTimeout(() => {
              capturedTokens.current.push(captureData);
              setRenderTick(n => n + 1);
              // Each capture independently cleans itself up after 500ms
              const cleanupTimer = setTimeout(() => {
                capturedTokens.current = capturedTokens.current.filter(t => t !== captureData);
                setRenderTick(n => n + 1);
              }, 500);
              captureShowTimers.current.push(cleanupTimer);
            }, capturerDelay);
            captureShowTimers.current.push(showTimer);
          }
        }
      }
      prevTokensRef.current = state.tokens;

      // Track dice rolls for stats table
      if (!statsInitRef.current) {
        statsInitRef.current = true;
      } else if (
        state.diceValue !== null &&
        prevTurnPhaseRef.current === 'roll' &&
        (state.turnPhase === 'move' || state.turnStartedAt !== turnStartedAtRef.current)
      ) {
        const roller = state.currentTurn !== currentTurnRef.current
          ? currentTurnRef.current
          : state.currentTurn;
        setGameStats(prev => {
          const entry = prev[roller] || { rolls: [0, 0, 0, 0, 0, 0], captures: 0 };
          const newRolls = [...entry.rolls];
          newRolls[state.diceValue! - 1]++;
          return { ...prev, [roller]: { ...entry, rolls: newRolls } };
        });
      }
      prevTurnPhaseRef.current = state.turnPhase;

      // Reset dice display when a new roll phase arrives (avoids showing stale value)
      if (state.turnPhase === 'roll' && !isRollingRef.current) {
        rolledThisTurnRef.current = false;
      }

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
        // Delay game-over overlay so the winning animation plays out
        clearTimeout(gameOverTimerRef.current);
        gameOverTimerRef.current = setTimeout(() => setShowGameOver(true), 1200);
      } else {
        setWinner(null);
        setShowBurst(false);
        setShowGameOver(false);
        clearTimeout(gameOverTimerRef.current);
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
    }).catch((err) => {
      console.error('[Ludo] Subscription failed:', err);
      setError('Connection lost. Please rejoin.');
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

    // Check for game end — first player to finish all tokens wins
    const gameWinner = updatedFinishOrder.length > 0 ? updatedFinishOrder[0] : null;

    const { nextColor, nextSixes } = getNextTurn(
      curColor, roll, curSixes, captured, reachedHome,
      curPlayerCount, finishedColors
    );

    // Show feedback
    if (roll === 6 && curSixes >= 2) showHint('Three 6s — no bonus turn');
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
      await makeMove(gc, mc, update);
    } catch {
      moveInFlightRef.current = false;
    }
  }, [showHint]);

  const handleRollDice = useCallback(async () => {
    const gc = gameCodeRef.current;
    const mc = myColorRef.current;
    if (!gc || !mc) return;
    if (introPhaseRef.current === 'running') return;
    if (currentTurnRef.current !== mc || turnPhaseRef.current !== 'roll') return;
    if (winnerRef.current || isRollingRef.current || moveInFlightRef.current) return;
    if (gamePausedRef.current) return;

    moveInFlightRef.current = true;
    isRollingRef.current = true;
    setIsRolling(true);

    // Anti-streak: if last 2 rolls were the same value, avoid a third in a row
    const fairRoll = (): number => {
      let r = Math.floor(Math.random() * 6) + 1;
      const [prev2, prev1] = lastTwoRolls.current;
      if (prev2 === prev1 && prev1 === r && prev1 !== 0) {
        // Reroll once (still random, just not the same value)
        r = Math.floor(Math.random() * 5) + 1;
        if (r >= prev1) r++; // maps 1-5 to 1-6 excluding prev1
      }
      return r;
    };

    // Pity-timer: guarantee a 6 after N consecutive non-6 rolls (N random 3-6)
    // when the only way to progress is rolling a 6. This covers:
    //  - all non-finished tokens at home
    //  - some at home, rest in final corridor (no tokens on the regular track)
    const myIndices = getColorTokenIndices(mc);
    const hasTokenAtHome = myIndices.some(i => tokensRef.current[i] === 'base');
    const noneOnTrack = myIndices.every(i => {
      const t = tokensRef.current[i];
      return t === 'base' || t === 'final-6' || t.startsWith('final-');
    });
    const needsSix = hasTokenAtHome && noneOnTrack;
    let roll = fairRoll();
    if (needsSix && homeStuckRolls.current >= pityThreshold.current) {
      roll = 6;
    }
    if (needsSix) {
      if (roll === 6) {
        homeStuckRolls.current = 0;
        pityThreshold.current = 3 + Math.floor(Math.random() * 4); // new random 3-6
      } else {
        homeStuckRolls.current += 1;
      }
    } else {
      homeStuckRolls.current = 0;
    }
    lastTwoRolls.current = [lastTwoRolls.current[1], roll];

    rollTimeoutRef.current = setTimeout(async () => {
      setIsRolling(false);
      isRollingRef.current = false;
      setDiceValue(roll);
      diceAnimKeyRef.current += 1;
      rolledThisTurnRef.current = true;

      const currentTokens = tokensRef.current;
      const curColor = currentTurnRef.current;
      const curSixes = consecutiveSixesRef.current;
      const curFinishOrder = finishOrderRef.current;
      const curPlayerCount = activePlayerCountRef.current;
      const finishedColors = getFinishedColors(currentTokens, curPlayerCount);

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
        if (roll === 6 && curSixes < 2) {
          nextColor = curColor;
          nextSixes = curSixes + 1;
          showHint('No moves, but rolled 6!');
        } else if (roll === 6 && curSixes >= 2) {
          nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
          nextSixes = 0;
          showHint('Three 6s — no bonus turn');
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
        try { await makeMove(gc, mc, update); } catch { moveInFlightRef.current = false; }
        return;
      }

      // Single valid move: auto-select with brief delay so player sees the roll
      if (moves.length === 1) {
        const m = moves[0];
        autoMoveRef.current = setTimeout(() => {
          executeMove(m.tokenIndex, m.newPosition, roll);
        }, 600);
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
    }, 800);
  }, [executeMove, showHint]);

  const handleMoveToken = useCallback((tokenIndex: number) => {
    const mc = myColorRef.current;
    if (!mc) return;
    if (currentTurnRef.current !== mc || turnPhaseRef.current !== 'move') return;
    if (winnerRef.current || moveInFlightRef.current) return;
    if (gamePausedRef.current) return;

    const dice = diceValueRef.current;
    if (dice === null) return;

    // Recompute valid moves from refs to avoid stale state
    const moves = getValidMoves(tokensRef.current, currentTurnRef.current, dice);
    const move = moves.find(m => m.tokenIndex === tokenIndex);
    if (!move) return;

    clearTimeout(autoMoveRef.current);
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

  useEffect(() => {
    if (gamePhase !== 'playing') return;

    const tick = () => {
      if (winnerRef.current || introPhaseRef.current === 'running') {
        setTimeLeft(TURN_SECONDS);
        return;
      }

      if (gamePausedRef.current) {
        turnStartedAtRef.current = Date.now();
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
          makeMove(gc, curColor, update).catch(() => { moveInFlightRef.current = false; });
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gamePhase]);

  // --- Intro animation (tokens race around board on game start) ---

  useEffect(() => {
    if (gamePhase !== 'playing') return;
    if (introPhaseRef.current !== 'idle') return;

    // Skip intro if game is already in progress (reconnection / spectating midway)
    if (prevTokensRef.current !== 'bas'.repeat(16)) {
      setIntroPhase('done');
      introPhaseRef.current = 'done';
      return;
    }

    setIntroPhase('running');
    introPhaseRef.current = 'running';

    const INTRO_STEP_MS = 90;
    const STAGGER_MS = 250;
    const activeColors = TURN_ORDER.slice(0, activePlayerCountRef.current);
    let completedColors = 0;

    for (let ci = 0; ci < activeColors.length; ci++) {
      const color = activeColors[ci];
      const startPos = START_POSITIONS[color];

      // Build full lap path: 52 cells starting from this color's start position
      const path: [number, number][] = [];
      for (let step = 0; step < TRACK_SIZE; step++) {
        const cellNum = ((startPos - 1 + step) % TRACK_SIZE) + 1;
        path.push(TRACK_COORDS[cellNum]);
      }

      const staggerDelay = ci * STAGGER_MS;

      // Animate through the track
      for (let step = 0; step < path.length; step++) {
        const timer = setTimeout(() => {
          introTokenPositions.current.set(color, path[step]);
          setRenderTick(n => n + 1);
        }, staggerDelay + step * INTRO_STEP_MS);
        introTimersRef.current.push(timer);
      }

      // After completing the lap, remove the ghost token
      const totalDuration = staggerDelay + path.length * INTRO_STEP_MS;
      const doneTimer = setTimeout(() => {
        introTokenPositions.current.delete(color);
        completedColors++;
        setRenderTick(n => n + 1);
        if (completedColors === activeColors.length) {
          setIntroPhase('done');
          introPhaseRef.current = 'done';
          // Reset turn timer so the first player gets a full 30 seconds
          turnStartedAtRef.current = Date.now();
        }
      }, totalDuration);
      introTimersRef.current.push(doneTimer);
    }

    return () => {
      for (const timer of introTimersRef.current) clearTimeout(timer);
      introTimersRef.current = [];
    };
  }, [gamePhase, introTrigger]);

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
      const joinedCount = Object.values(state.players).filter(Boolean).length;
      const gameInProgress = state.startedAt && state.tokens !== 'bas'.repeat(16);
      if (gameInProgress) {
        prevTokensRef.current = state.tokens;
        setIntroPhase('done');
        introPhaseRef.current = 'done';
      } else {
        prevTokensRef.current = 'bas'.repeat(16);
      }
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
      const gameInProgress = state.startedAt && state.tokens !== 'bas'.repeat(16);
      if (gameInProgress) {
        prevTokensRef.current = state.tokens;
        setIntroPhase('done');
        introPhaseRef.current = 'done';
      } else {
        prevTokensRef.current = 'bas'.repeat(16);
      }
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
      // Set prevTokens BEFORE resetGame so the intro effect sees fresh state
      prevTokensRef.current = 'bas'.repeat(16);
      setIntroPhase('idle');
      introPhaseRef.current = 'idle';
      setIntroTrigger(n => n + 1);
      // Clear all animation state from previous game
      for (const timer of introTimersRef.current) clearTimeout(timer);
      introTimersRef.current = [];
      introTokenPositions.current.clear();
      for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
      tokenAnimTimers.current.clear();
      tokenAnimPos.current.clear();
      tokenAnimParity.current.clear();
      for (const timer of captureShowTimers.current) clearTimeout(timer);
      captureShowTimers.current = [];
      for (const timer of effectTimers.current) clearTimeout(timer);
      effectTimers.current = [];
      capturedTokens.current = [];
      gameEffects.current = [];
      setGameStats({});
      statsInitRef.current = false;
      homeStuckRolls.current = 0;
      setShowGameOver(false);
      clearTimeout(gameOverTimerRef.current);
      await resetGame(gc, activePlayerCountRef.current);
    } catch {
      // Silent failure for easter egg
    }
  }, []);

  const handleBackToLobby = useCallback(() => {
    // Clear pending timeouts to prevent stale Firebase writes
    clearTimeout(rollTimeoutRef.current);
    clearTimeout(movedTimeoutRef.current);
    clearTimeout(hintTimeoutRef.current);
    clearTimeout(autoMoveRef.current);
    for (const timer of captureShowTimers.current) clearTimeout(timer);
    captureShowTimers.current = [];
    for (const timer of introTimersRef.current) clearTimeout(timer);
    introTimersRef.current = [];
    for (const timer of effectTimers.current) clearTimeout(timer);
    effectTimers.current = [];
    introTokenPositions.current.clear();
    setIntroPhase('idle');
    introPhaseRef.current = 'idle';
    for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
    tokenAnimTimers.current.clear();
    tokenAnimPos.current.clear();
    capturedTokens.current = [];
    gameEffects.current = [];
    setGameStats({});
    statsInitRef.current = false;
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
    setShowGameOver(false);
    clearTimeout(gameOverTimerRef.current);
    setStatusHint(null);
    prevTokensRef.current = 'bas'.repeat(16);
    moveInFlightRef.current = false;
    isRollingRef.current = false;
    rolledThisTurnRef.current = false;
    homeStuckRolls.current = 0;
    pityThreshold.current = 3 + Math.floor(Math.random() * 4);
    lastTwoRolls.current = [0, 0];
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  // --- Drag ---

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.closeBtn}`)) return;
    e.preventDefault();
    dragCleanupRef.current?.();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: positionRef.current.x,
      posY: positionRef.current.y,
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
      dragCleanupRef.current = null;
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    dragCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // --- Derived values ---

  const isMyTurn = myColor === currentTurn;
  const diceCanRoll = isMyTurn && turnPhase === 'roll' && !isRolling && !winner && introPhase !== 'running' && !gamePaused;
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
    const animCoords = tokenAnimPos.current.get(idx);

    // Keep rendering during animation even if token reached final-6
    if ((pos === 'base' || pos === 'final-6') && !animCoords) return null;

    const color = getTokenColor(idx);
    const localIdx = idx % TOKENS_PER_PLAYER;
    const isStepping = !!animCoords;
    const stepParity = tokenAnimParity.current.get(idx) ?? 0;
    const isClickable = validMoves.has(idx) && isMyTurn && turnPhase === 'move' && !isStepping;
    const isArriving = lastMovedToken === idx && !isStepping;
    const inCorridor = pos.startsWith('final-') && pos !== 'final-6';

    const coords = animCoords || getTokenCoords(pos, idx);
    if (!coords) return null;

    const [dx, dy] = isStepping ? [0, 0] : getTokenOffset(tokens, idx);

    return (
      <div
        key={`token-${idx}`}
        className={[
          styles.token,
          TOKEN_STYLE[color],
          isClickable ? styles.tokenClickable : '',
          isArriving ? styles.tokenArriving : '',
          isStepping ? (stepParity ? styles.tokenSteppingB : styles.tokenSteppingA) : '',
          inCorridor && !isStepping ? styles.tokenInCorridor : '',
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
    const isActive = TURN_ORDER.indexOf(color) < activePlayerCount;

    return (
      <div key={`base-${color}`} className={`${styles.base} ${baseClass} ${!isActive ? styles.baseInactive : ''} ${isActive && currentTurn === color && !winner && introPhase !== 'running' ? styles.baseActiveTurn : ''}`}>
        <div className={styles.baseInner}>
          {isActive && indices.map(idx => {
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
        <button className={`${styles.closeBtn} ${gamePaused ? styles.pauseBtnActive : ''}`} onClick={toggleGamePause} aria-label={gamePaused ? 'Resume all games' : 'Pause all games'}>
          {gamePaused ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M5 3L13 8L5 13V3Z" fill="currentColor" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="3" width="3.5" height="10" rx="0.75" fill="currentColor" />
              <rect x="9.5" y="3" width="3.5" height="10" rx="0.75" fill="currentColor" />
            </svg>
          )}
        </button>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close Ludo">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {gamePaused && gamePhase === 'playing' && (
        <div className={styles.pauseOverlay}>
          <div className={styles.pauseText}>PAUSED</div>
          <button className={styles.pauseResumeBtn} onClick={toggleGamePause}>Resume</button>
        </div>
      )}

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
            {gameCode && (
              <button
                className={styles.spectateBtn}
                style={{ marginTop: 4 }}
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('ludo', gameCode);
                  navigator.clipboard.writeText(url.toString()).then(() => showHint('Link copied!'));
                }}
              >
                Copy Link
              </button>
            )}
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
          <div className={styles.playingLayout}>
            {/* Board column */}
            <div className={styles.boardColumn}>
              <div className={styles.boardWrapper}>
                <div className={styles.board}>
                  {/* Base quadrants */}
                  {TURN_ORDER.map(color => renderBaseQuadrant(color))}

                  {/* Center home */}
                  <div className={styles.home}>
                    {TURN_ORDER.map(color => renderHomeCount(color))}
                  </div>

                  {/* Home corridors */}
                  <div className={`${styles.redFinal} ${activePlayerCount < 1 ? styles.corridorInactive : ''}`}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <div key={`rf-${n}`} className={styles.finalInnerCell}>
                        <span className={styles.corridorNum}>{n}</span>
                      </div>
                    ))}
                    <div className={`${styles.finalInnerCell} ${styles.finalInnerTransparent}`} />
                  </div>
                  <div className={`${styles.greenFinal} ${activePlayerCount < 2 ? styles.corridorInactive : ''}`}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <div key={`gf-${n}`} className={styles.finalInnerCell}>
                        <span className={styles.corridorNum}>{n}</span>
                      </div>
                    ))}
                    <div className={`${styles.finalInnerCell} ${styles.finalInnerTransparent}`} />
                  </div>
                  <div className={`${styles.yellowFinal} ${activePlayerCount < 3 ? styles.corridorInactive : ''}`}>
                    <div className={`${styles.finalInnerCell} ${styles.finalInnerTransparent}`} />
                    {[5, 4, 3, 2, 1].map(n => (
                      <div key={`yf-${n}`} className={styles.finalInnerCell}>
                        <span className={styles.corridorNum}>{n}</span>
                      </div>
                    ))}
                  </div>
                  <div className={`${styles.blueFinal} ${activePlayerCount < 4 ? styles.corridorInactive : ''}`}>
                    <div className={`${styles.finalInnerCell} ${styles.finalInnerTransparent}`} />
                    {[5, 4, 3, 2, 1].map(n => (
                      <div key={`bf-${n}`} className={styles.finalInnerCell}>
                        <span className={styles.corridorNum}>{n}</span>
                      </div>
                    ))}
                  </div>

                  {/* Track cells */}
                  {TRACK_INDICES.map(n => renderTrackCell(n))}

                  {/* Tokens on track and final corridor */}
                  {TOKEN_INDICES.map(i => renderToken(i))}

                  {/* Captured token ghosts (fade-out at last position) */}
                  {capturedTokens.current.map(ct => (
                    <div
                      key={`cap-${ct.index}-${ct.ts}`}
                      className={`${styles.token} ${TOKEN_STYLE[ct.color]} ${styles.tokenCaptured}`}
                      style={{
                        left: `${(ct.coords[1] - 1) * CELL_PCT + TOKEN_PAD_PCT}%`,
                        top: `${(ct.coords[0] - 1) * CELL_PCT + TOKEN_PAD_PCT}%`,
                      }}
                    />
                  ))}

                  {/* Game effects (deploy sparkle, home celebration) */}
                  {gameEffects.current.map(ef => {
                    if (ef.type === 'deploy' && ef.coords) {
                      return (
                        <div
                          key={`deploy-${ef.ts}`}
                          className={styles.deployBurst}
                          style={{
                            left: `${(ef.coords[1] - 1) * CELL_PCT}%`,
                            top: `${(ef.coords[0] - 1) * CELL_PCT}%`,
                            color: COLOR_HEX[ef.color],
                          }}
                        />
                      );
                    }
                    if (ef.type === 'home') {
                      return (
                        <div
                          key={`home-${ef.ts}`}
                          className={styles.homeCelebration}
                          style={{ color: COLOR_HEX[ef.color] }}
                        />
                      );
                    }
                    return null;
                  })}

                  {/* Intro animation ghost tokens */}
                  {introPhase === 'running' && TURN_ORDER.map(color => {
                    const pos = introTokenPositions.current.get(color);
                    if (!pos) return null;
                    return (
                      <div
                        key={`intro-${color}`}
                        className={`${styles.token} ${TOKEN_STYLE[color]} ${styles.introToken}`}
                        style={{
                          left: `${(pos[1] - 1) * CELL_PCT + TOKEN_PAD_PCT}%`,
                          top: `${(pos[0] - 1) * CELL_PCT + TOKEN_PAD_PCT}%`,
                        }}
                      />
                    );
                  })}

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
            </div>

            {/* Side panel */}
            <div className={styles.sidePanel}>
              {/* Turn indicator */}
              <div className={styles.turnIndicator}>
                {introPhase === 'running' ? (
                  <span className={styles.introMessage}>Get ready...</span>
                ) : winner ? (
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

              {/* Dice */}
              <div className={styles.sideDice}>
                <button
                  className={[
                    styles.dice,
                    isRolling ? styles.diceRolling : '',
                    diceCanRoll ? styles.diceActive : '',
                  ].filter(Boolean).join(' ')}
                  onClick={handleRollDice}
                  disabled={!isMyTurn || turnPhase !== 'roll' || isRolling || !!winner || introPhase === 'running'}
                  aria-label="Roll dice"
                >
                  {isRolling ? (
                    <DiceFace value={rollingFace} />
                  ) : diceValue && (turnPhase === 'move' || rolledThisTurnRef.current) ? (
                    <span key={diceAnimKeyRef.current} className={styles.diceResult}>
                      <DiceFace value={diceValue} />
                    </span>
                  ) : (
                    <span style={{ fontSize: '1.2rem', fontWeight: 700 }}>🎲</span>
                  )}
                </button>
                {statusHint && (
                  <span className={styles.statusHint}>{statusHint}</span>
                )}
                {showRollReminder && (
                  <span className={styles.rollReminder}>Roll!</span>
                )}
              </div>

              {/* Player bar */}
              <div className={`${styles.playerBar} ${styles.playerBarVertical}`}>
                {TURN_ORDER.slice(0, activePlayerCount).map(color => {
                  const isFinished = finishOrder.includes(color);
                  const isMe = color === myColor;
                  return (
                    <div
                      key={color}
                      className={[
                        styles.playerChip,
                        currentTurn === color && !winner ? styles.playerChipActive : '',
                        isMe ? styles.playerChipMe : '',
                        isFinished ? styles.playerChipFinished : '',
                      ].filter(Boolean).join(' ')}
                      style={isMe ? { color: COLOR_HEX[color] } : undefined}
                    >
                      <span className={styles.playerChipDot} style={{ background: COLOR_HEX[color] }} />
                      {playerNames[color] || COLOR_LABELS[color]}
                      {isMe && <span className={styles.youBadge}>you</span>}
                    </div>
                  );
                })}
              </div>

              {/* Stats table */}
              {gamePhase === 'playing' && (
                <div className={styles.statsTable}>
                  <div className={styles.statsLabel}>Dice Rolls</div>
                  <table>
                    <thead>
                      <tr>
                        <th></th>
                        {[1, 2, 3, 4, 5, 6].map(n => <th key={n}>{n}</th>)}
                        <th title="Captures">{'\u2694'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {TURN_ORDER.slice(0, activePlayerCount).map(color => {
                        const s = gameStats[color] || { rolls: [0, 0, 0, 0, 0, 0], captures: 0 };
                        return (
                          <tr key={color}>
                            <td>
                              <span className={styles.statsColorDot} style={{ background: COLOR_HEX[color] }} />
                            </td>
                            {s.rolls.map((count, i) => (
                              <td key={i} className={count > 0 ? styles.statsNonZero : undefined}>{count}</td>
                            ))}
                            <td className={s.captures > 0 ? styles.statsCapture : undefined}>{s.captures}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Connection error */}
              {error && <div className={styles.errorText}>{error}</div>}

              {/* Spacer */}
              <div className={styles.sideSpacer} />

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

              {/* Controls (non-winner) */}
              {isSpectating && !winner && (
                <div className={styles.controls}>
                  <button className={styles.resetBtn} onClick={handleBackToLobby}>
                    Leave
                  </button>
                </div>
              )}
            </div>

            {/* Game-over overlay (delayed to let animations finish) */}
            {showGameOver && winner && (
              <div className={styles.gameOverOverlay}>
                <div className={styles.gameOverCard}>
                  <div className={styles.gameOverTrophy}>🏆</div>
                  <div className={styles.gameOverTitle}>
                    <span className={styles.gameOverDot} style={{ background: COLOR_HEX[winner] }} />
                    {isSpectating
                      ? `${playerNames[winner] || COLOR_LABELS[winner]} wins!`
                      : winner === myColor
                        ? 'You win!'
                        : `${playerNames[winner] || COLOR_LABELS[winner]} wins!`}
                  </div>
                  {finishOrder.length > 1 && (
                    <div className={styles.gameOverFinishOrder}>
                      {finishOrder.map((c, i) => (
                        <span key={c} className={styles.gameOverPlace}>
                          <span className={styles.gameOverPlaceNum}>{i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : '4th'}</span>
                          <span className={styles.gameOverPlaceDot} style={{ background: COLOR_HEX[c] }} />
                          {playerNames[c] || COLOR_LABELS[c]}
                        </span>
                      ))}
                    </div>
                  )}
                  {!isSpectating && (
                    <div className={styles.gameOverButtons}>
                      <button className={styles.playAgainBtn} onClick={handleNewGame}>
                        Play Again
                      </button>
                      <button className={styles.leaveBtn} onClick={handleBackToLobby}>
                        Leave
                      </button>
                    </div>
                  )}
                  {isSpectating && (
                    <div className={styles.gameOverButtons}>
                      <button className={styles.leaveBtn} onClick={handleBackToLobby}>
                        Leave
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
