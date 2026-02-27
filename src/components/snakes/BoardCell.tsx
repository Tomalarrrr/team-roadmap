import { memo } from 'react';
import {
  cellToGrid,
  SNAKES,
  LADDERS,
  BOARD_SIZE,
} from '../../utils/snakesLogic';
import { NEAR_SNAKE_CELLS, NEAR_LADDER_CELLS } from './snakesHelpers';
import styles from '../SnakesGame.module.css';

// --- getCellHoverState ---

export function getCellHoverState(cellNum: number, hoveredCell: number | null): number {
  if (hoveredCell === null) return 0;
  if (hoveredCell === cellNum) return 1;
  if (SNAKES[hoveredCell] === cellNum || LADDERS[hoveredCell] === cellNum) return 2;
  return 3;
}

// --- BoardCell (memoized -- only re-renders when its hover state changes) ---

export const BoardCell = memo(function BoardCell({
  cellNum,
  hoveredCell,
  onHoverEnter,
  onHoverLeave,
}: {
  cellNum: number;
  hoveredCell: number | null;
  onHoverEnter: (cell: number) => void;
  onHoverLeave: () => void;
}) {
  const [gridRow, gridCol] = cellToGrid(cellNum);
  const isEven = (gridRow + gridCol) % 2 === 0;
  const isSnakeHead = SNAKES[cellNum] !== undefined;
  const isLadderBottom = LADDERS[cellNum] !== undefined;
  const isNearSnake = NEAR_SNAKE_CELLS.has(cellNum);
  const isNearLadder = NEAR_LADDER_CELLS.has(cellNum);
  const isWinCell = cellNum === BOARD_SIZE;
  const isHoverSource = hoveredCell === cellNum;
  const isHoverDest = hoveredCell !== null && (SNAKES[hoveredCell] === cellNum || LADDERS[hoveredCell] === cellNum);
  const isDimmed = hoveredCell !== null && !isHoverSource && !isHoverDest;

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
        isHoverSource ? styles.cellHighlightSource : '',
        isHoverDest ? styles.cellHighlightDest : '',
        isDimmed ? styles.cellDimmed : '',
      ].filter(Boolean).join(' ')}
      style={{ gridRow: gridRow + 1, gridColumn: gridCol + 1 }}
      aria-label={`Cell ${cellNum}`}
      onMouseEnter={() => {
        if (isSnakeHead || isLadderBottom) onHoverEnter(cellNum);
      }}
      onMouseLeave={onHoverLeave}
    >
      <span className={styles.cellNumber}>{cellNum}</span>
      {isHoverSource && (
        <span className={styles.cellTooltip}>
          {cellNum} &rarr; {SNAKES[cellNum] ?? LADDERS[cellNum]}
        </span>
      )}
    </div>
  );
}, (prev, next) => {
  return getCellHoverState(prev.cellNum, prev.hoveredCell) === getCellHoverState(next.cellNum, next.hoveredCell);
});
