/* eslint-disable react-refresh/only-export-components */
// Local dev preview harness for the Ludo3 board (scratch, not shipped).
// Mirrors the shipped playing layout in Ludo3Game.tsx exactly — same classes in
// the same order — so the visuals can be inspected without a live game.
// Open /ludo3-preview.html under `npm run dev`.
//
// Query params:
//   me=red|green|blue         which seat is the local player (drives the spin)
//   players=2|3               active seat count
//   active=0|1|2              which seat's turn it is (rim tick + card accent)
//   status=turn|hint|long     what the centre line says
//   time=0..30                seconds left, drives the ring clock around the die
//   names=long|short          name length, for truncation checks
//   winner=red|...            run the corridor cascade for that seat
//   w=&h=                     popup size override, for resize checks
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Ludo3Board } from './components/ludo3/Ludo3Board';
import styles from './components/ludo3/Ludo3Game.module.css';
import {
  PLAYER_COLORS,
  TOKENS_PER_PLAYER,
  FINAL_SIZE,
  MAX_PLAYER_SCORE,
  type Ludo3Color,
} from './ludo3Board';
import { ARM_ANGLE } from './components/ludo3/ludo3Geometry';
import type { TokenPosition } from './ludoFirebase';

const q = new URLSearchParams(location.search);
const me = (q.get('me') ?? 'red') as Ludo3Color;
const playerCount = Number(q.get('players') ?? 3);
const activeIdx = Number(q.get('active') ?? 2);
const status = q.get('status') ?? 'hint';
const timeLeft = Number(q.get('time') ?? 22);
const longNames = q.get('names') !== 'short';
const winner = (q.get('winner') as Ludo3Color | null) ?? null;

const TURN_SECONDS = 30;
// Kept in step with Ludo3Game's ring clock.
const TIMER_RING_R = 11.2;
const TIMER_RING_C = 2 * Math.PI * TIMER_RING_R;

// Built off TOKENS_PER_PLAYER rather than written out, so the harness keeps
// working when the number of counters per player changes.
const LAYOUT: TokenPosition[][] = [
  ['base', 'base', 'track-1', 'track-10', 'track-5'],
  ['base', 'track-15', 'track-24', 'final-3', 'track-19'],
  ['base', 'base', 'track-38', `final-${FINAL_SIZE}` as TokenPosition, 'track-33'],
];
const tokens: TokenPosition[] = PLAYER_COLORS.flatMap((_, ci) =>
  Array.from({ length: TOKENS_PER_PLAYER }, (_, i) => LAYOUT[ci][i] ?? 'base')
);

// One deploy and one run-home landing, so both flavours of destination mark
// are on screen: a track cell ringed in the mover's colour, and a run-home cell
// ringed in white against the solid corridor.
const validMoves = new Map<number, TokenPosition>([
  [0, 'track-1'],
  [3, 'final-2'],
]);

const COLOR_HEX: Record<Ludo3Color, string> = {
  red: '#ea4330', green: '#34a853', blue: '#4285f4',
};
const COLOR_RGB: Record<Ludo3Color, string> = {
  red: '234, 67, 48', green: '52, 168, 83', blue: '66, 133, 244',
};
const NAMES_LONG: Record<Ludo3Color, string> = {
  red: 'Bartholomew Vandenberg', green: 'Bot Green', blue: 'Bot Blue',
};
const NAMES_SHORT: Record<Ludo3Color, string> = {
  red: 'Tom', green: 'Ana', blue: 'Kim',
};
const SCORE: Record<Ludo3Color, number> = { red: 12, green: 55, blue: 57 };
const ROLLS: Record<Ludo3Color, number[]> = {
  red: [0, 0, 1, 0, 0, 0],
  green: [0, 0, 0, 0, 0, 0],
  blue: [0, 0, 12, 0, 3, 0],
};
const CAPS: Record<Ludo3Color, number> = { red: 1, green: 0, blue: 2 };

// Same rule as the shipped component's seatCorner().
function seatCorner(color: Ludo3Color) {
  const bearing = (ARM_ANGLE[color] - ARM_ANGLE[me] + 360) % 360;
  return bearing === 0 ? styles.cornerBl
    : bearing === 120 ? styles.cornerTl
    : styles.cornerTr;
}

const STATUS_TEXT: Record<string, string> = {
  turn: 'Bot Blue’s turn',
  hint: 'Rolled 6! Bonus turn',
  long: 'Need exact roll to finish — no valid moves this turn',
};

function Preview() {
  const active = PLAYER_COLORS[activeIdx];
  return (
    <div
      className={styles.popup}
      style={{
        left: 40,
        top: 40,
        ...(q.get('w') ? { width: `${q.get('w')}px` } : {}),
        ...(q.get('h') ? { height: `${q.get('h')}px` } : {}),
      }}
    >
      <div className={styles.titleBar}>
        <span className={styles.titleText}>
          Ludo 3<span className={styles.titleCode}>LN84</span>
        </span>
        <span className={styles.titleButtons}>
          <button className={styles.closeBtn} aria-label="close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      </div>
      <div className={styles.gameArea}>
        <div className={styles.playingLayout}>
          <div className={styles.boardWrapper}>
            <Ludo3Board
              tokens={tokens}
              playerCount={playerCount}
              myColor={me}
              activeColor={winner ? null : PLAYER_COLORS[activeIdx]}
              winner={winner}
              validMoves={validMoves}
              lastMovedToken={null}
              animPos={new Map()}
              animParity={new Map()}
              ripples={[]}
              // Recorded rather than dropped, so the board's press resolution
              // can actually be checked in a browser: press near a counter and
              // read which one answered.
              onTokenClick={(i) => {
                (window as unknown as { lastTokenClick?: number }).lastTokenClick = i;
                console.log('[preview] token pressed:', i);
              }}
            />

            {PLAYER_COLORS.slice(0, playerCount).map(color => {
              const names = longNames ? NAMES_LONG : NAMES_SHORT;
              return (
                <div
                  key={color}
                  className={[
                    styles.seatCard,
                    seatCorner(color),
                    color === active ? styles.seatCardActive : '',
                  ].filter(Boolean).join(' ')}
                  style={{
                    '--seat-rgb': COLOR_RGB[color],
                    '--fill': `${(SCORE[color] / MAX_PLAYER_SCORE) * 100}%`,
                  } as React.CSSProperties}
                >
                  <div className={styles.seatLine}>
                    <span className={styles.playerDot} style={{ background: COLOR_HEX[color] }} />
                    <span className={styles.seatName} title={names[color]}>
                      {color === me ? 'You' : names[color]}
                    </span>
                    <span className={styles.seatScore}>
                      <span className={styles.seatScoreTick}>{SCORE[color]}</span>
                    </span>
                  </div>
                  <div className={styles.seatMeter}><span className={styles.seatMeterFill} /></div>
                  <div className={styles.rollGrid}>
                    {[1, 2, 3, 4, 5, 6].map(n => (
                      <span key={`h${n}`} className={styles.rollHead}>{n}</span>
                    ))}
                    <span className={styles.rollHead}>C</span>
                    {ROLLS[color].map((v, k) => (
                      <span key={k} className={`${styles.rollVal} ${v ? '' : styles.statNil}`}>{v || '·'}</span>
                    ))}
                    <span className={`${styles.rollVal} ${CAPS[color] ? '' : styles.statNil}`}>
                      {CAPS[color] || '·'}
                    </span>
                  </div>
                </div>
              );
            })}

            <svg
              className={styles.timerRing}
              viewBox="0 0 100 100"
              style={{ '--turn': COLOR_HEX[active] } as React.CSSProperties}
              aria-hidden="true"
            >
              <circle className={styles.timerRingTrack} cx="50" cy="50" r={TIMER_RING_R} />
              <circle
                className={`${styles.timerRingFill} ${timeLeft <= 10 ? styles.timerRingUrgent : ''}`}
                cx="50"
                cy="50"
                r={TIMER_RING_R}
                strokeDasharray={TIMER_RING_C}
                strokeDashoffset={TIMER_RING_C * (1 - timeLeft / TURN_SECONDS)}
              />
            </svg>

            <div className={styles.centreStatus} title={`${timeLeft}s left on this turn`}>
              <span className={styles.centreStatusText}>{STATUS_TEXT[status] ?? STATUS_TEXT.hint}</span>
            </div>

            <button className={`${styles.dice} ${styles.centreDice} ${q.get('roll') ? styles.diceActive : ''}`}>
              <div className={styles.diceFace}>
                {[[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]].map(([r, c], i) => (
                  <span key={i} className={styles.pip} style={{ gridRow: r, gridColumn: c }} />
                ))}
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>
);
