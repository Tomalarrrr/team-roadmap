import { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Project, Milestone } from '../types';
import { getBarDimensions } from '../utils/dateUtils';
import styles from './DependencyLine.module.css';

// Helper to calculate milestone stack index (memoized externally)
// Cache milestone stack calculations to avoid recomputation
const milestoneStackCache = new WeakMap<Milestone[], Map<string, number>>();

function getMilestoneStacks(milestones: Milestone[]): Map<string, number> {
  const cached = milestoneStackCache.get(milestones);
  if (cached) return cached;

  const stacks = new Map<string, number>();
  const sorted = [...milestones].sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  // Use interval scheduling algorithm (same as ProjectBar optimization)
  const stackEndTimes: number[] = [];

  sorted.forEach((milestone) => {
    const startTime = new Date(milestone.startDate).getTime();
    const endTime = new Date(milestone.endDate).getTime();

    let assignedStack = -1;
    for (let i = 0; i < stackEndTimes.length; i++) {
      if (stackEndTimes[i] < startTime) {
        assignedStack = i;
        stackEndTimes[i] = endTime;
        break;
      }
    }
    if (assignedStack === -1) {
      assignedStack = stackEndTimes.length;
      stackEndTimes.push(endTime);
    }
    stacks.set(milestone.id, assignedStack);
  });

  milestoneStackCache.set(milestones, stacks);
  return stacks;
}

interface DependencyLineProps {
  fromProject: Project;
  toProject: Project;
  fromMilestoneId?: string;
  toMilestoneId?: string;
  timelineStart: Date;
  dayWidth: number;
  projectStacks: Map<string, number>;
  lanePositions: number[];
  laneStackHeights: Record<string, number[]>; // Stack heights per owner for dynamic positioning
  ownerToLaneIndex: Map<string, number>;
  lineIndex?: number; // For staggering connection points
  isAnyHovered?: boolean; // True if any dependency line is hovered
  onHoverChange?: (hovered: boolean) => void;
  onRemove: () => void;
}

const BASE_PROJECT_HEIGHT = 52; // Minimum project bar height
const PROJECT_VERTICAL_GAP = 20; // Gap between stacked projects
const BAR_VERTICAL_OFFSET = 16; // LANE_PADDING
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
  laneStackHeights,
  ownerToLaneIndex,
  lineIndex = 0,
  isAnyHovered = false,
  onHoverChange,
  onRemove
}: DependencyLineProps) {
  // Helper to calculate stack top offset based on dynamic heights
  const getStackTopOffset = useCallback((ownerName: string, stackIndex: number): number => {
    const stackHeights = laneStackHeights[ownerName] || [];
    let offset = BAR_VERTICAL_OFFSET;
    for (let i = 0; i < stackIndex; i++) {
      offset += (stackHeights[i] || BASE_PROJECT_HEIGHT) + PROJECT_VERTICAL_GAP;
    }
    return offset;
  }, [laneStackHeights]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Memoize milestone stacks to avoid recalculation
  const fromMilestoneStacks = useMemo(
    () => getMilestoneStacks(fromProject.milestones || []),
    [fromProject.milestones]
  );

  const toMilestoneStacks = useMemo(
    () => getMilestoneStacks(toProject.milestones || []),
    [toProject.milestones]
  );

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

    // Calculate Y positions using dynamic stack heights
    const fromStackOffset = getStackTopOffset(fromProject.owner, fromStack);
    const toStackOffset = getStackTopOffset(toProject.owner, toStack);

    let fromY: number;
    let toY: number;

    if (fromMilestone) {
      // Milestone position: within project bar, below content
      const milestoneStackIdx = fromMilestoneStacks.get(fromMilestoneId!) ?? 0;
      const projectTop = fromLaneOffset + fromStackOffset;
      fromY = projectTop + PROJECT_CONTENT_HEIGHT + 6 + milestoneStackIdx * (MILESTONE_HEIGHT + MILESTONE_GAP) + MILESTONE_HEIGHT / 2;
    } else {
      fromY = fromLaneOffset + fromStackOffset + BAR_HEIGHT / 2;
    }

    if (toMilestone) {
      const milestoneStackIdx = toMilestoneStacks.get(toMilestoneId!) ?? 0;
      const projectTop = toLaneOffset + toStackOffset;
      toY = projectTop + PROJECT_CONTENT_HEIGHT + 6 + milestoneStackIdx * (MILESTONE_HEIGHT + MILESTONE_GAP) + MILESTONE_HEIGHT / 2;
    } else {
      toY = toLaneOffset + toStackOffset + BAR_HEIGHT / 2;
    }

    // Calculate X positions
    const fromX = fromDims.left + fromDims.width; // End of from element
    const toX = toDims.left; // Start of to element

    // Add small stagger to prevent overlapping connection points
    const yStagger = (lineIndex % 3 - 1) * 4; // -4, 0, or +4
    const adjustedFromY = fromY + yStagger;
    const adjustedToY = toY + yStagger;

    // Orthogonal elbow routing with rounded corners
    // Pattern: horizontal -> vertical -> horizontal
    const horizontalGap = 20; // Minimum horizontal extension from source/target
    const cornerRadius = 8; // Radius for rounded corners

    // Calculate midpoint X for the vertical segment
    const midX = (fromX + toX) / 2;

    // Determine the vertical segment X position
    const isForward = toX > fromX;
    const verticalX = isForward
      ? Math.max(fromX + horizontalGap, midX)
      : fromX + horizontalGap; // When backward, extend right first

    const deltaY = adjustedToY - adjustedFromY;
    const absY = Math.abs(deltaY);
    const ySign = deltaY >= 0 ? 1 : -1;

    // Build path with rounded corners
    let path: string;

    // Edge case: minimal or no vertical difference - use simple direct line
    if (absY < 2) {
      path = `M ${fromX} ${adjustedFromY} L ${toX} ${adjustedToY}`;
    } else if (isForward && absY < cornerRadius * 2) {
      // Forward with small Y diff - simple diagonal
      path = `M ${fromX} ${adjustedFromY} L ${toX} ${adjustedToY}`;
    } else if (isForward) {
      // Forward elbow: right -> down/up -> right
      const r = Math.max(2, Math.min(cornerRadius, absY / 2, Math.abs(verticalX - fromX) / 2, Math.abs(toX - verticalX) / 2));
      const corner1X = verticalX - r;
      const corner2Y = adjustedToY - (ySign * r);

      path = [
        `M ${fromX} ${adjustedFromY}`,
        `H ${corner1X}`,
        `Q ${verticalX} ${adjustedFromY} ${verticalX} ${adjustedFromY + (ySign * r)}`,
        `V ${corner2Y}`,
        `Q ${verticalX} ${adjustedToY} ${verticalX + r} ${adjustedToY}`,
        `H ${toX}`
      ].join(' ');
    } else {
      // Backward elbow: right -> down/up -> left (to reach target behind source)
      const r = Math.max(2, Math.min(cornerRadius, absY / 2, horizontalGap / 2));
      const corner1X = verticalX - r;
      const corner2Y = adjustedToY - (ySign * r);

      path = [
        `M ${fromX} ${adjustedFromY}`,
        `H ${corner1X}`,
        `Q ${verticalX} ${adjustedFromY} ${verticalX} ${adjustedFromY + (ySign * r)}`,
        `V ${corner2Y}`,
        `Q ${verticalX} ${adjustedToY} ${verticalX - r} ${adjustedToY}`,
        `H ${toX}`
      ].join(' ');
    }

    return {
      fromX,
      fromY: adjustedFromY,
      toX,
      toY: adjustedToY,
      path,
      midX: verticalX,
      midY: (adjustedFromY + adjustedToY) / 2
    };
  }, [
    fromProject.id,
    fromProject.owner,
    fromProject.startDate,
    fromProject.endDate,
    toProject.id,
    toProject.owner,
    toProject.startDate,
    toProject.endDate,
    fromMilestoneId,
    toMilestoneId,
    timelineStart,
    dayWidth,
    projectStacks,
    lanePositions,
    ownerToLaneIndex,
    lineIndex,
    fromMilestoneStacks,
    toMilestoneStacks,
    getStackTopOffset
  ]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirm(true);
  };

  const handleConfirmRemove = () => {
    setShowConfirm(false);
    onRemove();
  };

  const handleCancelRemove = useCallback(() => {
    setShowConfirm(false);
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!showConfirm) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancelRemove();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showConfirm, handleCancelRemove]);

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
      {/* Outline/halo for visibility on colored backgrounds */}
      <path
        d={line.path}
        fill="none"
        stroke="rgba(255, 255, 255, 0.9)"
        strokeWidth="4"
        strokeLinecap="round"
        className={styles.outlinePath}
      />
      {/* Main line */}
      <path
        d={line.path}
        fill="none"
        stroke="var(--dependency-line, #666)"
        strokeWidth="2"
        strokeDasharray="6 4"
        strokeLinecap="round"
        className={styles.mainPath}
      />
      {/* Arrow head outline */}
      <polygon
        points={`${line.toX},${line.toY} ${line.toX - 10},${line.toY - 5} ${line.toX - 10},${line.toY + 5}`}
        fill="rgba(255, 255, 255, 0.9)"
        className={styles.arrowOutline}
      />
      {/* Arrow head */}
      <polygon
        points={`${line.toX},${line.toY} ${line.toX - 8},${line.toY - 4} ${line.toX - 8},${line.toY + 4}`}
        fill="var(--dependency-line, #666)"
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
      {/* Confirmation dialog - rendered via portal to appear above project bars */}
      {showConfirm && createPortal(
        <>
          {/* Backdrop for click-outside dismissal */}
          <div
            className={styles.confirmBackdrop}
            onClick={handleCancelRemove}
          />
          <div
            className={styles.confirmDialogOverlay}
            style={{
              left: line.midX - 80,
              top: line.midY - 35
            }}
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
          </div>
        </>,
        document.querySelector('[data-lanes-container]') || document.body
      )}
    </g>
  );
}
