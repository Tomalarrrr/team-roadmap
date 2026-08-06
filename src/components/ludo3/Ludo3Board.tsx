// Presentational circular board for Ludo3. All positioning comes from
// ludo3Geometry; this component draws the flat disc, the 42-cell ring, the
// three run-home spokes, the yard sockets and the pieces. Movement is driven by
// the parent via animPos/animParity overrides (the same imperative stepper as
// Ludo v1 and Ludo4).
//
// Deliberately 2D, exactly as Ludo4 is: the layout is the ring and the look is
// Ludo v1's — flat white cells with hairline borders, solid-colour start cells
// and corridors, glossy counters that glow when they can move. No lighting
// model, no perspective. The life is
// in the moments instead: a rim tick that sweeps to whoever's turn it is, a
// path preview under a hovered counter, a ripple where a counter lands, and a
// cascade up the winner's corridor.

import { useState, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
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
  type Ludo3Color,
} from '../../ludo3Board';
import {
  ARM_ANGLE,
  CELL_PCT,
  TOKEN_PCT,
  SPOKE_CELL,
  BASE_BAY_PCT,
  BASE_SPEC,
  HUB,
  RIM_OUTLINE_PATH,
  RIM_CLIP_PATH,
  trackCellSpec,
  finalCellSpec,
  computeMovePath,
  getTokenCoords,
  getTokenOffset,
} from './ludo3Geometry';
import { pickNearestToken } from './ludo3HitTest';
import styles from './Ludo3Game.module.css';

// --- Palette ---------------------------------------------------------------
// Three of Ludo v1's four seats, verbatim, so every Ludo board reads as the
// same family. Yellow is the one left out: on a white cell it is the weakest of
// the four, and with a seat to spare there is no reason to use it.
const COLOR_HEX: Record<Ludo3Color, string> = {
  red: '#ea4330', green: '#34a853', blue: '#4285f4',
};

const TOKEN_STYLE: Record<Ludo3Color, string> = {
  red: styles.tokenRed,
  green: styles.tokenGreen,
  blue: styles.tokenBlue,
};

/** Five-point star, outer r10 / inner r4.2 on a 24×24 box. */
const STAR_PATH =
  'M12 2L14.47 8.6L21.51 8.91L15.99 13.3L17.88 20.09L12 16.2L6.12 20.09L8.01 13.3L2.49 8.91L9.53 8.6Z';

/** The rim tick: a short arc at the board's edge, drawn at bearing 0 (the
 * bottom) and rotated to the active seat's arm. Points are polar for bearing
 * ±5° at r 48.8 — outside the yard arc (bays end at ~48.1) but inside the
 * rim's swell there (~49.5), so the tick rides the last sliver of apron
 * without grazing either the sockets or the sculpted edge. */
const RIM_TICK_PATH = 'M 54.25 98.61 A 48.8 48.8 0 0 1 45.75 98.61';

const TRACK_INDICES = Array.from({ length: TRACK_SIZE }, (_, i) => i + 1);
const TOKEN_INDICES = Array.from({ length: TOTAL_TOKENS }, (_, i) => i);
const FINAL_CELLS = Array.from({ length: FINAL_SIZE }, (_, i) => i + 1);

const START_CELL_COLOR: Record<number, Ludo3Color> = {};
const ENTRY_CELL_COLOR: Record<number, Ludo3Color> = {};
for (const c of PLAYER_COLORS) {
  START_CELL_COLOR[START_POSITIONS[c]] = c;
  ENTRY_CELL_COLOR[ENTRY_CELLS[c]] = c;
}

const SEAT_LABEL: Record<Ludo3Color, string> = {
  red: 'Red', green: 'Green', blue: 'Blue',
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

/** A landing ripple, spawned by the parent when a counter arrives on a cell. */
export interface Ripple {
  id: number;
  coords: [number, number];
  color: Ludo3Color;
}

interface Ludo3BoardProps {
  tokens: TokenPosition[];
  playerCount: number;
  myColor: Ludo3Color | null;
  /** Whose turn it is — drives the rim tick. Null hides it (e.g. game over). */
  activeColor: Ludo3Color | null;
  /** The winner, once there is one — runs the cascade up their corridor. */
  winner: Ludo3Color | null;
  validMoves: Map<number, TokenPosition>;
  lastMovedToken: number | null;
  animPos: Map<number, [number, number]>;
  animParity: Map<number, number>;
  ripples: Ripple[];
  onTokenClick: (tokenIndex: number) => void;
}

export function Ludo3Board({
  tokens,
  playerCount,
  myColor,
  activeColor,
  winner,
  validMoves,
  lastMovedToken,
  animPos,
  animParity,
  ripples,
  onTokenClick,
}: Ludo3BoardProps) {
  const activeColors = PLAYER_COLORS.slice(0, playerCount);

  // Turn the board face so the local player's arm points straight down — your
  // yard and corridor sit centre-bottom, the way you would sit at the table.
  // The layout is three-fold symmetric about the centre, so ±120° turns map it
  // exactly onto itself — only the colours move. (The status line this leaves
  // nowhere to go above the hub lives *in* the hub instead — see Ludo3Game.)
  const spin = -(myColor ? ARM_ANGLE[myColor] : 0);
  // Anything that is read rather than pointed — the pieces, the safe stars —
  // has to be turned back, or a spun board hands the player a set of counters
  // lying on their sides.
  const upright = `rotate(${-spin}deg)`;

  /* The rim tick sweeps to the seat whose turn it is — and only ever forwards.
   *
   * Rotations are interpolated as numbers, so handing the turn from the last
   * arm back to the first (240° → 0°, or 270° → 0° on the four-seat board) ran
   * the tick all the way back round the board against the direction of play. It
   * is the one element on the board whose whole job is to say "the turn has
   * moved on", so it going backwards said the opposite.
   *
   * Kept as a running total instead: each handover adds the *forward* distance
   * to the seat taking over, so 240 → 0 is a step of 120 to 360, not a sweep of
   * −240. The number grows without bound, which costs nothing — a rotation of
   * 3600° is the same picture as one of 0°. Held in state and adjusted during
   * render on the seat actually changing (the same shape as any other
   * derived-from-props state), so a re-render never advances it. */
  const [tick, setTick] = useState<{ seat: Ludo3Color | null; angle: number }>(() => ({
    seat: activeColor,
    angle: activeColor ? ARM_ANGLE[activeColor] : 0,
  }));
  if (activeColor && activeColor !== tick.seat) {
    setTick(prev => ({
      seat: activeColor,
      angle: prev.seat === null
        ? ARM_ANGLE[activeColor]
        : prev.angle + ((ARM_ANGLE[activeColor] - ARM_ANGLE[prev.seat] + 360) % 360),
    }));
  }

  // Where the offered moves land. "Which of my counters can move" is only half
  // the question — the other half is where it would end up.
  const moveTargets = new Set<TokenPosition>(validMoves.values());

  // Path preview: while a playable counter is hovered, the cells it would walk
  // are dotted in its colour. The destination cell already carries the target
  // ring, so the dots stop one short of it.
  const [hoverToken, setHoverToken] = useState<number | null>(null);
  const hoverTarget = hoverToken !== null ? validMoves.get(hoverToken) : undefined;
  const hoverPath: [number, number][] =
    hoverToken !== null && hoverTarget !== undefined && !animPos.has(hoverToken)
      ? computeMovePath(tokens[hoverToken], hoverTarget, getTokenColor(hoverToken)).slice(0, -1)
      : [];
  const hoverColor = hoverToken !== null ? COLOR_HEX[getTokenColor(hoverToken)] : undefined;

  /* Presses land on the board, not on the counters: the board asks which
     playable counter is *closest* (see ludo3HitTest), which is what lets the
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
        {/* The disc: one flat plate whose silhouette dips in between the arms
            and swells out around each yard — the shape itself houses the
            counters. Three-fold symmetric, so it never has to turn with the
            plate; a hairline traces the sculpted edge. */}
        <svg className={styles.disc} viewBox="0 0 100 100" aria-hidden="true">
          <path d={RIM_OUTLINE_PATH} />
        </svg>

        {/* The ground the track sits in. A full annulus, so it never needs to
            turn with the plate. See TRACK_BAND for the radii the mask encodes. */}
        <div className={styles.trackBand} aria-hidden="true" />

        <div
          className={styles.boardPlate}
          style={{ transform: `rotate(${spin}deg)`, transformOrigin: '50% 50%' }}
        >
          {/* Territory: each seat's third of the apron washed in its own
              colour, a few percent strong — v1's colour blocks, bent
              around the ring. Inside the plate so the wash turns with the
              seats. Masked to the apron: a wash across the whole quadrant
              would tint the corridors and the open middle, which are already
              doing their own talking. */}
          <div
            className={styles.apronWash}
            style={{ clipPath: RIM_CLIP_PATH }}
            aria-hidden="true"
          />

          {/* Whose turn it is, said on the board itself: a short arc at the rim
              of the active seat's arm, sweeping round when the turn passes. */}
          {activeColor && activeColors.includes(activeColor) && (
            <svg
              className={styles.rimTick}
              viewBox="0 0 100 100"
              style={{ transform: `rotate(${tick.angle}deg)` }}
              aria-hidden="true"
            >
              <path d={RIM_TICK_PATH} stroke={COLOR_HEX[activeColor]} />
            </svg>
          )}

          {/* Track tiles. The turn for home is marked once, on the run-home
              cell it leads into — the track cell in front of it used to carry a
              second arrow of its own, which said the same thing twice, a cell
              apart, in two different weights. The cell still names itself on
              hover (see trackCellTitle). */}
          {TRACK_INDICES.map(t => {
            const spec = trackCellSpec(t);
            const startColor = START_CELL_COLOR[t];
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
                  ...(isTarget && activeColor ? { ['--target' as string]: COLOR_HEX[activeColor] } : {}),
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
              </div>
            );
          })}

          {/* The run home: five cells of solid seat colour stepping inward —
              the classic board's corridor, turned to stand on its arm. One cell
              per counter, landed on exactly: every one of them has to end up
              with a counter standing in it. When somebody wins, their corridor
              lights up cell by cell from the entry to the centre. */}
          {PLAYER_COLORS.map(color =>
            FINAL_CELLS.map(f => {
              const spec = finalCellSpec(color, f);
              const inactive = !activeColors.includes(color);
              // A run-home cell is only ever a target for its own owner, and
              // `final-n` carries no colour — so the spoke has to match the
              // seat that is actually moving. Matching `myColor` instead put a
              // ring on *your* corridor whenever a bot was about to land in
              // its own, which read as your own board marking itself for no
              // reason (and it happened most in the endgame, where a counter
              // going home is exactly what you are watching for).
              const isTarget = color === activeColor && moveTargets.has(`final-${f}`);
              const isWinning = color === winner;
              return (
                <div
                  key={`final-${color}-${f}`}
                  className={[
                    styles.spokeCell,
                    inactive ? styles.cellInactive : '',
                    isTarget ? styles.cellTarget : '',
                    isWinning ? styles.spokeCellWin : '',
                  ].filter(Boolean).join(' ')}
                  title={`${SEAT_LABEL[color]}'s run home — land on an empty cell exactly, or wait out on the track`}
                  style={{
                    ...box(spec.x, spec.y, SPOKE_CELL, SPOKE_CELL, spec.rot),
                    backgroundColor: COLOR_HEX[color],
                    ...(isTarget ? { ['--target' as string]: '#ffffff' } : {}),
                    // Entry first, centre last: the cascade walks the way a
                    // counter does.
                    ...(isWinning ? { animationDelay: `${(f - 1) * 140}ms` } : {}),
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

          {/* The hub: a flat ring holding the die, the status line and the
              turn ring (all rendered by the parent, screen-anchored). */}
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

          {/* Hover path preview: the cells the hovered counter would walk. */}
          {hoverPath.map((p, k) => (
            <div
              key={`dot-${k}`}
              className={styles.pathDot}
              style={{
                ...box(p[0], p[1], 1.15),
                background: hoverColor,
                animationDelay: `${k * 18}ms`,
              }}
              aria-hidden="true"
            />
          ))}

          {/* Landing ripples — one soft expanding ring where a counter just
              arrived, in the mover's colour. */}
          {ripples.map(r => (
            <div
              key={`ripple-${r.id}`}
              className={styles.ripple}
              style={{
                ...box(r.coords[0], r.coords[1], CELL_PCT * 2.4),
                ['--ripple' as string]: COLOR_HEX[r.color],
              } as CSSProperties}
              aria-hidden="true"
            />
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
                  onPointerEnter={clickable ? () => setHoverToken(i) : undefined}
                  onPointerLeave={clickable ? () => setHoverToken(h => (h === i ? null : h)) : undefined}
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
