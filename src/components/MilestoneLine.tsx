import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import type { Milestone, ContextMenuItem } from '../types';
import { DependencyArrow } from './DependencyArrow';
import { ContextMenu } from './ContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDependencyCreation } from '../contexts/DependencyCreationContext';
import { getBarDimensions, isMilestonePast, formatShortDate, toISODateString } from '../utils/dateUtils';
import { parseISO } from 'date-fns';
import styles from './MilestoneLine.module.css';

// Debug flag - set to true to diagnose flashing issues
const DEBUG_DRAG = false; // Turned off - excessive logging was causing performance issues

interface MilestoneLineProps {
  milestone: Milestone;
  projectId: string;
  timelineStart: Date;
  dayWidth: number;
  projectLeft: number;
  projectWidth: number;
  stackIndex?: number;
  laneTop?: number; // Top position of the lane for dependency positioning
  onUpdate: (updates: Partial<Milestone>) => Promise<void>;
  onEdit: () => void;
  onDelete: () => void;
  onSelect?: () => void;
}

const AUTO_BLUE = '#0070c0'; // Blue for completed/past milestones

type DragMode = 'move' | 'resize-start' | 'resize-end' | null;

const MILESTONE_HEIGHT = 20;
const MILESTONE_GAP = 4;

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
        prevProps.laneTop !== nextProps.laneTop) {
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
  onUpdate,
  onEdit,
  onDelete,
  onSelect
}: MilestoneLineProps) {
  const milestoneRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [originalDates, setOriginalDates] = useState({ start: '', end: '' });
  // Preview dates for smooth visual feedback during drag
  const [previewDates, setPreviewDates] = useState<{ start: string; end: string } | null>(null);
  const [showDependencyArrow, setShowDependencyArrow] = useState(false);

  // Dependency creation context
  const { state: depState, startCreation, completeCreation } = useDependencyCreation();
  const isCreatingDependency = depState.isCreating;
  const isSource = depState.source?.projectId === projectId && depState.source?.milestoneId === milestone.id;

  // Context menu state
  const contextMenu = useContextMenu();

  // Context menu items configuration
  const menuItems: ContextMenuItem[] = useMemo(() => [
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
  ], [onEdit, onDelete]);

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
    if (dragMode) {
      if (DEBUG_DRAG) console.log('[MilestoneLine] Skipping preview clear - dragMode active:', dragMode);
      return; // Prevent clearing during drag
    }

    if (previewDates &&
        milestone.startDate === previewDates.start &&
        milestone.endDate === previewDates.end) {
      if (DEBUG_DRAG) console.log('[MilestoneLine] Clearing previewDates - data matched');
      setPreviewDates(null);
    }
  }, [milestone.startDate, milestone.endDate, previewDates, dragMode]);

  // Use preview dates during drag for smooth visual feedback
  const displayStartDate = previewDates?.start ?? milestone.startDate;
  const displayEndDate = previewDates?.end ?? milestone.endDate;

  // Debug render tracking
  if (DEBUG_DRAG && dragMode) {
    console.log('[MilestoneLine] RENDER during drag:', {
      milestoneId: milestone.id,
      dragMode,
      previewDates,
      actualDates: { start: milestone.startDate, end: milestone.endDate },
      displayDates: { start: displayStartDate, end: displayEndDate },
      projectLeft,
      projectWidth
    });
  }

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
  const displayColor = isPast ? AUTO_BLUE : milestone.statusColor;

  // Immediate drag handler for resize handles (no click detection needed)
  const handleResizeMouseDown = useCallback((e: React.MouseEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    if (DEBUG_DRAG) console.log('[MilestoneLine] RESIZE mouseDown:', mode);
    setDragMode(mode);
    setDragStartX(e.clientX);
    setOriginalDates({ start: milestone.startDate, end: milestone.endDate });
  }, [milestone.startDate, milestone.endDate]);

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
        if (DEBUG_DRAG) console.log('[MilestoneLine] Activating dragMode:', mode);
        setDragMode(mode);
      }
    };

    const handleInitialMouseUp = () => {
      // Clean up - this was a click, not a drag
      if (initialListenersRef.current) {
        document.removeEventListener('mousemove', initialListenersRef.current.move);
        document.removeEventListener('mouseup', initialListenersRef.current.up);
        initialListenersRef.current = null;
      }
      clickStartRef.current = null;
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

    if (DEBUG_DRAG) console.log('[MilestoneLine] Drag effect SETUP:', { dragMode, dragStartX, originalDates, dayWidth });

    const DRAG_THRESHOLD = 8; // Minimum pixels before drag activates

    const handleMouseMove = (e: MouseEvent) => {
      // Cancel any pending animation frame to avoid stacking up updates
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }

      // Use requestAnimationFrame to throttle updates to screen refresh rate
      // This prevents excessive re-renders and improves performance dramatically
      rafIdRef.current = requestAnimationFrame(() => {
        try {
          // Safety check: ensure we have valid original dates before proceeding
          if (!originalDates.start || !originalDates.end) {
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

          const originalStart = parseISO(originalDates.start);
          const originalEnd = parseISO(originalDates.end);

          // Safety check: ensure parsed dates are valid
          if (isNaN(originalStart.getTime()) || isNaN(originalEnd.getTime())) {
            return;
          }

          let newStart = originalDates.start;
          let newEnd = originalDates.end;

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
      if (DEBUG_DRAG) console.log('[MilestoneLine] handleMouseUp - ending drag');
      // Commit the final position to Firebase only on release
      const finalPreview = latestPreviewRef.current;
      if (finalPreview && isMountedRef.current) {
        const hasChanged = finalPreview.start !== originalDates.start || finalPreview.end !== originalDates.end;
        if (hasChanged) {
          if (DEBUG_DRAG) console.log('[MilestoneLine] Committing changes:', finalPreview);
          // Fire the update - let the effect clear preview when props match
          onUpdateRef.current({
            startDate: finalPreview.start,
            endDate: finalPreview.end
          }).catch(() => {
            // If save fails, clear preview (rollback will restore old position)
            if (isMountedRef.current) {
              if (DEBUG_DRAG) console.log('[MilestoneLine] Save failed, clearing preview');
              setPreviewDates(null);
            }
          });
        } else {
          // No change, clear preview immediately
          if (DEBUG_DRAG) console.log('[MilestoneLine] No change, clearing preview');
          setPreviewDates(null);
        }
      } else {
        // No preview, clear anyway
        if (isMountedRef.current) {
          if (DEBUG_DRAG) console.log('[MilestoneLine] No preview to commit');
          setPreviewDates(null);
        }
      }

      latestPreviewRef.current = null;
      if (isMountedRef.current) {
        if (DEBUG_DRAG) console.log('[MilestoneLine] Setting dragMode to null');
        setDragMode(null);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Cleanup on unmount or when dragMode changes - ensures listeners are always removed
    return () => {
      if (DEBUG_DRAG) console.log('[MilestoneLine] Drag effect CLEANUP');
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Cancel any pending animation frame on cleanup
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [dragMode, dragStartX, originalDates]);

  // Keyboard handler for accessibility
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onEdit();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      onDelete();
    }
  }, [onEdit, onDelete]);

  // Handle starting a dependency from this milestone
  const handleStartDependency = useCallback(() => {
    const milestoneTop = laneTop + stackIndex * (MILESTONE_HEIGHT + MILESTONE_GAP) + MILESTONE_HEIGHT / 2 + 52; // 52 = project content height
    startCreation({
      projectId,
      milestoneId: milestone.id,
      position: {
        x: milestoneLeft + milestoneWidth,
        y: milestoneTop
      }
    });
  }, [projectId, milestone.id, milestoneLeft, milestoneWidth, laneTop, stackIndex, startCreation]);

  // Handle click when in dependency creation mode
  const handleDependencyTarget = useCallback(() => {
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

  // CRITICAL: Don't unmount during drag! This was causing the flashing bug.
  // When resizing, the milestone can extend beyond project bounds (based on preview),
  // but projectWidth is based on actual data. If we unmount, we lose all drag state.
  const isOutOfBounds = displayWidth <= 0 || displayLeft >= projectWidth;
  if (!dragMode && isOutOfBounds) {
    return null; // Milestone outside project bounds (only when not dragging)
  }

  // Log when we would have unmounted but didn't because of drag
  if (DEBUG_DRAG && dragMode && isOutOfBounds) {
    console.log('[MilestoneLine] PREVENTED UNMOUNT during drag:', {
      displayWidth,
      displayLeft,
      projectWidth,
      dragMode
    });
  }

  // During drag, clamp to reasonable values to keep visible
  const safeDisplayWidth = dragMode ? Math.max(displayWidth, 24) : displayWidth;
  const safeDisplayLeft = dragMode ? Math.max(0, Math.min(displayLeft, projectWidth - 24)) : displayLeft;

  return (
    <div
      ref={milestoneRef}
      data-dependency-target
      className={`${styles.milestoneLine} ${dragMode ? styles.dragging : ''} ${isTargetable ? styles.targetable : ''} ${isSource ? styles.isSource : ''}`}
      style={{
        left: safeDisplayLeft,
        top: stackIndex * (MILESTONE_HEIGHT + MILESTONE_GAP),
        width: Math.max(safeDisplayWidth, 24),
        backgroundColor: displayColor || '#10b981'
      }}
      role="button"
      tabIndex={0}
      aria-label={`Milestone: ${milestone.title}, ${formatShortDate(milestone.startDate)} to ${formatShortDate(milestone.endDate)}${isPast ? ', Complete' : ''}`}
      onKeyDown={handleKeyDown}
      onClick={isTargetable ? handleDependencyTarget : undefined}
      onMouseMove={(e) => {
        handleMouseMoveForArrow(e);
      }}
      onMouseLeave={() => {
        if (!dragMode) setShowDependencyArrow(false); // Skip during drag
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        contextMenu.open({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Resize handles - use immediate drag mode (no click detection needed) */}
      <div
        className={`${styles.resizeHandle} ${styles.resizeHandleLeft}`}
        onMouseDown={(e) => handleResizeMouseDown(e, 'resize-start')}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeHandleRight}`}
        onMouseDown={(e) => handleResizeMouseDown(e, 'resize-end')}
      />

      {/* Dependency arrow button */}
      <DependencyArrow
        isVisible={showDependencyArrow}
        isCreatingDependency={isCreatingDependency}
        onStartDependency={handleStartDependency}
      />

      {/* Drag area - single click opens edit */}
      <div
        className={styles.dragArea}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          clickStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
          setDragStartX(e.clientX);
          setOriginalDates({ start: milestone.startDate, end: milestone.endDate });
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
          // If minimal movement and quick click, open edit dialog and select
          if (dx < 5 && dy < 5 && elapsed < 300) {
            e.stopPropagation();
            setDragMode(null); // Clear drag mode before opening modal
            clickStartRef.current = null;
            onSelect?.();
            onEdit();
            return;
          }
          clickStartRef.current = null;
        }}
        onDoubleClick={(e) => {
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
    </div>
  );
}, areMilestonePropsEqual);

// Export the memoized component
export { MilestoneLineComponent as MilestoneLine };
