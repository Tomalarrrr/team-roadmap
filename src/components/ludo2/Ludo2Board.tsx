// Presentational circular board for Ludo2. All positioning comes from
// ludo2Geometry; this component draws the disc, its raised track band, the
// three base rings and spokes, and the pieces. Movement is driven by the parent
// via animPos/animParity overrides (the same imperative stepper as Ludo v1).

import type { CSSProperties } from 'react';
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
  type Ludo2Color,
} from '../../ludo2Board';
import {
  ARM_ANGLE,
  CELL_PCT,
  TOKEN_PCT,
  SPOKE_CELL,
  RING_OUTER,
  RING_INNER,
  BASE_BAY_PCT,
  BASE_SPEC,
  APERTURE,
  BRIDGE_RECT,
  BRIDGE_W,
  BRIDGE_LEN,
  HUB,
  trackCellSpec,
  finalCellSpec,
  getTokenCoords,
  getTokenOffset,
} from './ludo2Geometry';
import styles from './Ludo2Game.module.css';

// --- Palette ---------------------------------------------------------------
// Taken from the reference board: muted brick, forest and steel on warm ivory,
// with an aged-brass line. The third seat is keyed 'yellow' throughout the code
// and the database; only its appearance and label are blue, so games already
// stored under that key keep working.
const COLOR_HEX: Record<Ludo2Color, string> = {
  red: '#b23a2f', green: '#417a4a', yellow: '#2f5f8f',
};
/** Lit crown of a moulded piece. */
const COLOR_LIT: Record<Ludo2Color, string> = {
  red: '#d05a4a', green: '#579960', yellow: '#4179ad',
};
/** Shaded foot. */
const COLOR_DARK: Record<Ludo2Color, string> = {
  red: '#7e2419', green: '#28522e', yellow: '#1b3c5e',
};
/** Wash for yard bays, start cells and entry cells. */
const COLOR_WASH: Record<Ludo2Color, string> = {
  red: '#ecd3cd', green: '#d6e4d7', yellow: '#d2dceb',
};
/** The run home, a shade deeper than the counters that stand on it. Drawn in
 * COLOR_HEX it was the exact colour of its own pieces, and a counter in its own
 * corridor showed up only by its gloss. */
const COLOR_LANE: Record<Ludo2Color, string> = {
  red: '#8e2c22', green: '#2f6238', yellow: '#22496f',
};

const TOKEN_STYLE: Record<Ludo2Color, string> = {
  red: styles.tokenRed, green: styles.tokenGreen, yellow: styles.tokenYellow,
};

/** Five-point star, outer r10 / inner r4.2 on a 24×24 box. */
const STAR_PATH =
  'M12 2L14.47 8.6L21.51 8.91L15.99 13.3L17.88 20.09L12 16.2L6.12 20.09L8.01 13.3L2.49 8.91L9.53 8.6Z';

const TRACK_INDICES = Array.from({ length: TRACK_SIZE }, (_, i) => i + 1);
const TOKEN_INDICES = Array.from({ length: TOTAL_TOKENS }, (_, i) => i);
const FINAL_CELLS = Array.from({ length: FINAL_SIZE }, (_, i) => i + 1);

const START_CELL_COLOR: Record<number, Ludo2Color> = {};
const ENTRY_CELL_COLOR: Record<number, Ludo2Color> = {};
for (const c of PLAYER_COLORS) {
  START_CELL_COLOR[START_POSITIONS[c]] = c;
  ENTRY_CELL_COLOR[ENTRY_CELLS[c]] = c;
}

const SEAT_LABEL: Record<Ludo2Color, string> = {
  red: 'Red', green: 'Green', yellow: 'Blue',
};

/** What a cell is, for anyone who hovers it. Only the cells that carry a rule
 * get one — a tooltip on all forty-two would be noise, and the three marks that
 * actually mean something (start, haven, way home) are exactly the three a new
 * player has no way to read off the board. */
function trackCellTitle(t: number): string | undefined {
  const start = START_CELL_COLOR[t];
  if (start) return `${SEAT_LABEL[start]} starts here — safe from capture`;
  const entry = ENTRY_CELL_COLOR[t];
  if (entry) return `${SEAT_LABEL[entry]} turns for home here`;
  if (SAFE_ZONES.has(t)) return 'Safe — no capture on this space';
  return undefined;
}

/** Punches the centre hole through a centred circular layer. Each layer is a
 * different size, so the hole has to be expressed as a fraction of that layer's
 * own radius rather than of the board. */
function aperture(layerRadiusPct: number): CSSProperties {
  const stop = `${(APERTURE / layerRadiusPct) * 100}%`;
  const cut = `radial-gradient(closest-side, transparent 0 ${stop}, #000 ${stop})`;
  return { maskImage: cut, WebkitMaskImage: cut } as CSSProperties;
}

/** One lamp, up and to the left, for the whole board.
 *
 * Every cell on this board is turned to stand radially, and the plate turns
 * again to face the local player. A bevel written in a cell's own frame
 * therefore points somewhere different in each cell, and the lamp appears to
 * orbit the board — the single thing that gives away a ring of tiles as drawn
 * rather than lit. So the key direction is stated once, in screen space, and
 * rotated *back* into each cell's frame here.
 *
 * Rotating a local vector v by θ puts it on screen at R(θ)·v, so to land on a
 * given screen vector s the cell needs v = R(−θ)·s.
 *
 * The lamp is one unit vector — CAST, pointing away from it in screen space, so
 * it is also where every shadow on this board falls. The lit lip and the shaded
 * lip are that same vector at two depths, which is what keeps a bevel, a cast
 * shadow and an extruded wall all agreeing on where the light is. The stylesheet
 * names the untuned pair as --cast-x/--cast-y.
 */
const CAST = { x: 0.541, y: 0.841 };
/** Depth of the lit lip and of the shaded one, in cqw, along CAST. */
const LIP = { hilite: 0.18, shade: 0.333 };

/**
 * The light in one element's own frame.
 *
 * `--cast-x`/`--cast-y` come back unitless, because they are a direction that
 * gets multiplied by a length at the point of use; `--hx`…`--sy` come back as
 * lengths, because they are one fixed lip depth. Both are rotated by the same
 * −θ, so an element that mixes them cannot end up lit two ways.
 */
function keyLight(rotDeg: number, scale = 1): CSSProperties {
  const t = (rotDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const cx = CAST.x * c + CAST.y * s;
  const cy = -CAST.x * s + CAST.y * c;
  const lip = (depth: number, sign: number): [string, string] => [
    `${(cx * depth * sign * scale).toFixed(3)}cqw`,
    `${(cy * depth * sign * scale).toFixed(3)}cqw`,
  ];
  const [hx, hy] = lip(LIP.hilite, -1);
  const [sx, sy] = lip(LIP.shade, 1);
  return {
    '--cast-x': cx.toFixed(4),
    '--cast-y': cy.toFixed(4),
    '--hx': hx, '--hy': hy, '--sx': sx, '--sy': sy,
  } as CSSProperties;
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

  // Turn the board face so the local player's yard is nearest them. The layout
  // is three-fold symmetric about the centre, so a ±120° turn maps it exactly
  // onto itself — only the colours move. The disc underneath is fixed.
  const spin = -(myColor ? ARM_ANGLE[myColor] : 0);
  // Anything that is read rather than pointed — the pieces, the safe stars, the
  // home mark — has to be turned back, or a spun board hands the player a set
  // of counters lying on their sides.
  const upright = `rotate(${-spin}deg)`;

  // Where the offered moves land. Under the exact-landing rule "which of my
  // counters can move" is only half the question — the other half is where it
  // would end up, and that was previously nowhere on the board.
  const moveTargets = new Set<TokenPosition>(validMoves.values());

  return (
    <div className={styles.boardStage}>
      <div className={styles.board}>
        {/* The disc: a moulded puck with a visible side wall, bored through the
            middle. The wall sits a touch lower than the face, so inside the bore
            it shows up as the far inner wall — which is the only part of a hole
            you actually see from above and in front. */}
        <div className={styles.discEdge} style={aperture(50)} />
        <div className={styles.disc} style={aperture(50)} />

        <div
          className={styles.boardPlate}
          style={{ transform: `rotate(${spin}deg)`, transformOrigin: '50% 50%' }}
        >
          {/* The three bridges, spanning the bore. Drawn *first*, so the ring
              band and the hub island paint over their ends: each deck then
              emerges from under an arc instead of laying a straight cut across
              one, which is what a bridge meeting an abutment actually does. */}
          {PLAYER_COLORS.map(color => {
            const b = BRIDGE_RECT[color];
            const inactive = !activeColors.includes(color);
            return (
              <div
                key={`bridge-${color}`}
                className={`${styles.bridge} ${inactive ? styles.cellInactive : ''}`}
                style={{
                  ...box(b.x, b.y, BRIDGE_W, BRIDGE_LEN, b.rot),
                  // A deck over a hole has to show its own thickness — there is
                  // no floor under it for a cast shadow to land on.
                  ...keyLight(b.rot + spin, 4.6),
                }}
              />
            );
          })}

          {/* Raised band the track sits in, then one finish over the whole face.
              The band is a centred circle, so it does not care that the plate
              is turned — but its shading does, and keyLight(spin) is what turns
              the lamp back out of the plate's frame for it. */}
          <div
            className={styles.ringBand}
            style={{
              ...box(50, 50, RING_OUTER * 2),
              ...aperture(RING_OUTER),
              ...keyLight(spin),
            }}
          />
          <div className={styles.boardFinish} style={aperture(50)} />

          {/* The bore's lip, over the bridge ends */}
          <div
            className={styles.ringWell}
            style={{ ...box(50, 50, RING_INNER * 2), ...keyLight(spin) }}
          />

          {/* Track tiles */}
          {TRACK_INDICES.map(t => {
            const spec = trackCellSpec(t);
            // One shaded cell per colour, and it is the one counters come out
            // on. The turn for home needs no wash of its own: the bridge deck
            // lands square on it, which says it better than a second pink
            // square two cells round from the first ever did.
            const startColor = START_CELL_COLOR[t];
            const isTarget = moveTargets.has(`track-${t}`);
            return (
              <div
                key={`cell-${t}`}
                className={[
                  styles.cell,
                  isTarget ? styles.cellTarget : '',
                ].filter(Boolean).join(' ')}
                title={trackCellTitle(t)}
                style={{
                  ...box(spec.x, spec.y, CELL_PCT, CELL_PCT, spec.rot),
                  ...keyLight(spec.rot + spin),
                  ...(startColor ? { background: COLOR_WASH[startColor] } : {}),
                  ...(isTarget && myColor ? { ['--target' as string]: COLOR_HEX[myColor] } : {}),
                } as CSSProperties}
              >
                {/* Every haven carries the same star, start cells included —
                    the wash says whose it is, the star says it is safe. */}
                {SAFE_ZONES.has(t) && (
                  <svg
                    viewBox="0 0 24 24"
                    className={styles.safeStar}
                    style={{
                      transform: `rotate(${-(spec.rot + spin)}deg)`,
                      // Turned all the way back to screen-upright, so it needs
                      // the lamp in screen space too — not the cell's copy of
                      // it, which is turned the other way.
                      ...keyLight(0),
                    }}
                    aria-hidden="true"
                  >
                    <path d={STAR_PATH} />
                  </svg>
                )}
              </div>
            );
          })}

          {/* The run home. Same square cell as the ring, stepping inward — one
              cell per counter, because every one of them has to end up with a
              counter standing in it. */}
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
                  title={`${SEAT_LABEL[color]}'s run home — land on an empty cell exactly`}
                  style={{
                    ...box(spec.x, spec.y, SPOKE_CELL, SPOKE_CELL, spec.rot),
                    ...keyLight(spec.rot + spin),
                    backgroundColor: COLOR_LANE[color],
                    ...(isTarget ? { ['--target' as string]: '#fffdf7' } : {}),
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

          {/* Centre home: an island the three bridges land on. Its own side
              wall, same trick as the disc's — a touch lower and darker. */}
          <div
            className={styles.homeEdge}
            style={{ ...box(50, 50, HUB.r * 2), ...keyLight(spin) }}
          />
          <div
            className={styles.homeDisc}
            style={{ ...box(50, 50, HUB.r * 2), ...keyLight(spin) }}
          >
            <svg
              viewBox="0 0 24 24"
              className={styles.homeStar}
              style={{ transform: upright }}
              aria-hidden="true"
            >
              <path d={STAR_PATH} />
            </svg>
          </div>

          {/* Yards — four bays on the apron, clear of the track. Same arc
              segment as a track tile so they read as part of the same board,
              but washed and rimmed in the owner's colour rather than white. */}
          {PLAYER_COLORS.map(color => {
            const inactive = !activeColors.includes(color);
            return BASE_SPEC[color].map((spec, i) => (
              <div
                key={`bay-${color}-${i}`}
                className={`${styles.baseBay} ${inactive ? styles.cellInactive : ''}`}
                style={{
                  ...box(spec.x, spec.y, BASE_BAY_PCT, BASE_BAY_PCT, spec.rot),
                  ...keyLight(spec.rot + spin),
                  // backgroundColor, not the shorthand: the shorthand would
                  // wipe the dimple gradient the stylesheet puts underneath.
                  backgroundColor: COLOR_WASH[color],
                  ['--rim' as string]: COLOR_HEX[color],
                } as CSSProperties}
              />
            ));
          })}

          {/* Capture ghosts */}
          {capturedGhosts.map(ghost => (
            <div
              key={`ghost-${ghost.index}-${ghost.coords[0]}`}
              className={`${styles.tokenSlot} ${styles.tokenSlotCaptured}`}
              style={{ ...box(ghost.coords[0], ghost.coords[1], TOKEN_PCT), transform: upright }}
            >
              <div
                className={`${styles.token} ${TOKEN_STYLE[ghost.color]} ${styles.tokenCaptured}`}
                style={{
                  ['--lit' as string]: COLOR_LIT[ghost.color],
                  ['--body' as string]: COLOR_HEX[ghost.color],
                  ['--foot' as string]: COLOR_DARK[ghost.color],
                } as CSSProperties}
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
            const stepping = parity === 0 || parity === 1;
            const size = TOKEN_PCT;
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
                // The counter's shadow hangs off the slot, not off the counter,
                // so that it stays on the board while the piece hops above it —
                // which means the slot is what has to know the piece is lifting.
                className={[
                  styles.tokenSlot,
                  stepping ? styles.tokenSlotStepping : '',
                  clickable ? styles.tokenSlotLifted : '',
                ].filter(Boolean).join(' ')}
                style={{ ...box(coords[0] + ox, coords[1] + oy, size), transform: upright }}
              >
                <div
                  className={classes}
                  style={{
                    ['--lit' as string]: COLOR_LIT[color],
                    ['--body' as string]: COLOR_HEX[color],
                    ['--foot' as string]: COLOR_DARK[color],
                  } as CSSProperties}
                  onClick={clickable ? () => onTokenClick(i) : undefined}
                  // A counter carried role="button" but no way to reach it: the
                  // die could be rolled from the keyboard and then nothing could
                  // be moved with one. Tab to a playable piece, Enter to play it.
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
