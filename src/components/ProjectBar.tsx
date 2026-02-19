import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Project, ContextMenuItem } from '../types';
import { MilestoneLine } from './MilestoneLine';
import { DependencyArrow } from './DependencyArrow';
import { ContextMenu } from './ContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDependencyCreation } from '../contexts/DependencyCreationContext';
import {
  getBarDimensions,
  toISODateString,
  formatShortDate,
  isDatePast,
  calculateStacks
} from '../utils/dateUtils';
import { getStatusNameByHex, AUTO_COMPLETE_COLOR, normalizeStatusColor } from '../utils/statusColors';
import { parseISO, differenceInDays } from 'date-fns';
import styles from './ProjectBar.module.css';

// Format duration for tooltip
function formatDuration(startDate: string, endDate: string): string {
  const days = differenceInDays(new Date(endDate), new Date(startDate)) + 1;
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'}`;
}


interface ProjectBarProps {
  project: Project;
  timelineStart: Date;
  dayWidth: number;
  stackIndex?: number;
  stackTopOffset?: number; // Calculated top position within the lane (accounts for variable heights)
  laneTop?: number; // Absolute top position of the lane for dependency positioning
  isDragging?: boolean;
  isSelected?: boolean;
  newMilestoneIds?: Set<string>; // IDs of newly created milestones (for entrance animation)
  isLocked?: boolean; // When true, disable drag and edit actions (view mode)
  isFullscreen?: boolean; // When true, hide milestones for clean view
  dragListeners?: React.DOMAttributes<HTMLDivElement>;
  onUpdate: (updates: Partial<Project>) => Promise<void>;
  onDelete: () => void;
  onAddMilestone: () => void;
  onEdit: () => void;
  onEditMilestone: (milestoneId: string) => void;
  onUpdateMilestone: (milestoneId: string, updates: Partial<import('../types').Milestone>) => Promise<void>;
  onDeleteMilestone: (milestoneId: string) => void;
  onCopy?: () => void;
  onSelect?: () => void;
  onSelectMilestone?: (milestoneId: string) => void;
  onEdgeDrag?: (mouseX: number, isDragging: boolean) => void;
  onHoverChange?: (hovered: boolean, milestoneId?: string) => void; // For dependency highlighting
}

const BASE_PROJECT_HEIGHT = 52;
const MILESTONE_ROW_HEIGHT = 24;
const PROJECT_CONTENT_HEIGHT = 28;

type DragMode = 'move' | 'resize-start' | 'resize-end' | null;

export function ProjectBar({
  project,
  timelineStart,
  dayWidth,
  stackIndex = 0,
  stackTopOffset,
  laneTop = 0,
  isDragging: externalDragging,
  isSelected,
  newMilestoneIds,
  isLocked = false,
  isFullscreen = false,
  dragListeners, // Used for cross-lane dragging (reassign owner)
  onUpdate,
  onDelete,
  onAddMilestone,
  onEdit,
  onEditMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onCopy,
  onSelect,
  onSelectMilestone,
  onEdgeDrag,
  onHoverChange
}: ProjectBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  // Use separate state for original dates to prevent effect re-runs from object reference changes
  const [originalStartDate, setOriginalStartDate] = useState('');
  const [originalEndDate, setOriginalEndDate] = useState('');
  // Preview dates for smooth visual feedback during drag (separate from actual data)
  const [previewDates, setPreviewDates] = useState<{ start: string; end: string } | null>(null);
  const [showDependencyArrow, setShowDependencyArrow] = useState(false);

  // Rich hover tooltip state
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Context menu state
  const contextMenu = useContextMenu();

  // Context menu items configuration - only Copy when locked
  const menuItems: ContextMenuItem[] = useMemo(() => {
    if (isLocked) {
      // Only show Copy option when locked (non-destructive action)
      return onCopy ? [{
        id: 'copy',
        label: 'Copy Project',
        onClick: onCopy
      }] : [];
    }
    return [
      {
        id: 'edit',
        label: 'Edit Project',
        onClick: onEdit
      },
      {
        id: 'add-milestone',
        label: 'Add Milestone',
        onClick: onAddMilestone
      },
      ...(onCopy ? [{
        id: 'copy',
        label: 'Copy Project',
        onClick: onCopy
      }] : []),
      {
        id: 'delete',
        label: 'Delete',
        onClick: onDelete,
        variant: 'danger' as const
      }
    ];
  }, [onEdit, onAddMilestone, onCopy, onDelete, isLocked]);

  // Dependency creation context
  const { state: depState, startCreation, completeCreation } = useDependencyCreation();
  const isCreatingDependency = depState.isCreating;
  const isSource = depState.source?.projectId === project.id && !depState.source?.milestoneId;

  // Click-to-edit tracking (distinguish from drag)
  const clickStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Store callbacks in refs to avoid effect re-running when they change
  // (they're often inline functions that change every render)
  const onUpdateRef = useRef(onUpdate);
  const onEdgeDragRef = useRef(onEdgeDrag);
  useEffect(() => { onUpdateRef.current = onUpdate; });
  useEffect(() => { onEdgeDragRef.current = onEdgeDrag; });

  // Store dayWidth in ref to prevent effect re-runs during drag
  const dayWidthRef = useRef(dayWidth);
  useEffect(() => { dayWidthRef.current = dayWidth; });

  // Clear preview when actual data matches what we saved (derived state during render).
  // When the server confirms our optimistic update, actual dates match preview → clear it.
  // IMPORTANT: Don't clear during active drag — let mouseUp handle completion.
  if (!dragMode && previewDates &&
      project.startDate === previewDates.start &&
      project.endDate === previewDates.end) {
    setPreviewDates(null);
  }

  // Calculate effective dates including milestone extensions
  // Use preview dates during drag for smooth visual feedback
  const effectiveDates = useMemo(() => {
    const baseStart = previewDates?.start ?? project.startDate;
    const baseEnd = previewDates?.end ?? project.endDate;
    let effectiveStart = baseStart;
    let effectiveEnd = baseEnd;

    (project.milestones || []).forEach(milestone => {
      if (milestone.startDate < effectiveStart) {
        effectiveStart = milestone.startDate;
      }
      if (milestone.endDate > effectiveEnd) {
        effectiveEnd = milestone.endDate;
      }
    });

    return { start: effectiveStart, end: effectiveEnd };
  }, [project.startDate, project.endDate, project.milestones, previewDates]);

  const { left, width } = getBarDimensions(
    effectiveDates.start,
    effectiveDates.end,
    timelineStart,
    dayWidth
  );

  // Auto-blue rule: turn blue if project end date is past
  const isPast = isDatePast(project.endDate);
  const displayColor = isPast ? AUTO_COMPLETE_COLOR : normalizeStatusColor(project.statusColor);

  // Status label for badge and tooltip
  const statusLabel = isPast ? 'Complete' : getStatusNameByHex(project.statusColor);
  // Show badge when bar is wide enough to read, but hide when projectContentEnd appears (width > 400)
  // to avoid overlapping the right-aligned title/dates
  const showStatusBadge = !dragMode && !externalDragging && width > 120 && width <= 400 && statusLabel;
  const milestoneCount = project.milestones?.length || 0;

  const handleMouseDown = useCallback((e: React.MouseEvent, mode: DragMode) => {
    if (isLocked) return; // Disable drag when locked
    e.preventDefault();
    e.stopPropagation();
    setDragMode(mode);
    setDragStartX(e.clientX);
    setOriginalStartDate(project.startDate);
    setOriginalEndDate(project.endDate);
  }, [project.startDate, project.endDate, isLocked]);

  // Track the latest preview for committing on mouseUp
  const latestPreviewRef = useRef<{ start: string; end: string } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Refs for initial drag detection - managed outside of effects for proper cleanup
  const initialListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  // Setup initial drag detection listeners - called from mouseDown handlers
  const setupInitialDragDetection = useCallback((startX: number, startY: number) => {
    // Clean up any existing listeners first
    if (initialListenersRef.current) {
      document.removeEventListener('mousemove', initialListenersRef.current.move);
      document.removeEventListener('mouseup', initialListenersRef.current.up);
      initialListenersRef.current = null;
    }

    const DRAG_THRESHOLD = 8;

    const handleInitialMouseMove = (e: MouseEvent) => {
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);

      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        // Clean up these listeners before activating drag
        if (initialListenersRef.current) {
          document.removeEventListener('mousemove', initialListenersRef.current.move);
          document.removeEventListener('mouseup', initialListenersRef.current.up);
          initialListenersRef.current = null;
        }
        clickStartRef.current = null;
        setDragMode('move');
      }
    };

    const handleInitialMouseUp = () => {
      // Clean up listeners only - let element's onMouseUp handle click detection
      if (initialListenersRef.current) {
        document.removeEventListener('mousemove', initialListenersRef.current.move);
        document.removeEventListener('mouseup', initialListenersRef.current.up);
        initialListenersRef.current = null;
      }
      // Don't clear clickStartRef here - the element's onMouseUp needs it for click detection
    };

    initialListenersRef.current = { move: handleInitialMouseMove, up: handleInitialMouseUp };
    document.addEventListener('mousemove', handleInitialMouseMove);
    document.addEventListener('mouseup', handleInitialMouseUp);
  }, []);

  // Cleanup initial listeners on unmount
  useEffect(() => {
    return () => {
      if (initialListenersRef.current) {
        document.removeEventListener('mousemove', initialListenersRef.current.move);
        document.removeEventListener('mouseup', initialListenersRef.current.up);
        initialListenersRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!dragMode) {
      return;
    }

    const DRAG_THRESHOLD = 8; // Minimum pixels before drag activates

    const handleMouseMove = (e: MouseEvent) => {
      // Notify edge scroll system (use ref to avoid stale closure)
      onEdgeDragRef.current?.(e.clientX, true);

      // Cancel any pending animation frame to avoid stacking up updates
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // Use requestAnimationFrame to throttle updates to screen refresh rate
      // This prevents excessive re-renders and improves performance dramatically
      rafIdRef.current = requestAnimationFrame(() => {
        // CRITICAL: Check if component is still mounted before state updates
        // This prevents "Can't perform state update on unmounted component" errors
        if (!isMountedRef.current) return;

        try {
          // Safety check: ensure we have valid original dates before proceeding
          if (!originalStartDate || !originalEndDate) {
            return;
          }

          const deltaX = e.clientX - dragStartX;

          // Don't start moving until we've exceeded the drag threshold
          if (Math.abs(deltaX) < DRAG_THRESHOLD) return;

          // Safety check: prevent division by zero
          const currentDayWidth = dayWidthRef.current || 1;
          let deltaDays = Math.round(deltaX / currentDayWidth);

          // Safety check: ensure deltaDays is a valid number
          if (!Number.isFinite(deltaDays)) {
            return;
          }

          // Snap to week boundary when Shift is held
          if (e.shiftKey) {
            deltaDays = Math.round(deltaDays / 7) * 7;
          }

          // Limit extreme deltas to prevent performance issues with very large drags
          // Max ~1 year extension in either direction
          const MAX_DELTA_DAYS = 365;
          deltaDays = Math.max(-MAX_DELTA_DAYS, Math.min(MAX_DELTA_DAYS, deltaDays));

          const originalStart = parseISO(originalStartDate);
          const originalEnd = parseISO(originalEndDate);

          // Safety check: ensure parsed dates are valid
          if (isNaN(originalStart.getTime()) || isNaN(originalEnd.getTime())) {
            return;
          }

          let newStart = originalStartDate;
          let newEnd = originalEndDate;

          if (dragMode === 'move') {
            const start = new Date(originalStart);
            const end = new Date(originalEnd);
            start.setDate(start.getDate() + deltaDays);
            end.setDate(end.getDate() + deltaDays);
            newStart = toISODateString(start);
            newEnd = toISODateString(end);
          } else if (dragMode === 'resize-start') {
            const start = new Date(originalStart);
            start.setDate(start.getDate() + deltaDays);
            if (start < originalEnd) {
              newStart = toISODateString(start);
            }
          } else if (dragMode === 'resize-end') {
            const end = new Date(originalEnd);
            end.setDate(end.getDate() + deltaDays);
            if (end > originalStart) {
              newEnd = toISODateString(end);
            }
          }

          // Update preview for smooth visual feedback (no Firebase call)
          const preview = { start: newStart, end: newEnd };

          // Only update if preview actually changed to prevent excessive re-renders
          const hasChanged = !latestPreviewRef.current ||
            latestPreviewRef.current.start !== preview.start ||
            latestPreviewRef.current.end !== preview.end;

          latestPreviewRef.current = preview;

          if (hasChanged) {
            setPreviewDates(preview);
          }
        } catch (err) {
          // Log but don't crash on drag calculation errors
          console.error('[ProjectBar] Error during drag:', err);
        }
      });
    };

    const handleMouseUp = async () => {
      onEdgeDragRef.current?.(0, false); // Stop edge scrolling

      // Commit the final position to Firebase only on release
      const finalPreview = latestPreviewRef.current;
      if (finalPreview) {
        const hasChanged = finalPreview.start !== originalStartDate || finalPreview.end !== originalEndDate;
        if (hasChanged) {
          // Fire the update - don't await, let the effect clear preview when props match
          onUpdateRef.current({
            startDate: finalPreview.start,
            endDate: finalPreview.end
          }).catch(() => {
            // If save fails, clear preview (rollback will restore old position)
            setPreviewDates(null);
          });
        } else {
          // No change, clear preview immediately
          setPreviewDates(null);
        }
      } else {
        // No preview, clear anyway
        setPreviewDates(null);
      }

      latestPreviewRef.current = null;
      setDragMode(null);
    };

    // Use passive listeners where possible for better scroll performance
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Cancel any pending animation frame on cleanup
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [dragMode, dragStartX, originalStartDate, originalEndDate]);

  // Calculate milestone stacking
  const milestoneStacks = useMemo(
    () => calculateStacks(project.milestones || []),
    [project.milestones]
  );

  // Calculate max milestone stack for dynamic project bar height
  const maxMilestoneStack = useMemo(() => {
    if (milestoneStacks.size === 0) return 0;
    return Math.max(...milestoneStacks.values());
  }, [milestoneStacks]);

  // Calculate dynamic project bar height
  const milestoneRows = maxMilestoneStack + 1;
  const dynamicHeight = PROJECT_CONTENT_HEIGHT + (milestoneRows * MILESTONE_ROW_HEIGHT) + 8;
  const projectBarHeight = isFullscreen ? BASE_PROJECT_HEIGHT : Math.max(BASE_PROJECT_HEIGHT, dynamicHeight);

  // Use stackTopOffset if provided (dynamic heights), otherwise fall back to fixed calculation
  // The fallback is a safety net - Timeline should always provide stackTopOffset
  // Fallback uses: LANE_PADDING (16) + stackIndex * (BASE_PROJECT_HEIGHT + gap)
  const topPosition = useMemo(() => {
    if (stackTopOffset !== undefined) {
      return stackTopOffset;
    }
    // Fallback should rarely be used - log warning in development
    if (import.meta.env.DEV) {
      console.warn('[ProjectBar] stackTopOffset not provided, using fallback calculation. This may cause positioning issues with variable-height projects.');
    }
    return 16 + stackIndex * 72;
  }, [stackTopOffset, stackIndex]);

  // Keyboard handler for accessibility
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Copy is allowed even when locked
    if (e.key === 'c' && (e.metaKey || e.ctrlKey) && onCopy) {
      e.preventDefault();
      onCopy();
      return;
    }
    // All other actions are disabled when locked
    if (isLocked) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onEdit();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete();
    }
  }, [onEdit, onDelete, onCopy, isLocked]);

  // Handle starting a dependency from this project
  // Position uses absolute coordinates: laneTop (lane's position in timeline) + topPosition (project's position within lane)
  const handleStartDependency = useCallback(() => {
    startCreation({
      projectId: project.id,
      position: {
        x: left + width,
        y: laneTop + topPosition + projectBarHeight / 2
      }
    });
  }, [project.id, left, width, laneTop, topPosition, projectBarHeight, startCreation]);

  // Handle click when in dependency creation mode (this project becomes the target)
  const handleDependencyTarget = useCallback(() => {
    if (isCreatingDependency && !isSource) {
      completeCreation({ projectId: project.id });
    }
  }, [isCreatingDependency, isSource, project.id, completeCreation]);

  // Track mouse proximity to end of bar for showing dependency arrow
  // IMPORTANT: Skip during drag to prevent unnecessary state updates and re-renders
  const handleMouseMoveForArrow = useCallback((e: React.MouseEvent) => {
    if (dragMode) return; // Skip during drag - don't cause re-renders
    if (!barRef.current || isCreatingDependency) {
      setShowDependencyArrow(false);
      return;
    }
    const rect = barRef.current.getBoundingClientRect();
    const distanceFromEnd = rect.right - e.clientX;
    // Show arrow when within 40px of the right edge
    setShowDependencyArrow(distanceFromEnd <= 40 && distanceFromEnd >= 0);
  }, [isCreatingDependency, dragMode]);

  // Rich hover tooltip handlers (following MilestoneLine pattern)
  const handleMouseEnterTooltip = useCallback(() => {
    if (dragMode || externalDragging) return;
    tooltipTimeoutRef.current = setTimeout(() => {
      if (barRef.current && !contextMenu.isOpen) {
        const rect = barRef.current.getBoundingClientRect();
        // Clamp horizontal position to keep tooltip within viewport
        // Tooltip is ~280px max-width, centered => need ~140px clearance on each side
        const TOOLTIP_HALF_WIDTH = 140;
        const rawX = rect.left + rect.width / 2;
        const clampedX = Math.max(TOOLTIP_HALF_WIDTH, Math.min(rawX, window.innerWidth - TOOLTIP_HALF_WIDTH));
        setTooltipPosition({
          x: clampedX,
          y: rect.top
        });
        setShowTooltip(true);
      }
    }, 400);
  }, [dragMode, externalDragging, contextMenu.isOpen]);

  const handleMouseLeaveTooltip = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setShowTooltip(false);
    setTooltipPosition(null);
  }, []);

  // Hide tooltip when drag starts or context menu opens
  useEffect(() => {
    if (dragMode || contextMenu.isOpen) {
      handleMouseLeaveTooltip();
    }
  }, [dragMode, contextMenu.isOpen, handleMouseLeaveTooltip]);

  // Dismiss tooltip on scroll (position becomes stale)
  useEffect(() => {
    if (!showTooltip) return;
    const dismiss = () => handleMouseLeaveTooltip();
    window.addEventListener('scroll', dismiss, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', dismiss, { capture: true });
  }, [showTooltip, handleMouseLeaveTooltip]);

  // Cleanup tooltip timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  // Floating drag tooltip - position and text
  // Note: getBoundingClientRect() during render reads the previous frame's position,
  // causing a ~1 frame (16ms) lag. This is imperceptible during smooth drag, and
  // using useLayoutEffect to fix it would double renders during drag (bad tradeoff).
  const dragTooltipPosition = useMemo(() => {
    // eslint-disable-next-line react-hooks/refs -- Intentional DOM ref read for drag tooltip positioning
    if (!dragMode || !previewDates || !barRef.current) return null;
    const rect = barRef.current.getBoundingClientRect(); // eslint-disable-line react-hooks/refs -- See above
    return {
      x: rect.left + rect.width / 2,
      y: rect.top,
      flipBelow: rect.top < 50 // Flip below if near top of viewport
    };
  }, [dragMode, previewDates]);

  const dragTooltipText = useMemo(() => {
    if (!previewDates || !dragMode) return '';
    const start = formatShortDate(previewDates.start);
    const end = formatShortDate(previewDates.end);
    const duration = formatDuration(previewDates.start, previewDates.end);

    if (dragMode === 'move') return `${start} \u2013 ${end}  \u00B7  ${duration}`;
    if (dragMode === 'resize-start') return `Start: ${start}`;
    if (dragMode === 'resize-end') return `End: ${end}`;
    return '';
  }, [previewDates, dragMode]);

  // Determine class names based on state
  const isTargetable = isCreatingDependency && !isSource;

  return (
    <div
      ref={barRef}
      data-dependency-target
      className={`${styles.projectBar} ${dragMode || externalDragging ? styles.dragging : ''} ${isSelected ? styles.selected : ''} ${isTargetable ? styles.targetable : ''} ${isSource ? styles.isSource : ''}`}
      style={{
        left,
        width,
        top: topPosition,
        height: projectBarHeight,
        backgroundColor: displayColor || '#1e3a5f'
      }}
      role="button"
      tabIndex={0}
      aria-label={`Project: ${project.title}, ${formatShortDate(project.startDate)} to ${formatShortDate(project.endDate)}${isPast ? ', Complete' : ''}`}
      aria-describedby={showTooltip ? `tooltip-${project.id}` : undefined}
      onKeyDown={handleKeyDown}
      onClick={isTargetable ? handleDependencyTarget : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        contextMenu.open({ x: e.clientX, y: e.clientY });
      }}
      onMouseEnter={() => {
        onHoverChange?.(true);
        handleMouseEnterTooltip();
      }}
      onMouseMove={(e) => {
        // Track proximity to end for showing dependency arrow
        handleMouseMoveForArrow(e);
      }}
      onMouseLeave={() => {
        if (!dragMode) setShowDependencyArrow(false); // Skip during drag
        onHoverChange?.(false);
        handleMouseLeaveTooltip();
      }}
    >
      {/* Cross-lane drag handle (reassign owner) */}
      {!isLocked && dragListeners && (
        <div
          className={styles.laneHandle}
          title="Drag to move to another team member"
          {...dragListeners}
        >
          <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
            <circle cx="2" cy="2" r="1.5" />
            <circle cx="6" cy="2" r="1.5" />
            <circle cx="2" cy="7" r="1.5" />
            <circle cx="6" cy="7" r="1.5" />
            <circle cx="2" cy="12" r="1.5" />
            <circle cx="6" cy="12" r="1.5" />
          </svg>
        </div>
      )}

      {/* Resize handles - hidden when locked */}
      {!isLocked && (
        <>
          <div
            className={styles.resizeHandle}
            style={{ left: 0 }}
            onMouseDown={(e) => handleMouseDown(e, 'resize-start')}
          />
          <div
            className={styles.resizeHandle}
            style={{ right: 0 }}
            onMouseDown={(e) => handleMouseDown(e, 'resize-end')}
          />
        </>
      )}

      {/* Dependency arrow button - appears on hover near end, hidden when locked */}
      {!isLocked && (
        <DependencyArrow
          isVisible={showDependencyArrow}
          isCreatingDependency={isCreatingDependency}
          onStartDependency={handleStartDependency}
        />
      )}

      {/* Status badge */}
      {showStatusBadge && (
        <span className={styles.statusBadge} aria-label={`Status: ${statusLabel}`}>
          {statusLabel}
        </span>
      )}

      {/* Drag area - single click opens edit */}
      <div
        className={styles.dragArea}
        onMouseDown={(e) => {
          if (isLocked) return; // Disable drag when locked
          clickStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
          setDragStartX(e.clientX);
          setOriginalStartDate(project.startDate);
          setOriginalEndDate(project.endDate);
          setupInitialDragDetection(e.clientX, e.clientY);
        }}
        onMouseUp={(e) => {
          // Always clean up initial listeners on mouseUp
          if (initialListenersRef.current) {
            document.removeEventListener('mousemove', initialListenersRef.current.move);
            document.removeEventListener('mouseup', initialListenersRef.current.up);
            initialListenersRef.current = null;
          }

          if (!clickStartRef.current) {
            return;
          }
          const dx = Math.abs(e.clientX - clickStartRef.current.x);
          const dy = Math.abs(e.clientY - clickStartRef.current.y);
          const elapsed = Date.now() - clickStartRef.current.time;
          const passes = dx < 5 && dy < 5 && elapsed < 300;
          // If minimal movement and quick click, open edit dialog and select (unless locked)
          if (passes) {
            e.stopPropagation();
            setDragMode(null);
            clickStartRef.current = null;
            onSelect?.();
            if (!isLocked) onEdit();
            return;
          }
          clickStartRef.current = null;
        }}
        onDoubleClick={(e) => {
          if (isLocked) return; // Disable edit when locked
          e.stopPropagation();
          onEdit();
        }}
      >
        <div className={styles.projectContent}>
          <span className={styles.projectTitle}>
            {project.title}
          </span>
          <span className={styles.projectSeparator}>•</span>
          <span className={styles.projectDates}>
            {formatShortDate(project.startDate)} - {formatShortDate(project.endDate)}
          </span>
        </div>
        {width > 400 && (
          <div className={styles.projectContentEnd}>
            <span className={styles.projectDates}>
              {formatShortDate(project.startDate)} - {formatShortDate(project.endDate)}
            </span>
            <span className={styles.projectSeparator}>•</span>
            <span className={styles.projectTitle}>
              {project.title}
            </span>
          </div>
        )}
      </div>

      {/* Milestones as lines within the project bar - OUTSIDE dragArea to prevent interference */}
      {!isFullscreen && (
        <div
          className={styles.milestonesContainer}
          style={{ height: (maxMilestoneStack + 1) * 24 }}
        >
          {(project.milestones || []).map((milestone) => (
            <MilestoneLine
              key={milestone.id}
              milestone={milestone}
              projectId={project.id}
              timelineStart={timelineStart}
              dayWidth={dayWidth}
              projectLeft={left}
              projectWidth={width}
              stackIndex={milestoneStacks.get(milestone.id) || 0}
              laneTop={topPosition}
              absoluteLaneTop={laneTop}
              isNew={newMilestoneIds?.has(milestone.id) ?? false}
              isLocked={isLocked}
              onUpdate={(updates) => onUpdateMilestone(milestone.id, updates)}
              onEdit={() => onEditMilestone(milestone.id)}
              onDelete={() => onDeleteMilestone(milestone.id)}
              onSelect={onSelectMilestone ? () => onSelectMilestone(milestone.id) : undefined}
              onHoverChange={onHoverChange ? (hovered) => onHoverChange(hovered, milestone.id) : undefined}
            />
          ))}
        </div>
      )}

      {/* Context menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={menuItems}
        onClose={contextMenu.close}
        isOpeningRef={contextMenu.isOpeningRef}
      />

      {/* Rich hover tooltip - rendered via portal to escape overflow:hidden */}
      {showTooltip && !dragMode && !externalDragging && tooltipPosition && createPortal(
        <div
          id={`tooltip-${project.id}`}
          className={styles.tooltip}
          style={{
            position: 'fixed',
            left: tooltipPosition.x,
            top: tooltipPosition.y - 8,
            transform: 'translate(-50%, -100%)'
          }}
          role="tooltip"
        >
          <div className={styles.tooltipTitle}>{project.title}</div>
          <div className={styles.tooltipDates}>
            {formatShortDate(project.startDate)} {'\u2013'} {formatShortDate(project.endDate)}
            {' \u00B7 '}{formatDuration(project.startDate, project.endDate)}
          </div>
          {milestoneCount > 0 && (
            <div className={styles.tooltipMilestones}>
              {milestoneCount} milestone{milestoneCount !== 1 ? 's' : ''}
            </div>
          )}
          {statusLabel && (
            <div className={styles.pastBadge} style={!isPast ? { color: displayColor } : undefined}>
              {statusLabel}
            </div>
          )}
          <div className={styles.tooltipHint}>
            {isLocked ? 'Right-click for options' : 'Click to edit \u00B7 Right-click for menu'}
          </div>
        </div>,
        document.body
      )}

      {/* Floating drag tooltip - shows dates during drag/resize */}
      {dragMode && previewDates && dragTooltipPosition && createPortal(
        <div
          className={styles.dragTooltip}
          style={{
            position: 'fixed',
            left: dragTooltipPosition.x,
            top: dragTooltipPosition.flipBelow
              ? (dragTooltipPosition.y + projectBarHeight + 8)
              : (dragTooltipPosition.y - 8),
            transform: dragTooltipPosition.flipBelow
              ? 'translateX(-50%)'
              : 'translate(-50%, -100%)'
          }}
        >
          {dragTooltipText}
        </div>,
        document.body
      )}
    </div>
  );
}
