import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Project, ContextMenuItem } from '../types';
import { DependencyArrow } from './DependencyArrow';
import { ContextMenu } from './ContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDependencyCreation } from '../contexts/DependencyCreationContext';
import {
  getBarDimensions,
  toISODateString,
  formatShortDate,
  isDatePast
} from '../utils/dateUtils';
import { getStatusNameByHex, AUTO_COMPLETE_COLOR, normalizeStatusColor, isOnHold } from '../utils/statusColors';
import { heightForSize, DEFAULT_SIZE, UNIT_HEIGHT } from '../utils/capacity';
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
  isOverAllocated?: boolean; // True for the pill that tips its owner past capacity
  isLocked?: boolean; // When true, disable drag and edit actions (view mode)
  dragListeners?: React.DOMAttributes<HTMLDivElement>;
  onUpdate: (updates: Partial<Project>) => Promise<void>;
  onDelete: () => void;
  onEdit: () => void;
  onCopy?: () => void;
  onSelect?: () => void;
  onEdgeDrag?: (mouseX: number, isDragging: boolean) => void;
  onHoverChange?: (hovered: boolean) => void; // For dependency highlighting
}

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
  isOverAllocated = false,
  isLocked = false,
  dragListeners, // Used for cross-lane dragging (reassign owner)
  onUpdate,
  onDelete,
  onEdit,
  onCopy,
  onSelect,
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
  }, [onEdit, onCopy, onDelete, isLocked]);

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

  // Bar spans the project's own dates. Use preview dates during drag for smooth feedback.
  const effectiveDates = useMemo(() => ({
    start: previewDates?.start ?? project.startDate,
    end: previewDates?.end ?? project.endDate
  }), [project.startDate, project.endDate, previewDates]);

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

  // On-hold projects are paused and excluded from the owner's capacity total, so
  // dim the pill to signal it isn't counted (only while still active — a past pill
  // already renders as "Complete"). The hover tooltip spells out why.
  const onHold = isOnHold(project.statusColor) && !isPast;
  // Show the status badge (top-right) whenever the bar is wide enough to read.
  const showStatusBadge = !dragMode && !externalDragging && width > 120 && statusLabel;
  const showOverAllocBadge = isOverAllocated && !dragMode && !externalDragging;
  // Only show the date range when the pill is wide enough to fit it. Below this,
  // overflow-clipping the dates would leave an orphaned "•" separator (e.g.
  // "hegfjwer •"). The dates stay available in the hover tooltip + aria-label.
  const showDates = width > 132;

  // Reserve right-hand space inside the pill so the centred label/dates never run
  // underneath the corner badges. The badges are absolutely positioned and the
  // dates are flex-shrink:0, so without this they slide under the transparent
  // status tag — visible as "10 DecON TRACK" on medium-width pills. A right margin
  // on the overflow-hidden content clips it before the badge (robust even when the
  // dates can't shrink) while leaving the whole pill as a click/drag target.
  // Widths: status tag ≈ 55px at right:14 (or right:32 when shifted past the
  // over-alloc "!"); the "!" marker is 17px at right:7. +5px clearance to the badge.
  const contentMarginRight = showStatusBadge
    ? (isOverAllocated ? 80 : 58)
    : showOverAllocBadge
      ? 18
      : 0;

  // Build the accessible name from the same pieces shown on the pill, in the
  // same visual order (status → title → dates) and with the same date
  // separator. This keeps the visible text a subset of the accessible name so
  // we satisfy WCAG 2.5.3 (Label in Name) — speech-input users can activate the
  // bar by saying what they see. The status word is only included when the
  // badge is actually rendered, so the two never drift apart.
  // Space-joined (not comma-joined) and in the same visual order as the pill,
  // so the rendered text — "{status} {title} {start} - {end}" — appears verbatim
  // and contiguously inside the name. The decorative "•" separator and the
  // over-capacity "!" badge are aria-hidden in the markup so they don't inject
  // characters/words that aren't here. Over-capacity is surfaced as a suffix.
  const accessibleName = [
    showStatusBadge ? statusLabel : null,
    project.title,
    `${formatShortDate(project.startDate)} - ${formatShortDate(project.endDate)}`,
    showOverAllocBadge ? 'over capacity' : null,
  ]
    .filter(Boolean)
    .join(' ');

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

  // Pill height scales with slot cost and absorbs inter-pill gaps so a multi-slot
  // pill exactly fills the band a Smalls-stack would: Small 28 / Medium 62 /
  // Large 96 / Full Time 130 px (see heightForSize).
  const projectBarHeight = heightForSize(project.size ?? DEFAULT_SIZE);

  // Use stackTopOffset if provided, otherwise fall back. Timeline should always
  // provide it; this is a safety net. stackIndex is the pill's slot offset, so the
  // fallback matches Timeline.getStackTopOffset exactly:
  //   LANE_PADDING (16) + slotOffset * SLOT_PITCH (UNIT_HEIGHT + 6 = 34).
  const topPosition = useMemo(() => {
    if (stackTopOffset !== undefined) {
      return stackTopOffset;
    }
    // Fallback should rarely be used - log warning in development
    if (import.meta.env.DEV) {
      console.warn('[ProjectBar] stackTopOffset not provided, using fallback calculation. This may cause positioning issues with variable-height projects.');
    }
    return 16 + stackIndex * (UNIT_HEIGHT + 6);
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
      className={`${styles.projectBar} ${dragMode || externalDragging ? styles.dragging : ''} ${isSelected ? styles.selected : ''} ${isTargetable ? styles.targetable : ''} ${isSource ? styles.isSource : ''} ${onHold ? styles.onHold : ''}`}
      style={{
        left,
        width,
        top: topPosition,
        height: projectBarHeight,
        // Pill height is the slot cost — override the stylesheet's min-height so
        // Small/Medium pills aren't clamped (keeps them aligned with lane rows).
        minHeight: projectBarHeight,
        backgroundColor: displayColor || '#1e3a5f'
      }}
      role="button"
      tabIndex={0}
      aria-label={`Project: ${accessibleName}`}
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
          // Decorative mouse-only drag affordance (not keyboard-focusable). Keep
          // it out of the a11y tree so its title doesn't bleed into the pill's
          // accessible name (WCAG 2.5.3); the title tooltip still shows on hover.
          aria-hidden="true"
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
        <span
          className={`${styles.statusBadge}${isOverAllocated ? ` ${styles.statusBadgeShifted}` : ''}`}
        >
          {statusLabel}
        </span>
      )}

      {/* Over-allocation marker — a single clean "!" on the pill that tips its
          owner past their capacity. Always shown (even on narrow pills) so the
          warning is never hidden; suppressed only during an active drag/resize. */}
      {showOverAllocBadge && (
        <span
          className={styles.overAllocBadge}
          // The "!" is drawn via CSS (::before) and the meaning is surfaced in the
          // pill's accessible name as the "over capacity" suffix, so this stays out
          // of the visible-text match for WCAG 2.5.3. Keep the title for the tooltip.
          aria-hidden="true"
          title="Over capacity — this pushes the owner past their 4 slots in this period"
        />
      )}

      {/* Drag area — single click selects, double-click opens edit */}
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
          // Quick click with minimal movement = select only. Editing is on
          // double-click (below), so a project can be selected for the keyboard
          // shortcuts ([ ] / Cmd+D / Backspace) without the edit modal popping open.
          if (passes) {
            e.stopPropagation();
            setDragMode(null);
            clickStartRef.current = null;
            onSelect?.();
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
        <div className={styles.projectContent} style={{ marginRight: contentMarginRight }}>
          <span className={styles.projectTitle}>
            {project.title}
          </span>
          {/* Whitespace text node: keeps the title and dates as separate "words"
              in the pill's visible text. Without it "Small A" + "13 Jul" fuse into
              "Small A13 Jul" once the decorative "•"/"-" are stripped, which breaks
              the visible-text-in-accessible-name match (WCAG 2.5.3). Flex layout
              ignores whitespace-only nodes, so this is visually invisible. */}
          {' '}
          {showDates && (
            <span className={styles.projectMeta}>
              <span className={styles.projectSeparator} aria-hidden="true" />
              <span className={styles.projectDates}>
                {formatShortDate(project.startDate)} - {formatShortDate(project.endDate)}
              </span>
            </span>
          )}
        </div>
      </div>

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
          {statusLabel && (
            <div className={styles.pastBadge} style={!isPast ? { color: displayColor } : undefined}>
              {statusLabel}
            </div>
          )}
          {onHold && (
            <div className={styles.tooltipOnHold}>On hold {'\u2014'} not counted toward capacity</div>
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
