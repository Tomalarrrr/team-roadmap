// Ludo3 — three-player Ludo on a circular board, drawn flat. Hidden feature,
// reached by typing "ludo3" in the search palette while the vault is unlocked.
// The same game as Ludo4 with one arm taken off the board: 42 cells, three
// seats, three runs home.
//
// Networking mirrors Ludo v1/Ludo4: state lives at ludo3/{code} behind the
// VPN-safe proxy (src/api/ludo3Api.ts), polled ~1.2s; moves are optimistic with
// rollback. Classic rules only — no power-ups. Bots run client-side on
// whichever client observes a bot's turn (the makeMove turn guard dedupes
// concurrent writers).
//
// One deliberate difference from v1: there is NO pity timer. That board quietly
// swaps a stuck player's roll for a 6 after a few failed deploys, which makes 6
// the most common face over a game. Here the die is exactly uniform (see
// requestDiceRoll in ludo3Api) and the face rolled is always the face played,
// so the tallies on the seat cards are honest.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createGame,
  joinGame,
  subscribeToGame,
  makeMove,
  resetGame,
  toggleGamePause,
  addBot,
  removeBot,
  startGame,
  leaveGame,
  requestDiceRoll,
  requestYardRoll,
  getServerTimestamp,
  type Ludo3GameState,
  type Ludo3MoveUpdate,
} from '../../api/ludo3Api';
import { serializeTokens, type TokenPosition, type TurnPhase } from '../../ludoFirebase';
import {
  // A room written by an older client is shorter than TOTAL_TOKENS; pad it
  // rather than let the board index off the end of the array.
  deserializeLudo3Tokens as deserializeTokens,
  TOTAL_TOKENS,
  TRACK_SIZE,
  PLAYER_COLORS,
  START_POSITIONS,
  INITIAL_TOKENS,
  MAX_PLAYER_SCORE,
  getTokenColor,
  getPlayerScore,
  getStandings,
  colorIndex,
  initRollStats,
  deserializeRollStats,
  serializeRollStats,
  recordRoll,
  recordCapture,
  parseYardMisses,
  serializeYardMisses,
  type RollStats,
  type Ludo3Color,
} from '../../ludo3Board';
import {
  getValidMoves,
  getDistinctMoves,
  describeNoMove,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  findNextActivePlayer,
  getNextTurn,
  scoreBotMove,
  allInYard,
  YARD_MISS_LIMIT,
} from '../../ludo3GameLogic';
import { computeMovePath, getTokenCoords, ARM_ANGLE, TRACK_XY } from './ludo3Geometry';
import { Ludo3Board, type Ripple } from './Ludo3Board';
import styles from './Ludo3Game.module.css';

const TURN_SECONDS = 30;
const BACKUP_GRACE = 15;
const STEP_MS = 200;
/** A captured counter scurries home much faster than a played one walks — it is
 * an consequence being shown, not a move being made, and at walking pace a
 * capture from across the board would still be trailing home two turns later. */
const RICOCHET_MS = 70;
/** Radius of the turn ring around the die, in board %. Just inside the hub's
 * own edge (HUB.r = 12.3) so the two circles read as one instrument. */
const TIMER_RING_R = 11.2;
const TIMER_RING_C = 2 * Math.PI * TIMER_RING_R;
/** How long each human seat waits for the seat ahead of it to throw the bot's
 * die before throwing it itself (see the bot driver). Comfortably more than the
 * ~1.2s poll, so the seat behind sees the roll rather than duplicating it, and
 * comfortably less than the turn clock, so a missing client costs a beat rather
 * than a skipped turn. */
const BOT_HANDOFF_MS = 3000;

// Ludo v1's palette, kept in step with Ludo3Board's token gradients.
const COLOR_HEX: Record<Ludo3Color, string> = {
  red: '#ea4330', green: '#34a853', blue: '#4285f4',
};

// Channels of the same three seats, so the standings bars can tint themselves
// without a second hard-coded palette drifting out of step with COLOR_HEX.
const COLOR_RGB: Record<Ludo3Color, string> = {
  red: '234, 67, 48', green: '52, 168, 83', blue: '66, 133, 244',
};

const COLOR_LABELS: Record<Ludo3Color, string> = {
  red: 'Red', green: 'Green', blue: 'Blue',
};

// Standard dice pip positions on a 3×3 grid [row, col]
const DICE_PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [[1, 3], [3, 1]],
  3: [[1, 3], [2, 2], [3, 1]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [2, 1], [3, 1], [1, 3], [2, 3], [3, 3]],
};

function DiceFace({ value }: { value: number }) {
  const pips = DICE_PIPS[value] || DICE_PIPS[1];
  return (
    <div className={styles.diceFace}>
      {pips.map(([r, c], i) => (
        <span key={i} className={styles.pip} style={{ gridRow: r, gridColumn: c }} />
      ))}
    </div>
  );
}

// Which room this tab was last in. Stored rather than auto-rejoined — it
// prefills the code box and the player decides.
const ROOM_KEY = 'ludo3-room';

function rememberRoom(code: string) {
  try {
    sessionStorage.setItem(ROOM_KEY, code);
  } catch {
    // sessionStorage blocked (private browsing) — rejoin by hand
  }
}

function forgetRoom() {
  try {
    sessionStorage.removeItem(ROOM_KEY);
  } catch {
    // As above; nothing to clean up if it was never written
  }
}

function recallRoom(): string {
  try {
    return sessionStorage.getItem(ROOM_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The strongest of a set of moves, by the bot heuristic.
 *
 * Shared by the bots and by the turn timer. A player whose clock runs out gets
 * their best available move played, not a random one — being away from the
 * keyboard should cost you the choice, not the game.
 */
function pickBestMove(
  moves: { tokenIndex: number; newPosition: TokenPosition }[],
  tokens: TokenPosition[],
  color: Ludo3Color,
  playerCount: number
): { tokenIndex: number; newPosition: TokenPosition } {
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const score = scoreBotMove(move.tokenIndex, move.newPosition, tokens, color, playerCount);
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}

interface Ludo3GameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

export function Ludo3Game({ onClose, isSearchOpen }: Ludo3GameProps) {
  let sessionId = 'anonymous';
  let userName = 'Player';
  try {
    sessionId = sessionStorage.getItem('roadmap-user-id') || 'anonymous';
    userName = sessionStorage.getItem('roadmap-user-name') || 'Player';
  } catch {
    // sessionStorage blocked (private browsing) — use defaults
  }

  // --- Phase / room state ---
  const [gamePhase, setGamePhase] = useState<'lobby' | 'waiting' | 'playing'>('lobby');
  const gamePhaseRef = useRef<'lobby' | 'waiting' | 'playing'>('lobby');
  const [gameCode, setGameCode] = useState<string | null>(null);
  const gameCodeRef = useRef<string | null>(null);
  // Prefilled with the last room this tab was in, so reopening the game after
  // closing it is one click rather than a memory test.
  const [joinCode, setJoinCode] = useState(recallRoom);
  const [myColor, setMyColor] = useState<Ludo3Color | null>(null);
  const myColorRef = useRef<Ludo3Color | null>(null);
  // Read once from sessionStorage above and constant thereafter, but the
  // subscription closes over the first render — hold it in a ref so the seat
  // lookup below can't go stale.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const [playerNames, setPlayerNames] = useState<Partial<Record<Ludo3Color, string>>>({});
  // Seats are dealt at random, so "host" is a stored colour rather than red.
  // Games created before that field existed default to red.
  const [hostColor, setHostColor] = useState<Ludo3Color>('red');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [isBrowserOnline, setIsBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [gamePaused, setGamePaused] = useState(false);
  const gamePausedRef = useRef(false);
  const [isSinglePlayer, setIsSinglePlayer] = useState(false);
  const isSinglePlayerRef = useRef(false);
  const botColorsRef = useRef<Set<Ludo3Color>>(new Set());

  // --- Synced game state ---
  const [tokens, setTokens] = useState<TokenPosition[]>(() => deserializeTokens(INITIAL_TOKENS));
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const [currentTurn, setCurrentTurn] = useState<Ludo3Color>('red');
  const currentTurnRef = useRef(currentTurn);
  currentTurnRef.current = currentTurn;
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('roll');
  const turnPhaseRef = useRef(turnPhase);
  turnPhaseRef.current = turnPhase;
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const diceValueRef = useRef(diceValue);
  diceValueRef.current = diceValue;
  // The face the die keeps showing between turns (see Ludo3GameState.lastRoll)
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [consecutiveSixes, setConsecutiveSixes] = useState(0);
  const consecutiveSixesRef = useRef(consecutiveSixes);
  consecutiveSixesRef.current = consecutiveSixes;
  const [winner, setWinner] = useState<Ludo3Color | null>(null);
  const winnerRef = useRef(winner);
  winnerRef.current = winner;
  const [finishOrder, setFinishOrder] = useState<Ludo3Color[]>([]);
  const finishOrderRef = useRef(finishOrder);
  finishOrderRef.current = finishOrder;
  const [activePlayerCount, setActivePlayerCount] = useState(3);
  const activePlayerCountRef = useRef(activePlayerCount);
  activePlayerCountRef.current = activePlayerCount;
  const [rollStats, setRollStats] = useState<RollStats>(() => deserializeRollStats(initRollStats()));
  const rollStatsRef = useRef(rollStats);
  // The warm die's memory, mirrored from synced state (see requestYardRoll).
  const yardMissesRef = useRef<string>('');

  // --- Turn/interaction state ---
  const [validMoves, setValidMoves] = useState<Map<number, TokenPosition>>(new Map());
  const [isRolling, setIsRolling] = useState(false);
  const isRollingRef = useRef(false);
  const [rollingFace, setRollingFace] = useState(1);
  const [lastMovedToken, setLastMovedToken] = useState<number | null>(null);
  const [showGameOver, setShowGameOver] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const showHelpRef = useRef(showHelp);
  showHelpRef.current = showHelp;
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(TURN_SECONDS);
  const moveInFlightRef = useRef(false);
  const pendingMoveRef = useRef<{ from: string; to: string } | null>(null);
  const prevTokensRef = useRef(INITIAL_TOKENS);
  const turnStartedAtRef = useRef(0);
  const turnLocalStartRef = useRef(Date.now());
  // When this client saw the pause begin, so resuming can give back exactly the
  // time that was lost rather than a whole fresh turn.
  const localPausedAtRef = useRef<number | null>(null);

  // --- Timers ---
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const movedTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const autoMoveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gameOverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const botTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // --- Imperative token animation (ref-driven to avoid re-render storms) ---
  const tokenAnimPos = useRef(new Map<number, [number, number]>());
  const tokenAnimParity = useRef(new Map<number, number>());
  const tokenAnimTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const ripplesRef = useRef<Ripple[]>([]);
  const rippleIdRef = useRef(0);
  const rippleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [, setRenderTick] = useState(0);
  const renderTickPending = useRef(false);
  const scheduleRenderTick = useCallback(() => {
    if (renderTickPending.current) return;
    renderTickPending.current = true;
    requestAnimationFrame(() => {
      renderTickPending.current = false;
      setRenderTick(t => t + 1);
    });
  }, []);

  // --- Popup dragging ---
  const [position, setPosition] = useState(() => ({
    x: Math.max(12, (window.innerWidth - 760) / 2),
    y: Math.max(12, (window.innerHeight - 560) / 2 - 20),
  }));
  const positionRef = useRef(position);
  positionRef.current = position;
  const popupRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Keep enough of the window on screen to grab it again — it is `position:
  // fixed`, so nothing scrolls it back into view.
  const clampToViewport = useCallback((x: number, y: number) => {
    const rect = popupRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 760;
    const EDGE = 80; // a graspable strip of title bar, whichever side it leaves by
    return {
      x: Math.min(Math.max(x, EDGE - width), window.innerWidth - EDGE),
      y: Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - 40)),
    };
  }, []);

  // A window sized to yesterday's viewport can end up off today's. Re-clamp on
  // resize so shrinking the browser never strands the popup outside it.
  useEffect(() => {
    const onResize = () => setPosition(p => clampToViewport(p.x, p.y));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampToViewport]);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      clearTimeout(hintTimeoutRef.current);
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(movedTimeoutRef.current);
      clearTimeout(autoMoveRef.current);
      clearTimeout(gameOverTimerRef.current);
      clearTimeout(botTimerRef.current);
      // Live ref reads at unmount on purpose — clear whatever is outstanding now.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const t of rippleTimersRef.current) clearTimeout(t);
      // Live ref read at unmount on purpose — clear whatever is outstanding now.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const t of tokenAnimTimers.current.values()) clearTimeout(t);
      dragCleanupRef.current?.();
    };
  }, []);

  const showHint = useCallback((msg: string) => {
    setStatusHint(msg);
    clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => setStatusHint(null), 2000);
  }, []);

  /**
   * Copy, and say whether it worked.
   *
   * `navigator.clipboard` is absent outside a secure context and rejects when
   * the document isn't focused — called bare, the player pressed the code, saw
   * nothing happen, and had no idea the copy had failed rather than the button.
   */
  const copyToClipboard = useCallback((text: string, done: string) => {
    const failed = () => showHint('Could not copy — select it by hand');
    if (!navigator.clipboard) return failed();
    navigator.clipboard.writeText(text).then(() => showHint(done), failed);
  }, [showHint]);

  // --- Cell-by-cell animation stepper (ported from v1) ---
  // `stepMs` sets the pace (a played move walks, a captured counter scurries);
  // `hop` drives the parity classes that make a piece bounce cell to cell — a
  // ricocheting capture slides instead, or the 200ms hop animation would be
  // restarted every 70ms and shudder.
  const startTokenAnimation = useCallback((
    tokenIdx: number,
    rawWaypoints: [number, number][],
    stepMs = STEP_MS,
    hop = true,
  ) => {
    const existing = tokenAnimTimers.current.get(tokenIdx);
    if (existing) clearTimeout(existing);

    const waypoints = rawWaypoints.filter((wp, i) =>
      i === 0 || wp[0] !== rawWaypoints[i - 1][0] || wp[1] !== rawWaypoints[i - 1][1]
    );
    if (waypoints.length === 0) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      tokenAnimPos.current.set(tokenIdx, waypoints[waypoints.length - 1]);
      scheduleRenderTick();
      const timer = setTimeout(() => {
        tokenAnimPos.current.delete(tokenIdx);
        tokenAnimParity.current.delete(tokenIdx);
        tokenAnimTimers.current.delete(tokenIdx);
        scheduleRenderTick();
      }, 50);
      tokenAnimTimers.current.set(tokenIdx, timer);
      return;
    }

    let step = 0;
    let lastStepTime = performance.now();
    let rapidCount = 0;
    const advance = () => {
      if (step >= waypoints.length) {
        tokenAnimPos.current.delete(tokenIdx);
        tokenAnimParity.current.delete(tokenIdx);
        tokenAnimTimers.current.delete(tokenIdx);
        scheduleRenderTick();
        return;
      }
      // Backgrounded tab fires timers in a burst — skip to the final waypoint
      const now = performance.now();
      if (step > 0 && now - lastStepTime < stepMs * 0.15) {
        rapidCount++;
        if (rapidCount >= 2) {
          tokenAnimPos.current.set(tokenIdx, waypoints[waypoints.length - 1]);
          if (hop) tokenAnimParity.current.set(tokenIdx, step % 2);
          scheduleRenderTick();
          tokenAnimTimers.current.set(tokenIdx, setTimeout(() => {
            tokenAnimPos.current.delete(tokenIdx);
            tokenAnimParity.current.delete(tokenIdx);
            tokenAnimTimers.current.delete(tokenIdx);
            scheduleRenderTick();
          }, stepMs));
          return;
        }
      } else {
        rapidCount = 0;
      }
      lastStepTime = now;
      tokenAnimPos.current.set(tokenIdx, waypoints[step]);
      if (hop) tokenAnimParity.current.set(tokenIdx, step % 2);
      step++;
      scheduleRenderTick();
      tokenAnimTimers.current.set(tokenIdx, setTimeout(advance, stepMs));
    };
    advance();
  }, [scheduleRenderTick]);

  /** The way back to the yard for a captured counter: backwards round the ring
   * to its own start cell, then off onto its bay. Backwards on purpose — it
   * retraces the ground it gained, which is what being sent back means. */
  const ricochetPath = useCallback((from: TokenPosition, tokenIndex: number): [number, number][] => {
    const color = getTokenColor(tokenIndex);
    const path: [number, number][] = [];
    if (from.startsWith('track-')) {
      let cur = parseInt(from.split('-')[1]);
      const start = START_POSITIONS[color];
      while (cur !== start && path.length < TRACK_SIZE) {
        cur = cur === 1 ? TRACK_SIZE : cur - 1;
        path.push(TRACK_XY[cur]);
      }
    }
    const bay = getTokenCoords('base', tokenIndex);
    if (bay) path.push(bay);
    return path;
  }, []);

  /** A soft ring where a counter lands, in the mover's colour, timed to the
   * arrival rather than the state change. */
  const scheduleRipple = useCallback((coords: [number, number], color: Ludo3Color, delay: number) => {
    const t = setTimeout(() => {
      const ripple: Ripple = { id: rippleIdRef.current++, coords, color };
      ripplesRef.current.push(ripple);
      scheduleRenderTick();
      rippleTimersRef.current.push(setTimeout(() => {
        ripplesRef.current = ripplesRef.current.filter(r => r !== ripple);
        scheduleRenderTick();
      }, 700));
    }, delay);
    rippleTimersRef.current.push(t);
  }, [scheduleRenderTick]);

  // Animate movers, land their ripples, and send captures ricocheting home.
  const runTokenAnimations = useCallback((oldTokensStr: string, newTokensStr: string) => {
    const oldTokens = deserializeTokens(oldTokensStr);
    const parsedTokens = deserializeTokens(newTokensStr);
    const animPaths = new Map<number, [number, number][]>();

    for (let i = 0; i < TOTAL_TOKENS; i++) {
      if (oldTokens[i] !== parsedTokens[i]) {
        if (parsedTokens[i] === 'base' && oldTokens[i] !== 'base') continue; // captured
        const path = computeMovePath(oldTokens[i], parsedTokens[i], getTokenColor(i));
        if (oldTokens[i] === 'base' && path.length > 0) {
          const baseCoords = getTokenCoords('base', i);
          if (baseCoords) path.unshift(baseCoords);
        }
        if (path.length > 1) {
          animPaths.set(i, path);
          startTokenAnimation(i, path);
        }
        // Ripple where the mover comes to rest, as it comes to rest.
        const dest = path.length > 0 ? path[path.length - 1] : getTokenCoords(parsedTokens[i], i);
        if (dest) {
          scheduleRipple(dest, getTokenColor(i), Math.max(0, path.length - 1) * STEP_MS);
        }
      }
    }

    // Captured counters: their stored position is already the yard, so without
    // intervention they teleport home before the capturer even lands. Freeze
    // each one on the cell it was taken on until the capturer arrives, then
    // send it scurrying back the way it came.
    for (let i = 0; i < TOTAL_TOKENS; i++) {
      if (oldTokens[i] === parsedTokens[i]) continue;
      if (!(parsedTokens[i] === 'base' && oldTokens[i] !== 'base')) continue;
      let capturerDelay = 0;
      for (let j = 0; j < TOTAL_TOKENS; j++) {
        if (j === i) continue;
        if (parsedTokens[j] === oldTokens[i] && oldTokens[j] !== parsedTokens[j]) {
          const path = animPaths.get(j);
          if (path) capturerDelay = (path.length - 1) * STEP_MS;
          break;
        }
      }
      const from = oldTokens[i];
      const coords = getTokenCoords(from, i);
      if (!coords) continue;
      const existing = tokenAnimTimers.current.get(i);
      if (existing) clearTimeout(existing);
      tokenAnimPos.current.set(i, coords);
      scheduleRenderTick();
      // Registered in tokenAnimTimers, not a side list: if this counter is
      // redeployed before the ricochet fires, its deploy animation clears the
      // pending timer, and nothing is left holding a stale frozen position.
      tokenAnimTimers.current.set(i, setTimeout(() => {
        startTokenAnimation(i, ricochetPath(from, i), RICOCHET_MS, false);
      }, capturerDelay + 180));
    }
  }, [startTokenAnimation, scheduleRenderTick, scheduleRipple, ricochetPath]);

  // --- Dice rolling animation (rapid face cycling) ---
  useEffect(() => {
    if (!isRolling) return;
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout>;
    const step = () => {
      setRollingFace(Math.floor(Math.random() * 6) + 1);
      frame++;
      const delay = 80 + frame * 15;
      if (delay < 300) timeout = setTimeout(step, delay);
    };
    timeout = setTimeout(step, 80);
    return () => clearTimeout(timeout);
  }, [isRolling]);

  // --- Subscription ---
  useEffect(() => {
    if (!gameCode) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    subscribeToGame(gameCode, (state: Ludo3GameState | null) => {
      if (cancelled || !state) return;
      setError(prev => (prev === 'Connection lost. Please rejoin.' ? null : prev));

      // Optimistic-move reconciliation (see v1 for the full rationale)
      if (pendingMoveRef.current) {
        if (state.tokens === pendingMoveRef.current.to) {
          pendingMoveRef.current = null;
        } else if (state.tokens === pendingMoveRef.current.from) {
          return; // stale read from before our write committed
        } else {
          pendingMoveRef.current = null;
        }
      }

      const parsedTokens = deserializeTokens(state.tokens);

      if (state.tokens !== prevTokensRef.current || state.turnStartedAt !== turnStartedAtRef.current
        || state.currentTurn !== currentTurnRef.current || state.turnPhase !== turnPhaseRef.current) {
        moveInFlightRef.current = false;
        clearTimeout(autoMoveRef.current);
      }

      if (state.tokens !== prevTokensRef.current) {
        runTokenAnimations(prevTokensRef.current, state.tokens);
      }
      prevTokensRef.current = state.tokens;

      if (state.rollStats) {
        const parsed = deserializeRollStats(state.rollStats);
        setRollStats(parsed);
        rollStatsRef.current = parsed;
      }
      yardMissesRef.current = state.yardMisses ?? '';

      if (state.currentTurn !== currentTurnRef.current) {
        isRollingRef.current = false;
        setIsRolling(false);
        turnLocalStartRef.current = Date.now();
      }
      if (state.turnStartedAt !== turnStartedAtRef.current) {
        turnLocalStartRef.current = Date.now();
      }

      const tokensChanged = parsedTokens.some((t, i) => t !== tokensRef.current[i]);
      if (tokensChanged) setTokens(parsedTokens);
      if (state.currentTurn !== currentTurnRef.current) setCurrentTurn(state.currentTurn);
      if (state.turnPhase !== turnPhaseRef.current) setTurnPhase(state.turnPhase);
      const newDice = state.diceValue ?? null;
      if (newDice !== diceValueRef.current) setDiceValue(newDice);
      // Mirrored, including its absence — an omitted lastRoll keeps the stored
      // one (makeMove spreads updates), and resetGame's null must come through
      // or every other client keeps showing the previous game's last face.
      setLastRoll(state.lastRoll ?? null);
      if (state.consecutiveSixes !== consecutiveSixesRef.current) setConsecutiveSixes(state.consecutiveSixes);
      if (state.playerCount !== activePlayerCountRef.current) setActivePlayerCount(state.playerCount);
      turnStartedAtRef.current = state.turnStartedAt;

      const isPaused = !!state.paused;
      if (!gamePausedRef.current && isPaused) {
        localPausedAtRef.current = Date.now();
      }
      if (gamePausedRef.current && !isPaused) {
        // Push the turn's start forward by exactly the time spent paused, so
        // the clock resumes where it stopped — a fresh thirty seconds would
        // make pause-resume an unlimited stall anyone at the table could pull.
        turnLocalStartRef.current += Date.now() - (localPausedAtRef.current ?? Date.now());
        localPausedAtRef.current = null;
      }
      setGamePaused(isPaused);
      gamePausedRef.current = isPaused;

      if (state.singlePlayer) {
        setIsSinglePlayer(true);
        isSinglePlayerRef.current = true;
        const bots = new Set<Ludo3Color>();
        for (const color of PLAYER_COLORS) {
          const player = state.players[color];
          if (player && player.sessionId.startsWith('bot-')) bots.add(color);
        }
        botColorsRef.current = bots;
      } else {
        setIsSinglePlayer(false);
        isSinglePlayerRef.current = false;
        botColorsRef.current = new Set();
      }

      if (state.winner) {
        setWinner(state.winner);
        clearTimeout(gameOverTimerRef.current);
        gameOverTimerRef.current = setTimeout(() => setShowGameOver(true), 1200);
      } else {
        setWinner(null);
        setShowGameOver(false);
        clearTimeout(gameOverTimerRef.current);
      }

      setFinishOrder(
        state.finishOrder ? (state.finishOrder.split(',').filter(Boolean) as Ludo3Color[]) : []
      );

      const names: Partial<Record<Ludo3Color, string>> = {};
      for (const color of PLAYER_COLORS) {
        const player = state.players[color];
        if (player) names[color] = player.name;
      }
      setPlayerNames(names);
      setHostColor(state.host ?? 'red');

      // Seats are not fixed for the life of a room: startGame slides players
      // down onto the first colours so the turn rotation has no gap in it. Our
      // own colour therefore has to be read back off the state by session, not
      // remembered from whatever join handed us, or the board spins to the
      // wrong arm and every "is it my turn" test compares the wrong seat.
      for (const color of PLAYER_COLORS) {
        if (state.players[color]?.sessionId !== sessionIdRef.current) continue;
        if (myColorRef.current !== color) {
          myColorRef.current = color;
          setMyColor(color);
        }
        break;
      }

      // Recompute valid moves on reconnect into a move phase. Every counter
      // that can move is offered, duplicates included — see the note on
      // setValidMoves in handleRollDice.
      if (state.turnPhase === 'move' && state.currentTurn === myColorRef.current && state.diceValue !== null) {
        const moves = getValidMoves(parsedTokens, state.currentTurn, state.diceValue);
        setValidMoves(new Map(moves.map(m => [m.tokenIndex, m.newPosition])));
      } else {
        setValidMoves(new Map());
      }

      if (state.startedAt) {
        setActivePlayerCount(state.playerCount);
        activePlayerCountRef.current = state.playerCount;
        if (gamePhaseRef.current !== 'playing') {
          setGamePhase('playing');
          gamePhaseRef.current = 'playing';
        }
      } else if (gamePhaseRef.current === 'playing') {
        // Host reset back to waiting isn't supported; stay defensive
        setGamePhase('waiting');
        gamePhaseRef.current = 'waiting';
      }
    }, (connected: boolean) => {
      if (!cancelled) setIsConnected(connected);
    }).then(unsub => {
      if (cancelled) unsub();
      else unsubscribe = unsub;
    }).catch(err => {
      console.error('[Ludo3] Subscription failed:', err);
      setError('Connection lost. Please rejoin.');
      if (!cancelled) setIsConnected(false);
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
    // Re-subscribe only when the game code changes (see v1 rationale).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameCode]);

  // --- Auto-join from URL parameter (?ludo3=CODE) ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('ludo3');
    if (code && code.length === 4 && gamePhase === 'lobby') {
      setJoinCode(code.toUpperCase());
      setTimeout(() => {
        joinGame(code.toUpperCase(), sessionId, userName)
          .then(({ assignedColor, state }) => {
            setGameCode(code.toUpperCase());
            gameCodeRef.current = code.toUpperCase();
            setMyColor(assignedColor);
            myColorRef.current = assignedColor;
            setActivePlayerCount(state.playerCount);
            prevTokensRef.current = state.startedAt ? state.tokens : INITIAL_TOKENS;
            const phase = state.startedAt ? 'playing' : 'waiting';
            setGamePhase(phase);
            gamePhaseRef.current = phase;
            const url = new URL(window.location.href);
            url.searchParams.delete('ludo3');
            window.history.replaceState({}, '', url.toString());
          })
          .catch(() => setError('Failed to join game from link'));
      }, 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Browser online/offline ---
  useEffect(() => {
    const onOnline = () => setIsBrowserOnline(true);
    const onOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  /**
   * Believe our own committed write about whose turn it is now.
   *
   * The die is offered on `isMyTurn && turnPhase === 'roll'`, both read from
   * state that only moves when a poll comes back. So for the second or so after
   * a write that ends our turn, the client still believed it was ours and still
   * in the roll phase — and handed the player a second roll they had not earned.
   * (It showed up hardest at the start of a game, where every face but a 6
   * ends the turn with no move.) The extra roll could not
   * commit, but the dice tumbled and the turn appeared to be taken twice.
   */
  const applyTurnLocally = useCallback((nextColor: Ludo3Color, nextSixes: number) => {
    currentTurnRef.current = nextColor;
    setCurrentTurn(nextColor);
    consecutiveSixesRef.current = nextSixes;
    setConsecutiveSixes(nextSixes);
    turnPhaseRef.current = 'roll';
    setTurnPhase('roll');
    diceValueRef.current = null;
    setDiceValue(null);
    // The clock belongs to the new turn, not to the one that just ended.
    turnLocalStartRef.current = Date.now();
  }, []);

  // --- Move execution (optimistic, mirrors v1 without power-ups) ---
  const executeMove = useCallback((tokenIndex: number, newPosition: TokenPosition, roll: number) => {
    const gc = gameCodeRef.current;
    if (!gc) return;

    const currentTokens = tokensRef.current;
    const curColor = currentTurnRef.current;
    const curSixes = consecutiveSixesRef.current;
    const curFinishOrder = finishOrderRef.current;
    const curPlayerCount = activePlayerCountRef.current;

    const { newTokens, captured, reachedHome } = applyMove(currentTokens, tokenIndex, newPosition);

    const moverColor = getTokenColor(tokenIndex);
    const updatedFinishOrder = [...curFinishOrder];
    if (checkPlayerFinished(newTokens, moverColor) && !curFinishOrder.includes(moverColor)) {
      updatedFinishOrder.push(moverColor);
    }
    const finishedColors = getFinishedColors(newTokens, curPlayerCount);
    const gameWinner = updatedFinishOrder.length > 0 ? updatedFinishOrder[0] : null;

    const { nextColor, nextSixes } = getNextTurn(
      curColor, roll, curSixes, captured, reachedHome, curPlayerCount, finishedColors
    );

    if (roll === 6 && curSixes >= 2) showHint('Three 6s — no bonus turn');
    else if (captured) showHint('Captured! Bonus turn');
    else if (reachedHome) showHint('Home! Bonus turn');
    // Say which six it was. A player who has had two is one roll from losing
    // the turn outright, and nothing else on the board tracks that for them.
    else if (roll === 6 && nextColor === curColor) {
      showHint(curSixes === 1 ? 'Second 6 — one more forfeits the turn' : 'Rolled 6! Bonus turn');
    }

    setLastMovedToken(tokenIndex);
    clearTimeout(movedTimeoutRef.current);
    movedTimeoutRef.current = setTimeout(() => setLastMovedToken(null), 400);
    setValidMoves(new Map());

    let moveRollStats = rollStatsRef.current;
    if (captured) {
      moveRollStats = recordCapture(moveRollStats, colorIndex(curColor));
      rollStatsRef.current = moveRollStats;
    }

    // Any executed move writes the mover's shut-in count cold: a deploy is
    // the 6 arriving, and every other move means a counter is out, where the
    // warm die never applies.
    const coldMisses = parseYardMisses(yardMissesRef.current);
    coldMisses[colorIndex(curColor)] = 0;
    const update: Ludo3MoveUpdate = {
      tokens: serializeTokens(newTokens),
      currentTurn: gameWinner ? curColor : nextColor,
      turnPhase: 'roll',
      diceValue: null,
      // Publish the face this move was played on. When a roll has exactly one
      // legal move we play it straight from the 'roll' phase, so this update is
      // the *only* one the move produces — omit lastRoll and every other client
      // keeps showing the previous turn's face in the hub.
      lastRoll: roll,
      consecutiveSixes: nextSixes,
      winner: gameWinner,
      finishOrder: updatedFinishOrder.join(','),
      turnStartedAt: getServerTimestamp(),
      rollStats: serializeRollStats(moveRollStats),
      yardMisses: serializeYardMisses(coldMisses),
    };

    // Optimistic local apply so the token animates immediately
    const newTokensStr = update.tokens;
    const fromTokensStr = prevTokensRef.current;
    if (newTokensStr !== fromTokensStr) {
      runTokenAnimations(fromTokensStr, newTokensStr);
      prevTokensRef.current = newTokensStr;
      tokensRef.current = [...newTokens];
      setTokens([...newTokens]);
      pendingMoveRef.current = { from: fromTokensStr, to: newTokensStr };
    }

    const rollbackOptimistic = () => {
      moveInFlightRef.current = false;
      if (pendingMoveRef.current && pendingMoveRef.current.to === newTokensStr) {
        const revertStr = pendingMoveRef.current.from;
        pendingMoveRef.current = null;
        const reverted = deserializeTokens(revertStr);
        prevTokensRef.current = revertStr;
        tokensRef.current = reverted;
        setTokens(reverted);
      }
    };

    makeMove(gc, curColor, update)
      .then(committed => {
        if (!committed) return rollbackOptimistic();
        // Hand the turn on locally too, or the die stays live until the next
        // poll and the player gets a roll that is not theirs.
        applyTurnLocally(update.currentTurn, nextSixes);
        // Same reasoning for the win: the die is offered on `!winner`, so the
        // player who has just finished could otherwise roll once more while
        // waiting to be told they had won.
        if (gameWinner) {
          winnerRef.current = gameWinner;
          setWinner(gameWinner);
        }
      })
      .catch(rollbackOptimistic);
  }, [showHint, runTokenAnimations, applyTurnLocally]);
  const executeMoveRef = useRef(executeMove);
  executeMoveRef.current = executeMove;

  // --- Roll dice ---
  const handleRollDice = useCallback(async () => {
    const gc = gameCodeRef.current;
    const mc = myColorRef.current;
    if (!gc || !mc) return;
    if (gamePausedRef.current) return;
    const isBotTurn = isSinglePlayerRef.current && botColorsRef.current.has(currentTurnRef.current);
    if (!isBotTurn && currentTurnRef.current !== mc) return;
    if (turnPhaseRef.current !== 'roll') return;
    if (winnerRef.current || isRollingRef.current || moveInFlightRef.current) return;

    const activeColor = currentTurnRef.current;

    moveInFlightRef.current = true;
    isRollingRef.current = true;
    setIsRolling(true);
    const rollAnimMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 800;

    // Shut in — all five still at home — the throw comes from the warm die:
    // stone fair before the first miss, a twenty-fourth warmer for each miss
    // since (never past double), and once YARD_MISS_LIMIT misses are served
    // the throw is a given 6, so nobody waits past six of their own turns.
    // One counter out of the yard and this is the plain fair die, always.
    const shutIn = allInYard(tokensRef.current, activeColor);
    const missesBefore = parseYardMisses(yardMissesRef.current)[colorIndex(activeColor)];
    const { rolls } = shutIn
      ? await requestYardRoll(missesBefore)
      : await requestDiceRoll();

    if (currentTurnRef.current !== activeColor || turnPhaseRef.current !== 'roll' || winnerRef.current) {
      moveInFlightRef.current = false;
      isRollingRef.current = false;
      setIsRolling(false);
      return;
    }

    // The face rolled is the face played — no pity timer, no substitutions.
    // The die is exactly uniform (see requestDiceRoll) and the tallies on the
    // seat cards stay an honest record of it.
    const roll = rolls[0];

    rollTimeoutRef.current = setTimeout(async () => {
      setIsRolling(false);
      isRollingRef.current = false;

      // The die spends most of a second in the air, and the table does not stop
      // while it is up there: another client's backup skip can carry the turn
      // off this seat mid-throw. Everything below was written against
      // `currentTurnRef` read *now*, so landing that roll would have played
      // somebody else's turn with our die. Drop it instead — a lost roll costs
      // a beat, a stolen turn costs the game.
      if (currentTurnRef.current !== activeColor || turnPhaseRef.current !== 'roll' || winnerRef.current) {
        moveInFlightRef.current = false;
        return;
      }

      setDiceValue(roll);
      setLastRoll(roll);
      if (shutIn && missesBefore >= YARD_MISS_LIMIT) {
        showHint('Five misses served — this 6 is given');
      }

      const updatedRollStats = recordRoll(rollStatsRef.current, colorIndex(activeColor), roll);
      rollStatsRef.current = updatedRollStats;

      const currentTokens = tokensRef.current;
      const curColor = activeColor;
      const curSixes = consecutiveSixesRef.current;
      const curPlayerCount = activePlayerCountRef.current;
      const finishedColors = getFinishedColors(currentTokens, curPlayerCount);

      // Two different questions, and they need two different answers.
      //
      // *How many decisions is this?* — counters of a colour are
      // interchangeable, so five in the yard on a 6 is one decision offered
      // five times. Collapsed, or a forced move never takes the auto-play path
      // below and the player is made to choose between identical options.
      //
      // *Which counters may I press?* — all of them. Collapsing that too means
      // exactly one counter in the yard is live and the other four are dead to
      // the touch. They all go to the same square, so let any of them be the
      // one that goes.
      const moves = getDistinctMoves(currentTokens, curColor, roll);
      const playable = getValidMoves(currentTokens, curColor, roll);

      if (moves.length === 0) {
        let nextColor: Ludo3Color;
        let nextSixes: number;
        if (roll === 6 && curSixes < 2) {
          nextColor = curColor;
          nextSixes = curSixes + 1;
          showHint('No moves, but rolled 6!');
        } else if (roll === 6 && curSixes >= 2) {
          nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
          nextSixes = 0;
          showHint('Three 6s — no bonus turn');
        } else {
          nextColor = findNextActivePlayer(curColor, curPlayerCount, finishedColors);
          nextSixes = 0;
          // Name the face they are actually waiting for. Under the exact
          // landing rule "no moves" covers several different situations and
          // only one of them is a yard wanting a 6 — told the wrong one, a
          // player reads the dice as broken rather than the rule as tight.
          showHint(describeNoMove(currentTokens, curColor));
        }
        // A shut-in miss is counted the moment the turn resolves; any other
        // no-move turn writes the seat cold, so a player captured back to a
        // full yard later never inherits a stale count.
        const misses = parseYardMisses(yardMissesRef.current);
        misses[colorIndex(curColor)] = shutIn ? missesBefore + 1 : 0;
        const update: Ludo3MoveUpdate = {
          tokens: serializeTokens(currentTokens),
          currentTurn: nextColor,
          turnPhase: 'roll',
          diceValue: null,
          consecutiveSixes: nextSixes,
          winner: null,
          finishOrder: finishOrderRef.current.join(','),
          turnStartedAt: getServerTimestamp(),
          rollStats: serializeRollStats(updatedRollStats),
          lastRoll: roll,
          yardMisses: serializeYardMisses(misses),
        };
        // Cleared whether or not it landed: a write that aborts must not leave
        // this client unable to roll or move for the rest of the game.
        const passed = await makeMove(gc, curColor, update).catch(() => false);
        moveInFlightRef.current = false;
        // This is the path that gave away a free second roll: with everything in
        // the yard, every face but a 6 lands here.
        if (passed) applyTurnLocally(nextColor, nextSixes);
        return;
      }

      if (moves.length === 1) {
        const m = moves[0];
        const expectedColor = curColor;
        autoMoveRef.current = setTimeout(() => {
          if (currentTurnRef.current !== expectedColor) return;
          executeMoveRef.current(m.tokenIndex, m.newPosition, roll);
        }, 350); // brief beat to read the die
        return;
      }

      setValidMoves(new Map(playable.map(m => [m.tokenIndex, m.newPosition])));
      const update: Ludo3MoveUpdate = {
        tokens: serializeTokens(currentTokens),
        currentTurn: curColor,
        turnPhase: 'move',
        diceValue: roll,
        consecutiveSixes: curSixes,
        winner: null,
        finishOrder: finishOrderRef.current.join(','),
        turnStartedAt: getServerTimestamp(),
        rollStats: serializeRollStats(updatedRollStats),
        lastRoll: roll,
      };
      const committed = await makeMove(gc, curColor, update).catch(() => false);
      moveInFlightRef.current = false;
      if (committed) {
        // Believe our own write rather than waiting to be told about it: the
        // counters are already lit up and raised, and every press on one would
        // otherwise be dropped until the next poll came back.
        turnPhaseRef.current = 'move';
        setTurnPhase('move');
        diceValueRef.current = roll;
      }
    }, rollAnimMs);
  }, [showHint, applyTurnLocally]);
  const handleRollDiceRef = useRef(handleRollDice);
  handleRollDiceRef.current = handleRollDice;

  const handleMoveToken = useCallback((tokenIndex: number) => {
    const mc = myColorRef.current;
    if (!mc) return;
    if (gamePausedRef.current) return;
    const isBotTurn = isSinglePlayerRef.current && botColorsRef.current.has(currentTurnRef.current);
    if (!isBotTurn && currentTurnRef.current !== mc) return;
    if (turnPhaseRef.current !== 'move') return;
    if (winnerRef.current || moveInFlightRef.current) return;

    const dice = diceValueRef.current;
    if (dice === null) return;

    const moves = getValidMoves(tokensRef.current, currentTurnRef.current, dice);
    const move = moves.find(m => m.tokenIndex === tokenIndex);
    if (!move) return;

    clearTimeout(autoMoveRef.current);
    moveInFlightRef.current = true;
    executeMoveRef.current(move.tokenIndex, move.newPosition, dice);
  }, []);
  const handleMoveTokenRef = useRef(handleMoveToken);
  handleMoveTokenRef.current = handleMoveToken;

  // --- Keyboard shortcuts ---
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSearchOpen) {
        // Escape shuts the top layer first. Opening the rules and pressing it
        // to dismiss them should not also close the game out from under you.
        if (showHelpRef.current) setShowHelp(false);
        else onClose();
        return;
      }
      // Not while the rules are up, and not while focus is on a control that
      // wants the key itself — Space on a focused counter is that counter's.
      const onControl = document.activeElement instanceof HTMLElement
        && document.activeElement.matches('button, [role="button"], input');
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !showHelpRef.current && !onControl
        && gamePhase === 'playing' && myColorRef.current
        && !isRollingRef.current && !moveInFlightRef.current && !gamePausedRef.current
        && turnPhaseRef.current === 'roll' && currentTurnRef.current === myColorRef.current && !winnerRef.current) {
        e.preventDefault();
        handleRollDiceRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSearchOpen, gamePhase]);

  // --- Turn timer: current player auto-acts at 0s; others force-skip at -15s ---
  useEffect(() => {
    if (gamePhase !== 'playing') return;

    const tick = () => {
      if (winnerRef.current) {
        setTimeLeft(TURN_SECONDS);
        return;
      }
      if (gamePausedRef.current) return;

      const elapsed = Math.floor((Date.now() - turnLocalStartRef.current) / 1000);
      const remaining = TURN_SECONDS - elapsed;
      setTimeLeft(Math.max(0, remaining));

      const isCurrentPlayer = myColorRef.current === currentTurnRef.current;

      if (remaining <= 0 && elapsed >= 2 && isCurrentPlayer
        && !moveInFlightRef.current && !isRollingRef.current) {
        if (turnPhaseRef.current === 'roll') {
          handleRollDiceRef.current();
        } else if (turnPhaseRef.current === 'move') {
          const dice = diceValueRef.current;
          if (dice !== null) {
            const moves = getDistinctMoves(tokensRef.current, currentTurnRef.current, dice);
            if (moves.length > 0) {
              moveInFlightRef.current = true;
              const move = pickBestMove(
                moves, tokensRef.current, currentTurnRef.current, activePlayerCountRef.current
              );
              executeMoveRef.current(move.tokenIndex, move.newPosition, dice);
            }
          }
        }
      }

      // Backup: any non-current client force-skips a stalled turn
      if (remaining <= -BACKUP_GRACE && !isCurrentPlayer && myColorRef.current !== null && !moveInFlightRef.current) {
        moveInFlightRef.current = true;
        const gc = gameCodeRef.current;
        if (gc) {
          const currentTokens = tokensRef.current;
          const curColor = currentTurnRef.current;
          const finishedColors = getFinishedColors(currentTokens, activePlayerCountRef.current);
          const nextColor = findNextActivePlayer(curColor, activePlayerCountRef.current, finishedColors);
          const update: Ludo3MoveUpdate = {
            tokens: serializeTokens(currentTokens),
            currentTurn: nextColor,
            turnPhase: 'roll',
            diceValue: null,
            consecutiveSixes: 0,
            winner: null,
            finishOrder: finishOrderRef.current.join(','),
            turnStartedAt: getServerTimestamp(),
            rollStats: serializeRollStats(rollStatsRef.current),
          };
          // Released either way — an aborted write must not leave this client
          // unable to act for the rest of the game.
          makeMove(gc, curColor, update)
            .catch(() => false)
            .then(() => { moveInFlightRef.current = false; });
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gamePhase]);

  // --- Bot driver ---
  useEffect(() => {
    if (!isSinglePlayer || gamePhase !== 'playing' || winner || gamePaused) return;
    if (!botColorsRef.current.has(currentTurn)) return;

    // Who throws the bot's die: an order, not an election. Human seats take
    // the throw in board order and each waits its rank
    // out first; the guards inside the timeout see the state the seat ahead has
    // already written and stand down. Every client computes the same order from
    // the same state, so nothing needs to be agreed, and a missing client costs
    // one handoff rather than the game.
    const humanSeats = PLAYER_COLORS.slice(0, activePlayerCountRef.current)
      .filter(c => !botColorsRef.current.has(c));
    const rank = myColorRef.current ? humanSeats.indexOf(myColorRef.current) : -1;
    // Our seat has been taken over by a bot (we left, on this or another tab)
    // while this tab is still watching. Not ours to play.
    if (humanSeats.length > 0 && rank < 0) return;

    clearTimeout(botTimerRef.current);
    const botDelay = 600 + Math.random() * 400 + Math.max(0, rank) * BOT_HANDOFF_MS;

    if (turnPhase === 'roll') {
      botTimerRef.current = setTimeout(() => {
        if (currentTurnRef.current !== currentTurn || turnPhaseRef.current !== 'roll') return;
        if (moveInFlightRef.current || isRollingRef.current) return;
        handleRollDiceRef.current();
      }, botDelay);
    } else if (turnPhase === 'move') {
      botTimerRef.current = setTimeout(() => {
        if (currentTurnRef.current !== currentTurn || turnPhaseRef.current !== 'move') return;
        if (moveInFlightRef.current) return;

        const dice = diceValueRef.current;
        if (dice === null) return;
        const moves = getDistinctMoves(tokensRef.current, currentTurn, dice);
        if (moves.length === 0) {
          // Force skip to prevent deadlock
          const gc = gameCodeRef.current;
          if (gc) {
            moveInFlightRef.current = true;
            const finished = getFinishedColors(tokensRef.current, activePlayerCountRef.current);
            const curSixes = consecutiveSixesRef.current;
            const bonus = dice === 6 && curSixes < 2;
            makeMove(gc, currentTurn, {
              tokens: serializeTokens(tokensRef.current),
              currentTurn: bonus ? currentTurn : findNextActivePlayer(currentTurn, activePlayerCountRef.current, finished),
              turnPhase: 'roll',
              diceValue: null,
              consecutiveSixes: bonus ? curSixes + 1 : 0,
              winner: null,
              finishOrder: finishOrderRef.current.join(','),
              turnStartedAt: getServerTimestamp(),
              rollStats: serializeRollStats(rollStatsRef.current),
            })
              .catch(() => false)
              .then(() => { moveInFlightRef.current = false; });
          }
          return;
        }

        const best = pickBestMove(
          moves, tokensRef.current, currentTurn, activePlayerCountRef.current
        );
        handleMoveTokenRef.current(best.tokenIndex);
      }, botDelay);
    }

    return () => clearTimeout(botTimerRef.current);
    // `tokens` re-triggers after board-changing writes; `consecutiveSixes` after
    // the one write that changes nothing else — a bot that rolls a 6 with no
    // move keeps the turn, the phase and the board, so without it the bot rolled
    // once and then sat there until the turn clock skipped it.
  }, [isSinglePlayer, gamePhase, winner, gamePaused, currentTurn, turnPhase, myColor, tokens, consecutiveSixes]);

  // --- Lobby / room handlers ---
  const resetLocalGameState = useCallback(() => {
    setTokens(deserializeTokens(INITIAL_TOKENS));
    prevTokensRef.current = INITIAL_TOKENS;
    setCurrentTurn('red');
    setTurnPhase('roll');
    setDiceValue(null);
    setLastRoll(null);
    setConsecutiveSixes(0);
    setWinner(null);
    setFinishOrder([]);
    setValidMoves(new Map());
    setShowGameOver(false);
    const stats = deserializeRollStats(initRollStats());
    setRollStats(stats);
    rollStatsRef.current = stats;
  }, []);

  const handleCreateGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { code, color } = await createGame(sessionId, userName);
      resetLocalGameState();
      rememberRoom(code);
      setGameCode(code);
      gameCodeRef.current = code;
      setMyColor(color);
      myColorRef.current = color;
      setHostColor(color);
      setGamePhase('waiting');
      gamePhaseRef.current = 'waiting';
    } catch {
      setError('Failed to create game. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, userName, resetLocalGameState]);

  const handleJoinGame = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) {
      setError('Enter the 4-letter game code');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { assignedColor, state } = await joinGame(code, sessionId, userName);
      resetLocalGameState();
      rememberRoom(code);
      setGameCode(code);
      gameCodeRef.current = code;
      setMyColor(assignedColor);
      myColorRef.current = assignedColor;
      setActivePlayerCount(state.playerCount);
      prevTokensRef.current = state.startedAt ? state.tokens : INITIAL_TOKENS;
      const phase = state.startedAt ? 'playing' : 'waiting';
      setGamePhase(phase);
      gamePhaseRef.current = phase;
    } catch (err) {
      setError(err instanceof Error && err.message === 'Game is full' ? 'Game is full' : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode, sessionId, userName, resetLocalGameState]);

  const handleStartGame = useCallback(async () => {
    const gc = gameCodeRef.current;
    if (!gc) return;
    setIsLoading(true);
    try {
      await startGame(gc, sessionId);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  const handlePlayAgain = useCallback(async () => {
    const gc = gameCodeRef.current;
    if (!gc) return;
    resetLocalGameState();
    await resetGame(gc, activePlayerCountRef.current);
  }, [resetLocalGameState]);

  const handleBackToLobby = useCallback(() => {
    setGameCode(null);
    gameCodeRef.current = null;
    setMyColor(null);
    myColorRef.current = null;
    setPlayerNames({});
    setError(null);
    resetLocalGameState();
    setGamePhase('lobby');
    gamePhaseRef.current = 'lobby';
  }, [resetLocalGameState]);

  /**
   * Give up the seat properly.
   *
   * Closing the window only ever hides the game: the seat stays occupied and
   * every other player waits out a timeout on your turn, every round, for the
   * rest of the game. Telling the room lets a bot take the counters over.
   */
  const handleLeaveGame = useCallback(async () => {
    const gc = gameCodeRef.current;
    setShowHelp(false);
    if (gc) {
      forgetRoom();
      try {
        await leaveGame(gc, sessionId);
      } catch {
        // Best effort. Going back to the lobby matters more than the notice.
      }
    }
    handleBackToLobby();
  }, [sessionId, handleBackToLobby]);

  // --- Dragging ---
  const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    // The title bar carries the close and pause buttons. Without this a press
    // on either starts a drag, and the smallest wobble between press and
    // release moves the window instead of pressing the button.
    if ((e.target as HTMLElement).closest(`.${styles.closeBtn}`)) return;
    dragCleanupRef.current?.();

    const point = 'touches' in e ? e.touches[0] : e;
    dragStartRef.current = {
      mouseX: point.clientX,
      mouseY: point.clientY,
      posX: positionRef.current.x,
      posY: positionRef.current.y,
    };

    const moveTo = (clientX: number, clientY: number) => {
      const dx = clientX - dragStartRef.current.mouseX;
      const dy = clientY - dragStartRef.current.mouseY;
      setPosition(clampToViewport(
        dragStartRef.current.posX + dx,
        dragStartRef.current.posY + dy
      ));
    };
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault(); // or the drag selects the page text underneath
      moveTo(ev.clientX, ev.clientY);
    };
    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches.length !== 1) return;
      moveTo(ev.touches[0].clientX, ev.touches[0].clientY);
    };
    const onUp = () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onUp);
    dragCleanupRef.current = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onUp);
    };
  }, [clampToViewport]);

  // --- Derived display state ---
  const isMyTurn = myColor === currentTurn;
  const diceCanRoll = isMyTurn && turnPhase === 'roll' && !isRolling && !winner && !gamePaused;
  const displayName = (color: Ludo3Color) => playerNames[color] ?? COLOR_LABELS[color];
  const statusMessage = winner
    ? `${displayName(winner)} wins!`
    : isMyTurn
      ? (turnPhase === 'roll' ? 'Your turn — roll!' : 'Choose a token')
      // No trailing ellipsis: the countdown bar under this line already says
      // "in progress", and the extra character only costs truncation room.
      : `${displayName(currentTurn)}'s turn`;
  const offlineBanner = !isBrowserOnline || !isConnected;
  const isUrgent = timeLeft <= 10 && !winner && !gamePaused;
  const standings = winner ? getStandings(tokens, activePlayerCount, finishOrder) : [];
  // The compact shell sizes itself to the lobby's handful of controls, which is
  // far shorter than the rules — so while those are open the popup takes its
  // full height rather than making the panel scroll inside a stub.
  const isCompact = gamePhase !== 'playing' && !showHelp;

  // Which corner a seat's card belongs in. The plate spins so the local
  // player's arm points straight down (see Ludo3Board), which makes this fixed
  // rather than a guess: your arm is at the bottom, the other two at 120° and
  // 240° — which is to say up-left and up-right. Each card takes the corner
  // nearest its own arm, so the panel never has to say which colour is where,
  // and the fourth corner is simply left empty.
  const seatCorner = (color: Ludo3Color) => {
    const bearing = (ARM_ANGLE[color] - (myColor ? ARM_ANGLE[myColor] : 0) + 360) % 360;
    return bearing === 0 ? styles.cornerBl
      : bearing === 120 ? styles.cornerTl
      : styles.cornerTr;
  };

  return (
    <div
      ref={popupRef}
      className={`${styles.popup} ${isCompact ? styles.popupCompact : ''}`}
      style={{ left: position.x, top: position.y }}
    >
      <div className={styles.titleBar} onMouseDown={handleDragStart} onTouchStart={handleDragStart}>
        <span className={styles.titleText}>
          Ludo 3
          {gameCode && <span className={styles.titleCode}>{gameCode}</span>}
          {offlineBanner && gamePhase !== 'lobby' && (
            <span
              className={styles.reconnecting}
              title="Lost contact with the game server — retrying"
            >
              reconnecting…
            </span>
          )}
        </span>
        <span className={styles.titleButtons}>
          <button
            className={`${styles.closeBtn} ${showHelp ? styles.helpBtnActive : ''}`}
            onClick={() => setShowHelp(h => !h)}
            aria-label="How to play"
            aria-expanded={showHelp}
            title="How to play"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M6.1 6.05a2 2 0 1 1 2.6 2.2c-.5.2-.75.6-.75 1.1v.4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="7.95" cy="12" r="0.85" fill="currentColor" />
            </svg>
          </button>
          {gamePhase === 'playing' && !winner && (
            <button
              className={`${styles.closeBtn} ${gamePaused ? styles.pauseBtnActive : ''}`}
              onClick={() => gameCode && toggleGamePause(gameCode)}
              aria-label={gamePaused ? 'Resume game' : 'Pause game'}
              title={gamePaused ? 'Resume game' : 'Pause game'}
            >
              {gamePaused ? (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M5 3L13 8L5 13V3Z" fill="currentColor" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="3" y="3" width="3.5" height="10" rx="0.75" fill="currentColor" />
                  <rect x="9.5" y="3" width="3.5" height="10" rx="0.75" fill="currentColor" />
                </svg>
              )}
            </button>
          )}
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close Ludo 3">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      </div>

      {gamePaused && gamePhase === 'playing' && (
        <div
          className={styles.pauseOverlay}
          onClick={() => gameCode && toggleGamePause(gameCode)}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && gameCode) { e.preventDefault(); toggleGamePause(gameCode); } }}
          role="button"
          tabIndex={0}
          aria-label="Resume game"
        >
          <div className={styles.pauseText}>PAUSED</div>
          <div className={styles.pauseSubtext}>Tap anywhere to resume</div>
        </div>
      )}

      {/* How to play. Keep this in step with ludo3GameLogic. It is the only
          statement of the rules a player ever sees, so a rule change that skips
          it leaves the game actively teaching the wrong thing. */}
      {showHelp && (
        <div className={styles.helpOverlay}>
          <div className={styles.helpCard}>
            <div className={styles.helpTitle}>How to play</div>
            <ul className={styles.helpList}>
              <li>
                Roll a 6 to bring a counter out of your yard. While all five
                are still at home, the die warms to you: each missed 6 makes
                the next a little likelier — never more than double — and
                after five misses the sixth throw is a 6, given.
              </li>
              <li>A 6, a capture, or reaching home earns another roll — but three 6s in a row and the turn passes.</li>
              <li>Land on an opponent to send that counter back to its yard.</li>
              <li>Start spaces and starred spaces are safe. Nothing is captured there.</li>
              <li>
                Your run home has five cells and you have five counters — one for each.
                A counter must land on an empty cell <em>exactly</em>. It may pass over a
                taken one, but a roll that overshoots the end is no move at all.
              </li>
              <li>
                So a counter that cannot land waits out on the track, where it can still
                be sent back to your yard. Fill all five cells to win.
              </li>
              <li>
                The die is fair: once a counter of yours is out, every face is
                equally likely, every throw. The warm start above is the one
                exception, and the face shown is always the face played.
              </li>
            </ul>
            <div className={styles.helpKeys}>
              Space or Enter rolls. Tab to a raised counter and press Enter to move it.
            </div>
            <div className={styles.helpButtons}>
              {gameCode && (
                <button className={styles.linkBtn} onClick={handleLeaveGame}>
                  Leave game
                </button>
              )}
              <button className={styles.createBtn} onClick={() => setShowHelp(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Our own resize affordance — the browser's native grip reads as a web
          app, not a game. Purely decorative; the real handle is the corner. */}
      <svg className={styles.resizeGrip} viewBox="0 0 16 16" aria-hidden="true">
        <path
          d="M14.5 8.5L8.5 14.5M14.5 13L13 14.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>

      <div className={styles.gameArea}>
        {/* === LOBBY === */}
        {gamePhase === 'lobby' && (
          <div className={styles.lobby}>
            <div className={styles.lobbyTitle}>Three-player Ludo, on the round</div>
            <button className={styles.createBtn} onClick={handleCreateGame} disabled={isLoading}>
              {isLoading ? 'Creating…' : 'Create Game'}
            </button>
            <span className={styles.lobbyDivider}>or</span>
            <div className={styles.joinSection}>
              <input
                className={styles.codeInput}
                placeholder="CODE"
                value={joinCode}
                onChange={e => { setJoinCode(e.target.value.toUpperCase().slice(0, 4)); setError(null); }}
                maxLength={4}
                onKeyDown={e => e.key === 'Enter' && handleJoinGame()}
              />
              <button className={styles.joinBtn} onClick={handleJoinGame} disabled={isLoading}>
                {isLoading ? 'Joining…' : 'Join'}
              </button>
            </div>
            {error && <div className={styles.errorText}>{error}</div>}
          </div>
        )}

        {/* === WAITING ROOM === */}
        {gamePhase === 'waiting' && (
          <div className={styles.lobby}>
            <div
              className={styles.gameCodeDisplay}
              onClick={() => gameCode && copyToClipboard(gameCode, 'Copied!')}
              role="button"
              tabIndex={0}
              title="Click to copy"
              aria-label="Copy game code"
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && gameCode) { e.preventDefault(); copyToClipboard(gameCode, 'Copied!'); } }}
            >
              {gameCode}
            </div>
            <div className={styles.shareHint}>Tap code to copy — share with your opponents</div>
            {gameCode && (
              <button
                className={styles.linkBtn}
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('ludo3', gameCode);
                  copyToClipboard(url.toString(), 'Link copied!');
                }}
              >
                Copy Link
              </button>
            )}
            <div className={styles.playerList}>
              {PLAYER_COLORS.map(color => {
                const isMe = color === myColor;
                const player = playerNames[color];
                const isBot = player?.startsWith('Bot ');
                const isEmpty = !player;
                const isHost = myColor === hostColor;
                return (
                  <div
                    key={color}
                    className={[
                      styles.playerSlot,
                      isEmpty ? styles.playerSlotEmpty : '',
                      isEmpty && isHost ? styles.playerSlotClickable : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => { if (isEmpty && isHost && gameCode) addBot(gameCode, color, sessionId); }}
                    role={isEmpty && isHost ? 'button' : undefined}
                  >
                    <span className={styles.playerDot} style={{ background: COLOR_HEX[color] }} />
                    <span className={styles.playerSlotName}>
                      {isEmpty ? (isHost ? 'Click to add bot' : 'Empty') : displayName(color)}
                      {isMe && ' (you)'}
                    </span>
                    {isBot && isHost && (
                      <button
                        className={styles.removeBotBtn}
                        onClick={(e) => { e.stopPropagation(); if (gameCode) removeBot(gameCode, color, sessionId); }}
                        aria-label={`Remove ${COLOR_LABELS[color]} bot`}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12">
                          <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* Short-handed, the seats are not interchangeable and the game
                draws for them at kick-off (see startGame). Said here, before
                anyone commits, because a colour changing as the board appears
                with no warning reads as a bug — which is exactly what it was
                taken for. A full table keeps the colours shown above. */}
            {(() => {
              const filledCount = PLAYER_COLORS.filter(c => !!playerNames[c]).length;
              const canStart = myColor === hostColor && filledCount >= 2;
              return (
                <>
                {filledCount >= 2 && filledCount < PLAYER_COLORS.length && (
                  <div className={styles.shareHint}>
                    Short-handed, so seats are drawn when the game starts — the
                    arms are not quite even with an empty one.
                  </div>
                )}
                <button className={styles.createBtn} onClick={handleStartGame} disabled={!canStart || isLoading}>
                  {isLoading ? 'Starting…'
                    : filledCount < 2 ? 'Need 2+ players'
                    : myColor !== hostColor ? 'Waiting for host…'
                    : 'Start Game'}
                </button>
                </>
              );
            })()}
            <button className={styles.linkBtn} onClick={handleBackToLobby}>Back</button>
            {statusHint && <div className={styles.shareHint}>{statusHint}</div>}
            {error && <div className={styles.errorText}>{error}</div>}
          </div>
        )}

        {/* === PLAYING === */}
        {gamePhase === 'playing' && (
          <div className={styles.playingLayout}>
            {/* The board takes the whole area; the chrome lives in the four
                corners an inscribed circle necessarily leaves empty, and in the
                hub at its centre. Nothing here costs the board a pixel. */}
            <div className={styles.boardWrapper}>
              <Ludo3Board
                tokens={tokens}
                playerCount={activePlayerCount}
                myColor={myColor}
                activeColor={winner ? null : currentTurn}
                winner={winner}
                validMoves={validMoves}
                lastMovedToken={lastMovedToken}
                animPos={tokenAnimPos.current}
                animParity={tokenAnimParity.current}
                ripples={ripplesRef.current}
                onTokenClick={handleMoveToken}
              />

              {/* One card per seat, in the corner nearest that seat's own arm */}
              {PLAYER_COLORS.slice(0, activePlayerCount).map(color => {
                const score = getPlayerScore(tokens, color);
                const stats = rollStats[colorIndex(color)];
                const throwCount = stats.rolls.reduce((a, b) => a + b, 0);
                return (
                  <div
                    key={color}
                    className={[
                      styles.seatCard,
                      seatCorner(color),
                      currentTurn === color && !winner ? styles.seatCardActive : '',
                    ].filter(Boolean).join(' ')}
                    style={{
                      '--seat-rgb': COLOR_RGB[color],
                      '--fill': `${(score / MAX_PLAYER_SCORE) * 100}%`,
                    } as React.CSSProperties}
                  >
                    <div className={styles.seatLine}>
                      <span className={styles.playerDot} style={{ background: COLOR_HEX[color] }} />
                      {/* "You" rather than your own name plus a "(you)" suffix:
                          the suffix is the part that matters and the part that
                          got eaten first when a real name ran long. */}
                      <span className={styles.seatName} title={displayName(color)}>
                        {myColor === color ? 'You' : displayName(color)}
                      </span>
                      {/* Keyed on the score itself: React remounts it when
                          the number changes and the tick plays, and never on a
                          re-render that left it alone. */}
                      <span className={styles.seatScore}>
                        <span key={score} className={styles.seatScoreTick}>{score}</span>
                      </span>
                    </div>
                    {/* How far round the board this seat has actually got */}
                    <div className={styles.seatMeter} aria-hidden="true">
                      <span className={styles.seatMeterFill} />
                    </div>

                    {/* This seat's own roll tally. Per-card rather than one
                        shared table, so each player's luck sits next to their
                        score — and with a fair die (see ludo3Api), over a long
                        game the seven columns really do converge. */}
                    <div
                      className={styles.rollGrid}
                      role="img"
                      aria-label={`${throwCount} throws — ${stats.rolls.map((n, i) => `${i + 1}: ${n}`).join(', ')}; captures ${stats.captures}`}
                    >
                      {[1, 2, 3, 4, 5, 6].map(n => (
                        <span key={`h${n}`} className={styles.rollHead} aria-hidden="true">{n}</span>
                      ))}
                      <span className={styles.rollHead} title="Captures" aria-hidden="true">C</span>
                      {/* The denominator. Without it the six counts are read
                          against each other as though every seat had thrown the
                          same number of times — and they never have, because a
                          6 buys another roll, so the seat with the most 6s has
                          the most throws to show them in. Two players reading
                          "10 sixes" against "3 sixes" were looking at 49 throws
                          against 37. */}
                      <span className={styles.rollHead} title="Throws" aria-hidden="true">n</span>
                      {/* A middot, not a blank: an empty cell reads as a broken
                          grid, where a placeholder reads as "none yet" and keeps
                          the columns visibly lined up under their face. */}
                      {stats.rolls.map((n, i) => (
                        <span
                          key={i}
                          className={`${styles.rollVal} ${n ? '' : styles.statNil}`}
                          aria-hidden="true"
                        >
                          {n || '·'}
                        </span>
                      ))}
                      <span
                        className={`${styles.rollVal} ${stats.captures ? '' : styles.statNil}`}
                        aria-hidden="true"
                      >
                        {stats.captures || '·'}
                      </span>
                      <span
                        className={`${styles.rollVal} ${styles.rollTotal} ${throwCount ? '' : styles.statNil}`}
                        aria-hidden="true"
                      >
                        {throwCount || '·'}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* The turn clock: a thin ring around the die, draining as the
                  turn runs down. With the local player's arm at the bottom, the
                  space above the hub belongs to the other seats' wedges, so
                  everything the player reads mid-turn lives in the hub, and a
                  circular clock is the one that fits there. It is drawn in
                  whoever's turn it is; once there is a winner the ring is empty
                  anyway, so a finished game is never left wearing the last
                  seat's colour. */}
              <svg
                className={styles.timerRing}
                viewBox="0 0 100 100"
                style={{ '--turn': COLOR_HEX[currentTurn] } as React.CSSProperties}
                aria-hidden="true"
              >
                <circle className={styles.timerRingTrack} cx="50" cy="50" r={TIMER_RING_R} />
                <circle
                  className={`${styles.timerRingFill} ${isUrgent ? styles.timerRingUrgent : ''}`}
                  cx="50"
                  cy="50"
                  r={TIMER_RING_R}
                  strokeDasharray={TIMER_RING_C}
                  strokeDashoffset={TIMER_RING_C * (1 - (winner ? 0 : timeLeft / TURN_SECONDS))}
                />
              </svg>

              {/* One status voice, under the die in the hub. */}
              <div className={styles.centreStatus} title={winner ? undefined : `${timeLeft}s left on this turn`}>
                {/* Keyed on its own text so React remounts it and the fade
                    replays every time the line actually changes. */}
                <span key={statusHint ?? statusMessage} className={styles.centreStatusText}>
                  {statusHint ?? statusMessage}
                </span>
              </div>
              {/* Turn changes and the result, announced for screen readers. */}
              <div aria-live="polite" aria-atomic="true" className={styles.srOnly}>
                {statusHint ?? statusMessage}
              </div>

              {/* A failed write mid-game must not be silent. */}
              {error && <div className={styles.playError} role="alert">{error}</div>}

              {/* The die, resting in the hub — where you would actually throw it */}
              <button
                className={[
                  styles.dice,
                  styles.centreDice,
                  isRolling ? styles.diceRolling : '',
                  diceCanRoll ? styles.diceActive : '',
                ].filter(Boolean).join(' ')}
                onClick={() => handleRollDice()}
                disabled={!diceCanRoll}
                aria-label="Roll dice"
                title={diceCanRoll ? 'Roll — or press Space' : undefined}
              >
                {isRolling ? (
                  // Not keyed: mid-tumble the faces are a blur by design, and
                  // remounting each one would fight the shake.
                  <DiceFace value={rollingFace} />
                ) : (diceValue ?? lastRoll) ? (
                  // Keyed, so the face that comes up is a new element and plays
                  // its landing (see .diceFace) instead of swapping in place.
                  <DiceFace
                    key={(diceValue ?? lastRoll) as number}
                    value={(diceValue ?? lastRoll) as number}
                  />
                ) : (
                  <span className={styles.diceIdle} />
                )}
              </button>
            </div>

            {/* Game-over overlay */}
            {winner && showGameOver && (
              <div className={styles.gameOverOverlay}>
                <div className={styles.gameOverCard}>
                  <div className={styles.gameOverTitle}>
                    <span className={styles.playerDot} style={{ background: COLOR_HEX[winner] }} />
                    {displayName(winner)} wins!
                  </div>
                  {/* Final placings. The game ends the instant somebody fills
                      their run home, so the seats behind the winner are
                      separated by how far round they actually got. */}
                  {standings.length > 1 && (
                    <div className={styles.finishOrder}>
                      {standings.map((s, i) => (
                        <div key={s.color} className={styles.finishRow}>
                          <span>{i + 1}.</span>
                          <span className={styles.playerDot} style={{ background: COLOR_HEX[s.color] }} />
                          <span>{displayName(s.color)}</span>
                          <span className={styles.finishScore}>{s.score}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={styles.gameOverButtons}>
                    {/* The host may well have shut the window by now — without
                        this the table can never be restarted by anyone. */}
                    {(myColor === hostColor || !playerNames[hostColor]) && (
                      <button className={styles.createBtn} onClick={handlePlayAgain}>Play Again</button>
                    )}
                    <button className={styles.linkBtn} onClick={handleLeaveGame}>Leave</button>
                    <button className={styles.linkBtn} onClick={handleBackToLobby}>Back to Lobby</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Ludo3Game;
