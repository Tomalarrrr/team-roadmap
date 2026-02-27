import { useState, useEffect, memo } from 'react';
import {
  cellToGrid,
  SNAKES,
  LADDERS,
  BOARD_COLS,
  BOARD_ROWS,
  BOARD_SIZE,
  type PlayerColor,
} from '../../utils/snakesLogic';
import styles from '../SnakesGame.module.css';

// --- Constants ---

export const TURN_SECONDS = 10;
export const BACKUP_GRACE = 10;
export const STEP_MS = 340;
export const SLIDE_MS = 1100;
export const MAX_LOG_ENTRIES = 20;
export const COL_PCT = 100 / BOARD_COLS;  // ~6.667% per column
export const ROW_PCT = 100 / BOARD_ROWS;  // 10% per row
export const TOKEN_SIZE_PCT = COL_PCT * 0.5;

export const TOKEN_STYLE: Record<PlayerColor, string> = {
  red: styles.tokenRed,
  green: styles.tokenGreen,
  blue: styles.tokenBlue,
  yellow: styles.tokenYellow,
  purple: styles.tokenPurple,
  orange: styles.tokenOrange,
  teal: styles.tokenTeal,
};

// Dice pips: [gridRow, gridCol] for 3x3 grid
export const DICE_PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [[1, 3], [3, 1]],
  3: [[1, 3], [2, 2], [3, 1]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};

// Pre-computed board cell indices
export const BOARD_CELLS = Array.from({ length: BOARD_SIZE }, (_, i) => i + 1);

// Pre-computed danger/opportunity zone cells (1-2 cells before snake heads / ladder bases)
export const NEAR_SNAKE_CELLS = new Set<number>();
for (const head of Object.keys(SNAKES).map(Number)) {
  for (let offset = 1; offset <= 2; offset++) {
    const cell = head - offset;
    if (cell >= 1 && SNAKES[cell] === undefined && LADDERS[cell] === undefined) {
      NEAR_SNAKE_CELLS.add(cell);
    }
  }
}
export const NEAR_LADDER_CELLS = new Set<number>();
for (const base of Object.keys(LADDERS).map(Number)) {
  for (let offset = 1; offset <= 2; offset++) {
    const cell = base - offset;
    if (cell >= 1 && SNAKES[cell] === undefined && LADDERS[cell] === undefined) {
      NEAR_LADDER_CELLS.add(cell);
    }
  }
}

// Dust poof scatter directions [dx, dy] for landing particles
export const DUST_DIRS: [string, string][] = [
  ['12px', '-9px'], ['-10px', '-11px'], ['14px', '5px'], ['-13px', '7px'], ['3px', '-14px'],
];

// --- DiceFace ---

export function DiceFace({ value }: { value: number }) {
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

// Returns SVG coordinates in a 150x100 viewBox (matching the 15x10 board at 10 units per cell)
export function cellCenter(cell: number): [number, number] {
  const [row, col] = cellToGrid(cell);
  return [col * 10 + 5, row * 10 + 5]; // x, y in isometric units
}

// Ladder color palettes for variety
export const LADDER_PALETTES = [
  { rail: '#8d6e3f', rung: '#a0845c', highlight: '#c4a872', shadow: '#5c4627' },
  { rail: '#6d4c2a', rung: '#8b6d45', highlight: '#b8956a', shadow: '#4a3219' },
  { rail: '#7b5b3a', rung: '#9e7e55', highlight: '#c9a76e', shadow: '#523c24' },
];

export function renderLadderSVG(from: number, to: number, index: number) {
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
export const SNAKE_PALETTES = [
  { body: '#c62828', belly: '#ef5350', shadow: '#7f1818' },   // red
  { body: '#2e7d32', belly: '#66bb6a', shadow: '#1b4d1e' },   // green
  { body: '#6a1b9a', belly: '#ab47bc', shadow: '#3c0f57' },   // purple
  { body: '#e65100', belly: '#ff8a50', shadow: '#8c3100' },   // orange
  { body: '#00695c', belly: '#4db6ac', shadow: '#003d33' },   // teal
];

export function renderSnakeSVG(from: number, to: number, index: number) {
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

export interface ConfettiParticle {
  x: number; y: number;
  vx: number; vy: number;
  rotation: number; rotationSpeed: number;
  color: string;
  w: number; h: number;
  gravity: number;
  opacity: number;
}

export function launchConfetti(
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

export const CountdownTimer = memo(function CountdownTimer({
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
