// Presentational circular board for Ludo4. All positioning comes from
// ludo4Geometry; this component draws the flat disc, the 56-cell ring, the
// four run-home spokes, the yard sockets and the pieces. Movement is driven by
// the parent via animPos/animParity overrides (the same imperative stepper as
// Ludo v1 and Ludo2).
//
// Deliberately 2D: Ludo2's board is a moulded, tilted, key-lit object; this one
// takes its layout from Ludo2 and its look from Ludo v1 — flat white cells with
// hairline borders, solid-colour start cells and corridors, glossy counters
// that glow when they can move. No lighting model, no perspective.

import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { TokenPosition } from '../../ludoFirebase';
import {
  TRACK_SIZE,
  TOTAL_TOKENS,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  START_POSITIONS,
  ENTRY_CELLS,
  SAFE_ZONES,
  PLAYER_COLORS,
  getTokenColor,
  describePosition,
  type Ludo4Color,
} from '../../ludo4Board';
import {
  ARM_ANGLE,
  SEAT_OFFSET_DEG,
  CELL_PCT,
  TOKEN_PCT,
  SPOKE_CELL,
  BASE_BAY_PCT,
  BASE_SPEC,
  HUB,
  trackCellSpec,
  finalCellSpec,
  getTokenCoords,
  getTokenOffset,
} from './ludo4Geometry';
import { pickNearestToken } from './ludo4HitTest';
import styles from './Ludo4Game.module.css';

// --- Palette ---------------------------------------------------------------
// Ludo v1's four seats, verbatim, so the two boards read as the same family.
const COLOR_HEX: Record<Ludo4Color, string> = {
  red: '#ea4330', green: '#34a853', yellow: '#fbbc05', blue: '#4285f4',
};

const TOKEN_STYLE: Record<Ludo4Color, string> = {
  red: styles.tokenRed,
  green: styles.tokenGreen,
  yellow: styles.tokenYellow,
  blue: styles.tokenBlue,
};

/** Five-point star, outer r10 / inner r4.2 on a 24×24 box. */
const STAR_PATH =
  'M12 2L14.47 8.6L21.51 8.91L15.99 13.3L17.88 20.09L12 16.2L6.12 20.09L8.01 13.3L2.49 8.91L9.53 8.6Z';

const TRACK_INDICES = Array.from({ length: TRACK_SIZE }, (_, i) => i + 1);
const TOKEN_INDICES = Array.from({ length: TOTAL_TOKENS }, (_, i) => i);
const FINAL_CELLS = Array.from({ length: FINAL_SIZE }, (_, i) => i + 1);

const START_CELL_COLOR: Record<number, Ludo4Color> = {};
const ENTRY_CELL_COLOR: Record<number, Ludo4Color> = {};
for (const c of PLAYER_COLORS) {
  START_CELL_COLOR[START_POSITIONS[c]] = c;
  ENTRY_CELL_COLOR[ENTRY_CELLS[c]] = c;
}

const SEAT_LABEL: Record<Ludo4Color, string> = {
  red: 'Red', green: 'Green', yellow: 'Yellow', blue: 'Blue',
};

/** What a cell is, for anyone who hovers it. Only the cells that carry a rule
 * get one — the three marks that actually mean something (start, haven, way
 * home) are exactly the three a new player has no way to read off the board. */
function trackCellTitle(t: number): string | undefined {
  const start = START_CELL_COLOR[t];
  if (start) return `${SEAT_LABEL[start]} starts here — safe from capture`;
  const entry = ENTRY_CELL_COLOR[t];
  if (entry) return `${SEAT_LABEL[entry]} turns for home here`;
  if (SAFE_ZONES.has(t)) return 'Safe — no capture on this space';
  return undefined;
}

/** Centre-anchored absolute box, optionally non-square and rotated. */
function box(x: number, y: number, w: number, h = w, rot = 0) {
  return {
    left: `${x - w / 2}%`,
    top: `${y - h / 2}%`,
    width: `${w}%`,
    height: `${h}%`,
    transform: rot ? `rotate(${rot}deg)` : undefined,
  };
}

export interface CapturedGhost {
  index: number;
  coords: [number, number];
  color: Ludo4Color;
}

interface Ludo4BoardProps {
  tokens: TokenPosition[];
  playerCount: number;
  myColor: Ludo4Color | null;
  validMoves: Map<number, TokenPosition>;
  lastMovedToken: number | null;
  animPos: Map<number, [number, number]>;
  animParity: Map<number, number>;
  capturedGhosts: CapturedGhost[];
  onTokenClick: (tokenIndex: number) => void;
}

export function Ludo4Board({
  tokens,
  playerCount,
  myColor,
  validMoves,
  lastMovedToken,
  animPos,
  animParity,
  capturedGhosts,
  onTokenClick,
}: Ludo4BoardProps) {
  const activeColors = PLAYER_COLORS.slice(0, playerCount);

  // Turn the board face so the local player's yard is nearest them. The layout
  // is four-fold symmetric about the centre, so ±90° turns map it exactly onto
  // itself — only the colours move. SEAT_OFFSET_DEG then parks the arms on the
  // diagonals: your yard by the bottom-left corner, and the vertical axis
  // (status line above the hub, die in it) clear of every arm.
  const spin = SEAT_OFFSET_DEG - (myColor ? ARM_ANGLE[myColor] : 0);
  // Anything that is read rather than pointed — the pieces, the safe stars —
  // has to be turned back, or a spun board hands the player a set of counters
  // lying on their sides.
  const upright = `rotate(${-spin}deg)`;

  // Where the offered moves land. "Which of my counters can move" is only half
  // the question — the other half is where it would end up.
  const moveTargets = new Set<TokenPosition>(validMoves.values());

  /* Presses land on the board, not on the counters: the board asks which
     playable counter is *closest* (see ludo4HitTest), which is what lets the
     catchment be opened past the size of the piece without neighbours stealing
     each other's presses. Counters keep their keyboard handling; this is the
     pointer half only. */
  const pressRef = useRef<{ id: number; x: number; y: number } | null>(null);

  const handleBoardPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    pressRef.current = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  };

  const handleBoardPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    // Only a press that began on the board counts, and only if it stayed put.
    // Without this, releasing a window drag over the board would move a piece,
    // and so would a stray swipe across it.
    if (!press || press.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) return;
    if (!validMoves.size) return;
    const idx = pickNearestToken(e.currentTarget, e.clientX, e.clientY);
    if (idx !== null && validMoves.has(idx)) onTokenClick(idx);
  };

  return (
    <div className={styles.boardStage}>
      <div
        className={styles.board}
        onPointerDown={handleBoardPointerDown}
        onPointerUp={handleBoardPointerUp}
        // The press may leave the board before it is released; that is a
        // cancelled press, not a move somewhere else.
        onPointerLeave={() => { pressRef.current = null; }}
      >
        {/* The disc: one flat circle. Everything else is drawn on it. */}
        <div className={styles.disc} />

        <div
          className={styles.boardPlate}
          style={{ transform: `rotate(${spin}deg)`, transformOrigin: '50% 50%' }}
        >
          {/* Track tiles */}
          {TRACK_INDICES.map(t => {
            const spec = trackCellSpec(t);
            const startColor = START_CELL_COLOR[t];
            const entryColor = ENTRY_CELL_COLOR[t];
            const isTarget = moveTargets.has(`track-${t}`);
            return (
              <div
                key={`cell-${t}`}
                className={[
                  styles.cell,
                  SAFE_ZONES.has(t) && !startColor ? styles.cellSafe : '',
                  isTarget ? styles.cellTarget : '',
                ].filter(Boolean).join(' ')}
                title={trackCellTitle(t)}
                style={{
                  ...box(spec.x, spec.y, CELL_PCT, CELL_PCT, spec.rot),
                  ...(startColor ? { background: COLOR_HEX[startColor] } : {}),
                  ...(isTarget && myColor ? { ['--target' as string]: COLOR_HEX[myColor] } : {}),
                } as CSSProperties}
              >
                {/* Every haven carries the same star, start cells included —
                    the colour says whose it is, the star says it is safe. */}
                {SAFE_ZONES.has(t) && (
                  <svg
                    viewBox="0 0 24 24"
                    className={`${styles.safeStar} ${startColor ? styles.safeStarOnColor : ''}`}
                    style={{ transform: `rotate(${-(spec.rot + spin)}deg)` }}
                    aria-hidden="true"
                  >
                    <path d={STAR_PATH} />
                  </svg>
                )}
                {/* The turn for home, marked the way v1 marks it: a small arrow
                    in the owner's colour, pointing in at the corridor. */}
                {entryColor && (
                  <svg viewBox="0 0 12 12" className={styles.entryArrow} aria-hidden="true">
                    <path
                      d="M6 2.6L6 9.4M6 2.6L3.4 5.4M6 2.6L8.6 5.4"
                      stroke={COLOR_HEX[entryColor]}
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

          {/* The run home: five cells of solid seat colour stepping inward —
              the classic board's corridor, turned to stand on its arm. One cell
              per counter is no longer required (counters may share), but five
              cells keeps the corridor the depth the rules talk about. */}
          {PLAYER_COLORS.map(color =>
            FINAL_CELLS.map(f => {
              const spec = finalCellSpec(color, f);
              const inactive = !activeColors.includes(color);
              // A run-home cell is only ever a target for its own owner, and
              // `final-n` carries no colour — so the spoke has to match too.
              const isTarget = color === myColor && moveTargets.has(`final-${f}`);
              return (
                <div
                  key={`final-${color}-${f}`}
                  className={[
                    styles.spokeCell,
                    inactive ? styles.cellInactive : '',
                    isTarget ? styles.cellTarget : '',
                  ].filter(Boolean).join(' ')}
                  title={`${SEAT_LABEL[color]}'s run home — walk in, any depth; an overshoot stops on the last cell`}
                  style={{
                    ...box(spec.x, spec.y, SPOKE_CELL, SPOKE_CELL, spec.rot),
                    backgroundColor: COLOR_HEX[color],
                    ...(isTarget ? { ['--target' as string]: '#ffffff' } : {}),
                  } as CSSProperties}
                >
                  {f === 1 && (
                    <svg viewBox="0 0 12 12" className={styles.spokeArrow} aria-hidden="true">
                      <path
                        d="M6 3.4L6 8.8M6 3.4L3.7 5.8M6 3.4L8.3 5.8"
                        strokeWidth="1.3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                      />
                    </svg>
                  )}
                </div>
              );
            })
          )}

          {/* The hub: a flat ring where the die rests. */}
          <div className={styles.homeDisc} style={box(50, 50, HUB.r * 2)} />

          {/* Yards — five round sockets on the apron, clear of the track,
              ringed in the owner's colour like v1's base sockets. */}
          {PLAYER_COLORS.map(color => {
            const inactive = !activeColors.includes(color);
            return BASE_SPEC[color].map((spec, i) => (
              <div
                key={`bay-${color}-${i}`}
                className={`${styles.baseBay} ${inactive ? styles.cellInactive : ''}`}
                style={{
                  ...box(spec.x, spec.y, BASE_BAY_PCT, BASE_BAY_PCT, spec.rot),
                  ['--rim' as string]: COLOR_HEX[color],
                } as CSSProperties}
              />
            ));
          })}

          {/* Capture ghosts */}
          {capturedGhosts.map(ghost => (
            <div
              key={`ghost-${ghost.index}-${ghost.coords[0]}`}
              className={styles.tokenSlot}
              style={{ ...box(ghost.coords[0], ghost.coords[1], TOKEN_PCT), transform: upright }}
            >
              <div
                className={`${styles.token} ${TOKEN_STYLE[ghost.color]} ${styles.tokenCaptured}`}
              />
            </div>
          ))}

          {/* Pieces. The slot carries the position and the counter-spin; the
              piece inside carries the hops, so the two never fight over
              `transform`. */}
          {TOKEN_INDICES.map(i => {
            const color = getTokenColor(i);
            if (!activeColors.includes(color)) return null;
            const anim = animPos.get(i);
            const coords = anim ?? getTokenCoords(tokens[i], i);
            if (!coords) return null;
            const [ox, oy] = anim ? [0, 0] : getTokenOffset(tokens, i);
            const clickable = validMoves.has(i) && !anim;
            const parity = animParity.get(i);
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
                className={styles.tokenSlot}
                // Read back by the plate's hit test to find this counter's
                // centre on screen, whatever the plate is doing to it.
                data-token={clickable ? i : undefined}
                style={{ ...box(coords[0] + ox, coords[1] + oy, TOKEN_PCT), transform: upright }}
              >
                <div
                  className={classes}
                  // No onClick: presses are resolved by the plate, which can
                  // pick the *nearest* counter instead of whichever box the
                  // pointer happened to be inside. See pickNearestToken.
                  // Keyboard players tab to a playable piece and press Enter.
                  onKeyDown={clickable ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onTokenClick(i);
                    }
                  } : undefined}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  title={clickable ? `Move to ${describePosition(validMoves.get(i)!)}` : undefined}
                  aria-label={
                    clickable
                      ? `Move ${SEAT_LABEL[color]} piece ${(i % TOKENS_PER_PLAYER) + 1} to ${describePosition(validMoves.get(i)!)}`
                      : `${SEAT_LABEL[color]} piece ${(i % TOKENS_PER_PLAYER) + 1} in ${describePosition(tokens[i])}`
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
