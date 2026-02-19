import { useEffect, useMemo, useState, useCallback, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import type { Project, Milestone, Waypoint } from '../types';
import { getBarDimensions } from '../utils/dateUtils';
import styles from './DependencyLine.module.css';

// Helper to calculate milestone stack index (memoized externally)
// Cache milestone stack calculations using content-based key for reliable cache hits
const milestoneStackCache = new Map<string, Map<string, number>>();

// Create a content-based cache key from milestone IDs and dates
function getMilestoneStacksCacheKey(milestones: Milestone[]): string {
  return milestones.map(m => `${m.id}:${m.startDate}:${m.endDate}`).sort().join('|');
}

function getMilestoneStacks(milestones: Milestone[]): Map<string, number> {
  const cacheKey = getMilestoneStacksCacheKey(milestones);
  const cached = milestoneStackCache.get(cacheKey);
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

  // Limit cache size to prevent memory leaks
  if (milestoneStackCache.size > 100) {
    const firstKey = milestoneStackCache.keys().next().value;
    if (firstKey) milestoneStackCache.delete(firstKey);
  }

  milestoneStackCache.set(cacheKey, stacks);
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
  hoveredItemId?: { projectId: string; milestoneId?: string } | null; // Currently hovered project/milestone
  isNew?: boolean; // True if this dependency was just created (for entrance animation)
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

// Waypoints are stored in a zoom-independent and layout-independent format:
// - x is stored as "days from timeline start" (not pixels)
// - y is stored as offset from baseline (the straight line between endpoints)
// This ensures waypoints shift correctly when layout changes (e.g. milestones stack)

// Calculate the baseline Y at a given X position (interpolating between endpoints)
function getBaselineY(x: number, fromX: number, fromY: number, toX: number, toY: number): number {
  if (Math.abs(toX - fromX) < 0.1) return (fromY + toY) / 2; // Prevent division by zero
  const t = Math.max(0, Math.min(1, (x - fromX) / (toX - fromX)));
  return fromY + t * (toY - fromY);
}

// Convert stored waypoints (days + offset) to pixel coordinates for rendering
function waypointsToPixels(
  waypoints: Waypoint[],
  dayWidth: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Waypoint[] {
  return waypoints.map(wp => {
    const xPixels = wp.x * dayWidth;
    const baselineY = getBaselineY(xPixels, fromX, fromY, toX, toY);
    return {
      x: xPixels,
      y: baselineY + wp.y // wp.y is stored as offset from baseline
    };
  });
}

// Convert pixel waypoints back to storage format (days + offset from baseline)
function pixelsToDays(
  waypoints: Waypoint[],
  dayWidth: number,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): Waypoint[] {
  return waypoints.map(wp => {
    const baselineY = getBaselineY(wp.x, fromX, fromY, toX, toY);
    return {
      x: wp.x / dayWidth,
      y: wp.y - baselineY // Store as offset from baseline
    };
  });
}

// Custom comparison for memo to optimize hover performance
// Only re-render if non-hover props change, OR if this line is directly involved in hover
function areDependencyPropsEqual(
  prevProps: DependencyLineProps,
  nextProps: DependencyLineProps
): boolean {
  // If core data changed, must re-render
  if (prevProps.fromProject.id !== nextProps.fromProject.id ||
      prevProps.toProject.id !== nextProps.toProject.id ||
      prevProps.fromProject.startDate !== nextProps.fromProject.startDate ||
      prevProps.fromProject.endDate !== nextProps.fromProject.endDate ||
      prevProps.toProject.startDate !== nextProps.toProject.startDate ||
      prevProps.toProject.endDate !== nextProps.toProject.endDate ||
      prevProps.fromMilestoneId !== nextProps.fromMilestoneId ||
      prevProps.toMilestoneId !== nextProps.toMilestoneId ||
      prevProps.dayWidth !== nextProps.dayWidth ||
      prevProps.lineIndex !== nextProps.lineIndex ||
      prevProps.isNew !== nextProps.isNew) {
    return false;
  }

  // Check if milestones arrays changed (affects positioning)
  const prevFromMilestones = prevProps.fromProject.milestones || [];
  const nextFromMilestones = nextProps.fromProject.milestones || [];
  const prevToMilestones = prevProps.toProject.milestones || [];
  const nextToMilestones = nextProps.toProject.milestones || [];

  if (prevFromMilestones.length !== nextFromMilestones.length ||
      prevToMilestones.length !== nextToMilestones.length) {
    return false;
  }

  // Check layout-affecting props
  if (prevProps.lanePositions !== nextProps.lanePositions ||
      prevProps.projectStacks !== nextProps.projectStacks ||
      prevProps.laneStackHeights !== nextProps.laneStackHeights ||
      prevProps.ownerToLaneIndex !== nextProps.ownerToLaneIndex ||
      prevProps.timelineStart?.getTime() !== nextProps.timelineStart?.getTime()) {
    return false;
  }

  // For hover state: only re-render if THIS dependency is involved
  const prevIsConnected = prevProps.hoveredItemId && (
    prevProps.hoveredItemId.projectId === prevProps.fromProject.id ||
    prevProps.hoveredItemId.projectId === prevProps.toProject.id
  );
  const nextIsConnected = nextProps.hoveredItemId && (
    nextProps.hoveredItemId.projectId === nextProps.fromProject.id ||
    nextProps.hoveredItemId.projectId === nextProps.toProject.id
  );

  // If connection status changed for THIS line, re-render
  if (prevIsConnected !== nextIsConnected) {
    return false;
  }

  // If global hover state changed (dimming), re-render
  if (prevProps.isAnyHovered !== nextProps.isAnyHovered) {
    return false;
  }

  // Waypoints changed
  if (prevProps.waypoints?.length !== nextProps.waypoints?.length) {
    return false;
  }

  return true;
}

export const DependencyLine = memo(function DependencyLine({
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
  hoveredItemId = null,
  isNew = false,
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
  const previewWaypointsRef = useRef<Waypoint[] | null>(null);
  useEffect(() => { previewWaypointsRef.current = previewWaypoints; }, [previewWaypoints]);
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
    // Convert stored waypoints from days to pixels for rendering
    // Waypoints Y is stored as offset from baseline, so we need endpoint positions
    const storedWaypointsAsPixels = waypoints
      ? waypointsToPixels(waypoints, dayWidth, fromX, adjustedFromY, toX, adjustedToY)
      : undefined;
    const activeWaypoints = previewWaypoints || storedWaypointsAsPixels;

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
    fromProject.milestones,
    toProject.id,
    toProject.owner,
    toProject.startDate,
    toProject.endDate,
    toProject.milestones,
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

  // Right-click to show delete dialog
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowConfirm(true);
  }, []);

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
    // Initialize preview with current waypoints (in pixel coordinates for dragging)
    setPreviewWaypoints(line.controlPoints);
  }, [line.controlPoints]);

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
      // Read from ref to avoid including previewWaypoints in deps
      // (which would re-register listeners on every mouse move frame)
      const currentPreview = previewWaypointsRef.current;
      if (currentPreview && onUpdateWaypoints) {
        // Convert pixel coordinates to days for storage (y as offset from baseline)
        onUpdateWaypoints(pixelsToDays(currentPreview, dayWidth, line.fromX, line.fromY, line.toX, line.toY));
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
  }, [draggingWaypointIndex, onUpdateWaypoints, dayWidth, line.fromX, line.fromY, line.toX, line.toY]);

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

  // Handle clicking on the line - single click to select, click while selected to add waypoint
  const handleLineClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

    if (!isSelected) {
      // Single click enters edit mode
      setIsSelected(true);
      return;
    }

    // If already selected, add a new waypoint at click position
    const svg = svgRef.current?.closest('svg');
    if (!svg) return;

    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Use pixel coordinates for display (line.controlPoints are already in pixels)
    const currentWaypointsPixels = line.controlPoints;

    // Find the best position to insert the new waypoint
    // Insert it between the two existing points that would create the smallest detour
    let bestIndex = currentWaypointsPixels.length;
    let bestDist = Infinity;

    const allPoints = [
      { x: line.fromX, y: line.fromY },
      ...currentWaypointsPixels,
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

    const newWaypointsPixels = [...currentWaypointsPixels];
    newWaypointsPixels.splice(bestIndex, 0, { x, y });

    if (onUpdateWaypoints) {
      // Convert pixel coordinates to days for storage (y as offset from baseline)
      onUpdateWaypoints(pixelsToDays(newWaypointsPixels, dayWidth, line.fromX, line.fromY, line.toX, line.toY));
    }
  }, [isSelected, line.controlPoints, line.fromX, line.fromY, line.toX, line.toY, onUpdateWaypoints, dayWidth]);

  // Handle removing a waypoint (right-click)
  const handleWaypointContextMenu = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Use pixel coordinates (line.controlPoints are in pixels)
    const currentWaypointsPixels = line.controlPoints;
    if (currentWaypointsPixels.length <= 1) return; // Keep at least one waypoint

    const newWaypointsPixels = currentWaypointsPixels.filter((_, i) => i !== index);
    if (onUpdateWaypoints) {
      // Convert pixel coordinates to days for storage (y as offset from baseline)
      onUpdateWaypoints(pixelsToDays(newWaypointsPixels, dayWidth, line.fromX, line.fromY, line.toX, line.toY));
    }
  }, [line.controlPoints, line.fromX, line.fromY, line.toX, line.toY, onUpdateWaypoints, dayWidth]);

  // Determine if this line should be dimmed (another line is hovered, but not this one)
  const isDimmed = isAnyHovered && !isHovered;

  // Check if this dependency is connected to the currently hovered project/milestone
  const isConnectedToHoveredItem = useMemo(() => {
    if (!hoveredItemId) return false;
    const { projectId, milestoneId } = hoveredItemId;

    // If hovering a specific milestone, only highlight dependencies connected to that milestone
    if (milestoneId) {
      return fromMilestoneId === milestoneId || toMilestoneId === milestoneId;
    }

    // If hovering a project (no milestone), highlight ALL dependencies connected to that project
    return fromProject.id === projectId || toProject.id === projectId;
  }, [hoveredItemId, fromProject.id, toProject.id, fromMilestoneId, toMilestoneId]);

  return (
    <g
      ref={svgRef}
      className={`${styles.dependencyLine} ${isHovered ? styles.hovered : ''} ${isDimmed ? styles.dimmed : ''} ${isSelected ? styles.selected : ''} ${isNew ? styles.isNew : ''} ${isConnectedToHoveredItem ? styles.connectedHighlight : ''}`}
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
        onContextMenu={handleContextMenu}
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
}, areDependencyPropsEqual);
