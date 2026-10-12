import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  createRoom,
  createServerClock,
  getRoom,
  joinRoom,
  putSeat,
  recordRound,
  startMatch,
  vacateSeat,
  type SnakeRoom,
} from '../../api/snakeApi';
import {
  COLS,
  COUNTDOWN_MS,
  ROUND_TICKS,
  ROWS,
  SEATS,
  START_LEN,
  STEP_MS,
  WIN_ROUNDS,
  advance,
  bodyAt,
  foodCells,
  ghostCells,
  newRoundClient,
  newSim,
  otherSeat,
  receive,
  seatStateOf,
  settleRound,
  steer,
  type Dir,
  type RoundClient,
  type Seat,
  type SnakeMatch,
} from '../../snakeGameLogic';
import styles from './SnakeGame.module.css';

const SEAT_COLOR: Record<Seat, string> = { a: '#0b74e0', b: '#c2410c' };

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 0, w: 0, W: 0,
  ArrowRight: 1, d: 1, D: 1,
  ArrowDown: 2, s: 2, S: 2,
  ArrowLeft: 3, a: 3, A: 3,
};

/** Gap between room reads. A round needs the other snake's turns promptly. */
const POLL_LIVE_MS = 60;
const POLL_IDLE_MS = 800;
const FRAME_MS = 15;
/** With nothing new to say, a moving snake still reports this often, in ticks. */
const REPORT_EVERY = 3;
const HEARTBEAT_MS = 1000;
/**
 * How long the other seat may go unheard before it is given up. Short in a
 * round, where a stalled snake stalls the result. Long outside one: a browser
 * slows a hidden tab's timers to one a minute, and a player waiting in another
 * tab for their opponent has not left.
 */
const SILENT_LIVE_MS = 10_000;
const SILENT_IDLE_MS = 90_000;
const SWIPE_PX = 18;

// Which room this tab was last in; prefills the code box.
const ROOM_KEY = 'snake-room';

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

function seatOf(match: SnakeMatch, sessionId: string): Seat | undefined {
  return SEATS.find((seat) => match.players[seat]?.sessionId === sessionId);
}

interface Hud {
  /** Seconds to the start of the round, while it is counting down. */
  count: number | null;
  /** True until tick 0: between rounds, and through the countdown. */
  pre: boolean;
  secs: number;
  lenA: number;
  lenB: number;
}

const HUD_IDLE: Hud = { count: null, pre: true, secs: 0, lenA: START_LEN, lenB: START_LEN };

function strokeSnake(ctx: CanvasRenderingContext2D, cells: number[], cell: number, color: string, dead: boolean) {
  if (cells.length === 0) return;
  const cx = (c: number) => ((c % COLS) + 0.5) * cell;
  const cy = (c: number) => (Math.floor(c / COLS) + 0.5) * cell;
  ctx.globalAlpha = dead ? 0.35 : 1;
  ctx.strokeStyle = color;
  ctx.lineWidth = cell * 0.72;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx(cells[0]), cy(cells[0]));
  // A one-cell line has no length and would not draw its caps.
  if (cells.length === 1) ctx.lineTo(cx(cells[0]) + 0.01, cy(cells[0]));
  for (let i = 1; i < cells.length; i++) ctx.lineTo(cx(cells[i]), cy(cells[i]));
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx(cells[0]), cy(cells[0]), cell * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

interface SnakeGameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

export function SnakeGame({ onClose, isSearchOpen }: SnakeGameProps) {
  let sessionId = 'anonymous';
  let userName = 'Player';
  try {
    sessionId = sessionStorage.getItem('roadmap-user-id') || 'anonymous';
    userName = sessionStorage.getItem('roadmap-user-name') || 'Player';
  } catch {
    // sessionStorage blocked (private browsing): use defaults
  }

  const [code, setCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState(recallRoom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [match, setMatch] = useState<SnakeMatch | null>(null);
  const [offline, setOffline] = useState(false);
  const [synced, setSynced] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hud, setHud] = useState<Hud>(HUD_IDLE);

  const [clock] = useState(() => createServerClock(() => performance.now()));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const steerRef = useRef<(dir: Dir) => void>(() => {});
  const isSearchOpenRef = useRef(isSearchOpen);
  isSearchOpenRef.current = isSearchOpen;

  const mySeat = match ? seatOf(match, sessionId) : undefined;
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

  // An invite link (?snake=CODE) joins straight away. The parameter is taken
  // off the URL first, so a reload or a second mount does not join again.
  useEffect(() => {
    const url = new URL(window.location.href);
    const invite = url.searchParams.get('snake');
    if (!invite) return;
    url.searchParams.delete('snake');
    window.history.replaceState({}, '', url.toString());
    setJoinCode(invite.toUpperCase());
    join(invite);
  }, [join]);

  // --- The room: reads, the simulation, reports, drawing ---
  useEffect(() => {
    if (!code) return;
    let stopped = false;
    let pollTimer = 0;
    let failures = 0;
    let room: SnakeRoom | null = null;
    let client: RoundClient | null = null;
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
    let drawn = '';
    let hudKey = '';

    const style = getComputedStyle(document.documentElement);
    const boardColor = style.getPropertyValue('--bg-secondary').trim();
    const foodColor = style.getPropertyValue('--text-primary').trim();

    const leaveRoom = (message: string) => {
      rememberRoom(null);
      setCode(null);
      setMatch(null);
      setError(message);
    };

    const poll = async () => {
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
          vacateSeat(code, opp).catch((err) => console.warn('[Snake] Could not release the silent seat:', err));
        }
      } catch (err) {
        if (stopped) return;
        console.warn('[Snake] Room read failed:', err);
        if (++failures >= 3) setOffline(true);
        // Silence is only counted against the other seat while this one can hear.
        oppHeardAt = performance.now();
      }
      pollTimer = window.setTimeout(poll, room?.m.status === 'playing' ? POLL_LIVE_MS : POLL_IDLE_MS);
    };

    const report = (seat: Seat, state: ReturnType<typeof seatStateOf>, key: string) => {
      if (putBusy) return;
      const now = performance.now();
      const urgent = key !== sentKey;
      const due = state.k - sentK >= REPORT_EVERY || now - sentAt >= HEARTBEAT_MS;
      if (!urgent && !due) return;
      const mySeq = ++seq;
      putBusy = true;
      sentKey = key;
      sentK = state.k;
      sentAt = now;
      clock.sent(mySeq);
      putSeat(code, seat, { ...state, seq: mySeq })
        .then(
          () => clock.acked(mySeq),
          (err) => {
            console.warn('[Snake] Report failed:', err);
            clock.failed(mySeq);
            sentKey = '';
          }
        )
        .finally(() => {
          putBusy = false;
        });
    };

    const draw = (canvas: HTMLCanvasElement, seat: Seat, tick: number, live: boolean) => {
      const width = Math.round(canvas.clientWidth * window.devicePixelRatio);
      if (width === 0) return;
      const key = client
        ? `${width}|${client.round}|${client.sim.k}|${client.sim.dead}|${client.hit}|${client.opp?.k}|${client.opp?.dead}|${tick}|${live}`
        : `${width}`;
      if (key === drawn) return;
      drawn = key;
      if (canvas.width !== width) {
        canvas.width = width;
        canvas.height = Math.round((width * ROWS) / COLS);
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const cell = canvas.width / COLS;
      ctx.fillStyle = boardColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (!client) return;

      if (live) {
        ctx.fillStyle = foodColor;
        for (const food of foodCells(client)) {
          ctx.beginPath();
          ctx.arc(((food % COLS) + 0.5) * cell, (Math.floor(food / COLS) + 0.5) * cell, cell * 0.26, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const opp = otherSeat(seat);
      const { sim } = client;
      // Once this client has ruled the other head into its body, that is where it stopped.
      const oppCells = client.opp ? ghostCells(client.opp, client.hit ?? tick) : bodyAt(newSim(opp), 0);
      const oppDead = client.hit !== null || (client.opp !== null && client.opp.dead !== null);
      strokeSnake(ctx, oppCells, cell, SEAT_COLOR[opp], oppDead);
      strokeSnake(ctx, bodyAt(sim, sim.k), cell, SEAT_COLOR[seat], sim.dead !== null);
    };

    const frame = () => {
      if (!room) return;
      const m = room.m;
      const seat = seatOf(m, sessionId);
      if (!seat) return;
      const opp = otherSeat(seat);
      const now = clock.now();
      const playing = m.status === 'playing' && now !== null;

      // The last round stays on the board until the next one's countdown begins.
      if (playing && client?.round !== m.round && now >= m.startAt - COUNTDOWN_MS) {
        client = newRoundClient(seat, m.seed, m.round);
      }
      const tick = playing ? Math.floor((now - m.startAt) / STEP_MS) : 0;
      const current = playing && client?.round === m.round;

      if (client && current) {
        const theirs = room.s?.[opp];
        receive(client, theirs);
        advance(client, tick);
        const state = seatStateOf(client);
        const result = settleRound(seat === 'a' ? state : theirs, seat === 'a' ? theirs : state, m.round);
        if (result && recorded !== m.round) {
          recorded = m.round;
          recordRound(code, m.round, result, now).catch((err) => {
            console.warn('[Snake] Could not record the round:', err);
            recorded = 0;
          });
        }
        // Once this snake has stopped, its rulings on the other are the only news it has.
        const still = state.k < tick ? `|${state.adj}` : '';
        report(seat, state, `${state.round}|${state.dir}|${state.dead}|${state.hit}|${state.ate}${still}`);
      } else {
        report(seat, { round: 0, k: 0, path: '', len: 0, dir: 0, adj: 0, ate: '' }, 'idle');
      }

      const pre = !playing || now < m.startAt;
      const next: Hud = {
        count: playing && pre && now >= m.startAt - COUNTDOWN_MS ? Math.ceil((m.startAt - now) / 1000) : null,
        pre,
        secs: Math.ceil(((ROUND_TICKS - Math.min(Math.max(tick, 0), ROUND_TICKS)) * STEP_MS) / 1000),
        lenA: START_LEN,
        lenB: START_LEN,
      };
      if (client) {
        const mine = client.sim.lens[client.sim.k];
        const theirs = client.opp?.len ?? START_LEN;
        next.lenA = seat === 'a' ? mine : theirs;
        next.lenB = seat === 'a' ? theirs : mine;
      }
      const nextKey = JSON.stringify(next);
      if (nextKey !== hudKey) {
        hudKey = nextKey;
        setHud(next);
      }

      steerRef.current = (dir) => {
        if (client && current) steer(client.sim, dir);
      };
      if (canvasRef.current) draw(canvasRef.current, seat, tick, Boolean(current) && tick < ROUND_TICKS);
    };

    void poll();
    const frameTimer = window.setInterval(frame, FRAME_MS);
    return () => {
      stopped = true;
      window.clearTimeout(pollTimer);
      window.clearInterval(frameTimer);
      steerRef.current = () => {};
    };
  }, [code, sessionId, clock]);

  // Leaving is done here and not in an effect's cleanup: StrictMode runs
  // cleanups on mount, which would give the seat up the moment it was taken.
  const handleClose = useCallback(() => {
    if (code && mySeat) {
      rememberRoom(null);
      vacateSeat(code, mySeat).catch((err) => console.warn('[Snake] Could not leave the room:', err));
    }
    onClose();
  }, [code, mySeat, onClose]);

  const live = match?.status === 'playing';

  useEffect(() => {
    // Capture phase, and stopped there: the roadmap underneath has its own
    // arrow-key and letter shortcuts, and a turn must not also move the page.
    const onKey = (e: KeyboardEvent) => {
      if (isSearchOpenRef.current) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      // Not during a match: a stray Escape there would forfeit it.
      if (e.key === 'Escape' && !live) {
        handleClose();
        return;
      }
      if (!live || e.metaKey || e.ctrlKey || e.altKey || !(e.key in KEY_DIR)) return;
      e.preventDefault();
      e.stopPropagation();
      steerRef.current(KEY_DIR[e.key]);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [live, handleClose]);

  const swipeFrom = useRef<{ x: number; y: number } | null>(null);
  const handleSwipeMove = (e: React.PointerEvent) => {
    const from = swipeFrom.current;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return;
    steerRef.current(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0);
    // Restart from here, so one drag can make several turns.
    swipeFrom.current = { x: e.clientX, y: e.clientY };
  };

  // --- Popup position and dragging ---
  const popupRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState(() => ({
    x: Math.max(8, (window.innerWidth - 400) / 2),
    y: Math.max(8, (window.innerHeight - 600) / 2),
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
    url.searchParams.set('snake', code ?? '');
    const failed = () => setError('Could not copy the link. Share the code instead.');
    // Absent outside a secure context.
    if (!navigator.clipboard) return failed();
    navigator.clipboard.writeText(url.toString()).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }, failed);
  };

  const handleStart = () => {
    const now = clock.now();
    if (!code || now === null) return;
    startMatch(code, now).catch((err: Error) => setError(err.message));
  };

  const nameOf = (seat: Seat) => {
    const name = match?.players[seat]?.name ?? 'Nobody';
    return seat === mySeat ? `${name} (you)` : name;
  };

  const roundText = () => {
    if (!match?.lastWinner) return null;
    if (match.lastWinner === 'draw') return 'Drawn round';
    const how = match.lastWhy === 'clock' ? ', the longer snake on the clock' : '';
    return match.lastWinner === mySeat ? `Round to you${how}` : `Round to ${match.players[match.lastWinner]?.name}${how}`;
  };

  const matchText = () => {
    if (!match?.winner) return '';
    const score = `${Math.max(match.scoreA, match.scoreB)} to ${Math.min(match.scoreA, match.scoreB)}`;
    if (match.gone) {
      return match.gone === mySeat ? 'You left the match' : `${match.players[match.gone]?.name} left the match`;
    }
    return match.winner === mySeat ? `You won, ${score}` : `${match.players[match.winner]?.name} won, ${score}`;
  };

  const bothSeated = Boolean(match?.players.a && match.players.b);

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
          Snake
          {code && <span className={styles.titleCode}>{code}</span>}
          {offline && code && (
            <span className={styles.reconnecting} title="Lost contact with the game server, retrying">
              reconnecting…
            </span>
          )}
        </span>
        <button className={styles.closeBtn} onClick={handleClose} aria-label="Close Snake" title="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {!code && (
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
                <span className={styles.dot} style={{ background: SEAT_COLOR[seat] }} />
                {match.players[seat] ? nameOf(seat) : 'Waiting for a second player'}
              </div>
            ))}
          </div>
          <div className={styles.buttonRow}>
            <button className={styles.secondaryBtn} onClick={handleCopyLink}>
              {copied ? 'Link copied' : 'Copy invite link'}
            </button>
            <button className={styles.primaryBtn} onClick={handleStart} disabled={!bothSeated || !synced}>
              Start match
            </button>
          </div>
          <span className={styles.rules}>
            Steer with the arrow keys or WASD, or swipe. The last snake alive takes the round. If the
            clock runs out, the longer snake takes it. First to {WIN_ROUNDS} rounds wins.
          </span>
          {error && <span className={styles.errorText} role="alert">{error}</span>}
        </div>
      )}

      {code && match && match.status !== 'waiting' && (
        <>
          <div className={styles.scoreboard}>
            <span className={styles.side}>
              <span className={styles.dot} style={{ background: SEAT_COLOR.a }} />
              <span className={styles.sideName}>{nameOf('a')}</span>
              <span className={styles.sideLen}>length {hud.lenA}</span>
            </span>
            <span className={styles.side}>
              <span className={styles.score}>{match.scoreA}</span>
              <span className={styles.clock}>
                {Math.floor(hud.secs / 60)}:{String(hud.secs % 60).padStart(2, '0')}
              </span>
              <span className={styles.score}>{match.scoreB}</span>
            </span>
            <span className={styles.side}>
              <span className={styles.sideLen}>length {hud.lenB}</span>
              <span className={styles.sideName}>{nameOf('b')}</span>
              <span className={styles.dot} style={{ background: SEAT_COLOR.b }} />
            </span>
          </div>
          <div className={styles.boardWrap}>
            <canvas
              ref={canvasRef}
              className={styles.board}
              onPointerDown={(e) => { swipeFrom.current = { x: e.clientX, y: e.clientY }; }}
              onPointerMove={handleSwipeMove}
              onPointerUp={() => { swipeFrom.current = null; }}
              onPointerCancel={() => { swipeFrom.current = null; }}
            />
            {match.status === 'playing' && hud.pre && (
              <div className={styles.overlay}>
                {roundText() && <span className={styles.overlayText}>{roundText()}</span>}
                {hud.count !== null && <span className={styles.countdown}>{hud.count}</span>}
              </div>
            )}
            {match.status === 'finished' && (
              <div className={`${styles.overlay} ${styles.overlayEnd}`}>
                <span className={styles.overlayText}>{matchText()}</span>
                <div className={styles.buttonRow}>
                  <button className={styles.primaryBtn} onClick={handleStart} disabled={!bothSeated || !synced}>
                    Rematch
                  </button>
                  <button className={styles.secondaryBtn} onClick={handleClose}>
                    Leave
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className={styles.footer}>
            {error || `Arrow keys or WASD to steer, or swipe on the board. First to ${WIN_ROUNDS} rounds.`}
          </div>
        </>
      )}
    </div>
  );
}
