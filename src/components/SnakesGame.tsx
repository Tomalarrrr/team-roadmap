import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  createGame,
  joinGame,
  spectateGame,
  subscribeToGame,
  makeMove,
  resetGame,
  type SnakesGameState,
  type SnakesMoveUpdate,
} from '../snakesFirebase';
import {
  cellToGrid,
  cellToPercent,
  resolveMove,
  getNextTurn,
  checkWinner,
  computeHopPath,
  serializePositions,
  deserializePositions,
  serializeMoveLog,
  deserializeMoveLog,
  getTokenOffset,
  SNAKES,
  LADDERS,
  PLAYER_COLORS,
  COLOR_HEX,
  COLOR_LABELS,
  type PlayerColor,
  type MoveLogEntry,
} from '../utils/snakesLogic';
import styles from './SnakesGame.module.css';

// --- Constants ---

const TURN_SECONDS = 30;
const BACKUP_GRACE = 15;
const STEP_MS = 280;
const SLIDE_MS = 900;
const MAX_LOG_ENTRIES = 20;
const CELL_PCT = 10; // 100% / 10 cells
const TOKEN_SIZE_PCT = CELL_PCT * 0.45;

const TOKEN_STYLE: Record<PlayerColor, string> = {
  red: styles.tokenRed,
  green: styles.tokenGreen,
  blue: styles.tokenBlue,
  yellow: styles.tokenYellow,
  purple: styles.tokenPurple,
  orange: styles.tokenOrange,
  teal: styles.tokenTeal,
};

// Dice pips: [gridRow, gridCol] for 3x3 grid
const DICE_PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [[1, 3], [3, 1]],
  3: [[1, 3], [2, 2], [3, 1]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};

// Pre-computed board cell indices
const BOARD_CELLS = Array.from({ length: 100 }, (_, i) => i + 1);

// --- DiceFace ---

function DiceFace({ value }: { value: number }) {
  const pips = DICE_PIPS[value] || DICE_PIPS[1];
  return (
    <div className={styles.diceFace}>
      {pips.map(([r, c], i) => (
        <span key={i} className={styles.pip} style={{ gridRow: r, gridColumn: c }} />
      ))}
    </div>
  );
}

// --- SVG helpers for snakes and ladders ---

function cellCenter(cell: number): [number, number] {
  const [row, col] = cellToGrid(cell);
  return [col * 10 + 5, row * 10 + 5]; // x, y in percentage
}

// Ladder color palettes for variety
const LADDER_PALETTES = [
  { rail: '#8d6e3f', rung: '#a0845c', highlight: '#c4a872', shadow: '#5c4627' },
  { rail: '#6d4c2a', rung: '#8b6d45', highlight: '#b8956a', shadow: '#4a3219' },
  { rail: '#7b5b3a', rung: '#9e7e55', highlight: '#c9a76e', shadow: '#523c24' },
];

function renderLadderSVG(from: number, to: number, index: number) {
  const [x1, y1] = cellCenter(from);
  const [x2, y2] = cellCenter(to);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const railGap = 2.2;
  const nx = (-dy / len) * railGap;
  const ny = (dx / len) * railGap;
  const rungs = Math.max(3, Math.floor(len / 6));
  const palette = LADDER_PALETTES[index % LADDER_PALETTES.length];

  // Rail width for 3D look
  const railW = 1.0;
  const rungW = 0.7;

  return (
    <g key={`ladder-${from}-${to}`} opacity="0.78">
      {/* Shadow behind entire ladder */}
      <line x1={x1 + nx + 0.4} y1={y1 + ny + 0.4} x2={x2 + nx + 0.4} y2={y2 + ny + 0.4}
        stroke="rgba(0,0,0,0.15)" strokeWidth={railW + 0.6} strokeLinecap="round" />
      <line x1={x1 - nx + 0.4} y1={y1 - ny + 0.4} x2={x2 - nx + 0.4} y2={y2 - ny + 0.4}
        stroke="rgba(0,0,0,0.15)" strokeWidth={railW + 0.6} strokeLinecap="round" />

      {/* Left rail - dark side */}
      <line x1={x1 + nx} y1={y1 + ny} x2={x2 + nx} y2={y2 + ny}
        stroke={palette.shadow} strokeWidth={railW} strokeLinecap="round" />
      {/* Left rail - main face */}
      <line x1={x1 + nx - 0.15} y1={y1 + ny - 0.15} x2={x2 + nx - 0.15} y2={y2 + ny - 0.15}
        stroke={palette.rail} strokeWidth={railW * 0.7} strokeLinecap="round" />
      {/* Left rail - highlight edge */}
      <line x1={x1 + nx - 0.3} y1={y1 + ny - 0.3} x2={x2 + nx - 0.3} y2={y2 + ny - 0.3}
        stroke={palette.highlight} strokeWidth={railW * 0.2} strokeLinecap="round" strokeOpacity="0.6" />

      {/* Right rail - dark side */}
      <line x1={x1 - nx} y1={y1 - ny} x2={x2 - nx} y2={y2 - ny}
        stroke={palette.shadow} strokeWidth={railW} strokeLinecap="round" />
      {/* Right rail - main face */}
      <line x1={x1 - nx - 0.15} y1={y1 - ny - 0.15} x2={x2 - nx - 0.15} y2={y2 - ny - 0.15}
        stroke={palette.rail} strokeWidth={railW * 0.7} strokeLinecap="round" />
      {/* Right rail - highlight edge */}
      <line x1={x1 - nx - 0.3} y1={y1 - ny - 0.3} x2={x2 - nx - 0.3} y2={y2 - ny - 0.3}
        stroke={palette.highlight} strokeWidth={railW * 0.2} strokeLinecap="round" strokeOpacity="0.6" />

      {/* Rungs */}
      {Array.from({ length: rungs }, (_, i) => {
        const t = (i + 1) / (rungs + 1);
        const rx = x1 + dx * t;
        const ry = y1 + dy * t;
        return (
          <g key={i}>
            {/* Rung shadow */}
            <line
              x1={rx + nx + 0.3} y1={ry + ny + 0.3}
              x2={rx - nx + 0.3} y2={ry - ny + 0.3}
              stroke="rgba(0,0,0,0.12)" strokeWidth={rungW + 0.3} strokeLinecap="round" />
            {/* Rung main */}
            <line
              x1={rx + nx} y1={ry + ny} x2={rx - nx} y2={ry - ny}
              stroke={palette.rung} strokeWidth={rungW} strokeLinecap="round" />
            {/* Rung highlight */}
            <line
              x1={rx + nx - 0.15} y1={ry + ny - 0.15}
              x2={rx - nx - 0.15} y2={ry - ny - 0.15}
              stroke={palette.highlight} strokeWidth={rungW * 0.25} strokeLinecap="round" strokeOpacity="0.5" />
          </g>
        );
      })}
    </g>
  );
}

// Snake color palette for variety
const SNAKE_PALETTES = [
  { body: '#c62828', belly: '#ef5350', shadow: '#7f1818' },   // red
  { body: '#2e7d32', belly: '#66bb6a', shadow: '#1b4d1e' },   // green
  { body: '#6a1b9a', belly: '#ab47bc', shadow: '#3c0f57' },   // purple
  { body: '#e65100', belly: '#ff8a50', shadow: '#8c3100' },   // orange
  { body: '#00695c', belly: '#4db6ac', shadow: '#003d33' },   // teal
];

function renderSnakeSVG(from: number, to: number, index: number) {
  const [x1, y1] = cellCenter(from); // head (higher number)
  const [x2, y2] = cellCenter(to);   // tail (lower number)
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);

  // Direction unit vector and perpendicular
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  // Build a sinusoidal wavy path with multiple undulations
  const segments = 40;
  const waveAmp = Math.min(4.5, len * 0.12);
  const waveFreq = Math.max(2, Math.floor(len / 12));

  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Taper the wave at head and tail
    const taper = Math.sin(t * Math.PI);
    const wave = Math.sin(t * waveFreq * Math.PI * 2) * waveAmp * taper;
    const px = x1 + dx * t + nx * wave;
    const py = y1 + dy * t + ny * wave;
    points.push([px, py]);
  }

  // Build smooth cubic bezier through points
  function buildSmoothPath(pts: [number, number][]): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const next = pts[i + 1];
      const cp1x = curr[0] - (next[0] - prev[0]) / 6;
      const cp1y = curr[1] - (next[1] - prev[1]) / 6;
      if (i === 1) {
        d += ` Q ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${curr[0].toFixed(2)} ${curr[1].toFixed(2)}`;
      } else {
        d += ` S ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${curr[0].toFixed(2)} ${curr[1].toFixed(2)}`;
      }
    }
    const last = pts[pts.length - 1];
    d += ` L ${last[0].toFixed(2)} ${last[1].toFixed(2)}`;
    return d;
  }

  const bodyPath = buildSmoothPath(points);
  const palette = SNAKE_PALETTES[index % SNAKE_PALETTES.length];

  // Body thickness tapers from head to tail
  const headWidth = 2.2;
  const tailWidth = 0.6;

  // Head direction (from first two points)
  const hdx = points[1][0] - points[0][0];
  const hdy = points[1][1] - points[0][1];
  const hlen = Math.sqrt(hdx * hdx + hdy * hdy) || 1;
  const hux = hdx / hlen;
  const huy = hdy / hlen;
  const hnx = -huy;
  const hny = hux;

  // Head shape: rounded diamond
  const headSize = 2.0;
  const headX = points[0][0];
  const headY = points[0][1];

  // Eye positions
  const eyeOffX = hnx * 0.8;
  const eyeOffY = hny * 0.8;
  const eyeFwdX = -hux * 0.3;
  const eyeFwdY = -huy * 0.3;

  // Tongue
  const tongueX = headX - hux * headSize * 0.9;
  const tongueY = headY - huy * headSize * 0.9;
  const tongueForkL = `${(tongueX - hux * 1.8 + hnx * 0.6).toFixed(2)} ${(tongueY - huy * 1.8 + hny * 0.6).toFixed(2)}`;
  const tongueForkR = `${(tongueX - hux * 1.8 - hnx * 0.6).toFixed(2)} ${(tongueY - huy * 1.8 - hny * 0.6).toFixed(2)}`;
  const tongueMid = `${(tongueX - hux * 1.2).toFixed(2)} ${(tongueY - huy * 1.2).toFixed(2)}`;

  // Tail end (last two points)
  const tailPt = points[points.length - 1];

  return (
    <g key={`snake-${from}-${to}`} opacity="0.82">
      {/* Shadow layer */}
      <path d={bodyPath} fill="none" stroke={palette.shadow} strokeWidth={headWidth + 0.8}
        strokeLinecap="round" strokeOpacity="0.25" />
      {/* Main body - thick stroke */}
      <path d={bodyPath} fill="none" stroke={palette.body} strokeWidth={headWidth}
        strokeLinecap="round" />
      {/* Belly highlight stripe */}
      <path d={bodyPath} fill="none" stroke={palette.belly} strokeWidth={headWidth * 0.35}
        strokeLinecap="round" strokeOpacity="0.6" />

      {/* Head - wider ellipse */}
      <ellipse
        cx={headX} cy={headY}
        rx={headSize * 0.9} ry={headSize * 0.7}
        transform={`rotate(${Math.atan2(huy, hux) * 180 / Math.PI}, ${headX}, ${headY})`}
        fill={palette.body}
        stroke={palette.shadow} strokeWidth="0.3"
      />

      {/* Eyes */}
      <circle cx={headX + eyeOffX + eyeFwdX} cy={headY + eyeOffY + eyeFwdY} r="0.55" fill="#fff" />
      <circle cx={headX + eyeOffX + eyeFwdX} cy={headY + eyeOffY + eyeFwdY} r="0.28" fill="#111" />
      <circle cx={headX - eyeOffX + eyeFwdX} cy={headY - eyeOffY + eyeFwdY} r="0.55" fill="#fff" />
      <circle cx={headX - eyeOffX + eyeFwdX} cy={headY - eyeOffY + eyeFwdY} r="0.28" fill="#111" />

      {/* Forked tongue */}
      <path
        d={`M ${tongueX.toFixed(2)} ${tongueY.toFixed(2)} L ${tongueMid} L ${tongueForkL} M ${tongueMid} L ${tongueForkR}`}
        fill="none" stroke="#e53935" strokeWidth="0.35" strokeLinecap="round"
      />

      {/* Tail tip */}
      <circle cx={tailPt[0]} cy={tailPt[1]} r={tailWidth * 0.6} fill={palette.body} />
    </g>
  );
}

// --- Component ---

interface SnakesGameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

export function SnakesGame({ onClose, isSearchOpen }: SnakesGameProps) {
  const sessionId = sessionStorage.getItem('roadmap-user-id') || 'anonymous';
  const userName = sessionStorage.getItem('roadmap-user-name') || 'Player';

  // Multiplayer state
  const [gamePhase, setGamePhase] = useState<'lobby' | 'waiting' | 'playing'>('lobby');
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [mySlot, setMySlot] = useState<number | null>(null);
  const [isSpectating, setIsSpectating] = useState(false);
  const [playerNames, setPlayerNames] = useState<Record<number, string>>({});
  const [playerCount, setPlayerCount] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Game state (driven by Firebase)
  const [positions, setPositions] = useState<number[]>([]);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const [consecutiveSixes, setConsecutiveSixes] = useState(0);
  const [winner, setWinner] = useState<number | null>(null);
  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([]);
  const [activePlayerCount, setActivePlayerCount] = useState(2);

  // UI state
  const [isRolling, setIsRolling] = useState(false);
  const [rollingFace, setRollingFace] = useState(1);
  const [showBurst, setShowBurst] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(TURN_SECONDS);
  const [hasRolledThisTurn, setHasRolledThisTurn] = useState(false);
  const [, setRenderTick] = useState(0);

  // Drag state
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (window.innerWidth - 720) / 2),
    y: Math.max(0, (window.innerHeight - 600) / 2),
  }));
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Refs for timer/callback safety
  const moveInFlightRef = useRef(false);
  const isRollingRef = useRef(false);
  const turnStartedAtRef = useRef<number>(Date.now());
  const prevPositionsRef = useRef('');
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gameOverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cell-by-cell animation state
  const tokenAnimPos = useRef<Map<number, [number, number]>>(new Map());
  const tokenAnimParity = useRef<Map<number, number>>(new Map());
  const tokenAnimTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const tokenSlideClass = useRef<Map<number, string>>(new Map());
  const slideTimerRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const lastMovedPlayerRef = useRef<number | null>(null);
  const tokenEnteredBoard = useRef<Set<number>>(new Set());
  const isInitialLoadRef = useRef(true);

  // Mirrored refs for closure safety
  const gameCodeRef = useRef(gameCode);
  gameCodeRef.current = gameCode;
  const mySlotRef = useRef(mySlot);
  mySlotRef.current = mySlot;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const currentTurnRef = useRef(currentTurn);
  currentTurnRef.current = currentTurn;
  const diceValueRef = useRef(diceValue);
  diceValueRef.current = diceValue;
  const consecutiveSixesRef = useRef(consecutiveSixes);
  consecutiveSixesRef.current = consecutiveSixes;
  const winnerRef = useRef(winner);
  winnerRef.current = winner;
  const activePlayerCountRef = useRef(activePlayerCount);
  activePlayerCountRef.current = activePlayerCount;
  const moveLogRef = useRef(moveLog);
  moveLogRef.current = moveLog;

  const isMyTurn = mySlot !== null && currentTurn === mySlot && !winner && !isSpectating;
  const isAnimating = tokenAnimPos.current.size > 0 || tokenSlideClass.current.size > 0;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(hintTimeoutRef.current);
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(gameOverTimerRef.current);
      for (const t of slideTimerRefs.current.values()) clearTimeout(t);
      for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
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

  const startTokenAnimation = useCallback((playerIdx: number, cellPath: number[], onComplete?: () => void) => {
    const existing = tokenAnimTimers.current.get(playerIdx);
    if (existing) clearTimeout(existing);

    if (cellPath.length === 0) {
      onComplete?.();
      return;
    }

    const waypoints = cellPath.map(cell => cellToGrid(cell));
    let step = 0;
    let lastStepTime = performance.now();

    const advance = () => {
      if (step >= waypoints.length) {
        tokenAnimPos.current.delete(playerIdx);
        tokenAnimParity.current.delete(playerIdx);
        tokenAnimTimers.current.delete(playerIdx);
        setRenderTick(n => n + 1);
        onComplete?.();
        return;
      }
      const now = performance.now();
      if (step > 0 && now - lastStepTime < STEP_MS * 0.3) {
        tokenAnimPos.current.delete(playerIdx);
        tokenAnimParity.current.delete(playerIdx);
        tokenAnimTimers.current.delete(playerIdx);
        setRenderTick(n => n + 1);
        onComplete?.();
        return;
      }
      lastStepTime = now;
      tokenAnimPos.current.set(playerIdx, waypoints[step]);
      tokenAnimParity.current.set(playerIdx, step % 2);
      step++;
      setRenderTick(n => n + 1);
      tokenAnimTimers.current.set(playerIdx, setTimeout(advance, STEP_MS));
    };

    advance();
  }, []);

  // --- Dice rolling animation ---

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

  // --- Roll dice & apply move ---

  const handleRollDice = useCallback(() => {
    if (!isMyTurn || isRollingRef.current || moveInFlightRef.current || isAnimating) return;

    isRollingRef.current = true;
    setIsRolling(true);
    setHasRolledThisTurn(true);
    moveInFlightRef.current = true;

    rollTimeoutRef.current = setTimeout(() => {
      const roll = Math.floor(Math.random() * 6) + 1;
      isRollingRef.current = false;
      setIsRolling(false);
      setDiceValue(roll);

      // Resolve move
      const currentPos = positionsRef.current[currentTurnRef.current];
      const result = resolveMove(currentPos, roll);

      // Compute next turn
      const turnResult = getNextTurn(
        currentTurnRef.current,
        roll,
        activePlayerCountRef.current,
        consecutiveSixesRef.current,
      );

      // Update positions
      const newPositions = [...positionsRef.current];
      newPositions[currentTurnRef.current] = result.finalPos;

      // Check winner
      const winnerIdx = checkWinner(newPositions);

      // Build move log entry
      const entry: MoveLogEntry = {
        player: currentTurnRef.current,
        dice: roll,
        from: currentPos,
        to: result.finalPos,
        mechanism: result.landed,
      };
      const newLog = [...moveLogRef.current, entry].slice(-MAX_LOG_ENTRIES);

      const updates: SnakesMoveUpdate = {
        positions: serializePositions(newPositions),
        currentTurn: winnerIdx !== null ? currentTurnRef.current : turnResult.nextTurn,
        diceValue: roll,
        consecutiveSixes: turnResult.nextSixes,
        winner: winnerIdx,
        turnStartedAt: Date.now(),
        moveLog: serializeMoveLog(newLog),
      };

      makeMove(gameCodeRef.current!, updates).catch(err => {
        console.error('[Snakes] Move failed:', err);
        moveInFlightRef.current = false;
      });
    }, 650);
  }, [isMyTurn, isAnimating, startTokenAnimation]);

  const handleRollDiceRef = useRef(handleRollDice);
  handleRollDiceRef.current = handleRollDice;

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

    subscribeToGame(gameCode, (state: SnakesGameState | null) => {
      if (cancelled || !state) return;
      setError(null);

      const parsed = deserializePositions(state.positions, state.playerCount);

      // Reset moveInFlight on state change
      if (state.positions !== prevPositionsRef.current || state.turnStartedAt !== turnStartedAtRef.current) {
        moveInFlightRef.current = false;
      }

      // Detect position changes and animate
      if (state.positions !== prevPositionsRef.current && prevPositionsRef.current) {
        const oldPositions = deserializePositions(prevPositionsRef.current, state.playerCount);

        for (let i = 0; i < state.playerCount; i++) {
          if (oldPositions[i] !== parsed[i]) {
            // Find the intermediate position (before snake/ladder)
            // Look at the dice value to find where the hop should stop
            const hopTarget = oldPositions[i] + (state.diceValue || 0);
            const isSamePos = oldPositions[i] === parsed[i]; // overshoot, stayed

            if (isSamePos) continue;

            lastMovedPlayerRef.current = i;

            // Track board entrance (position 0 → >0)
            if (oldPositions[i] === 0 && parsed[i] > 0) {
              tokenEnteredBoard.current.add(i);
              // Clear entrance flag after animation
              setTimeout(() => {
                tokenEnteredBoard.current.delete(i);
                setRenderTick(n => n + 1);
              }, 500);
            }

            // Check if a snake or ladder was involved
            const isSnakeOrLadder = SNAKES[hopTarget] === parsed[i] || LADDERS[hopTarget] === parsed[i];

            if (isSnakeOrLadder && hopTarget >= 1 && hopTarget <= 100) {
              // Hop to the snake head / ladder bottom first, then slide
              const hopPath = computeHopPath(oldPositions[i], hopTarget);
              startTokenAnimation(i, hopPath, () => {
                // After hop, slide to final position
                const slideClass = SNAKES[hopTarget] !== undefined
                  ? styles.tokenSnakeSlide
                  : styles.tokenLadderClimb;
                tokenSlideClass.current.set(i, slideClass);
                setRenderTick(n => n + 1);
                const prevSlideTimer = slideTimerRefs.current.get(i);
                if (prevSlideTimer) clearTimeout(prevSlideTimer);
                slideTimerRefs.current.set(i, setTimeout(() => {
                  tokenSlideClass.current.delete(i);
                  slideTimerRefs.current.delete(i);
                  setRenderTick(n => n + 1);
                }, SLIDE_MS));
              });
            } else {
              // Normal hop
              const hopPath = computeHopPath(oldPositions[i], parsed[i]);
              startTokenAnimation(i, hopPath);
            }
          }
        }
      }
      prevPositionsRef.current = state.positions;
      turnStartedAtRef.current = state.turnStartedAt;

      // Update players
      const names: Record<number, string> = {};
      for (let i = 0; i < state.playerCount; i++) {
        const p = state.players[`p${i}`];
        if (p) names[i] = p.name;
      }
      setPlayerNames(names);

      // Phase transitions
      const joinedCount = Object.keys(state.players).filter(k => state.players[k]).length;
      if (state.startedAt && joinedCount >= state.playerCount) {
        setGamePhase('playing');
      }

      setPositions(parsed);
      if (state.currentTurn !== currentTurnRef.current) {
        setHasRolledThisTurn(false);
      }
      setCurrentTurn(state.currentTurn);
      setDiceValue(state.diceValue);
      setConsecutiveSixes(state.consecutiveSixes);
      setWinner(state.winner);
      setActivePlayerCount(state.playerCount);
      setMoveLog(deserializeMoveLog(state.moveLog || ''));

      // Winner burst + game-over overlay
      if (state.winner !== null && winnerRef.current === null) {
        if (isInitialLoadRef.current) {
          // Reconnecting to a finished game: show overlay immediately, no celebration
          setShowGameOver(true);
        } else {
          // Live win: burst animation + delayed overlay reveal
          setShowBurst(true);
          setTimeout(() => setShowBurst(false), 1000);
          clearTimeout(gameOverTimerRef.current);
          gameOverTimerRef.current = setTimeout(() => setShowGameOver(true), 1200);
        }
      }
      if (state.winner === null) {
        setShowGameOver(false);
        clearTimeout(gameOverTimerRef.current);
      }
      isInitialLoadRef.current = false;
    }).then(unsub => {
      if (cancelled) {
        unsub();
      } else {
        unsubscribe = unsub;
      }
    }).catch(err => {
      if (!cancelled) {
        console.error('[Snakes] Subscribe failed:', err);
        setError('Connection lost. Please rejoin.');
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [gameCode, startTokenAnimation]);

  // --- Turn timer ---

  useEffect(() => {
    if (gamePhase !== 'playing' || winner !== null) return;

    const interval = setInterval(() => {
      const elapsed = (Date.now() - turnStartedAtRef.current) / 1000;
      const remaining = Math.max(Math.ceil(TURN_SECONDS - elapsed), -BACKUP_GRACE);
      setTimeLeft(remaining);

      // Auto-roll at 0s for current player
      if (remaining <= 0 && isMyTurn && !isRollingRef.current && !moveInFlightRef.current) {
        handleRollDiceRef.current();
      }

      // Backup skip at -BACKUP_GRACE for non-current players
      if (remaining <= -BACKUP_GRACE && !isMyTurn && mySlotRef.current !== null && !moveInFlightRef.current) {
        moveInFlightRef.current = true;
        const roll = Math.floor(Math.random() * 6) + 1;
        const currentPos = positionsRef.current[currentTurnRef.current];
        const result = resolveMove(currentPos, roll);
        const turnResult = getNextTurn(currentTurnRef.current, roll, activePlayerCountRef.current, consecutiveSixesRef.current);
        const newPositions = [...positionsRef.current];
        newPositions[currentTurnRef.current] = result.finalPos;
        const winnerIdx = checkWinner(newPositions);

        const entry: MoveLogEntry = {
          player: currentTurnRef.current, dice: roll, from: currentPos, to: result.finalPos, mechanism: result.landed,
        };
        const newLog = [...moveLogRef.current, entry].slice(-MAX_LOG_ENTRIES);

        makeMove(gameCodeRef.current!, {
          positions: serializePositions(newPositions),
          currentTurn: winnerIdx !== null ? currentTurnRef.current : turnResult.nextTurn,
          diceValue: roll,
          consecutiveSixes: turnResult.nextSixes,
          winner: winnerIdx,
          turnStartedAt: Date.now(),
          moveLog: serializeMoveLog(newLog),
        }).catch(() => { moveInFlightRef.current = false; });
      }
    }, 500);

    return () => clearInterval(interval);
  }, [gamePhase, winner, isMyTurn]);

  // --- Game actions ---

  const handleCreateGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const code = await createGame(sessionId, userName, playerCount);
      setGameCode(code);
      setMySlot(0);
      setGamePhase('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, userName, playerCount]);

  const handleJoinGame = useCallback(async () => {
    if (joinCode.length !== 4) { setError('Enter a 4-character code'); return; }
    setIsLoading(true);
    setError(null);
    try {
      const { assignedSlot } = await joinGame(joinCode, sessionId, userName);
      setGameCode(joinCode);
      setMySlot(assignedSlot);
      setGamePhase('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode, sessionId, userName]);

  const handleSpectateGame = useCallback(async () => {
    if (joinCode.length !== 4) { setError('Enter a 4-character code'); return; }
    setIsLoading(true);
    setError(null);
    try {
      await spectateGame(joinCode);
      setGameCode(joinCode);
      setIsSpectating(true);
      setGamePhase('playing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode]);

  const handleNewGame = useCallback(async () => {
    if (!gameCode) return;
    try {
      setShowGameOver(false);
      clearTimeout(gameOverTimerRef.current);

      // Clear ALL animation state so dice becomes rollable
      tokenAnimPos.current.clear();
      tokenAnimParity.current.clear();
      for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
      tokenAnimTimers.current.clear();
      tokenSlideClass.current.clear();
      for (const t of slideTimerRefs.current.values()) clearTimeout(t);
      slideTimerRefs.current.clear();
      lastMovedPlayerRef.current = null;
      tokenEnteredBoard.current.clear();
      moveInFlightRef.current = false;
      prevPositionsRef.current = '';
      isInitialLoadRef.current = false;
      setHasRolledThisTurn(false);

      await resetGame(gameCode, activePlayerCount);
    } catch (err) {
      console.error('[Snakes] Reset failed:', err);
    }
  }, [gameCode, activePlayerCount]);

  const handleBackToLobby = useCallback(() => {
    setGamePhase('lobby');
    setGameCode(null);
    setMySlot(null);
    setIsSpectating(false);
    setPlayerNames({});
    setError(null);
    setPositions([]);
    setWinner(null);
    setShowGameOver(false);
    clearTimeout(gameOverTimerRef.current);
    setMoveLog([]);
    setHasRolledThisTurn(false);
    prevPositionsRef.current = '';
    lastMovedPlayerRef.current = null;
    tokenEnteredBoard.current.clear();
  }, []);

  // --- Drag ---

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.closeBtn}`)) return;
    e.preventDefault();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: positionRef.current.x,
      posY: positionRef.current.y,
    };
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: Math.max(0, dragStartRef.current.posY + dy),
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragCleanupRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    dragCleanupRef.current = onUp;
  }, []);

  // --- Board rendering ---

  const snakeLadderSVG = useMemo(() => (
    <svg className={styles.svgOverlay} viewBox="0 0 100 100" preserveAspectRatio="none">
      {Object.entries(LADDERS).map(([from, to], i) => renderLadderSVG(Number(from), to, i))}
      {Object.entries(SNAKES).map(([from, to], i) => renderSnakeSVG(Number(from), to, i))}
    </svg>
  ), []);

  function renderCell(cellNum: number) {
    const [gridRow, gridCol] = cellToGrid(cellNum);
    const isEven = (gridRow + gridCol) % 2 === 0;
    const isSnakeHead = SNAKES[cellNum] !== undefined;
    const isLadderBottom = LADDERS[cellNum] !== undefined;
    const isWinCell = cellNum === 100;

    return (
      <div
        key={cellNum}
        className={[
          styles.cell,
          isEven ? styles.cellEven : styles.cellOdd,
          isSnakeHead ? styles.cellSnakeHead : '',
          isLadderBottom ? styles.cellLadderBottom : '',
          isWinCell ? styles.cellWin : '',
        ].filter(Boolean).join(' ')}
        style={{ gridRow: gridRow + 1, gridColumn: gridCol + 1 }}
        aria-label={`Cell ${cellNum}`}
      >
        <span className={styles.cellNumber}>{cellNum}</span>
      </div>
    );
  }

  function renderToken(playerIdx: number) {
    const pos = positions[playerIdx];
    const animCoords = tokenAnimPos.current.get(playerIdx);

    if ((pos === undefined || pos <= 0) && !animCoords) {
      return null;
    }
    const isStepping = !!animCoords;
    const stepParity = tokenAnimParity.current.get(playerIdx) ?? 0;
    const slideClass = tokenSlideClass.current.get(playerIdx);
    const isEntering = tokenEnteredBoard.current.has(playerIdx);
    const isArriving = !isStepping && !slideClass && !isEntering && lastMovedPlayerRef.current === playerIdx && diceValue !== null && !isRolling;

    const color = PLAYER_COLORS[playerIdx];
    let left: number, top: number;

    if (animCoords) {
      // During hop animation
      left = animCoords[1] * CELL_PCT + CELL_PCT / 2;
      top = animCoords[0] * CELL_PCT + CELL_PCT / 2;
    } else if (pos > 0) {
      const [pctLeft, pctTop] = cellToPercent(pos);
      const [dx, dy] = getTokenOffset(positions, playerIdx);
      left = pctLeft + dx;
      top = pctTop + dy;
    } else {
      return null;
    }

    // Center the token on the point
    const halfToken = TOKEN_SIZE_PCT / 2;

    return (
      <div
        key={`token-${playerIdx}`}
        className={[
          styles.token,
          TOKEN_STYLE[color],
          isStepping ? (stepParity ? styles.tokenSteppingB : styles.tokenSteppingA) : '',
          slideClass ? `${styles.tokenSliding} ${slideClass}` : '',
          isEntering ? styles.tokenEntering : '',
          isArriving ? styles.tokenArriving : '',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${left - halfToken}%`,
          top: `${top - halfToken}%`,
        }}
        aria-label={`${COLOR_LABELS[color]} token on cell ${pos}`}
      />
    );
  }

  // --- Render ---

  return (
    <div className={styles.popup} style={{ left: position.x, top: position.y }}>
      {/* Title bar */}
      <div className={styles.titleBar} onMouseDown={handleDragStart}>
        <span className={styles.titleText}>
          <span>🐍</span>
          Snakes & Ladders
          {gameCode && gamePhase === 'playing' && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              #{gameCode}
            </span>
          )}
          {isSpectating && gamePhase === 'playing' && (
            <span className={styles.spectateBadge}>Spectating</span>
          )}
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close Snakes & Ladders">
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
              {[2, 3, 4, 5, 6, 7].map(n => (
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
            <span className={styles.shareHint}>
              {statusHint || 'Share this code with other players'}
            </span>
            <div className={styles.playerList}>
              {Array.from({ length: playerCount }, (_, i) => {
                const name = playerNames[i];
                const color = PLAYER_COLORS[i];
                return (
                  <div
                    key={i}
                    className={`${styles.playerSlot} ${!name ? styles.playerSlotEmpty : ''}`}
                  >
                    <span className={styles.playerDot} style={{ background: COLOR_HEX[color] }} />
                    {name ? (
                      <span>
                        {name}
                        {i === mySlot && <span style={{ opacity: 0.5, marginLeft: 4 }}>(you)</span>}
                      </span>
                    ) : (
                      <span>Waiting...</span>
                    )}
                  </div>
                );
              })}
            </div>
            <button className={styles.resetBtn} onClick={handleBackToLobby}>Back</button>
            {error && <div className={styles.errorText}>{error}</div>}
          </div>
        )}

        {/* === PLAYING === */}
        {gamePhase === 'playing' && (
          <div className={styles.playingLayout}>
            {/* Board */}
            <div className={styles.boardColumn}>
              <div className={styles.boardWrapper}>
                <div className={styles.board}>
                  {BOARD_CELLS.map(renderCell)}
                </div>
                {snakeLadderSVG}
                {/* Tokens */}
                {Array.from({ length: activePlayerCount }, (_, i) => renderToken(i))}
                {/* Winner burst */}
                {showBurst && winner !== null && (
                  <div
                    className={`${styles.burst} ${styles.burstActive}`}
                    style={{
                      background: `radial-gradient(circle, ${COLOR_HEX[PLAYER_COLORS[winner]]}33 0%, transparent 70%)`,
                    }}
                  />
                )}
              </div>
            </div>

            {/* Side panel */}
            <div className={styles.sidePanel}>
              {/* Turn indicator */}
              <div className={styles.turnIndicator}>
                <span
                  className={styles.statusDot}
                  style={{ background: COLOR_HEX[PLAYER_COLORS[currentTurn]] }}
                />
                {winner !== null ? (
                  <span className={styles.winText}>
                    {playerNames[winner] || PLAYER_COLORS[winner]} wins!
                  </span>
                ) : (
                  <>
                    <span>
                      {isMyTurn ? 'Your turn' : `${playerNames[currentTurn] || PLAYER_COLORS[currentTurn]}'s turn`}
                    </span>
                    <span className={`${styles.timer} ${timeLeft <= 10 ? styles.timerUrgent : ''}`}>
                      {timeLeft > 0 ? `${timeLeft}s` : 'Time!'}
                    </span>
                  </>
                )}
              </div>

              {statusHint && gamePhase === 'playing' && (
                <div className={styles.statusHint}>{statusHint}</div>
              )}

              {/* Dice */}
              <div className={styles.sideDice}>
                <button
                  className={[
                    styles.dice,
                    isMyTurn && !isRolling && winner === null ? styles.diceActive : '',
                    isRolling ? styles.diceRolling : '',
                  ].filter(Boolean).join(' ')}
                  onClick={handleRollDice}
                  disabled={!isMyTurn || isRolling || winner !== null}
                  aria-label="Roll dice"
                >
                  {isRolling ? (
                    <DiceFace value={rollingFace} />
                  ) : diceValue ? (
                    <div className={styles.diceResult}>
                      <DiceFace value={diceValue} />
                    </div>
                  ) : (
                    <DiceFace value={1} />
                  )}
                </button>
                {isMyTurn && !isRolling && !hasRolledThisTurn && !winner && (
                  <span className={styles.rollReminder}>Roll!</span>
                )}
                {isAnimating && !isMyTurn && (
                  <span className={styles.statusHint}>Moving...</span>
                )}
              </div>

              {/* Player list */}
              <div className={`${styles.playerBar} ${styles.playerBarVertical}`}>
                {Array.from({ length: activePlayerCount }, (_, i) => {
                  const color = PLAYER_COLORS[i];
                  const name = playerNames[i] || COLOR_LABELS[color];
                  const isCurrent = currentTurn === i && !winner;
                  const isMe = mySlot === i;
                  const isWinner = winner === i;
                  const isDimmed = winner !== null && winner !== i;

                  return (
                    <div
                      key={i}
                      className={[
                        styles.playerChip,
                        isCurrent ? styles.playerChipActive : '',
                        isMe ? styles.playerChipMe : '',
                        isWinner ? styles.playerChipWinner : '',
                        isDimmed ? styles.playerChipDimmed : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <span className={styles.playerChipDot} style={{ background: COLOR_HEX[color] }} />
                      <span>{name}</span>
                      {isMe && <span className={styles.youBadge}>(you)</span>}
                      <span style={{ marginLeft: 'auto', fontSize: '0.6rem', opacity: 0.5 }}>
                        {positions[i] > 0 ? positions[i] : '-'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Move log */}
              {moveLog.length > 0 && (
                <div className={styles.moveLog}>
                  <div className={styles.moveLogLabel}>Recent Moves</div>
                  <div className={styles.moveLogEntries}>
                    {moveLog.slice(-10).reverse().map((entry) => {
                      const color = PLAYER_COLORS[entry.player];
                      const name = playerNames[entry.player] || COLOR_LABELS[color];
                      return (
                        <div key={`log-${entry.player}-${entry.dice}-${entry.from}-${entry.to}`} className={styles.moveLogEntry}>
                          <span className={styles.moveLogDot} style={{ background: COLOR_HEX[color] }} />
                          <span>{name}</span>
                          <span style={{ opacity: 0.6 }}>rolled {entry.dice}:</span>
                          <span>{entry.from || 'start'} &rarr; {entry.to === entry.from ? 'stay' : entry.to}</span>
                          {entry.mechanism === 'snake' && (
                            <span className={`${styles.moveLogMechanism} ${styles.moveLogSnake}`}>snake!</span>
                          )}
                          {entry.mechanism === 'ladder' && (
                            <span className={`${styles.moveLogMechanism} ${styles.moveLogLadder}`}>ladder!</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={styles.sideSpacer} />
            </div>

            {/* Game-over overlay (delayed to let animations finish) */}
            {showGameOver && winner !== null && (
              <div className={styles.gameOverOverlay}>
                <div className={styles.gameOverCard}>
                  <div className={styles.gameOverTrophy}>🏆</div>
                  <div className={styles.gameOverTitle}>
                    <span className={styles.gameOverDot} style={{ background: COLOR_HEX[PLAYER_COLORS[winner]] }} />
                    {winner === mySlot
                      ? 'You win!'
                      : `${playerNames[winner] || COLOR_LABELS[PLAYER_COLORS[winner]]} wins!`}
                  </div>
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
