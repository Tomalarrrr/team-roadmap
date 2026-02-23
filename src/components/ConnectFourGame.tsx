import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createGame,
  joinGame,
  spectateGame,
  subscribeToGame,
  makeMove,
  resetGame,
  type ConnectFourGameState,
} from '../connectFourFirebase';
import styles from './ConnectFourGame.module.css';

const ROWS = 6;
const COLS = 8;
const TURN_SECONDS = 30;

type Color = 'red' | 'yellow';
type Cell = Color | null;
type Board = Cell[][];

interface ConnectFourGameProps {
  onClose: () => void;
  isSearchOpen: boolean;
}

// --- Pure helpers (unchanged) ---

function createEmptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function checkWin(board: Board, row: number, col: number, color: Color): [number, number][] | null {
  const directions = [
    [0, 1],   // horizontal
    [1, 0],   // vertical
    [1, 1],   // diagonal descending
    [-1, 1],  // diagonal ascending
  ];

  for (const [dr, dc] of directions) {
    const cells: [number, number][] = [[row, col]];
    for (let i = 1; i < 4; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === color) {
        cells.push([r, c]);
      } else break;
    }
    for (let i = 1; i < 4; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === color) {
        cells.push([r, c]);
      } else break;
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

function isBoardFull(board: Board): boolean {
  return board[0].every(cell => cell !== null);
}

// --- Board serialization for Firebase ---

function serializeBoard(board: Board): string {
  return board.flat().map(c => c === 'red' ? 'r' : c === 'yellow' ? 'y' : '.').join('');
}

function deserializeBoard(str: string): Board {
  const board: Board = [];
  for (let i = 0; i < ROWS; i++) {
    const row: Cell[] = [];
    for (let j = 0; j < COLS; j++) {
      const ch = str[i * COLS + j];
      row.push(ch === 'r' ? 'red' : ch === 'y' ? 'yellow' : null);
    }
    board.push(row);
  }
  return board;
}

function serializeWinningCells(cells: [number, number][]): string {
  return cells.map(([r, c]) => `${r},${c}`).join('|');
}

function deserializeWinningCells(str: string | null): [number, number][] {
  if (!str) return [];
  return str.split('|').map(pair => {
    const [r, c] = pair.split(',').map(Number);
    return [r, c] as [number, number];
  });
}

// --- Component ---

export function ConnectFourGame({ onClose, isSearchOpen }: ConnectFourGameProps) {
  // Session info (matches App.tsx pattern)
  const sessionId = sessionStorage.getItem('roadmap-user-id') || 'anonymous';
  const userName = sessionStorage.getItem('roadmap-user-name') || 'Player';

  // Multiplayer state
  const [gamePhase, setGamePhase] = useState<'lobby' | 'waiting' | 'playing'>('lobby');
  const [gameCode, setGameCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [isSpectating, setIsSpectating] = useState(false);
  const [opponentName, setOpponentName] = useState<string | null>(null);
  const [redName, setRedName] = useState<string | null>(null);
  const [yellowName, setYellowName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Game state (driven by Firebase subscription)
  const [board, setBoard] = useState<Board>(createEmptyBoard);
  const [currentPlayer, setCurrentPlayer] = useState<Color>('red');
  const [startingColor, setStartingColor] = useState<Color>('red');
  const [winner, setWinner] = useState<Color | 'draw' | null>(null);
  const [winningCells, setWinningCells] = useState<[number, number][]>([]);
  const [droppingCell, setDroppingCell] = useState<{ row: number; col: number } | null>(null);
  const [showBurst, setShowBurst] = useState(false);
  const [timeLeft, setTimeLeft] = useState(TURN_SECONDS);

  // Drag state
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (window.innerWidth - 420) / 2),
    y: Math.max(0, (window.innerHeight - 520) / 2),
  }));
  const positionRef = useRef(position);
  positionRef.current = position;
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Track previous board string for drop animation detection
  const prevBoardRef = useRef<string>('.'.repeat(48));
  // Prevent double-moves during Firebase round-trip
  const moveInFlightRef = useRef(false);
  // Track dropping animation timer for cleanup
  const droppingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Refs for timer effect (avoids stale closures + unnecessary effect restarts)
  const turnStartedAtRef = useRef<number>(Date.now());
  const boardRef = useRef<Board>(board);
  boardRef.current = board;
  const myColorRef = useRef(myColor);
  myColorRef.current = myColor;
  const currentPlayerRef = useRef(currentPlayer);
  currentPlayerRef.current = currentPlayer;
  const winnerRef = useRef(winner);
  winnerRef.current = winner;

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSearchOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSearchOpen]);

  // Cleanup timers + listeners on unmount
  useEffect(() => {
    return () => {
      clearTimeout(droppingTimeoutRef.current);
      dragCleanupRef.current?.();
    };
  }, []);

  // Firebase subscription
  useEffect(() => {
    if (!gameCode) return;

    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    subscribeToGame(gameCode, (state: ConnectFourGameState | null) => {
      if (cancelled || !state) return;

      // Detect newly placed piece for drop animation
      if (state.board !== prevBoardRef.current) {
        for (let i = 0; i < state.board.length; i++) {
          if (state.board[i] !== prevBoardRef.current[i] && state.board[i] !== '.') {
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            setDroppingCell({ row, col });
            clearTimeout(droppingTimeoutRef.current);
            droppingTimeoutRef.current = setTimeout(() => setDroppingCell(null), 350);
            break;
          }
        }
        prevBoardRef.current = state.board;
        // Board changed — allow next move
        moveInFlightRef.current = false;
      }

      // Update game state from Firebase
      setBoard(deserializeBoard(state.board));
      setCurrentPlayer(state.currentTurn as Color);
      if (state.startingColor) setStartingColor(state.startingColor as Color);
      if (state.turnStartedAt) turnStartedAtRef.current = state.turnStartedAt;

      if (state.winner) {
        setWinner(state.winner as Color | 'draw');
        setWinningCells(deserializeWinningCells(state.winningCells));
        if (state.winner !== 'draw') setShowBurst(true);
      } else {
        setWinner(null);
        setWinningCells([]);
        setShowBurst(false);
      }

      // Track player names
      setRedName(state.players.red.name);
      if (state.players.yellow) setYellowName(state.players.yellow.name);

      // Check if opponent joined (transition from waiting → playing)
      if (state.players.yellow) {
        setGamePhase(prev => prev === 'waiting' ? 'playing' : prev);
        if (!isSpectating) {
          const otherColor = myColor === 'red' ? 'yellow' : 'red';
          const opponent = state.players[otherColor];
          if (opponent) setOpponentName(opponent.name);
        }
      }
    }).then(unsub => {
      if (cancelled) {
        unsub(); // Effect already cleaned up — unsubscribe immediately
      } else {
        unsubscribe = unsub;
      }
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [gameCode, myColor, isSpectating]);

  // --- Handlers ---

  const handleCreateGame = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const code = await createGame(sessionId, userName);
      setGameCode(code);
      setMyColor('red');
      setGamePhase('waiting');
      prevBoardRef.current = '.'.repeat(48);
    } catch {
      setError('Failed to create game. Try again.');
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, userName]);

  const handleJoinGame = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) {
      setError('Enter a 4-character game code');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { assignedColor, state } = await joinGame(code, sessionId, userName);
      setGameCode(code);
      setMyColor(assignedColor);
      setGamePhase(state.players.yellow ? 'playing' : 'waiting');
      prevBoardRef.current = '.'.repeat(48);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode, sessionId, userName]);

  const handleSpectateGame = useCallback(async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 4) {
      setError('Enter a 4-character game code');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await spectateGame(code);
      setGameCode(code);
      setMyColor(null);
      setIsSpectating(true);
      setGamePhase('playing');
      prevBoardRef.current = '.'.repeat(48);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode]);

  const dropPiece = useCallback((col: number) => {
    if (!gameCode || !myColor) return;
    if (winner || moveInFlightRef.current) return;
    if (myColor !== currentPlayer) return;

    let targetRow = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r][col]) {
        targetRow = r;
        break;
      }
    }
    if (targetRow === -1) return;

    // Lock moves until Firebase round-trip completes
    moveInFlightRef.current = true;

    const newBoard = board.map(row => [...row]);
    newBoard[targetRow][col] = currentPlayer;

    const nextTurn: Color = currentPlayer === 'red' ? 'yellow' : 'red';
    const winCells = checkWin(newBoard, targetRow, col, currentPlayer);
    const newWinner = winCells ? currentPlayer : isBoardFull(newBoard) ? 'draw' : null;

    makeMove(
      gameCode,
      serializeBoard(newBoard),
      newWinner ? currentPlayer : nextTurn,
      newWinner,
      winCells ? serializeWinningCells(winCells) : null
    ).catch(() => {
      // Unlock on failure so the player can retry
      moveInFlightRef.current = false;
    });
  }, [gameCode, myColor, board, currentPlayer, winner]);

  // Ref for dropPiece so timer effect can call it without stale closures
  const dropPieceRef = useRef(dropPiece);
  dropPieceRef.current = dropPiece;

  // Turn timer — counts down and auto-places a random piece when time expires
  useEffect(() => {
    if (gamePhase !== 'playing') return;

    const tick = () => {
      if (winnerRef.current) {
        setTimeLeft(TURN_SECONDS);
        return;
      }

      const elapsed = Math.floor((Date.now() - turnStartedAtRef.current) / 1000);
      const remaining = Math.max(0, TURN_SECONDS - elapsed);
      setTimeLeft(remaining);

      // Auto-move: only the current player's client enforces the timer
      if (remaining <= 0 && myColorRef.current === currentPlayerRef.current && !moveInFlightRef.current) {
        const currentBoard = boardRef.current;
        const validCols: number[] = [];
        for (let c = 0; c < COLS; c++) {
          if (!currentBoard[0][c]) validCols.push(c);
        }
        if (validCols.length > 0) {
          const randomCol = validCols[Math.floor(Math.random() * validCols.length)];
          dropPieceRef.current(randomCol);
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [gamePhase]);

  const handleNewGame = useCallback(async () => {
    if (!gameCode) return;
    try {
      moveInFlightRef.current = false;
      const nextStarter: Color = startingColor === 'red' ? 'yellow' : 'red';
      await resetGame(gameCode, nextStarter);
      prevBoardRef.current = '.'.repeat(48);
    } catch {
      // Silent failure for easter egg
    }
  }, [gameCode, startingColor]);

  const handleBackToLobby = useCallback(() => {
    setGamePhase('lobby');
    setGameCode(null);
    setMyColor(null);
    setIsSpectating(false);
    setOpponentName(null);
    setError(null);
    setBoard(createEmptyBoard());
    setCurrentPlayer('red');
    setWinner(null);
    setWinningCells([]);
    setShowBurst(false);
    prevBoardRef.current = '.'.repeat(48);
    moveInFlightRef.current = false;
    clearTimeout(droppingTimeoutRef.current);
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.closeBtn}`)) return;
    e.preventDefault();
    dragCleanupRef.current?.();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: positionRef.current.x,
      posY: positionRef.current.y,
    };
    const handleMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStartRef.current.mouseX;
      const dy = ev.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: Math.max(0, dragStartRef.current.posY + dy),
      });
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      dragCleanupRef.current = null;
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    dragCleanupRef.current = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // --- Derived values ---

  const isMyTurn = myColor === currentPlayer;
  const isWinningCell = (row: number, col: number) =>
    winningCells.some(([r, c]) => r === row && c === col);

  const statusMessage = isSpectating
    ? winner === 'draw'
      ? 'DRAW!'
      : winner
        ? `${winner === 'red' ? redName || 'Red' : yellowName || 'Yellow'} wins!`
        : `${currentPlayer === 'red' ? redName || 'Red' : yellowName || 'Yellow'}'s turn`
    : winner === 'draw'
      ? 'DRAW!'
      : winner
        ? winner === myColor ? 'You win!' : `${opponentName} wins!`
        : isMyTurn
          ? 'Your turn'
          : `${opponentName || 'Opponent'}'s turn`;

  // --- Render ---

  return (
    <div
      className={styles.popup}
      style={{ left: position.x, top: position.y }}
    >
      {/* Title bar */}
      <div className={styles.titleBar} onMouseDown={handleDragStart}>
        <span className={styles.titleText}>
          <span>🔴🟡</span>
          Connect Four
          {gameCode && gamePhase === 'playing' && (
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              #{gameCode}
            </span>
          )}
          {isSpectating && gamePhase === 'playing' && (
            <span className={styles.spectateBadge}>Spectating</span>
          )}
        </span>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close Connect Four"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Game area */}
      <div className={styles.gameArea}>

        {/* === LOBBY === */}
        {gamePhase === 'lobby' && (
          <div className={styles.lobby}>
            <button
              className={styles.createBtn}
              onClick={handleCreateGame}
              disabled={isLoading}
            >
              {isLoading ? 'Creating...' : 'Create Game'}
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
              <button
                className={styles.joinBtn}
                onClick={handleJoinGame}
                disabled={isLoading}
              >
                {isLoading ? 'Joining...' : 'Join'}
              </button>
              <button
                className={styles.spectateBtn}
                onClick={handleSpectateGame}
                disabled={isLoading}
              >
                Spectate
              </button>
            </div>
            {error && <div className={styles.errorText}>{error}</div>}
          </div>
        )}

        {/* === WAITING === */}
        {gamePhase === 'waiting' && (
          <div className={styles.lobby}>
            <div className={styles.waitingText}>Waiting for opponent...</div>
            <div className={styles.gameCodeDisplay}>{gameCode}</div>
            <div className={styles.shareHint}>Share this code with your opponent</div>
            <button className={styles.resetBtn} onClick={handleBackToLobby} style={{ marginTop: 8 }}>
              Back
            </button>
          </div>
        )}

        {/* === PLAYING === */}
        {gamePhase === 'playing' && (
          <>
            {/* Status */}
            <div className={styles.status}>
              <div className={styles.turnIndicator}>
                {winner && winner !== 'draw' ? (
                  <span className={styles.winText}>
                    <span className={`${styles.statusDot} ${styles[winner]}`} />
                    {' '}{statusMessage} 🎉
                  </span>
                ) : winner === 'draw' ? (
                  <span className={styles.winText}>{statusMessage}</span>
                ) : (
                  <>
                    <span className={`${styles.statusDot} ${styles[currentPlayer]}`} />
                    <span>{statusMessage}</span>
                    <span className={`${styles.timer} ${timeLeft <= 10 ? styles.timerUrgent : ''}`}>
                      {timeLeft}s
                    </span>
                  </>
                )}
              </div>
              {isSpectating ? (
                <button className={styles.resetBtn} onClick={handleBackToLobby}>
                  Leave
                </button>
              ) : (
                <button className={styles.resetBtn} onClick={handleNewGame}>
                  New Game
                </button>
              )}
            </div>

            {/* Board wrapper */}
            <div className={styles.boardWrapper}>
              {/* Column drop indicators */}
              {!winner && isMyTurn && (
                <div className={styles.columnIndicators}>
                  {Array.from({ length: COLS }, (_, col) => (
                    <button
                      key={col}
                      className={styles.columnBtn}
                      onClick={() => dropPiece(col)}
                      disabled={!!board[0][col]}
                      aria-label={`Drop ${currentPlayer} piece in column ${col + 1}`}
                    >
                      👇
                    </button>
                  ))}
                </div>
              )}

              {/* Board */}
              <div className={styles.board}>
                {board.map((row, rowIdx) =>
                  row.map((cell, colIdx) => {
                    const isDropping = droppingCell?.row === rowIdx && droppingCell?.col === colIdx;
                    const isWin = isWinningCell(rowIdx, colIdx);
                    const isLoser = winner && winner !== 'draw' && cell && cell !== winner;

                    return (
                      <div
                        key={`${rowIdx}-${colIdx}`}
                        className={[
                          styles.cell,
                          cell ? styles[cell] : '',
                          isDropping ? styles.dropping : '',
                          isWin ? styles.winning : '',
                          isLoser ? styles.loser : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => !winner && isMyTurn && dropPiece(colIdx)}
                        style={{ cursor: (!winner && isMyTurn && !cell) ? 'pointer' : 'default' }}
                        role="gridcell"
                        aria-label={`${cell ? `${cell} piece` : 'Empty'}, column ${colIdx + 1}, row ${rowIdx + 1}`}
                      />
                    );
                  })
                )}
              </div>

              {/* Winner burst */}
              {winner && winner !== 'draw' && (
                <div className={`${styles.burst} ${styles[winner]} ${showBurst ? styles.active : ''}`} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
