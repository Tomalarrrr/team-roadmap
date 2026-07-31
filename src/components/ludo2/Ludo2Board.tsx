// Presentational Y-board for Ludo2. All positioning comes from ludo2Geometry;
// this component just renders cells, decorations, badges and tokens. Token
// movement is driven by the parent via animPos/animParity overrides (the same
// imperative ref-driven stepper as Ludo v1).

import type { TokenPosition } from '../../ludoFirebase';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  START_POSITIONS,
  ENTRY_CELLS,
  SAFE_ZONES,
  PLAYER_COLORS,
  getTokenColor,
  getPlayerScore,
  type Ludo2Color,
} from '../../ludo2Board';
import {
  CELL_PCT,
  BASE_PAD,
  BASE_PAD_SIZE,
  BASE_XY,
  ARM_RECT,
  ARM_RECT_SIZE,
  START_MARKER,
  BADGE_XY,
  HUB,
  trackCellSpec,
  finalCellSpec,
  getTokenCoords,
  getTokenOffset,
} from './ludo2Geometry';
import styles from './Ludo2Game.module.css';

const COLOR_HEX: Record<Ludo2Color, string> = {
  red: '#ea4330', green: '#34a853', yellow: '#fbbc05',
};

const TOKEN_STYLE: Record<Ludo2Color, string> = {
  red: styles.tokenRed, green: styles.tokenGreen, yellow: styles.tokenYellow,
};

const ARM_STYLE: Record<Ludo2Color, string> = {
  red: styles.armRed, green: styles.armGreen, yellow: styles.armYellow,
};

const TOKEN_PCT = CELL_PCT * 0.7;

const TRACK_INDICES = Array.from({ length: TRACK_SIZE }, (_, i) => i + 1);
const TOKEN_INDICES = Array.from({ length: TOTAL_TOKENS }, (_, i) => i);

const START_CELL_COLOR: Record<number, Ludo2Color> = {};
const ENTRY_CELL_COLOR: Record<number, Ludo2Color> = {};
for (const c of PLAYER_COLORS) {
  START_CELL_COLOR[START_POSITIONS[c]] = c;
  ENTRY_CELL_COLOR[ENTRY_CELLS[c]] = c;
}

/** Center-anchored absolute position + per-arm rotation. */
function cellStyle(x: number, y: number, rot: number, size = CELL_PCT) {
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
  currentTurn: Ludo2Color;
  winner: Ludo2Color | null;
  myColor: Ludo2Color | null;
  validMoves: Map<number, TokenPosition>;
  lastMovedToken: number | null;
  animPos: Map<number, [number, number]>;
  animParity: Map<number, number>;
  capturedGhosts: CapturedGhost[];
  playerNames: Partial<Record<Ludo2Color, string>>;
  onTokenClick: (tokenIndex: number) => void;
}

export function Ludo2Board({
  tokens,
  playerCount,
  currentTurn,
  winner,
  myColor,
  validMoves,
  lastMovedToken,
  animPos,
  animParity,
  capturedGhosts,
  playerNames,
  onTokenClick,
}: Ludo2BoardProps) {
  const activeColors = PLAYER_COLORS.slice(0, playerCount);

  return (
    <div className={styles.board}>
      {/* Arm silhouettes */}
      {PLAYER_COLORS.map(color => {
        const spec = ARM_RECT[color];
        const inactive = !activeColors.includes(color);
        return (
          <div
            key={`arm-${color}`}
            className={`${styles.armRect} ${ARM_STYLE[color]} ${inactive ? styles.armInactive : ''}`}
            style={{
              left: `${spec.x - ARM_RECT_SIZE.w / 2}%`,
              top: `${spec.y - ARM_RECT_SIZE.h / 2}%`,
              width: `${ARM_RECT_SIZE.w}%`,
              height: `${ARM_RECT_SIZE.h}%`,
              transform: `rotate(${spec.rot}deg)`,
            }}
          />
        );
      })}

      {/* Hub + house icon */}
      <div
        className={styles.hub}
        style={cellStyle(HUB.x, HUB.y, 0, HUB.r * 2)}
      >
        <svg viewBox="0 0 24 24" className={styles.hubIcon} aria-hidden="true">
          <path d="M4 11L12 4L20 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M6.5 10.5V19H17.5V10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>

      {/* Track cells */}
      {TRACK_INDICES.map(t => {
        const spec = trackCellSpec(t);
        const startColor = START_CELL_COLOR[t];
        const entryColor = ENTRY_CELL_COLOR[t];
        const classes = [styles.cell];
        if (SAFE_ZONES.has(t)) classes.push(styles.cellSafe);
        if (startColor) classes.push(styles.cellStart);
        if (entryColor) classes.push(styles.cellEntry);
        const tint = startColor ?? entryColor;
        return (
          <div
            key={`cell-${t}`}
            className={classes.join(' ')}
            style={{
              ...cellStyle(spec.x, spec.y, spec.rot),
              ...(tint ? { background: COLOR_HEX[tint], borderColor: COLOR_HEX[tint] } : {}),
            }}
          >
            {entryColor && <span className={styles.entryArrow}>▲</span>}
          </div>
        );
      })}

      {/* Final columns */}
      {PLAYER_COLORS.map(color =>
        [1, 2, 3, 4, 5, 6].map(f => {
          const spec = finalCellSpec(color, f);
          const inactive = !activeColors.includes(color);
          return (
            <div
              key={`final-${color}-${f}`}
              className={`${styles.cell} ${styles.cellFinal} ${inactive ? styles.cellInactive : ''}`}
              style={{
                ...cellStyle(spec.x, spec.y, spec.rot),
                background: COLOR_HEX[color],
                borderColor: COLOR_HEX[color],
              }}
            />
          );
        })
      )}

      {/* Start triangles on the vacant tip spots */}
      {PLAYER_COLORS.map(color => {
        const spec = START_MARKER[color];
        const inactive = !activeColors.includes(color);
        return (
          <div
            key={`marker-${color}`}
            className={`${styles.startMarker} ${inactive ? styles.cellInactive : ''}`}
            style={{ ...cellStyle(spec.x, spec.y, spec.rot), color: COLOR_HEX[color] }}
          >
            ◀
          </div>
        );
      })}

      {/* Base pads + resting spots */}
      {PLAYER_COLORS.map(color => {
        const pad = BASE_PAD[color];
        const inactive = !activeColors.includes(color);
        return (
          <div key={`pad-${color}`} className={inactive ? styles.cellInactive : undefined}>
            <div
              className={styles.basePad}
              style={{
                left: `${pad.x - BASE_PAD_SIZE.w / 2}%`,
                top: `${pad.y - BASE_PAD_SIZE.h / 2}%`,
                width: `${BASE_PAD_SIZE.w}%`,
                height: `${BASE_PAD_SIZE.h}%`,
                transform: `rotate(${pad.rot}deg)`,
                background: COLOR_HEX[color],
              }}
            />
            {BASE_XY[color].map(([x, y], i) => (
              <div
                key={`spot-${color}-${i}`}
                className={styles.baseSpot}
                style={cellStyle(x, y, 0, CELL_PCT * 0.82)}
              />
            ))}
          </div>
        );
      })}

      {/* Score badges */}
      {activeColors.map(color => {
        const [x, y] = BADGE_XY[color];
        const name = playerNames[color];
        const isTurn = currentTurn === color && !winner;
        return (
          <div
            key={`badge-${color}`}
            className={[
              styles.scoreBadge,
              isTurn ? styles.scoreBadgeActive : '',
              myColor === color ? styles.scoreBadgeMe : '',
            ].filter(Boolean).join(' ')}
            style={{ ...cellStyle(x, y, 0, 13), borderColor: COLOR_HEX[color] }}
          >
            <span className={styles.scoreBadgeLabel} style={{ color: COLOR_HEX[color] }}>
              {name ?? color}
            </span>
            <span className={styles.scoreBadgeValue}>{getPlayerScore(tokens, color)}</span>
          </div>
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
        const coords = anim ?? getTokenCoords(tokens[i], i);
        if (!coords) return null;
        const [ox, oy] = anim ? [0, 0] : getTokenOffset(tokens, i);
        const clickable = validMoves.has(i) && !anim;
        const parity = animParity.get(i);
        // Finished pawns shrink so the four-counter home pile fits inside the
        // hub without burying the house icon.
        const size = !anim && tokens[i] === 'final-6' ? TOKEN_PCT * 0.68 : TOKEN_PCT;
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
  );
}
