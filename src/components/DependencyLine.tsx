import { useMemo, useState } from 'react';
import type { Project } from '../types';
import { getBarDimensions } from '../utils/dateUtils';
import styles from './DependencyLine.module.css';

interface DependencyLineProps {
  fromProject: Project;
  toProject: Project;
  timelineStart: Date;
  dayWidth: number;
  projectStacks: Map<string, number>;
  lanePositions: number[];
  ownerToLaneIndex: Map<string, number>;
  onRemove: () => void;
}

const PROJECT_HEIGHT = 68;
const BAR_VERTICAL_OFFSET = 8;
const BAR_HEIGHT = 52;

export function DependencyLine({
  fromProject,
  toProject,
  timelineStart,
  dayWidth,
  projectStacks,
  lanePositions,
  ownerToLaneIndex,
  onRemove
}: DependencyLineProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const line = useMemo(() => {
    const fromDims = getBarDimensions(
      fromProject.startDate,
      fromProject.endDate,
      timelineStart,
      dayWidth
    );
    const toDims = getBarDimensions(
      toProject.startDate,
      toProject.endDate,
      timelineStart,
      dayWidth
    );

    const fromStack = projectStacks.get(fromProject.id) || 0;
    const toStack = projectStacks.get(toProject.id) || 0;

    // Get lane offsets for each project's owner
    const fromLaneIndex = ownerToLaneIndex.get(fromProject.owner) ?? 0;
    const toLaneIndex = ownerToLaneIndex.get(toProject.owner) ?? 0;
    const fromLaneOffset = lanePositions[fromLaneIndex] ?? 0;
    const toLaneOffset = lanePositions[toLaneIndex] ?? 0;

    // Calculate positions with lane offsets
    const fromX = fromDims.left + fromDims.width; // End of from project
    const fromY = fromLaneOffset + BAR_VERTICAL_OFFSET + fromStack * PROJECT_HEIGHT + BAR_HEIGHT / 2;
    const toX = toDims.left; // Start of to project
    const toY = toLaneOffset + BAR_VERTICAL_OFFSET + toStack * PROJECT_HEIGHT + BAR_HEIGHT / 2;

    // Create smooth bezier curve
    const midX = (fromX + toX) / 2;
    const controlOffset = Math.min(Math.abs(toX - fromX) * 0.4, 80);

    return {
      fromX,
      fromY,
      toX,
      toY,
      path: `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`,
      midX,
      midY: (fromY + toY) / 2
    };
  }, [fromProject, toProject, timelineStart, dayWidth, projectStacks, lanePositions, ownerToLaneIndex]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirm(true);
  };

  const handleConfirmRemove = () => {
    setShowConfirm(false);
    onRemove();
  };

  const handleCancelRemove = () => {
    setShowConfirm(false);
  };

  return (
    <g className={styles.dependencyLine} style={{ pointerEvents: 'auto' }}>
      {/* Main line */}
      <path
        d={line.path}
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        className={styles.mainPath}
      />
      {/* Arrow head */}
      <polygon
        points={`${line.toX},${line.toY} ${line.toX - 8},${line.toY - 4} ${line.toX - 8},${line.toY + 4}`}
        fill="var(--text-muted)"
        className={styles.arrowHead}
      />
      {/* Invisible wider path for easier interaction */}
      <path
        d={line.path}
        fill="none"
        stroke="transparent"
        strokeWidth="12"
        style={{ cursor: 'pointer' }}
        onClick={handleClick}
      />
      {/* Hover indicator dot */}
      <circle
        cx={line.midX}
        cy={line.midY}
        r="0"
        fill="var(--accent-blue)"
        className={styles.removeIndicator}
      />
      {/* Confirmation dialog */}
      {showConfirm && (
        <foreignObject
          x={line.midX - 80}
          y={line.midY - 50}
          width="160"
          height="70"
        >
          <div className={styles.confirmDialog}>
            <p>Remove dependency?</p>
            <div className={styles.confirmActions}>
              <button onClick={handleCancelRemove} className={styles.cancelBtn}>
                Cancel
              </button>
              <button onClick={handleConfirmRemove} className={styles.removeBtn}>
                Remove
              </button>
            </div>
          </div>
        </foreignObject>
      )}
    </g>
  );
}
