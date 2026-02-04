import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Milestone, ContextMenuItem } from '../types';
import { DependencyArrow } from './DependencyArrow';
import { ContextMenu } from './ContextMenu';
import { useContextMenu } from '../hooks/useContextMenu';
import { useDependencyCreation } from '../contexts/DependencyCreationContext';
import { getBarDimensions, isMilestonePast, formatShortDate, toISODateString } from '../utils/dateUtils';
import { parseISO } from 'date-fns';
import styles from './MilestoneLine.module.css';

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

export function MilestoneLine({
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

  // Clear preview when actual data matches what we saved
  // This is more robust than timing-based clearing
  useEffect(() => {
    if (previewDates &&
        milestone.startDate === previewDates.start &&
        milestone.endDate === previewDates.end) {
      setPreviewDates(null);
    }
  }, [milestone.startDate, milestone.endDate, previewDates]);

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
  const relativeLeft = milestoneLeft - projectLeft;
  const displayLeft = Math.max(0, relativeLeft);
  const displayWidth = Math.min(
    milestoneWidth,
    projectWidth - displayLeft - 16 // Account for padding
  );

  // Auto-blue rule: turn blue if milestone end date is past
  const isPast = isMilestonePast(milestone.endDate);
  const displayColor = isPast ? AUTO_BLUE : milestone.statusColor;

  const handleMouseDown = useCallback((e: React.MouseEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    setDragMode(mode);
    setDragStartX(e.clientX);
    setOriginalDates({ start: milestone.startDate, end: milestone.endDate });
  }, [milestone.startDate, milestone.endDate]);

  // Track the latest preview for committing on mouseUp
  const latestPreviewRef = useRef<{ start: string; end: string } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const pendingDragModeRef = useRef<DragMode>(null);

  // Initial drag detection - only activates dragMode after movement threshold
  // This matches ProjectBar's pattern to prevent conflicting event handling
  // CRITICAL: Include originalDates in deps so effect runs after mouseDown sets it
  useEffect(() => {
    if (dragMode !== null || !clickStartRef.current) return;

    const DRAG_THRESHOLD = 8;

    const handleInitialMouseMove = (e: MouseEvent) => {
      if (!clickStartRef.current) return;

      const dx = Math.abs(e.clientX - clickStartRef.current.x);
      const dy = Math.abs(e.clientY - clickStartRef.current.y);

      // Only activate drag mode if movement exceeds threshold
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        const mode = pendingDragModeRef.current || 'move';
        setDragMode(mode);
        clickStartRef.current = null; // Clear click tracking since we're dragging
      }
    };

    const handleInitialMouseUp = () => {
      // Clean up without activating drag mode (this was a click)
      pendingDragModeRef.current = null;
      clickStartRef.current = null;
    };

    document.addEventListener('mousemove', handleInitialMouseMove);
    document.addEventListener('mouseup', handleInitialMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleInitialMouseMove);
      document.removeEventListener('mouseup', handleInitialMouseUp);
    };
  }, [dragMode, originalDates]);

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
        const deltaX = e.clientX - dragStartX;

        // Don't start moving until we've exceeded the drag threshold
        if (Math.abs(deltaX) < DRAG_THRESHOLD) return;

        const deltaDays = Math.round(deltaX / dayWidth);

        const originalStart = parseISO(originalDates.start);
        const originalEnd = parseISO(originalDates.end);

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
      });
    };

    const handleMouseUp = () => {
      // Commit the final position to Firebase only on release
      const finalPreview = latestPreviewRef.current;
      if (finalPreview && isMountedRef.current) {
        const hasChanged = finalPreview.start !== originalDates.start || finalPreview.end !== originalDates.end;
        if (hasChanged) {
          // Fire the update - let the effect clear preview when props match
          onUpdateRef.current({
            startDate: finalPreview.start,
            endDate: finalPreview.end
          }).catch(() => {
            // If save fails, clear preview (rollback will restore old position)
            if (isMountedRef.current) {
              setPreviewDates(null);
            }
          });
        } else {
          // No change, clear preview immediately
          setPreviewDates(null);
        }
      } else {
        // No preview, clear anyway
        if (isMountedRef.current) {
          setPreviewDates(null);
        }
      }

      latestPreviewRef.current = null;
      if (isMountedRef.current) {
        setDragMode(null);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // Cleanup on unmount or when dragMode changes - ensures listeners are always removed
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Cancel any pending animation frame on cleanup
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [dragMode, dragStartX, originalDates, dayWidth]);

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
  const handleMouseMoveForArrow = useCallback((e: React.MouseEvent) => {
    if (!milestoneRef.current || isCreatingDependency) {
      setShowDependencyArrow(false);
      return;
    }
    const rect = milestoneRef.current.getBoundingClientRect();
    const distanceFromEnd = rect.right - e.clientX;
    setShowDependencyArrow(distanceFromEnd <= 30 && distanceFromEnd >= 0);
  }, [isCreatingDependency]);

  const isTargetable = isCreatingDependency && !isSource;

  if (displayWidth <= 0 || displayLeft >= projectWidth) {
    return null; // Milestone outside project bounds
  }

  return (
    <div
      ref={milestoneRef}
      data-dependency-target
      className={`${styles.milestoneLine} ${dragMode ? styles.dragging : ''} ${isTargetable ? styles.targetable : ''} ${isSource ? styles.isSource : ''}`}
      style={{
        left: displayLeft,
        top: stackIndex * (MILESTONE_HEIGHT + MILESTONE_GAP),
        width: Math.max(displayWidth, 24),
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
        setShowDependencyArrow(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        contextMenu.open({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Resize handles */}
      <div
        className={`${styles.resizeHandle} ${styles.resizeHandleLeft}`}
        onMouseDown={(e) => handleMouseDown(e, 'resize-start')}
      />
      <div
        className={`${styles.resizeHandle} ${styles.resizeHandleRight}`}
        onMouseDown={(e) => handleMouseDown(e, 'resize-end')}
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
          pendingDragModeRef.current = 'move';
          setDragStartX(e.clientX);
          setOriginalDates({ start: milestone.startDate, end: milestone.endDate });
        }}
        onMouseUp={(e) => {
          if (!clickStartRef.current) return;
          const dx = Math.abs(e.clientX - clickStartRef.current.x);
          const dy = Math.abs(e.clientY - clickStartRef.current.y);
          const elapsed = Date.now() - clickStartRef.current.time;
          // If minimal movement and quick click, open edit dialog and select
          if (dx < 5 && dy < 5 && elapsed < 300) {
            e.stopPropagation();
            setDragMode(null); // Clear drag mode before opening modal
            onSelect?.();
            onEdit();
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
}
