import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createServerClock } from '../../api/snakeApi';
import {
  createRoom,
  followRoom,
  getRoom,
  hostOf,
  joinRoom,
  putSeat,
  recordResult,
  seatOf,
  setComputer,
  setKind,
  setNest,
  setRules,
  startMatch,
  vacateSeat,
  type SwarmRoom,
} from '../../api/swarmApi';
import {
  CLASSIC,
  COUNTDOWN_MS,
  DRAFT_TICKS,
  KINDS,
  KNOBS,
  MODE_IDS,
  SEATS,
  SIZE_IDS,
  STANDARD_TUNE,
  START_IDS,
  TICK_MS,
  WAVE_TICKS,
  WAVE_UNITS,
  advance,
  allied,
  buildMap,
  clampKnob,
  computerOf,
  MAP_IDS,
  BURN_COST,
  countAsSeen,
  countOf,
  drafting,
  encodeTune,
  kindsOf,
  lastTick,
  newState,
  rulesOf,
  sendSize,
  sidesOf,
  sizeOf,
  twistLetters,
  upgradeCost,
  type KnobId,
  type ModeId,
  type Nest,
  type OrderKind,
  type Power,
  type Seat,
  type MapId,
  type SizeId,
  type StartId,
  type Twist,
  type Tune,
  type SwarmMatch,
  type SwarmState,
} from '../../swarmGameLogic';
import { KIND_NAME } from './swarmFeel';
import { BADGE } from './swarmSceneKit';
import { modeNotes, modeStory, type ModeNote } from './swarmModes';
import { burnSpots } from './swarmSceneBuilt';
import { TOKEN_R, addEvents, drawScene, drawThumb, hutAt, newScene, pathPoint, tokenGrow, upgradeSpots, watchBoard, type Scene, type View } from './swarmRender';
import { carriedOf } from './swarmAim';
import { columnOf, holdingOf, startsOf, whereOf, type Start } from './swarmStarts';
import { latch, nearest, reachOf } from './swarmPick';
import { READY_MODES, READY_TWISTS, clashOf, leaveWarning, surpriseOf, tuneSummary, unfit, type RulesChoice } from './swarmLobby';
import { floodIn, pillsOf, type PowerPill } from './swarmPowerHud';
import { SwarmPowerPills } from './SwarmPowerPills';
import { newLockstep, orderTick, pace, restingReport, sending, settle, silent, sound, type Ear, type Lockstep, type SeatWrite } from './swarmSync';
import { siegeBeat, siegeOf, threatsOf, type ThreatView } from './swarmThreat';
import { clockOf, newTally, tallyStep, type Tally } from './swarmTally';
import { SwarmSummary } from './SwarmSummary';
import styles from './SwarmGame.module.css';

const SIZE_NAME: Record<SizeId, string> = { small: 'Small', medium: 'Medium', large: 'Large' };

/** What the lobby says of each map: its name, and the one thing that is different about it. */
const MAPS: Record<MapId, { name: string; about: string }> = {
  meadow: { name: 'Meadow', about: 'Open grass and plain roads. Nothing in the way but the other side.' },
  thorns: { name: 'Thorn Pass', about: 'A spiked short cut runs straight to the middle. One in four who take it die on the way.' },
  bridges: { name: 'Two Bridges', about: 'A river splits the map. Cross dry by a bridge, or wade the ford and lose one in four.' },
  guns: { name: 'Frozen Guns', about: 'Two lines of cannon guard the middle and fire on whoever marches at them.' },
  hill: { name: 'The Hill', about: 'A fort on high ground. The climb is slow and its defenders each take two to kill.' },
  crossroads: { name: 'Crossroads', about: 'Cannon on the busiest crossings and forts half way out. Roads round the edge are fast, tracks through the middle slow.' },
  warren: { name: 'The Warren', about: 'Four tunnels run under the map between huts far apart. Columns in a tunnel pass each other without a fight, and the other side sees yours only as it comes up.' },
};

/** The layout each map shows in the lobby. Any seed would do; one keeps the picture still between visits. */
const THUMB_SEED = 1;

/**
 * The seats a map picture is laid out for, as their letters. A room with one
 * person in it shows the map as two would play it, since a game needs two.
 */
function thumbSeats(sides: readonly Seat[]): string {
  return (sides.length < 2 ? SEATS.slice(0, 2) : sides).join('');
}

// The seats come as a string so that a new array each render does not draw the picture again.
function MapThumb({ id, seats, size }: { id: MapId; seats: string; size: SizeId | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const sides = SEATS.filter((seat) => seats.includes(seat));
    drawThumb(ref.current!, buildMap(THUMB_SEED, id, sides, size ?? undefined), THUMB_SEED);
  }, [id, seats, size]);
  return <canvas ref={ref} className={styles.mapThumb} />;
}

// Shown before a game and never during one: the board is left to itself.
const HOW_TO =
  'Every hut you hold breeds units. Drag from your hut to any other to send half of it. Rest on the target for a moment, or hold Shift, to send all of it. Sweep over more of your huts on the way to send from them too, or over spikes or a ford to take that short cut. Units fight one for one. Tap a hut to upgrade it. Take every hut to win, or hold the most when the clock runs out. Level on huts then, play goes on for up to a minute until a hut changes hands.';

/** The shuffle tile: every map's picture in a strip, since any of them may come up. */
function ShuffleThumb({ seats, size }: { seats: string; size: SizeId | null }) {
  return (
    <span className={`${styles.mapThumb} ${styles.shuffleThumb}`}>
      {MAP_IDS.map((id) => (
        <span key={id}>
          <MapThumb id={id} seats={seats} size={size} />
        </span>
      ))}
    </span>
  );
}

interface MapPickerProps {
  pick: MapId | null;
  onPick: (id: MapId | null) => void;
  size: SizeId | null;
  onSize: (size: SizeId | null) => void;
  /** The seats the game would be played from. */
  sides: readonly Seat[];
}

function MapPicker({ pick, onPick, size, onSize, sides }: MapPickerProps) {
  const seats = thumbSeats(sides);
  const four = sides.length === 4;
  // The size the game would be played at: as sizeOf has it, four sides are never played small.
  const shown = size === null ? pick && sizeOf(pick, sides.length) : four && size === 'small' ? 'medium' : size;
  return (
    <>
      <div className={styles.mapRow} role="radiogroup" aria-label="Map">
        {[null, ...MAP_IDS].map((id) => (
          <button
            key={id ?? 'shuffle'}
            className={`${styles.mapBtn} ${id === pick ? styles.mapBtnOn : ''}`}
            role="radio"
            aria-checked={id === pick}
            onClick={() => onPick(id)}
          >
            {id ? <MapThumb id={id} seats={seats} size={size} /> : <ShuffleThumb seats={seats} size={size} />}
            {id ? MAPS[id].name : 'Shuffle'}
          </button>
        ))}
      </div>
      <span className={styles.rules}>{pick ? MAPS[pick].about : 'A different map each game.'}</span>
      <div className={styles.choiceRow} role="radiogroup" aria-label="Size">
        {/* With the map left to the seed, there is no one size that is the map's own to show. */}
        {(pick ? SIZE_IDS : [null, ...SIZE_IDS]).map((each) => (
          <button
            key={each ?? 'own'}
            className={`${styles.choiceBtn} ${each === shown ? styles.choiceBtnOn : ''}`}
            role="radio"
            aria-checked={each === shown}
            disabled={four && each === 'small'}
            onClick={() => onSize(each)}
          >
            {each ? SIZE_NAME[each] : "Each map's own size"}
          </button>
        ))}
      </div>
    </>
  );
}

/** What the lobby says of each mode: what wins, and what is different on the way. */
const MODES: Record<ModeId, { name: string; about: string }> = {
  classic: { name: 'Classic', about: 'Take every hut, or hold the most huts when the clock runs out.' },
  blitz: { name: 'Blitz', about: '3 minutes, 4 with four sides. Huts breed over 40% faster, armies start one speed up and starts hold 10.' },
  hill: { name: 'King of the hill', about: 'A crown hut with 20 units stands in the middle. Hold it for 60 seconds in all to win.' },
  regicide: { name: 'Regicide', about: 'Your home hut is your queen. Lose it and you are out; the last queen standing wins.' },
  bounty: { name: 'Bounty', about: 'Every 5 seconds the side with the most huts is marked. A hut taken from it gains 10 units.' },
  egg: { name: 'Egg', about: 'An egg lies in the middle hut and goes with the first unit sent out of it. Get it into your home hut to win.' },
  teams: { name: 'Teams', about: 'Four sides, two teams of neighbours. Allies never fight, and a team is out when both its sides are.' },
  survival: { name: 'Survival', about: 'People against the computer. Each minute its huts gain 3 units, then 6, then 9 and on. Last to the clock to win.' },
};

/** What each start gives a side on the first tick. */
const STARTS: Record<StartId, { name: string; about: string }> = {
  home: { name: 'Home', about: 'Each side starts from one hut, where the map puts it.' },
  close: { name: 'Close', about: 'The starts are 2 paths apart instead of across the map.' },
  scattered: { name: 'Scattered', about: 'Your home hut and 2 more spread over your part of the board, with 5 units in each of the 2.' },
  draft: { name: 'Draft', about: 'For the first 6 seconds each person picks any hut to start from. The computer keeps its own.' },
  nests: { name: 'Nests', about: 'Each person picks Big, one level 3 hut of 37 units, or Many, 3 huts of 5. The computer is Big.' },
};

/** What each twist adds, said when it is pointed at or focused. */
const TWISTS: Record<Twist, { name: string; about: string }> = {
  flood: { name: 'Flood', about: 'After 40% of the clock the outer ring of huts floods every 30 seconds, until the inner 40% are left.' },
  fog: { name: 'Fog', about: 'You see only near your own huts and units. Elsewhere enemy units are hidden and hut counts show ?.' },
  powers: { name: 'Powers', about: 'One use each of rain (every path slow for 15 seconds), a call (every hut of yours sends half to one) and a decoy column.' },
  golden: { name: 'Golden hut', about: '3 minutes in (30% of the clock in blitz) the middle hut turns gold: it breeds 3 times as fast and holds half as much again.' },
  frenzy: { name: 'Frenzy', about: 'In the last minute every hut breeds twice as fast and towers fire every 0.3 seconds.' },
  comeback: { name: 'Comeback', about: 'A side 2 or more huts behind the leader breeds 25% faster.' },
  buildings: { name: 'Buildings', about: 'A trap kills half its first takers, barracks send units that survive one death, beacons send faster ones and a granary gives the huts next to it half as much room again.' },
  queens: { name: 'Queens', about: 'Lose your home hut and your other huts stop breeding until you take it back.' },
};

const TWISTS_ABOUT = 'Any number of twists can be played at once.';
const TUNE_ABOUT = 'Every setting is at standard. Pick one to read what it does.';

const NEST_IDS: readonly Nest[] = ['big', 'many'];
const NEST_NAME: Record<Nest, string> = { big: 'Big', many: 'Many' };

const SURPRISE_ABOUT = 'Draws a mode, a start and 2 twists that the sides here can play. Press again for another draw.';

interface RulesPickerProps {
  choice: RulesChoice;
  /** Without it the choice is only shown: a guest sees the host's. */
  onChoice?: (choice: RulesChoice) => void;
  /** What a twist says when none is pointed at. */
  idle: string;
  /** Against the computer the nest is picked here; in a room, in your seat's row. */
  nest?: { pick: Nest; onPick: (nest: Nest) => void };
  /** What the Surprise draw is made from, and the modes the sides there can play. */
  surprise: { seed: number; fits: (mode: ModeId) => boolean };
}

export function RulesPicker({ choice, onChoice, idle, nest, surprise }: RulesPickerProps) {
  // What the shared line is about: a twist or Surprise pointed at, focused or last tapped, since a phone has no hover.
  const [shown, setShown] = useState<Twist | 'surprise' | null>(null);
  // Each press draws again; a draw is saved as the choice, so nobody else needs to make it.
  const [rolls, setRolls] = useState(0);
  const toggle = (twist: Twist) => {
    setShown(twist);
    if (clashOf(twist, choice.mode)) return;
    const twists = choice.twists.includes(twist) ? choice.twists.filter((each) => each !== twist) : [...choice.twists, twist];
    onChoice?.({ ...choice, twists });
  };
  const read = (what: Twist | 'surprise') => ({
    onPointerEnter: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') setShown(what);
    },
    onPointerLeave: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse') setShown(null);
    },
    onFocus: () => setShown(what),
    onBlur: () => setShown(null),
  });
  const about = shown === 'surprise' ? SURPRISE_ABOUT : shown ? (clashOf(shown, choice.mode) ?? TWISTS[shown].about) : idle;
  return (
    <div className={styles.ruleSet}>
      <div className={styles.pickRow}>
        {READY_MODES.length > 1 && (
        <label className={styles.pickLabel}>
          Mode
          <select
            className={styles.kindPick}
            value={choice.mode}
            disabled={!onChoice}
            onChange={(e) => {
              const mode = MODE_IDS.find((id) => id === e.target.value);
              // A twist with nothing to do in the new mode is let go of rather than kept switched on and idle.
              if (mode) onChoice?.({ ...choice, mode, twists: choice.twists.filter((twist) => !clashOf(twist, mode)) });
            }}
          >
            {READY_MODES.map((id) => (
              <option key={id} value={id}>{MODES[id].name}</option>
            ))}
          </select>
        </label>
        )}
        <label className={styles.pickLabel}>
          Start
          <select
            className={styles.kindPick}
            value={choice.start}
            disabled={!onChoice}
            onChange={(e) => {
              const start = START_IDS.find((id) => id === e.target.value);
              if (start) onChoice?.({ ...choice, start });
            }}
          >
            {START_IDS.map((id) => (
              <option key={id} value={id}>{STARTS[id].name}</option>
            ))}
          </select>
        </label>
        {nest && choice.start === 'nests' && (
          <label className={styles.pickLabel}>
            Nest
            <select
              className={styles.kindPick}
              value={nest.pick}
              onChange={(e) => {
                const pick = NEST_IDS.find((id) => id === e.target.value);
                if (pick) nest.onPick(pick);
              }}
            >
              {NEST_IDS.map((id) => (
                <option key={id} value={id}>{NEST_NAME[id]}</option>
              ))}
            </select>
          </label>
        )}
        {onChoice && READY_TWISTS.length > 0 && (
          <button
            className={styles.choiceBtn}
            onClick={() => {
              setShown('surprise');
              onChoice(surpriseOf(surprise.seed, rolls, surprise.fits));
              setRolls(rolls + 1);
            }}
            {...read('surprise')}
          >
            Surprise
          </button>
        )}
      </div>
      <span className={styles.rules}>{MODES[choice.mode].about} {STARTS[choice.start].about}</span>
      {READY_TWISTS.length > 0 && (
      <div className={`${styles.choiceRow} ${styles.twistRow}`} role="group" aria-label="Twists">
        {READY_TWISTS.map((twist) => {
          const on = choice.twists.includes(twist);
          return (
            <button
              key={twist}
              className={`${styles.choiceBtn} ${on ? styles.choiceBtnOn : ''}`}
              aria-pressed={on}
              // Not disabled: a guest can still point at a twist to read what it does, and anyone at one that clashes to read why.
              aria-disabled={!onChoice || clashOf(twist, choice.mode) !== null}
              onClick={() => toggle(twist)}
              {...read(twist)}
            >
              {TWISTS[twist].name}
            </button>
          );
        })}
      </div>
      )}
      {READY_TWISTS.length > 0 && <span className={styles.rules} aria-live="polite">{about}</span>}
    </div>
  );
}

interface TunePanelProps {
  tune: Tune;
  /** Without it the settings are only shown: a guest sees the host's. */
  onTune?: (tune: Tune) => void;
  /** What the shared line says when no setting is being read. */
  idle: string;
  /** Held by the lobby, which makes room for the settings by folding the rest away while they are open. */
  open: boolean;
  onOpen: (open: boolean) => void;
}

/**
 * The numbers behind the rules, folded away so that one tap still starts the
 * standard game. A value is held to its range when its field is left, not on
 * each keystroke, so a room is never written one half typed.
 */
export function TunePanel({ tune, onTune, idle, open, onOpen }: TunePanelProps) {
  const [shown, setShown] = useState<KnobId | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<KnobId, string>>>({});
  const changed = tuneSummary(tune);
  const commit = (id: KnobId) => {
    const draft = drafts[id];
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // Anything but digits is let go of, and the field shows the value it had.
    if (draft === undefined || !/^\d+$/.test(draft)) return;
    const value = clampKnob(id, Number(draft));
    if (value !== tune[id]) onTune?.({ ...tune, [id]: value });
  };
  const knob = KNOBS.find((each) => each.id === shown);
  const about = knob
    ? `${knob.about} Standard is ${knob.standard}${knob.unit}; from ${knob.min} to ${knob.max}.`
    : changed
      ? `Settings changed: ${changed}.`
      : idle;
  return (
    <div className={styles.ruleSet}>
      <button className={`${styles.choiceBtn} ${open ? styles.choiceBtnOn : ''}`} aria-expanded={open} onClick={() => onOpen(!open)}>
        {open ? 'Done' : 'Settings'}
      </button>
      {open && (
        <>
          <div className={styles.knobGrid} role="group" aria-label="Settings">
            {KNOBS.map((each) => (
              <label key={each.id} className={styles.knobLabel}>
                {each.label}
                <input
                  className={styles.knobInput}
                  type="number"
                  inputMode="numeric"
                  min={each.min}
                  max={each.max}
                  step={1}
                  value={drafts[each.id] ?? String(tune[each.id])}
                  // Read only rather than disabled, so a guest can still focus one to read what it does.
                  readOnly={!onTune}
                  onChange={(e) => setDrafts({ ...drafts, [each.id]: e.target.value })}
                  onFocus={() => setShown(each.id)}
                  onBlur={() => {
                    commit(each.id);
                    setShown(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
                <span className={styles.knobUnit}>{each.unit.trim()}</span>
              </label>
            ))}
          </div>
          {onTune && (
            <button className={styles.choiceBtn} disabled={!changed} onClick={() => onTune(STANDARD_TUNE)}>
              Reset to standard
            </button>
          )}
        </>
      )}
      {(open || changed) && <span className={styles.rules} aria-live="polite">{about}</span>}
    </div>
  );
}

/** How long the white flag is held before it goes up: longer than any tap or press on the way to the board. */
export const FLAG_HOLD_MS = 1500;

/**
 * Giving up, held to be sure. Letting go, sliding off or losing focus before
 * the fill reaches the end raises nothing. The timer is started by the press
 * and not by an effect, since the HUD renders this again every second.
 */
export function FlagButton({ onRaise }: { onRaise: () => void }) {
  const [held, setHeld] = useState(false);
  const timer = useRef(0);
  const end = () => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    setHeld(false);
  };
  const begin = () => {
    if (timer.current) return;
    setHeld(true);
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      setHeld(false);
      onRaise();
    }, FLAG_HOLD_MS);
  };
  // Gone mid-hold (the last hut lost, the game over): the flag is not raised after.
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      className={`${styles.flagBtn} ${held ? styles.flagBtnHeld : ''}`}
      title="Hold for 1.5 seconds to give up. Your huts are left to the others with their units."
      onPointerDown={(e) => {
        if (e.button === 0) begin();
      }}
      onPointerUp={end}
      onPointerLeave={end}
      onPointerCancel={end}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        if (!e.repeat) begin();
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') end();
      }}
      onBlur={end}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* It fills at the pace of the hold, and empties at once when let go. */}
      <span className={styles.flagFill} style={{ transitionDuration: held ? `${FLAG_HOLD_MS}ms` : '0s' }} />
      <span className={styles.flagText}>White flag</span>
    </button>
  );
}

/** With no new order to send, a seat still moves its promise on this often, in ticks. */
const REPORT_EVERY = 4;
/**
 * How far ahead of the moment it is given an order takes effect, in ticks.
 * Long enough that it has usually reached the other client by then, so their
 * picture rarely has to be corrected.
 */
const ORDER_DELAY = 4;
/** Against the computer there is nobody to reach. */
const ORDER_DELAY_SOLO = 1;
/** rAF stops in a hidden tab; this keeps the seat reporting from there. */
const BACKGROUND_PUMP_MS = 250;
/**
 * The room's stream has this long to send the room as it stands. Once it has,
 * it may be quiet this much longer than twice this seat's own beat, since every
 * write of the seat comes back on it. A proxy holding events back fails the first.
 */
const STREAM_FIRST_MS = 3000;
const STREAM_GRACE_MS = 2000;
/** After a stream that never delivered, the next is tried this much later, doubling to the cap. */
const REFOLLOW_MS = 5000;
const REFOLLOW_MAX_MS = 60_000;
/**
 * How far a press may wander, in CSS px, and still be a tap. A fingertip rolls
 * as it lands and lifts; a mouse button does not move the mouse.
 */
const SLOP_PX = { mouse: 4, finger: 10 };
/**
 * Resting this long on the hut a drag is aimed at turns the send from half to
 * all. A phone has no Shift, and staying put is the one thing a finger that is
 * already down can still say without a button.
 */
const HOLD_ALL_MS = 450;

// iOS Safari has no navigator.vibrate.
const CAN_BUZZ = 'vibrate' in navigator;
/** Milliseconds. A refusal and a siege are felt as two. */
const BUZZ = { add: 8, latch: 8, done: 14, all: 20, refused: [10, 50, 10], siege: [12, 90, 12] };
/** The last seconds of the clock, and of overtime, are shown counting down. */
const LAST_SECS = 10;
/** A siege beats every second or faster; the hand is told of it no more often than this. */
const SIEGE_BUZZ_MS = 3000;

function buzz(pattern: number | number[]) {
  if (CAN_BUZZ) navigator.vibrate(pattern);
}

const ROOM_KEY = 'swarm-room';

function recallRoom(): string {
  try {
    return sessionStorage.getItem(ROOM_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberRoom(code: string | null) {
  try {
    if (code) sessionStorage.setItem(ROOM_KEY, code);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch {
    // sessionStorage blocked (private browsing): rejoin by hand
  }
}

interface Hud {
  count: number | null;
  /** Left on the clock, or in overtime; null until there is a game on the board to time. */
  secs: number | null;
  /** Level on huts at the clock and playing on. */
  overtime: boolean;
  /** Each side's huts and units on the board; under the fog, another side's units are not known. */
  counts: Partial<Record<Seat, { huts: number; units: number | null }>>;
  starts: Partial<Record<Seat, Start>>;
  /** A hut is in hand, with its upgrades showing. */
  picked: boolean;
  /** This seat has something to give up and has not already. */
  flag: boolean;
  /** The sides that raised the white flag, in the order they did. */
  yielded: Seat[];
  /** Left of the draft to pick a hut to start from; null when there is no draft on. */
  draft: number | null;
  /** What this seat holds besides one hut of level 1, in words (see holdingOf). */
  holding: string | null;
  /** In survival: the waves landed, seconds to the next (null when no other comes before the clock), and seconds played. */
  survival: { waves: number; next: number | null; lasted: number } | null;
  /** What the mode and twists are counting, under the clock. */
  notes: ModeNote[];
  /** What the mode adds to the result once there is one. */
  story: string[];
  /** Seconds until the next ring of the flood goes under, or 'over'; null with no flood. */
  flood: number | 'over' | null;
  /** With the powers twist, this seat's. */
  powers: PowerPill[] | null;
}

const HUD_IDLE: Hud = { count: null, secs: null, overtime: false, counts: {}, starts: {}, picked: false, flag: false, yielded: [], draft: null, holding: null, survival: null, notes: [], story: [], flood: null, powers: null };

/** One game as this client holds it. */
interface Game extends Lockstep {
  scene: Scene;
  /** The last tick whose events reached the drawing. */
  fxTick: number;
  /** The confirmed game's record, for the summary at its end. */
  tally: Tally;
}

interface Controls {
  down: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  move: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  up: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  cancel: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  key: (e: KeyboardEvent) => void;
  flag: () => void;
  power: (power: Power) => void;
}

interface SwarmGameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

export function SwarmGame({ onClose, isSearchOpen }: SwarmGameProps) {
  let sessionId = 'anonymous';
  let userName = 'Player';
  try {
    sessionId = sessionStorage.getItem('roadmap-user-id') || 'anonymous';
    userName = sessionStorage.getItem('roadmap-user-name') || 'Player';
  } catch {
    // sessionStorage blocked (private browsing): use defaults
  }

  const [code, setCode] = useState<string | null>(null);
  const [solo, setSolo] = useState(false);
  const [joinCode, setJoinCode] = useState(recallRoom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [match, setMatch] = useState<SwarmMatch | null>(null);
  const [offline, setOffline] = useState(false);
  const [synced, setSynced] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hud, setHud] = useState<Hud>(HUD_IDLE);
  // null leaves the map to the seed, so each game is played somewhere new.
  const [mapPick, setMapPick] = useState<MapId | null>(null);
  // null plays the map at its own size.
  const [sizePick, setSizePick] = useState<SizeId | null>(null);
  const [computers, setComputers] = useState(1);
  // Against the computer the rules are this client's own; a room keeps them on its match (see setRules).
  const [rulesPick, setRulesPick] = useState<RulesChoice>(CLASSIC);
  const [nestPick, setNestPick] = useState<Nest>('big');
  const [tunePick, setTunePick] = useState<Tune>(STANDARD_TUNE);
  // The Menu was pressed in a game and is waiting on the answer to what leaving costs.
  const [leaving, setLeaving] = useState(false);
  // The settings are open, and the map and rules are folded away to fit them in the one view.
  const [tuning, setTuning] = useState(false);
  const [lobbySeed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);
  const [full, setFull] = useState(false);
  const [summary, setSummary] = useState<{ game: number; tally: Tally; clock: number } | null>(null);

  const [clock] = useState(() => createServerClock(() => performance.now()));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<Controls | null>(null);
  // A game against the computer has no room: this is its match, kept where the
  // running loop can read the latest one.
  const soloRef = useRef<SwarmMatch | null>(null);
  const isSearchOpenRef = useRef(isSearchOpen);
  isSearchOpenRef.current = isSearchOpen;

  const mySeat = solo ? 'a' : match ? seatOf(match, sessionId) : undefined;
  const wide = match !== null && match.status !== 'waiting';

  const enterRoom = useCallback((roomCode: string) => {
    rememberRoom(roomCode);
    setError('');
    setMatch(null);
    setHud(HUD_IDLE);
    setCode(roomCode);
  }, []);

  const handleCreate = () => {
    setBusy(true);
    createRoom(sessionId, userName)
      .then(enterRoom, (err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const join = useCallback((raw: string) => {
    const roomCode = raw.trim().toUpperCase();
    setBusy(true);
    joinRoom(roomCode, sessionId, userName)
      .then(() => enterRoom(roomCode), (err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }, [sessionId, userName, enterRoom]);

  const startSolo = useCallback(() => {
    const next: SwarmMatch = {
      status: 'playing',
      createdAt: Date.now(),
      seed: crypto.getRandomValues(new Uint32Array(1))[0],
      players: { a: { sessionId, name: userName, ...(rulesPick.start === 'nests' && { nest: nestPick }) } },
      game: (soloRef.current?.game ?? 0) + 1,
      startAt: performance.now() + COUNTDOWN_MS,
      ...(mapPick && { map: mapPick }),
      ...(sizePick && { size: sizePick }),
      cpu: SEATS.slice(1, 1 + computers).join(''),
      ...(rulesPick.mode !== CLASSIC.mode && { mode: rulesPick.mode }),
      ...(rulesPick.start !== CLASSIC.start && { start: rulesPick.start }),
      ...(rulesPick.twists.length > 0 && { twists: twistLetters(rulesPick.twists) }),
      ...(encodeTune(tunePick) && { tune: encodeTune(tunePick) }),
    };
    soloRef.current = next;
    setError('');
    setHud(HUD_IDLE);
    setMatch(next);
    setTuning(false);
    setSolo(true);
  }, [sessionId, userName, mapPick, sizePick, computers, rulesPick, nestPick, tunePick]);

  // An invite link (?swarm=CODE) joins straight away. The parameter is taken
  // off the URL first, so a reload or a second mount does not join again.
  useEffect(() => {
    const url = new URL(window.location.href);
    const invite = url.searchParams.get('swarm');
    if (!invite) {
      // A reload mid-game has 20 seconds before the other client counts this
      // seat as gone, so the room this tab was in is rejoined without asking.
      // One that refuses (closed, or cleared out) is forgotten.
      const recalled = recallRoom();
      if (!recalled) return;
      setBusy(true);
      joinRoom(recalled, sessionId, userName)
        .then(() => enterRoom(recalled), (err: Error) => {
          rememberRoom(null);
          setError(err.message);
        })
        .finally(() => setBusy(false));
      return;
    }
    url.searchParams.delete('swarm');
    window.history.replaceState({}, '', url.toString());
    setJoinCode(invite.toUpperCase());
    join(invite);
  }, [join, sessionId, userName, enterRoom]);

  // --- The game: reads, the simulation, reports, input, drawing ---
  useEffect(() => {
    if (!code && !solo) return;
    let stopped = false;
    let pollTimer = 0;
    let frameId = 0;
    let failures = 0;
    let room: SwarmRoom | null = null;
    let game: Game | null = null;
    // Not from zero: the seat may still hold a state this tab wrote before it
    // was reopened, and its stamp must not be taken for a new write's.
    let seq = Math.floor(Math.random() * 1e9);
    let putBusy = false;
    let pollBusy = false;
    let sentKey = '';
    let sentK = -1;
    let sentAt = 0;
    let recorded = 0;
    const ears: Partial<Record<Seat, Ear>> = {};
    let rejoining = false;
    let hudKey = '';
    let selected: number | null = null;
    // A call or a decoy picked from its pill, waiting for the tap or the drag that aims it.
    let armed: Power | null = null;
    // The hut this seat's call went to, for its pill to count what is still on the way.
    let calledOn: number | null = null;
    /** A place on the board in world units, a finger's reach there, and how many world units a CSS pixel is. */
    interface Press {
      x: number;
      y: number;
      reach: number;
      px: number;
    }
    let drag: {
      /** The one pointer this drag follows: a second finger on the board is not it. */
      pointer: number;
      sources: number[];
      x: number;
      y: number;
      /** The hut the arrow has jumped to, which is where a release sends. */
      target: number | null;
      startX: number;
      startY: number;
      slop: number;
      /** A finger hides what it is on, so what is drawn for it is drawn clear of it. */
      finger: boolean;
      moved: boolean;
      shift: boolean;
      /** Where and when the pointer last settled on the target, on the screen. */
      restX: number;
      restY: number;
      restAt: number;
      /** It stayed there long enough: this send takes everything. */
      held: boolean;
      /** The drag crossed spikes or a ford, which is how the short cut is asked for. */
      risky: boolean;
      /** It aims a decoy: one hut, half of it, and no sweeping up others. */
      decoy: boolean;
    } | null = null;
    // Where the mouse is, for the cursor to say what a press there would do.
    let hover: Press | null = null;
    // The board is not on the page until a game is, so it is watched from the first frame that finds it.
    let watched: HTMLCanvasElement | null = null;
    let unwatch: (() => void) | null = null;
    const feel: Pick<View, 'refused' | 'sent'> = { refused: null, sent: null };
    let live = false;
    let tickNow = 0;
    let seatNow: Seat = 'a';
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let threat: ThreatView | null = null;
    let threatTick = -1;
    let siegeBuzzAt = -Infinity;

    const leaveRoom = (message: string) => {
      rememberRoom(null);
      setCode(null);
      setMatch(null);
      setError(message);
    };

    // The room is followed over its stream while that delivers, and read on a
    // timer while it does not. Only one of them feeds the game at a time, so a
    // read that set off before the stream caught up cannot put the room back.
    let unfollow: (() => void) | null = null;
    let followedAt = 0;
    /** When the stream last delivered; 0 while it has not, which is when the room is read instead. */
    let heardAt = 0;
    let followAt = 0;
    let refollow = REFOLLOW_MS;

    const follow = () => {
      if (!code) return;
      followedAt = performance.now();
      unfollow = followRoom(
        code,
        (next) => {
          if (stopped) return;
          heardAt = performance.now();
          refollow = REFOLLOW_MS;
          take(next);
          pump();
        },
        () => {
          if (!stopped) dropStream(heardAt === 0);
        }
      );
    };

    // A stream that delivered and then ended (the host closes held requests after some minutes) is reopened at once.
    const dropStream = (neverDelivered: boolean) => {
      unfollow?.();
      unfollow = null;
      heardAt = 0;
      followAt = performance.now() + (neverDelivered ? refollow : 0);
      if (neverDelivered) refollow = Math.min(refollow * 2, REFOLLOW_MAX_MS);
    };

    const take = (next: SwarmRoom | null) => {
      if (!code) return;
      failures = 0;
      setOffline(false);
      const seat = next && seatOf(next.m, sessionId);
      if (!next || !seat) {
        leaveRoom(next ? 'You no longer have a seat in that room.' : 'That room has closed.');
        return;
      }
      // Anyone can write a seat. A state the game cannot be run on is dropped
      // here, so that it counts as silence and whoever holds the seat forfeits.
      for (const each of SEATS) {
        const state = next.s?.[each];
        if (next.s && state && !sound(state)) delete next.s[each];
      }
      room = next;
      setMatch((prev) => (JSON.stringify(prev) === JSON.stringify(next.m) ? prev : next.m));

      const mine = next.s?.[seat];
      if (mine) clock.seen(mine.seq, mine.at);
      if (clock.now() !== null) setSynced(true);

      // A seat the computer took over has nothing to be silent about, and one
      // that has been taken over itself is only watching.
      const away = next.m.out?.[seat] !== undefined;
      const now = performance.now();
      for (const other of SEATS) {
        if (other === seat) continue;
        const ear = (ears[other] ??= { seq: undefined, at: now, playing: false });
        const theirs = next.s?.[other];
        const seated = Boolean(next.m.players[other]) && next.m.out?.[other] === undefined && !away;
        if (silent(ear, seated, theirs?.seq, next.m.status === 'playing', now)) {
          const k = theirs?.game === next.m.game ? theirs.k : 0;
          vacateSeat(code, other, k).catch((err) => console.warn('[Swarm] Could not release the silent seat:', err));
        }
      }

      // Taken over in a game and still here at the end of it: back in for the next one.
      if (away && next.m.status === 'finished' && !rejoining) {
        rejoining = true;
        joinRoom(code, sessionId, userName)
          .catch((err: Error) => setError(err.message))
          .finally(() => {
            rejoining = false;
          });
      }
    };

    const poll = async () => {
      if (!code) return;
      const { beat } = pace(room?.m.status === 'playing', document.hidden, clock.now() !== null);
      const now = performance.now();
      if (unfollow && (heardAt ? now - heardAt > beat * 2 + STREAM_GRACE_MS : now - followedAt > STREAM_FIRST_MS)) {
        console.warn(heardAt ? '[Swarm] Room stream went quiet; reading the room instead' : '[Swarm] Room stream sent nothing; reading the room instead');
        dropStream(heardAt === 0);
      }
      if (!unfollow && now >= followAt) follow();
      if (!heardAt) {
        pollBusy = true;
        try {
          const next = await getRoom(code);
          if (stopped) return;
          if (!heardAt) take(next);
        } catch (err) {
          if (stopped) return;
          console.warn('[Swarm] Room read failed:', err);
          if (++failures >= 3) setOffline(true);
          // Silence is only counted against the other seats while this one can hear.
          for (const ear of Object.values(ears)) ear.at = performance.now();
        }
        pollBusy = false;
      }
      // A tab hidden for some minutes has its repeating timer held to once a
      // minute, which in a game is a forfeit. A timer set after a request is
      // not held, so the seat is also kept reporting from here. While the
      // stream delivers, each event does the same.
      pump();
      pollTimer = window.setTimeout(poll, pace(room?.m.status === 'playing', document.hidden, clock.now() !== null).poll);
    };

    // A hidden tab outside a game reads the room rarely. Coming back to it does not wait that out.
    const wake = () => {
      if (document.hidden || pollBusy || !code) return;
      window.clearTimeout(pollTimer);
      void poll();
    };

    // `write` is asked for only when something is sent: making one is a promise (see sending).
    const report = (seat: Seat, key: string, k: number, write: (seq: number) => SeatWrite) => {
      if (!code || putBusy) return;
      const now = performance.now();
      const urgent = key !== sentKey;
      const { beat } = pace(room?.m.status === 'playing', document.hidden, clock.now() !== null);
      const due = k - sentK >= REPORT_EVERY || now - sentAt >= beat;
      if (!urgent && !due) return;
      const state = write(++seq);
      putBusy = true;
      sentKey = key;
      sentK = k;
      sentAt = now;
      clock.sent(state.seq);
      putSeat(code, seat, state)
        .then(
          () => {
            clock.acked(state.seq);
            // It replaced what it was built on, unless a read has shown the room moving on since.
            if (game && game.game === state.game && game.ownSeq === state.base) game.ownSeq = state.seq;
          },
          (err) => {
            console.warn('[Swarm] Report failed:', err);
            clock.failed(state.seq);
            sentKey = '';
          }
        )
        .finally(() => {
          putBusy = false;
        });
    };

    const finishSolo = (winner: Seat | 'draw') => {
      const current = soloRef.current;
      if (!current || current.status !== 'playing') return;
      soloRef.current = { ...current, status: 'finished', winner };
      setMatch(soloRef.current);
    };

    const pump = () => {
      const m = solo ? soloRef.current : room?.m;
      if (!m) return;
      const seat = solo ? 'a' : seatOf(m, sessionId);
      if (!seat) return;
      const now = solo ? performance.now() : clock.now();
      const playing = m.status === 'playing' && now !== null;
      // Taken over by the computer: the game goes on in front of this seat, but it has no say in it.
      const away = m.out?.[seat] !== undefined;

      // A finished game stays on the board until the next one starts.
      if (playing && game?.game !== m.game) {
        const map = buildMap(m.seed, MAP_IDS.find((id) => id === m.map), sidesOf(m), SIZE_IDS.find((id) => id === m.size), rulesOf(m));
        game = { ...newLockstep(m.game, map), scene: newScene(map, m.seed, kindsOf(m, map.sides), seat), fxTick: 0, tally: newTally(map, newState(map)) };
        threat = null;
        threatTick = -1;
        setSummary(null);
        armed = null;
        calledOn = null;
        selected = null;
        drag = null;
      }
      const current = playing && game?.game === m.game;
      const tick = current ? Math.floor((now - m.startAt) / TICK_MS) : game?.shown.tick ?? 0;
      live = Boolean(current) && tick >= 0 && game?.shown.winner === null && !away;
      tickNow = tick;
      seatNow = seat;

      if (game && current) {
        const active = game;
        const harvest = (state: SwarmState) => {
          if (state.tick <= active.fxTick) return;
          active.fxTick = state.tick;
          for (const event of state.events) if (event.kind === 'power' && event.seat === seat && event.power === 'call') calledOn = event.to;
          addEvents(active.scene, state, state.events, performance.now(), seat);
        };
        // A rerun of the confirmed game starts again from its first tick, and so does its record.
        const record = (state: SwarmState) => {
          if (state.tick === 1) active.tally = newTally(active.map, newState(active.map));
          tallyStep(active.tally, active.map, state);
          if (state.winner !== null) setSummary({ game: active.game, tally: active.tally, clock: active.map.ticks });
        };
        if (solo) {
          advance(active.confirmed, active.map, active.orders, tick, computerOf(m), (state) => {
            record(state);
            harvest(state);
          });
          active.shown = active.confirmed;
          if (active.confirmed.winner !== null) finishSolo(active.confirmed.winner);
        } else {
          settle(active, seat, m, room?.s, tick, harvest, record);
          const winner = active.confirmed.winner;
          if (winner !== null && recorded !== m.game && code) {
            recorded = m.game;
            recordResult(code, m.game, winner).catch((err) => {
              console.warn('[Swarm] Could not record the result:', err);
              recorded = 0;
            });
          }
          // The rules refuse a seat that was taken over any promise past the tick it was taken at.
          if (!away) {
            const k = Math.max(active.promised, Math.min(tick, lastTick(active.map)));
            report(seat, `${m.game}|${active.orders[seat].length}`, k, (mySeq) => sending(active, seat, mySeq, tick));
          }
        }
      } else if (!(away && m.status === 'playing')) {
        report(seat, 'rest', 0, (mySeq) => restingReport(m, room?.s?.[seat], mySeq));
      }

      const next: Hud = {
        count: playing && now < m.startAt ? Math.ceil((m.startAt - now) / 1000) : null,
        secs: null,
        overtime: false,
        counts: {},
        starts: {},
        picked: false,
        flag: false,
        yielded: [],
        draft: null,
        holding: null,
        survival: null,
        notes: [],
        story: [],
        flood: null,
        powers: null,
      };
      if (game) {
        const { shown, map } = game;
        // In overtime the clock runs on to the most overtime can last. A game that ends on the clock to the tick never was in it.
        next.overtime = shown.tick > map.ticks || (shown.tick === map.ticks && shown.winner === null);
        const ticks = next.overtime ? lastTick(map) : map.ticks;
        next.secs = Math.ceil(((ticks - Math.min(Math.max(tick, 0), ticks)) * TICK_MS) / 1000);
        if (drafting(game.map, tick + 1)) next.draft = Math.ceil(((DRAFT_TICKS - Math.max(tick, 0)) * TICK_MS) / 1000);
        // A draft moves the starts at its end, and the score line moves with them.
        next.starts = startsOf(game.map, game.shown.homes);
        next.holding = holdingOf(game.map, game.shown, seat);
        if (game.map.rules.mode === 'survival') {
          const at = Math.min(Math.max(tick, 0), ticks);
          const waves = Math.floor(at / WAVE_TICKS);
          const due = (waves + 1) * WAVE_TICKS;
          next.survival = { waves, next: due < ticks ? Math.ceil(((due - at) * TICK_MS) / 1000) : null, lasted: Math.floor((at * TICK_MS) / 1000) };
        }
        const fogged = game.scene.fog !== null && game.shown.winner === null;
        for (const side of game.map.sides) {
          const count = countAsSeen(game.shown, side, seat);
          next.counts[side] = fogged && side !== seat ? { huts: count.huts, units: null } : count;
        }
        next.flood = floodIn(game.map, game.shown.tick);
        next.powers = pillsOf(game.map, game.shown, game.orders[seat], seat, armed, calledOn);
        // A hut lost while it was in hand is put down.
        if (selected !== null && game.shown.huts[selected].owner !== seat) selected = null;
        if (drag) drag.sources = drag.sources.filter((hut) => game?.shown.huts[hut].owner === seat);
        if (drag?.sources.length === 0) drag = null;
        next.picked = selected !== null;
        // Read whole: the fog hides other sides' units, never this seat's own.
        const own = next.counts[seat] && countOf(game.shown, seat);
        next.flag = live && own !== undefined && own.huts + own.units > 0 && !game.orders[seat].some((order) => order.kind === 'flag');
        // A copy: the state is stepped in place, and the HUD is compared with the last one by value.
        next.yielded = game.shown.yielded.slice();
        next.notes = modeNotes(game.map, game.shown);
        if (game.shown.winner !== null) {
          const { kinds } = game.scene;
          const them = (other: Seat) => `The ${KIND_NAME[kinds[other]].many.toLowerCase()}`;
          next.story = modeStory(game.map, game.shown, (other) => (other === seat ? { name: 'You', whose: 'Your' } : { name: them(other), whose: `${them(other)}'` }));
        }
      }
      const nextKey = JSON.stringify(next);
      if (nextKey !== hudKey) {
        hudKey = nextKey;
        setHud(next);
      }
    };

    const issue = (kind: OrderKind, from: number, to: number, risky = false) => {
      if (!game || !live) return;
      const mine = game.orders[seatNow];
      const last = mine.length > 0 ? mine[mine.length - 1].tick : 0;
      const tick = orderTick(tickNow + (solo ? ORDER_DELAY_SOLO : ORDER_DELAY), game.promised, game.confirmed.tick, last);
      mine.push({ tick, kind, from, to, ...(risky && { risky }) });
    };

    const worldOf = (g: Game, e: React.PointerEvent<HTMLCanvasElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const scale = g.map.w / box.width;
      const p = { x: (e.clientX - box.left) * scale, y: (e.clientY - box.top) * scale, reach: reachOf(box.width, g.map.w), px: scale };
      if (e.pointerType === 'mouse') hover = p;
      return p;
    };
    const mine = (hut: number | null): hut is number => hut !== null && game?.shown.huts[hut].owner === seatNow;
    // The picture of a hut first, then anything a finger's width from its site.
    const hutNear = (g: Game, p: Press) =>
      hutAt(g.map, g.shown, p.x, p.y) ?? nearest(g.map.sites, p.x, p.y, p.reach, null);
    // A token's own disc beats a hut under it; its wider reach only takes ground no hut is drawn on.
    const tokenAt = (g: Game, p: Press) => {
      const hut = selected;
      if (hut === null) return null;
      const disc = TOKEN_R * tokenGrow(p.px) + 4;
      const spots: { kind: OrderKind; x: number; y: number; cost: number; to: number }[] = upgradeSpots(g.map, g.shown, hut, p.px).flatMap((spot) => {
        const cost = upgradeCost(g.map, g.shown, hut, spot.kind);
        return cost === null ? [] : [{ ...spot, cost, to: hut }];
      });
      spots.push(...burnSpots(g.map, g.shown, hut));
      const reach = hutAt(g.map, g.shown, p.x, p.y) === null ? Math.max(disc, p.reach) : disc;
      const spot = nearest(spots, p.x, p.y, reach, null);
      return spot === null ? null : { hut, ...spots[spot] };
    };
    const refuse = (hut: number, order?: NonNullable<View['refused']>['order']) => {
      feel.refused = { hut, at: performance.now(), order };
      buzz(BUZZ.refused);
    };
    // In a draft a press picks the hut to start from: one pick each, never a
    // tower or a hut another side picked first, and none that would land after
    // the draft and count for nothing. A pick another side beat to its hut on
    // the same tick comes back refused, and the person can pick again.
    const draftPick = (g: Game, p: Press) => {
      const hut = hutNear(g, p);
      if (hut === null) return;
      const lands = tickNow + (solo ? ORDER_DELAY_SOLO : ORDER_DELAY);
      const waiting = g.orders[seatNow].some((order) => order.kind === 'nest' && order.tick > g.shown.tick);
      const picked = g.shown.picks[g.map.sides.indexOf(seatNow)] !== -1;
      if (g.map.sites[hut].tower || picked || waiting || g.shown.picks.includes(hut) || !drafting(g.map, lands)) return refuse(hut);
      issue('nest', hut, hut);
      buzz(BUZZ.done);
    };

    const aim = (g: Game, e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drag) return;
      const p = worldOf(g, e);
      drag.x = p.x;
      drag.y = p.y;
      drag.shift = e.shiftKey;
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > drag.slop) drag.moved = true;
      if (!drag.moved) return;
      // Sweeping over another hut of yours adds it: they will all send to wherever the drag ends.
      // Only the hut's own picture counts here, because a hut once added cannot be dropped again.
      const over = hutAt(g.map, g.shown, p.x, p.y);
      if (mine(over) && !drag.sources.includes(over) && !drag.decoy) {
        drag.sources.push(over);
        buzz(BUZZ.add);
      }
      // Like a hut swept over, a short cut once crossed stays chosen: lives are not spent by a wobble.
      if (!drag.risky && g.map.paths.some((path) => {
        if (path.kind !== 'spikes' && path.kind !== 'ford') return false;
        const mid = pathPoint(g.map, path.a, path.b, 0.5);
        return Math.hypot(mid.x - p.x, mid.y - p.y) <= p.reach;
      })) {
        drag.risky = true;
        buzz(BUZZ.add);
      }
      // A hut sending alone has nowhere to send but away, so the arrow never sticks to it.
      const lone = drag.sources.length === 1 ? drag.sources[0] : null;
      const target = latch(g.map.sites, drag.target, over, p.x, p.y, p.reach, lone);
      const settled = Math.hypot(e.clientX - drag.restX, e.clientY - drag.restY) <= drag.slop;
      if (target !== drag.target) {
        drag.target = target;
        drag.held = false;
        if (target !== null) buzz(BUZZ.latch);
      } else if (drag.held || settled) {
        return;
      }
      drag.restX = e.clientX;
      drag.restY = e.clientY;
      drag.restAt = performance.now();
    };

    controlsRef.current = {
      down(e) {
        // A second finger, or the right button, while one drag is already under way.
        if (!game || !live || drag) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const p = worldOf(game, e);
        if (drafting(game.map, tickNow + 1)) return draftPick(game, p);
        if (armed === 'call') {
          const called = hutNear(game, p);
          armed = null;
          if (called === null) return;
          issue('call', called, called);
          buzz(BUZZ.done);
          return;
        }
        const token = armed ? null : tokenAt(game, p);
        if (token) {
          // An upgrade bought a moment ago has not been paid for yet: a second tap must not spend the same units.
          let owed = 0;
          for (const order of game.orders[seatNow]) {
            if (order.tick <= game.shown.tick || order.from !== token.hut) continue;
            if (order.kind === 'hut' || order.kind === 'speed' || order.kind === 'strength') owed += upgradeCost(game.map, game.shown, token.hut, order.kind) ?? 0;
            if (order.kind === 'burn') owed += BURN_COST;
          }
          if (sendSize(game.shown.huts[token.hut], 'all') - owed < token.cost) return refuse(token.hut);
          issue(token.kind, token.hut, token.to);
          buzz(BUZZ.done);
          return;
        }
        const hut = hutNear(game, p);
        if (!mine(hut)) {
          selected = null;
          if (hut !== null) refuse(hut);
          return;
        }
        // Captured, so a drag that runs off the board still ends here and not nowhere.
        e.currentTarget.setPointerCapture(e.pointerId);
        drag = {
          pointer: e.pointerId,
          sources: [hut],
          x: p.x,
          y: p.y,
          target: null,
          startX: e.clientX,
          startY: e.clientY,
          slop: e.pointerType === 'mouse' ? SLOP_PX.mouse : SLOP_PX.finger,
          finger: e.pointerType !== 'mouse',
          moved: false,
          shift: e.shiftKey,
          restX: e.clientX,
          restY: e.clientY,
          restAt: performance.now(),
          held: false,
          risky: false,
          decoy: armed === 'decoy',
        };
      },
      move(e) {
        if (!game) return;
        // With nothing in hand a move is only read for where the mouse is.
        if (!drag) worldOf(game, e);
        else if (e.pointerId === drag.pointer) aim(game, e);
      },
      up(e) {
        const g = game;
        if (!drag || e.pointerId !== drag.pointer || !g) return;
        aim(g, e);
        const { sources, moved, target, risky, decoy } = drag;
        const kind = drag.shift || drag.held ? 'all' : 'half';
        drag = null;
        if (decoy) {
          // A tap, or a drag back to its own hut, leaves the decoy waiting to be aimed.
          if (!moved || target === null || target === sources[0]) return;
          armed = null;
          issue('decoy', sources[0], target);
          buzz(BUZZ.done);
          return;
        }
        if (!moved) {
          // A tap picks the hut up to show its upgrades, and a second tap puts it down.
          selected = selected === sources[0] ? null : sources[0];
          return;
        }
        selected = null;
        if (target === null) return;
        const from = sources.filter((hut) => hut !== target);
        const asked = { from, n: from.map((hut) => sendSize(g.shown.huts[hut], kind)), to: target, risky };
        const order = carriedOf(g.map, asked);
        if (order.from.length === 0) return refuse(sources[0], asked);
        for (const hut of order.from) issue(kind, hut, target, risky);
        feel.sent = { order, at: performance.now() };
        buzz(BUZZ.done);
      },
      // The browser took the pointer away (a system gesture, a lost capture): nothing was decided, so nothing is sent.
      cancel(e) {
        if (drag?.pointer === e.pointerId) drag = null;
      },
      key(e) {
        if (e.key === 'Shift' && drag) drag.shift = e.type === 'keydown';
        if (e.key === 'Escape' && e.type === 'keydown') {
          drag = null;
          selected = null;
          armed = null;
        }
      },
      flag() {
        issue('flag', 0, 0);
      },
      power(power) {
        if (!game || !live) return;
        drag = null;
        selected = null;
        if (power !== 'rain') {
          armed = armed === power ? null : power;
          return;
        }
        armed = null;
        // Rain is called from a hut of the side's, which any one will do for.
        const from = game.shown.huts.findIndex((hut) => hut.owner === seatNow);
        if (from === -1) return;
        issue('rain', from, from);
        buzz(BUZZ.done);
      },
    };

    const frame = () => {
      frameId = requestAnimationFrame(frame);
      pump();
      const canvas = canvasRef.current;
      if (!canvas || !game) return;
      if (canvas !== watched) {
        unwatch?.();
        unwatch = watchBoard(canvas);
        watched = canvas;
      }
      const m = solo ? soloRef.current : room?.m;
      const now = solo ? performance.now() : clock.now();
      let alpha = 0;
      if (m && now !== null && live) alpha = Math.min(Math.max((now - m.startAt) / TICK_MS - game.shown.tick, 0), 1.5);
      const at = performance.now();
      if (drag?.moved && drag.target !== null && !drag.held && !drag.decoy && at - drag.restAt >= HOLD_ALL_MS) {
        drag.held = true;
        buzz(BUZZ.all);
      }
      const view: View = {
        seat: seatNow,
        alpha,
        now: at,
        selected,
        sendAll: Boolean(drag && !drag.decoy && (drag.shift || drag.held)),
        drag: null,
        hold: drag?.moved && drag.target !== null ? Math.min((at - drag.restAt) / HOLD_ALL_MS, 1) : 0,
        ...feel,
        threat: null,
      };
      if (live) {
        // Worked out once a tick: the columns do not change between.
        if (threatTick !== game.shown.tick) {
          threatTick = game.shown.tick;
          const threats = threatsOf(game.map, game.shown, seatNow);
          threat = { threats, siege: siegeOf(game.map, game.shown, seatNow, threats), beatAt: threat?.beatAt ?? -Infinity, still };
        }
        if (threat?.siege) {
          const beat = siegeBeat(threat.siege.secs);
          if (at - threat.beatAt >= beat.gapMs) {
            threat.beatAt = at;
            if (at - siegeBuzzAt >= SIEGE_BUZZ_MS) {
              siegeBuzzAt = at;
              buzz(BUZZ.siege);
            }
          }
        }
        view.threat = threat;
      }
      if (drag) {
        // Until it has moved, a press is aimed at its own hut: that rings the hut on the
        // very next frame and draws no arrow.
        view.drag = { sources: drag.sources, x: drag.x, y: drag.y, target: drag.moved ? drag.target : drag.sources[0], risky: drag.risky, finger: drag.finger };
      }
      drawScene(canvas, game.scene, game.shown, view);
      let cursor = 'default';
      if (drag) cursor = 'grabbing';
      else if (live && hover && drafting(game.map, tickNow + 1)) cursor = hutNear(game, hover) === null ? 'default' : 'pointer';
      else if (armed === 'call') cursor = 'crosshair';
      else if (live && hover && tokenAt(game, hover)) cursor = 'pointer';
      else if (live && hover && mine(hutNear(game, hover))) cursor = 'grab';
      if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    };

    void poll();
    frameId = requestAnimationFrame(frame);
    const pumpTimer = window.setInterval(pump, BACKGROUND_PUMP_MS);
    document.addEventListener('visibilitychange', wake);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', wake);
      window.clearTimeout(pollTimer);
      window.clearInterval(pumpTimer);
      cancelAnimationFrame(frameId);
      unwatch?.();
      unfollow?.();
      controlsRef.current = null;
    };
  }, [code, solo, sessionId, userName, clock]);

  // Leaving is done here and not in an effect's cleanup: StrictMode runs
  // cleanups on mount, which would give the seat up the moment it was taken.
  const handleClose = useCallback(() => {
    if (code && mySeat) {
      rememberRoom(null);
      // 0 leaves the tick to the room: the seat's own promise there is the one the other clients have run to.
      vacateSeat(code, mySeat, 0).catch((err) => console.warn('[Swarm] Could not leave the room:', err));
    }
    onClose();
  }, [code, mySeat, onClose]);

  const playing = match?.status === 'playing';

  // Back to the start screen, which is Swarm's menu: the seat is given up as
  // on closing, but the popup stays open. In a game this is asked first (see leaveWarning).
  const toMenu = useCallback(() => {
    if (code && mySeat) {
      rememberRoom(null);
      vacateSeat(code, mySeat, 0).catch((err) => console.warn('[Swarm] Could not leave the room:', err));
    }
    if (document.fullscreenElement) void document.exitFullscreen();
    setFull(false);
    setLeaving(false);
    setTuning(false);
    setCode(null);
    setSolo(false);
    setMatch(null);
    setHud(HUD_IDLE);
    setError('');
  }, [code, mySeat]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSearchOpenRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // During a game Escape puts down whatever is in hand. It only closes the
      // popup outside one: a stray Escape in a game would forfeit it.
      if (playing) controlsRef.current?.key(e);
      else if (e.type === 'keydown' && e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
    };
  }, [playing, handleClose]);

  // --- Popup position and dragging ---
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Esc and the browser's own button leave full screen without asking the game.
  useEffect(() => {
    const left = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    document.addEventListener('fullscreenchange', left);
    return () => document.removeEventListener('fullscreenchange', left);
  }, []);
  const [position, setPosition] = useState(() => ({
    x: Math.max(8, (window.innerWidth - 400) / 2),
    y: Math.max(8, (window.innerHeight - 760) / 2),
  }));
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // The popup widens for the board, and the window can narrow under it (a
  // phone turned on its side): centre it again instead of leaving it off the edge.
  useLayoutEffect(() => {
    const centre = () => {
      const width = popupRef.current?.offsetWidth;
      if (width) setPosition((p) => ({ x: Math.max(8, (window.innerWidth - width) / 2), y: p.y }));
    };
    centre();
    window.addEventListener('resize', centre);
    return () => window.removeEventListener('resize', centre);
  }, [wide]);

  const handleDragMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const popup = popupRef.current;
    if (!drag || !popup) return;
    // Keep a strip of the popup on screen to grab it back by.
    setPosition({
      x: Math.min(Math.max(e.clientX - drag.dx, 80 - popup.offsetWidth), window.innerWidth - 80),
      y: Math.min(Math.max(e.clientY - drag.dy, 0), window.innerHeight - 40),
    });
  };

  const handleCopyLink = () => {
    const url = new URL(window.location.href);
    url.searchParams.set('swarm', code ?? '');
    const failed = () => setError('Could not copy the link. Share the code instead.');
    // Absent outside a secure context.
    if (!navigator.clipboard) return failed();
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }, failed);
  };

  const handleStart = () => {
    setTuning(false);
    if (solo) return startSolo();
    const now = clock.now();
    if (!code || now === null) return;
    startMatch(code, now, mapPick, sizePick).catch((err: Error) => setError(err.message));
  };

  const pickMap = (id: MapId | null) => {
    setMapPick(id);
    // A size picked for one map is not carried to the next: each is drawn for its own.
    setSizePick(null);
  };

  const pickKind = (value: string) => {
    const kind = KINDS.find((each) => each === value);
    if (code && kind) setKind(code, sessionId, kind).catch((err: Error) => setError(err.message));
  };

  // The rules and the settings are written together, each kept as the room has it when the other changes.
  const pickRules = (choice: RulesChoice, tune: Tune) => {
    if (code) setRules(code, sessionId, { mode: choice.mode, start: choice.start, twists: twistLetters(choice.twists), tune: encodeTune(tune) }).catch((err: Error) => setError(err.message));
  };

  const pickNest = (value: string) => {
    const nest = NEST_IDS.find((each) => each === value);
    if (code && nest) setNest(code, sessionId, nest).catch((err: Error) => setError(err.message));
  };

  const raiseFlag = useCallback(() => controlsRef.current?.flag(), []);

  const toggleComputer = (seat: Seat, on: boolean) => {
    if (code) setComputer(code, seat, on).catch((err: Error) => setError(err.message));
  };

  const sides = match ? sidesOf(match) : [];
  const kinds = match ? kindsOf(match, sides) : null;
  // Who plays with whom, read from the match the way the game reads it from its map.
  const teams = match ? { sides, rules: rulesOf(match) } : null;
  const isAlly = (seat: Seat) => Boolean(teams && mySeat && seat !== mySeat && allied(teams, seat, mySeat));

  // A side with no person in it is one the computer plays.
  const nameOf = (seat: Seat) => {
    const player = match?.players[seat];
    if (!player) return 'Computer';
    if (seat === mySeat) return `${player.name} (you)`;
    return match?.out?.[seat] === undefined ? player.name : `Computer for ${player.name}`;
  };

  const resultLines = (): string[] => {
    if (!match?.winner || !kinds) return [];
    if (match.gone) return [match.gone === mySeat ? 'You left the game' : `${match.players[match.gone]?.name} left the game`];
    const how = hud.overtime ? ' in overtime' : hud.secs === 0 ? ' on the clock' : '';
    const winner = match.winner;
    const team = winner === 'draw' || !teams ? [] : sides.filter((side) => allied(teams, side, winner)).sort((p, q) => Number(q === mySeat) - Number(p === mySeat));
    const called = (seat: Seat, k: number) =>
      seat === mySeat ? 'You' : match.players[seat] ? nameOf(seat) : `${k === 0 ? 'The' : 'the'} computer's ${KIND_NAME[kinds[seat]].many.toLowerCase()}`;
    let first: string;
    if (winner === 'draw') first = `A draw: level on huts and units${how}`;
    else if (hud.survival && teams?.rules.computer?.includes(winner)) first = `You lasted ${Math.floor(hud.survival.lasted / 60)}:${String(hud.survival.lasted % 60).padStart(2, '0')}, ${hud.survival.waves === 1 ? 'one wave' : `${hud.survival.waves} waves`}`;
    else if (team.length > 1) first = `${team.slice(0, -1).map(called).join(', ')} and ${called(team[team.length - 1], team.length - 1)} won${how}`;
    else if (winner === mySeat) first = `You won${how}`;
    else if (!match.players[winner]) first = `The computer's ${KIND_NAME[kinds[winner]].many.toLowerCase()} won${how}`;
    else first = `${nameOf(winner)} won${how}`;
    const yielded = hud.yielded.map((seat) => (seat === mySeat ? 'You raised the white flag' : `${KIND_NAME[kinds[seat]].many} raised the white flag`));
    const left = SEATS.filter((seat) => match.out?.[seat] !== undefined).map((seat) =>
      seat === mySeat ? 'You left; the computer took over' : `${match.players[seat]?.name} left; the computer took over`
    );
    return [first, ...yielded, ...hud.story, ...left];
  };

  const tally = (seat: Seat) => {
    const count = hud.counts[seat];
    if (!count || !kinds) return '';
    const { many, one } = KIND_NAME[kinds[seat]];
    return `${count.huts} ${count.huts === 1 ? 'hut' : 'huts'}, ${count.units ?? '?'} ${count.units === 1 ? one : many.toLowerCase()}`;
  };

  const sideTag = (seat: Seat, end: boolean) => {
    const parts = [
      <span key="dot" className={styles.dot} style={{ background: BADGE[seat].fill }} />,
      <span key="name" className={styles.sideName}>{isAlly(seat) ? `${nameOf(seat)} (ally)` : nameOf(seat)}</span>,
      <span key="count" className={styles.sideCount}>{tally(seat)}</span>,
    ];
    return (
      <span key={seat} className={styles.side}>
        {end ? parts.reverse() : parts}
      </span>
    );
  };
  const column = (where: 'left' | 'middle' | 'right') =>
    sides
      .flatMap((seat) => {
        const start = hud.starts[seat];
        return start && columnOf(start) === where ? [{ seat, y: start.y }] : [];
      })
      .sort((p, q) => p.y - q.y)
      .map(({ seat }) => sideTag(seat, where === 'right'));

  // The popup fills the window either way; where the browser can also drop its
  // own bars for one element (an iPhone cannot), it is asked to.
  const toggleFull = () => {
    const popup = popupRef.current!;
    if (full) {
      if (document.fullscreenElement) void document.exitFullscreen();
      setFull(false);
      return;
    }
    setFull(true);
    // A browser that refuses keeps its bars and nothing else: the board has the window already.
    if (popup.requestFullscreen) popup.requestFullscreen().catch(() => {}); // slop-check-ignore: a refusal changes nothing, the board already fills the window
  };

  // Whoever left the last game partway through, and has not come back, is not in the next (see startMatch).
  const nextSides = match ? SEATS.filter((seat) => match.cpu?.includes(seat) || (match.players[seat] && match.out?.[seat] === undefined)) : [];
  // A guest in the lobby sees the host's rules; against the computer they are this client's own.
  const rules = code && match ? rulesOf(match) : rulesPick;
  const host = match ? hostOf(match) : undefined;
  // Like the rules: a room's are on its match, and against the computer they are this client's own.
  const tune = match ? rulesOf(match).tune : tunePick;
  const tuned = tuneSummary(tune);
  const warning = leaveWarning(playing, solo, sides.length);
  const pressMenu = () => (warning ? setLeaving(true) : toMenu());
  const computerSides = nextSides.filter((seat) => match?.cpu?.includes(seat)).length;
  const unfitFor = (mode: ModeId) => (code ? unfit(mode, nextSides.length - computerSides, computerSides) : unfit(mode, 1, computers));
  const unfitReason = unfitFor(rules.mode);
  // A room draws from its own seed; against the computer, from one drawn when the lobby opened.
  const surprise = { seed: code && match ? match.seed : lobbySeed, fits: (mode: ModeId) => unfitFor(mode) === null };
  const canStart = !unfitReason && (solo || (nextSides.length >= 2 && synced));
  const myStart = mySeat ? hud.starts[mySeat] : undefined;
  return (
    <div
      ref={popupRef}
      className={`${styles.popup} ${wide ? '' : styles.popupCompact} ${full && wide ? styles.popupFull : ''}`}
      style={full && wide ? undefined : { left: position.x, top: position.y }}
      // With no title bar, the popup is moved by any part of it that is not a control or the board.
      onPointerDown={(e) => {
        if (full || (e.target as HTMLElement).closest('button, input, select, label, canvas')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { dx: e.clientX - position.x, dy: e.clientY - position.y };
      }}
      onPointerMove={handleDragMove}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
    >
      {(code || solo) && (
        <div className={`${styles.corner} ${styles.cornerStart} ${playing ? styles.cornerQuiet : ''}`}>
          <button className={`${styles.cornerBtn} ${styles.cornerMenu}`} onClick={pressMenu} title="Back to the Swarm menu">
            Menu
          </button>
        </div>
      )}
      <div className={`${styles.corner} ${playing ? styles.cornerQuiet : ''}`}>
        {wide && (
          <button
            className={styles.cornerBtn}
            onClick={toggleFull}
            aria-label={full ? 'Leave full screen' : 'Full screen'}
            title={full ? 'Leave full screen' : 'Full screen'}
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path
                d={full ? 'M5 1.5V5H1.5M9 1.5V5h3.5M5 12.5V9H1.5M9 12.5V9h3.5' : 'M1.5 5V1.5H5M12.5 5V1.5H9M1.5 9v3.5H5M12.5 9v3.5H9'}
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
        <button className={styles.cornerBtn} onClick={handleClose} aria-label="Close Swarm" title="Close">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {!wide && <span className={styles.name}>Swarm</span>}

      {!code && !solo && (
        <div className={styles.lobby}>
          <button className={styles.primaryBtn} onClick={handleCreate} disabled={busy}>
            Create a room
          </button>
          <span className={styles.lobbyTitle}>or join one with its code</span>
          <form
            className={styles.joinRow}
            onSubmit={(e) => {
              e.preventDefault();
              join(joinCode);
            }}
          >
            <input
              className={styles.codeInput}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.slice(0, 4))}
              placeholder="CODE"
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button className={styles.secondaryBtn} type="submit" disabled={busy || joinCode.trim().length !== 4}>
              Join
            </button>
          </form>
          {!tuning && (
            <>
              <MapPicker pick={mapPick} onPick={pickMap} size={sizePick} onSize={setSizePick} sides={SEATS.slice(0, 1 + computers)} />
              <div className={styles.choiceRow} role="radiogroup" aria-label="Computer sides">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    className={`${styles.choiceBtn} ${n === computers ? styles.choiceBtnOn : ''}`}
                    role="radio"
                    aria-checked={n === computers}
                    onClick={() => setComputers(n)}
                  >
                    {n === 1 ? '1 computer' : `${n} computers`}
                  </button>
                ))}
              </div>
              <RulesPicker choice={rulesPick} onChoice={setRulesPick} idle={TWISTS_ABOUT} nest={{ pick: nestPick, onPick: setNestPick }} surprise={surprise} />
            </>
          )}
          <TunePanel tune={tunePick} onTune={setTunePick} idle={TUNE_ABOUT} open={tuning} onOpen={setTuning} />
          {unfitReason && <span className={styles.rules}>{unfitReason}</span>}
          <button className={styles.secondaryBtn} onClick={startSolo} disabled={busy || unfitReason !== null}>
            Play the computer
          </button>
          {!tuning && <span className={styles.rules}>{HOW_TO}</span>}
          {error && <span className={styles.errorText} role="alert">{error}</span>}
        </div>
      )}

      {code && match?.status === 'waiting' && (
        <div className={styles.lobby}>
          <button className={styles.codeDisplay} onClick={handleCopyLink} title="Copy the invite link">
            {code}
          </button>
          <div className={styles.seats}>
            {SEATS.map((seat) => {
              const player = match.players[seat];
              const computer = match.cpu?.includes(seat) ?? false;
              const kind = kinds && (player || computer) ? kinds[seat] : null;
              return (
                <div key={seat} className={`${styles.seat} ${player || computer ? '' : styles.seatEmpty}`}>
                  <span className={styles.dot} style={{ background: BADGE[seat].fill }} />
                  <span className={styles.seatName}>{player ? nameOf(seat) : computer ? 'Computer' : 'Open'}</span>
                  {seat === mySeat && kind ? (
                    <select className={styles.kindPick} value={kind} onChange={(e) => pickKind(e.target.value)} aria-label="Your creature">
                      {KINDS.map((each) => (
                        <option
                          key={each}
                          value={each}
                          disabled={SEATS.some((other) => other !== seat && match.players[other]?.kind === each)}
                        >
                          {KIND_NAME[each].many}
                        </option>
                      ))}
                    </select>
                  ) : (
                    kind && <span className={styles.seatKind}>{KIND_NAME[kind].many}</span>
                  )}
                  {rules.start === 'nests' && kind && (
                    seat === mySeat ? (
                      <select className={styles.kindPick} value={player?.nest ?? 'big'} onChange={(e) => pickNest(e.target.value)} aria-label="Your nest">
                        {NEST_IDS.map((each) => (
                          <option key={each} value={each}>{NEST_NAME[each]}</option>
                        ))}
                      </select>
                    ) : (
                      // The computer always starts big.
                      <span className={styles.seatKind}>{NEST_NAME[player?.nest ?? 'big']}</span>
                    )
                  )}
                  {!player && (
                    <button className={styles.seatBtn} onClick={() => toggleComputer(seat, !computer)}>
                      {computer ? 'Remove' : 'Add computer'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {!tuning && (
            <>
              <MapPicker pick={mapPick} onPick={pickMap} size={sizePick} onSize={setSizePick} sides={sides} />
              <RulesPicker
                choice={rules}
                onChoice={host === mySeat ? (choice) => pickRules(choice, tune) : undefined}
                idle={host && host !== mySeat ? `${nameOf(host)} chooses the mode, start and twists.` : TWISTS_ABOUT}
                surprise={surprise}
              />
            </>
          )}
          <TunePanel
            tune={tune}
            onTune={host === mySeat ? (next) => pickRules(rules, next) : undefined}
            idle={host && host !== mySeat ? `${nameOf(host)} sets these.` : TUNE_ABOUT}
            open={tuning}
            onOpen={setTuning}
          />
          {unfitReason && <span className={styles.rules}>{unfitReason}</span>}
          <div className={styles.buttonRow}>
            <button className={styles.secondaryBtn} onClick={handleCopyLink}>
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <button className={styles.primaryBtn} onClick={handleStart} disabled={!canStart}>
              Start game
            </button>
          </div>
          {!tuning && <span className={styles.rules}>{HOW_TO}</span>}
          {error && <span className={styles.errorText} role="alert">{error}</span>}
        </div>
      )}

      {match && match.status !== 'waiting' && (
        <>
          <div className={styles.scoreboard}>
            <span className={styles.sideCol}>{column('left')}</span>
            <span className={styles.middle}>
              {hud.draft !== null && <span className={styles.clock}>Pick your nest: {hud.draft}s</span>}
              {hud.secs !== null && hud.draft === null && (
                <span
                  className={`${styles.clock} ${hud.secs <= 60 ? styles.clockLate : ''} ${hud.secs <= LAST_SECS && hud.secs > 0 && playing ? styles.clockLast : ''}`}
                >
                  {hud.overtime && 'Overtime '}
                  {clockOf((hud.secs * 1000) / TICK_MS)}
                </span>
              )}
              {hud.survival && (
                <span className={styles.wave}>
                  {hud.survival.next === null
                    ? `Wave ${hud.survival.waves}`
                    : `${hud.survival.waves === 0 ? 'Next wave' : `Wave ${hud.survival.waves}. Next`} in ${hud.survival.next}s, ${WAVE_UNITS * (hud.survival.waves + 1)} a hut`}
                </span>
              )}
              {hud.notes.map((note) => (
                <span key={note.label} className={styles.modeNote}>
                  {note.label}
                  {note.sides.map(({ seat, text }) => (
                    <span key={seat} className={styles.modeSide}>
                      <span className={styles.dot} style={{ background: BADGE[seat].fill }} />
                      {text}
                    </span>
                  ))}
                </span>
              ))}
              {hud.flood === 'over' && <span className={styles.flood}>Flood over</span>}
              {typeof hud.flood === 'number' && (
                <span className={styles.flood}>
                  Flood in {Math.floor(hud.flood / 60)}:{String(hud.flood % 60).padStart(2, '0')}
                </span>
              )}
              {column('middle')}
            </span>
            <span className={`${styles.sideCol} ${styles.sideColEnd}`}>{column('right')}</span>
          </div>
          <div className={styles.boardWrap}>
            <canvas
              ref={canvasRef}
              className={styles.board}
              onPointerDown={(e) => controlsRef.current?.down(e)}
              onPointerMove={(e) => controlsRef.current?.move(e)}
              onPointerUp={(e) => controlsRef.current?.up(e)}
              onPointerCancel={(e) => controlsRef.current?.cancel(e)}
              onLostPointerCapture={(e) => controlsRef.current?.cancel(e)}
              onContextMenu={(e) => e.preventDefault()}
            />
            {playing && hud.count !== null && (
              <div className={styles.overlay}>
                {mySeat && kinds && myStart && (
                  <span className={styles.overlayText}>
                    You are the {KIND_NAME[kinds[mySeat]].many.toLowerCase()}, starting {whereOf(myStart)}
                  </span>
                )}
                {hud.holding && <span className={styles.overlayNote}>{hud.holding}</span>}
                {hud.draft !== null && (
                  <span className={styles.overlayNote}>
                    In the first {(DRAFT_TICKS * TICK_MS) / 1000} seconds, press any hut but a tower to start there instead. A hut goes to whoever picks it first
                  </span>
                )}
                <span className={styles.countdown}>{hud.count}</span>
              </div>
            )}
            {match.status === 'finished' && (
              <div className={`${styles.overlay} ${styles.overlayEnd}`}>
                {resultLines().map((line, index) => (
                  <span key={line} className={index === 0 ? styles.overlayText : styles.overlayNote}>
                    {line}
                  </span>
                ))}
                {unfitReason && <span className={styles.overlayNote}>{unfitReason}</span>}
                {summary && summary.game === match.game && kinds && (
                  <SwarmSummary
                    tally={summary.tally}
                    clock={summary.clock}
                    sides={sides}
                    names={{ a: KIND_NAME[kinds.a].many, b: KIND_NAME[kinds.b].many, c: KIND_NAME[kinds.c].many, d: KIND_NAME[kinds.d].many }}
                  />
                )}
                <div className={styles.buttonRow}>
                  <button className={styles.primaryBtn} onClick={handleStart} disabled={!canStart}>
                    Play again
                  </button>
                  <button className={styles.secondaryBtn} onClick={handleClose}>
                    Leave
                  </button>
                </div>
              </div>
            )}
            {leaving && warning && (
              <div className={`${styles.overlay} ${styles.overlayEnd}`} role="alertdialog" aria-label="Leave the game">
                <span className={styles.overlayText}>{warning}</span>
                <div className={styles.buttonRow}>
                  <button className={styles.secondaryBtn} onClick={() => setLeaving(false)}>
                    Keep playing
                  </button>
                  <button className={styles.primaryBtn} onClick={toMenu}>
                    Leave game
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className={styles.hud}>
            {tuned && (
              <span className={styles.hudNote} title={`Settings changed: ${tuned}`}>
                Settings changed: {tuned}
              </span>
            )}
            {hud.powers && <SwarmPowerPills pills={hud.powers} onPress={(power) => controlsRef.current?.power(power)} />}
            {hud.flag && <FlagButton onRaise={raiseFlag} />}
          </div>
          {error ? (
            <div className={styles.footer} role="alert">{error}</div>
          ) : (
            offline && code && (
              <div className={styles.footer} title="Lost contact with the game server, retrying">reconnecting…</div>
            )
          )}
        </>
      )}
    </div>
  );
}
