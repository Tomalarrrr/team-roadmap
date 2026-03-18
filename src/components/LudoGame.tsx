import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  createGame,
  joinGame,
  spectateGame,
  subscribeToGame,
  makeMove,
  resetGame,
  toggleGamePause,
  addBot,
  removeBot,
  startGame,
  serializeTokens,
  deserializeTokens,
  type LudoColor,
  type LudoGameState,
  type LudoMoveUpdate,
  type TokenPosition,
  type TurnPhase,
  getServerTimestamp,
  requestDiceRoll,
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
  captureAfterKnockback,
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
  type FlagState,
  deserializeFlag,
  serializeFlag,
  TRACK_SIZE,
  START_POSITIONS,
  ENTRY_CELLS,
  SAFE_ZONES,
  getTokenColor,
  getColorTokenIndices,
  getPlayerScore,
  getLeaderColor,
  isEffectiveSix,
  findFurthestTrackToken,
  type RollStats,
  deserializeRollStats,
  serializeRollStats,
  recordRoll,
  recordCapture,
  initRollStats,
} from '../ludoPowerUps';
import {
  calculateNewPosition,
  getValidMoves,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  findNextActivePlayer,
  getNextTurn,
  scoreBotMove,
} from '../ludoGameLogic';
import { LudoPowerUpPanel, PowerUpDiscardModal, GoldenMushroomModal } from './LudoPowerUpPanel';
import styles from './LudoGame.module.css';

// --- Constants (TRACK_SIZE, START_POSITIONS, ENTRY_CELLS, SAFE_ZONES imported from ludoPowerUps) ---

const TOKENS_PER_PLAYER = 4;
const TOTAL_TOKENS = 16;
const TURN_SECONDS = 30;

const TURN_ORDER: LudoColor[] = ['red', 'green', 'yellow', 'blue'];

// Track cell → [gridRow, gridCol] (1-indexed for CSS grid)
// 56 cells: 4 arms × 13 cells + 4 corner cells at arm junctions
const TRACK_COORDS: Record<number, [number, number]> = {
  // Left arm top row → right (red start)
  1: [7, 2],   2: [7, 3],   3: [7, 4],   4: [7, 5],   5: [7, 6],
  // Top-left corner (L-turn: right → up)
  6: [7, 7],
  // Top arm left col → up
  7: [6, 7],   8: [5, 7],   9: [4, 7],   10: [3, 7],  11: [2, 7],  12: [1, 7],
  // Top arm top row → right
  13: [1, 8],  14: [1, 9],
  // Top arm right col → down (green start)
  15: [2, 9],  16: [3, 9],  17: [4, 9],  18: [5, 9],  19: [6, 9],
  // Top-right corner (L-turn: down → right)
  20: [7, 9],
  // Right arm top row → right
  21: [7, 10], 22: [7, 11], 23: [7, 12], 24: [7, 13], 25: [7, 14], 26: [7, 15],
  // Right arm right col → down
  27: [8, 15], 28: [9, 15],
  // Right arm bottom row → left (yellow start)
  29: [9, 14], 30: [9, 13], 31: [9, 12], 32: [9, 11], 33: [9, 10],
  // Bottom-right corner (L-turn: left → down)
  34: [9, 9],
  // Bottom arm right col → down
  35: [10, 9], 36: [11, 9], 37: [12, 9], 38: [13, 9], 39: [14, 9], 40: [15, 9],
  // Bottom arm bottom row → left
  41: [15, 8], 42: [15, 7],
  // Bottom arm left col → up (blue start)
  43: [14, 7], 44: [13, 7], 45: [12, 7], 46: [11, 7], 47: [10, 7],
  // Bottom-left corner (L-turn: up → left)
  48: [9, 7],
  // Left arm bottom row → left
  49: [9, 6],  50: [9, 5],  51: [9, 4],  52: [9, 3],  53: [9, 2],  54: [9, 1],
  // Left arm left col → up
  55: [8, 1],  56: [7, 1],
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
  1: 'red', 15: 'green', 29: 'yellow', 43: 'blue',
};

const ENTRY_ARROW_COLORS: Record<number, LudoColor> = {
  55: 'red', 13: 'green', 27: 'yellow', 41: 'blue',
};

const COLOR_LABELS: Record<LudoColor, string> = {
  red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue',
};

const COLOR_HEX: Record<LudoColor, string> = {
  red: '#ea4330', green: '#34a853', yellow: '#fbbc05', blue: '#4285f4',
};

const MARIO_NAMES: Record<LudoColor, string> = {
  red: 'Mario', green: 'Luigi', yellow: 'Peach', blue: 'Toad',
};

// Absolute-positioning constants (percentages of board size)
const CELL_PCT = 100 / 15;
const TOKEN_PAD_PCT = CELL_PCT * 0.15;
const STEP_MS = 200;
const BACKUP_GRACE = 15;

// Pre-allocated index arrays (avoid Array.from in render)
const TRACK_INDICES = Array.from({ length: TRACK_SIZE }, (_, i) => i + 1);
const TOKEN_INDICES = Array.from({ length: TOTAL_TOKENS }, (_, i) => i);

// --- Pure game logic (getTokenColor, getColorTokenIndices imported from ludoPowerUps) ---

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

  // Base → track: animate from base through start cell to destination
  // (handles batched Firebase updates where deploy + bonus move merge)
  if (from === 'base' && to.startsWith('track-')) {
    const trackNum = parseInt(to.split('-')[1]);
    const startCell = START_POSITIONS[color];
    // If destination IS the start cell, just animate there directly
    if (trackNum === startCell) return [TRACK_COORDS[trackNum]];
    // Otherwise, walk from start cell forward to the destination
    const path: [number, number][] = [TRACK_COORDS[startCell]];
    let cur = startCell;
    while (cur !== trackNum && path.length < TRACK_SIZE) {
      cur = (cur % TRACK_SIZE) + 1;
      path.push(TRACK_COORDS[cur]);
    }
    return path;
  }
  // Base → final: animate through start cell and track to home corridor
  if (from === 'base' && to.startsWith('final-')) {
    const startCell = START_POSITIONS[color];
    const entry = ENTRY_CELLS[color];
    const path: [number, number][] = [TRACK_COORDS[startCell]];
    let cur = startCell;
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
  let sessionId = 'anonymous';
  let userName = 'Player';
  try {
    sessionId = sessionStorage.getItem('roadmap-user-id') || 'anonymous';
    userName = sessionStorage.getItem('roadmap-user-name') || 'Player';
  } catch {
    // sessionStorage blocked (private browsing) — use defaults
  }

  // Per-game pause state (synced via Firebase game subscription)
  const [gamePaused, setGamePaused] = useState(false);
  const gamePausedRef = useRef(false);

  const [gamePhase, setGamePhase] = useState<'lobby' | 'waiting' | 'playing'>('lobby');
  const gamePhaseRef = useRef<'lobby' | 'waiting' | 'playing'>('lobby');
  const [boardTransition, setBoardTransition] = useState<'entering' | null>(null);
  const [transitionFromPhase, setTransitionFromPhase] = useState<'lobby' | 'waiting' | null>(null);
  const boardTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [myColor, setMyColor] = useState<LudoColor | null>(null);
  const [isSpectating, setIsSpectating] = useState(false);
  const [playerNames, setPlayerNames] = useState<Partial<Record<LudoColor, string>>>({});
  // playerCount is tracked via activePlayerCount (set from Firebase state)
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSinglePlayer, setIsSinglePlayer] = useState(false);
  const isSinglePlayerRef = useRef(false);
  const [, setBotColors] = useState<Set<LudoColor>>(new Set());
  const botColorsRef = useRef<Set<LudoColor>>(new Set());

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
  const homeStuckRolls = useRef<Record<string, number>>({}); // per-color consecutive non-6 rolls
  const pityThreshold = useRef<Record<string, number>>({}); // per-color random 3-6 threshold
  const lastTwoRolls = useRef<Record<string, [number, number]>>({}); // per-color anti-streak tracking
  const sixCounts = useRef<Record<string, number>>({}); // per-color total 6s rolled (for fairness balancing)
  const totalRollCounts = useRef<Record<string, number>>({}); // per-color total rolls

  // Cell-by-cell animation state
  const tokenAnimPos = useRef<Map<number, [number, number]>>(new Map());
  const tokenAnimParity = useRef<Map<number, number>>(new Map());
  const tokenAnimTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const capturedTokens = useRef<{ index: number; coords: [number, number]; color: LudoColor; ts: number }[]>([]);
  const captureShowTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Game effects (deploy sparkle, home celebration, power-up activations)
  type GameEffectType = 'deploy' | 'home' | 'starPoof' | 'puLightning' | 'puShellHit' | 'puWarp' | 'puBuff';
  const gameEffects = useRef<{ type: GameEffectType; color: LudoColor; coords?: [number, number]; emoji?: string; ts: number }[]>([]);
  const effectTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Stats tracking (synced via Firebase rollStats field)
  const [rollStats, setRollStats] = useState<RollStats>(() => deserializeRollStats(initRollStats()));
  const rollStatsRef = useRef<RollStats>(rollStats);
  rollStatsRef.current = rollStats;

  // Intro animation state
  const [introPhase, setIntroPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const introPhaseRef = useRef<'idle' | 'running' | 'done'>('idle');
  const introTokenPositions = useRef<Map<LudoColor, [number, number]>>(new Map());
  const introTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [introTrigger, setIntroTrigger] = useState(0);
  const [, setRenderTick] = useState(0);

  // Batched render-tick: coalesces multiple animation updates into a single
  // React re-render per frame via requestAnimationFrame. This prevents the
  // component from re-rendering 4-6x per frame during multi-token animations.
  const pendingRenderRef = useRef(false);
  const scheduleRenderTick = useCallback(() => {
    if (!pendingRenderRef.current) {
      pendingRenderRef.current = true;
      requestAnimationFrame(() => {
        pendingRenderRef.current = false;
        setRenderTick(t => t + 1);
      });
    }
  }, []);

  // Helper to push a game effect with auto-cleanup
  const pushEffect = useCallback((effect: { type: GameEffectType; color: LudoColor; coords?: [number, number]; emoji?: string; ts: number }, duration: number) => {
    gameEffects.current.push(effect);
    scheduleRenderTick();
    const timer = setTimeout(() => {
      gameEffects.current = gameEffects.current.filter(e => e !== effect);
      scheduleRenderTick();
    }, duration);
    effectTimers.current.push(timer);
  }, [scheduleRenderTick]);

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
  const [activePowerUp, setActivePowerUp] = useState<{ id: PowerUpId; slot: number } | null>(null);

  // Capture the Flag state (Mario mode)
  const [flagState, setFlagState] = useState<FlagState>({ cell: null, carrier: null, used: true });

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
  const pendingDiscardRef = useRef(pendingDiscard);
  pendingDiscardRef.current = pendingDiscard;
  const flagStateRef = useRef(flagState);
  flagStateRef.current = flagState;

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
      if (boardTransitionTimer.current) clearTimeout(boardTransitionTimer.current);
    };
  }, []);

  // --- Utility ---

  const showHint = useCallback((msg: string) => {
    setStatusHint(msg);
    clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => setStatusHint(null), 2000);
  }, []);

  // --- Cell-by-cell token animation ---

  const startTokenAnimation = useCallback((tokenIdx: number, rawWaypoints: [number, number][]) => {
    const existing = tokenAnimTimers.current.get(tokenIdx);
    if (existing) clearTimeout(existing);

    // Deduplicate adjacent waypoints with identical coords (safety measure)
    const waypoints = rawWaypoints.filter((wp, i) =>
      i === 0 || wp[0] !== rawWaypoints[i - 1][0] || wp[1] !== rawWaypoints[i - 1][1]
    );

    if (waypoints.length === 0) return;

    // Respect reduced-motion preference: jump directly to final position
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      tokenAnimPos.current.set(tokenIdx, waypoints[waypoints.length - 1]);
      scheduleRenderTick();
      const timer = setTimeout(() => {
        tokenAnimPos.current.delete(tokenIdx);
        tokenAnimParity.current.delete(tokenIdx);
        tokenAnimTimers.current.delete(tokenIdx);
        scheduleRenderTick();
      }, 50); // Brief pause so React can register the position
      tokenAnimTimers.current.set(tokenIdx, timer);
      return;
    }

    let step = 0;
    let lastStepTime = performance.now();
    let rapidCount = 0;
    const advance = () => {
      if (step >= waypoints.length) {
        tokenAnimPos.current.delete(tokenIdx);
        tokenAnimParity.current.delete(tokenIdx);
        tokenAnimTimers.current.delete(tokenIdx);
        scheduleRenderTick();
        return;
      }
      // If steps fire too rapidly (tab was backgrounded), skip to final waypoint
      // instead of silently dropping the animation
      const now = performance.now();
      if (step > 0 && now - lastStepTime < STEP_MS * 0.15) {
        rapidCount++;
        if (rapidCount >= 2) {
          // Jump to last waypoint, then clean up after one more step
          tokenAnimPos.current.set(tokenIdx, waypoints[waypoints.length - 1]);
          tokenAnimParity.current.set(tokenIdx, step % 2);
          scheduleRenderTick();
          tokenAnimTimers.current.set(tokenIdx, setTimeout(() => {
            tokenAnimPos.current.delete(tokenIdx);
            tokenAnimParity.current.delete(tokenIdx);
            tokenAnimTimers.current.delete(tokenIdx);
            scheduleRenderTick();
          }, STEP_MS));
          return;
        }
      } else {
        rapidCount = 0;
      }
      lastStepTime = now;
      tokenAnimPos.current.set(tokenIdx, waypoints[step]);
      tokenAnimParity.current.set(tokenIdx, step % 2);
      step++;
      scheduleRenderTick();
      tokenAnimTimers.current.set(tokenIdx, setTimeout(advance, STEP_MS));
    };

    advance();
  }, [scheduleRenderTick]);

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
            const gameInProgress = state.startedAt && state.tokens !== 'bas'.repeat(16);
            if (gameInProgress) {
              prevTokensRef.current = state.tokens;
              setIntroPhase('done');
              introPhaseRef.current = 'done';
            } else {
              prevTokensRef.current = 'bas'.repeat(16);
            }
            if (state.startedAt) {
              transitionToPlaying();
            } else {
              setGamePhase('waiting'); gamePhaseRef.current = 'waiting';
            }
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
      if ((e.key === ' ' || e.key === 'Enter') && gamePhase === 'playing' && introPhaseRef.current !== 'running' && myColorRef.current
        && !isRollingRef.current && !moveInFlightRef.current && !gamePausedRef.current
        && turnPhaseRef.current === 'roll' && currentTurnRef.current === myColorRef.current && !winnerRef.current) {
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
      // Only clear connection-type errors (not user action errors like join failures)
      setError(prev => prev === 'Connection lost. Please rejoin.' ? null : prev);

      const parsedTokens = deserializeTokens(state.tokens);

      // Reset moveInFlight on any state change (token, turn, or phase change)
      if (state.tokens !== prevTokensRef.current || state.turnStartedAt !== turnStartedAtRef.current
        || state.currentTurn !== currentTurnRef.current || state.turnPhase !== turnPhaseRef.current) {
        moveInFlightRef.current = false;
        clearTimeout(autoMoveRef.current);
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

        // Power-up effects: detect knockbacks (token moved backward on track)
        for (let i = 0; i < TOTAL_TOKENS; i++) {
          if (oldTokens[i] === parsedTokens[i]) continue;
          if (!oldTokens[i].startsWith('track-') || !parsedTokens[i].startsWith('track-')) continue;
          if (parsedTokens[i] === 'base') continue; // capture, not knockback
          const oldTrack = parseInt(oldTokens[i].split('-')[1]);
          const newTrack = parseInt(parsedTokens[i].split('-')[1]);
          const color = getTokenColor(i);
          const start = START_POSITIONS[color];
          const oldDist = oldTrack >= start ? oldTrack - start : (TRACK_SIZE - start) + oldTrack;
          const newDist = newTrack >= start ? newTrack - start : (TRACK_SIZE - start) + newTrack;
          if (newDist < oldDist) {
            // Token moved backward = knockback. Show hit effect at old position
            const coords = TRACK_COORDS[oldTrack];
            if (coords) pushEffect({ type: 'puShellHit', color, coords, emoji: '💥', ts: Date.now() }, 700);
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
              scheduleRenderTick();
              const timer = setTimeout(() => {
                gameEffects.current = gameEffects.current.filter(e => e !== effect);
                scheduleRenderTick();
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
              scheduleRenderTick();
              const cleanupTimer = setTimeout(() => {
                gameEffects.current = gameEffects.current.filter(e => e !== effect);
                scheduleRenderTick();
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
              break;
            }
          }

          const coords = getTokenCoords(oldTokens[i], i);
          if (coords) {
            const captureData = { index: i, coords, color: getTokenColor(i), ts: Date.now() + capturerDelay };
            const showTimer = setTimeout(() => {
              capturedTokens.current.push(captureData);
              scheduleRenderTick();
              // Each capture independently cleans itself up after 500ms
              const cleanupTimer = setTimeout(() => {
                capturedTokens.current = capturedTokens.current.filter(t => t !== captureData);
                scheduleRenderTick();
              }, 500);
              captureShowTimers.current.push(cleanupTimer);
            }, capturerDelay);
            captureShowTimers.current.push(showTimer);
          }
        }
      }
      prevTokensRef.current = state.tokens;

      // Roll stats: always sync from Firebase (authoritative source)
      if (state.rollStats) {
        const parsed = deserializeRollStats(state.rollStats);
        setRollStats(parsed);
        rollStatsRef.current = parsed;
      }

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
      setDiceValue(state.diceValue ?? null);
      setConsecutiveSixes(state.consecutiveSixes);
      setActivePlayerCount(state.playerCount);
      turnStartedAtRef.current = state.turnStartedAt;

      // Mario Mode state
      if (state.powerUpsEnabled) {
        setPowerUpsEnabled(true);
        if (state.powerUps) setInventory(deserializeInventory(state.powerUps));
        if (state.boardEffects !== undefined) {
          // Detect new banana placements for visual effect
          const newEffects = deserializeBoardEffects(state.boardEffects);
          const oldEffects = boardEffectsRef.current;
          for (const ne of newEffects) {
            if (!oldEffects.some(oe => oe.cell === ne.cell && oe.ownerColorIdx === ne.ownerColorIdx)) {
              const coords = TRACK_COORDS[ne.cell];
              if (coords) pushEffect({ type: 'puShellHit', color: colorFromIndex(ne.ownerColorIdx), coords, emoji: '🍌', ts: Date.now() }, 700);
            }
          }
          setBoardEffects(newEffects);
        }
        if (state.activeBuffs !== undefined) {
          // Detect new buff activations for visual effect
          const newBuffs = deserializeBuffs(state.activeBuffs);
          const oldBuffs = activeBuffsRef.current;
          for (const nb of newBuffs) {
            if (!oldBuffs.some(ob => ob.type === nb.type && ob.playerColorIdx === nb.playerColorIdx)) {
              const bufColor = colorFromIndex(nb.playerColorIdx);
              if (nb.type === 'lightning') {
                pushEffect({ type: 'puLightning', color: bufColor, emoji: '⚡', ts: Date.now() }, 800);
              } else if (nb.type === 'star') {
                pushEffect({ type: 'puBuff', color: bufColor, emoji: '🌟', ts: Date.now() }, 900);
              } else if (nb.type === 'cape') {
                pushEffect({ type: 'puBuff', color: bufColor, emoji: '🪶', ts: Date.now() }, 700);
              }
            }
          }
          setActiveBuffs(newBuffs);
        }
        if (state.coins) setCoins(deserializeCoins(state.coins));
        if (state.mysteryBoxes) setMysteryBoxes(deserializeMysteryBoxes(state.mysteryBoxes));
        if (state.flag) { const f = deserializeFlag(state.flag); setFlagState(f); flagStateRef.current = f; }
      }

      // Per-game pause state
      const isPaused = !!state.paused;
      setGamePaused(isPaused);
      gamePausedRef.current = isPaused;

      // Single player mode (bots present) — detect which colors are bots
      if (state.singlePlayer) {
        setIsSinglePlayer(true);
        isSinglePlayerRef.current = true;
        const detectedBots = new Set<LudoColor>();
        for (const color of TURN_ORDER) {
          const player = state.players[color];
          if (player && player.sessionId.startsWith('bot-')) {
            detectedBots.add(color);
          }
        }
        setBotColors(detectedBots);
        botColorsRef.current = detectedBots;
      } else {
        setIsSinglePlayer(false);
        isSinglePlayerRef.current = false;
        setBotColors(new Set());
        botColorsRef.current = new Set();
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

      // Transition waiting → playing when host starts the game
      if (state.startedAt) {
        setActivePlayerCount(state.playerCount);
        activePlayerCountRef.current = state.playerCount;
        if (gamePhaseRef.current === 'waiting') {
          transitionToPlaying();
        }
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

    // Track which tokens were captured (before auto-deploy might change them)
    const capturedIndices: number[] = [];
    if (captured) {
      const mvrColor = getTokenColor(tokenIndex);
      for (let i = 0; i < TOTAL_TOKENS; i++) {
        if (i === tokenIndex || getTokenColor(i) === mvrColor) continue;
        if (newTokens[i] === 'base' && currentTokens[i] !== 'base') capturedIndices.push(i);
      }
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
            const startPos: TokenPosition = `track-${START_POSITIONS[victColor]}`;
            // Don't auto-deploy if another token (e.g. the capturer) occupies the start cell
            const startOccupied = newTokens.some((t, j) => j !== i && t === startPos && getTokenColor(j) !== victColor);
            if (!startOccupied) {
              updCoins[vci] = 0;
              newTokens[i] = startPos;
              showHint(`${COLOR_LABELS[victColor]} auto-deployed with banked coins!`);
            }
            // If occupied, keep coins banked — they'll auto-deploy next time a token returns to base
          }
        }
      }
      coinsRef.current = updCoins;
    }

    // Auto-deploy banked coins: check ALL players with 3+ coins and a token in base
    // (handles the case where start position was previously occupied but is now free)
    if (powerUpsEnabledRef.current) {
      const bankCoins = [...coinsRef.current];
      let bankChanged = false;
      for (let ci2 = 0; ci2 < 4; ci2++) {
        if (bankCoins[ci2] >= 3) {
          const bankColor = (['red', 'green', 'yellow', 'blue'] as const)[ci2];
          const bankIndices = getColorTokenIndices(bankColor);
          const startPos: TokenPosition = `track-${START_POSITIONS[bankColor]}`;
          const startFree = !newTokens.some((t, j) => t === startPos && getTokenColor(j) !== bankColor);
          if (startFree) {
            const baseToken = bankIndices.find(idx => newTokens[idx] === 'base');
            if (baseToken !== undefined) {
              bankCoins[ci2] = 0;
              newTokens[baseToken] = startPos;
              bankChanged = true;
              showHint(`${COLOR_LABELS[bankColor]} auto-deployed with banked coins!`);
            }
          }
        }
      }
      if (bankChanged) coinsRef.current = bankCoins;
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
                  scheduleRenderTick();
                }, 700);
                effectTimers.current.push(timer);
              }
            }
          }
          scheduleRenderTick();
          showHint('🌟 Star power! Swept opponents home!');
        }
      }
    }

    // --- Capture the Flag logic ---
    let updatedFlag = { ...flagStateRef.current };
    if (powerUpsEnabledRef.current && !updatedFlag.used) {
      // 1. Kill transfer: if captured token was carrying the flag, transfer to the killer
      if (captured && updatedFlag.carrier !== null && capturedIndices.includes(updatedFlag.carrier)) {
        updatedFlag = { cell: null, carrier: tokenIndex, used: false };
        showHint('Flag captured! Stolen by the killer!');
      }

      // 1b. Star effect: if the flag carrier was relocated by star power, drop the flag
      //     IMPORTANT: must run AFTER step 1 (kill-transfer) — if the carrier was captured
      //     AND auto-deployed by coins, step 1 already transferred the flag to the killer.
      //     This step only fires for non-capture relocations (e.g., star sending to base).
      if (updatedFlag.carrier !== null && updatedFlag.carrier !== tokenIndex) {
        const carrierOldPos = currentTokens[updatedFlag.carrier];
        const carrierNewPos = newTokens[updatedFlag.carrier];
        if (carrierOldPos !== carrierNewPos) {
          if (carrierNewPos.startsWith('track-')) {
            updatedFlag = { cell: parseInt(carrierNewPos.split('-')[1]), carrier: null, used: false };
            showHint('Star power knocked the flag loose!');
          } else if (carrierNewPos === 'base' && carrierOldPos.startsWith('track-')) {
            // Star sent carrier to base — drop flag at their old track position
            updatedFlag = { cell: parseInt(carrierOldPos.split('-')[1]), carrier: null, used: false };
            showHint('Star power knocked the flag loose!');
          }
        }
      }

      // 2. Flag pickup: if mover lands on flagCell and nobody is carrying it
      if (updatedFlag.cell !== null && updatedFlag.carrier === null && newPosition.startsWith('track-')) {
        const landedCell = parseInt(newPosition.split('-')[1]);
        if (landedCell === updatedFlag.cell) {
          updatedFlag = { cell: null, carrier: tokenIndex, used: false };
          showHint('Flag picked up! Carry it home!');
        }
      }

      // 3. Carry home: if flag carrier reaches final-6, release all base tokens
      if (updatedFlag.carrier === tokenIndex && reachedHome) {
        const carrierColor = getTokenColor(tokenIndex);
        const myIndices = getColorTokenIndices(carrierColor);
        const startCell = START_POSITIONS[carrierColor];
        const startPos: TokenPosition = `track-${startCell}`;
        let released = 0;
        for (const idx of myIndices) {
          if (newTokens[idx] === 'base') {
            newTokens[idx] = startPos;
            released++;
          }
        }
        // Capture opponents on our start cell — flag-release overrides safe zone protection
        if (released > 0) {
          for (let i = 0; i < TOTAL_TOKENS; i++) {
            if (getTokenColor(i) === carrierColor) continue;
            if (newTokens[i] === startPos) {
              newTokens[i] = 'base';
              captured = true;
              capturedIndices.push(i);
              // Clear captured victim's inventory
              if (powerUpsEnabledRef.current) {
                const victimColor = getTokenColor(i);
                const ci = colorIndex(victimColor);
                const inv = inventoryRef.current;
                if (inv[ci][0] !== null) {
                  const clearedInv = inv.map((slots, idx) =>
                    idx === ci ? [null] as (PowerUpId | null)[] : [...slots]
                  );
                  inventoryRef.current = clearedInv;
                  setInventory(clearedInv);
                }
              }
            }
          }
        }
        updatedFlag = { cell: null, carrier: null, used: true };
        if (released > 0) {
          showHint(`Flag home! ${released} counter${released > 1 ? 's' : ''} released!`);
        } else {
          showHint('Flag carried home!');
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
    if (isEffectiveSix(roll) && curSixes >= 2) showHint('Three 6s — no bonus turn');
    else if (captured) showHint('Captured! Bonus turn');
    else if (reachedHome) showHint('Home! Bonus turn');
    else if (isEffectiveSix(roll) && nextColor === curColor) showHint('Rolled 6! Bonus turn');

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

        // Check for banana peel (owner is immune to their own banana)
        const curColorIdx = colorIndex(curColor);
        const bananaIdx = updatedEffects.findIndex(e => e.type === 'banana' && e.cell === landedCell && e.ownerColorIdx !== curColorIdx);
        if (bananaIdx >= 0) {
          // Slip back 3 spaces
          updatedEffects = updatedEffects.filter((_, i) => i !== bananaIdx);
          newTokens = knockBack(newTokens, tokenIndex, 3);
          // Capture any opponent at the knockback landing position
          const bananaCapture = captureAfterKnockback(newTokens, tokenIndex);
          newTokens = bananaCapture.tokens;
          if (bananaCapture.capturedIndices.length > 0) {
            captured = true;
            // Flag transfer: if a banana-knockback capture killed a flag carrier, transfer flag
            if (!updatedFlag.used && updatedFlag.carrier !== null && bananaCapture.capturedIndices.includes(updatedFlag.carrier)) {
              updatedFlag = { cell: null, carrier: tokenIndex, used: false };
            }
            // Clear captured victim's inventory
            for (const ci2 of bananaCapture.capturedIndices) {
              const victColor = getTokenColor(ci2);
              const vci = colorIndex(victColor);
              if (updatedInv[vci][0] !== null) {
                updatedInv = updatedInv.map((slots, idx) =>
                  idx === vci ? [null] as (PowerUpId | null)[] : [...slots]
                );
              }
            }
          }
          // Flag drop on banana slip
          if (updatedFlag.carrier === tokenIndex) {
            const slipPos = newTokens[tokenIndex];
            if (slipPos.startsWith('track-')) {
              updatedFlag = { cell: parseInt(slipPos.split('-')[1]), carrier: null, used: false };
              showHint('🍌 Banana peel! Flag dropped — slid back 3!');
            } else if (slipPos.startsWith('final-')) {
              // Knocked into corridor — drop flag at entry cell
              updatedFlag = { cell: ENTRY_CELLS[curColor], carrier: null, used: false };
              showHint('🍌 Banana peel! Flag dropped — slid back 3!');
            } else {
              // Knocked back to base — drop flag at start position
              updatedFlag = { cell: START_POSITIONS[curColor], carrier: null, used: false };
              showHint('🍌 Banana peel! Flag dropped — slid back to base!');
            }
          } else {
            showHint('🍌 Banana peel! Slid back 3 spaces!');
          }
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

      // Tick buffs only when the turn actually advances to another player (not on bonus turns)
      // This ensures "2 turns" means 2 full turns, not 2 moves within bonus chains
      if (nextColor !== curColor) {
        updatedBuffs = tickBuffs(updatedBuffs, colorIndex(curColor));
      }

      // Tick mystery box cooldowns once per full round: only when turn transitions
      // from last active player to first active player (skip bonus turns)
      const activePlayersForRound = TURN_ORDER.slice(0, curPlayerCount).filter(c => !finishedColors.has(c));
      const firstActive = activePlayersForRound[0];
      const lastActive = activePlayersForRound[activePlayersForRound.length - 1];
      if (firstActive && lastActive && curColor === lastActive && nextColor === firstActive && curColor !== nextColor) {
        updatedMysteryBoxes = tickMysteryBoxCooldowns(updatedMysteryBoxes);
      }

      // Optimistic local update: push power-up state to UI immediately
      // (don't wait for Firebase round-trip to reflect mystery box/inventory changes)
      mysteryBoxesRef.current = updatedMysteryBoxes;
      setMysteryBoxes(updatedMysteryBoxes);
      inventoryRef.current = updatedInv;
      setInventory(updatedInv);
      setCoins(updatedCoins);
    }

    // Record captures in synced roll stats
    let moveRollStats = rollStatsRef.current;
    if (captured) {
      moveRollStats = recordCapture(moveRollStats, colorIndex(curColor));
      rollStatsRef.current = moveRollStats;
    }

    const update: LudoMoveUpdate = {
      tokens: serializeTokens(newTokens),
      currentTurn: gameWinner ? curColor : nextColor,
      turnPhase: 'roll',
      diceValue: roll,
      consecutiveSixes: nextSixes,
      winner: gameWinner,
      finishOrder: updatedFinishOrder.join(','),
      turnStartedAt: getServerTimestamp(),
      rollStats: serializeRollStats(moveRollStats),
    };

    // Attach power-up state if enabled
    if (powerUpsEnabledRef.current) {
      update.powerUps = serializeInventory(updatedInv);
      update.boardEffects = serializeBoardEffects(updatedEffects);
      update.activeBuffs = serializeBuffs(updatedBuffs);
      update.coins = serializeCoins(updatedCoins);
      update.mysteryBoxes = serializeMysteryBoxes(updatedMysteryBoxes);
      update.flag = serializeFlag(updatedFlag);
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
    if (gamePausedRef.current) return;
    if (introPhaseRef.current === 'running') return;
    const isBotTurn = isSinglePlayerRef.current && botColorsRef.current.has(currentTurnRef.current);
    if (!isBotTurn && currentTurnRef.current !== mc) return;
    if (turnPhaseRef.current !== 'roll') return;
    if (winnerRef.current || isRollingRef.current || moveInFlightRef.current) return;

    const activeColor = currentTurnRef.current; // may differ from mc for bot turns

    moveInFlightRef.current = true;
    isRollingRef.current = true;
    setIsRolling(true);
    const rollAnimMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 800;

    // Determine how many rolls we need (3 for Golden Mushroom, 1 otherwise)
    const isGoldenMushroom = powerUpsEnabledRef.current && activePowerUpRef.current?.id === 'golden-mushroom';
    const rollCount: 1 | 3 = isGoldenMushroom ? 3 : 1;

    // Request dice roll from server (falls back to client-side if unavailable)
    const sid = sessionId;
    const { rolls: serverRolls } = await requestDiceRoll(gc, sid, rollCount);

    // If the game state changed while waiting for the server, abort
    if (currentTurnRef.current !== activeColor || turnPhaseRef.current !== 'roll' || winnerRef.current) {
      moveInFlightRef.current = false;
      isRollingRef.current = false;
      setIsRolling(false);
      return;
    }

    // Apply pity-timer: guarantee a 6 after N consecutive non-6 rolls (per-color)
    const colorKey = activeColor;
    let roll = serverRolls[0];
    const rollIndices = getColorTokenIndices(activeColor);
    const hasTokenAtHome = rollIndices.some(i => tokensRef.current[i] === 'base');
    const noneOnTrack = rollIndices.every(i => {
      const t = tokensRef.current[i];
      return t === 'base' || t === 'final-6' || t.startsWith('final-');
    });
    const needsSix = hasTokenAtHome && noneOnTrack;
    let pityForced = false;
    const stuckCount = homeStuckRolls.current[colorKey] || 0;
    const threshold = pityThreshold.current[colorKey] ?? (3 + Math.floor(Math.random() * 4));
    if (!(colorKey in pityThreshold.current)) pityThreshold.current[colorKey] = threshold;
    if (needsSix && stuckCount >= threshold) {
      roll = 6;
      pityForced = true;
    }
    if (needsSix) {
      if (roll === 6) {
        homeStuckRolls.current[colorKey] = 0;
        pityThreshold.current[colorKey] = 3 + Math.floor(Math.random() * 4);
      } else {
        homeStuckRolls.current[colorKey] = stuckCount + 1;
      }
    } else {
      homeStuckRolls.current[colorKey] = 0;
    }
    const prevRolls = lastTwoRolls.current[colorKey] || [0, 0];
    lastTwoRolls.current[colorKey] = [prevRolls[1], roll];
    totalRollCounts.current[colorKey] = (totalRollCounts.current[colorKey] || 0) + 1;
    if (roll === 6 && !pityForced) sixCounts.current[colorKey] = (sixCounts.current[colorKey] || 0) + 1;

    // Super Mushroom: double the roll
    if (powerUpsEnabledRef.current && activePowerUpRef.current?.id === 'super-mushroom') {
      roll = Math.min(roll * 2, 12);
      setActivePowerUp(null);
    }

    // Lightning debuff: halve the roll
    if (powerUpsEnabledRef.current) {
      const ci = colorIndex(activeColor);
      if (hasLightningDebuff(activeBuffsRef.current, ci)) {
        roll = Math.max(1, Math.floor(roll / 2));
        showHint('⚡ Lightning debuff! Your roll was halved!');
      }
    }

    // Golden Mushroom: show pick modal instead of proceeding
    if (isGoldenMushroom) {
      clearTimeout(autoMoveRef.current); // Cancel any pending auto-move
      const r1 = roll;
      // Apply lightning debuff to alt rolls too for fairness
      const ci2 = colorIndex(activeColor);
      const isLightning = hasLightningDebuff(activeBuffsRef.current, ci2);
      let r2 = serverRolls[1] ?? (Math.floor(Math.random() * 6) + 1);
      let r3 = serverRolls[2] ?? (Math.floor(Math.random() * 6) + 1);
      if (isLightning) {
        r2 = Math.max(1, Math.floor(r2 / 2));
        r3 = Math.max(1, Math.floor(r3 / 2));
      }
      setActivePowerUp(null);
      // Show modal after rolling animation
      rollTimeoutRef.current = setTimeout(() => {
        setIsRolling(false);
        isRollingRef.current = false;
        goldenMushroomRef.current = [r1, r2, r3]; // Sync ref immediately before clearing moveInFlight
        setGoldenMushroomRolls([r1, r2, r3]);
        moveInFlightRef.current = false; // Allow interaction with modal (after ref is synced)
      }, rollAnimMs);
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

        // Record this roll in synced stats (Bullet Bill uses roll=10, maps to face 5)
        const bbRollStats = recordRoll(rollStatsRef.current, colorIndex(activeColor), 10);
        rollStatsRef.current = bbRollStats;

        // Find the furthest-ahead token on the track to rocket
        const currentTokens = tokensRef.current;
        const bestToken = findFurthestTrackToken(currentTokens, activeColor);
        if (bestToken !== null) {
          const newPos = calculateNewPosition(currentTokens[bestToken], 10, activeColor);
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
        const curColor2 = currentTurnRef.current;
        const moves2 = getValidMoves(currentTokens, curColor2, roll);
        if (moves2.length === 0) {
          const finishedColors2 = getFinishedColors(currentTokens, activePlayerCountRef.current);
          const curSixes2 = consecutiveSixesRef.current;
          let nextColor2: LudoColor;
          let nextSixes2: number;
          if (isEffectiveSix(roll) && curSixes2 < 2) {
            nextColor2 = curColor2;
            nextSixes2 = curSixes2 + 1;
          } else {
            nextColor2 = findNextActivePlayer(curColor2, activePlayerCountRef.current, finishedColors2);
            nextSixes2 = 0;
          }
          // Tick buffs on skipped turns when turn advances
          let bbSkipBuffs = activeBuffsRef.current;
          if (powerUpsEnabledRef.current && nextColor2 !== curColor2) {
            bbSkipBuffs = tickBuffs(bbSkipBuffs, colorIndex(curColor2));
          }
          const update2: LudoMoveUpdate = {
            tokens: serializeTokens(currentTokens),
            currentTurn: nextColor2,
            turnPhase: 'roll',
            diceValue: roll,
            consecutiveSixes: nextSixes2,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: getServerTimestamp(),
            rollStats: serializeRollStats(bbRollStats),
            ...(powerUpsEnabledRef.current ? {
              powerUps: serializeInventory(inventoryRef.current),
              activeBuffs: serializeBuffs(bbSkipBuffs),
              boardEffects: serializeBoardEffects(boardEffectsRef.current),
              coins: serializeCoins(coinsRef.current),
              mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
              flag: serializeFlag(flagStateRef.current),
            } : {}),
          };
          makeMove(gc, curColor2, update2).catch(() => { moveInFlightRef.current = false; });
        } else if (moves2.length === 1) {
          executeMove(moves2[0].tokenIndex, moves2[0].newPosition, roll);
        } else {
          setValidMoves(new Map(moves2.map(m => [m.tokenIndex, m.newPosition])));
          moveInFlightRef.current = false;
        }
      }, rollAnimMs);
      return;
    }

    rollTimeoutRef.current = setTimeout(async () => {
      setIsRolling(false);
      isRollingRef.current = false;
      setDiceValue(roll);
      diceAnimKeyRef.current += 1;
      rolledThisTurnRef.current = true;

      // Record this roll in synced stats
      const updatedRollStats = recordRoll(rollStatsRef.current, colorIndex(activeColor), roll);
      rollStatsRef.current = updatedRollStats;

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
        if (isEffectiveSix(roll) && curSixes < 2) {
          nextColor = curColor;
          nextSixes = curSixes + 1;
          showHint('No moves, but rolled 6!');
        } else if (isEffectiveSix(roll) && curSixes >= 2) {
          nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
          nextSixes = 0;
          showHint('Three 6s — no bonus turn');
        } else {
          nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
          nextSixes = 0;
          showHint(hasTokensInCorridor ? 'Need exact roll to finish' : 'No valid moves');
        }

        // Tick buffs on skipped turns when the turn actually advances
        let skipBuffs = activeBuffsRef.current;
        if (powerUpsEnabledRef.current && nextColor !== curColor) {
          skipBuffs = tickBuffs(skipBuffs, colorIndex(curColor));
        }
        const update: LudoMoveUpdate = {
          tokens: serializeTokens(currentTokens),
          currentTurn: nextColor,
          turnPhase: 'roll',
          diceValue: roll,
          consecutiveSixes: nextSixes,
          winner: null,
          finishOrder: curFinishOrder.join(','),
          turnStartedAt: getServerTimestamp(),
          rollStats: serializeRollStats(updatedRollStats),
          ...(powerUpsEnabledRef.current ? {
            powerUps: serializeInventory(inventoryRef.current),
            activeBuffs: serializeBuffs(skipBuffs),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
            mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
            flag: serializeFlag(flagStateRef.current),
          } : {}),
        };
        try { await makeMove(gc, curColor, update); } catch { moveInFlightRef.current = false; }
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
        turnStartedAt: getServerTimestamp(),
        rollStats: serializeRollStats(updatedRollStats),
        ...(powerUpsEnabledRef.current ? {
          powerUps: serializeInventory(inventoryRef.current),
          activeBuffs: serializeBuffs(activeBuffsRef.current),
          boardEffects: serializeBoardEffects(boardEffectsRef.current),
          coins: serializeCoins(coinsRef.current),
          mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
          flag: serializeFlag(flagStateRef.current),
        } : {}),
      };
      try { await makeMove(gc, curColor, update); } catch { moveInFlightRef.current = false; }
    }, rollAnimMs);
  }, [executeMove, showHint]);

  const handleMoveToken = useCallback((tokenIndex: number) => {
    const mc = myColorRef.current;
    if (!mc) return;
    if (gamePausedRef.current) return;
    const isBotTurn = isSinglePlayerRef.current && botColorsRef.current.has(currentTurnRef.current);
    if (!isBotTurn && currentTurnRef.current !== mc) return;
    if (turnPhaseRef.current !== 'move') return;
    if (winnerRef.current || moveInFlightRef.current) return;

    const dice = diceValueRef.current;
    if (dice === null) return;

    // Recompute valid moves from refs to avoid stale state
    const moves = getValidMoves(tokensRef.current, currentTurnRef.current, dice);
    const move = moves.find(m => m.tokenIndex === tokenIndex);
    if (!move) return;

    clearTimeout(autoMoveRef.current);
    moveInFlightRef.current = true;
    // Check for cape feather buff
    const turnColor = currentTurnRef.current;
    const capeActive = powerUpsEnabledRef.current && hasActiveBuff(activeBuffsRef.current, colorIndex(turnColor), 'cape');
    executeMove(move.tokenIndex, move.newPosition, dice, capeActive);
  }, [executeMove]);

  // --- Power-up usage handler ---
  const handleUsePowerUp = useCallback((slot: number, powerUpId: PowerUpId) => {
    const mc = myColorRef.current;
    if (!mc || !powerUpsEnabledRef.current) return;
    if (currentTurnRef.current !== mc) return; // Not your turn
    if (moveInFlightRef.current) return; // Prevent double-fire

    const def = POWER_UPS[powerUpId];
    if (!def) return;

    // Validate timing matches current phase
    if (def.timing === 'before-roll' && turnPhaseRef.current !== 'roll') return;
    if (def.timing === 'after-roll' && turnPhaseRef.current !== 'move') return;

    // Validate the power-up actually exists in the claimed slot
    const currentSlotItem = inventoryRef.current[colorIndex(mc)]?.[slot];
    if (currentSlotItem !== powerUpId) return;

    // Remove from inventory immediately
    moveInFlightRef.current = true;

    try {
    const newInv = removeFromInventory(inventoryRef.current, mc, slot);

    if (def.timing === 'before-roll') {
      // These activate on the next roll
      if (powerUpId === 'star') {
        // Add star buff for 2 turns
        const newBuffs = [...activeBuffsRef.current, { type: 'star' as const, playerColorIdx: colorIndex(mc), duration: 2 }];
        setValidMoves(new Map()); // Clear move highlights (phase resets to roll)
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
            turnStartedAt: getServerTimestamp(),
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(newBuffs),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
            mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
            flag: serializeFlag(flagStateRef.current),
          }).catch(() => { moveInFlightRef.current = false; });
        }
        showHint('🌟 Star activated! Anyone you pass gets sent home for 2 turns!');
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
        setValidMoves(new Map());
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
            turnStartedAt: getServerTimestamp(),
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(newBuffs),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
            mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
            flag: serializeFlag(flagStateRef.current),
          }).catch(() => { moveInFlightRef.current = false; });
        }
        showHint('⚡ Lightning! All opponents half speed for 2 turns!');
        return;
      }

      // Super Mushroom, Golden Mushroom, Bullet Bill — set active for the next roll
      setActivePowerUp({ id: powerUpId, slot });
      setValidMoves(new Map()); // Clear move highlights (phase resets to roll)
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
          turnStartedAt: getServerTimestamp(),
          powerUps: serializeInventory(newInv),
          activeBuffs: serializeBuffs(activeBuffsRef.current),
          boardEffects: serializeBoardEffects(boardEffectsRef.current),
          coins: serializeCoins(coinsRef.current),
          mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
          flag: serializeFlag(flagStateRef.current),
        }).catch(() => { moveInFlightRef.current = false; });
      }
      showHint(`${def.emoji} ${def.name} ready!`);
      return;
    }

    if (def.timing === 'after-roll') {
      const currentTokens = tokensRef.current;

      if (powerUpId === 'green-shell' || powerUpId === 'red-shell') {
        // Find furthest-ahead shooter token on track
        const shooterIdx = findFurthestTrackToken(currentTokens, mc);
        const shooterTrack = shooterIdx !== null
          ? parseInt(currentTokens[shooterIdx].split('-')[1])
          : null;
        if (shooterTrack === null) {
          moveInFlightRef.current = false;
          showHint('No tokens on track to shoot from!');
          return;
        }

        const target = powerUpId === 'green-shell'
          ? findFirstOpponentAhead(currentTokens, shooterTrack, mc)
          : findNearestOpponentBehind(currentTokens, shooterTrack, mc);

        if (target === null) {
          moveInFlightRef.current = false;
          showHint('No target found!');
          return;
        }

        let newTokens = knockBack(currentTokens, target, 3);
        // Capture any opponent at the knockback landing position
        const shellCapture = captureAfterKnockback(newTokens, target);
        newTokens = shellCapture.tokens;
        // Flag drop: if target was carrying flag, drop at new position
        // Also check if a secondary capture (from knockback landing) killed a flag carrier
        let shellFlag = flagStateRef.current;
        let shellDroppedFlag = false;
        if (!shellFlag.used && shellFlag.carrier !== null && shellCapture.capturedIndices.includes(shellFlag.carrier)) {
          // Secondary knockback capture killed the flag carrier — drop flag at capture location
          const knockPos = newTokens[target];
          if (knockPos.startsWith('track-')) {
            shellFlag = { cell: parseInt(knockPos.split('-')[1]), carrier: null, used: false };
            shellDroppedFlag = true;
          }
        } else if (!shellFlag.used && shellFlag.carrier === target) {
          const newPos = newTokens[target];
          if (newPos.startsWith('track-')) {
            shellFlag = { cell: parseInt(newPos.split('-')[1]), carrier: null, used: false };
            shellDroppedFlag = true;
          } else if (newPos.startsWith('final-')) {
            // Knocked back within corridor — drop flag at corridor entrance on track
            const targetColor = getTokenColor(target);
            shellFlag = { cell: ENTRY_CELLS[targetColor], carrier: null, used: false };
            shellDroppedFlag = true;
          }
        }
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
            mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
            flag: serializeFlag(shellFlag),
          }).catch(() => { moveInFlightRef.current = false; });
        }
        showHint(shellDroppedFlag
          ? `${def.emoji} Hit! Flag dropped!`
          : `${def.emoji} Hit! Knocked back 3!`);
        return;
      }

      if (powerUpId === 'blue-shell') {
        const target = findLeaderLeadToken(currentTokens, activePlayerCountRef.current, mc);
        if (target === null) {
          moveInFlightRef.current = false;
          showHint('No leader to target!');
          return;
        }
        let newTokens = knockBack(currentTokens, target, 5);
        // Capture any opponent at the knockback landing position
        const blueCapture = captureAfterKnockback(newTokens, target);
        newTokens = blueCapture.tokens;
        // Flag drop: if target was carrying flag, drop at new position
        // Also check if a secondary capture (from knockback landing) killed a flag carrier
        let blueShellFlag = flagStateRef.current;
        let blueDroppedFlag = false;
        if (!blueShellFlag.used && blueShellFlag.carrier !== null && blueCapture.capturedIndices.includes(blueShellFlag.carrier)) {
          const knockPos = newTokens[target];
          if (knockPos.startsWith('track-')) {
            blueShellFlag = { cell: parseInt(knockPos.split('-')[1]), carrier: null, used: false };
            blueDroppedFlag = true;
          }
        } else if (!blueShellFlag.used && blueShellFlag.carrier === target) {
          const newPos = newTokens[target];
          if (newPos.startsWith('track-')) {
            blueShellFlag = { cell: parseInt(newPos.split('-')[1]), carrier: null, used: false };
            blueDroppedFlag = true;
          } else if (newPos.startsWith('final-')) {
            const targetColor = getTokenColor(target);
            blueShellFlag = { cell: ENTRY_CELLS[targetColor], carrier: null, used: false };
            blueDroppedFlag = true;
          }
        }
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
            mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
            flag: serializeFlag(blueShellFlag),
          }).catch(() => { moveInFlightRef.current = false; });
        }
        showHint(blueDroppedFlag
          ? 'Blue Shell! Flag dropped!'
          : 'Blue Shell! Leader knocked back 5!');
        return;
      }

      if (powerUpId === 'warp-pipe') {
        // Find the best token on track and warp it
        const warpToken = findFurthestTrackToken(currentTokens, mc);
        if (warpToken === null) {
          moveInFlightRef.current = false;
          showHint('No tokens on track!');
          return;
        }
        const trackPos = parseInt(currentTokens[warpToken].split('-')[1]);
        const safeZone = findNextSafeZone(trackPos, mc);
        const newTokens = [...currentTokens] as TokenPosition[];
        newTokens[warpToken] = `track-${safeZone}`;
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
            mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
            flag: serializeFlag(flagStateRef.current),
          }).catch(() => { moveInFlightRef.current = false; });
        }
        showHint('Warp Pipe! Teleported to safe zone!');
        // Warp visual: swirl at departure and arrival
        const departCoords = TRACK_COORDS[trackPos];
        const arriveCoords = TRACK_COORDS[safeZone];
        if (departCoords) pushEffect({ type: 'puWarp', color: mc, coords: departCoords, emoji: '🕳️', ts: Date.now() }, 800);
        if (arriveCoords) setTimeout(() => pushEffect({ type: 'puWarp', color: mc, coords: arriveCoords, emoji: '🕳️', ts: Date.now() }, 800), 300);
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
            turnStartedAt: getServerTimestamp(),
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(newBuffs),
            boardEffects: serializeBoardEffects(boardEffectsRef.current),
            coins: serializeCoins(coinsRef.current),
            mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
            flag: serializeFlag(flagStateRef.current),
          }).catch(() => { moveInFlightRef.current = false; });
        }
        showHint('Cape Feather! Fly over opponents!');
        return;
      }

      if (powerUpId === 'banana-peel') {
        // Auto-place banana on the furthest-ahead token's position
        const bananaTokenIdx = findFurthestTrackToken(currentTokens, mc);
        const placedCell = bananaTokenIdx !== null
          ? parseInt(currentTokens[bananaTokenIdx].split('-')[1])
          : null;
        if (placedCell === null || SAFE_ZONES.has(placedCell)) {
          moveInFlightRef.current = false;
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
            turnStartedAt: getServerTimestamp(),
            powerUps: serializeInventory(newInv),
            activeBuffs: serializeBuffs(activeBuffsRef.current),
            boardEffects: serializeBoardEffects(newEffects),
            coins: serializeCoins(coinsRef.current),
            mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
            flag: serializeFlag(flagStateRef.current),
          }).catch(() => { moveInFlightRef.current = false; });
        }
        showHint(`Banana peel placed on cell ${placedCell}!`);
        return;
      }
    }
    // Unknown power-up — reset guard
    moveInFlightRef.current = false;
    } catch {
      // Ensure moveInFlight is always reset on any error to prevent game freeze
      moveInFlightRef.current = false;
    }
  }, [showHint, executeMove]);

  // Golden Mushroom pick handler
  const handleGoldenMushroomPick = useCallback((pickedRoll: number) => {
    if (moveInFlightRef.current) return; // Guard against double-click
    moveInFlightRef.current = true;
    setGoldenMushroomRolls(null);
    setDiceValue(pickedRoll);
    diceAnimKeyRef.current += 1;
    rolledThisTurnRef.current = true;

    // Record this roll in synced stats
    const gmRollStats = recordRoll(rollStatsRef.current, colorIndex(currentTurnRef.current), pickedRoll);
    rollStatsRef.current = gmRollStats;

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
      // Handle bonus-turn logic for rolled 6, same as main roll path
      let nextColor: LudoColor;
      let nextSixes: number;
      if (isEffectiveSix(pickedRoll) && curSixes < 2) {
        nextColor = curColor;
        nextSixes = curSixes + 1;
        showHint('No moves, but picked 6!');
      } else if (isEffectiveSix(pickedRoll) && curSixes >= 2) {
        nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
        nextSixes = 0;
        showHint('Three 6s — no bonus turn');
      } else {
        nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
        nextSixes = 0;
        showHint('No valid moves');
      }
      // Tick buffs on skipped turns when turn advances
      let gmSkipBuffs = activeBuffsRef.current;
      if (powerUpsEnabledRef.current && nextColor !== curColor) {
        gmSkipBuffs = tickBuffs(gmSkipBuffs, colorIndex(curColor));
      }
      const update: LudoMoveUpdate = {
        tokens: serializeTokens(currentTokens),
        currentTurn: nextColor,
        turnPhase: 'roll',
        diceValue: pickedRoll,
        consecutiveSixes: nextSixes,
        winner: null,
        finishOrder: curFinishOrder.join(','),
        turnStartedAt: getServerTimestamp(),
        rollStats: serializeRollStats(gmRollStats),
        powerUps: serializeInventory(inventoryRef.current),
        activeBuffs: serializeBuffs(gmSkipBuffs),
        boardEffects: serializeBoardEffects(boardEffectsRef.current),
        coins: serializeCoins(coinsRef.current),
        mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
        flag: serializeFlag(flagStateRef.current),
      };
      makeMove(gc, curColor, update).catch(() => { moveInFlightRef.current = false; });
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
      turnStartedAt: getServerTimestamp(),
      rollStats: serializeRollStats(gmRollStats),
      powerUps: serializeInventory(inventoryRef.current),
      activeBuffs: serializeBuffs(activeBuffsRef.current),
      boardEffects: serializeBoardEffects(boardEffectsRef.current),
      coins: serializeCoins(coinsRef.current),
      mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
      flag: serializeFlag(flagStateRef.current),
    };
    makeMove(gc, curColor, update).catch(() => { moveInFlightRef.current = false; });
  }, [executeMove, showHint]);

  // Discard handler for full inventory
  // Uses a transaction to read-modify-write only this player's inventory slot,
  // preventing concurrent overwrites of other players' items.
  const handleDiscard = useCallback(async (slot: number) => {
    const mc = myColorRef.current;
    if (!mc || !pendingDiscard) return;
    const discardedId = pendingDiscard;
    setPendingDiscard(null);
    showHint(`Got ${POWER_UPS[discardedId].emoji} ${POWER_UPS[discardedId].name}!`);

    const gc = gameCodeRef.current;
    if (gc) {
      try {
        const { ensureInitialized, getDbModule, getFirebaseDatabase } = await import('../firebase');
        await ensureInitialized();
        const { ref, runTransaction } = getDbModule();
        const db = getFirebaseDatabase();
        const gameRef = ref(db, `ludo/${gc}`);
        await runTransaction(gameRef, (current: LudoGameState | null) => {
          if (!current || !current.powerUps) return current;
          // Re-read current inventory from Firebase (not stale local state)
          const currentInv = deserializeInventory(current.powerUps);
          const patched = discardSlot(currentInv, mc, slot, discardedId);
          return { ...current, powerUps: serializeInventory(patched) };
        });
      } catch {
        // Silent failure — inventory will sync on next state update
      }
    }
  }, [pendingDiscard, showHint]);

  // Refs for handler functions (timer uses these)
  const handleRollDiceRef = useRef(handleRollDice);
  handleRollDiceRef.current = handleRollDice;
  const handleMoveTokenRef = useRef(handleMoveToken);
  handleMoveTokenRef.current = handleMoveToken;
  const validMovesRef = useRef(validMoves);
  validMovesRef.current = validMoves;
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
        return; // Don't touch turnStartedAtRef — Firebase adjusts on resume
      }

      const elapsed = Math.floor((Date.now() - turnStartedAtRef.current) / 1000);
      const remaining = TURN_SECONDS - elapsed;
      setTimeLeft(Math.max(0, remaining));

      const isCurrentPlayer = myColorRef.current === currentTurnRef.current;

      // Primary: current player auto-acts at 0s
      // Don't auto-act while power-up modals are open
      // Don't auto-act if elapsed < 2s (prevents stale turnStartedAt from triggering on turn transition)
      const hasModalOpen = !!goldenMushroomRef.current || !!pendingDiscardRef.current;
      if (
        remaining <= 0 &&
        elapsed >= 2 &&
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

      // Backup: any non-current client force-skips after 45s total (safety net for disconnects or bot glitches)
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
          // Tick buffs since turn is advancing
          let backupBuffs = activeBuffsRef.current;
          if (powerUpsEnabledRef.current) {
            backupBuffs = tickBuffs(backupBuffs, colorIndex(curColor));
          }
          const update: LudoMoveUpdate = {
            tokens: serializeTokens(currentTokens),
            currentTurn: nextColor,
            turnPhase: 'roll',
            diceValue: null,
            consecutiveSixes: 0,
            winner: null,
            finishOrder: curFinishOrder.join(','),
            turnStartedAt: getServerTimestamp(),
            rollStats: serializeRollStats(rollStatsRef.current),
            ...(powerUpsEnabledRef.current ? {
              powerUps: serializeInventory(inventoryRef.current),
              activeBuffs: serializeBuffs(backupBuffs),
              boardEffects: serializeBoardEffects(boardEffectsRef.current),
              coins: serializeCoins(coinsRef.current),
              mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
              flag: serializeFlag(flagStateRef.current),
            } : {}),
          };
          makeMove(gc, curColor, update).catch(() => { moveInFlightRef.current = false; });
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gamePhase]);

  // --- Single player bot AI ---

  const botTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!isSinglePlayer || gamePhase !== 'playing' || winner || gamePaused) return;
    if (introPhase === 'running') return;

    const isBotTurn = botColorsRef.current.has(currentTurn);
    if (!isBotTurn) return;

    // Clear any existing bot timer
    clearTimeout(botTimerRef.current);

    const botDelay = 600 + Math.random() * 400; // 600-1000ms to feel natural

    if (turnPhase === 'roll') {
      // Bot rolls dice — but first, try to use a before-roll power-up
      botTimerRef.current = setTimeout(() => {
        if (currentTurnRef.current !== currentTurn || turnPhaseRef.current !== 'roll') return;
        if (moveInFlightRef.current || isRollingRef.current) return;

        // --- Bot before-roll power-up usage ---
        // Skip power-ups when all tokens are at base — bot needs a clean 6 to deploy,
        // and power-ups like bullet-bill (needs track token), golden-mushroom (risky),
        // and super-mushroom (may not produce effective 6) would waste the turn.
        if (powerUpsEnabledRef.current) {
          const botTokenIndices = getColorTokenIndices(currentTurn);
          const allAtBase = botTokenIndices.every(i => tokensRef.current[i] === 'base');

          const botInv = getInventoryForColor(inventoryRef.current, currentTurn);
          for (let slot = 0; slot < botInv.length; slot++) {
            const puId = botInv[slot];
            if (!puId) continue;
            const def = POWER_UPS[puId];
            if (def.timing !== 'before-roll') continue;

            // Don't waste power-ups when all tokens are stuck at base
            if (allAtBase && (puId === 'super-mushroom' || puId === 'golden-mushroom' || puId === 'bullet-bill')) continue;

            // star and lightning-bolt: activate buff via makeMove, then return
            // (the state update will re-trigger this useEffect for the actual roll)
            if (puId === 'star') {
              const newInv = removeFromInventory(inventoryRef.current, currentTurn, slot);
              const newBuffs = [...activeBuffsRef.current, { type: 'star' as const, playerColorIdx: colorIndex(currentTurn), duration: 2 }];
              const gc = gameCodeRef.current;
              if (gc) {
                moveInFlightRef.current = true;
                makeMove(gc, currentTurn, {
                  tokens: serializeTokens(tokensRef.current),
                  currentTurn: currentTurn,
                  turnPhase: 'roll',
                  diceValue: null,
                  consecutiveSixes: consecutiveSixesRef.current,
                  winner: null,
                  finishOrder: finishOrderRef.current.join(','),
                  turnStartedAt: getServerTimestamp(),
                  powerUps: serializeInventory(newInv),
                  activeBuffs: serializeBuffs(newBuffs),
                  boardEffects: serializeBoardEffects(boardEffectsRef.current),
                  coins: serializeCoins(coinsRef.current),
                  mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                  flag: serializeFlag(flagStateRef.current),
                }).catch(() => { moveInFlightRef.current = false; });
              }
              return;
            }

            if (puId === 'lightning-bolt') {
              const newInv = removeFromInventory(inventoryRef.current, currentTurn, slot);
              const newBuffs = [...activeBuffsRef.current];
              const activePlayers = TURN_ORDER.slice(0, activePlayerCountRef.current);
              for (const c of activePlayers) {
                if (c !== currentTurn) {
                  newBuffs.push({ type: 'lightning' as const, playerColorIdx: colorIndex(c), duration: 2 });
                }
              }
              const gc = gameCodeRef.current;
              if (gc) {
                moveInFlightRef.current = true;
                makeMove(gc, currentTurn, {
                  tokens: serializeTokens(tokensRef.current),
                  currentTurn: currentTurn,
                  turnPhase: 'roll',
                  diceValue: null,
                  consecutiveSixes: consecutiveSixesRef.current,
                  winner: null,
                  finishOrder: finishOrderRef.current.join(','),
                  turnStartedAt: getServerTimestamp(),
                  powerUps: serializeInventory(newInv),
                  activeBuffs: serializeBuffs(newBuffs),
                  boardEffects: serializeBoardEffects(boardEffectsRef.current),
                  coins: serializeCoins(coinsRef.current),
                  mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                  flag: serializeFlag(flagStateRef.current),
                }).catch(() => { moveInFlightRef.current = false; });
              }
              return;
            }

            // super-mushroom, golden-mushroom, bullet-bill: set activePowerUp so
            // the roll handler picks it up, remove from inventory, then proceed to roll
            if (puId === 'super-mushroom' || puId === 'golden-mushroom' || puId === 'bullet-bill') {
              const newInv = removeFromInventory(inventoryRef.current, currentTurn, slot);
              setActivePowerUp({ id: puId, slot });
              activePowerUpRef.current = { id: puId, slot }; // Sync ref immediately for handleRollDice
              const gc = gameCodeRef.current;
              if (gc) {
                moveInFlightRef.current = true;
                makeMove(gc, currentTurn, {
                  tokens: serializeTokens(tokensRef.current),
                  currentTurn: currentTurn,
                  turnPhase: 'roll',
                  diceValue: null,
                  consecutiveSixes: consecutiveSixesRef.current,
                  winner: null,
                  finishOrder: finishOrderRef.current.join(','),
                  turnStartedAt: getServerTimestamp(),
                  powerUps: serializeInventory(newInv),
                  activeBuffs: serializeBuffs(activeBuffsRef.current),
                  boardEffects: serializeBoardEffects(boardEffectsRef.current),
                  coins: serializeCoins(coinsRef.current),
                  mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                  flag: serializeFlag(flagStateRef.current),
                }).catch(() => { moveInFlightRef.current = false; });
              }
              // Don't return — fall through to roll after inventory update is sent
              // Actually we must return and let the state update re-trigger with activePowerUp set
              return;
            }

            // Skip passive or unknown timing items
          }
        }

        handleRollDiceRef.current();
      }, botDelay);
    } else if (turnPhase === 'move') {
      // Bot picks a move — but first, try to use an after-roll power-up
      botTimerRef.current = setTimeout(() => {
        if (currentTurnRef.current !== currentTurn || turnPhaseRef.current !== 'move') return;
        if (moveInFlightRef.current) return;

        // --- Bot after-roll power-up usage ---
        if (powerUpsEnabledRef.current) {
          const botInv = getInventoryForColor(inventoryRef.current, currentTurn);
          for (let slot = 0; slot < botInv.length; slot++) {
            const puId = botInv[slot];
            if (!puId) continue;
            const def = POWER_UPS[puId];
            if (def.timing !== 'after-roll') continue;

            const currentTokens = tokensRef.current;
            const newInv = removeFromInventory(inventoryRef.current, currentTurn, slot);

            if (puId === 'green-shell' || puId === 'red-shell') {
              const shooterIdx = findFurthestTrackToken(currentTokens, currentTurn);
              const shooterTrack = shooterIdx !== null ? parseInt(currentTokens[shooterIdx].split('-')[1]) : null;
              if (shooterTrack === null) continue; // no token on track, try next power-up
              const target = puId === 'green-shell'
                ? findFirstOpponentAhead(currentTokens, shooterTrack, currentTurn)
                : findNearestOpponentBehind(currentTokens, shooterTrack, currentTurn);
              if (target === null) continue; // no target, try next power-up
              let newTokens = knockBack(currentTokens, target, 3);
              // Capture any opponent at the knockback landing position
              const botShellCapture = captureAfterKnockback(newTokens, target);
              newTokens = botShellCapture.tokens;
              let shellFlag = flagStateRef.current;
              if (!shellFlag.used && shellFlag.carrier !== null && botShellCapture.capturedIndices.includes(shellFlag.carrier)) {
                const knockPos = newTokens[target];
                if (knockPos.startsWith('track-')) {
                  shellFlag = { cell: parseInt(knockPos.split('-')[1]), carrier: null, used: false };
                }
              } else if (!shellFlag.used && shellFlag.carrier === target) {
                const newPos = newTokens[target];
                if (newPos.startsWith('track-')) {
                  shellFlag = { cell: parseInt(newPos.split('-')[1]), carrier: null, used: false };
                } else if (newPos.startsWith('final-')) {
                  const targetColor = getTokenColor(target);
                  shellFlag = { cell: ENTRY_CELLS[targetColor], carrier: null, used: false };
                }
              }
              const gc = gameCodeRef.current;
              if (gc) {
                moveInFlightRef.current = true;
                makeMove(gc, currentTurn, {
                  tokens: serializeTokens(newTokens),
                  currentTurn: currentTurn,
                  turnPhase: 'move',
                  diceValue: diceValueRef.current,
                  consecutiveSixes: consecutiveSixesRef.current,
                  winner: null,
                  finishOrder: finishOrderRef.current.join(','),
                  turnStartedAt: turnStartedAtRef.current,
                  powerUps: serializeInventory(newInv),
                  activeBuffs: serializeBuffs(activeBuffsRef.current),
                  boardEffects: serializeBoardEffects(boardEffectsRef.current),
                  coins: serializeCoins(coinsRef.current),
                  mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                  flag: serializeFlag(shellFlag),
                }).catch(() => { moveInFlightRef.current = false; });
              }
              return;
            }

            if (puId === 'blue-shell') {
              const target = findLeaderLeadToken(currentTokens, activePlayerCountRef.current, currentTurn);
              if (target === null) continue; // no leader target, try next power-up
              let newTokens = knockBack(currentTokens, target, 5);
              // Capture any opponent at the knockback landing position
              const botBlueCapture = captureAfterKnockback(newTokens, target);
              newTokens = botBlueCapture.tokens;
              let bsFlag = flagStateRef.current;
              if (!bsFlag.used && bsFlag.carrier !== null && botBlueCapture.capturedIndices.includes(bsFlag.carrier)) {
                const knockPos = newTokens[target];
                if (knockPos.startsWith('track-')) {
                  bsFlag = { cell: parseInt(knockPos.split('-')[1]), carrier: null, used: false };
                }
              } else if (!bsFlag.used && bsFlag.carrier === target) {
                const newPos = newTokens[target];
                if (newPos.startsWith('track-')) {
                  bsFlag = { cell: parseInt(newPos.split('-')[1]), carrier: null, used: false };
                } else if (newPos.startsWith('final-')) {
                  const targetColor = getTokenColor(target);
                  bsFlag = { cell: ENTRY_CELLS[targetColor], carrier: null, used: false };
                }
              }
              const gc = gameCodeRef.current;
              if (gc) {
                moveInFlightRef.current = true;
                makeMove(gc, currentTurn, {
                  tokens: serializeTokens(newTokens),
                  currentTurn: currentTurn,
                  turnPhase: 'move',
                  diceValue: diceValueRef.current,
                  consecutiveSixes: consecutiveSixesRef.current,
                  winner: null,
                  finishOrder: finishOrderRef.current.join(','),
                  turnStartedAt: turnStartedAtRef.current,
                  powerUps: serializeInventory(newInv),
                  activeBuffs: serializeBuffs(activeBuffsRef.current),
                  boardEffects: serializeBoardEffects(boardEffectsRef.current),
                  coins: serializeCoins(coinsRef.current),
                  mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                  flag: serializeFlag(bsFlag),
                }).catch(() => { moveInFlightRef.current = false; });
              }
              return;
            }

            if (puId === 'warp-pipe') {
              const warpToken = findFurthestTrackToken(currentTokens, currentTurn);
              if (warpToken === null) continue; // no token on track, try next power-up
              const trackPos = parseInt(currentTokens[warpToken].split('-')[1]);
              const safeZone = findNextSafeZone(trackPos, currentTurn);
              const newTokens = [...currentTokens] as TokenPosition[];
              newTokens[warpToken] = `track-${safeZone}`;
              const gc = gameCodeRef.current;
              if (gc) {
                moveInFlightRef.current = true;
                makeMove(gc, currentTurn, {
                  tokens: serializeTokens(newTokens),
                  currentTurn: currentTurn,
                  turnPhase: 'move',
                  diceValue: diceValueRef.current,
                  consecutiveSixes: consecutiveSixesRef.current,
                  winner: null,
                  finishOrder: finishOrderRef.current.join(','),
                  turnStartedAt: turnStartedAtRef.current,
                  powerUps: serializeInventory(newInv),
                  activeBuffs: serializeBuffs(activeBuffsRef.current),
                  boardEffects: serializeBoardEffects(boardEffectsRef.current),
                  coins: serializeCoins(coinsRef.current),
                  mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                  flag: serializeFlag(flagStateRef.current),
                }).catch(() => { moveInFlightRef.current = false; });
              }
              return;
            }

            if (puId === 'cape-feather') {
              const newBuffs = [...activeBuffsRef.current, { type: 'cape' as const, playerColorIdx: colorIndex(currentTurn), duration: 1 }];
              const gc = gameCodeRef.current;
              if (gc) {
                moveInFlightRef.current = true;
                makeMove(gc, currentTurn, {
                  tokens: serializeTokens(currentTokens),
                  currentTurn: currentTurn,
                  turnPhase: 'move',
                  diceValue: diceValueRef.current,
                  consecutiveSixes: consecutiveSixesRef.current,
                  winner: null,
                  finishOrder: finishOrderRef.current.join(','),
                  turnStartedAt: getServerTimestamp(),
                  powerUps: serializeInventory(newInv),
                  activeBuffs: serializeBuffs(newBuffs),
                  boardEffects: serializeBoardEffects(boardEffectsRef.current),
                  coins: serializeCoins(coinsRef.current),
                  mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                  flag: serializeFlag(flagStateRef.current),
                }).catch(() => { moveInFlightRef.current = false; });
              }
              return;
            }

            if (puId === 'banana-peel') {
              // Smart placement: place banana ahead of nearest opponent (trap them)
              const botTrackToken = findFurthestTrackToken(currentTokens, currentTurn);
              let placedCell: number | null = null;
              if (botTrackToken !== null) {
                const botTrack = parseInt(currentTokens[botTrackToken].split('-')[1]);
                // Look for nearest opponent behind and place banana in their path
                const nearOpp = findNearestOpponentBehind(currentTokens, botTrack, currentTurn);
                if (nearOpp !== null) {
                  const oppPos = currentTokens[nearOpp];
                  if (oppPos.startsWith('track-')) {
                    const oppTrack = parseInt(oppPos.split('-')[1]);
                    // Place 3-5 cells ahead of opponent (likely roll landing zone)
                    // but verify the candidate is between opponent and bot (circular distance check)
                    const oppToBotDist = botTrack >= oppTrack
                      ? botTrack - oppTrack
                      : (TRACK_SIZE - oppTrack) + botTrack;
                    for (const offset of [3, 4, 2, 5]) {
                      if (offset >= oppToBotDist) continue; // Would be past the bot — useless
                      const candidate = ((oppTrack - 1 + offset) % TRACK_SIZE) + 1;
                      if (!SAFE_ZONES.has(candidate)) {
                        placedCell = candidate;
                        break;
                      }
                    }
                  }
                }
                // Fallback: place at own position
                if (placedCell === null) {
                  const fallback = parseInt(currentTokens[botTrackToken].split('-')[1]);
                  if (!SAFE_ZONES.has(fallback)) placedCell = fallback;
                }
              }
              if (placedCell === null || SAFE_ZONES.has(placedCell)) continue; // can't place, try next power-up
              const newEffects = [...boardEffectsRef.current, { type: 'banana' as const, cell: placedCell, ownerColorIdx: colorIndex(currentTurn) }];
              const gc = gameCodeRef.current;
              if (gc) {
                moveInFlightRef.current = true;
                makeMove(gc, currentTurn, {
                  tokens: serializeTokens(currentTokens),
                  currentTurn: currentTurn,
                  turnPhase: 'move',
                  diceValue: diceValueRef.current,
                  consecutiveSixes: consecutiveSixesRef.current,
                  winner: null,
                  finishOrder: finishOrderRef.current.join(','),
                  turnStartedAt: getServerTimestamp(),
                  powerUps: serializeInventory(newInv),
                  activeBuffs: serializeBuffs(activeBuffsRef.current),
                  boardEffects: serializeBoardEffects(newEffects),
                  coins: serializeCoins(coinsRef.current),
                  mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                  flag: serializeFlag(flagStateRef.current),
                }).catch(() => { moveInFlightRef.current = false; });
              }
              return;
            }

            // Unknown after-roll item — skip it
          }
        }

        const dice = diceValueRef.current;
        if (dice === null) return;
        const computedMoves = getValidMoves(tokensRef.current, currentTurn, dice);
        if (computedMoves.length === 0) {
          // Force skip to prevent deadlock — safety net for post-power-up board changes
          const gc = gameCodeRef.current;
          if (gc) {
            moveInFlightRef.current = true;
            const finished = getFinishedColors(tokensRef.current, activePlayerCountRef.current);
            const curSixes = consecutiveSixesRef.current;
            let next: LudoColor;
            let nextSixes: number;
            // Respect bonus turn on effective 6 (same logic as handleRollDice no-moves path)
            if (isEffectiveSix(dice) && curSixes < 2) {
              next = currentTurn;
              nextSixes = curSixes + 1;
            } else {
              next = findNextActivePlayer(currentTurn, activePlayerCountRef.current, finished);
              nextSixes = 0;
            }
            // Tick buffs when turn actually advances
            let skipBuffs = activeBuffsRef.current;
            if (powerUpsEnabledRef.current && next !== currentTurn) {
              skipBuffs = tickBuffs(skipBuffs, colorIndex(currentTurn));
            }
            makeMove(gc, currentTurn, {
              tokens: serializeTokens(tokensRef.current),
              currentTurn: next,
              turnPhase: 'roll',
              diceValue: dice,
              consecutiveSixes: nextSixes,
              winner: null,
              finishOrder: finishOrderRef.current.join(','),
              turnStartedAt: getServerTimestamp(),
              rollStats: serializeRollStats(rollStatsRef.current),
              ...(powerUpsEnabledRef.current ? {
                powerUps: serializeInventory(inventoryRef.current),
                activeBuffs: serializeBuffs(skipBuffs),
                boardEffects: serializeBoardEffects(boardEffectsRef.current),
                coins: serializeCoins(coinsRef.current),
                mysteryBoxes: serializeMysteryBoxes(mysteryBoxesRef.current),
                flag: serializeFlag(flagStateRef.current),
              } : {}),
            }).catch(() => { moveInFlightRef.current = false; });
          }
          return;
        }

        // Smart AI: score each valid move and pick the best
        const entries = computedMoves.map(m => [m.tokenIndex, m.newPosition] as const);
        let bestIdx = entries[0][0];
        let bestScore = -Infinity;

        // Pre-compute leader once for all move evaluations
        const botLeader = getLeaderColor(tokensRef.current, activePlayerCountRef.current, currentTurn);

        for (const [tokenIdx, targetPos] of entries) {
          const score = scoreBotMove(
            tokenIdx, targetPos, tokensRef.current, currentTurn,
            activePlayerCountRef.current, boardEffectsRef.current, flagStateRef.current, botLeader
          );
          if (score > bestScore) {
            bestScore = score;
            bestIdx = tokenIdx;
          }
        }

        handleMoveTokenRef.current(bestIdx);
      }, botDelay);
    }

    return () => clearTimeout(botTimerRef.current);
  // tokens: re-triggers after moves / power-up writes that change board state
  // inventory: re-triggers after bot consumes a power-up (star/lightning don't change tokens/turnPhase)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSinglePlayer, gamePhase, winner, gamePaused, currentTurn, turnPhase, myColor, introPhase, tokens, inventory]);

  // --- Bot auto-pick for Golden Mushroom modal ---
  useEffect(() => {
    if (!isSinglePlayer || !goldenMushroomRolls) return;
    const isBotTurn = botColorsRef.current.has(currentTurn);
    if (!isBotTurn) return;

    // Smart pick: highest roll, but avoid 6/12 if at 2 consecutive sixes (would waste turn)
    const timer = setTimeout(() => {
      const curSixes = consecutiveSixesRef.current;
      let options = [...goldenMushroomRolls];
      if (curSixes >= 2) {
        // Filter out effective-6 values to avoid 3-sixes penalty
        const safe = options.filter(r => !isEffectiveSix(r));
        if (safe.length > 0) options = safe;
      }
      const best = Math.max(...options);
      handleGoldenMushroomPick(best);
    }, 400);
    return () => clearTimeout(timer);
  }, [isSinglePlayer, currentTurn, goldenMushroomRolls, handleGoldenMushroomPick]);

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

      // Build full lap path: TRACK_SIZE cells starting from this color's start position
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
          scheduleRenderTick();
        }, staggerDelay + step * INTRO_STEP_MS);
        introTimersRef.current.push(timer);
      }

      // After completing the lap, remove the ghost token
      const totalDuration = staggerDelay + path.length * INTRO_STEP_MS;
      const doneTimer = setTimeout(() => {
        introTokenPositions.current.delete(color);
        completedColors++;
        scheduleRenderTick();
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

  // Animated transition from lobby/waiting → playing
  const transitionToPlaying = useCallback(() => {
    if (boardTransitionTimer.current) return; // already transitioning
    if (gamePhaseRef.current === 'playing') return; // already playing

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      setGamePhase('playing');
      gamePhaseRef.current = 'playing';
      return;
    }

    // Capture which phase we're leaving, then switch to playing immediately
    // Both the exit overlay and board entrance render simultaneously
    setTransitionFromPhase(gamePhaseRef.current as 'lobby' | 'waiting');
    setBoardTransition('entering');
    setGamePhase('playing');
    gamePhaseRef.current = 'playing';

    // Remove the exit overlay after it fades out (matches 600ms CSS animation)
    boardTransitionTimer.current = setTimeout(() => {
      setTransitionFromPhase(null);
      // Clear entering class after remaining entrance animations finish
      // (baseBlue is the last: 400ms delay + 400ms duration = 800ms from start)
      boardTransitionTimer.current = setTimeout(() => {
        setBoardTransition(null);
        boardTransitionTimer.current = null;
      }, 300);
    }, 600);
  }, []);

  // --- Lobby handlers ---

  const handleCreateGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const code = await createGame(sessionId, userName, marioMode);
      setGameCode(code);
      setMyColor('red');
      setGamePhase('waiting'); gamePhaseRef.current = 'waiting';
      prevTokensRef.current = 'bas'.repeat(16);
    } catch {
      setError('Failed to create game. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, userName, marioMode]);

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
      const gameInProgress = state.startedAt && state.tokens !== 'bas'.repeat(16);
      if (gameInProgress) {
        prevTokensRef.current = state.tokens;
        setIntroPhase('done');
        introPhaseRef.current = 'done';
      } else {
        prevTokensRef.current = 'bas'.repeat(16);
      }
      if (state.startedAt) {
        transitionToPlaying();
      } else {
        setGamePhase('waiting'); gamePhaseRef.current = 'waiting';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode, sessionId, userName, transitionToPlaying]);

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
      setActivePlayerCount(state.playerCount);
      const gameInProgress = state.startedAt && state.tokens !== 'bas'.repeat(16);
      if (gameInProgress) {
        prevTokensRef.current = state.tokens;
        setIntroPhase('done');
        introPhaseRef.current = 'done';
      } else {
        prevTokensRef.current = 'bas'.repeat(16);
      }
      if (state.startedAt) {
        transitionToPlaying();
      } else {
        setGamePhase('waiting'); gamePhaseRef.current = 'waiting';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode, transitionToPlaying]);

  const handleNewGame = useCallback(async () => {
    const gc = gameCodeRef.current;
    if (!gc) return;
    try {
      moveInFlightRef.current = false;
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(autoMoveRef.current);
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
      setRollStats(deserializeRollStats(initRollStats()));
      rollStatsRef.current = deserializeRollStats(initRollStats());
      homeStuckRolls.current = {};
      pityThreshold.current = {};
      lastTwoRolls.current = {};
      sixCounts.current = {};
      totalRollCounts.current = {};
      clearTimeout(botTimerRef.current);
      setShowGameOver(false);
      clearTimeout(gameOverTimerRef.current);
      // Reset power-up state
      setInventory([[null], [null], [null], [null]]);
      setBoardEffects([]);
      setActiveBuffs([]);
      setCoins([0, 0, 0, 0]);
      setPendingDiscard(null);
      setGoldenMushroomRolls(null);
      setActivePowerUp(null);
      setFlagState({ cell: null, carrier: null, used: true }); // Will be re-set from Firebase on reset
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
    setRollStats(deserializeRollStats(initRollStats()));
    rollStatsRef.current = deserializeRollStats(initRollStats());
    setGamePhase('lobby'); gamePhaseRef.current = 'lobby';
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
    homeStuckRolls.current = {};
    pityThreshold.current = {};
    lastTwoRolls.current = {};
    sixCounts.current = {};
    totalRollCounts.current = {};
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
    setActivePowerUp(null);
    setFlagState({ cell: null, carrier: null, used: true });
    setGamePaused(false);
    gamePausedRef.current = false;
    setIsSinglePlayer(false);
    isSinglePlayerRef.current = false;
    setBotColors(new Set());
    botColorsRef.current = new Set();
    clearTimeout(botTimerRef.current);
    // Clear any in-flight board transition
    if (boardTransitionTimer.current) {
      clearTimeout(boardTransitionTimer.current);
      boardTransitionTimer.current = null;
    }
    setBoardTransition(null);
    setTransitionFromPhase(null);
  }, []);

  const handleAddBot = useCallback(async (color: LudoColor) => {
    if (!gameCode) return;
    try { await addBot(gameCode, color); } catch { /* silent */ }
  }, [gameCode]);

  const handleRemoveBot = useCallback(async (color: LudoColor) => {
    if (!gameCode) return;
    try { await removeBot(gameCode, color); } catch { /* silent */ }
  }, [gameCode]);

  const handleStartGame = useCallback(async () => {
    if (!gameCode) return;
    setIsLoading(true);
    try {
      await startGame(gameCode);
    } catch {
      setError('Failed to start game.');
    } finally {
      setIsLoading(false);
    }
  }, [gameCode]);

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

  const isMarioNaming = powerUpsEnabled || marioMode;
  const displayName = (color: LudoColor) =>
    isMarioNaming ? MARIO_NAMES[color] : (playerNames[color] || COLOR_LABELS[color]);

  const statusMessage = isSpectating
    ? winner
      ? `${displayName(winner)} wins!`
      : `${displayName(currentTurn)}'s turn`
    : winner
      ? (winner === myColor ? 'You win!' : `${displayName(winner)} wins!`)
      : isMyTurn
        ? (turnPhase === 'roll' ? 'Your turn — Roll!' : `Rolled ${diceValue} — Pick a token`)
        : `${displayName(currentTurn)}'s turn`;

  // --- Pre-computed render data (avoids recalculating per cell) ---

  const activeMysteryBoxSet = useMemo(
    () => powerUpsEnabled ? getActiveMysteryBoxCells(mysteryBoxes) : new Set<number>(),
    [powerUpsEnabled, mysteryBoxes]
  );
  const bananaCellSet = useMemo(
    () => powerUpsEnabled
      ? new Set(boardEffects.filter(e => e.type === 'banana').map(e => e.cell))
      : new Set<number>(),
    [powerUpsEnabled, boardEffects]
  );

  // --- Render helpers ---

  function renderTrackCell(cellNum: number) {
    const [row, col] = TRACK_COORDS[cellNum];
    const isSafe = SAFE_ZONES.has(cellNum);
    const startColor = START_CELL_COLORS[cellNum];
    const entryColor = ENTRY_ARROW_COLORS[cellNum];
    const isMysteryBox = activeMysteryBoxSet.has(cellNum);
    const hasBanana = bananaCellSet.has(cellNum);
    const hasFlag = powerUpsEnabled && !flagState.used && flagState.cell === cellNum && flagState.carrier === null;

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
      hasFlag ? styles.flagCell : '',
    ].filter(Boolean).join(' ');

    return (
      <div
        key={`track-${cellNum}`}
        className={classes}
        style={{ gridRow: row, gridColumn: col }}
      >
        {hasBanana && <span className={styles.bananaOverlay}>{'🍌'}</span>}
        {hasFlag && <span className={styles.flagOverlay}>{'🏁'}</span>}
      </div>
    );
  }

  // Positions for finished tokens in the home center area (piled up per color quadrant)
  const HOME_TOKEN_OFFSETS: [number, number][] = [
    [-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25],
  ];
  const HOME_COLOR_CENTER: Record<LudoColor, [number, number]> = {
    red: [7.7, 7.7], green: [7.7, 8.3], yellow: [8.3, 8.3], blue: [8.3, 7.7],
  };

  function renderToken(idx: number) {
    const pos = tokens[idx];
    const animCoords = tokenAnimPos.current.get(idx);

    // Tokens at base are rendered in renderBaseQuadrant; skip here unless animating
    if (pos === 'base' && !animCoords) return null;

    // Finished tokens (final-6): render as actual counters piled in home area
    if (pos === 'final-6' && !animCoords) {
      const color = getTokenColor(idx);
      const indices = getColorTokenIndices(color);
      const finishedBefore = indices.filter(i => i < idx && tokens[i] === 'final-6').length;
      const center = HOME_COLOR_CENTER[color];
      const offset = HOME_TOKEN_OFFSETS[finishedBefore % HOME_TOKEN_OFFSETS.length];
      const row = center[0] + offset[0];
      const col = center[1] + offset[1];
      return (
        <div
          key={`token-${idx}`}
          className={[
            styles.token,
            TOKEN_STYLE[color],
            powerUpsEnabled ? styles.marioToken : '',
            styles.tokenFinished,
          ].filter(Boolean).join(' ')}
          style={{
            left: `${(col - 1) * CELL_PCT + TOKEN_PAD_PCT}%`,
            top: `${(row - 1) * CELL_PCT + TOKEN_PAD_PCT}%`,
          }}
        />
      );
    }

    const color = getTokenColor(idx);
    const localIdx = idx % TOKENS_PER_PLAYER;
    const isStepping = !!animCoords;
    const stepParity = tokenAnimParity.current.get(idx) ?? 0;
    const isClickable = validMoves.has(idx) && isMyTurn && turnPhase === 'move' && !isStepping;
    const isArriving = lastMovedToken === idx && !isStepping;
    const inCorridor = pos.startsWith('final-') && pos !== 'final-6';
    const carryingFlag = powerUpsEnabled && !flagState.used && flagState.carrier === idx;

    const coords = animCoords || getTokenCoords(pos, idx);
    if (!coords) return null;

    const [dx, dy] = isStepping ? [0, 0] : getTokenOffset(tokens, idx);

    return (
      <div
        key={`token-${idx}`}
        className={[
          styles.token,
          TOKEN_STYLE[color],
          powerUpsEnabled ? styles.marioToken : '',
          isClickable ? styles.tokenClickable : '',
          isArriving ? styles.tokenArriving : '',
          isStepping ? (stepParity ? styles.tokenSteppingB : styles.tokenSteppingA) : '',
          inCorridor && !isStepping ? styles.tokenInCorridor : '',
          carryingFlag ? styles.tokenCarryingFlag : '',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${(coords[1] - 1) * CELL_PCT + TOKEN_PAD_PCT + dx}%`,
          top: `${(coords[0] - 1) * CELL_PCT + TOKEN_PAD_PCT + dy}%`,
        }}
        onClick={() => isClickable && handleMoveToken(idx)}
        onKeyDown={(e) => { if (isClickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleMoveToken(idx); } }}
        role="button"
        tabIndex={isClickable ? 0 : -1}
        aria-label={`${COLOR_LABELS[color]} token ${localIdx + 1}${isClickable ? ' (can move)' : ''}${carryingFlag ? ' (carrying flag)' : ''}`}
      >
        {carryingFlag && <span className={styles.tokenFlagIndicator}>{'🏁'}</span>}
      </div>
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
                  powerUpsEnabled ? styles.marioToken : '',
                  isClickable ? styles.baseTokenClickable : '',
                ].filter(Boolean).join(' ')}
                onClick={() => isClickable && handleMoveToken(idx)}
                onKeyDown={(e) => { if (isClickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleMoveToken(idx); } }}
                role="button"
                tabIndex={isClickable ? 0 : -1}
                aria-label={`${COLOR_LABELS[color]} token ${localIdx + 1} (in base)${isClickable ? ' — can deploy' : ''}`}
              />
            );
          })}
        </div>
      </div>
    );
  }

  // Home counts removed — finished tokens now render as actual counters in the home area

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
        {gamePhase === 'playing' && !winner && !isSpectating && (
          <button className={`${styles.closeBtn} ${gamePaused ? styles.pauseBtnActive : ''}`} onClick={() => gameCode && toggleGamePause(gameCode)} aria-label={gamePaused ? 'Resume game' : 'Pause game'}>
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
        )}
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close Ludo">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {gamePaused && gamePhase === 'playing' && (
        <div className={styles.pauseOverlay} onClick={() => !isSpectating && gameCode && toggleGamePause(gameCode)} onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !isSpectating && gameCode) { e.preventDefault(); toggleGamePause(gameCode); } }} role="button" tabIndex={0} aria-label="Resume game">
          <svg className={styles.pauseIcon} width="120" height="120" viewBox="0 0 120 120" fill="none">
            <circle cx="60" cy="60" r="56" stroke="white" strokeWidth="4" opacity="0.3" />
            <rect x="38" y="32" width="14" height="56" rx="4" fill="white" />
            <rect x="68" y="32" width="14" height="56" rx="4" fill="white" />
          </svg>
          <div className={styles.pauseText}>PAUSED</div>
          <div className={styles.pauseSubtext}>Tap anywhere to resume</div>
        </div>
      )}

      <div className={styles.gameArea}>

        {/* === LOBBY === */}
        {gamePhase === 'lobby' && (
          <div className={styles.lobby}>
            <button
              className={`${styles.marioModeBtn} ${marioMode ? styles.marioModeBtnActive : ''}`}
              onClick={() => setMarioMode(!marioMode)}
            >
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

        {/* === WAITING ROOM === */}
        {gamePhase === 'waiting' && (
          <div className={styles.lobby}>
            <div
              className={styles.gameCodeDisplay}
              onClick={() => {
                if (gameCode) {
                  navigator.clipboard.writeText(gameCode).then(() => showHint('Copied!'));
                }
              }}
              role="button"
              tabIndex={0}
              aria-label="Copy game code"
              title="Click to copy"
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && gameCode) { e.preventDefault(); navigator.clipboard.writeText(gameCode).then(() => showHint('Copied!')); } }}
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
              {TURN_ORDER.map(color => {
                const isMe = color === myColor;
                const player = playerNames[color];
                const isBot = player && player.startsWith('Bot ');
                const isEmpty = !player;
                const isHost = myColor === 'red';

                return (
                  <div
                    key={color}
                    className={[
                      styles.playerSlot,
                      isEmpty ? styles.playerSlotEmpty : '',
                      isEmpty && isHost ? styles.playerSlotClickable : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => {
                      if (isEmpty && isHost) handleAddBot(color);
                    }}
                    role={isEmpty && isHost ? 'button' : undefined}
                  >
                    <span className={styles.playerDot} style={{ background: COLOR_HEX[color] }} />
                    <span className={styles.playerSlotName}>
                      {isEmpty
                        ? (isHost ? 'Click to add bot' : 'Empty')
                        : displayName(color)}
                      {isMe && ' (you)'}
                    </span>
                    {isBot && isHost && (
                      <button
                        className={styles.removeBotBtn}
                        onClick={(e) => { e.stopPropagation(); handleRemoveBot(color); }}
                        aria-label={`Remove ${color} bot`}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12">
                          <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {(() => {
              const filledCount = TURN_ORDER.filter(c => !!playerNames[c]).length;
              const canStart = !!myColor && filledCount >= 2;
              return (
                <button
                  className={styles.createBtn}
                  onClick={handleStartGame}
                  disabled={!canStart || isLoading}
                  style={{ marginTop: 4 }}
                >
                  {isLoading ? 'Starting...' : filledCount < 2 ? 'Need 2+ players' : 'Start Game'}
                </button>
              );
            })()}
            <button className={styles.resetBtn} onClick={handleBackToLobby} style={{ marginTop: 4 }}>
              Back
            </button>
            {error && <div className={styles.errorText}>{error}</div>}
          </div>
        )}

        {/* === TRANSITION EXIT OVERLAY === */}
        {/* Transition overlay: covers the game area while board reveals underneath */}
        {transitionFromPhase && (
          <div className={styles.transitionOverlay} />
        )}

        {/* === PLAYING === */}
        {gamePhase === 'playing' && (
          <div className={`${styles.playingLayout} ${boardTransition === 'entering' ? styles.boardEntering : ''}`}>
            {/* Board column */}
            <div className={styles.boardColumn}>
              <div className={styles.boardWrapper}>
                <div className={styles.board}>
                  {/* Base quadrants */}
                  {TURN_ORDER.map(color => renderBaseQuadrant(color))}

                  {/* Center home */}
                  <div className={styles.home} />

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

                  {/* Track cells (all 56 including corner cells at arm junctions) */}
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
                    if (ef.type === 'puLightning') {
                      return (
                        <div
                          key={`lightning-${ef.ts}`}
                          className={styles.puLightningFlash}
                        />
                      );
                    }
                    if (ef.type === 'puShellHit' && ef.coords) {
                      return (
                        <div
                          key={`shellhit-${ef.ts}-${ef.coords[0]}-${ef.coords[1]}`}
                          className={styles.puShellHit}
                          style={{
                            left: `${(ef.coords[1] - 1) * CELL_PCT}%`,
                            top: `${(ef.coords[0] - 1) * CELL_PCT}%`,
                          }}
                        >{ef.emoji}</div>
                      );
                    }
                    if (ef.type === 'puWarp' && ef.coords) {
                      return (
                        <div
                          key={`warp-${ef.ts}-${ef.coords[0]}-${ef.coords[1]}`}
                          className={styles.puWarpSwirl}
                          style={{
                            left: `${(ef.coords[1] - 1) * CELL_PCT}%`,
                            top: `${(ef.coords[0] - 1) * CELL_PCT}%`,
                          }}
                        />
                      );
                    }
                    if (ef.type === 'puBuff') {
                      return (
                        <div
                          key={`buff-${ef.ts}-${ef.emoji}`}
                          className={styles.puBuffActivate}
                          style={{ color: COLOR_HEX[ef.color] }}
                        >{ef.emoji}</div>
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
                  disabled={!isMyTurn || turnPhase !== 'roll' || isRolling || !!winner || introPhase === 'running' || gamePaused}
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
                <div aria-live="polite" aria-atomic="true" className={styles.srOnly}>{statusHint ?? ''}</div>
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
                      {displayName(color)}
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
                      {TURN_ORDER.slice(0, activePlayerCount).map((color, ci) => {
                        const s = rollStats[ci] || { rolls: [0, 0, 0, 0, 0, 0], captures: 0 };
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
                  canUseBefore={isMyTurn && turnPhase === 'roll' && !isRolling && !winner && introPhase !== 'running' && !gamePaused}
                  canUseAfter={isMyTurn && turnPhase === 'move' && !isRolling && !winner && introPhase !== 'running' && !gamePaused}
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
                      <span key={`${buff.type}-${buff.playerColorIdx}-${buff.duration}`} className={styles.buffIndicator}>
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
                      {displayName(c)}
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
                      ? `${displayName(winner)} wins!`
                      : winner === myColor
                        ? 'You win!'
                        : `${displayName(winner)} wins!`}
                  </div>
                  {finishOrder.length > 1 && (
                    <div className={styles.gameOverFinishOrder}>
                      {finishOrder.map((c, i) => (
                        <span key={c} className={styles.gameOverPlace}>
                          <span className={styles.gameOverPlaceNum}>{i === 0 ? '1st' : i === 1 ? '2nd' : i === 2 ? '3rd' : '4th'}</span>
                          <span className={styles.gameOverPlaceDot} style={{ background: COLOR_HEX[c] }} />
                          {displayName(c)}
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
      </div>
    </div>
  );
}
