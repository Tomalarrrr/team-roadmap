import { memo } from 'react';
import {
  cellToGrid,
  SNAKES,
  LADDERS,
  BOARD_SIZE,
} from '../../utils/snakesLogic';
import { NEAR_SNAKE_CELLS, NEAR_LADDER_CELLS } from './snakesHelpers';
import styles from '../SnakesGame.module.css';

// --- BoardCell (memoized — fully static, never re-renders during gameplay) ---

export const BoardCell = memo(function BoardCell({
  cellNum,
}: {
  cellNum: number;
}) {
  const [gridRow, gridCol] = cellToGrid(cellNum);
  const isEven = (gridRow + gridCol) % 2 === 0;
  const isSnakeHead = SNAKES[cellNum] !== undefined;
  const isLadderBottom = LADDERS[cellNum] !== undefined;
  const isNearSnake = NEAR_SNAKE_CELLS.has(cellNum);
  const isNearLadder = NEAR_LADDER_CELLS.has(cellNum);
  const isWinCell = cellNum === BOARD_SIZE;

  return (
    <div
      className={[
        styles.cell,
        isEven ? styles.cellEven : styles.cellOdd,
        isSnakeHead ? styles.cellSnakeHead : '',
        isLadderBottom ? styles.cellLadderBottom : '',
        isNearSnake ? styles.cellNearSnake : '',
        isNearLadder ? styles.cellNearLadder : '',
        isWinCell ? styles.cellWin : '',
      ].filter(Boolean).join(' ')}
      style={{ gridRow: gridRow + 1, gridColumn: gridCol + 1 }}
      aria-label={`Cell ${cellNum}`}
    >
      <span className={styles.cellNumber}>{cellNum}</span>
    </div>
  );
}, () => true); // Static content — never re-render
