import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  createGame,
  joinGame,
  spectateGame,
  subscribeToGame,
  makeMove,
  resetGame,
  sendReaction,
  subscribeToReactions,
  cleanupOldReactions,
  cleanupOldGames,
  subscribeToServerTimeOffset,
  updatePresence,
  updateWinTally,
  voteRematch,
  logGameResult,
  getGameHistory,
  type SnakesGameState,
  type SnakesMoveUpdate,
  type GameHistoryEntry,
} from '../snakesFirebase';
import {
  cellToGrid,
  cellToPercent,
  resolveMove,
  getNextTurn,
  checkWinner,
  computeHopPath,
  computeGameStats,
  computeMvpAwards,
  serializePositions,
  deserializePositions,
  serializeMoveLog,
  deserializeMoveLog,
  getTokenOffset,
  computeSnakePath,
  computeLadderPath,
  SNAKES,
  LADDERS,
  BOARD_SIZE,
  PLAYER_COLORS,
  COLOR_HEX,
  COLOR_LABELS,
  type MoveLogEntry,
} from '../utils/snakesLogic';
import { SnakesErrorBoundary } from './SnakesErrorBoundary';
import styles from './SnakesGame.module.css';

// Sub-components
import {
  TURN_SECONDS,
  BACKUP_GRACE,
  STEP_MS,
  SLIDE_MS,
  MAX_LOG_ENTRIES,
  COL_PCT,
  ROW_PCT,
  TOKEN_SIZE_PCT,
  TOKEN_STYLE,
  BOARD_CELLS,
  DUST_DIRS,
  DiceFace,
  renderLadderSVG,
  renderSnakeSVG,
  launchConfetti,
  CountdownTimer,
} from './snakes/snakesHelpers';
import { BoardCell } from './snakes/BoardCell';
import { SnakesLobby } from './snakes/SnakesLobby';
import { SnakesGameOver } from './snakes/SnakesGameOver';

// --- Component ---

interface SnakesGameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

export function SnakesGame({ onClose, isSearchOpen }: SnakesGameProps) {
  const [sessionId] = useState(() => sessionStorage.getItem('roadmap-user-id') || 'anonymous');
  const [userName] = useState(() => sessionStorage.getItem('roadmap-user-name') || 'Player');

  // Multiplayer state
  const [gamePhase, setGamePhase] = useState<'lobby' | 'waiting' | 'playing'>('lobby');
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [mySlot, setMySlot] = useState<number | null>(null);
  const [isSpectating, setIsSpectating] = useState(false);
  const [playerNames, setPlayerNames] = useState<Record<number, string>>({});
  const [playerCount, setPlayerCount] = useState(2);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Game state (driven by Firebase)
  const [positions, setPositions] = useState<number[]>([]);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [diceValue, setDiceValue] = useState<number | null>(null);
  const [consecutiveSixes, setConsecutiveSixes] = useState(0);
  const [winner, setWinner] = useState<number | null>(null);
  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([]);
  const [activePlayerCount, setActivePlayerCount] = useState(2);

  // UI state
  const [isRolling, setIsRolling] = useState(false);
  const [rollingFace, setRollingFace] = useState(1);
  const [showBurst, setShowBurst] = useState(false);
  const [showGameOver, setShowGameOver] = useState(false);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [hasRolledThisTurn, setHasRolledThisTurn] = useState(false);
  const [, setRenderTick] = useState(0);
  const [turnTransitioning, setTurnTransitioning] = useState(false);
  const [winTally, setWinTally] = useState<Record<number, number>>({});
  const [gameNumber, setGameNumber] = useState(1);
  const [floatingReactions, setFloatingReactions] = useState<Array<{ id: string; emoji: string; player: number; left: number }>>([]);
  const [turnStartedAtState, setTurnStartedAtState] = useState(Date.now());
  const [serverOffsetState, setServerOffsetState] = useState(0);

  // Player presence
  const [playerPresence, setPlayerPresence] = useState<Record<number, number>>({});

  // Rematch flow
  const [rematchVotes, setRematchVotes] = useState<Record<number, boolean>>({});


  // Game history
  const [gameHistory, setGameHistory] = useState<GameHistoryEntry[]>([]);

  // Coin toss
  const [showCoinToss, setShowCoinToss] = useState(false);
  const [coinTossResult, setCoinTossResult] = useState<number | null>(null);
  const [coinTossFading, setCoinTossFading] = useState(false);

  // Camera shake (supports light/heavy tiers)
  const [cameraShake, setCameraShake] = useState<'snake' | 'ladder' | 'snakeLight' | 'ladderLight' | null>(null);

  // Drag state
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (window.innerWidth - 880) / 2),
    y: Math.max(0, (window.innerHeight - 600) / 2),
  }));
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Refs for timer/callback safety
  const moveInFlightRef = useRef(false);
  const isRollingRef = useRef(false);
  const turnStartedAtRef = useRef<number>(Date.now());
  const prevPositionsRef = useRef('');
  const prevGameFingerprintRef = useRef('');
  const prevMoveLogStringRef = useRef('');
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rollTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gameOverTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Cell-by-cell animation state
  const tokenAnimPos = useRef<Map<number, [number, number]>>(new Map());
  const tokenAnimParity = useRef<Map<number, number>>(new Map());
  const tokenAnimTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const tokenSlideClass = useRef<Map<number, string>>(new Map());
  const slideTimerRefs = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const lastMovedPlayerRef = useRef<number | null>(null);
  const tokenEnteredBoard = useRef<Set<number>>(new Set());
  const isInitialLoadRef = useRef(true);
  const confettiCanvasRef = useRef<HTMLCanvasElement>(null);
  const confettiAnimRef = useRef<number | null>(null);
  const lastReactionTimeRef = useRef(0);
  const turnTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const serverOffsetRef = useRef(0);
  const lastAutoRollTurnStartRef = useRef(0); // guards against double auto-roll per turn
  const boardEntranceTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const burstTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reactionTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const coinTossShownRef = useRef(false);
  const coinTossFadeRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const coinTossRemoveRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cameraShakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Mirrored refs for closure safety
  const gameCodeRef = useRef(gameCode);
  gameCodeRef.current = gameCode;
  const mySlotRef = useRef(mySlot);
  mySlotRef.current = mySlot;
  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const currentTurnRef = useRef(currentTurn);
  currentTurnRef.current = currentTurn;
  const consecutiveSixesRef = useRef(consecutiveSixes);
  consecutiveSixesRef.current = consecutiveSixes;
  const winnerRef = useRef(winner);
  winnerRef.current = winner;
  const activePlayerCountRef = useRef(activePlayerCount);
  activePlayerCountRef.current = activePlayerCount;
  const moveLogRef = useRef(moveLog);
  moveLogRef.current = moveLog;
  const playerNamesRef = useRef(playerNames);
  playerNamesRef.current = playerNames;

  const isMyTurn = mySlot !== null && currentTurn === mySlot && !winner && !isSpectating;
  const isAnimating = tokenAnimPos.current.size > 0 || tokenSlideClass.current.size > 0;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimeout(hintTimeoutRef.current);
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(gameOverTimerRef.current);
      clearTimeout(turnTransitionTimeoutRef.current);
      clearTimeout(burstTimeoutRef.current);
      clearTimeout(coinTossFadeRef.current);
      clearTimeout(coinTossRemoveRef.current);
      clearTimeout(cameraShakeTimeoutRef.current);
      for (const t of slideTimerRefs.current.values()) clearTimeout(t);
      for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
      for (const t of boardEntranceTimers.current.values()) clearTimeout(t);
      for (const t of reactionTimers.current.values()) clearTimeout(t);
      if (confettiAnimRef.current) cancelAnimationFrame(confettiAnimRef.current);
      dragCleanupRef.current?.();
    };
  }, []);

  // Subscribe to Firebase server time offset for clock skew compensation
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    subscribeToServerTimeOffset((offset) => {
      if (!cancelled) {
        serverOffsetRef.current = offset;
        setServerOffsetState(offset);
      }
    }).then(u => { if (cancelled) u(); else unsub = u; });
    return () => { cancelled = true; unsub?.(); };
  }, []);

  // Player presence heartbeat — update lastSeen every 5s while in a game
  useEffect(() => {
    if (!gameCode || mySlot === null || isSpectating) return;
    const tick = () => updatePresence(gameCode, mySlot, serverOffsetRef.current).catch(() => {});
    tick();
    const interval = setInterval(tick, 5000);
    return () => clearInterval(interval);
  }, [gameCode, mySlot, isSpectating]);

  // Load game history on mount
  useEffect(() => {
    getGameHistory(sessionId).then(setGameHistory).catch(() => {});
  }, [sessionId]);


  // Auto-join from URL parameter (?snakes=CODE)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('snakes');
    if (code && code.length === 4 && gamePhase === 'lobby') {
      setJoinCode(code.toUpperCase());
      // Auto-join after a tick so state is settled
      setTimeout(() => {
        joinGame(code.toUpperCase(), sessionId, userName, serverOffsetRef.current)
          .then(({ assignedSlot }) => {
            setGameCode(code.toUpperCase());
            setMySlot(assignedSlot);
            setGamePhase('waiting');
            // Clean the URL parameter
            const url = new URL(window.location.href);
            url.searchParams.delete('snakes');
            window.history.replaceState({}, '', url.toString());
          })
          .catch(() => setError('Failed to join game from link'));
      }, 100);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Utility ---

  const showHint = useCallback((msg: string) => {
    setStatusHint(msg);
    clearTimeout(hintTimeoutRef.current);
    hintTimeoutRef.current = setTimeout(() => setStatusHint(null), 2000);
  }, []);

  // --- Cell-by-cell token animation ---

  const startTokenAnimation = useCallback((playerIdx: number, cellPath: number[], onComplete?: () => void) => {
    const existing = tokenAnimTimers.current.get(playerIdx);
    if (existing) clearTimeout(existing);

    if (cellPath.length === 0) {
      onComplete?.();
      return;
    }

    const waypoints = cellPath.map(cell => cellToGrid(cell));
    let step = 0;
    let lastStepTime = performance.now();

    const advance = () => {
      if (step >= waypoints.length) {
        tokenAnimPos.current.delete(playerIdx);
        tokenAnimParity.current.delete(playerIdx);
        tokenAnimTimers.current.delete(playerIdx);
        setRenderTick(n => n + 1);
        onComplete?.();
        return;
      }
      const now = performance.now();
      if (step > 0 && now - lastStepTime < STEP_MS * 0.3) {
        tokenAnimPos.current.delete(playerIdx);
        tokenAnimParity.current.delete(playerIdx);
        tokenAnimTimers.current.delete(playerIdx);
        setRenderTick(n => n + 1);
        onComplete?.();
        return;
      }
      lastStepTime = now;
      tokenAnimPos.current.set(playerIdx, waypoints[step]);
      tokenAnimParity.current.set(playerIdx, step % 2);
      step++;
      setRenderTick(n => n + 1);
      tokenAnimTimers.current.set(playerIdx, setTimeout(advance, STEP_MS));
    };

    advance();
  }, []);

  // --- Dice rolling animation ---

  useEffect(() => {
    if (!isRolling) return;
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout>;
    const step = () => {
      setRollingFace(Math.floor(Math.random() * 6) + 1);
      frame++;
      const delay = 80 + frame * 15;
      if (delay < 300) {
        timeout = setTimeout(step, delay);
      }
    };
    timeout = setTimeout(step, 80);
    return () => clearTimeout(timeout);
  }, [isRolling]);

  // --- Roll dice & apply move ---

  const handleRollDice = useCallback(() => {
    // Read animation refs directly (not closure-captured) for live accuracy
    const animating = tokenAnimPos.current.size > 0 || tokenSlideClass.current.size > 0;
    if (!isMyTurn || isRollingRef.current || moveInFlightRef.current || animating) return;

    isRollingRef.current = true;
    setIsRolling(true);
    setHasRolledThisTurn(true);
    moveInFlightRef.current = true;

    rollTimeoutRef.current = setTimeout(() => {
      const roll = Math.floor(Math.random() * 6) + 1;
      isRollingRef.current = false;
      setIsRolling(false);
      setDiceValue(roll);

      // Resolve move
      const currentPos = positionsRef.current[currentTurnRef.current];
      const result = resolveMove(currentPos, roll);

      // Compute next turn
      const turnResult = getNextTurn(
        currentTurnRef.current,
        roll,
        activePlayerCountRef.current,
        consecutiveSixesRef.current,
      );

      // Update positions
      const newPositions = [...positionsRef.current];
      newPositions[currentTurnRef.current] = result.finalPos;

      // Check winner
      const winnerIdx = checkWinner(newPositions);

      // Build move log entry
      const entry: MoveLogEntry = {
        player: currentTurnRef.current,
        dice: roll,
        from: currentPos,
        to: result.finalPos,
        mechanism: result.landed,
      };
      const newLog = [...moveLogRef.current, entry].slice(-MAX_LOG_ENTRIES);

      const updates: SnakesMoveUpdate = {
        positions: serializePositions(newPositions),
        currentTurn: winnerIdx !== null ? currentTurnRef.current : turnResult.nextTurn,
        diceValue: roll,
        consecutiveSixes: turnResult.nextSixes,
        winner: winnerIdx,
        turnStartedAt: Date.now() + serverOffsetRef.current,
        moveLog: serializeMoveLog(newLog),
      };

      makeMove(gameCodeRef.current!, currentTurnRef.current, updates).then(committed => {
        if (!committed) moveInFlightRef.current = false;
      }).catch(err => {
        console.error('[Snakes] Move failed:', err);
        moveInFlightRef.current = false;
      });
    }, 650);
  }, [isMyTurn]);

  const handleRollDiceRef = useRef(handleRollDice);
  handleRollDiceRef.current = handleRollDice;

  // --- Keyboard shortcuts ---

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSearchOpen) onClose();
      // Don't hijack space/enter when user is in an input, textarea, or button
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'SELECT') return;
      if ((e.key === ' ' || e.key === 'Enter') && gamePhase === 'playing') {
        e.preventDefault();
        handleRollDiceRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSearchOpen, gamePhase]);

  // --- Firebase subscription ---

  useEffect(() => {
    if (!gameCode) return;

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    subscribeToGame(gameCode, (rawState: SnakesGameState | null) => {
      if (cancelled || !rawState) return;
      setError(null);

      // Firebase RTDB deletes fields set to null — normalize undefined → null
      const state = {
        ...rawState,
        winner: rawState.winner ?? null,
        diceValue: rawState.diceValue ?? null,
        startedAt: rawState.startedAt ?? null,
        moveLog: rawState.moveLog ?? '',
      };

      // Fast path: if only lastSeen (presence heartbeat) changed, update
      // presence state and skip the expensive game-state processing.
      // The game listener covers the entire snakes/${code} node, so every
      // 5-second presence write from each player triggers this callback.
      const joinedPlayerKeys = Object.keys(state.players || {}).sort().join(',');
      const gameFingerprint = `${state.positions}|${state.currentTurn}|${state.diceValue}|${state.winner}|${state.moveLog}|${state.turnStartedAt}|${state.startedAt}|${JSON.stringify(state.rematchVotes ?? '')}|${state.gameNumber ?? ''}|${joinedPlayerKeys}|${JSON.stringify(state.winTally ?? '')}`;
      if (gameFingerprint === prevGameFingerprintRef.current) {
        // Only presence or other non-game fields changed
        if (state.lastSeen) setPlayerPresence(prev => {
          // Shallow compare to avoid unnecessary re-render
          const prevKeys = Object.keys(prev);
          const newKeys = Object.keys(state.lastSeen!);
          if (prevKeys.length !== newKeys.length) return state.lastSeen!;
          for (const k of newKeys) {
            if (prev[Number(k)] !== state.lastSeen![Number(k)]) return state.lastSeen!;
          }
          return prev;
        });
        return;
      }
      prevGameFingerprintRef.current = gameFingerprint;

      const parsed = deserializePositions(state.positions, state.playerCount);

      // Reset moveInFlight on state change
      if (state.positions !== prevPositionsRef.current || state.turnStartedAt !== turnStartedAtRef.current) {
        moveInFlightRef.current = false;
      }

      // Detect position changes and animate
      if (state.positions !== prevPositionsRef.current && prevPositionsRef.current) {
        const oldPositions = deserializePositions(prevPositionsRef.current, state.playerCount);

        for (let i = 0; i < state.playerCount; i++) {
          if (oldPositions[i] !== parsed[i]) {
            // Find the intermediate position (before snake/ladder)
            const hopTarget = oldPositions[i] + (state.diceValue || 0);

            lastMovedPlayerRef.current = i;

            // Track board entrance (position 0 → >0)
            if (oldPositions[i] === 0 && parsed[i] > 0) {
              tokenEnteredBoard.current.add(i);
              // Clear entrance flag after animation
              const prev = boardEntranceTimers.current.get(i);
              if (prev) clearTimeout(prev);
              boardEntranceTimers.current.set(i, setTimeout(() => {
                tokenEnteredBoard.current.delete(i);
                boardEntranceTimers.current.delete(i);
                setRenderTick(n => n + 1);
              }, 500));
            }

            // Check if a snake or ladder was involved
            const isSnakeOrLadder = SNAKES[hopTarget] === parsed[i] || LADDERS[hopTarget] === parsed[i];

            if (isSnakeOrLadder && hopTarget >= 1 && hopTarget <= BOARD_SIZE) {
              // Hop to the snake head / ladder bottom first, then follow the path
              const hopPath = computeHopPath(oldPositions[i], hopTarget);
              const isSnake = SNAKES[hopTarget] !== undefined;

              // Camera shake: tiered by event magnitude (must check before prevPositionsRef is updated)
              if (!isInitialLoadRef.current) {
                const drop = hopTarget - parsed[i];
                const gain = parsed[i] - hopTarget;
                if (isSnake && drop >= 40) {
                  setCameraShake('snake');
                  clearTimeout(cameraShakeTimeoutRef.current);
                  cameraShakeTimeoutRef.current = setTimeout(() => setCameraShake(null), 750);
                } else if (isSnake && drop >= 20) {
                  setCameraShake('snakeLight');
                  clearTimeout(cameraShakeTimeoutRef.current);
                  cameraShakeTimeoutRef.current = setTimeout(() => setCameraShake(null), 600);
                } else if (!isSnake && gain >= 40) {
                  setCameraShake('ladder');
                  clearTimeout(cameraShakeTimeoutRef.current);
                  cameraShakeTimeoutRef.current = setTimeout(() => setCameraShake(null), 750);
                } else if (!isSnake && gain >= 20) {
                  setCameraShake('ladderLight');
                  clearTimeout(cameraShakeTimeoutRef.current);
                  cameraShakeTimeoutRef.current = setTimeout(() => setCameraShake(null), 600);
                }
              }

              startTokenAnimation(i, hopPath, () => {
                // Animate along the snake body or ladder rungs
                const slideClass = isSnake ? styles.tokenSnakeSlide : styles.tokenLadderClimb;
                tokenSlideClass.current.set(i, slideClass);
                const pathWaypoints = isSnake
                  ? computeSnakePath(hopTarget, parsed[i], 10)
                  : computeLadderPath(hopTarget, parsed[i], 6);
                // Step through path waypoints using the animation system
                let pathStep = 0;
                const SLIDE_STEP_MS = Math.floor(SLIDE_MS / pathWaypoints.length);
                const advancePath = () => {
                  if (pathStep >= pathWaypoints.length) {
                    tokenAnimPos.current.delete(i);
                    tokenSlideClass.current.delete(i);
                    slideTimerRefs.current.delete(i);
                    setRenderTick(n => n + 1);
                    return;
                  }
                  tokenAnimPos.current.set(i, pathWaypoints[pathStep]);
                  pathStep++;
                  setRenderTick(n => n + 1);
                  const timer = setTimeout(advancePath, SLIDE_STEP_MS);
                  slideTimerRefs.current.set(i, timer);
                };
                advancePath();
              });
            } else {
              // Normal hop
              const hopPath = computeHopPath(oldPositions[i], parsed[i]);
              startTokenAnimation(i, hopPath);
            }
          }
        }
      }
      prevPositionsRef.current = state.positions;
      turnStartedAtRef.current = state.turnStartedAt;
      setTurnStartedAtState(state.turnStartedAt);

      // Update players
      const names: Record<number, string> = {};
      for (let i = 0; i < state.playerCount; i++) {
        const p = state.players[`p${i}`];
        if (p) names[i] = p.name;
      }
      // Only update if names actually changed to avoid unnecessary re-renders
      setPlayerNames(prev => {
        const keys = Object.keys(names);
        if (keys.length !== Object.keys(prev).length) return names;
        for (const k of keys) {
          if (prev[Number(k)] !== names[Number(k)]) return names;
        }
        return prev;
      });

      // Phase transitions
      const joinedCount = Object.keys(state.players).filter(k => state.players[k]).length;
      if (state.startedAt && joinedCount >= state.playerCount) {
        setGamePhase('playing');
        // Show coin toss on first game start (not on reconnect)
        if (!isInitialLoadRef.current && state.firstPlayer !== undefined && !coinTossShownRef.current) {
          coinTossShownRef.current = true;
          setCoinTossResult(state.firstPlayer ?? state.currentTurn);
          setShowCoinToss(true);
          setCoinTossFading(false);
          // Graceful fade-out: start fading at 3.2s, remove at 4s
          clearTimeout(coinTossFadeRef.current);
          clearTimeout(coinTossRemoveRef.current);
          coinTossFadeRef.current = setTimeout(() => setCoinTossFading(true), 3200);
          coinTossRemoveRef.current = setTimeout(() => { setShowCoinToss(false); setCoinTossFading(false); }, 4000);
        }
      }

      setPositions(parsed);
      if (state.currentTurn !== currentTurnRef.current) {
        setHasRolledThisTurn(false);
        // Turn transition animation
        if (!isInitialLoadRef.current) {
          setTurnTransitioning(true);
          clearTimeout(turnTransitionTimeoutRef.current);
          turnTransitionTimeoutRef.current = setTimeout(() => setTurnTransitioning(false), 500);
        }
      }
      setCurrentTurn(state.currentTurn);
      setDiceValue(state.diceValue);
      setConsecutiveSixes(state.consecutiveSixes);
      setWinner(state.winner);
      setActivePlayerCount(state.playerCount);
      const rawMoveLog = state.moveLog || '';
      if (rawMoveLog !== prevMoveLogStringRef.current) {
        prevMoveLogStringRef.current = rawMoveLog;
        setMoveLog(deserializeMoveLog(rawMoveLog));
      }

      // Sync shared state from Firebase
      if (state.winTally) setWinTally(state.winTally);
      if (state.lastSeen) setPlayerPresence(state.lastSeen);
      setRematchVotes(state.rematchVotes || {});
      if (state.gameNumber) setGameNumber(state.gameNumber);

      // Winner burst + game-over overlay + confetti + tally
      if (state.winner !== null && winnerRef.current === null) {
        // Increment win tally in Firebase
        if (gameCodeRef.current) {
          updateWinTally(gameCodeRef.current, state.winner).catch(() => {});
        }
        if (isInitialLoadRef.current) {
          // Reconnecting to a finished game: show overlay immediately, no celebration
          setShowGameOver(true);
        } else {
          // Live win: burst animation + confetti + delayed overlay reveal
          setShowBurst(true);
          clearTimeout(burstTimeoutRef.current);
          burstTimeoutRef.current = setTimeout(() => setShowBurst(false), 1000);
          clearTimeout(gameOverTimerRef.current);
          gameOverTimerRef.current = setTimeout(() => setShowGameOver(true), 1200);
          // Launch confetti
          requestAnimationFrame(() => {
            if (confettiCanvasRef.current && state.winner !== null) {
              launchConfetti(
                confettiCanvasRef.current,
                COLOR_HEX[PLAYER_COLORS[state.winner]],
                confettiAnimRef,
              );
            }
          });
        }
      }
      if (state.winner === null) {
        setShowGameOver(false);
        clearTimeout(gameOverTimerRef.current);
      }
      isInitialLoadRef.current = false;
    }).then(unsub => {
      if (cancelled) {
        unsub();
      } else {
        unsubscribe = unsub;
      }
    }).catch(err => {
      if (!cancelled) {
        console.error('[Snakes] Subscribe failed:', err);
        setError('Connection lost. Please rejoin.');
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [gameCode, startTokenAnimation]);

  // --- Emoji reactions subscription ---

  useEffect(() => {
    if (!gameCode || gamePhase !== 'playing') return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    const MAX_FLOATING_REACTIONS = 15;
    subscribeToReactions(gameCode, (reaction) => {
      if (cancelled) return;
      const id = `${reaction.key}-${reaction.ts}`;
      const newItem = { id, emoji: reaction.emoji, player: reaction.player, left: 20 + Math.random() * 60 };
      setFloatingReactions(prev => {
        const next = [...prev, newItem];
        if (next.length <= MAX_FLOATING_REACTIONS) return next;
        // Evict oldest, clean up their removal timers (idempotent — safe in updater)
        const keep = next.slice(-MAX_FLOATING_REACTIONS);
        const evictedIds = new Set(next.slice(0, next.length - MAX_FLOATING_REACTIONS).map(r => r.id));
        for (const eid of evictedIds) {
          const t = reactionTimers.current.get(eid);
          if (t) { clearTimeout(t); reactionTimers.current.delete(eid); }
        }
        return keep;
      });
      reactionTimers.current.set(id, setTimeout(() => {
        setFloatingReactions(prev => prev.filter(r => r.id !== id));
        reactionTimers.current.delete(id);
      }, 3200));
    }).then(unsub => {
      if (cancelled) unsub(); else unsubscribe = unsub;
    });

    const cleanup = setInterval(() => cleanupOldReactions(gameCode), 15000);

    return () => {
      cancelled = true;
      unsubscribe?.();
      clearInterval(cleanup);
    };
  }, [gameCode, gamePhase]);

  // --- Turn timer ---

  useEffect(() => {
    if (gamePhase !== 'playing' || winner !== null) return;

    const interval = setInterval(() => {
      const serverNow = Date.now() + serverOffsetRef.current;
      const elapsed = (serverNow - turnStartedAtRef.current) / 1000;
      const remaining = Math.ceil(TURN_SECONDS - elapsed);

      // Safety: if moveInFlight has been stuck for 8s past timer expiry (18s total),
      // reset it. Scoped to the current player's client only — other clients use
      // the backup skip path, and resetting their moveInFlight would cause it to
      // rapid-fire. The per-turn guard prevents double auto-roll.
      if (remaining <= -8 && moveInFlightRef.current && !isRollingRef.current &&
          mySlotRef.current !== null && currentTurnRef.current === mySlotRef.current) {
        moveInFlightRef.current = false;
      }

      // Auto-roll at 0s for current player (once per turn via turnStartedAt guard)
      if (remaining <= 0 && mySlotRef.current !== null &&
          currentTurnRef.current === mySlotRef.current &&
          !isRollingRef.current && !moveInFlightRef.current &&
          lastAutoRollTurnStartRef.current !== turnStartedAtRef.current) {
        // Force-clear any lingering animation state that might block handleRollDice.
        // After 10s+ since turn start, all animations should have long completed;
        // stale refs here mean a timer was lost (e.g. tab throttled).
        if (tokenAnimPos.current.size > 0 || tokenSlideClass.current.size > 0) {
          for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
          tokenAnimTimers.current.clear();
          tokenAnimPos.current.clear();
          tokenAnimParity.current.clear();
          for (const t of slideTimerRefs.current.values()) clearTimeout(t);
          slideTimerRefs.current.clear();
          tokenSlideClass.current.clear();
          setRenderTick(n => n + 1); // re-render so dice button also re-enables
        }
        handleRollDiceRef.current();
        // Mark this turn as auto-rolled so we don't fire again if handleRollDice
        // succeeded (moveInFlight will be true), or if it failed transiently.
        if (moveInFlightRef.current) {
          lastAutoRollTurnStartRef.current = turnStartedAtRef.current;
        }
      }

      // Backup skip: only the next player in turn order attempts it (prevents race)
      const nextPlayer = (currentTurnRef.current + 1) % activePlayerCountRef.current;
      if (remaining <= -BACKUP_GRACE &&
          mySlotRef.current === nextPlayer &&
          !moveInFlightRef.current) {
        moveInFlightRef.current = true;
        const roll = Math.floor(Math.random() * 6) + 1;
        const currentPos = positionsRef.current[currentTurnRef.current];
        const result = resolveMove(currentPos, roll);
        const turnResult = getNextTurn(currentTurnRef.current, roll, activePlayerCountRef.current, consecutiveSixesRef.current);
        const newPositions = [...positionsRef.current];
        newPositions[currentTurnRef.current] = result.finalPos;
        const winnerIdx = checkWinner(newPositions);

        const entry: MoveLogEntry = {
          player: currentTurnRef.current, dice: roll, from: currentPos, to: result.finalPos, mechanism: result.landed,
        };
        const newLog = [...moveLogRef.current, entry].slice(-MAX_LOG_ENTRIES);

        makeMove(gameCodeRef.current!, currentTurnRef.current, {
          positions: serializePositions(newPositions),
          currentTurn: winnerIdx !== null ? currentTurnRef.current : turnResult.nextTurn,
          diceValue: roll,
          consecutiveSixes: turnResult.nextSixes,
          winner: winnerIdx,
          turnStartedAt: Date.now() + serverOffsetRef.current,
          moveLog: serializeMoveLog(newLog),
        }).then(committed => {
          if (!committed) moveInFlightRef.current = false;
        }).catch(() => { moveInFlightRef.current = false; });
      }
    }, 500);

    return () => clearInterval(interval);
  }, [gamePhase, winner]);

  // --- Game actions ---

  const handleCreateGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    cleanupOldGames().catch(() => {}); // fire-and-forget stale game cleanup
    try {
      const code = await createGame(sessionId, userName, playerCount);
      setGameCode(code);
      setMySlot(0);
      setGamePhase('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, userName, playerCount]);

  const handleJoinGame = useCallback(async () => {
    if (joinCode.length !== 4) { setError('Enter a 4-character code'); return; }
    setIsLoading(true);
    setError(null);
    try {
      const { assignedSlot } = await joinGame(joinCode, sessionId, userName, serverOffsetRef.current);
      setGameCode(joinCode);
      setMySlot(assignedSlot);
      setGamePhase('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode, sessionId, userName]);

  const handleSpectateGame = useCallback(async () => {
    if (joinCode.length !== 4) { setError('Enter a 4-character code'); return; }
    setIsLoading(true);
    setError(null);
    try {
      await spectateGame(joinCode);
      setGameCode(joinCode);
      setIsSpectating(true);
      // Start in 'waiting' — Firebase subscription transitions to 'playing' once data arrives,
      // avoiding a flash of empty board
      setGamePhase('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode]);

  // Vote for rematch — game resets when all players have voted
  const handleVoteRematch = useCallback(async () => {
    if (!gameCode || mySlot === null) return;
    try {
      await voteRematch(gameCode, mySlot);
    } catch (err) {
      console.error('[Snakes] Vote failed:', err);
    }
  }, [gameCode, mySlot]);

  // Actually reset the game (called when all votes are in, or by solo override)
  const executeReset = useCallback(async () => {
    if (!gameCode) return;
    try {
      // Log game result to history before resetting
      if (winnerRef.current !== null) {
        const names: Record<number, string> = {};
        for (let i = 0; i < activePlayerCountRef.current; i++) {
          names[i] = playerNamesRef.current[i] || `Player ${i + 1}`;
        }
        logGameResult(sessionId, {
          code: gameCode,
          winner: winnerRef.current,
          winnerName: names[winnerRef.current] || 'Unknown',
          players: names,
          playerCount: activePlayerCountRef.current,
          totalMoves: moveLogRef.current.length,
          timestamp: Date.now(),
        }).catch(() => {});
      }

      setShowGameOver(false);
      clearTimeout(gameOverTimerRef.current);

      await resetGame(gameCode, activePlayerCount, serverOffsetRef.current);

      // Only clear local state after Firebase write succeeds
      tokenAnimPos.current.clear();
      tokenAnimParity.current.clear();
      for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
      tokenAnimTimers.current.clear();
      tokenSlideClass.current.clear();
      for (const t of slideTimerRefs.current.values()) clearTimeout(t);
      slideTimerRefs.current.clear();
      for (const t of boardEntranceTimers.current.values()) clearTimeout(t);
      boardEntranceTimers.current.clear();
      for (const t of reactionTimers.current.values()) clearTimeout(t);
      reactionTimers.current.clear();
      clearTimeout(hintTimeoutRef.current);
      clearTimeout(rollTimeoutRef.current);
      clearTimeout(turnTransitionTimeoutRef.current);
      clearTimeout(burstTimeoutRef.current);
      clearTimeout(coinTossFadeRef.current);
      clearTimeout(coinTossRemoveRef.current);
      clearTimeout(cameraShakeTimeoutRef.current);
      lastMovedPlayerRef.current = null;
      tokenEnteredBoard.current.clear();
      moveInFlightRef.current = false;
      isRollingRef.current = false;
      lastAutoRollTurnStartRef.current = 0;
      coinTossShownRef.current = false;
      setShowCoinToss(false);
      setCoinTossFading(false);
      setCameraShake(null);
      setIsRolling(false);
      prevPositionsRef.current = '';
      prevGameFingerprintRef.current = '';
      prevMoveLogStringRef.current = '';
      isInitialLoadRef.current = false;
      setHasRolledThisTurn(false);
      if (confettiAnimRef.current) cancelAnimationFrame(confettiAnimRef.current);
    } catch (err) {
      console.error('[Snakes] Reset failed:', err);
      setShowGameOver(true);
    }
  }, [gameCode, activePlayerCount, sessionId]);

  // Trigger reset when all players vote for rematch
  useEffect(() => {
    if (winner === null) return;
    const voteCount = Object.keys(rematchVotes).length;
    if (voteCount > 0 && voteCount >= activePlayerCount) {
      executeReset();
    }
  }, [rematchVotes, activePlayerCount, winner, executeReset]);

  const handleBackToLobby = useCallback(() => {
    setGamePhase('lobby');
    setGameCode(null);
    setMySlot(null);
    setIsSpectating(false);
    setPlayerNames({});
    setError(null);
    setPositions([]);
    setWinner(null);
    setShowGameOver(false);
    clearTimeout(gameOverTimerRef.current);
    clearTimeout(rollTimeoutRef.current);
    clearTimeout(burstTimeoutRef.current);
    clearTimeout(hintTimeoutRef.current);
    clearTimeout(turnTransitionTimeoutRef.current);
    clearTimeout(coinTossFadeRef.current);
    clearTimeout(coinTossRemoveRef.current);
    clearTimeout(cameraShakeTimeoutRef.current);
    coinTossShownRef.current = false;
    setShowCoinToss(false);
    setCoinTossFading(false);
    setMoveLog([]);
    setHasRolledThisTurn(false);
    setIsRolling(false);
    isRollingRef.current = false;
    moveInFlightRef.current = false;
    lastAutoRollTurnStartRef.current = 0;
    prevPositionsRef.current = '';
    prevGameFingerprintRef.current = '';
    prevMoveLogStringRef.current = '';
    lastMovedPlayerRef.current = null;
    // Clear all animation timers (hop, slide, entrance, reactions) to prevent orphan callbacks
    tokenAnimPos.current.clear();
    tokenAnimParity.current.clear();
    for (const timer of tokenAnimTimers.current.values()) clearTimeout(timer);
    tokenAnimTimers.current.clear();
    tokenSlideClass.current.clear();
    for (const t of slideTimerRefs.current.values()) clearTimeout(t);
    slideTimerRefs.current.clear();
    for (const t of boardEntranceTimers.current.values()) clearTimeout(t);
    boardEntranceTimers.current.clear();
    tokenEnteredBoard.current.clear();
    for (const t of reactionTimers.current.values()) clearTimeout(t);
    reactionTimers.current.clear();
    setWinTally({});
    setGameNumber(1);
    setFloatingReactions([]);
    if (confettiAnimRef.current) cancelAnimationFrame(confettiAnimRef.current);
  }, []);

  // --- Drag ---

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.closeBtn}`)) return;
    e.preventDefault();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: positionRef.current.x,
      posY: positionRef.current.y,
    };
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: Math.max(-600, Math.min(window.innerWidth - 80, dragStartRef.current.posX + dx)),
        y: Math.max(0, Math.min(window.innerHeight - 40, dragStartRef.current.posY + dy)),
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragCleanupRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    dragCleanupRef.current = onUp;
  }, []);

  // --- Board rendering ---


  const gameStats = useMemo(
    () => winner !== null && moveLog.length > 0 ? computeGameStats(moveLog, activePlayerCount) : null,
    [winner, moveLog, activePlayerCount],
  );

  const mvpAwards = useMemo(
    () => gameStats && winner !== null ? computeMvpAwards(gameStats, winner, activePlayerCount) : [],
    [gameStats, winner, activePlayerCount],
  );

  const boardWear = useMemo(() => Math.min(moveLog.length / 50, 1), [moveLog.length]);

  const recentMoves = useMemo(() => moveLog.slice(-10).reverse(), [moveLog]);

  const shareResultText = useMemo(() => {
    if (winner === null || !gameStats) return '';
    const winnerName = playerNames[winner] || COLOR_LABELS[PLAYER_COLORS[winner]];
    const lines = [`\u{1F40D} Snakes & Ladders: ${winnerName} won in ${gameStats[winner]?.totalMoves || '?'} moves!`];
    for (let i = 0; i < activePlayerCount; i++) {
      const s = gameStats[i];
      if (!s || s.totalMoves === 0) continue;
      const name = playerNames[i] || COLOR_LABELS[PLAYER_COLORS[i]];
      const parts = [`${name}: ${s.totalMoves} moves`];
      if (s.snakesHit > 0) parts.push(`${s.snakesHit} snakes`);
      if (s.laddersClimbed > 0) parts.push(`${s.laddersClimbed} ladders`);
      lines.push(parts.join(', '));
    }
    return lines.join('\n');
  }, [winner, gameStats, playerNames, activePlayerCount]);

  const snakeLadderSVG = useMemo(() => (
    <svg className={styles.svgOverlay} viewBox="0 0 150 100" preserveAspectRatio="none">
      {Object.entries(LADDERS).map(([from, to], i) => renderLadderSVG(Number(from), to, i))}
      {Object.entries(SNAKES).map(([from, to], i) => renderSnakeSVG(Number(from), to, i))}
    </svg>
  ), []);

  function renderToken(playerIdx: number) {
    const pos = positions[playerIdx];
    const animCoords = tokenAnimPos.current.get(playerIdx);

    if ((pos === undefined || pos <= 0) && !animCoords) {
      return null;
    }
    const isStepping = !!animCoords;
    const stepParity = tokenAnimParity.current.get(playerIdx) ?? 0;
    const slideClass = tokenSlideClass.current.get(playerIdx);
    const isEntering = tokenEnteredBoard.current.has(playerIdx);
    const isArriving = !isStepping && !slideClass && !isEntering && lastMovedPlayerRef.current === playerIdx && diceValue !== null && !isRolling;

    const color = PLAYER_COLORS[playerIdx];
    let left: number, top: number;

    if (animCoords) {
      // During hop animation
      left = animCoords[1] * COL_PCT + COL_PCT / 2;
      top = animCoords[0] * ROW_PCT + ROW_PCT / 2;
    } else if (pos > 0) {
      const [pctLeft, pctTop] = cellToPercent(pos);
      const [dx, dy] = getTokenOffset(positions, playerIdx);
      left = pctLeft + dx;
      top = pctTop + dy;
    } else {
      return null;
    }

    // Center the token on the point
    const halfToken = TOKEN_SIZE_PCT / 2;

    return (
      <div
        key={`token-${playerIdx}`}
        className={[
          styles.token,
          TOKEN_STYLE[color],
          isStepping ? (stepParity ? styles.tokenSteppingB : styles.tokenSteppingA) : '',
          slideClass ? `${styles.tokenSliding} ${slideClass}` : '',
          isEntering ? styles.tokenEntering : '',
          isArriving ? styles.tokenArriving : '',
        ].filter(Boolean).join(' ')}
        style={{
          left: `${left - halfToken}%`,
          top: `${top - halfToken}%`,
        }}
        aria-label={`${COLOR_LABELS[color]} token on cell ${pos}`}
      >
        {isArriving && DUST_DIRS.map(([dx, dy], i) => (
          <span
            key={`dust-${i}`}
            className={styles.dustParticle}
            style={{ '--dust-dx': dx, '--dust-dy': dy } as React.CSSProperties}
          />
        ))}
      </div>
    );
  }

  // --- Render ---

  return (
    <div className={styles.popup} style={{ left: position.x, top: position.y }}>
      {/* Title bar */}
      <div className={styles.titleBar} onMouseDown={handleDragStart}>
        <span className={styles.titleText}>
          <span>🐍</span>
          Snakes & Ladders
          {gameCode && gamePhase === 'playing' && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              #{gameCode}
            </span>
          )}
          {isSpectating && gamePhase === 'playing' && (
            <span className={styles.spectateBadge}>Spectating</span>
          )}
        </span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close Snakes & Ladders">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <SnakesErrorBoundary onReset={handleBackToLobby}>
      <div className={styles.gameArea}>

        {/* === LOBBY / WAITING === */}
        {(gamePhase === 'lobby' || gamePhase === 'waiting') && (
          <SnakesLobby
            gamePhase={gamePhase}
            playerCount={playerCount}
            onPlayerCountChange={setPlayerCount}
            onCreateGame={handleCreateGame}
            joinCode={joinCode}
            onJoinCodeChange={(code) => { setJoinCode(code); setError(null); }}
            onJoinGame={handleJoinGame}
            onSpectateGame={handleSpectateGame}
            gameHistory={gameHistory}
            userName={userName}
            isLoading={isLoading}
            error={error}
            gameCode={gameCode}
            mySlot={mySlot}
            isSpectating={isSpectating}
            playerNames={playerNames}
            statusHint={statusHint}
            onShowHint={showHint}
            onBackToLobby={handleBackToLobby}
          />
        )}

        {/* === PLAYING === */}
        {gamePhase === 'playing' && (
          <div className={styles.playingLayout}>
            {/* Board */}
            <div className={styles.boardColumn}>
              <div className={[
                styles.boardWrapper,
                cameraShake === 'snake' ? styles.cameraShakeSnake : '',
                cameraShake === 'ladder' ? styles.cameraShakeLadder : '',
                cameraShake === 'snakeLight' ? styles.cameraShakeSnakeLight : '',
                cameraShake === 'ladderLight' ? styles.cameraShakeLadderLight : '',
              ].filter(Boolean).join(' ')}>
                <div className={styles.board} style={{ '--board-wear': boardWear } as React.CSSProperties}>
                  {BOARD_CELLS.map(cellNum => (
                    <BoardCell
                      key={cellNum}
                      cellNum={cellNum}
                    />
                  ))}
                </div>
                {snakeLadderSVG}
                {/* Tokens */}
                {Array.from({ length: activePlayerCount }, (_, i) => renderToken(i))}
                {/* Winner burst */}
                {showBurst && winner !== null && (
                  <div
                    className={`${styles.burst} ${styles.burstActive}`}
                    style={{
                      background: `radial-gradient(circle, ${COLOR_HEX[PLAYER_COLORS[winner]]}33 0%, transparent 70%)`,
                    }}
                  />
                )}
                <canvas ref={confettiCanvasRef} className={styles.confettiCanvas} />
                {floatingReactions.map(r => (
                  <div key={r.id} className={styles.floatingReaction} style={{ left: `${r.left}%` }}>
                    {r.emoji}
                  </div>
                ))}
              </div>
            </div>

            {/* Side panel */}
            <div className={styles.sidePanel}>
              {/* Turn indicator */}
              <div className={styles.turnIndicator}>
                <span
                  className={`${styles.statusDot} ${turnTransitioning ? styles.statusDotTransition : ''}`}
                  style={{ background: COLOR_HEX[PLAYER_COLORS[currentTurn]] }}
                />
                {winner !== null ? (
                  <span className={styles.winText}>
                    {playerNames[winner] || COLOR_LABELS[PLAYER_COLORS[winner]]} wins!
                  </span>
                ) : (
                  <span>
                    {isMyTurn ? 'Your turn' : `${playerNames[currentTurn] || COLOR_LABELS[PLAYER_COLORS[currentTurn]]}'s turn`}
                  </span>
                )}
              </div>

              {/* Countdown timer */}
              {winner === null && (
                <CountdownTimer
                  key={`${currentTurn}-${turnStartedAtState}`}
                  turnStartedAt={turnStartedAtState}
                  serverOffset={serverOffsetState}
                />
              )}

              {statusHint && gamePhase === 'playing' && (
                <div className={styles.statusHint}>{statusHint}</div>
              )}

              {/* Dice */}
              <div className={styles.sideDice}>
                <button
                  className={[
                    styles.dice,
                    isMyTurn && !isRolling && !isAnimating && winner === null ? styles.diceActive : '',
                    isRolling ? styles.diceRolling : '',
                  ].filter(Boolean).join(' ')}
                  onClick={handleRollDice}
                  disabled={!isMyTurn || isRolling || winner !== null || isAnimating}
                  aria-label="Roll dice"
                >
                  {isRolling ? (
                    <DiceFace value={rollingFace} />
                  ) : diceValue ? (
                    <div className={styles.diceResult}>
                      <DiceFace value={diceValue} />
                    </div>
                  ) : (
                    <DiceFace value={1} />
                  )}
                </button>
                {isMyTurn && !isRolling && !isAnimating && !hasRolledThisTurn && !winner && (
                  <span className={styles.rollReminder}>Roll!</span>
                )}
                {consecutiveSixes > 0 && winner === null && (
                  <span className={`${styles.streakBadge} ${consecutiveSixes >= 2 ? styles.streakDanger : ''}`}>
                    {'\u{1F525}'.repeat(consecutiveSixes)}
                  </span>
                )}
                {isAnimating && !isMyTurn && (
                  <span className={styles.statusHint}>Moving...</span>
                )}
              </div>

              {/* Emoji reactions — spectators can react too */}
              {winner === null && (
                <div className={styles.reactionBar}>
                  {['\u{1F602}', '\u{1F389}', '\u{1F631}', '\u{1F44F}', '\u{1F40D}'].map(emoji => (
                    <button
                      key={emoji}
                      className={styles.reactionBtn}
                      onClick={() => {
                        const now = Date.now();
                        if (now - lastReactionTimeRef.current < 2000) return;
                        lastReactionTimeRef.current = now;
                        if (gameCode) {
                          sendReaction(gameCode, mySlot ?? -1, emoji).catch(() => {});
                        }
                      }}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}

              {/* Player list */}
              <div className={`${styles.playerBar} ${styles.playerBarVertical}`}>
                {Array.from({ length: activePlayerCount }, (_, i) => {
                  const color = PLAYER_COLORS[i];
                  const name = playerNames[i] || COLOR_LABELS[color];
                  const isCurrent = currentTurn === i && !winner;
                  const isMe = mySlot === i;
                  const isWinner = winner === i;
                  const isDimmed = winner !== null && winner !== i;
                  const isNearWin = !winner && positions[i] >= BOARD_SIZE - 6 && positions[i] > 0;
                  const serverNow = Date.now() + serverOffsetState;
                  const lastSeen = playerPresence[i] || 0;
                  const isOnline = isMe || (serverNow - lastSeen < 30000);

                  return (
                    <div
                      key={i}
                      className={[
                        styles.playerChip,
                        isCurrent ? styles.playerChipActive : '',
                        isMe ? styles.playerChipMe : '',
                        isWinner ? styles.playerChipWinner : '',
                        isDimmed ? styles.playerChipDimmed : '',
                        isNearWin ? styles.playerChipNearWin : '',
                      ].filter(Boolean).join(' ')}
                    >
                      <span className={styles.playerChipDot} style={{ background: COLOR_HEX[color] }}>
                        <span className={isOnline ? styles.presenceOnline : styles.presenceOffline} />
                      </span>
                      <span>{name}</span>
                      {isMe && <span className={styles.youBadge}>(you)</span>}
                      {!isOnline && !isMe && <span className={styles.disconnectedBadge}>offline</span>}
                      {(winTally[i] || 0) > 0 && (
                        <span className={styles.winBadge}>{'\u{1F3C6}'}{winTally[i]}</span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: '0.6rem', opacity: 0.5 }}>
                        {positions[i] > 0 ? positions[i] : '-'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Move log */}
              {moveLog.length > 0 && (
                <div className={styles.moveLog}>
                  <div className={styles.moveLogLabel}>Recent Moves</div>
                  <div className={styles.moveLogEntries}>
                    {recentMoves.map((entry, idx) => {
                      const logIdx = moveLog.length - 1 - idx;
                      const color = PLAYER_COLORS[entry.player];
                      const name = playerNames[entry.player] || COLOR_LABELS[color];
                      return (
                        <div key={logIdx} className={styles.moveLogEntry}>
                          <span className={styles.moveLogDot} style={{ background: COLOR_HEX[color] }} />
                          <span>{name}</span>
                          <span style={{ opacity: 0.6 }}>rolled {entry.dice}:</span>
                          <span>{entry.from || 'start'} &rarr; {entry.to === entry.from ? 'stay' : entry.to}</span>
                          {entry.mechanism === 'snake' && (
                            <span className={`${styles.moveLogMechanism} ${styles.moveLogSnake}`}>snake!</span>
                          )}
                          {entry.mechanism === 'ladder' && (
                            <span className={`${styles.moveLogMechanism} ${styles.moveLogLadder}`}>ladder!</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className={styles.sideSpacer} />
            </div>

            {/* Coin toss overlay */}
            {showCoinToss && coinTossResult !== null && (
              <div className={`${styles.gameOverOverlay} ${coinTossFading ? styles.coinTossOverlayFadeOut : ''}`}>
                <div className={styles.coinTossCard}>
                  <div className={styles.coinTossLabel}>Who goes first?</div>
                  <div className={styles.coinTossSpin}>
                    <span
                      className={styles.coinTossToken}
                      style={{
                        background: `radial-gradient(circle at 35% 35%, ${COLOR_HEX[PLAYER_COLORS[coinTossResult]]}cc, ${COLOR_HEX[PLAYER_COLORS[coinTossResult]]})`,
                        boxShadow: `0 0 24px ${COLOR_HEX[PLAYER_COLORS[coinTossResult]]}60, 0 4px 12px rgba(0,0,0,0.3)`,
                      }}
                    />
                  </div>
                  <div className={styles.coinTossText}>
                    {playerNames[coinTossResult] || COLOR_LABELS[PLAYER_COLORS[coinTossResult]]} goes first!
                  </div>
                </div>
              </div>
            )}

            {/* Game-over overlay (delayed to let animations finish) */}
            {showGameOver && winner !== null && (
              <SnakesGameOver
                winner={winner}
                mySlot={mySlot}
                isSpectating={isSpectating}
                playerNames={playerNames}
                activePlayerCount={activePlayerCount}
                winTally={winTally}
                gameNumber={gameNumber}
                gameStats={gameStats}
                mvpAwards={mvpAwards}
                shareResultText={shareResultText}
                rematchVotes={rematchVotes}
                onShowHint={showHint}
                onVoteRematch={handleVoteRematch}
                onBackToLobby={handleBackToLobby}
              />
            )}
          </div>
        )}
      </div>
      </SnakesErrorBoundary>
    </div>
  );
}
