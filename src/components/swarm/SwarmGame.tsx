import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createServerClock } from '../../api/snakeApi';
import {
  createRoom,
  followRoom,
  getRoom,
  joinRoom,
  putSeat,
  recordResult,
  seatOf,
  startMatch,
  vacateSeat,
  type SwarmRoom,
} from '../../api/swarmApi';
import {
  COUNTDOWN_MS,
  MATCH_TICKS,
  SEATS,
  TICK_MS,
  advance,
  buildMap,
  MAP_IDS,
  countOf,
  newState,
  otherSeat,
  sendSize,
  upgradeCost,
  type OrderKind,
  type Seat,
  type Side,
  type MapId,
  type SwarmMatch,
  type SwarmState,
} from '../../swarmGameLogic';
import { BADGE } from './swarmSceneKit';
import { TOKEN_R, addEvents, drawScene, drawThumb, hutAt, newScene, pathPoint, tokenGrow, upgradeSpots, watchBoard, type Scene, type View } from './swarmRender';
import { carriedOf } from './swarmAim';
import { latch, nearest, reachOf } from './swarmPick';
import { orderTick, pace, restingReport, sending, settle, silent, sound, type Ear, type Lockstep, type SeatWrite } from './swarmSync';
import styles from './SwarmGame.module.css';

const SIDE: Record<Side, { colour: string; army: string }> = {
  a: { colour: BADGE.a.fill, army: 'Ants' },
  b: { colour: BADGE.b.fill, army: 'Bees' },
  c: { colour: BADGE.c.fill, army: 'Black ants' },
};

const THIRD_ABOUT = 'The computer plays black ants from a base in the middle of the board, and fights both of you.';

/** What the lobby says of each map: its name, and the one thing that is different about it. */
const MAPS: Record<MapId, { name: string; about: string }> = {
  meadow: { name: 'Meadow', about: 'Open grass and plain roads. Nothing in the way but the other side.' },
  thorns: { name: 'Thorn Pass', about: 'A spiked short cut runs straight to the middle. One in four who take it die on the way.' },
  bridges: { name: 'Two Bridges', about: 'A river splits the map. Cross dry by a bridge, or wade the ford and lose one in four.' },
  guns: { name: 'Frozen Guns', about: 'Two lines of cannon guard the middle and fire on whoever marches at them.' },
  hill: { name: 'The Hill', about: 'A fort on high ground. The climb is slow and its defenders each take two to kill.' },
};

/** The layout each map shows in the lobby. Any seed would do; one keeps the picture still between visits. */
const THUMB_SEED = 1;

function MapThumb({ id, third }: { id: MapId; third: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    drawThumb(ref.current!, buildMap(THUMB_SEED, id, third), THUMB_SEED);
  }, [id, third]);
  return <canvas ref={ref} className={styles.mapThumb} />;
}

// Shown before a game and never during one: the board is left to itself.
const HOW_TO =
  'Every hut you hold breeds units. Drag from your hut to any other to send half of it. Rest on the target for a moment, or hold Shift, to send all of it. Sweep over more of your huts on the way to send from them too, or over spikes or a ford to take that short cut. Units fight one for one. Tap a hut to upgrade it. Take every hut to win.';

/** The shuffle tile: every map's picture in a strip, since any of them may come up. */
function ShuffleThumb({ third }: { third: boolean }) {
  return (
    <span className={`${styles.mapThumb} ${styles.shuffleThumb}`}>
      {MAP_IDS.map((id) => (
        <span key={id}>
          <MapThumb id={id} third={third} />
        </span>
      ))}
    </span>
  );
}

interface MapPickerProps {
  pick: MapId | null;
  onPick: (id: MapId | null) => void;
  third: boolean;
  onThird: (third: boolean) => void;
}

function MapPicker({ pick, onPick, third, onThird }: MapPickerProps) {
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
            {id ? <MapThumb id={id} third={third} /> : <ShuffleThumb third={third} />}
            {id ? MAPS[id].name : 'Shuffle'}
          </button>
        ))}
      </div>
      <span className={styles.rules}>{pick ? MAPS[pick].about : 'A different map each game.'}</span>
      <label className={styles.thirdToggle}>
        <input type="checkbox" checked={third} onChange={(e) => onThird(e.target.checked)} />
        Add the computer as a third side
      </label>
      {third && <span className={styles.rules}>{THIRD_ABOUT}</span>}
    </>
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
/** Milliseconds. A refusal is the only one felt as two. */
const BUZZ = { add: 8, latch: 8, done: 14, all: 20, refused: [10, 50, 10] };

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
  secs: number;
  hutsA: number;
  hutsB: number;
  hutsC: number;
  unitsA: number;
  unitsB: number;
  unitsC: number;
  /** A hut is in hand, with its upgrades showing. */
  picked: boolean;
}

const HUD_IDLE: Hud = { count: null, secs: 0, hutsA: 1, hutsB: 1, hutsC: 1, unitsA: 0, unitsB: 0, unitsC: 0, picked: false };

/** One game as this client holds it. */
interface Game extends Lockstep {
  scene: Scene;
  /** The last tick whose events reached the drawing. */
  fxTick: number;
}

interface Controls {
  down: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  move: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  up: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  cancel: (e: React.PointerEvent<HTMLCanvasElement>) => void;
  key: (e: KeyboardEvent) => void;
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
  const [thirdPick, setThirdPick] = useState(false);
  const [full, setFull] = useState(false);

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
      players: { a: { sessionId, name: userName }, b: { sessionId: 'computer', name: 'Computer' } },
      game: (soloRef.current?.game ?? 0) + 1,
      startAt: performance.now() + COUNTDOWN_MS,
      ...(mapPick && { map: mapPick }),
      ...(thirdPick && { third: true }),
    };
    soloRef.current = next;
    setError('');
    setHud(HUD_IDLE);
    setMatch(next);
    setSolo(true);
  }, [sessionId, userName, mapPick, thirdPick]);

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
    const ear: Ear = { seq: undefined, at: performance.now(), playing: false };
    let hudKey = '';
    let selected: number | null = null;
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
        leaveRoom('That room has closed.');
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

      const opp = otherSeat(seat);
      const theirs = next.s?.[opp];
      if (silent(ear, Boolean(next.m.players[opp]), theirs?.seq, next.m.status === 'playing', performance.now())) {
        vacateSeat(code, opp).catch((err) => console.warn('[Swarm] Could not release the silent seat:', err));
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
          // Silence is only counted against the other seat while this one can hear.
          ear.at = performance.now();
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

    const finishSolo = (winner: Side | 'draw') => {
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
      const opp = otherSeat(seat);
      const now = solo ? performance.now() : clock.now();
      const playing = m.status === 'playing' && now !== null;

      // A finished game stays on the board until the next one starts.
      if (playing && game?.game !== m.game) {
        const map = buildMap(m.seed, MAP_IDS.find((id) => id === m.map), m.third === true);
        const start = newState(map);
        game = {
          game: m.game,
          map,
          scene: newScene(map, m.seed),
          orders: { a: [], b: [] },
          confirmed: start,
          shown: start,
          theirText: '',
          ownSeq: undefined,
          sent: [],
          promised: 0,
          fxTick: 0,
        };
        selected = null;
        drag = null;
      }
      const current = playing && game?.game === m.game;
      const tick = current ? Math.floor((now - m.startAt) / TICK_MS) : game?.shown.tick ?? 0;
      live = Boolean(current) && tick >= 0 && game?.shown.winner === null;
      tickNow = tick;
      seatNow = seat;

      if (game && current) {
        const active = game;
        const harvest = (state: SwarmState) => {
          if (state.tick <= active.fxTick) return;
          active.fxTick = state.tick;
          addEvents(active.scene, state, state.events, performance.now(), seat);
        };
        if (solo) {
          advance(active.confirmed, active.map, active.orders, tick, opp, harvest);
          active.shown = active.confirmed;
          if (active.confirmed.winner !== null) finishSolo(active.confirmed.winner);
        } else {
          settle(active, seat, room?.s, tick, harvest);
          const winner = active.confirmed.winner;
          if (winner !== null && recorded !== m.game && code) {
            recorded = m.game;
            recordResult(code, m.game, winner).catch((err) => {
              console.warn('[Swarm] Could not record the result:', err);
              recorded = 0;
            });
          }
          const k = Math.max(active.promised, Math.min(tick, MATCH_TICKS));
          report(seat, `${m.game}|${active.orders[seat].length}`, k, (mySeq) => sending(active, seat, mySeq, tick));
        }
      } else {
        report(seat, 'rest', 0, (mySeq) => restingReport(m, room?.s?.[seat], mySeq));
      }

      const next: Hud = {
        count: playing && now < m.startAt ? Math.ceil((m.startAt - now) / 1000) : null,
        secs: Math.ceil(((MATCH_TICKS - Math.min(Math.max(tick, 0), MATCH_TICKS)) * TICK_MS) / 1000),
        hutsA: 1,
        hutsB: 1,
        hutsC: 1,
        unitsA: 0,
        unitsB: 0,
        unitsC: 0,
        picked: false,
      };
      if (game) {
        const a = countOf(game.shown, 'a');
        const b = countOf(game.shown, 'b');
        const c = countOf(game.shown, 'c');
        next.hutsA = a.huts;
        next.hutsB = b.huts;
        next.hutsC = c.huts;
        next.unitsA = a.units;
        next.unitsB = b.units;
        next.unitsC = c.units;
        // A hut lost while it was in hand is put down.
        if (selected !== null && game.shown.huts[selected].owner !== seat) selected = null;
        if (drag) drag.sources = drag.sources.filter((hut) => game?.shown.huts[hut].owner === seat);
        if (drag?.sources.length === 0) drag = null;
        next.picked = selected !== null;
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
      const spots = upgradeSpots(g.map, g.shown, hut, p.px).flatMap((spot) => {
        const cost = upgradeCost(g.shown, hut, spot.kind);
        return cost === null ? [] : [{ ...spot, cost }];
      });
      const reach = hutAt(g.map, g.shown, p.x, p.y) === null ? Math.max(disc, p.reach) : disc;
      const spot = nearest(spots, p.x, p.y, reach, null);
      return spot === null ? null : { hut, ...spots[spot] };
    };
    const refuse = (hut: number, order?: NonNullable<View['refused']>['order']) => {
      feel.refused = { hut, at: performance.now(), order };
      buzz(BUZZ.refused);
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
      if (mine(over) && !drag.sources.includes(over)) {
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
        const token = tokenAt(game, p);
        if (token) {
          // An upgrade bought a moment ago has not been paid for yet: a second tap must not spend the same units.
          let owed = 0;
          for (const order of game.orders[seatNow]) {
            if (order.tick <= game.shown.tick || order.from !== token.hut) continue;
            if (order.kind !== 'half' && order.kind !== 'all') owed += upgradeCost(game.shown, token.hut, order.kind) ?? 0;
          }
          if (sendSize(game.shown.huts[token.hut], 'all') - owed < token.cost) return refuse(token.hut);
          issue(token.kind, token.hut, token.hut);
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
        const { sources, moved, target, risky } = drag;
        const kind = drag.shift || drag.held ? 'all' : 'half';
        drag = null;
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
        }
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
      if (drag?.moved && drag.target !== null && !drag.held && at - drag.restAt >= HOLD_ALL_MS) {
        drag.held = true;
        buzz(BUZZ.all);
      }
      const view: View = {
        seat: seatNow,
        alpha,
        now: at,
        selected,
        sendAll: Boolean(drag && (drag.shift || drag.held)),
        drag: null,
        hold: drag?.moved && drag.target !== null ? Math.min((at - drag.restAt) / HOLD_ALL_MS, 1) : 0,
        ...feel,
      };
      if (drag) {
        // Until it has moved, a press is aimed at its own hut: that rings the hut on the
        // very next frame and draws no arrow.
        view.drag = { sources: drag.sources, x: drag.x, y: drag.y, target: drag.moved ? drag.target : drag.sources[0], risky: drag.risky, finger: drag.finger };
      }
      drawScene(canvas, game.scene, game.shown, view);
      let cursor = 'default';
      if (drag) cursor = 'grabbing';
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
  }, [code, solo, sessionId, clock]);

  // Leaving is done here and not in an effect's cleanup: StrictMode runs
  // cleanups on mount, which would give the seat up the moment it was taken.
  const handleClose = useCallback(() => {
    if (code && mySeat) {
      rememberRoom(null);
      vacateSeat(code, mySeat).catch((err) => console.warn('[Swarm] Could not leave the room:', err));
    }
    onClose();
  }, [code, mySeat, onClose]);

  const playing = match?.status === 'playing';

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
    if (solo) return startSolo();
    const now = clock.now();
    if (!code || now === null) return;
    startMatch(code, now, mapPick, thirdPick).catch((err: Error) => setError(err.message));
  };

  const nameOf = (side: Side) => {
    if (side === 'c') return 'Computer';
    const name = match?.players[side]?.name ?? 'Nobody';
    return side === mySeat ? `${name} (you)` : name;
  };

  const resultText = () => {
    if (!match?.winner) return '';
    if (match.gone) {
      return match.gone === mySeat ? 'You left the game' : `${match.players[match.gone]?.name} left the game`;
    }
    if (match.winner === 'draw') return 'A draw: the same huts and the same numbers on the clock';
    const how = hud.secs === 0 ? ' on the clock' : '';
    if (match.winner === 'c') return `The computer's black ants won${how}`;
    return match.winner === mySeat ? `You won${how}` : `${match.players[match.winner]?.name} won${how}`;
  };

  const tally = (seat: Side, huts: number, units: number) =>
    `${huts} ${huts === 1 ? 'hut' : 'huts'}, ${units} ${units === 1 ? SIDE[seat].army.toLowerCase().slice(0, -1) : SIDE[seat].army.toLowerCase()}`;

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

  const bothSeated = Boolean(match?.players.a && match.players.b);
  const canStart = solo || (bothSeated && synced);
  return (
    <div
      ref={popupRef}
      className={`${styles.popup} ${wide ? '' : styles.popupCompact} ${full && wide ? styles.popupFull : ''}`}
      style={full && wide ? undefined : { left: position.x, top: position.y }}
      // With no title bar, the popup is moved by any part of it that is not a control or the board.
      onPointerDown={(e) => {
        if (full || (e.target as HTMLElement).closest('button, input, label, canvas')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { dx: e.clientX - position.x, dy: e.clientY - position.y };
      }}
      onPointerMove={handleDragMove}
      onPointerUp={() => { dragRef.current = null; }}
      onPointerCancel={() => { dragRef.current = null; }}
    >
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
          <MapPicker pick={mapPick} onPick={setMapPick} third={thirdPick} onThird={setThirdPick} />
          <button className={styles.secondaryBtn} onClick={startSolo} disabled={busy}>
            Play the computer
          </button>
          <span className={styles.rules}>{HOW_TO}</span>
          {error && <span className={styles.errorText} role="alert">{error}</span>}
        </div>
      )}

      {code && match?.status === 'waiting' && (
        <div className={styles.lobby}>
          <button className={styles.codeDisplay} onClick={handleCopyLink} title="Copy the invite link">
            {code}
          </button>
          <div className={styles.seats}>
            {SEATS.map((seat) => (
              <div key={seat} className={`${styles.seat} ${match.players[seat] ? '' : styles.seatEmpty}`}>
                <span className={styles.dot} style={{ background: SIDE[seat].colour }} />
                {match.players[seat] ? `${nameOf(seat)}, ${SIDE[seat].army.toLowerCase()}` : 'Waiting for a second player'}
              </div>
            ))}
            {thirdPick && (
              <div className={styles.seat}>
                <span className={styles.dot} style={{ background: SIDE.c.colour }} />
                {`${nameOf('c')}, ${SIDE.c.army.toLowerCase()}`}
              </div>
            )}
          </div>
          <MapPicker pick={mapPick} onPick={setMapPick} third={thirdPick} onThird={setThirdPick} />
          <div className={styles.buttonRow}>
            <button className={styles.secondaryBtn} onClick={handleCopyLink}>
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <button className={styles.primaryBtn} onClick={handleStart} disabled={!canStart}>
              Start game
            </button>
          </div>
          <span className={styles.rules}>{HOW_TO}</span>
          {error && <span className={styles.errorText} role="alert">{error}</span>}
        </div>
      )}

      {match && match.status !== 'waiting' && (
        <>
          <div className={styles.scoreboard}>
            <span className={styles.side}>
              <span className={styles.dot} style={{ background: SIDE.a.colour }} />
              <span className={styles.sideName}>{nameOf('a')}</span>
              <span className={styles.sideCount}>{tally('a', hud.hutsA, hud.unitsA)}</span>
            </span>
            <span className={styles.middle}>
              <span className={styles.clock}>
                {Math.floor(hud.secs / 60)}:{String(hud.secs % 60).padStart(2, '0')}
              </span>
              {match.third && (
                <span className={styles.side}>
                  <span className={styles.dot} style={{ background: SIDE.c.colour }} />
                  <span className={styles.sideName}>{nameOf('c')}</span>
                  <span className={styles.sideCount}>{tally('c', hud.hutsC, hud.unitsC)}</span>
                </span>
              )}
            </span>
            <span className={styles.side}>
              <span className={styles.sideCount}>{tally('b', hud.hutsB, hud.unitsB)}</span>
              <span className={styles.sideName}>{nameOf('b')}</span>
              <span className={styles.dot} style={{ background: SIDE.b.colour }} />
            </span>
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
                <span className={styles.overlayText}>
                  You are the {mySeat ? SIDE[mySeat].army.toLowerCase() : ''}, starting on the {mySeat === 'a' ? 'left' : 'right'}
                </span>
                <span className={styles.countdown}>{hud.count}</span>
              </div>
            )}
            {match.status === 'finished' && (
              <div className={`${styles.overlay} ${styles.overlayEnd}`}>
                <span className={styles.overlayText}>{resultText()}</span>
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
