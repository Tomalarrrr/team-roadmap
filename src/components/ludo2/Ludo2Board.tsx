// Presentational Y-board for Ludo2. All positioning comes from ludo2Geometry;
// this component just renders cells, decorations and tokens. Token movement is
// driven by the parent via animPos/animParity overrides (the same imperative
// ref-driven stepper as Ludo v1).

import { Fragment, type CSSProperties } from 'react';
import type { TokenPosition } from '../../ludoFirebase';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  START_POSITIONS,
  ENTRY_CELLS,
  SAFE_ZONES,
  PLAYER_COLORS,
  getTokenColor,
  type Ludo2Color,
} from '../../ludo2Board';
import {
  ARM_ANGLE,
  CELL_PCT,
  BASE_SPOT_PCT,
  BASE_TRAY,
  BASE_TRAY_SIZE,
  BASE_XY,
  ARM_RECT,
  ARM_RECT_SIZE,
  TIP_BLANK,
  HUB,
  trackCellSpec,
  finalCellSpec,
  getTokenCoords,
  getTokenOffset,
} from './ludo2Geometry';
import styles from './Ludo2Game.module.css';

// --- Palette ---------------------------------------------------------------
// Simulating deuteranopia showed red and amber — not red and green — collapsing
// onto the same olive. So the three hues are spaced on *lightness*, which
// survives when hue does not: with all colour information removed they land at
// 0.10 / 0.33 / 0.66, roughly a doubling per step. Position carries the rest —
// the board always turns so your own arm faces you.

/** Pawn / dot hue. */
const COLOR_HEX: Record<Ludo2Color, string> = {
  red: '#d13a22', green: '#31a566', yellow: '#f2a838',
};

/** Ink for marks drawn on a washed cell; all three clear 4.5:1 on their wash. */
const COLOR_INK: Record<Ludo2Color, string> = {
  red: '#a82d1a', green: '#1f7c4a', yellow: '#8a5a06',
};

/** `pct`% of the hue over white. Mixed here rather than with CSS color-mix so
 * the board still renders in colour on older browsers. */
function wash(color: Ludo2Color, pct: number): string {
  const n = parseInt(COLOR_HEX[color].slice(1), 16);
  const p = pct * WASH_GAIN[color];
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(c => Math.round(255 - ((255 - c) * p) / 100).toString(16).padStart(2, '0'));
  return `#${ch.join('')}`;
}

/** Amber sits far higher on the luminance curve than red or green, so an
 * identical wash reads ~40% weaker. Per-hue gain, tuned so all three arms land
 * within a hair of 1.30:1 against white — i.e. all equally present. */
const WASH_GAIN: Record<Ludo2Color, number> = { red: 0.92, green: 1.09, yellow: 1.45 };

/** Arm and base tray. At 22 the arm is a surface you can see; below ~18 it
 * drops under the threshold where the eye reads it as a distinct plane. */
const ARM_WASH = 22;
/** Start and entry cells: a clear step deeper than the arm they sit in. */
const CELL_WASH = 30;
/** Home corridor, deepening toward the hub so the run home reads as progress.
 * Starts at CELL_WASH so entry → final-1 never steps backwards. */
const finalWash = (f: number) => CELL_WASH + f * 1.7;

const COLOR_PASTEL: Record<Ludo2Color, string> = {
  red: wash('red', ARM_WASH),
  green: wash('green', ARM_WASH),
  yellow: wash('yellow', ARM_WASH),
};

const COLOR_TINT: Record<Ludo2Color, string> = {
  red: wash('red', CELL_WASH),
  green: wash('green', CELL_WASH),
  yellow: wash('yellow', CELL_WASH),
};

const TOKEN_STYLE: Record<Ludo2Color, string> = {
  red: styles.tokenRed, green: styles.tokenGreen, yellow: styles.tokenYellow,
};

const TOKEN_PCT = CELL_PCT * 0.7;
/** Cells sit close inside their pitch, leaving a thin line of the arm's own
 * colour as grout. Ludo v1 lets its cells touch outright and reads far airier
 * for it; a wide gutter plus a drop shadow turned every cell into a floating
 * card, which is what made this board feel boxed-off and segmented. */
const CELL_TILE = CELL_PCT * 0.94;

/** Five-point star, outer r10 / inner r4.2 on a 24×24 box. Drawn rather than
 * typeset so the safe mark scales with the board instead of the font size. */
const STAR_PATH =
  'M12 2L14.47 8.6L21.51 8.91L15.99 13.3L17.88 20.09L12 16.2L6.12 20.09L8.01 13.3L2.49 8.91L9.53 8.6Z';

const TRACK_INDICES = Array.from({ length: TRACK_SIZE }, (_, i) => i + 1);
const TOKEN_INDICES = Array.from({ length: TOTAL_TOKENS }, (_, i) => i);

const START_CELL_COLOR: Record<number, Ludo2Color> = {};
const ENTRY_CELL_COLOR: Record<number, Ludo2Color> = {};
for (const c of PLAYER_COLORS) {
  START_CELL_COLOR[START_POSITIONS[c]] = c;
  ENTRY_CELL_COLOR[ENTRY_CELLS[c]] = c;
}

/** Center-anchored absolute position + per-arm rotation. */
function cellStyle(x: number, y: number, rot: number, size = CELL_TILE) {
  return {
    left: `${x - size / 2}%`,
    top: `${y - size / 2}%`,
    width: `${size}%`,
    height: `${size}%`,
    transform: rot ? `rotate(${rot}deg)` : undefined,
  };
}

export interface CapturedGhost {
  index: number;
  coords: [number, number];
  color: Ludo2Color;
}

interface Ludo2BoardProps {
  tokens: TokenPosition[];
  playerCount: number;
  myColor: Ludo2Color | null;
  validMoves: Map<number, TokenPosition>;
  lastMovedToken: number | null;
  animPos: Map<number, [number, number]>;
  animParity: Map<number, number>;
  capturedGhosts: CapturedGhost[];
  onTokenClick: (tokenIndex: number) => void;
}

export function Ludo2Board({
  tokens,
  playerCount,
  myColor,
  validMoves,
  lastMovedToken,
  animPos,
  animParity,
  capturedGhosts,
  onTokenClick,
}: Ludo2BoardProps) {
  const activeColors = PLAYER_COLORS.slice(0, playerCount);

  // Spin the board face so the local player's arm points at them. The figure is
  // three-fold symmetric about the hub, so a ±120° turn about HUB maps it
  // exactly onto itself — the layout is untouched, only the colours move. The
  // slab underneath stays put: the camera is fixed, the board turns.
  const spin = -(myColor ? ARM_ANGLE[myColor] : 0);

  // A spectator has no seat of their own, so they get every tray; a player gets
  // only theirs.
  const trayColors = myColor ? [myColor] : PLAYER_COLORS;

  return (
    <div className={styles.boardStage}>
      <div className={styles.boardShadow} aria-hidden="true" />
      <div className={styles.board}>
      <div
        className={styles.boardPlate}
        style={{
          transform: `rotate(${spin}deg)`,
          transformOrigin: `${HUB.x}% ${HUB.y}%`,
        }}
      >
      {/* Arm silhouettes */}
      {PLAYER_COLORS.map(color => {
        const spec = ARM_RECT[color];
        const inactive = !activeColors.includes(color);
        return (
          <div
            key={`arm-${color}`}
            className={`${styles.armRect} ${inactive ? styles.armInactive : ''}`}
            style={{
              left: `${spec.x - ARM_RECT_SIZE.w / 2}%`,
              top: `${spec.y - ARM_RECT_SIZE.h / 2}%`,
              width: `${ARM_RECT_SIZE.w}%`,
              height: `${ARM_RECT_SIZE.h}%`,
              transform: `rotate(${spec.rot}deg)`,
              background: COLOR_PASTEL[color],
            }}
          />
        );
      })}

      {/* Hub — the shared goal. Deliberately unmarked: three corridors ending
          in a well is already unambiguous, and every icon tried here (a house
          needing counter-rotation, a bullseye reading as an aperture) added
          ambiguity rather than removing it. */}
      <div className={styles.hub} style={cellStyle(HUB.x, HUB.y, 0, HUB.r * 2)} />

      {/* Inert tip corner the track skips — kept so the 3×7 grid reads whole */}
      {PLAYER_COLORS.map(color => {
        const spec = TIP_BLANK[color];
        const inactive = !activeColors.includes(color);
        return (
          <div
            key={`blank-${color}`}
            className={`${styles.cell} ${styles.cellBlank} ${inactive ? styles.cellInactive : ''}`}
            style={cellStyle(spec.x, spec.y, spec.rot)}
          />
        );
      })}

      {/* Track cells */}
      {TRACK_INDICES.map(t => {
        const spec = trackCellSpec(t);
        const startColor = START_CELL_COLOR[t];
        const entryColor = ENTRY_CELL_COLOR[t];
        const tint = startColor ?? entryColor;
        return (
          <div
            key={`cell-${t}`}
            className={`${styles.cell} ${startColor ? styles.cellStart : ''}`}
            style={{
              ...cellStyle(spec.x, spec.y, spec.rot),
              ...(tint ? { background: COLOR_TINT[tint] } : {}),
              // Ring (see .cellStart) rather than a solid fill: a pawn resting
              // on its own start cell would otherwise vanish into it.
              ...(startColor ? { ['--ring' as string]: COLOR_HEX[startColor] } : {}),
            } as CSSProperties}
          >
            {SAFE_ZONES.has(t) && (
              <svg viewBox="0 0 24 24" className={styles.safeStar} aria-hidden="true">
                <path d={STAR_PATH} fill={startColor ? COLOR_INK[startColor] : '#8e8e97'} />
              </svg>
            )}
            {entryColor && (
              <svg viewBox="0 0 12 12" className={styles.entryArrow} aria-hidden="true">
                <path
                  d="M6 3.5L6 9M6 3.5L3.6 6M6 3.5L8.4 6"
                  stroke={COLOR_INK[entryColor]}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                />
              </svg>
            )}
          </div>
        );
      })}

      {/* Final corridors */}
      {PLAYER_COLORS.map(color =>
        [1, 2, 3, 4, 5, 6].map(f => {
          const spec = finalCellSpec(color, f);
          const inactive = !activeColors.includes(color);
          return (
            <div
              key={`final-${color}-${f}`}
              className={`${styles.cell} ${inactive ? styles.cellInactive : ''}`}
              style={{
                ...cellStyle(spec.x, spec.y, spec.rot),
                background: wash(color, finalWash(f)),
              }}
            />
          );
        })
      )}

      {/* Only your own holding tray is drawn. How many pieces an opponent still
          has in hand is already legible from the board — three trays was three
          times the furniture for information you can count anyway. */}
      {trayColors.map(color => {
        const tray = BASE_TRAY[color];
        const inactive = !activeColors.includes(color);
        return (
          <Fragment key={`tray-${color}`}>
            <div
              className={`${styles.baseTray} ${inactive ? styles.cellInactive : ''}`}
              style={{
                left: `${tray.x - BASE_TRAY_SIZE.w / 2}%`,
                top: `${tray.y - BASE_TRAY_SIZE.h / 2}%`,
                width: `${BASE_TRAY_SIZE.w}%`,
                height: `${BASE_TRAY_SIZE.h}%`,
                transform: `rotate(${tray.rot}deg)`,
                background: COLOR_PASTEL[color],
              }}
            />
            {BASE_XY[color].map(([x, y], i) => (
              <div
                key={`spot-${color}-${i}`}
                className={`${styles.baseSpot} ${inactive ? styles.cellInactive : ''}`}
                style={cellStyle(x, y, 0, BASE_SPOT_PCT)}
              />
            ))}
          </Fragment>
        );
      })}

      {/* Capture ghosts (fading token at the capture spot) */}
      {capturedGhosts.map(ghost => (
        <div
          key={`ghost-${ghost.index}-${ghost.coords[0]}`}
          className={`${styles.token} ${TOKEN_STYLE[ghost.color]} ${styles.tokenCaptured}`}
          style={{
            left: `${ghost.coords[0] - TOKEN_PCT / 2}%`,
            top: `${ghost.coords[1] - TOKEN_PCT / 2}%`,
            width: `${TOKEN_PCT}%`,
            height: `${TOKEN_PCT}%`,
          }}
        />
      ))}

      {/* Tokens */}
      {TOKEN_INDICES.map(i => {
        const color = getTokenColor(i);
        if (!activeColors.includes(color)) return null;
        const anim = animPos.get(i);
        // Opponent pieces still in hand have no tray to sit in; one that is
        // mid-deploy keeps its animation and slides in from off-board.
        if (!anim && tokens[i] === 'base' && myColor && color !== myColor) return null;
        const coords = anim ?? getTokenCoords(tokens[i], i);
        if (!coords) return null;
        const [ox, oy] = anim ? [0, 0] : getTokenOffset(tokens, i);
        const clickable = validMoves.has(i) && !anim;
        const parity = animParity.get(i);
        // Finished pawns shrink so the four-counter home pile fits inside the
        // hub without burying the house icon.
        const size = !anim && tokens[i] === 'final-6' ? TOKEN_PCT * 0.82 : TOKEN_PCT;
        const classes = [
          styles.token,
          TOKEN_STYLE[color],
          clickable ? styles.tokenClickable : '',
          parity === 0 ? styles.tokenSteppingA : parity === 1 ? styles.tokenSteppingB : '',
          lastMovedToken === i ? styles.tokenArriving : '',
        ].filter(Boolean).join(' ');
        return (
          <div
            key={`token-${i}`}
            className={classes}
            style={{
              left: `${coords[0] - size / 2 + ox}%`,
              top: `${coords[1] - size / 2 + oy}%`,
              width: `${size}%`,
              height: `${size}%`,
            }}
            onClick={clickable ? () => onTokenClick(i) : undefined}
            role={clickable ? 'button' : undefined}
            aria-label={
              clickable
                ? `Move ${color} token ${(i % 4) + 1} to ${validMoves.get(i)}`
                : `${color} token ${(i % 4) + 1} at ${tokens[i]}`
            }
          />
        );
      })}
        </div>
        <div className={styles.boardHaze} aria-hidden="true" />
      </div>
    </div>
  );
}
