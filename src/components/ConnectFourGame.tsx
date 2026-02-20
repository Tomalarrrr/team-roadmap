import { useState, useEffect, useCallback, useRef } from 'react';
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
    // Check forward
    for (let i = 1; i < 4; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === color) {
        cells.push([r, c]);
      } else break;
    }
    // Check backward
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

export function ConnectFourGame({ onClose, isSearchOpen }: ConnectFourGameProps) {
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
  const popupRef = useRef<HTMLDivElement>(null);

  // Escape key to close (only when search modal isn't open, to avoid double-close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSearchOpen) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isSearchOpen]);

  // Drop a piece into a column
  const dropPiece = useCallback((col: number) => {
    if (winner || droppingCell) return;

    // Find the lowest empty row
    let targetRow = -1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (!board[r][col]) {
        targetRow = r;
        break;
      }
    }
    if (targetRow === -1) return; // Column full

    const newBoard = board.map(row => [...row]);
    newBoard[targetRow][col] = currentPlayer;

    setDroppingCell({ row: targetRow, col });
    setBoard(newBoard);

    // Check for win
    const winCells = checkWin(newBoard, targetRow, col, currentPlayer);
    if (winCells) {
      setWinner(currentPlayer);
      setWinningCells(winCells);
      setShowBurst(true);
    } else if (isBoardFull(newBoard)) {
      setWinner('draw');
    } else {
      setCurrentPlayer(prev => prev === 'red' ? 'yellow' : 'red');
    }

    // Clear dropping animation flag after animation completes
    setTimeout(() => setDroppingCell(null), 350);
  }, [board, currentPlayer, winner, droppingCell]);

  const startNewGame = useCallback(() => {
    setBoard(createEmptyBoard());
    setCurrentPlayer('red');
    setWinner(null);
    setWinningCells([]);
    setDroppingCell(null);
    setShowBurst(false);
  }, []);

  // Drag handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    // Only drag from title bar, not close button
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

  const isWinningCell = (row: number, col: number) =>
    winningCells.some(([r, c]) => r === row && c === col);

  const statusMessage = winner === 'draw'
    ? 'DRAW!'
    : winner
      ? `${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`
      : `${currentPlayer.charAt(0).toUpperCase() + currentPlayer.slice(1)}'s turn`;

  return (
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ left: position.x, top: position.y }}
    >
      {/* Title bar */}
      <div className={styles.titleBar} onMouseDown={handleDragStart}>
        <span className={styles.titleText}>
          <span>🔴🟡</span>
          Connect Four
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
          <button className={styles.resetBtn} onClick={startNewGame}>
            New Game
          </button>
        </div>

        {/* Board wrapper — keeps column indicators aligned with board */}
        <div className={styles.boardWrapper}>
          {/* Column drop indicators */}
          {!winner && (
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
                  onClick={() => !winner && dropPiece(colIdx)}
                  role="gridcell"
                  aria-label={`${cell ? `${cell} piece` : 'Empty'}, column ${colIdx + 1}, row ${rowIdx + 1}`}
                />
              );
            })
          )}
          </div>

          {/* Winner burst — outside board so it's not clipped by board background */}
          {winner && winner !== 'draw' && (
            <div className={`${styles.burst} ${styles[winner]} ${showBurst ? styles.active : ''}`} />
          )}
        </div>
      </div>
    </div>
  );
}
