import { useMemo, useState } from 'react';
import type { Project, Milestone } from '../types';
import { getBarDimensions } from '../utils/dateUtils';
import styles from './DependencyLine.module.css';

interface DependencyLineProps {
  fromProject: Project;
  toProject: Project;
  fromMilestoneId?: string;
  toMilestoneId?: string;
  timelineStart: Date;
  dayWidth: number;
  projectStacks: Map<string, number>;
  lanePositions: number[];
  ownerToLaneIndex: Map<string, number>;
  lineIndex?: number; // For staggering connection points
  isAnyHovered?: boolean; // True if any dependency line is hovered
  onHoverChange?: (hovered: boolean) => void;
  onRemove: () => void;
}

const PROJECT_HEIGHT = 68;
const BAR_VERTICAL_OFFSET = 12; // Updated to match LANE_PADDING
const BAR_HEIGHT = 52;
const MILESTONE_HEIGHT = 20;
const MILESTONE_GAP = 4;
const PROJECT_CONTENT_HEIGHT = 28;

export function DependencyLine({
  fromProject,
  toProject,
  fromMilestoneId,
  toMilestoneId,
  timelineStart,
  dayWidth,
  projectStacks,
  lanePositions,
  ownerToLaneIndex,
  lineIndex = 0,
  isAnyHovered = false,
  onHoverChange,
  onRemove
}: DependencyLineProps) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Helper to calculate milestone stack index
  const getMilestoneStackIndex = (milestones: Milestone[], milestoneId: string): number => {
    // Simple approach: find the milestone and calculate its stack based on overlaps
    const milestone = milestones.find(m => m.id === milestoneId);
    if (!milestone) return 0;

    const sorted = [...milestones].sort((a, b) =>
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    let stackIndex = 0;
    for (const m of sorted) {
      if (m.id === milestoneId) break;
      const mInterval = { start: new Date(m.startDate), end: new Date(m.endDate) };
      const targetInterval = { start: new Date(milestone.startDate), end: new Date(milestone.endDate) };

      // Check overlap
      if (mInterval.start <= targetInterval.end && mInterval.end >= targetInterval.start) {
        stackIndex++;
      }
    }
    return stackIndex;
  };

  const line = useMemo(() => {
    // Get milestone objects if specified
    const fromMilestone = fromMilestoneId
      ? fromProject.milestones?.find(m => m.id === fromMilestoneId)
      : undefined;
    const toMilestone = toMilestoneId
      ? toProject.milestones?.find(m => m.id === toMilestoneId)
      : undefined;

    // Calculate dimensions based on milestone or project
    const fromDims = fromMilestone
      ? getBarDimensions(fromMilestone.startDate, fromMilestone.endDate, timelineStart, dayWidth)
      : getBarDimensions(fromProject.startDate, fromProject.endDate, timelineStart, dayWidth);

    const toDims = toMilestone
      ? getBarDimensions(toMilestone.startDate, toMilestone.endDate, timelineStart, dayWidth)
      : getBarDimensions(toProject.startDate, toProject.endDate, timelineStart, dayWidth);

    const fromStack = projectStacks.get(fromProject.id) || 0;
    const toStack = projectStacks.get(toProject.id) || 0;

    // Get lane offsets for each project's owner
    const fromLaneIndex = ownerToLaneIndex.get(fromProject.owner) ?? 0;
    const toLaneIndex = ownerToLaneIndex.get(toProject.owner) ?? 0;
    const fromLaneOffset = lanePositions[fromLaneIndex] ?? 0;
    const toLaneOffset = lanePositions[toLaneIndex] ?? 0;

    // Calculate Y positions
    let fromY: number;
    let toY: number;

    if (fromMilestone) {
      // Milestone position: within project bar, below content
      const milestoneStackIdx = getMilestoneStackIndex(fromProject.milestones || [], fromMilestoneId!);
      const projectTop = fromLaneOffset + BAR_VERTICAL_OFFSET + fromStack * PROJECT_HEIGHT;
      fromY = projectTop + PROJECT_CONTENT_HEIGHT + 6 + milestoneStackIdx * (MILESTONE_HEIGHT + MILESTONE_GAP) + MILESTONE_HEIGHT / 2;
    } else {
      fromY = fromLaneOffset + BAR_VERTICAL_OFFSET + fromStack * PROJECT_HEIGHT + BAR_HEIGHT / 2;
    }

    if (toMilestone) {
      const milestoneStackIdx = getMilestoneStackIndex(toProject.milestones || [], toMilestoneId!);
      const projectTop = toLaneOffset + BAR_VERTICAL_OFFSET + toStack * PROJECT_HEIGHT;
      toY = projectTop + PROJECT_CONTENT_HEIGHT + 6 + milestoneStackIdx * (MILESTONE_HEIGHT + MILESTONE_GAP) + MILESTONE_HEIGHT / 2;
    } else {
      toY = toLaneOffset + BAR_VERTICAL_OFFSET + toStack * PROJECT_HEIGHT + BAR_HEIGHT / 2;
    }

    // Calculate X positions
    const fromX = fromDims.left + fromDims.width; // End of from element
    const toX = toDims.left; // Start of to element

    // Add small stagger to prevent overlapping connection points
    const yStagger = (lineIndex % 3 - 1) * 4; // -4, 0, or +4
    const adjustedFromY = fromY + yStagger;
    const adjustedToY = toY + yStagger;

    // Create smooth bezier curve
    const midX = (fromX + toX) / 2;
    const controlOffset = Math.min(Math.abs(toX - fromX) * 0.4, 80);

    return {
      fromX,
      fromY: adjustedFromY,
      toX,
      toY: adjustedToY,
      path: `M ${fromX} ${adjustedFromY} C ${fromX + controlOffset} ${adjustedFromY}, ${toX - controlOffset} ${adjustedToY}, ${toX} ${adjustedToY}`,
      midX,
      midY: (adjustedFromY + adjustedToY) / 2
    };
  }, [fromProject, toProject, fromMilestoneId, toMilestoneId, timelineStart, dayWidth, projectStacks, lanePositions, ownerToLaneIndex, lineIndex]);

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

  const handleMouseEnter = () => {
    setIsHovered(true);
    onHoverChange?.(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    onHoverChange?.(false);
  };

  // Determine if this line should be dimmed (another line is hovered, but not this one)
  const isDimmed = isAnyHovered && !isHovered;

  return (
    <g
      className={`${styles.dependencyLine} ${isHovered ? styles.hovered : ''} ${isDimmed ? styles.dimmed : ''}`}
      style={{ pointerEvents: 'auto' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
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
