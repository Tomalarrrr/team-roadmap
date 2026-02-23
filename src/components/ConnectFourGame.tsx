import { useState, useEffect, useCallback, useRef } from 'react';
import {
  createGame,
  joinGame,
  subscribeToGame,
  makeMove,
  resetGame,
  type ConnectFourGameState,
} from '../connectFourFirebase';
import styles from './ConnectFourGame.module.css';

const ROWS = 6;
const COLS = 8;

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
  const [opponentName, setOpponentName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Game state (driven by Firebase subscription)
  const [board, setBoard] = useState<Board>(createEmptyBoard);
  const [currentPlayer, setCurrentPlayer] = useState<Color>('red');
  const [winner, setWinner] = useState<Color | 'draw' | null>(null);
  const [winningCells, setWinningCells] = useState<[number, number][]>([]);
  const [droppingCell, setDroppingCell] = useState<{ row: number; col: number } | null>(null);
  const [showBurst, setShowBurst] = useState(false);

  // Drag state
  const [position, setPosition] = useState(() => ({
    x: Math.max(0, (window.innerWidth - 420) / 2),
    y: Math.max(0, (window.innerHeight - 520) / 2),
  }));
  const dragStartRef = useRef({ mouseX: 0, mouseY: 0, posX: 0, posY: 0 });

  // Track previous board string for drop animation detection
  const prevBoardRef = useRef<string>('.'.repeat(48));

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSearchOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSearchOpen]);

  // Firebase subscription
  useEffect(() => {
    if (!gameCode) return;

    let unsubscribe: (() => void) | null = null;

    subscribeToGame(gameCode, (state: ConnectFourGameState | null) => {
      if (!state) return;

      // Detect newly placed piece for drop animation
      if (state.board !== prevBoardRef.current) {
        for (let i = 0; i < state.board.length; i++) {
          if (state.board[i] !== prevBoardRef.current[i] && state.board[i] !== '.') {
            const row = Math.floor(i / COLS);
            const col = i % COLS;
            setDroppingCell({ row, col });
            setTimeout(() => setDroppingCell(null), 350);
            break;
          }
        }
        prevBoardRef.current = state.board;
      }

      // Update game state from Firebase
      setBoard(deserializeBoard(state.board));
      setCurrentPlayer(state.currentTurn as Color);

      if (state.winner) {
        setWinner(state.winner as Color | 'draw');
        setWinningCells(deserializeWinningCells(state.winningCells));
        if (state.winner !== 'draw') setShowBurst(true);
      } else {
        setWinner(null);
        setWinningCells([]);
        setShowBurst(false);
      }

      // Check if opponent joined (transition from waiting → playing)
      if (state.players.yellow) {
        setGamePhase(prev => prev === 'waiting' ? 'playing' : prev);
        const otherColor = myColor === 'red' ? 'yellow' : 'red';
        const opponent = state.players[otherColor];
        if (opponent) setOpponentName(opponent.name);
      }
    }).then(unsub => {
      unsubscribe = unsub;
    });

    return () => { unsubscribe?.(); };
  }, [gameCode, myColor]);

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
      await joinGame(code, sessionId, userName);
      setGameCode(code);
      setMyColor('yellow');
      setGamePhase('playing');
      prevBoardRef.current = '.'.repeat(48);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Game not found');
    } finally {
      setIsLoading(false);
    }
  }, [joinCode, sessionId, userName]);

  const dropPiece = useCallback((col: number) => {
    if (!gameCode || !myColor) return;
    if (winner || droppingCell) return;
    if (myColor !== currentPlayer) return;

    let targetRow = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r][col]) {
        targetRow = r;
        break;
      }
    }
    if (targetRow === -1) return;

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
    );
  }, [gameCode, myColor, board, currentPlayer, winner, droppingCell]);

  const handleNewGame = useCallback(async () => {
    if (!gameCode) return;
    try {
      await resetGame(gameCode);
      prevBoardRef.current = '.'.repeat(48);
    } catch {
      // Silent failure for easter egg
    }
  }, [gameCode]);

  const handleBackToLobby = useCallback(() => {
    setGamePhase('lobby');
    setGameCode(null);
    setMyColor(null);
    setOpponentName(null);
    setError(null);
    setBoard(createEmptyBoard());
    setCurrentPlayer('red');
    setWinner(null);
    setWinningCells([]);
    setShowBurst(false);
    prevBoardRef.current = '.'.repeat(48);
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest(`.${styles.closeBtn}`)) return;
    e.preventDefault();
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.mouseX;
      const dy = e.clientY - dragStartRef.current.mouseY;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: Math.max(0, dragStartRef.current.posY + dy),
      });
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [position]);

  // --- Derived values ---

  const isMyTurn = myColor === currentPlayer;
  const isWinningCell = (row: number, col: number) =>
    winningCells.some(([r, c]) => r === row && c === col);

  const statusMessage = winner === 'draw'
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
                {isLoading ? 'Joining...' : 'Join Game'}
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
                  </>
                )}
              </div>
              <button className={styles.resetBtn} onClick={handleNewGame}>
                New Game
              </button>
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
