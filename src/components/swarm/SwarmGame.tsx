import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createServerClock } from '../../api/snakeApi';
import {
  createRoom,
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
  WORLD_W,
  advance,
  buildMap,
  cloneState,
  countOf,
  decodeOrders,
  encodeOrders,
  newState,
  otherSeat,
  sendSize,
  upgradeCost,
  type Order,
  type OrderKind,
  type Seat,
  type SwarmMap,
  type SwarmMatch,
  type SwarmState,
} from '../../swarmGameLogic';
import { TOKEN_R, addEvents, drawScene, hutAt, newScene, upgradeSpots, type Scene, type View } from './swarmRender';
import { latch, nearest, reachOf } from './swarmPick';
import styles from './SwarmGame.module.css';

const SIDE: Record<Seat, { colour: string; army: string }> = {
  a: { colour: '#8f2f1a', army: 'Ants' },
  b: { colour: '#f0b429', army: 'Bees' },
};

const POLL_LIVE_MS = 150;
const POLL_IDLE_MS = 800;
/** With no new order to send, a seat still moves its promise on this often, in ticks. */
const REPORT_EVERY = 4;
const HEARTBEAT_MS = 1000;
/**
 * How far ahead of the moment it is given an order takes effect, in ticks.
 * Long enough that it has usually reached the other client by then, so their
 * picture rarely has to be corrected.
 */
const ORDER_DELAY = 4;
/** Against the computer there is nobody to reach. */
const ORDER_DELAY_SOLO = 1;
/**
 * Short in a game, long outside one, as in Snake, but twice Snake's in a game:
 * an army keeps marching through a bad patch on a VPN, where a snake would
 * have died, so a slow connection is worth waiting out.
 */
const SILENT_LIVE_MS = 20_000;
const SILENT_IDLE_MS = 90_000;
/** rAF stops in a hidden tab; this keeps the seat reporting from there. */
const BACKGROUND_PUMP_MS = 250;
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
  unitsA: number;
  unitsB: number;
  /** A hut is in hand, with its upgrades showing. */
  picked: boolean;
}

const HUD_IDLE: Hud = { count: null, secs: 0, hutsA: 1, hutsB: 1, unitsA: 0, unitsB: 0, picked: false };

/** One game as this client holds it. */
interface Game {
  game: number;
  map: SwarmMap;
  scene: Scene;
  orders: Record<Seat, Order[]>;
  /** Run to the other seat's promise: final, and the same on both clients. */
  confirmed: SwarmState;
  /** The confirmed state run on to now on the orders known so far. */
  shown: SwarmState;
  theirText: string;
  /** The last tick this seat promised its orders complete through. */
  promised: number;
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
    };
    soloRef.current = next;
    setError('');
    setHud(HUD_IDLE);
    setMatch(next);
    setSolo(true);
  }, [sessionId, userName]);

  // An invite link (?swarm=CODE) joins straight away. The parameter is taken
  // off the URL first, so a reload or a second mount does not join again.
  useEffect(() => {
    const url = new URL(window.location.href);
    const invite = url.searchParams.get('swarm');
    if (!invite) return;
    url.searchParams.delete('swarm');
    window.history.replaceState({}, '', url.toString());
    setJoinCode(invite.toUpperCase());
    join(invite);
  }, [join]);

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
    let sentKey = '';
    let sentK = -1;
    let sentAt = 0;
    let recorded = 0;
    let oppSeq: number | undefined;
    let oppHeardAt = performance.now();
    let hudKey = '';
    let selected: number | null = null;
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
      moved: boolean;
      shift: boolean;
      /** Where and when the pointer last settled on the target, on the screen. */
      restX: number;
      restY: number;
      restAt: number;
      /** It stayed there long enough: this send takes everything. */
      held: boolean;
    } | null = null;
    // Where the mouse is, for the cursor to say what a press there would do.
    let hover: { x: number; y: number; reach: number } | null = null;
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

    const poll = async () => {
      if (!code) return;
      try {
        const next = await getRoom(code);
        if (stopped) return;
        failures = 0;
        setOffline(false);
        const seat = next && seatOf(next.m, sessionId);
        if (!next || !seat) {
          leaveRoom('That room has closed.');
          return;
        }
        room = next;
        setMatch((prev) => (JSON.stringify(prev) === JSON.stringify(next.m) ? prev : next.m));

        const mine = next.s?.[seat];
        if (mine) clock.seen(mine.seq, mine.at);
        if (clock.now() !== null) setSynced(true);

        const opp = otherSeat(seat);
        const theirs = next.s?.[opp];
        const now = performance.now();
        if (!next.m.players[opp] || theirs?.seq !== oppSeq) {
          oppSeq = theirs?.seq;
          oppHeardAt = now;
        } else if (now - oppHeardAt > (next.m.status === 'playing' ? SILENT_LIVE_MS : SILENT_IDLE_MS)) {
          oppHeardAt = now;
          vacateSeat(code, opp).catch((err) => console.warn('[Swarm] Could not release the silent seat:', err));
        }
      } catch (err) {
        if (stopped) return;
        console.warn('[Swarm] Room read failed:', err);
        if (++failures >= 3) setOffline(true);
        // Silence is only counted against the other seat while this one can hear.
        oppHeardAt = performance.now();
      }
      pollTimer = window.setTimeout(poll, room?.m.status === 'playing' ? POLL_LIVE_MS : POLL_IDLE_MS);
    };

    const report = (seat: Seat, state: { game: number; k: number; orders: string }, key: string) => {
      if (!code || putBusy) return;
      const now = performance.now();
      const urgent = key !== sentKey;
      const due = state.k - sentK >= REPORT_EVERY || now - sentAt >= HEARTBEAT_MS;
      if (!urgent && !due) return;
      const mySeq = ++seq;
      putBusy = true;
      sentKey = key;
      sentK = state.k;
      sentAt = now;
      if (game && state.game === game.game) game.promised = Math.max(game.promised, state.k);
      clock.sent(mySeq);
      putSeat(code, seat, { ...state, seq: mySeq })
        .then(
          () => clock.acked(mySeq),
          (err) => {
            console.warn('[Swarm] Report failed:', err);
            clock.failed(mySeq);
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
      const opp = otherSeat(seat);
      const now = solo ? performance.now() : clock.now();
      const playing = m.status === 'playing' && now !== null;

      // A finished game stays on the board until the next one starts.
      if (playing && game?.game !== m.game) {
        const map = buildMap(m.seed);
        const start = newState(map);
        game = {
          game: m.game,
          map,
          scene: newScene(map, m.seed),
          orders: { a: [], b: [] },
          confirmed: start,
          shown: start,
          theirText: '',
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
          addEvents(active.scene, state, state.events, performance.now());
        };
        if (solo) {
          advance(active.confirmed, active.map, active.orders, tick, opp, harvest);
          active.shown = active.confirmed;
          if (active.confirmed.winner !== null) finishSolo(active.confirmed.winner);
        } else {
          const theirs = room?.s?.[opp];
          let theirK = active.confirmed.tick;
          if (theirs && theirs.game === m.game) {
            theirK = theirs.k;
            if (theirs.orders !== active.theirText) {
              active.theirText = theirs.orders;
              active.orders[opp] = decodeOrders(theirs.orders);
            }
          }
          advance(active.confirmed, active.map, active.orders, Math.min(tick, theirK), null);
          if (active.shown.tick !== tick || active.shown.tick < active.confirmed.tick) {
            active.shown = cloneState(active.confirmed);
            advance(active.shown, active.map, active.orders, tick, null, harvest);
          }
          const winner = active.confirmed.winner;
          if (winner !== null && recorded !== m.game && code) {
            recorded = m.game;
            recordResult(code, m.game, winner).catch((err) => {
              console.warn('[Swarm] Could not record the result:', err);
              recorded = 0;
            });
          }
          const k = Math.max(active.promised, Math.min(tick, MATCH_TICKS), 0);
          report(seat, { game: m.game, k, orders: encodeOrders(active.orders[seat]) }, `${m.game}|${active.orders[seat].length}`);
        }
      } else {
        report(seat, { game: 0, k: 0, orders: '' }, 'idle');
      }

      const next: Hud = {
        count: playing && now < m.startAt ? Math.ceil((m.startAt - now) / 1000) : null,
        secs: Math.ceil(((MATCH_TICKS - Math.min(Math.max(tick, 0), MATCH_TICKS)) * TICK_MS) / 1000),
        hutsA: 1,
        hutsB: 1,
        unitsA: 0,
        unitsB: 0,
        picked: false,
      };
      if (game) {
        const a = countOf(game.shown, 'a');
        const b = countOf(game.shown, 'b');
        next.hutsA = a.huts;
        next.hutsB = b.huts;
        next.unitsA = a.units;
        next.unitsB = b.units;
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

    const issue = (kind: OrderKind, from: number, to: number) => {
      if (!game || !live) return;
      const mine = game.orders[seatNow];
      const last = mine.length > 0 ? mine[mine.length - 1].tick : 0;
      // Never at or before a tick already promised complete, and never out of order.
      const tick = Math.max(tickNow + (solo ? ORDER_DELAY_SOLO : ORDER_DELAY), game.promised + 1, last);
      mine.push({ tick, kind, from, to });
    };

    const worldOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
      const box = e.currentTarget.getBoundingClientRect();
      const scale = WORLD_W / box.width;
      const p = { x: (e.clientX - box.left) * scale, y: (e.clientY - box.top) * scale, reach: reachOf(box.width) };
      if (e.pointerType === 'mouse') hover = p;
      return p;
    };
    const mine = (hut: number | null): hut is number => hut !== null && game?.shown.huts[hut].owner === seatNow;
    // The picture of a hut first, then anything a finger's width from its site.
    const hutNear = (g: Game, p: { x: number; y: number; reach: number }) =>
      hutAt(g.map, g.shown, p.x, p.y) ?? nearest(g.map.sites, p.x, p.y, p.reach, null);
    // A token's own disc beats a hut under it; its wider reach only takes ground no hut is drawn on.
    const tokenAt = (g: Game, p: { x: number; y: number; reach: number }) => {
      const hut = selected;
      if (hut === null) return null;
      const spots = upgradeSpots(g.map, hut).flatMap((spot) => {
        const cost = upgradeCost(g.shown, hut, spot.kind);
        return cost === null ? [] : [{ ...spot, cost }];
      });
      const reach = hutAt(g.map, g.shown, p.x, p.y) === null ? Math.max(TOKEN_R + 4, p.reach) : TOKEN_R + 4;
      const spot = nearest(spots, p.x, p.y, reach, null);
      return spot === null ? null : { hut, ...spots[spot] };
    };
    const refuse = (hut: number) => {
      feel.refused = { hut, at: performance.now() };
      buzz(BUZZ.refused);
    };

    const aim = (g: Game, e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drag) return;
      const p = worldOf(e);
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
        const p = worldOf(e);
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
          moved: false,
          shift: e.shiftKey,
          restX: e.clientX,
          restY: e.clientY,
          restAt: performance.now(),
          held: false,
        };
      },
      move(e) {
        if (!game) return;
        // With nothing in hand a move is only read for where the mouse is.
        if (!drag) worldOf(e);
        else if (e.pointerId === drag.pointer) aim(game, e);
      },
      up(e) {
        const g = game;
        if (!drag || e.pointerId !== drag.pointer || !g) return;
        aim(g, e);
        const { sources, moved, target } = drag;
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
        if (!from.some((hut) => sendSize(g.shown.huts[hut], kind) > 0)) return refuse(sources[0]);
        for (const hut of from) issue(kind, hut, target);
        feel.sent = { from, at: performance.now() };
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
        view.drag = { sources: drag.sources, x: drag.x, y: drag.y, target: drag.moved ? drag.target : drag.sources[0] };
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
    return () => {
      stopped = true;
      window.clearTimeout(pollTimer);
      window.clearInterval(pumpTimer);
      cancelAnimationFrame(frameId);
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
    // Keep a strip of title bar on screen to grab it back by.
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
    startMatch(code, now).catch((err: Error) => setError(err.message));
  };

  const nameOf = (seat: Seat) => {
    const name = match?.players[seat]?.name ?? 'Nobody';
    return seat === mySeat ? `${name} (you)` : name;
  };

  const resultText = () => {
    if (!match?.winner) return '';
    if (match.gone) {
      return match.gone === mySeat ? 'You left the game' : `${match.players[match.gone]?.name} left the game`;
    }
    if (match.winner === 'draw') return 'A draw: the same huts and the same numbers on the clock';
    const how = hud.secs === 0 ? ' on the clock' : '';
    return match.winner === mySeat ? `You won${how}` : `${match.players[match.winner]?.name} won${how}`;
  };

  const tally = (seat: Seat, huts: number, units: number) =>
    `${huts} ${huts === 1 ? 'hut' : 'huts'}, ${units} ${units === 1 ? SIDE[seat].army.toLowerCase().slice(0, -1) : SIDE[seat].army.toLowerCase()}`;

  const bothSeated = Boolean(match?.players.a && match.players.b);
  const canStart = solo || (bothSeated && synced);
  return (
    <div
      ref={popupRef}
      className={`${styles.popup} ${wide ? '' : styles.popupCompact}`}
      style={{ left: position.x, top: position.y }}
    >
      <div
        className={styles.titleBar}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { dx: e.clientX - position.x, dy: e.clientY - position.y };
        }}
        onPointerMove={handleDragMove}
        onPointerUp={() => { dragRef.current = null; }}
        onPointerCancel={() => { dragRef.current = null; }}
      >
        <span className={styles.titleText}>
          Swarm
          {code && <span className={styles.titleCode}>{code}</span>}
          {offline && code && (
            <span className={styles.reconnecting} title="Lost contact with the game server, retrying">
              reconnecting…
            </span>
          )}
        </span>
        <button className={styles.closeBtn} onClick={handleClose} aria-label="Close Swarm" title="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

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
          <button className={styles.secondaryBtn} onClick={startSolo} disabled={busy}>
            Play the computer
          </button>
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
          </div>
          <div className={styles.buttonRow}>
            <button className={styles.secondaryBtn} onClick={handleCopyLink}>
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <button className={styles.primaryBtn} onClick={handleStart} disabled={!canStart}>
              Start game
            </button>
          </div>
          <span className={styles.rules}>
            Every hut you hold breeds units. Drag from one of your huts to another to send half of them
            there. They fight one for one, so a hut falls to more units than it holds. Take every hut to win.
          </span>
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
            <span className={styles.clock}>
              {Math.floor(hud.secs / 60)}:{String(hud.secs % 60).padStart(2, '0')}
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
          <div className={styles.footer}>
            {error ||
              (hud.picked
                ? 'Tap a token under the hut to grow it, or to make your whole army faster or stronger. The price comes out of this hut. Tap the ground to put the hut down.'
                : 'Drag from your hut to any other to send half of it. Rest on the target for a moment, or hold Shift, to send all of it. Sweep over more of your huts on the way to send from them too. Tap a hut to upgrade.')}
          </div>
        </>
      )}
    </div>
  );
}
