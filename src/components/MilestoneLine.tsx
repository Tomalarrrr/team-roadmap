import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { createPortal } from 'react-dom';
import type { Milestone, ContextMenuItem } from '../types';
import { DependencyArrow } from './DependencyArrow';
import { ContextMenu } from './ContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDependencyCreation } from '../contexts/DependencyCreationContext';
import { getBarDimensions, isMilestonePast, formatShortDate, toISODateString } from '../utils/dateUtils';
import { AUTO_COMPLETE_COLOR, DEFAULT_STATUS_COLOR, normalizeStatusColor, getStatusNameByHex } from '../utils/statusColors';
import { parseISO, differenceInDays } from 'date-fns';
import styles from './MilestoneLine.module.css';

interface MilestoneLineProps {
  milestone: Milestone;
  projectId: string;
  timelineStart: Date;
  dayWidth: number;
  projectLeft: number;
  projectWidth: number;
  stackIndex?: number;
  laneTop?: number; // Project's top position within its lane (for milestone positioning)
  absoluteLaneTop?: number; // Lane's absolute top position in the timeline (for dependency positioning)
  isNew?: boolean; // True if this milestone was just created (for entrance animation)
  isLocked?: boolean; // When true, disable drag and edit actions (view mode)
  onUpdate: (updates: Partial<Milestone>) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onSelect?: () => void;
  onHoverChange?: (hovered: boolean) => void; // For dependency highlighting
}

type DragMode = 'move' | 'resize-start' | 'resize-end' | null;

const MILESTONE_HEIGHT = 20;
const MILESTONE_GAP = 4;
const PROJECT_CONTENT_HEIGHT = 28; // Height of the title/dates area (must match DependencyLine)

// Custom comparison for React.memo to prevent unnecessary re-renders
function areMilestonePropsEqual(prevProps: MilestoneLineProps, nextProps: MilestoneLineProps): boolean {
  try {
    // Compare milestone by key fields (not deep equality)
    if (prevProps.milestone?.id !== nextProps.milestone?.id ||
        prevProps.milestone?.startDate !== nextProps.milestone?.startDate ||
        prevProps.milestone?.endDate !== nextProps.milestone?.endDate ||
        prevProps.milestone?.title !== nextProps.milestone?.title ||
        prevProps.milestone?.statusColor !== nextProps.milestone?.statusColor) {
      return false;
    }

    // Compare primitive props
    if (prevProps.projectId !== nextProps.projectId ||
        prevProps.dayWidth !== nextProps.dayWidth ||
        prevProps.projectLeft !== nextProps.projectLeft ||
        prevProps.projectWidth !== nextProps.projectWidth ||
        prevProps.stackIndex !== nextProps.stackIndex ||
        prevProps.laneTop !== nextProps.laneTop ||
        prevProps.absoluteLaneTop !== nextProps.absoluteLaneTop ||
        prevProps.isNew !== nextProps.isNew ||
        prevProps.isLocked !== nextProps.isLocked) {
      return false;
    }

    // Compare Date by timestamp (Date objects are recreated each render)
    // Safety: check if timelineStart exists before calling getTime()
    const prevTime = prevProps.timelineStart?.getTime?.() ?? 0;
    const nextTime = nextProps.timelineStart?.getTime?.() ?? 0;
    if (prevTime !== nextTime) {
      return false;
    }

    // Callback props (onUpdate, onEdit, etc.) are ignored - they don't affect rendering
    // and are stored in refs anyway
    return true;
  } catch {
    // If comparison fails for any reason, return false to trigger re-render
    return false;
  }
}

const MilestoneLineComponent = memo(function MilestoneLine({
  milestone,
  projectId,
  timelineStart,
  dayWidth,
  projectLeft,
  projectWidth,
  stackIndex = 0,
  laneTop = 0,
  absoluteLaneTop = 0,
  isNew = false,
  isLocked = false,
  onUpdate,
  onEdit,
  onDelete,
  onSelect,
  onHoverChange
}: MilestoneLineProps) {
  const milestoneRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  // Use separate state for original dates to prevent effect re-runs from object reference changes
  const [originalStartDate, setOriginalStartDate] = useState('');
  const [originalEndDate, setOriginalEndDate] = useState('');
  // Preview dates for smooth visual feedback during drag
  const [previewDates, setPreviewDates] = useState<{ start: string; end: string } | null>(null);
  const [showDependencyArrow, setShowDependencyArrow] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dependency creation context
  const { state: depState, startCreation, completeCreation } = useDependencyCreation();
  const isCreatingDependency = depState.isCreating;
  const isSource = depState.source?.projectId === projectId && depState.source?.milestoneId === milestone.id;

  // Context menu state
  const contextMenu = useContextMenu();

  // Context menu items configuration - empty when locked
  const menuItems: ContextMenuItem[] = useMemo(() => {
    if (isLocked) return [];
    return [
      {
        id: 'edit',
        label: 'Edit Milestone',
        onClick: onEdit
      },
      {
        id: 'delete',
        label: 'Delete',
        onClick: onDelete,
        variant: 'danger' as const
      }
    ];
  }, [onEdit, onDelete, isLocked]);

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

  // Store callback in ref to avoid effect re-running when it changes
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Store dayWidth in ref to prevent effect re-runs during drag
  const dayWidthRef = useRef(dayWidth);
  dayWidthRef.current = dayWidth;

  // Clear preview when actual data matches what we saved
  // This is more robust than timing-based clearing
  // IMPORTANT: Don't clear during active drag - let mouseUp handle completion
  useEffect(() => {
    if (dragMode) return; // Prevent clearing during drag

    if (previewDates &&
        milestone.startDate === previewDates.start &&
        milestone.endDate === previewDates.end) {
      setPreviewDates(null);
    }
  }, [milestone.startDate, milestone.endDate, previewDates, dragMode]);

  // Use preview dates during drag for smooth visual feedback
  const displayStartDate = previewDates?.start ?? milestone.startDate;
  const displayEndDate = previewDates?.end ?? milestone.endDate;

  const { left: milestoneLeft, width: milestoneWidth } = getBarDimensions(
    displayStartDate,
    displayEndDate,
    timelineStart,
    dayWidth
  );

  // Calculate position relative to the project bar
  // Safety: ensure all values are finite numbers
  const safeProjectLeft = Number.isFinite(projectLeft) ? projectLeft : 0;
  const safeProjectWidth = Number.isFinite(projectWidth) ? Math.max(projectWidth, 0) : 0;
  const safeMilestoneLeft = Number.isFinite(milestoneLeft) ? milestoneLeft : 0;
  const safeMilestoneWidth = Number.isFinite(milestoneWidth) ? Math.max(milestoneWidth, 0) : 0;

  const relativeLeft = safeMilestoneLeft - safeProjectLeft;
  const displayLeft = Math.max(0, relativeLeft);
  // Ensure displayWidth never goes negative
  const maxAllowedWidth = Math.max(0, safeProjectWidth - displayLeft - 16);
  const displayWidth = Math.min(safeMilestoneWidth, maxAllowedWidth);

  // Auto-blue rule: turn blue if milestone end date is past
  const isPast = isMilestonePast(milestone.endDate);
  const displayColor = isPast ? AUTO_COMPLETE_COLOR : normalizeStatusColor(milestone.statusColor);

  // Immediate drag handler for resize handles (no click detection needed)
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, mode: DragMode) => {
    if (isLocked) return; // Disable resize when locked
    e.preventDefault();
    e.stopPropagation();
    setDragMode(mode);
    setDragStartX(e.clientX);
    setOriginalStartDate(milestone.startDate);
    setOriginalEndDate(milestone.endDate);
  }, [milestone.startDate, milestone.endDate, isLocked]);

  // Track the latest preview for committing on mouseUp
  const latestPreviewRef = useRef<{ start: string; end: string } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Refs for initial drag detection - managed outside of effects for proper cleanup
  const initialListenersRef = useRef<{ move: (e: MouseEvent) => void; up: () => void } | null>(null);

  // Setup initial drag detection listeners - called from mouseDown handlers
  const setupInitialDragDetection = useCallback((mode: DragMode, startX: number, startY: number) => {
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
        setDragMode(mode);
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
    if (!dragMode) return;

    const DRAG_THRESHOLD = 8; // Minimum pixels before drag activates

    const handleMouseMove = (e: MouseEvent) => {
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
          console.error('[MilestoneLine] Error during drag:', err);
        }
      });
    };

    const handleMouseUp = () => {
      // Commit the final position to Firebase only on release
      const finalPreview = latestPreviewRef.current;
      if (finalPreview && isMountedRef.current) {
        const hasChanged = finalPreview.start !== originalStartDate || finalPreview.end !== originalEndDate;
        if (hasChanged) {
          onUpdateRef.current({
            startDate: finalPreview.start,
            endDate: finalPreview.end
          }).catch(() => {
            if (isMountedRef.current) setPreviewDates(null);
          });
        } else {
          setPreviewDates(null);
        }
      } else if (isMountedRef.current) {
        setPreviewDates(null);
      }

      latestPreviewRef.current = null;
      if (isMountedRef.current) setDragMode(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Cleanup on unmount or when dragMode changes
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

  // Keyboard handler for accessibility
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (isLocked) return; // Disable keyboard actions when locked
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onEdit();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      onDelete();
    }
  }, [onEdit, onDelete, isLocked]);

  // Handle starting a dependency from this milestone
  // Position uses absolute coordinates matching DependencyLine calculation:
  // absoluteLaneTop (lane position) + laneTop (project position within lane) + PROJECT_CONTENT_HEIGHT + 6 + milestone stack offset + center
  const handleStartDependency = useCallback(() => {
    const milestoneTop = absoluteLaneTop + laneTop + PROJECT_CONTENT_HEIGHT + 6 + stackIndex * (MILESTONE_HEIGHT + MILESTONE_GAP) + MILESTONE_HEIGHT / 2;
    startCreation({
      projectId,
      milestoneId: milestone.id,
      position: {
        x: milestoneLeft + milestoneWidth,
        y: milestoneTop
      }
    });
  }, [projectId, milestone.id, milestoneLeft, milestoneWidth, absoluteLaneTop, laneTop, stackIndex, startCreation]);

  // Handle click when in dependency creation mode
  const handleDependencyTarget = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent click from bubbling to ProjectBar (which would create a second dependency)
    if (isCreatingDependency && !isSource) {
      completeCreation({ projectId, milestoneId: milestone.id });
    }
  }, [isCreatingDependency, isSource, projectId, milestone.id, completeCreation]);

  // Track mouse proximity to end for showing dependency arrow
  // IMPORTANT: Skip during drag to prevent unnecessary state updates and re-renders
  const handleMouseMoveForArrow = useCallback((e: React.MouseEvent) => {
    if (dragMode) return; // Skip during drag - don't cause re-renders
    if (!milestoneRef.current || isCreatingDependency) {
      setShowDependencyArrow(false);
      return;
    }
    const rect = milestoneRef.current.getBoundingClientRect();
    const distanceFromEnd = rect.right - e.clientX;
    setShowDependencyArrow(distanceFromEnd <= 30 && distanceFromEnd >= 0);
  }, [isCreatingDependency, dragMode]);

  const isTargetable = isCreatingDependency && !isSource;

  // Tooltip handlers - show after brief delay
  const handleMouseEnter = useCallback(() => {
    if (dragMode) return;
    onHoverChange?.(true); // Notify parent of hover for dependency highlighting
    tooltipTimeoutRef.current = setTimeout(() => {
      if (milestoneRef.current) {
        const rect = milestoneRef.current.getBoundingClientRect();
        const TOOLTIP_HALF_WIDTH = 120;
        const rawX = rect.left + rect.width / 2;
        const clampedX = Math.max(TOOLTIP_HALF_WIDTH, Math.min(rawX, window.innerWidth - TOOLTIP_HALF_WIDTH));
        setTooltipPosition({ x: clampedX, y: rect.top });
      }
      setShowTooltip(true);
    }, 400);
  }, [dragMode, onHoverChange]);

  const handleMouseLeaveTooltip = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setShowTooltip(false);
    setTooltipPosition(null);
    onHoverChange?.(false); // Notify parent of hover end
  }, [onHoverChange]);

  // Dismiss tooltip on scroll (position becomes stale)
  useEffect(() => {
    if (!showTooltip) return;
    const dismiss = () => handleMouseLeaveTooltip();
    window.addEventListener('scroll', dismiss, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', dismiss, { capture: true });
  }, [showTooltip, handleMouseLeaveTooltip]);

  // Clean up tooltip timeout on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  // CRITICAL: Don't unmount during drag! This was causing the flashing bug.
  // When resizing, the milestone can extend beyond project bounds (based on preview),
  // but projectWidth is based on actual data. If we unmount, we lose all drag state.
  const isOutOfBounds = displayWidth <= 0 || displayLeft >= projectWidth;
  if (!dragMode && isOutOfBounds) {
    return null; // Milestone outside project bounds (only when not dragging)
  }

  // During drag, clamp to reasonable values to keep visible
  // Round to whole pixels to prevent subpixel rendering issues that can cause visual glitches
  const safeDisplayWidth = Math.round(dragMode ? Math.max(displayWidth, 24) : displayWidth);
  const safeDisplayLeft = Math.round(dragMode ? Math.max(0, Math.min(displayLeft, projectWidth - 24)) : displayLeft);

  return (
    <div
      ref={milestoneRef}
      data-dependency-target
      className={`${styles.milestoneLine} ${dragMode ? styles.dragging : ''} ${isTargetable ? styles.targetable : ''} ${isSource ? styles.isSource : ''} ${isNew ? styles.isNew : ''}`}
      style={{
        left: safeDisplayLeft,
        top: stackIndex * (MILESTONE_HEIGHT + MILESTONE_GAP),
        width: Math.max(safeDisplayWidth, 24),
        backgroundColor: displayColor || DEFAULT_STATUS_COLOR
      }}
      role="button"
      tabIndex={0}
      aria-label={`Milestone: ${milestone.title}, ${formatShortDate(milestone.startDate)} to ${formatShortDate(milestone.endDate)}${isPast ? ', Complete' : ''}`}
      onKeyDown={handleKeyDown}
      onClick={isTargetable ? handleDependencyTarget : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseMove={(e) => {
        handleMouseMoveForArrow(e);
      }}
      onMouseLeave={() => {
        if (!dragMode) setShowDependencyArrow(false); // Skip during drag
        handleMouseLeaveTooltip();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        contextMenu.open({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Resize handles - use immediate drag mode (no click detection needed) */}
      {!isLocked && (
        <>
          <div
            className={`${styles.resizeHandle} ${styles.resizeHandleLeft}`}
            onMouseDown={(e) => handleResizeMouseDown(e, 'resize-start')}
          />
          <div
            className={`${styles.resizeHandle} ${styles.resizeHandleRight}`}
            onMouseDown={(e) => handleResizeMouseDown(e, 'resize-end')}
          />
        </>
      )}

      {/* Dependency arrow button - hidden when locked */}
      {!isLocked && (
        <DependencyArrow
          isVisible={showDependencyArrow}
          isCreatingDependency={isCreatingDependency}
          onStartDependency={handleStartDependency}
        />
      )}

      {/* Drag area - single click opens edit */}
      <div
        className={styles.dragArea}
        onMouseDown={(e) => {
          if (isLocked) return; // Disable drag when locked
          e.preventDefault();
          e.stopPropagation();
          clickStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
          setDragStartX(e.clientX);
          setOriginalStartDate(milestone.startDate);
          setOriginalEndDate(milestone.endDate);
          setupInitialDragDetection('move', e.clientX, e.clientY);
        }}
        onMouseUp={(e) => {
          // Always clean up initial listeners on mouseUp
          if (initialListenersRef.current) {
            document.removeEventListener('mousemove', initialListenersRef.current.move);
            document.removeEventListener('mouseup', initialListenersRef.current.up);
            initialListenersRef.current = null;
          }
          if (!clickStartRef.current) return;
          const dx = Math.abs(e.clientX - clickStartRef.current.x);
          const dy = Math.abs(e.clientY - clickStartRef.current.y);
          const elapsed = Date.now() - clickStartRef.current.time;
          // If minimal movement and quick click, open edit dialog and select (unless locked)
          if (dx < 5 && dy < 5 && elapsed < 300) {
            e.stopPropagation();
            setDragMode(null); // Clear drag mode before opening modal
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
        <span className={styles.milestoneTitle}>{milestone.title}</span>
      </div>

      {/* Context menu */}
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={menuItems}
        onClose={contextMenu.close}
        isOpeningRef={contextMenu.isOpeningRef}
      />

      {/* Tooltip - rendered via portal to escape overflow:hidden */}
      {showTooltip && !dragMode && tooltipPosition && createPortal(
        <div
          className={styles.tooltip}
          style={{
            position: 'fixed',
            left: tooltipPosition.x,
            top: tooltipPosition.y - 8,
            transform: 'translate(-50%, -100%)'
          }}
          role="tooltip"
        >
          <div className={styles.tooltipTitle}>{milestone.title}</div>
          <div className={styles.tooltipDates}>
            {formatShortDate(milestone.startDate)} {'\u2013'} {formatShortDate(milestone.endDate)}
            {' \u00B7 '}{(() => {
              const days = differenceInDays(new Date(milestone.endDate), new Date(milestone.startDate)) + 1;
              if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
              const weeks = Math.round(days / 7);
              if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'}`;
              const months = Math.round(days / 30);
              return `${months} month${months === 1 ? '' : 's'}`;
            })()}
          </div>
          {(() => {
            const label = isPast ? 'Complete' : getStatusNameByHex(milestone.statusColor);
            return label ? (
              <div className={styles.tooltipStatus} style={!isPast ? { color: displayColor } : undefined}>
                {label}
              </div>
            ) : null;
          })()}
          <div className={styles.tooltipHint}>
            {isLocked ? 'Right-click for options' : 'Click to edit \u00B7 Right-click for menu'}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}, areMilestonePropsEqual);

// Export the memoized component
export { MilestoneLineComponent as MilestoneLine };
