import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Project, Milestone, Waypoint } from '../types';
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
  waypoints?: Waypoint[]; // Custom control points for manual path shaping
  onUpdateWaypoints?: (waypoints: Waypoint[]) => void;
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
  onRemove,
  waypoints,
  onUpdateWaypoints
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
  const [isSelected, setIsSelected] = useState(false);
  const [draggingWaypointIndex, setDraggingWaypointIndex] = useState<number | null>(null);
  const [previewWaypoints, setPreviewWaypoints] = useState<Waypoint[] | null>(null);
  const svgRef = useRef<SVGGElement>(null);

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

    // Use custom waypoints if available (preview takes precedence during drag)
    const activeWaypoints = previewWaypoints || waypoints;

    // Build path with rounded corners
    let path: string;
    let pathMidX: number; // For hover indicator positioning
    let controlPoints: Waypoint[] = []; // Points that can be dragged

    // Helper to build orthogonal path through waypoints
    const buildWaypointPath = (points: Waypoint[]): string => {
      const cornerRadius = 6;
      const allPoints = [
        { x: fromX, y: adjustedFromY },
        ...points,
        { x: toX, y: adjustedToY }
      ];

      const segments: string[] = [`M ${allPoints[0].x} ${allPoints[0].y}`];

      for (let i = 1; i < allPoints.length; i++) {
        const prev = allPoints[i - 1];
        const curr = allPoints[i];
        const next = allPoints[i + 1];

        if (next) {
          // Calculate corner radius based on available space
          const dxIn = curr.x - prev.x;
          const dyIn = curr.y - prev.y;
          const dxOut = next.x - curr.x;
          const dyOut = next.y - curr.y;

          const distIn = Math.sqrt(dxIn * dxIn + dyIn * dyIn);
          const distOut = Math.sqrt(dxOut * dxOut + dyOut * dyOut);
          const r = Math.min(cornerRadius, distIn / 2, distOut / 2);

          if (r > 2) {
            // Normalize directions
            const inDirX = dxIn / distIn;
            const inDirY = dyIn / distIn;
            const outDirX = dxOut / distOut;
            const outDirY = dyOut / distOut;

            // Corner points
            const cornerStartX = curr.x - inDirX * r;
            const cornerStartY = curr.y - inDirY * r;
            const cornerEndX = curr.x + outDirX * r;
            const cornerEndY = curr.y + outDirY * r;

            segments.push(`L ${cornerStartX} ${cornerStartY}`);
            segments.push(`Q ${curr.x} ${curr.y} ${cornerEndX} ${cornerEndY}`);
          } else {
            segments.push(`L ${curr.x} ${curr.y}`);
          }
        } else {
          segments.push(`L ${curr.x} ${curr.y}`);
        }
      }

      return segments.join(' ');
    };

    // If we have custom waypoints, use them
    if (activeWaypoints && activeWaypoints.length > 0) {
      path = buildWaypointPath(activeWaypoints);
      controlPoints = activeWaypoints;
      pathMidX = activeWaypoints.length > 0
        ? activeWaypoints[Math.floor(activeWaypoints.length / 2)].x
        : (fromX + toX) / 2;
    } else {
      // Smart orthogonal routing - automatically determines best path
      const cornerRadius = 8;
      const minGap = 16; // Minimum gap for routing

      const deltaY = adjustedToY - adjustedFromY;
      const absY = Math.abs(deltaY);
      const ySign = deltaY >= 0 ? 1 : -1;
      const isForward = toX > fromX;
      const horizontalDistance = Math.abs(toX - fromX);

      // Edge case: elements very close or same level - simple line
      if (absY < 2 && horizontalDistance < minGap * 2) {
        path = `M ${fromX} ${adjustedFromY} L ${toX} ${adjustedToY}`;
        pathMidX = (fromX + toX) / 2;
        // For straight lines, add a midpoint that can be dragged
        controlPoints = [{ x: (fromX + toX) / 2, y: (adjustedFromY + adjustedToY) / 2 }];
      } else if (isForward) {
        // FORWARD: Target is to the right of source
        const midX = Math.max(fromX + minGap, (fromX + toX) / 2);
        const r = Math.max(2, Math.min(cornerRadius, absY / 2, (midX - fromX) / 2, (toX - midX) / 2));

        if (absY < r * 2) {
          path = `M ${fromX} ${adjustedFromY} L ${toX} ${adjustedToY}`;
          controlPoints = [{ x: (fromX + toX) / 2, y: (adjustedFromY + adjustedToY) / 2 }];
        } else {
          path = [
            `M ${fromX} ${adjustedFromY}`,
            `H ${midX - r}`,
            `Q ${midX} ${adjustedFromY} ${midX} ${adjustedFromY + (ySign * r)}`,
            `V ${adjustedToY - (ySign * r)}`,
            `Q ${midX} ${adjustedToY} ${midX + r} ${adjustedToY}`,
            `H ${toX}`
          ].join(' ');
          // Control points at the corners
          controlPoints = [
            { x: midX, y: adjustedFromY },
            { x: midX, y: adjustedToY }
          ];
        }
        pathMidX = midX;
      } else {
        // BACKWARD: Target is to the left of source
        const exitX = fromX + minGap;
        const entryX = toX - minGap;
        const r = Math.max(2, Math.min(cornerRadius, absY / 2, minGap / 2));

        if (absY < r * 2) {
          const loopDepth = minGap;
          const loopSign = 1;
          path = [
            `M ${fromX} ${adjustedFromY}`,
            `H ${exitX - r}`,
            `Q ${exitX} ${adjustedFromY} ${exitX} ${adjustedFromY + (loopSign * r)}`,
            `V ${adjustedFromY + (loopSign * loopDepth) - r}`,
            `Q ${exitX} ${adjustedFromY + (loopSign * loopDepth)} ${exitX - r} ${adjustedFromY + (loopSign * loopDepth)}`,
            `H ${entryX + r}`,
            `Q ${entryX} ${adjustedFromY + (loopSign * loopDepth)} ${entryX} ${adjustedFromY + (loopSign * loopDepth) - (loopSign * r)}`,
            `V ${adjustedToY + (loopSign * r)}`,
            `Q ${entryX} ${adjustedToY} ${entryX + r} ${adjustedToY}`,
            `H ${toX}`
          ].join(' ');
          controlPoints = [
            { x: exitX, y: adjustedFromY },
            { x: exitX, y: adjustedFromY + loopDepth },
            { x: entryX, y: adjustedFromY + loopDepth },
            { x: entryX, y: adjustedToY }
          ];
        } else {
          path = [
            `M ${fromX} ${adjustedFromY}`,
            `H ${exitX - r}`,
            `Q ${exitX} ${adjustedFromY} ${exitX} ${adjustedFromY + (ySign * r)}`,
            `V ${adjustedToY - (ySign * r)}`,
            `Q ${exitX} ${adjustedToY} ${exitX - r} ${adjustedToY}`,
            `H ${toX}`
          ].join(' ');
          controlPoints = [
            { x: exitX, y: adjustedFromY },
            { x: exitX, y: adjustedToY }
          ];
        }
        pathMidX = (exitX + entryX) / 2;
      }
    }

    const isForward = toX > fromX;

    return {
      fromX,
      fromY: adjustedFromY,
      toX,
      toY: adjustedToY,
      path,
      midX: pathMidX,
      midY: (adjustedFromY + adjustedToY) / 2,
      approachFromRight: !isForward, // Backward connections approach from right
      controlPoints
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
    getStackTopOffset,
    waypoints,
    previewWaypoints
  ]);

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

  // Handle selecting the line (double-click to toggle edit mode)
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsSelected(prev => !prev);
  }, []);

  // Handle waypoint drag start
  const handleWaypointMouseDown = useCallback((index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingWaypointIndex(index);
    // Initialize preview with current waypoints
    setPreviewWaypoints(waypoints || line.controlPoints);
  }, [waypoints, line.controlPoints]);

  // Handle waypoint drag
  useEffect(() => {
    if (draggingWaypointIndex === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Get SVG coordinates
      const svg = svgRef.current?.closest('svg');
      if (!svg) return;

      const rect = svg.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      setPreviewWaypoints(prev => {
        if (!prev) return prev;
        const newWaypoints = [...prev];
        newWaypoints[draggingWaypointIndex] = { x, y };
        return newWaypoints;
      });
    };

    const handleMouseUp = () => {
      if (previewWaypoints && onUpdateWaypoints) {
        onUpdateWaypoints(previewWaypoints);
      }
      setDraggingWaypointIndex(null);
      setPreviewWaypoints(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingWaypointIndex, previewWaypoints, onUpdateWaypoints]);

  // Handle click outside to deselect
  useEffect(() => {
    if (!isSelected) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (svgRef.current && !svgRef.current.contains(e.target as Node)) {
        setIsSelected(false);
      }
    };

    // Delay to avoid immediate deselection from the click that selected
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isSelected]);

  // Handle adding a new waypoint by clicking on the line
  const handleLineClick = useCallback((e: React.MouseEvent) => {
    if (!isSelected) {
      // If not selected, show confirm dialog
      e.stopPropagation();
      setShowConfirm(true);
      return;
    }

    // If selected, add a new waypoint at click position
    e.stopPropagation();
    const svg = svgRef.current?.closest('svg');
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const currentWaypoints = waypoints || line.controlPoints;

    // Find the best position to insert the new waypoint
    // Insert it between the two existing points that would create the smallest detour
    let bestIndex = currentWaypoints.length;
    let bestDist = Infinity;

    const allPoints = [
      { x: line.fromX, y: line.fromY },
      ...currentWaypoints,
      { x: line.toX, y: line.toY }
    ];

    for (let i = 0; i < allPoints.length - 1; i++) {
      const p1 = allPoints[i];
      const p2 = allPoints[i + 1];

      // Distance from click to line segment
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const lengthSq = dx * dx + dy * dy;

      if (lengthSq === 0) continue;

      const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / lengthSq));
      const projX = p1.x + t * dx;
      const projY = p1.y + t * dy;
      const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);

      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i; // Insert after this index in currentWaypoints
      }
    }

    const newWaypoints = [...currentWaypoints];
    newWaypoints.splice(bestIndex, 0, { x, y });

    if (onUpdateWaypoints) {
      onUpdateWaypoints(newWaypoints);
    }
  }, [isSelected, waypoints, line.controlPoints, line.fromX, line.fromY, line.toX, line.toY, onUpdateWaypoints]);

  // Handle removing a waypoint (right-click)
  const handleWaypointContextMenu = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const currentWaypoints = waypoints || line.controlPoints;
    if (currentWaypoints.length <= 1) return; // Keep at least one waypoint

    const newWaypoints = currentWaypoints.filter((_, i) => i !== index);
    if (onUpdateWaypoints) {
      onUpdateWaypoints(newWaypoints);
    }
  }, [waypoints, line.controlPoints, onUpdateWaypoints]);

  // Determine if this line should be dimmed (another line is hovered, but not this one)
  const isDimmed = isAnyHovered && !isHovered;

  return (
    <g
      ref={svgRef}
      className={`${styles.dependencyLine} ${isHovered ? styles.hovered : ''} ${isDimmed ? styles.dimmed : ''} ${isSelected ? styles.selected : ''}`}
      style={{ pointerEvents: 'auto' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={handleDoubleClick}
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
      {/* Arrow head outline - flips direction based on approach */}
      <polygon
        points={line.approachFromRight
          ? `${line.toX},${line.toY} ${line.toX + 10},${line.toY - 5} ${line.toX + 10},${line.toY + 5}`
          : `${line.toX},${line.toY} ${line.toX - 10},${line.toY - 5} ${line.toX - 10},${line.toY + 5}`}
        fill="rgba(255, 255, 255, 0.9)"
        className={styles.arrowOutline}
      />
      {/* Arrow head - flips direction based on approach */}
      <polygon
        points={line.approachFromRight
          ? `${line.toX},${line.toY} ${line.toX + 8},${line.toY - 4} ${line.toX + 8},${line.toY + 4}`
          : `${line.toX},${line.toY} ${line.toX - 8},${line.toY - 4} ${line.toX - 8},${line.toY + 4}`}
        fill="var(--dependency-line, #666)"
        className={styles.arrowHead}
      />
      {/* Invisible wider path for easier interaction */}
      <path
        d={line.path}
        fill="none"
        stroke="transparent"
        strokeWidth="12"
        style={{ cursor: isSelected ? 'crosshair' : 'pointer' }}
        onClick={handleLineClick}
        onDoubleClick={handleDoubleClick}
      />
      {/* Hover indicator dot (hidden when selected) */}
      {!isSelected && (
        <circle
          cx={line.midX}
          cy={line.midY}
          r="0"
          fill="var(--accent-blue)"
          className={styles.removeIndicator}
        />
      )}
      {/* Draggable control points (shown when selected) */}
      {isSelected && line.controlPoints.map((point, index) => (
        <g key={index}>
          {/* Outer ring for visibility */}
          <circle
            cx={point.x}
            cy={point.y}
            r="8"
            fill="white"
            stroke="var(--accent-blue)"
            strokeWidth="2"
            style={{ cursor: 'grab' }}
            className={styles.controlPointOuter}
            onMouseDown={(e) => handleWaypointMouseDown(index, e)}
            onContextMenu={(e) => handleWaypointContextMenu(index, e)}
          />
          {/* Inner dot */}
          <circle
            cx={point.x}
            cy={point.y}
            r="4"
            fill="var(--accent-blue)"
            style={{ cursor: 'grab', pointerEvents: 'none' }}
            className={styles.controlPointInner}
          />
        </g>
      ))}
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
