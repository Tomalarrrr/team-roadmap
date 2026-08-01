// Ludo2 — three-player Ludo on a Y-shaped board. Hidden feature, reached by
// typing "ludo2" in the search palette while the vault is unlocked.
//
// Networking mirrors Ludo v1: state lives at ludo2/{code} behind the VPN-safe
// proxy (src/api/ludo2Api.ts), polled ~1.2s; moves are optimistic with rollback.
// Classic rules only — no power-ups. Bots run client-side on whichever client
// observes a bot's turn (the makeMove turn guard dedupes concurrent writers).

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
  requestDiceRoll,
  getServerTimestamp,
  type Ludo2GameState,
  type Ludo2MoveUpdate,
} from '../../api/ludo2Api';
import { serializeTokens, deserializeTokens, type TokenPosition, type TurnPhase } from '../../ludoFirebase';
import {
  TOTAL_TOKENS,
  PLAYER_COLORS,
  INITIAL_TOKENS,
  getTokenColor,
  getColorTokenIndices,
  getPlayerScore,
  colorIndex,
  initRollStats,
  deserializeRollStats,
  serializeRollStats,
  recordRoll,
  recordCapture,
  type RollStats,
  type Ludo2Color,
} from '../../ludo2Board';
import {
  getValidMoves,
  applyMove,
  checkPlayerFinished,
  getFinishedColors,
  findNextActivePlayer,
  getNextTurn,
  scoreBotMove,
} from '../../ludo2GameLogic';
import { computeMovePath, getTokenCoords } from './ludo2Geometry';
import { Ludo2Board, type CapturedGhost } from './Ludo2Board';
import styles from './Ludo2Game.module.css';

const TURN_SECONDS = 30;
const BACKUP_GRACE = 15;
const STEP_MS = 200;

// Kept in step with Ludo2Board's palette: a deliberate luminance ladder
// (0.21 / 0.29 / 0.43) so the three players separate by lightness, not hue alone.
const COLOR_HEX: Record<Ludo2Color, string> = {
  red: '#d13a22', green: '#31a566', yellow: '#f2a838',
};

const COLOR_LABELS: Record<Ludo2Color, string> = {
  red: 'Red', green: 'Green', yellow: 'Yellow',
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

interface Ludo2GameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

export function Ludo2Game({ onClose, isSearchOpen }: Ludo2GameProps) {
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
  const [joinCode, setJoinCode] = useState('');
  const [myColor, setMyColor] = useState<Ludo2Color | null>(null);
  const myColorRef = useRef<Ludo2Color | null>(null);
  const [playerNames, setPlayerNames] = useState<Partial<Record<Ludo2Color, string>>>({});
  // Seats are dealt at random, so "host" is a stored colour rather than red.
  // Games created before that field existed default to red.
  const [hostColor, setHostColor] = useState<Ludo2Color>('red');
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
  const botColorsRef = useRef<Set<Ludo2Color>>(new Set());

  // --- Synced game state ---
  const [tokens, setTokens] = useState<TokenPosition[]>(() => deserializeTokens(INITIAL_TOKENS));
  const tokensRef = useRef(tokens);
  tokensRef.current = tokens;
  const [currentTurn, setCurrentTurn] = useState<Ludo2Color>('red');
  const currentTurnRef = useRef(currentTurn);
  currentTurnRef.current = currentTurn;
  const [turnPhase, setTurnPhase] = useState<TurnPhase>('roll');
  const turnPhaseRef = useRef(turnPhase);
  turnPhaseRef.current = turnPhase;
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const diceValueRef = useRef(diceValue);
  diceValueRef.current = diceValue;
  const [consecutiveSixes, setConsecutiveSixes] = useState(0);
  const consecutiveSixesRef = useRef(consecutiveSixes);
  consecutiveSixesRef.current = consecutiveSixes;
  const [winner, setWinner] = useState<Ludo2Color | null>(null);
  const winnerRef = useRef(winner);
  winnerRef.current = winner;
  const [finishOrder, setFinishOrder] = useState<Ludo2Color[]>([]);
  const finishOrderRef = useRef(finishOrder);
  finishOrderRef.current = finishOrder;
  const [activePlayerCount, setActivePlayerCount] = useState(3);
  const activePlayerCountRef = useRef(activePlayerCount);
  activePlayerCountRef.current = activePlayerCount;
  const [rollStats, setRollStats] = useState<RollStats>(() => deserializeRollStats(initRollStats()));
  const rollStatsRef = useRef(rollStats);

  // --- Turn/interaction state ---
  const [validMoves, setValidMoves] = useState<Map<number, TokenPosition>>(new Map());
  const [isRolling, setIsRolling] = useState(false);
  const isRollingRef = useRef(false);
  const [rollingFace, setRollingFace] = useState(1);
  const [rolledThisTurn, setRolledThisTurn] = useState(false);
  const [lastMovedToken, setLastMovedToken] = useState<number | null>(null);
  const [showGameOver, setShowGameOver] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(TURN_SECONDS);
  const moveInFlightRef = useRef(false);
  const pendingMoveRef = useRef<{ from: string; to: string } | null>(null);
  const prevTokensRef = useRef(INITIAL_TOKENS);
  const turnStartedAtRef = useRef(0);
  const turnLocalStartRef = useRef(Date.now());

  // Pity timer: guarantee a 6 for a player stuck with everything at base
  const homeStuckRolls = useRef<Record<string, number>>({});
  const pityThreshold = useRef<Record<string, number>>({});

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
  const capturedGhostsRef = useRef<CapturedGhost[]>([]);
  const captureTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
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
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      clearTimeout(hintTimeoutRef.current);
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(movedTimeoutRef.current);
      clearTimeout(autoMoveRef.current);
      clearTimeout(gameOverTimerRef.current);
      clearTimeout(botTimerRef.current);
      for (const t of captureTimersRef.current) clearTimeout(t);
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

  // --- Cell-by-cell animation stepper (ported from v1) ---
  const startTokenAnimation = useCallback((tokenIdx: number, rawWaypoints: [number, number][]) => {
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
      if (step > 0 && now - lastStepTime < STEP_MS * 0.15) {
        rapidCount++;
        if (rapidCount >= 2) {
          tokenAnimPos.current.set(tokenIdx, waypoints[waypoints.length - 1]);
          tokenAnimParity.current.set(tokenIdx, step % 2);
          scheduleRenderTick();
          tokenAnimTimers.current.set(tokenIdx, setTimeout(() => {
            tokenAnimPos.current.delete(tokenIdx);
            tokenAnimParity.current.delete(tokenIdx);
            tokenAnimTimers.current.delete(tokenIdx);
            scheduleRenderTick();
          }, STEP_MS));
          return;
        }
      } else {
        rapidCount = 0;
      }
      lastStepTime = now;
      tokenAnimPos.current.set(tokenIdx, waypoints[step]);
      tokenAnimParity.current.set(tokenIdx, step % 2);
      step++;
      scheduleRenderTick();
      tokenAnimTimers.current.set(tokenIdx, setTimeout(advance, STEP_MS));
    };
    advance();
  }, [scheduleRenderTick]);

  // Animate movers + schedule capture ghosts for oldTokens → newTokens.
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
      }
    }

    // Capture ghosts, delayed until the capturer arrives
    for (const t of captureTimersRef.current) clearTimeout(t);
    captureTimersRef.current = [];
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
      const coords = getTokenCoords(oldTokens[i], i);
      if (coords) {
        const ghost: CapturedGhost = { index: i, coords, color: getTokenColor(i) };
        const showTimer = setTimeout(() => {
          capturedGhostsRef.current.push(ghost);
          scheduleRenderTick();
          const cleanupTimer = setTimeout(() => {
            capturedGhostsRef.current = capturedGhostsRef.current.filter(g => g !== ghost);
            scheduleRenderTick();
          }, 500);
          captureTimersRef.current.push(cleanupTimer);
        }, capturerDelay);
        captureTimersRef.current.push(showTimer);
      }
    }
  }, [startTokenAnimation, scheduleRenderTick]);

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

    subscribeToGame(gameCode, (state: Ludo2GameState | null) => {
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

      if (state.turnPhase === 'roll' && !isRollingRef.current) {
        setRolledThisTurn(false);
      }

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
      if (state.consecutiveSixes !== consecutiveSixesRef.current) setConsecutiveSixes(state.consecutiveSixes);
      if (state.playerCount !== activePlayerCountRef.current) setActivePlayerCount(state.playerCount);
      turnStartedAtRef.current = state.turnStartedAt;

      const isPaused = !!state.paused;
      if (gamePausedRef.current && !isPaused) {
        turnLocalStartRef.current = Date.now();
      }
      setGamePaused(isPaused);
      gamePausedRef.current = isPaused;

      if (state.singlePlayer) {
        setIsSinglePlayer(true);
        isSinglePlayerRef.current = true;
        const bots = new Set<Ludo2Color>();
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
        state.finishOrder ? (state.finishOrder.split(',').filter(Boolean) as Ludo2Color[]) : []
      );

      const names: Partial<Record<Ludo2Color, string>> = {};
      for (const color of PLAYER_COLORS) {
        const player = state.players[color];
        if (player) names[color] = player.name;
      }
      setPlayerNames(names);
      setHostColor(state.host ?? 'red');

      // Recompute valid moves on reconnect into a move phase
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
      console.error('[Ludo2] Subscription failed:', err);
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

  // --- Auto-join from URL parameter (?ludo2=CODE) ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('ludo2');
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
            url.searchParams.delete('ludo2');
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
    else if (roll === 6 && nextColor === curColor) showHint('Rolled 6! Bonus turn');

    setLastMovedToken(tokenIndex);
    clearTimeout(movedTimeoutRef.current);
    movedTimeoutRef.current = setTimeout(() => setLastMovedToken(null), 400);
    setValidMoves(new Map());

    let moveRollStats = rollStatsRef.current;
    if (captured) {
      moveRollStats = recordCapture(moveRollStats, colorIndex(curColor));
      rollStatsRef.current = moveRollStats;
    }

    const update: Ludo2MoveUpdate = {
      tokens: serializeTokens(newTokens),
      currentTurn: gameWinner ? curColor : nextColor,
      turnPhase: 'roll',
      diceValue: null,
      consecutiveSixes: nextSixes,
      winner: gameWinner,
      finishOrder: updatedFinishOrder.join(','),
      turnStartedAt: getServerTimestamp(),
      rollStats: serializeRollStats(moveRollStats),
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
      .then(committed => { if (!committed) rollbackOptimistic(); })
      .catch(rollbackOptimistic);
  }, [showHint, runTokenAnimations]);
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

    const { rolls } = await requestDiceRoll();

    if (currentTurnRef.current !== activeColor || turnPhaseRef.current !== 'roll' || winnerRef.current) {
      moveInFlightRef.current = false;
      isRollingRef.current = false;
      setIsRolling(false);
      return;
    }

    // Pity timer: after a few failed attempts to deploy with everything stuck
    // at base, force a 6 (recorded stats use the true die face, not this)
    let roll = rolls[0];
    const originalFace = rolls[0];
    const indices = getColorTokenIndices(activeColor);
    const hasTokenAtHome = indices.some(i => tokensRef.current[i] === 'base');
    const allBaseOrFinished = indices.every(i => {
      const t = tokensRef.current[i];
      return t === 'base' || t === 'final-6';
    });
    const needsSix = hasTokenAtHome && allBaseOrFinished;
    const stuckCount = homeStuckRolls.current[activeColor] || 0;
    const threshold = pityThreshold.current[activeColor] ?? (4 + Math.floor(Math.random() * 3));
    if (!(activeColor in pityThreshold.current)) pityThreshold.current[activeColor] = threshold;
    if (needsSix && stuckCount >= threshold) roll = 6;
    if (needsSix) {
      if (roll === 6) {
        homeStuckRolls.current[activeColor] = 0;
        pityThreshold.current[activeColor] = 4 + Math.floor(Math.random() * 3);
      } else {
        homeStuckRolls.current[activeColor] = stuckCount + 1;
      }
    } else {
      homeStuckRolls.current[activeColor] = 0;
    }

    rollTimeoutRef.current = setTimeout(async () => {
      setIsRolling(false);
      isRollingRef.current = false;
      setDiceValue(roll);
      setRolledThisTurn(true);

      const updatedRollStats = recordRoll(rollStatsRef.current, colorIndex(activeColor), originalFace);
      rollStatsRef.current = updatedRollStats;

      const currentTokens = tokensRef.current;
      const curColor = currentTurnRef.current;
      const curSixes = consecutiveSixesRef.current;
      const curPlayerCount = activePlayerCountRef.current;
      const finishedColors = getFinishedColors(currentTokens, curPlayerCount);

      const moves = getValidMoves(currentTokens, curColor, roll);

      if (moves.length === 0) {
        const hasTokensInCorridor = getColorTokenIndices(curColor).some(i => {
          const t = currentTokens[i];
          return t.startsWith('final-') && t !== 'final-6';
        });
        let nextColor: Ludo2Color;
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
          showHint(hasTokensInCorridor ? 'Need exact roll to finish' : 'No valid moves');
        }
        const update: Ludo2MoveUpdate = {
          tokens: serializeTokens(currentTokens),
          currentTurn: nextColor,
          turnPhase: 'roll',
          diceValue: null,
          consecutiveSixes: nextSixes,
          winner: null,
          finishOrder: finishOrderRef.current.join(','),
          turnStartedAt: getServerTimestamp(),
          rollStats: serializeRollStats(updatedRollStats),
        };
        try { await makeMove(gc, curColor, update); } catch { moveInFlightRef.current = false; }
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

      setValidMoves(new Map(moves.map(m => [m.tokenIndex, m.newPosition])));
      const update: Ludo2MoveUpdate = {
        tokens: serializeTokens(currentTokens),
        currentTurn: curColor,
        turnPhase: 'move',
        diceValue: roll,
        consecutiveSixes: curSixes,
        winner: null,
        finishOrder: finishOrderRef.current.join(','),
        turnStartedAt: getServerTimestamp(),
        rollStats: serializeRollStats(updatedRollStats),
      };
      try { await makeMove(gc, curColor, update); } catch { moveInFlightRef.current = false; }
    }, rollAnimMs);
  }, [showHint]);
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
      if (e.key === 'Escape' && !isSearchOpen) onClose();
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && gamePhase === 'playing' && myColorRef.current
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
            const moves = getValidMoves(tokensRef.current, currentTurnRef.current, dice);
            if (moves.length > 0) {
              moveInFlightRef.current = true;
              const randomMove = moves[Math.floor(Math.random() * moves.length)];
              executeMoveRef.current(randomMove.tokenIndex, randomMove.newPosition, dice);
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
          const update: Ludo2MoveUpdate = {
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
          makeMove(gc, curColor, update).catch(() => { moveInFlightRef.current = false; });
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

    clearTimeout(botTimerRef.current);
    const botDelay = 600 + Math.random() * 400;

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
        const moves = getValidMoves(tokensRef.current, currentTurn, dice);
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
            }).catch(() => { moveInFlightRef.current = false; });
          }
          return;
        }

        let bestIdx = moves[0].tokenIndex;
        let bestScore = -Infinity;
        for (const m of moves) {
          const score = scoreBotMove(
            m.tokenIndex, m.newPosition, tokensRef.current, currentTurn, activePlayerCountRef.current
          );
          if (score > bestScore) {
            bestScore = score;
            bestIdx = m.tokenIndex;
          }
        }
        handleMoveTokenRef.current(bestIdx);
      }, botDelay);
    }

    return () => clearTimeout(botTimerRef.current);
    // tokens re-triggers after board-changing writes
  }, [isSinglePlayer, gamePhase, winner, gamePaused, currentTurn, turnPhase, myColor, tokens]);

  // --- Lobby / room handlers ---
  const resetLocalGameState = useCallback(() => {
    setTokens(deserializeTokens(INITIAL_TOKENS));
    prevTokensRef.current = INITIAL_TOKENS;
    setCurrentTurn('red');
    setTurnPhase('roll');
    setDiceValue(null);
    setConsecutiveSixes(0);
    setWinner(null);
    setFinishOrder([]);
    setValidMoves(new Map());
    setShowGameOver(false);
    setRolledThisTurn(false);
    const stats = deserializeRollStats(initRollStats());
    setRollStats(stats);
    rollStatsRef.current = stats;
    homeStuckRolls.current = {};
    pityThreshold.current = {};
  }, []);

  const handleCreateGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { code, color } = await createGame(sessionId, userName);
      resetLocalGameState();
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
      await startGame(gc);
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  // --- Dragging ---
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    dragCleanupRef.current?.();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: Math.max(0, dragStartRef.current.posY + dy),
      });
    };
    const onUp = () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    dragCleanupRef.current = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [position.x, position.y]);

  // --- Derived display state ---
  const isMyTurn = myColor === currentTurn;
  const diceCanRoll = isMyTurn && turnPhase === 'roll' && !isRolling && !winner && !gamePaused;
  const displayName = (color: Ludo2Color) => playerNames[color] ?? COLOR_LABELS[color];
  const statusMessage = winner
    ? `${displayName(winner)} wins!`
    : isMyTurn
      ? (turnPhase === 'roll' ? 'Your turn — roll!' : 'Choose a token')
      : `${displayName(currentTurn)}'s turn…`;
  const offlineBanner = !isBrowserOnline || !isConnected;

  return (
    <div className={`${styles.popup} ${gamePhase === 'playing' ? '' : styles.popupCompact}`} style={{ left: position.x, top: position.y }}>
      <div className={styles.titleBar} onMouseDown={handleDragStart}>
        <span className={styles.titleText}>
          Ludo 2
          {gameCode && <span className={styles.titleCode}>{gameCode}</span>}
          {offlineBanner && gamePhase !== 'lobby' && (
            <span className={styles.reconnecting}>reconnecting…</span>
          )}
        </span>
        <span className={styles.titleButtons}>
          {gamePhase === 'playing' && !winner && (
            <button
              className={`${styles.closeBtn} ${gamePaused ? styles.pauseBtnActive : ''}`}
              onClick={() => gameCode && toggleGamePause(gameCode)}
              aria-label={gamePaused ? 'Resume game' : 'Pause game'}
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
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close Ludo 2">
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
            <div className={styles.lobbyTitle}>Three-player Ludo on a Y-board</div>
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
              onClick={() => gameCode && navigator.clipboard.writeText(gameCode).then(() => showHint('Copied!'))}
              role="button"
              tabIndex={0}
              title="Click to copy"
              aria-label="Copy game code"
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && gameCode) { e.preventDefault(); navigator.clipboard.writeText(gameCode).then(() => showHint('Copied!')); } }}
            >
              {gameCode}
            </div>
            <div className={styles.shareHint}>Tap code to copy — share with your opponents</div>
            {gameCode && (
              <button
                className={styles.linkBtn}
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set('ludo2', gameCode);
                  navigator.clipboard.writeText(url.toString()).then(() => showHint('Link copied!'));
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
                    onClick={() => { if (isEmpty && isHost && gameCode) addBot(gameCode, color); }}
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
                        onClick={(e) => { e.stopPropagation(); if (gameCode) removeBot(gameCode, color); }}
                        aria-label={`Remove ${color} bot`}
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
            {(() => {
              const filledCount = PLAYER_COLORS.filter(c => !!playerNames[c]).length;
              const canStart = myColor === hostColor && filledCount >= 2;
              return (
                <button className={styles.createBtn} onClick={handleStartGame} disabled={!canStart || isLoading}>
                  {isLoading ? 'Starting…'
                    : filledCount < 2 ? 'Need 2+ players'
                    : myColor !== hostColor ? 'Waiting for host…'
                    : 'Start Game'}
                </button>
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
            <div className={styles.boardWrapper}>
              <Ludo2Board
                tokens={tokens}
                playerCount={activePlayerCount}
                myColor={myColor}
                validMoves={validMoves}
                lastMovedToken={lastMovedToken}
                animPos={tokenAnimPos.current}
                animParity={tokenAnimParity.current}
                capturedGhosts={capturedGhostsRef.current}
                onTokenClick={handleMoveToken}
              />
            </div>

            <div className={styles.sidePanel}>
              <div className={styles.turnIndicator}>
                <span className={styles.statusDot} style={{ background: COLOR_HEX[winner ?? currentTurn] }} />
                <span>{statusMessage}</span>
                {!winner && (
                  <span className={`${styles.timer} ${timeLeft <= 10 ? styles.timerUrgent : ''}`}>
                    {timeLeft}s
                  </span>
                )}
              </div>

              {/* Standing/progress, replacing the score badges that used to sit
                  on the board itself */}
              <div className={styles.playerRows}>
                {PLAYER_COLORS.slice(0, activePlayerCount).map(color => (
                  <div
                    key={color}
                    className={[
                      styles.playerRow,
                      currentTurn === color && !winner ? styles.playerRowActive : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className={styles.playerDot} style={{ background: COLOR_HEX[color] }} />
                    <span className={styles.playerRowName}>
                      {displayName(color)}{myColor === color ? ' (you)' : ''}
                    </span>
                    <span className={styles.playerRowScore}>{getPlayerScore(tokens, color)}</span>
                  </div>
                ))}
              </div>

              <div className={styles.sideDice}>
                <button
                  className={[
                    styles.dice,
                    isRolling ? styles.diceRolling : '',
                    diceCanRoll ? styles.diceActive : '',
                  ].filter(Boolean).join(' ')}
                  onClick={handleRollDice}
                  disabled={!diceCanRoll}
                  aria-label="Roll dice"
                >
                  {isRolling ? (
                    <DiceFace value={rollingFace} />
                  ) : diceValue && (turnPhase === 'move' || rolledThisTurn) ? (
                    <DiceFace value={diceValue} />
                  ) : (
                    <span className={styles.diceIdle} />
                  )}
                </button>
                {statusHint && <span className={styles.statusHint}>{statusHint}</span>}
                <div aria-live="polite" aria-atomic="true" className={styles.srOnly}>{statusHint ?? ''}</div>
              </div>

              <div className={styles.statsTable}>
                <div className={styles.statsLabel}>Dice Rolls</div>
                <table>
                  <thead>
                    <tr>
                      <th></th>
                      {[1, 2, 3, 4, 5, 6].map(n => <th key={n}>{n}</th>)}
                      <th className={styles.statsCaps} title="Captures">Cap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PLAYER_COLORS.slice(0, activePlayerCount).map((color, ci) => (
                      <tr key={color}>
                        <td><span className={styles.playerDot} style={{ background: COLOR_HEX[color] }} /></td>
                        {rollStats[ci].rolls.map((n, i) => <td key={i}>{n || ''}</td>)}
                        <td>{rollStats[ci].captures || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Game-over overlay */}
            {winner && showGameOver && (
              <div className={styles.gameOverOverlay}>
                <div className={styles.gameOverCard}>
                  <div className={styles.gameOverTitle}>
                    <span className={styles.playerDot} style={{ background: COLOR_HEX[winner] }} />
                    {displayName(winner)} wins!
                  </div>
                  {finishOrder.length > 1 && (
                    <div className={styles.finishOrder}>
                      {finishOrder.map((c, i) => (
                        <div key={c} className={styles.finishRow}>
                          <span>{i + 1}.</span>
                          <span className={styles.playerDot} style={{ background: COLOR_HEX[c] }} />
                          <span>{displayName(c)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={styles.gameOverButtons}>
                    {myColor === hostColor && (
                      <button className={styles.createBtn} onClick={handlePlayAgain}>Play Again</button>
                    )}
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

export default Ludo2Game;
