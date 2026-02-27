import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import {
  createGame,
  joinGame,
  spectateGame,
  subscribeToGame,
  makeMove,
  resetGame,
  sendReaction,
  subscribeToReactions,
  cleanupOldReactions,
  cleanupOldGames,
  subscribeToServerTimeOffset,
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
  computeGameStats,
  serializePositions,
  deserializePositions,
  serializeMoveLog,
  deserializeMoveLog,
  getTokenOffset,
  SNAKES,
  LADDERS,
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_SIZE,
  PLAYER_COLORS,
  COLOR_HEX,
  COLOR_LABELS,
  type PlayerColor,
  type MoveLogEntry,
} from '../utils/snakesLogic';
import styles from './SnakesGame.module.css';

// --- Constants ---

const TURN_SECONDS = 10;
const BACKUP_GRACE = 10;
const STEP_MS = 280;
const SLIDE_MS = 900;
const MAX_LOG_ENTRIES = 20;
const COL_PCT = 100 / BOARD_COLS;  // ~6.667% per column
const ROW_PCT = 100 / BOARD_ROWS;  // 10% per row
const TOKEN_SIZE_PCT = COL_PCT * 0.5;

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
const BOARD_CELLS = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);

// Pre-computed danger/opportunity zone cells (1-2 cells before snake heads / ladder bases)
const NEAR_SNAKE_CELLS = new Set<number>();
for (const head of Object.keys(SNAKES).map(Number)) {
  for (let offset = 1; offset <= 2; offset++) {
    const cell = head - offset;
    if (cell >= 1 && SNAKES[cell] === undefined && LADDERS[cell] === undefined) {
      NEAR_SNAKE_CELLS.add(cell);
    }
  }
}
const NEAR_LADDER_CELLS = new Set<number>();
for (const base of Object.keys(LADDERS).map(Number)) {
  for (let offset = 1; offset <= 2; offset++) {
    const cell = base - offset;
    if (cell >= 1 && SNAKES[cell] === undefined && LADDERS[cell] === undefined) {
      NEAR_LADDER_CELLS.add(cell);
    }
  }
}

// Dust poof scatter directions [dx, dy] for landing particles
const DUST_DIRS: [string, string][] = [
  ['12px', '-9px'], ['-10px', '-11px'], ['14px', '5px'], ['-13px', '7px'], ['3px', '-14px'],
];

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

// Returns SVG coordinates in a 150×100 viewBox (matching the 15×10 board at 10 units per cell)
function cellCenter(cell: number): [number, number] {
  const [row, col] = cellToGrid(cell);
  return [col * 10 + 5, row * 10 + 5]; // x, y in isometric units
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
  const railGap = 1.4;
  const nx = (-dy / len) * railGap;
  const ny = (dx / len) * railGap;
  const rungs = Math.max(3, Math.floor(len / 6));
  const palette = LADDER_PALETTES[index % LADDER_PALETTES.length];

  // Rail width for 3D look
  const railW = 0.65;
  const rungW = 0.45;

  return (
    <g key={`ladder-${from}-${to}`} opacity="0.88">
      {/* Shadow behind entire ladder */}
      <line x1={x1 + nx + 0.25} y1={y1 + ny + 0.25} x2={x2 + nx + 0.25} y2={y2 + ny + 0.25}
        stroke="rgba(0,0,0,0.10)" strokeWidth={railW + 0.3} strokeLinecap="round" />
      <line x1={x1 - nx + 0.25} y1={y1 - ny + 0.25} x2={x2 - nx + 0.25} y2={y2 - ny + 0.25}
        stroke="rgba(0,0,0,0.10)" strokeWidth={railW + 0.3} strokeLinecap="round" />

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
              x1={rx + nx + 0.2} y1={ry + ny + 0.2}
              x2={rx - nx + 0.2} y2={ry - ny + 0.2}
              stroke="rgba(0,0,0,0.08)" strokeWidth={rungW + 0.2} strokeLinecap="round" />
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
  const waveAmp = Math.min(2.0, len * 0.06);
  const waveFreq = Math.max(3, Math.floor(len / 8));

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

  // Build smooth quadratic bezier through points
  function buildSmoothPath(pts: [number, number][]): string {
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const next = pts[i + 1];
      const cpx = curr[0] - (next[0] - prev[0]) / 6;
      const cpy = curr[1] - (next[1] - prev[1]) / 6;
      d += ` Q ${cpx.toFixed(2)} ${cpy.toFixed(2)}, ${curr[0].toFixed(2)} ${curr[1].toFixed(2)}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last[0].toFixed(2)} ${last[1].toFixed(2)}`;
    return d;
  }

  const bodyPath = buildSmoothPath(points);
  const palette = SNAKE_PALETTES[index % SNAKE_PALETTES.length];

  // Body thickness tapers from head to tail
  const headWidth = 1.1;
  const tailWidth = 0.3;

  // Head direction (from first two points)
  const hdx = points[1][0] - points[0][0];
  const hdy = points[1][1] - points[0][1];
  const hlen = Math.sqrt(hdx * hdx + hdy * hdy) || 1;
  const hux = hdx / hlen;
  const huy = hdy / hlen;
  const hnx = -huy;
  const hny = hux;

  // Head shape: rounded diamond
  const headSize = 1.2;
  const headX = points[0][0];
  const headY = points[0][1];

  // Eye positions
  const eyeOffX = hnx * 0.5;
  const eyeOffY = hny * 0.5;
  const eyeFwdX = -hux * 0.2;
  const eyeFwdY = -huy * 0.2;

  // Tongue
  const tongueX = headX - hux * headSize * 0.9;
  const tongueY = headY - huy * headSize * 0.9;
  const tongueForkL = `${(tongueX - hux * 1.4 + hnx * 0.45).toFixed(2)} ${(tongueY - huy * 1.4 + hny * 0.45).toFixed(2)}`;
  const tongueForkR = `${(tongueX - hux * 1.4 - hnx * 0.45).toFixed(2)} ${(tongueY - huy * 1.4 - hny * 0.45).toFixed(2)}`;
  const tongueMid = `${(tongueX - hux * 0.95).toFixed(2)} ${(tongueY - huy * 0.95).toFixed(2)}`;

  // Tail end (last two points)
  const tailPt = points[points.length - 1];

  return (
    <g key={`snake-${from}-${to}`} opacity="0.9">
      {/* Shadow layer */}
      <path d={bodyPath} fill="none" stroke={palette.shadow} strokeWidth={headWidth + 0.4}
        strokeLinecap="round" strokeOpacity="0.18" />
      {/* Main body - thick stroke */}
      <path d={bodyPath} fill="none" stroke={palette.body} strokeWidth={headWidth}
        strokeLinecap="round" />
      {/* Belly highlight stripe */}
      <path d={bodyPath} fill="none" stroke={palette.belly} strokeWidth={headWidth * 0.3}
        strokeLinecap="round" strokeOpacity="0.5" />

      {/* Head - wider ellipse */}
      <ellipse
        cx={headX} cy={headY}
        rx={headSize * 0.9} ry={headSize * 0.7}
        transform={`rotate(${Math.atan2(huy, hux) * 180 / Math.PI}, ${headX}, ${headY})`}
        fill={palette.body}
        stroke={palette.shadow} strokeWidth="0.3"
      />

      {/* Eyes */}
      <circle cx={headX + eyeOffX + eyeFwdX} cy={headY + eyeOffY + eyeFwdY} r="0.35" fill="#fff" />
      <circle cx={headX + eyeOffX + eyeFwdX} cy={headY + eyeOffY + eyeFwdY} r="0.17" fill="#111" />
      <circle cx={headX - eyeOffX + eyeFwdX} cy={headY - eyeOffY + eyeFwdY} r="0.35" fill="#fff" />
      <circle cx={headX - eyeOffX + eyeFwdX} cy={headY - eyeOffY + eyeFwdY} r="0.17" fill="#111" />

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

// --- Confetti ---

interface ConfettiParticle {
  x: number; y: number;
  vx: number; vy: number;
  rotation: number; rotationSpeed: number;
  color: string;
  w: number; h: number;
  gravity: number;
  opacity: number;
}

function launchConfetti(
  canvas: HTMLCanvasElement,
  winnerColor: string,
  animRef: React.MutableRefObject<number | null>,
) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const cx = W / 2;
  const cy = H / 2;

  const colors = [winnerColor, '#FFD700', '#FF6B6B', '#4ECDC4', '#A855F7', '#fff'];
  const particles: ConfettiParticle[] = [];
  for (let i = 0; i < 65; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 6;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 3,
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
      color: colors[Math.floor(Math.random() * colors.length)],
      w: 4 + Math.random() * 6,
      h: 3 + Math.random() * 4,
      gravity: 0.08 + Math.random() * 0.04,
      opacity: 1,
    });
  }

  const startTime = performance.now();
  const DURATION = 3000;

  function animate(now: number) {
    const elapsed = now - startTime;
    if (elapsed > DURATION) {
      ctx!.clearRect(0, 0, W, H);
      animRef.current = null;
      return;
    }

    ctx!.clearRect(0, 0, W, H);
    const fadeStart = DURATION * 0.6;
    const globalAlpha = elapsed > fadeStart ? 1 - (elapsed - fadeStart) / (DURATION - fadeStart) : 1;

    for (const p of particles) {
      p.vy += p.gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.99;
      p.rotation += p.rotationSpeed;
      p.opacity = globalAlpha;

      ctx!.save();
      ctx!.translate(p.x, p.y);
      ctx!.rotate((p.rotation * Math.PI) / 180);
      ctx!.globalAlpha = p.opacity;
      ctx!.fillStyle = p.color;
      ctx!.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx!.restore();
    }

    animRef.current = requestAnimationFrame(animate);
  }

  animRef.current = requestAnimationFrame(animate);
}

// --- CountdownTimer (isolated to prevent parent re-renders on tick) ---

const CountdownTimer = memo(function CountdownTimer({
  turnStartedAt,
  serverOffset,
}: {
  turnStartedAt: number;
  serverOffset: number;
}) {
  const [timeLeft, setTimeLeft] = useState(() => {
    const serverNow = Date.now() + serverOffset;
    return Math.max(Math.ceil(TURN_SECONDS - (serverNow - turnStartedAt) / 1000), 0);
  });

  useEffect(() => {
    const update = () => {
      const serverNow = Date.now() + serverOffset;
      setTimeLeft(Math.max(Math.ceil(TURN_SECONDS - (serverNow - turnStartedAt) / 1000), 0));
    };
    update();
    const interval = setInterval(update, 500);
    return () => clearInterval(interval);
  }, [turnStartedAt, serverOffset]);

  return (
    <div className={styles.countdown}>
      <svg className={styles.countdownRing} viewBox="0 0 48 48">
        <circle className={styles.countdownTrack} cx="24" cy="24" r="20" />
        <circle
          className={`${styles.countdownProgress} ${timeLeft <= 5 ? styles.countdownProgressUrgent : ''}`}
          cx="24" cy="24" r="20"
          strokeDasharray={2 * Math.PI * 20}
          strokeDashoffset={2 * Math.PI * 20 * (1 - timeLeft / TURN_SECONDS)}
          transform="rotate(-90 24 24)"
        />
      </svg>
      <span className={`${styles.countdownNumber} ${timeLeft <= 5 ? styles.countdownNumberUrgent : ''}`}>
        {timeLeft}
      </span>
    </div>
  );
});

// --- BoardCell (memoized — only re-renders when its hover state changes) ---

function getCellHoverState(cellNum: number, hoveredCell: number | null): number {
  if (hoveredCell === null) return 0;
  if (hoveredCell === cellNum) return 1;
  if (SNAKES[hoveredCell] === cellNum || LADDERS[hoveredCell] === cellNum) return 2;
  return 3;
}

const BoardCell = memo(function BoardCell({
  cellNum,
  hoveredCell,
  onHoverEnter,
  onHoverLeave,
}: {
  cellNum: number;
  hoveredCell: number | null;
  onHoverEnter: (cell: number) => void;
  onHoverLeave: () => void;
}) {
  const [gridRow, gridCol] = cellToGrid(cellNum);
  const isEven = (gridRow + gridCol) % 2 === 0;
  const isSnakeHead = SNAKES[cellNum] !== undefined;
  const isLadderBottom = LADDERS[cellNum] !== undefined;
  const isNearSnake = NEAR_SNAKE_CELLS.has(cellNum);
  const isNearLadder = NEAR_LADDER_CELLS.has(cellNum);
  const isWinCell = cellNum === BOARD_SIZE;
  const isHoverSource = hoveredCell === cellNum;
  const isHoverDest = hoveredCell !== null && (SNAKES[hoveredCell] === cellNum || LADDERS[hoveredCell] === cellNum);
  const isDimmed = hoveredCell !== null && !isHoverSource && !isHoverDest;

  return (
    <div
      className={[
        styles.cell,
        isEven ? styles.cellEven : styles.cellOdd,
        isSnakeHead ? styles.cellSnakeHead : '',
        isLadderBottom ? styles.cellLadderBottom : '',
        isNearSnake ? styles.cellNearSnake : '',
        isNearLadder ? styles.cellNearLadder : '',
        isWinCell ? styles.cellWin : '',
        isHoverSource ? styles.cellHighlightSource : '',
        isHoverDest ? styles.cellHighlightDest : '',
        isDimmed ? styles.cellDimmed : '',
      ].filter(Boolean).join(' ')}
      style={{ gridRow: gridRow + 1, gridColumn: gridCol + 1 }}
      aria-label={`Cell ${cellNum}`}
      onMouseEnter={() => {
        if (isSnakeHead || isLadderBottom) onHoverEnter(cellNum);
      }}
      onMouseLeave={onHoverLeave}
    >
      <span className={styles.cellNumber}>{cellNum}</span>
      {isHoverSource && (
        <span className={styles.cellTooltip}>
          {cellNum} &rarr; {SNAKES[cellNum] ?? LADDERS[cellNum]}
        </span>
      )}
    </div>
  );
}, (prev, next) => {
  return getCellHoverState(prev.cellNum, prev.hoveredCell) === getCellHoverState(next.cellNum, next.hoveredCell);
});

// --- Component ---

interface SnakesGameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

export function SnakesGame({ onClose, isSearchOpen }: SnakesGameProps) {
  const [sessionId] = useState(() => sessionStorage.getItem('roadmap-user-id') || 'anonymous');
  const [userName] = useState(() => sessionStorage.getItem('roadmap-user-name') || 'Player');

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
  const [hasRolledThisTurn, setHasRolledThisTurn] = useState(false);
  const [, setRenderTick] = useState(0);
  const [turnTransitioning, setTurnTransitioning] = useState(false);
  const [turnNudge, setTurnNudge] = useState(false);
  const [winTally, setWinTally] = useState<Record<number, number>>({});
  const [gameNumber, setGameNumber] = useState(1);
  const [hoveredCell, setHoveredCell] = useState<number | null>(null);
  const [floatingReactions, setFloatingReactions] = useState<Array<{ id: string; emoji: string; player: number; left: number }>>([]);
  const [turnStartedAtState, setTurnStartedAtState] = useState(Date.now());
  const [serverOffsetState, setServerOffsetState] = useState(0);

  // Drag state
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (window.innerWidth - 880) / 2),
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
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const confettiAnimRef = useRef<number | null>(null);
  const lastReactionTimeRef = useRef(0);
  const turnTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const turnNudgeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const serverOffsetRef = useRef(0);
  const lastAutoRollTurnStartRef = useRef(0); // guards against double auto-roll per turn
  const boardEntranceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const burstTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reactionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Mirrored refs for closure safety
  const gameCodeRef = useRef(gameCode);
  gameCodeRef.current = gameCode;
  const mySlotRef = useRef(mySlot);
  mySlotRef.current = mySlot;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const currentTurnRef = useRef(currentTurn);
  currentTurnRef.current = currentTurn;
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
      clearTimeout(turnTransitionTimeoutRef.current);
      clearTimeout(turnNudgeTimeoutRef.current);
      clearTimeout(burstTimeoutRef.current);
      for (const t of slideTimerRefs.current.values()) clearTimeout(t);
      for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
      for (const t of boardEntranceTimers.current.values()) clearTimeout(t);
      for (const t of reactionTimers.current.values()) clearTimeout(t);
      if (confettiAnimRef.current) cancelAnimationFrame(confettiAnimRef.current);
      dragCleanupRef.current?.();
    };
  }, []);

  // Subscribe to Firebase server time offset for clock skew compensation
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    subscribeToServerTimeOffset((offset) => {
      if (!cancelled) {
        serverOffsetRef.current = offset;
        setServerOffsetState(offset);
      }
    }).then(u => { if (cancelled) u(); else unsub = u; });
    return () => { cancelled = true; unsub?.(); };
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
    // Read animation refs directly (not closure-captured) for live accuracy
    const animating = tokenAnimPos.current.size > 0 || tokenSlideClass.current.size > 0;
    if (!isMyTurn || isRollingRef.current || moveInFlightRef.current || animating) return;

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
        turnStartedAt: Date.now() + serverOffsetRef.current,
        moveLog: serializeMoveLog(newLog),
      };

      makeMove(gameCodeRef.current!, currentTurnRef.current, updates).then(committed => {
        if (!committed) moveInFlightRef.current = false;
      }).catch(err => {
        console.error('[Snakes] Move failed:', err);
        moveInFlightRef.current = false;
      });
    }, 650);
  }, [isMyTurn]);

  const handleRollDiceRef = useRef(handleRollDice);
  handleRollDiceRef.current = handleRollDice;

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSearchOpen) onClose();
      // Don't hijack space/enter when user is in an input, textarea, or button
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return;
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

    subscribeToGame(gameCode, (rawState: SnakesGameState | null) => {
      if (cancelled || !rawState) return;
      setError(null);

      // Firebase RTDB deletes fields set to null — normalize undefined → null
      const state = {
        ...rawState,
        winner: rawState.winner ?? null,
        diceValue: rawState.diceValue ?? null,
        startedAt: rawState.startedAt ?? null,
        moveLog: rawState.moveLog ?? '',
      };

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
            const hopTarget = oldPositions[i] + (state.diceValue || 0);

            lastMovedPlayerRef.current = i;

            // Track board entrance (position 0 → >0)
            if (oldPositions[i] === 0 && parsed[i] > 0) {
              tokenEnteredBoard.current.add(i);
              // Clear entrance flag after animation
              const prev = boardEntranceTimers.current.get(i);
              if (prev) clearTimeout(prev);
              boardEntranceTimers.current.set(i, setTimeout(() => {
                tokenEnteredBoard.current.delete(i);
                boardEntranceTimers.current.delete(i);
                setRenderTick(n => n + 1);
              }, 500));
            }

            // Check if a snake or ladder was involved
            const isSnakeOrLadder = SNAKES[hopTarget] === parsed[i] || LADDERS[hopTarget] === parsed[i];

            if (isSnakeOrLadder && hopTarget >= 1 && hopTarget <= BOARD_SIZE) {
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
      setTurnStartedAtState(state.turnStartedAt);

      // Update players
      const names: Record<number, string> = {};
      for (let i = 0; i < state.playerCount; i++) {
        const p = state.players[`p${i}`];
        if (p) names[i] = p.name;
      }
      // Only update if names actually changed to avoid unnecessary re-renders
      setPlayerNames(prev => {
        const keys = Object.keys(names);
        if (keys.length !== Object.keys(prev).length) return names;
        for (const k of keys) {
          if (prev[Number(k)] !== names[Number(k)]) return names;
        }
        return prev;
      });

      // Phase transitions
      const joinedCount = Object.keys(state.players).filter(k => state.players[k]).length;
      if (state.startedAt && joinedCount >= state.playerCount) {
        setGamePhase('playing');
      }

      setPositions(parsed);
      if (state.currentTurn !== currentTurnRef.current) {
        setHasRolledThisTurn(false);
        // Turn transition animation
        if (!isInitialLoadRef.current) {
          setTurnTransitioning(true);
          clearTimeout(turnTransitionTimeoutRef.current);
          turnTransitionTimeoutRef.current = setTimeout(() => setTurnTransitioning(false), 500);
          // Your-turn nudge
          if (state.currentTurn === mySlotRef.current && !state.winner) {
            setTurnNudge(true);
            clearTimeout(turnNudgeTimeoutRef.current);
            turnNudgeTimeoutRef.current = setTimeout(() => setTurnNudge(false), 1000);
          }
        }
      }
      setCurrentTurn(state.currentTurn);
      setDiceValue(state.diceValue);
      setConsecutiveSixes(state.consecutiveSixes);
      setWinner(state.winner);
      setActivePlayerCount(state.playerCount);
      setMoveLog(deserializeMoveLog(state.moveLog || ''));

      // Winner burst + game-over overlay + confetti + tally
      if (state.winner !== null && winnerRef.current === null) {
        // Increment win tally
        setWinTally(prev => ({
          ...prev,
          [state.winner!]: (prev[state.winner!] || 0) + 1,
        }));
        if (isInitialLoadRef.current) {
          // Reconnecting to a finished game: show overlay immediately, no celebration
          setShowGameOver(true);
        } else {
          // Live win: burst animation + confetti + delayed overlay reveal
          setShowBurst(true);
          clearTimeout(burstTimeoutRef.current);
          burstTimeoutRef.current = setTimeout(() => setShowBurst(false), 1000);
          clearTimeout(gameOverTimerRef.current);
          gameOverTimerRef.current = setTimeout(() => setShowGameOver(true), 1200);
          // Launch confetti
          requestAnimationFrame(() => {
            if (confettiCanvasRef.current && state.winner !== null) {
              launchConfetti(
                confettiCanvasRef.current,
                COLOR_HEX[PLAYER_COLORS[state.winner]],
                confettiAnimRef,
              );
            }
          });
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

  // --- Emoji reactions subscription ---

  useEffect(() => {
    if (!gameCode || gamePhase !== 'playing') return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    subscribeToReactions(gameCode, (reaction) => {
      if (cancelled) return;
      const id = `${reaction.key}-${reaction.ts}`;
      setFloatingReactions(prev => [...prev, { id, emoji: reaction.emoji, player: reaction.player, left: 20 + Math.random() * 60 }]);
      reactionTimers.current.set(id, setTimeout(() => {
        setFloatingReactions(prev => prev.filter(r => r.id !== id));
        reactionTimers.current.delete(id);
      }, 2500));
    }).then(unsub => {
      if (cancelled) unsub(); else unsubscribe = unsub;
    });

    const cleanup = setInterval(() => cleanupOldReactions(gameCode), 15000);

    return () => {
      cancelled = true;
      unsubscribe?.();
      clearInterval(cleanup);
    };
  }, [gameCode, gamePhase]);

  // --- Turn timer ---

  useEffect(() => {
    if (gamePhase !== 'playing' || winner !== null) return;

    const interval = setInterval(() => {
      const serverNow = Date.now() + serverOffsetRef.current;
      const elapsed = (serverNow - turnStartedAtRef.current) / 1000;
      const remaining = Math.ceil(TURN_SECONDS - elapsed);

      // Safety: if moveInFlight has been stuck for 8s past timer expiry (18s total),
      // reset it. Scoped to the current player's client only — other clients use
      // the backup skip path, and resetting their moveInFlight would cause it to
      // rapid-fire. The per-turn guard prevents double auto-roll.
      if (remaining <= -8 && moveInFlightRef.current && !isRollingRef.current &&
          mySlotRef.current !== null && currentTurnRef.current === mySlotRef.current) {
        moveInFlightRef.current = false;
      }

      // Auto-roll at 0s for current player (once per turn via turnStartedAt guard)
      if (remaining <= 0 && mySlotRef.current !== null &&
          currentTurnRef.current === mySlotRef.current &&
          !isRollingRef.current && !moveInFlightRef.current &&
          lastAutoRollTurnStartRef.current !== turnStartedAtRef.current) {
        // Force-clear any lingering animation state that might block handleRollDice.
        // After 10s+ since turn start, all animations should have long completed;
        // stale refs here mean a timer was lost (e.g. tab throttled).
        if (tokenAnimPos.current.size > 0 || tokenSlideClass.current.size > 0) {
          for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
          tokenAnimTimers.current.clear();
          tokenAnimPos.current.clear();
          tokenAnimParity.current.clear();
          for (const t of slideTimerRefs.current.values()) clearTimeout(t);
          slideTimerRefs.current.clear();
          tokenSlideClass.current.clear();
          setRenderTick(n => n + 1); // re-render so dice button also re-enables
        }
        handleRollDiceRef.current();
        // Mark this turn as auto-rolled so we don't fire again if handleRollDice
        // succeeded (moveInFlight will be true), or if it failed transiently.
        if (moveInFlightRef.current) {
          lastAutoRollTurnStartRef.current = turnStartedAtRef.current;
        }
      }

      // Backup skip: only the next player in turn order attempts it (prevents race)
      const nextPlayer = (currentTurnRef.current + 1) % activePlayerCountRef.current;
      if (remaining <= -BACKUP_GRACE &&
          mySlotRef.current === nextPlayer &&
          !moveInFlightRef.current) {
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

        makeMove(gameCodeRef.current!, currentTurnRef.current, {
          positions: serializePositions(newPositions),
          currentTurn: winnerIdx !== null ? currentTurnRef.current : turnResult.nextTurn,
          diceValue: roll,
          consecutiveSixes: turnResult.nextSixes,
          winner: winnerIdx,
          turnStartedAt: Date.now() + serverOffsetRef.current,
          moveLog: serializeMoveLog(newLog),
        }).then(committed => {
          if (!committed) moveInFlightRef.current = false;
        }).catch(() => { moveInFlightRef.current = false; });
      }
    }, 500);

    return () => clearInterval(interval);
  }, [gamePhase, winner]);

  // --- Game actions ---

  const handleCreateGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    cleanupOldGames().catch(() => {}); // fire-and-forget stale game cleanup
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
      // Hide overlay immediately for responsiveness, but don't nuke game state yet
      setShowGameOver(false);
      clearTimeout(gameOverTimerRef.current);

      await resetGame(gameCode, activePlayerCount);

      // Only clear local state after Firebase write succeeds
      tokenAnimPos.current.clear();
      tokenAnimParity.current.clear();
      for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
      tokenAnimTimers.current.clear();
      tokenSlideClass.current.clear();
      for (const t of slideTimerRefs.current.values()) clearTimeout(t);
      slideTimerRefs.current.clear();
      for (const t of boardEntranceTimers.current.values()) clearTimeout(t);
      boardEntranceTimers.current.clear();
      for (const t of reactionTimers.current.values()) clearTimeout(t);
      reactionTimers.current.clear();
      clearTimeout(hintTimeoutRef.current);
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(turnTransitionTimeoutRef.current);
      clearTimeout(turnNudgeTimeoutRef.current);
      clearTimeout(burstTimeoutRef.current);
      lastMovedPlayerRef.current = null;
      tokenEnteredBoard.current.clear();
      moveInFlightRef.current = false;
      isRollingRef.current = false;
      lastAutoRollTurnStartRef.current = 0;
      setIsRolling(false);
      prevPositionsRef.current = '';
      isInitialLoadRef.current = false;
      setHasRolledThisTurn(false);
      setGameNumber(n => n + 1);
      if (confettiAnimRef.current) cancelAnimationFrame(confettiAnimRef.current);
    } catch (err) {
      console.error('[Snakes] Reset failed:', err);
      setShowGameOver(true); // restore overlay since reset failed
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
    clearTimeout(rollTimeoutRef.current);
    clearTimeout(burstTimeoutRef.current);
    clearTimeout(hintTimeoutRef.current);
    clearTimeout(turnTransitionTimeoutRef.current);
    clearTimeout(turnNudgeTimeoutRef.current);
    setMoveLog([]);
    setHasRolledThisTurn(false);
    setIsRolling(false);
    isRollingRef.current = false;
    moveInFlightRef.current = false;
    lastAutoRollTurnStartRef.current = 0;
    prevPositionsRef.current = '';
    lastMovedPlayerRef.current = null;
    // Clear all animation timers (hop, slide, entrance, reactions) to prevent orphan callbacks
    tokenAnimPos.current.clear();
    tokenAnimParity.current.clear();
    for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
    tokenAnimTimers.current.clear();
    tokenSlideClass.current.clear();
    for (const t of slideTimerRefs.current.values()) clearTimeout(t);
    slideTimerRefs.current.clear();
    for (const t of boardEntranceTimers.current.values()) clearTimeout(t);
    boardEntranceTimers.current.clear();
    tokenEnteredBoard.current.clear();
    for (const t of reactionTimers.current.values()) clearTimeout(t);
    reactionTimers.current.clear();
    setWinTally({});
    setGameNumber(1);
    setFloatingReactions([]);
    if (confettiAnimRef.current) cancelAnimationFrame(confettiAnimRef.current);
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

  const handleCellHoverEnter = useCallback((cell: number) => setHoveredCell(cell), []);
  const handleCellHoverLeave = useCallback(() => setHoveredCell(null), []);

  const gameStats = useMemo(
    () => winner !== null && moveLog.length > 0 ? computeGameStats(moveLog, activePlayerCount) : null,
    [winner, moveLog, activePlayerCount],
  );

  const snakeLadderSVG = useMemo(() => (
    <svg className={styles.svgOverlay} viewBox="0 0 150 100" preserveAspectRatio="none">
      {Object.entries(LADDERS).map(([from, to], i) => renderLadderSVG(Number(from), to, i))}
      {Object.entries(SNAKES).map(([from, to], i) => renderSnakeSVG(Number(from), to, i))}
    </svg>
  ), []);

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
      left = animCoords[1] * COL_PCT + COL_PCT / 2;
      top = animCoords[0] * ROW_PCT + ROW_PCT / 2;
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
      >
        {isArriving && DUST_DIRS.map(([dx, dy], i) => (
          <span
            key={`dust-${i}`}
            className={styles.dustParticle}
            style={{ '--dust-dx': dx, '--dust-dy': dy } as React.CSSProperties}
          />
        ))}
      </div>
    );
  }

  // --- Render ---

  return (
    <div className={`${styles.popup} ${turnNudge ? styles.popupNudge : ''}`} style={{ left: position.x, top: position.y }}>
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
                <div className={styles.board} style={{ '--board-wear': Math.min(moveLog.length / 50, 1) } as React.CSSProperties}>
                  {BOARD_CELLS.map(cellNum => (
                    <BoardCell
                      key={cellNum}
                      cellNum={cellNum}
                      hoveredCell={hoveredCell}
                      onHoverEnter={handleCellHoverEnter}
                      onHoverLeave={handleCellHoverLeave}
                    />
                  ))}
                </div>
                {snakeLadderSVG}
                {/* Interactive hover hit targets — thick invisible strokes over each snake/ladder */}
                <svg className={styles.svgOverlay} viewBox="0 0 150 100" preserveAspectRatio="none"
                  style={{ zIndex: 6, pointerEvents: 'none' }}>
                  {Object.entries(SNAKES).map(([from, to]) => {
                    const [x1, y1] = cellCenter(Number(from));
                    const [x2, y2] = cellCenter(to);
                    return (
                      <line key={`hit-s-${from}`}
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke="transparent" strokeWidth="4" strokeLinecap="round"
                        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredCell(Number(from))}
                        onMouseLeave={() => setHoveredCell(null)}
                      />
                    );
                  })}
                  {Object.entries(LADDERS).map(([from, to]) => {
                    const [x1, y1] = cellCenter(Number(from));
                    const [x2, y2] = cellCenter(to);
                    return (
                      <line key={`hit-l-${from}`}
                        x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke="transparent" strokeWidth="4" strokeLinecap="round"
                        style={{ pointerEvents: 'auto', cursor: 'pointer' }}
                        onMouseEnter={() => setHoveredCell(Number(from))}
                        onMouseLeave={() => setHoveredCell(null)}
                      />
                    );
                  })}
                </svg>
                {/* Hover highlight SVG */}
                {hoveredCell !== null && (() => {
                  const dest = SNAKES[hoveredCell] ?? LADDERS[hoveredCell];
                  if (dest === undefined) return null;
                  const [sx, sy] = cellCenter(hoveredCell);
                  const [dx2, dy2] = cellCenter(dest);
                  const isSnakeH = SNAKES[hoveredCell] !== undefined;
                  const hc = isSnakeH ? '#e4002b' : '#34a853';
                  return (
                    <svg className={styles.svgOverlay} viewBox="0 0 150 100" preserveAspectRatio="none" style={{ zIndex: 6 }}>
                      <line x1={sx} y1={sy} x2={dx2} y2={dy2} stroke={hc} strokeWidth="1.2" strokeDasharray="2 1.5" opacity="0.6" />
                      <circle cx={sx} cy={sy} r="3" fill={hc} opacity="0.25" />
                      <circle cx={dx2} cy={dy2} r="3" fill={hc} opacity="0.25" />
                    </svg>
                  );
                })()}
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
                <canvas ref={confettiCanvasRef} className={styles.confettiCanvas} />
                {floatingReactions.map(r => (
                  <div key={r.id} className={styles.floatingReaction} style={{ left: `${r.left}%` }}>
                    {r.emoji}
                  </div>
                ))}
              </div>
            </div>

            {/* Side panel */}
            <div className={styles.sidePanel}>
              {/* Turn indicator */}
              <div className={styles.turnIndicator}>
                <span
                  className={`${styles.statusDot} ${turnTransitioning ? styles.statusDotTransition : ''}`}
                  style={{ background: COLOR_HEX[PLAYER_COLORS[currentTurn]] }}
                />
                {winner !== null ? (
                  <span className={styles.winText}>
                    {playerNames[winner] || COLOR_LABELS[PLAYER_COLORS[winner]]} wins!
                  </span>
                ) : (
                  <span>
                    {isMyTurn ? 'Your turn' : `${playerNames[currentTurn] || COLOR_LABELS[PLAYER_COLORS[currentTurn]]}'s turn`}
                  </span>
                )}
              </div>

              {/* Countdown timer */}
              {winner === null && (
                <CountdownTimer
                  key={`${currentTurn}-${turnStartedAtState}`}
                  turnStartedAt={turnStartedAtState}
                  serverOffset={serverOffsetState}
                />
              )}

              {statusHint && gamePhase === 'playing' && (
                <div className={styles.statusHint}>{statusHint}</div>
              )}

              {/* Dice */}
              <div className={styles.sideDice}>
                <button
                  className={[
                    styles.dice,
                    isMyTurn && !isRolling && !isAnimating && winner === null ? styles.diceActive : '',
                    isRolling ? styles.diceRolling : '',
                  ].filter(Boolean).join(' ')}
                  onClick={handleRollDice}
                  disabled={!isMyTurn || isRolling || winner !== null || isAnimating}
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
                {isMyTurn && !isRolling && !isAnimating && !hasRolledThisTurn && !winner && (
                  <span className={styles.rollReminder}>Roll!</span>
                )}
                {consecutiveSixes > 0 && winner === null && (
                  <span className={`${styles.streakBadge} ${consecutiveSixes >= 2 ? styles.streakDanger : ''}`}>
                    {'\u{1F525}'.repeat(consecutiveSixes)}
                  </span>
                )}
                {isAnimating && !isMyTurn && (
                  <span className={styles.statusHint}>Moving...</span>
                )}
              </div>

              {/* Emoji reactions */}
              {!isSpectating && winner === null && (
                <div className={styles.reactionBar}>
                  {['\u{1F602}', '\u{1F389}', '\u{1F631}', '\u{1F44F}', '\u{1F40D}'].map(emoji => (
                    <button
                      key={emoji}
                      className={styles.reactionBtn}
                      onClick={() => {
                        const now = Date.now();
                        if (now - lastReactionTimeRef.current < 2000) return;
                        lastReactionTimeRef.current = now;
                        if (gameCode && mySlot !== null) {
                          sendReaction(gameCode, mySlot, emoji).catch(() => {});
                        }
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* Player list */}
              <div className={`${styles.playerBar} ${styles.playerBarVertical}`}>
                {Array.from({ length: activePlayerCount }, (_, i) => {
                  const color = PLAYER_COLORS[i];
                  const name = playerNames[i] || COLOR_LABELS[color];
                  const isCurrent = currentTurn === i && !winner;
                  const isMe = mySlot === i;
                  const isWinner = winner === i;
                  const isDimmed = winner !== null && winner !== i;
                  const isNearWin = !winner && positions[i] >= BOARD_SIZE - 6 && positions[i] > 0;

                  return (
                    <div
                      key={i}
                      className={[
                        styles.playerChip,
                        isCurrent ? styles.playerChipActive : '',
                        isMe ? styles.playerChipMe : '',
                        isWinner ? styles.playerChipWinner : '',
                        isDimmed ? styles.playerChipDimmed : '',
                        isNearWin ? styles.playerChipNearWin : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <span className={styles.playerChipDot} style={{ background: COLOR_HEX[color] }} />
                      <span>{name}</span>
                      {isMe && <span className={styles.youBadge}>(you)</span>}
                      {(winTally[i] || 0) > 0 && (
                        <span className={styles.winBadge}>{'\u{1F3C6}'}{winTally[i]}</span>
                      )}
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
                    {moveLog.slice(-10).reverse().map((entry, idx) => {
                      const logIdx = moveLog.length - 1 - idx;
                      const color = PLAYER_COLORS[entry.player];
                      const name = playerNames[entry.player] || COLOR_LABELS[color];
                      return (
                        <div key={logIdx} className={styles.moveLogEntry}>
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
                  <div className={styles.gameOverTrophy}>{'\u{1F3C6}'}</div>
                  <div className={styles.gameOverTitle}>
                    <span className={styles.gameOverDot} style={{ background: COLOR_HEX[PLAYER_COLORS[winner]] }} />
                    {winner === mySlot
                      ? 'You win!'
                      : `${playerNames[winner] || COLOR_LABELS[PLAYER_COLORS[winner]]} wins!`}
                  </div>
                  {/* Rematch series */}
                  {Object.values(winTally).some(v => v > 0) && (
                    <div className={styles.gameOverSeries}>
                      Game {gameNumber} &middot;{' '}
                      {Object.entries(winTally)
                        .sort(([, a], [, b]) => b - a)
                        .map(([idx, wins]) => `${playerNames[Number(idx)] || COLOR_LABELS[PLAYER_COLORS[Number(idx)]]} ${wins}`)
                        .join(' \u2013 ')}
                    </div>
                  )}
                  {/* Post-game stats */}
                  {gameStats && (
                    <div className={styles.statsGrid}>
                      {gameStats.map((s, i) => {
                        if (s.totalMoves === 0) return null;
                        const color = PLAYER_COLORS[i];
                        const name = playerNames[i] || COLOR_LABELS[color];
                        return (
                          <div key={i} className={styles.statCard}>
                            <div className={styles.statCardHeader}>
                              <span className={styles.playerChipDot} style={{ background: COLOR_HEX[color] }} />
                              <span>{name}</span>
                            </div>
                            <div className={styles.statRow}><span>Moves</span><span>{s.totalMoves}</span></div>
                            <div className={styles.statRow}><span>Snakes</span><span className={styles.moveLogSnake}>{s.snakesHit}</span></div>
                            <div className={styles.statRow}><span>Ladders</span><span className={styles.moveLogLadder}>{s.laddersClimbed}</span></div>
                            {s.biggestSnakeFall > 0 && (
                              <div className={styles.statRow}><span>Worst snake</span><span>-{s.biggestSnakeFall}</span></div>
                            )}
                            {s.biggestLadderGain > 0 && (
                              <div className={styles.statRow}><span>Best ladder</span><span>+{s.biggestLadderGain}</span></div>
                            )}
                          </div>
                        );
                      })}
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
