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
import {
  POWER_UPS,
  type PowerUpId,
  drawPowerUp,
  deserializeInventory,
  serializeInventory,
  deserializeBoardEffects,
  serializeBoardEffects,
  deserializeBuffs,
  serializeBuffs,
  deserializeCoins,
  serializeCoins,
  addToInventory,
  removeFromInventory,
  discardSlot,
  getInventoryForColor,
  colorIndex,
  tickBuffs,
  hasActiveBuff,
  hasLightningDebuff,
  knockBack,
  findFirstOpponentAhead,
  findNearestOpponentBehind,
  findLeaderLeadToken,
  findNextSafeZone,
  applyStarEffect,
  type BoardEffect,
  colorFromIndex,
  deserializeMysteryBoxes,
  serializeMysteryBoxes,
  collectMysteryBox,
  tickMysteryBoxCooldowns,
  getActiveMysteryBoxCells,
  type MysteryBoxState,
  type ActiveBuff,
} from '../ludoPowerUps';
import { LudoPowerUpPanel, PowerUpDiscardModal, GoldenMushroomModal, BananaPeelPlacer } from './LudoPowerUpPanel';
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
    // Determine shortest direction: forward or backward
    const fwd = target >= cur ? target - cur : TRACK_SIZE - cur + target;
    const bwd = cur >= target ? cur - target : TRACK_SIZE - target + cur;
    if (fwd <= bwd) {
      // Go forward
      while (cur !== target && path.length < TRACK_SIZE) {
        cur = (cur % TRACK_SIZE) + 1;
        path.push(TRACK_COORDS[cur]);
      }
    } else {
      // Go backward (for knockback)
      while (cur !== target && path.length < TRACK_SIZE) {
        cur = cur === 1 ? TRACK_SIZE : cur - 1;
        path.push(TRACK_COORDS[cur]);
      }
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
    if (toN > fromN) {
      for (let i = fromN + 1; i <= toN; i++) path.push(FINAL_COORDS[color][i - 1]);
    } else {
      for (let i = fromN - 1; i >= toN; i--) path.push(FINAL_COORDS[color][i - 1]);
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
  // For doubled values (Super Mushroom: 7-12), show the number with a mushroom boost indicator
  if (value > 6) {
    return (
      <div className={styles.diceFace} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
        <span style={{ fontSize: '1.3rem', fontWeight: 800, color: '#e4521b', lineHeight: 1 }}>{value}</span>
        <span style={{ fontSize: '0.45rem', color: '#e4521b', fontWeight: 600 }}>{'🍄'}x2</span>
      </div>
    );
  }
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
  const gameEffects = useRef<{ type: 'deploy' | 'home' | 'starPoof'; color: LudoColor; coords?: [number, number]; ts: number }[]>([]);
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

  // Mario Mode power-up state
  const [marioMode, setMarioMode] = useState(false);
  const [powerUpsEnabled, setPowerUpsEnabled] = useState(false);
  const [inventory, setInventory] = useState<(PowerUpId | null)[][]>(() =>
    [[null], [null], [null], [null]]
  );
  const [boardEffects, setBoardEffects] = useState<BoardEffect[]>([]);
  const [activeBuffs, setActiveBuffs] = useState<ActiveBuff[]>([]);
  const [coins, setCoins] = useState<number[]>([0, 0, 0, 0]);
  const [mysteryBoxes, setMysteryBoxes] = useState<MysteryBoxState[]>([]);
  const [pendingDiscard, setPendingDiscard] = useState<PowerUpId | null>(null);
  const [goldenMushroomRolls, setGoldenMushroomRolls] = useState<[number, number, number] | null>(null);
  const [placingBanana, setPlacingBanana] = useState(false);
  const [activePowerUp, setActivePowerUp] = useState<{ id: PowerUpId; slot: number } | null>(null);

  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;
  const boardEffectsRef = useRef(boardEffects);
  boardEffectsRef.current = boardEffects;
  const activeBuffsRef = useRef(activeBuffs);
  activeBuffsRef.current = activeBuffs;
  const coinsRef = useRef(coins);
  coinsRef.current = coins;
  const powerUpsEnabledRef = useRef(powerUpsEnabled);
  powerUpsEnabledRef.current = powerUpsEnabled;
  const mysteryBoxesRef = useRef(mysteryBoxes);
  mysteryBoxesRef.current = mysteryBoxes;
  const activePowerUpRef = useRef(activePowerUp);
  activePowerUpRef.current = activePowerUp;
  const goldenMushroomRef = useRef(goldenMushroomRolls);
  goldenMushroomRef.current = goldenMushroomRolls;
  const placingBananaRef = useRef(placingBanana);
  placingBananaRef.current = placingBanana;
  const pendingDiscardRef = useRef(pendingDiscard);
  pendingDiscardRef.current = pendingDiscard;

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

      // Clear active power-up when turn changes
      if (state.currentTurn !== currentTurnRef.current) {
        setActivePowerUp(null);
      }

      setTokens(parsedTokens);
      setCurrentTurn(state.currentTurn);
      setTurnPhase(state.turnPhase);
      setDiceValue(state.diceValue);
      setConsecutiveSixes(state.consecutiveSixes);
      setActivePlayerCount(state.playerCount);
      turnStartedAtRef.current = state.turnStartedAt;

      // Mario Mode state
      if (state.powerUpsEnabled) {
        setPowerUpsEnabled(true);
        if (state.powerUps) setInventory(deserializeInventory(state.powerUps));
        if (state.boardEffects !== undefined) setBoardEffects(deserializeBoardEffects(state.boardEffects));
        if (state.activeBuffs !== undefined) setActiveBuffs(deserializeBuffs(state.activeBuffs));
        if (state.coins) setCoins(deserializeCoins(state.coins));
        if (state.mysteryBoxes) setMysteryBoxes(deserializeMysteryBoxes(state.mysteryBoxes));
      }

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
    roll: number,
    capeActive = false
  ) => {
    const gc = gameCodeRef.current;
    if (!gc) return;

    const currentTokens = tokensRef.current;
    const curColor = currentTurnRef.current;
    const curSixes = consecutiveSixesRef.current;
    const curFinishOrder = finishOrderRef.current;
    const curPlayerCount = activePlayerCountRef.current;

    let { newTokens, captured, reachedHome } = applyMove(currentTokens, tokenIndex, newPosition);

    // Cape Feather: undo any captures that just happened
    if (capeActive && captured) {
      // Restore captured tokens — re-run without capture
      newTokens = [...currentTokens] as TokenPosition[];
      newTokens[tokenIndex] = newPosition;
      captured = false;
    }

    // Drop items when a token is captured — find who was captured and clear their inventory
    if (powerUpsEnabledRef.current && captured) {
      const moverColor = getTokenColor(tokenIndex);
      for (let i = 0; i < TOTAL_TOKENS; i++) {
        if (i === tokenIndex) continue;
        if (getTokenColor(i) === moverColor) continue;
        // If this token just went to base (was captured)
        if (newTokens[i] === 'base' && currentTokens[i] !== 'base') {
          const victimColor = getTokenColor(i);
          const ci = colorIndex(victimColor);
          const inv = inventoryRef.current;
          if (inv[ci][0] !== null) {
            // Clear victim's inventory
            const clearedInv = inv.map((slots, idx) =>
              idx === ci ? [null] as (PowerUpId | null)[] : [...slots]
            );
            inventoryRef.current = clearedInv;
            setInventory(clearedInv);
          }
        }
      }
    }

    // Auto-deploy banked coins: if a captured player has 3+ coins, redeploy their token immediately
    if (powerUpsEnabledRef.current && captured) {
      const updCoins = [...coinsRef.current];
      for (let i = 0; i < TOTAL_TOKENS; i++) {
        if (newTokens[i] === 'base' && currentTokens[i] !== 'base') {
          const victColor = getTokenColor(i);
          const vci = colorIndex(victColor);
          if (updCoins[vci] >= 3) {
            updCoins[vci] = 0;
            const startPos: TokenPosition = `track-${START_POSITIONS[victColor]}`;
            newTokens[i] = startPos;
            showHint(`${COLOR_LABELS[victColor]} auto-deployed with banked coins!`);
          }
        }
      }
      coinsRef.current = updCoins;
    }

    // Star buff: send anyone passed back to their start
    if (powerUpsEnabledRef.current) {
      const curBuffs = activeBuffsRef.current;
      const ci = colorIndex(curColor);
      if (hasActiveBuff(curBuffs, ci, 'star') && newPosition.startsWith('track-')) {
        const oldPos = currentTokens[tokenIndex];
        if (oldPos.startsWith('track-')) {
          const fromTrack = parseInt(oldPos.split('-')[1]);
          const toTrack = parseInt(newPosition.split('-')[1]);
          const preStarTokens = [...newTokens];
          newTokens = applyStarEffect(newTokens, fromTrack, toTrack, curColor);
          // Spawn poof effects at locations where tokens were teleported
          for (let i = 0; i < TOTAL_TOKENS; i++) {
            if (preStarTokens[i] !== newTokens[i] && preStarTokens[i].startsWith('track-')) {
              const coords = getTokenCoords(preStarTokens[i], i);
              if (coords) {
                const effect = { type: 'starPoof' as const, color: getTokenColor(i), coords, ts: Date.now() };
                gameEffects.current.push(effect);
                const timer = setTimeout(() => {
                  gameEffects.current = gameEffects.current.filter(e => e !== effect);
                  setRenderTick(n => n + 1);
                }, 700);
                effectTimers.current.push(timer);
              }
            }
          }
          setRenderTick(n => n + 1);
          showHint('Star power! Opponents sent to start!');
        }
      }
    }

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

    // --- Mario Mode: post-move effects ---
    let updatedInv = inventoryRef.current;
    let updatedEffects = boardEffectsRef.current;
    let updatedBuffs = activeBuffsRef.current;
    let updatedCoins = [...coinsRef.current];
    let updatedMysteryBoxes = mysteryBoxesRef.current;

    if (powerUpsEnabledRef.current) {
      // Track-specific effects (banana, mystery box)
      if (newPosition.startsWith('track-')) {
        const landedCell = parseInt(newPosition.split('-')[1]);

        // Check for banana peel
        const bananaIdx = updatedEffects.findIndex(e => e.type === 'banana' && e.cell === landedCell);
        if (bananaIdx >= 0) {
          // Slip back 3 spaces
          updatedEffects = updatedEffects.filter((_, i) => i !== bananaIdx);
          newTokens = knockBack(newTokens, tokenIndex, 3);
          showHint('Banana peel! Slipped back 3!');
        }
        // Check for mystery box (only on voluntary moves, not forced)
        else if (getActiveMysteryBoxCells(updatedMysteryBoxes).has(landedCell)) {
          // Collect: set cooldown to 3 rounds
          updatedMysteryBoxes = collectMysteryBox(updatedMysteryBoxes, landedCell);
          const drawnPowerUp = drawPowerUp(newTokens, curColor, curPlayerCount);

          // Coin block: add coin immediately
          if (drawnPowerUp === 'coin-block') {
            const ci = colorIndex(curColor);
            updatedCoins[ci] = (updatedCoins[ci] || 0) + 1;
            if (updatedCoins[ci] >= 3) {
              // Deploy a token from base to start position for free
              const myIndices = getColorTokenIndices(curColor);
              const baseToken = myIndices.find(i => newTokens[i] === 'base');
              if (baseToken !== undefined) {
                updatedCoins[ci] = 0;
                const startPos: TokenPosition = `track-${START_POSITIONS[curColor]}`;
                newTokens[baseToken] = startPos;
                showHint('3 coins! Free deploy!');
              } else {
                // Bank coins — keep at 3 until a token goes back to base
                showHint('3 coins banked! Auto-deploy when a token returns to base');
              }
            } else {
              showHint(`Coin! (${updatedCoins[ci]}/3)`);
            }
          } else {
            // Try to add to inventory
            const { inventory: newInv, added } = addToInventory(updatedInv, curColor, drawnPowerUp);
            if (added) {
              updatedInv = newInv;
              showHint(`Got ${POWER_UPS[drawnPowerUp].emoji} ${POWER_UPS[drawnPowerUp].name}!`);
            } else {
              // Inventory full — trigger discard modal for the current player
              setPendingDiscard(drawnPowerUp);
            }
          }
        }
      }

      // Always tick buffs (even on corridor moves)
      updatedBuffs = tickBuffs(updatedBuffs, colorIndex(curColor));

      // Tick mystery box cooldowns only once per full round (when turn wraps to first player)
      const activePlayers = TURN_ORDER.slice(0, curPlayerCount);
      if (nextColor === activePlayers[0]) {
        updatedMysteryBoxes = tickMysteryBoxCooldowns(updatedMysteryBoxes);
      }
    }

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

    // Attach power-up state if enabled
    if (powerUpsEnabledRef.current) {
      update.powerUps = serializeInventory(updatedInv);
      update.boardEffects = serializeBoardEffects(updatedEffects);
      update.activeBuffs = serializeBuffs(updatedBuffs);
      update.coins = serializeCoins(updatedCoins);
      update.mysteryBoxes = serializeMysteryBoxes(updatedMysteryBoxes);
    }

    try {
      await makeMove(gc, curColor, update);
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

    // Super Mushroom: double the roll
    if (powerUpsEnabledRef.current && activePowerUpRef.current?.id === 'super-mushroom') {
      roll = Math.min(roll * 2, 12);
      setActivePowerUp(null);
    }

    // Lightning debuff: halve the roll
    if (powerUpsEnabledRef.current) {
      const ci = colorIndex(mc);
      if (hasLightningDebuff(activeBuffsRef.current, ci)) {
        roll = Math.max(1, Math.floor(roll / 2));
        showHint('Lightning! Half speed!');
      }
    }

    // Golden Mushroom: show pick modal instead of proceeding
    if (powerUpsEnabledRef.current && activePowerUpRef.current?.id === 'golden-mushroom') {
      const r1 = roll;
      // Apply lightning debuff to alt rolls too for fairness
      const ci2 = colorIndex(mc);
      const isLightning = hasLightningDebuff(activeBuffsRef.current, ci2);
      let r2 = Math.floor(Math.random() * 6) + 1;
      let r3 = Math.floor(Math.random() * 6) + 1;
      if (isLightning) {
        r2 = Math.max(1, Math.floor(r2 / 2));
        r3 = Math.max(1, Math.floor(r3 / 2));
      }
      setActivePowerUp(null);
      // Show modal after rolling animation
      rollTimeoutRef.current = setTimeout(() => {
        setIsRolling(false);
        isRollingRef.current = false;
        moveInFlightRef.current = false; // Allow interaction with modal
        setGoldenMushroomRolls([r1, r2, r3]);
      }, 800);
      return;
    }

    // Bullet Bill: skip normal move, rocket forward 10
    if (powerUpsEnabledRef.current && activePowerUpRef.current?.id === 'bullet-bill') {
      setActivePowerUp(null);
      rollTimeoutRef.current = setTimeout(async () => {
        setIsRolling(false);
        isRollingRef.current = false;
        setDiceValue(10);
        diceAnimKeyRef.current += 1;
        rolledThisTurnRef.current = true;

        // Find the best token on the track to rocket
        const currentTokens = tokensRef.current;
        const myIndices2 = getColorTokenIndices(mc);
        let bestToken: number | null = null;
        for (const i of myIndices2) {
          if (currentTokens[i].startsWith('track-')) {
            bestToken = i;
            break;
          }
        }
        if (bestToken !== null) {
          const newPos = calculateNewPosition(currentTokens[bestToken], 10, mc);
          if (newPos) {
            showHint('Bullet Bill! Rocket forward!');
            executeMove(bestToken, newPos, 10);
            return;
          }
        }
        // Fallback: if no token on track, use original roll as normal dice
        showHint('No token on track — normal roll instead');
        setDiceValue(roll);
        diceAnimKeyRef.current += 1;
        rolledThisTurnRef.current = true;
        // Fall through to normal move logic
        const moves2 = getValidMoves(currentTokens, mc, roll);
        if (moves2.length === 0) {
          const finishedColors2 = getFinishedColors(currentTokens, activePlayerCountRef.current);
          const nextColor2 = findNextActivePlayer(mc, activePlayerCountRef.current, finishedColors2);
          const update2: LudoMoveUpdate = {
            tokens: serializeTokens(currentTokens),
            currentTurn: nextColor2,
            turnPhase: 'roll',
            diceValue: roll,
            consecutiveSixes: 0,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: Date.now(),
          };
          makeMove(gc, mc, update2).catch(() => { moveInFlightRef.current = false; });
        } else if (moves2.length === 1) {
          executeMove(moves2[0].tokenIndex, moves2[0].newPosition, roll);
        } else {
          setValidMoves(new Map(moves2.map(m => [m.tokenIndex, m.newPosition])));
          moveInFlightRef.current = false;
        }
      }, 800);
      return;
    }

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
          const capeOn = powerUpsEnabledRef.current && hasActiveBuff(activeBuffsRef.current, colorIndex(curColor), 'cape');
          executeMove(m.tokenIndex, m.newPosition, roll, capeOn);
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
      try { await makeMove(gc, curColor, update); } catch { moveInFlightRef.current = false; }
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
    // Check for cape feather buff
    const capeActive = powerUpsEnabledRef.current && hasActiveBuff(activeBuffsRef.current, colorIndex(mc), 'cape');
    executeMove(move.tokenIndex, move.newPosition, dice, capeActive);
  }, [executeMove]);

  // --- Power-up usage handler ---
  const handleUsePowerUp = useCallback((slot: number, powerUpId: PowerUpId) => {
    const mc = myColorRef.current;
    if (!mc || !powerUpsEnabledRef.current) return;

    const def = POWER_UPS[powerUpId];
    if (!def) return;

    // Remove from inventory immediately
    const newInv = removeFromInventory(inventoryRef.current, mc, slot);

    if (def.timing === 'before-roll') {
      // These activate on the next roll
      if (powerUpId === 'star') {
        // Add star buff for 2 turns
        const newBuffs = [...activeBuffsRef.current, { type: 'star' as const, playerColorIdx: colorIndex(mc), duration: 2 }];
        // Write to firebase
        const gc = gameCodeRef.current;
        if (gc) {
          makeMove(gc, mc, {
            tokens: serializeTokens(tokensRef.current),
            currentTurn: mc,
            turnPhase: 'roll',
            diceValue: null,
            consecutiveSixes: consecutiveSixesRef.current,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: turnStartedAtRef.current,
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(newBuffs),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
          });
        }
        showHint('Star activated! Send opponents to start!');
        return;
      }

      if (powerUpId === 'lightning-bolt') {
        // Add lightning debuff to all opponents
        const newBuffs = [...activeBuffsRef.current];
        const activePlayers = TURN_ORDER.slice(0, activePlayerCountRef.current);
        for (const c of activePlayers) {
          if (c !== mc) {
            newBuffs.push({ type: 'lightning' as const, playerColorIdx: colorIndex(c), duration: 2 });
          }
        }
        const gc = gameCodeRef.current;
        if (gc) {
          makeMove(gc, mc, {
            tokens: serializeTokens(tokensRef.current),
            currentTurn: mc,
            turnPhase: 'roll',
            diceValue: null,
            consecutiveSixes: consecutiveSixesRef.current,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: turnStartedAtRef.current,
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(newBuffs),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
          });
        }
        showHint('Lightning! Opponents slowed!');
        return;
      }

      // Super Mushroom, Golden Mushroom, Bullet Bill — set active for the next roll
      setActivePowerUp({ id: powerUpId, slot });
      // Write inventory change
      const gc = gameCodeRef.current;
      if (gc) {
        makeMove(gc, mc, {
          tokens: serializeTokens(tokensRef.current),
          currentTurn: mc,
          turnPhase: 'roll',
          diceValue: null,
          consecutiveSixes: consecutiveSixesRef.current,
          winner: null,
          finishOrder: finishOrderRef.current.join(','),
          turnStartedAt: turnStartedAtRef.current,
          powerUps: serializeInventory(newInv),
          activeBuffs: serializeBuffs(activeBuffsRef.current),
          boardEffects: serializeBoardEffects(boardEffectsRef.current),
          coins: serializeCoins(coinsRef.current),
        });
      }
      showHint(`${def.emoji} ${def.name} ready!`);
      return;
    }

    if (def.timing === 'after-roll') {
      const currentTokens = tokensRef.current;

      if (powerUpId === 'green-shell' || powerUpId === 'red-shell') {
        // Find shooter's token on track
        const myIndices = getColorTokenIndices(mc);
        let shooterTrack: number | null = null;
        for (const i of myIndices) {
          if (currentTokens[i].startsWith('track-')) {
            shooterTrack = parseInt(currentTokens[i].split('-')[1]);
            break;
          }
        }
        if (shooterTrack === null) {
          showHint('No tokens on track to shoot from!');
          return;
        }

        const target = powerUpId === 'green-shell'
          ? findFirstOpponentAhead(currentTokens, shooterTrack, mc)
          : findNearestOpponentBehind(currentTokens, shooterTrack, mc);

        if (target === null) {
          showHint('No target found!');
          return;
        }

        const newTokens = knockBack(currentTokens, target, 3);
        const gc = gameCodeRef.current;
        if (gc) {
          makeMove(gc, mc, {
            tokens: serializeTokens(newTokens),
            currentTurn: mc,
            turnPhase: turnPhaseRef.current,
            diceValue: diceValueRef.current,
            consecutiveSixes: consecutiveSixesRef.current,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: turnStartedAtRef.current,
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(activeBuffsRef.current),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
          });
        }
        showHint(`${def.emoji} Hit! Knocked back 3!`);
        return;
      }

      if (powerUpId === 'blue-shell') {
        const target = findLeaderLeadToken(currentTokens, activePlayerCountRef.current, mc);
        if (target === null) {
          showHint('No leader to target!');
          return;
        }
        const newTokens = knockBack(currentTokens, target, 5);
        const gc = gameCodeRef.current;
        if (gc) {
          makeMove(gc, mc, {
            tokens: serializeTokens(newTokens),
            currentTurn: mc,
            turnPhase: turnPhaseRef.current,
            diceValue: diceValueRef.current,
            consecutiveSixes: consecutiveSixesRef.current,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: turnStartedAtRef.current,
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(activeBuffsRef.current),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
          });
        }
        showHint('Blue Shell! Leader knocked back 5!');
        return;
      }

      if (powerUpId === 'warp-pipe') {
        // Find the best token on track and warp it
        const myIndices = getColorTokenIndices(mc);
        let bestToken: number | null = null;
        for (const i of myIndices) {
          if (currentTokens[i].startsWith('track-')) {
            bestToken = i;
            break;
          }
        }
        if (bestToken === null) {
          showHint('No tokens on track!');
          return;
        }
        const trackPos = parseInt(currentTokens[bestToken].split('-')[1]);
        const safeZone = findNextSafeZone(trackPos, mc);
        const newTokens = [...currentTokens] as TokenPosition[];
        newTokens[bestToken] = `track-${safeZone}`;
        const gc = gameCodeRef.current;
        if (gc) {
          makeMove(gc, mc, {
            tokens: serializeTokens(newTokens),
            currentTurn: mc,
            turnPhase: turnPhaseRef.current,
            diceValue: diceValueRef.current,
            consecutiveSixes: consecutiveSixesRef.current,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: turnStartedAtRef.current,
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(activeBuffsRef.current),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
          });
        }
        showHint('Warp Pipe! Teleported to safe zone!');
        return;
      }

      if (powerUpId === 'cape-feather') {
        // Set cape active — will be used in the next move execution
        const newBuffs = [...activeBuffsRef.current, { type: 'cape' as const, playerColorIdx: colorIndex(mc), duration: 1 }];
        const gc = gameCodeRef.current;
        if (gc) {
          makeMove(gc, mc, {
            tokens: serializeTokens(currentTokens),
            currentTurn: mc,
            turnPhase: turnPhaseRef.current,
            diceValue: diceValueRef.current,
            consecutiveSixes: consecutiveSixesRef.current,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: turnStartedAtRef.current,
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(newBuffs),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
          });
        }
        showHint('Cape Feather! Fly over opponents!');
        return;
      }

      if (powerUpId === 'banana-peel') {
        // Auto-place banana on the player's current token position
        const myIndices = getColorTokenIndices(mc);
        let placedCell: number | null = null;
        for (const i of myIndices) {
          if (currentTokens[i].startsWith('track-')) {
            placedCell = parseInt(currentTokens[i].split('-')[1]);
            break;
          }
        }
        if (placedCell === null || SAFE_ZONES.has(placedCell)) {
          showHint("Can't place banana here!");
          return;
        }

        const newEffects = [...boardEffectsRef.current, { type: 'banana' as const, cell: placedCell, ownerColorIdx: colorIndex(mc) }];
        const gc = gameCodeRef.current;
        if (gc) {
          makeMove(gc, mc, {
            tokens: serializeTokens(currentTokens),
            currentTurn: mc,
            turnPhase: turnPhaseRef.current,
            diceValue: diceValueRef.current,
            consecutiveSixes: consecutiveSixesRef.current,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: turnStartedAtRef.current,
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(activeBuffsRef.current),
            boardEffects: serializeBoardEffects(newEffects),
            coins: serializeCoins(coinsRef.current),
          });
        }
        showHint(`Banana peel placed on cell ${placedCell}!`);
        return;
      }
    }
  }, [showHint, executeMove]);

  // Golden Mushroom pick handler
  const handleGoldenMushroomPick = useCallback((pickedRoll: number) => {
    setGoldenMushroomRolls(null);
    setDiceValue(pickedRoll);
    diceAnimKeyRef.current += 1;
    rolledThisTurnRef.current = true;

    const gc = gameCodeRef.current;
    const mc = myColorRef.current;
    if (!gc || !mc) return;

    const currentTokens = tokensRef.current;
    const curColor = currentTurnRef.current;
    const curSixes = consecutiveSixesRef.current;
    const curFinishOrder = finishOrderRef.current;
    const curPlayerCount = activePlayerCountRef.current;
    const finishedColors = getFinishedColors(currentTokens, curPlayerCount);

    const moves = getValidMoves(currentTokens, curColor, pickedRoll);

    if (moves.length === 0) {
      const nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
      showHint('No valid moves');
      const update: LudoMoveUpdate = {
        tokens: serializeTokens(currentTokens),
        currentTurn: nextColor,
        turnPhase: 'roll',
        diceValue: pickedRoll,
        consecutiveSixes: 0,
        winner: null,
        finishOrder: curFinishOrder.join(','),
        turnStartedAt: Date.now(),
        powerUps: serializeInventory(inventoryRef.current),
        activeBuffs: serializeBuffs(activeBuffsRef.current),
        boardEffects: serializeBoardEffects(boardEffectsRef.current),
        coins: serializeCoins(coinsRef.current),
      };
      makeMove(gc, mc, update).catch(() => { moveInFlightRef.current = false; });
      return;
    }

    if (moves.length === 1) {
      const m = moves[0];
      autoMoveRef.current = setTimeout(() => {
        const mc2 = myColorRef.current;
        const capeOn = mc2 && powerUpsEnabledRef.current && hasActiveBuff(activeBuffsRef.current, colorIndex(mc2), 'cape');
        executeMove(m.tokenIndex, m.newPosition, pickedRoll, !!capeOn);
      }, 400);
      return;
    }

    setValidMoves(new Map(moves.map(m => [m.tokenIndex, m.newPosition])));
    const update: LudoMoveUpdate = {
      tokens: serializeTokens(currentTokens),
      currentTurn: curColor,
      turnPhase: 'move',
      diceValue: pickedRoll,
      consecutiveSixes: curSixes,
      winner: null,
      finishOrder: curFinishOrder.join(','),
      turnStartedAt: Date.now(),
      powerUps: serializeInventory(inventoryRef.current),
      activeBuffs: serializeBuffs(activeBuffsRef.current),
      boardEffects: serializeBoardEffects(boardEffectsRef.current),
      coins: serializeCoins(coinsRef.current),
    };
    makeMove(gc, curColor, update).catch(() => { moveInFlightRef.current = false; });
  }, [executeMove, showHint]);

  // Banana peel placement handler
  const handleBananaPlace = useCallback((cell: number) => {
    setPlacingBanana(false);
    const mc = myColorRef.current;
    const gc = gameCodeRef.current;
    if (!mc || !gc) return;

    // Validate: don't place on safe zones or start positions
    if (SAFE_ZONES.has(cell)) {
      showHint("Can't place on a safe zone!");
      setActivePowerUp(null);
      return;
    }

    const newEffects = [...boardEffectsRef.current, { type: 'banana' as const, cell, ownerColorIdx: colorIndex(mc) }];
    const newInv = removeFromInventory(inventoryRef.current, mc, activePowerUpRef.current?.slot ?? 0);
    setActivePowerUp(null);

    makeMove(gc, mc, {
      tokens: serializeTokens(tokensRef.current),
      currentTurn: mc,
      turnPhase: turnPhaseRef.current,
      diceValue: diceValueRef.current,
      consecutiveSixes: consecutiveSixesRef.current,
      winner: null,
      finishOrder: finishOrderRef.current.join(','),
      turnStartedAt: turnStartedAtRef.current,
      powerUps: serializeInventory(newInv),
      activeBuffs: serializeBuffs(activeBuffsRef.current),
      boardEffects: serializeBoardEffects(newEffects),
      coins: serializeCoins(coinsRef.current),
    }).catch(() => {});
    showHint('Banana peel placed!');
  }, [showHint]);

  // Discard handler for full inventory
  // Uses direct Firebase update (not makeMove) since the turn may have already advanced
  const handleDiscard = useCallback(async (slot: number) => {
    const mc = myColorRef.current;
    if (!mc || !pendingDiscard) return;
    const newInv = discardSlot(inventoryRef.current, mc, slot, pendingDiscard);
    setPendingDiscard(null);
    showHint(`Got ${POWER_UPS[pendingDiscard].emoji} ${POWER_UPS[pendingDiscard].name}!`);

    // Write just the powerUps field directly — this is safe because only inventory changes
    const gc = gameCodeRef.current;
    if (gc) {
      try {
        const { ensureInitialized, getDbModule, getFirebaseDatabase } = await import('../firebase');
        await ensureInitialized();
        const { ref, update } = getDbModule();
        const db = getFirebaseDatabase();
        const gameRef = ref(db, `ludo/${gc}`);
        await update(gameRef, { powerUps: serializeInventory(newInv) });
      } catch {
        // Silent failure — inventory will sync on next state update
      }
    }
  }, [pendingDiscard, showHint]);

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
      // Don't auto-act while power-up modals are open
      const hasModalOpen = !!goldenMushroomRef.current || placingBananaRef.current || !!pendingDiscardRef.current;
      if (
        remaining <= 0 &&
        isCurrentPlayer &&
        !moveInFlightRef.current &&
        !isRollingRef.current &&
        !hasModalOpen
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
              const timerCape = powerUpsEnabledRef.current && myColorRef.current && hasActiveBuff(activeBuffsRef.current, colorIndex(myColorRef.current), 'cape');
              executeMoveRef.current(randomMove.tokenIndex, randomMove.newPosition, dice, !!timerCape);
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
      const code = await createGame(sessionId, userName, playerCount, marioMode);
      setGameCode(code);
      setMyColor('red');
      setGamePhase('waiting');
      prevTokensRef.current = 'bas'.repeat(16);
    } catch {
      setError('Failed to create game. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, userName, playerCount, marioMode]);

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
      // Reset power-up state
      setInventory([[null], [null], [null], [null]]);
      setBoardEffects([]);
      setActiveBuffs([]);
      setCoins([0, 0, 0, 0]);
      setPendingDiscard(null);
      setGoldenMushroomRolls(null);
      setPlacingBanana(false);
      setActivePowerUp(null);
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
    // Reset power-up state
    setPowerUpsEnabled(false);
    setInventory([[null], [null], [null], [null]]);
    setBoardEffects([]);
    setActiveBuffs([]);
    setCoins([0, 0, 0, 0]);
    setPendingDiscard(null);
    setGoldenMushroomRolls(null);
    setPlacingBanana(false);
    setActivePowerUp(null);
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
    const activeMysteryBoxes = powerUpsEnabled ? getActiveMysteryBoxCells(mysteryBoxes) : new Set<number>();
    const isMysteryBox = activeMysteryBoxes.has(cellNum);
    const hasBanana = powerUpsEnabled && boardEffects.some(e => e.type === 'banana' && e.cell === cellNum);

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
      isMysteryBox ? styles.mysteryBox : '',
      startColor ? styles.checkeredStart : '',
    ].filter(Boolean).join(' ');

    return (
      <div
        key={`track-${cellNum}`}
        className={classes}
        style={{ gridRow: row, gridColumn: col }}
      >
        {hasBanana && <span className={styles.bananaOverlay}>{'🍌'}</span>}
      </div>
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
              className={`${styles.marioModeBtn} ${marioMode ? styles.marioModeBtnActive : ''}`}
              onClick={() => setMarioMode(!marioMode)}
            >
              {/* Mario-inspired M logo — red M shape */}
              <svg className={styles.marioModeIcon} viewBox="0 0 24 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 18V6L7 2L12 10L17 2L22 6V18" stroke={marioMode ? '#fff' : '#e4521b'} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </svg>
              <span>Power-Up Mode</span>
              {marioMode && (
                <span className={styles.marioModeCheck}>
                  <svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 6L5 9L10 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
                </span>
              )}
            </button>
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
                    if (ef.type === 'starPoof' && ef.coords) {
                      return (
                        <div
                          key={`poof-${ef.ts}-${ef.color}`}
                          className={styles.starPoof}
                          style={{
                            left: `${(ef.coords[1] - 1) * CELL_PCT}%`,
                            top: `${(ef.coords[0] - 1) * CELL_PCT}%`,
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

              {/* Power-up inventory (Mario Mode) — below stats */}
              {powerUpsEnabled && myColor && !isSpectating && (
                <LudoPowerUpPanel
                  inventory={getInventoryForColor(inventory, myColor)}
                  canUseBefore={isMyTurn && (turnPhase === 'roll' || turnPhase === 'move') && !isRolling && !winner && introPhase !== 'running' && !gamePaused}
                  canUseAfter={isMyTurn && (turnPhase === 'roll' || turnPhase === 'move') && !isRolling && !winner && introPhase !== 'running' && !gamePaused}
                  onUse={handleUsePowerUp}
                  coins={myColor ? coins[colorIndex(myColor)] : 0}
                  isMyTurn={isMyTurn}
                />
              )}

              {/* Active buff indicators */}
              {powerUpsEnabled && activeBuffs.length > 0 && (
                <div className={styles.activeBuffsBar}>
                  {activeBuffs.map((buff, i) => {
                    const buffColor = colorFromIndex(buff.playerColorIdx);
                    return (
                      <span key={i} className={styles.buffIndicator}>
                        <span className={styles.buffPlayerDot} style={{ background: COLOR_HEX[buffColor] }} />
                        {buff.type === 'star' ? '⭐' : buff.type === 'lightning' ? '⚡' : '🪶'}
                        <span className={styles.buffDuration}>{buff.duration}</span>
                      </span>
                    );
                  })}
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

        {/* Power-up modals */}
        {pendingDiscard && myColor && (
          <PowerUpDiscardModal
            inventory={getInventoryForColor(inventory, myColor)}
            newPowerUp={pendingDiscard}
            onDiscard={handleDiscard}
            onKeep={() => setPendingDiscard(null)}
          />
        )}
        {goldenMushroomRolls && (
          <GoldenMushroomModal
            rolls={goldenMushroomRolls}
            onPick={handleGoldenMushroomPick}
          />
        )}
        {placingBanana && (
          <BananaPeelPlacer
            onPlace={handleBananaPlace}
            onCancel={() => { setPlacingBanana(false); setActivePowerUp(null); }}
          />
        )}
      </div>
    </div>
  );
}
