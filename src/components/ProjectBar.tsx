import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { Project, Milestone } from '../types';
import { MilestoneLine } from './MilestoneLine';
import { DependencyArrow } from './DependencyArrow';
import { useDependencyCreation } from '../contexts/DependencyCreationContext';
import {
  getBarDimensions,
  toISODateString,
  formatShortDate,
  isDatePast
} from '../utils/dateUtils';
import { parseISO } from 'date-fns';
import styles from './ProjectBar.module.css';

const AUTO_BLUE = '#0070c0'; // Blue for completed/past projects

// Calculate stack indices for overlapping milestones
// Optimized O(n log n) algorithm using interval scheduling
function calculateMilestoneStacks(milestones: Milestone[]): Map<string, number> {
  const stacks = new Map<string, number>();
  if (!milestones || milestones.length === 0) return stacks;

  // Sort milestones by start date (O(n log n))
  const sorted = [...milestones].sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  // Track the end time for each stack to avoid O(n) lookups
  // Each index represents a stack, value is the end timestamp of the last milestone in that stack
  const stackEndTimes: number[] = [];

  sorted.forEach((milestone) => {
    const startTime = new Date(milestone.startDate).getTime();
    const endTime = new Date(milestone.endDate).getTime();

    // Find the first stack where this milestone can fit
    // (where the previous milestone in that stack has ended)
    let assignedStack = -1;
    for (let i = 0; i < stackEndTimes.length; i++) {
      if (stackEndTimes[i] < startTime) {
        // This stack is available (no overlap)
        assignedStack = i;
        stackEndTimes[i] = endTime; // Update the stack's end time
        break;
      }
    }

    // If no available stack found, create a new one
    if (assignedStack === -1) {
      assignedStack = stackEndTimes.length;
      stackEndTimes.push(endTime);
    }

    stacks.set(milestone.id, assignedStack);
  });

  return stacks;
}

interface ProjectBarProps {
  project: Project;
  timelineStart: Date;
  dayWidth: number;
  stackIndex?: number;
  isDragging?: boolean;
  isSelected?: boolean;
  dragListeners?: React.DOMAttributes<HTMLDivElement>;
  onUpdate: (updates: Partial<Project>) => Promise<void>;
  onDelete: () => void;
  onAddMilestone: () => void;
  onEdit: () => void;
  onEditMilestone: (milestoneId: string) => void;
  onUpdateMilestone: (milestoneId: string, updates: Partial<import('../types').Milestone>) => Promise<void>;
  onDeleteMilestone: (milestoneId: string) => void;
  onCopy?: () => void;
  onEdgeDrag?: (mouseX: number, isDragging: boolean) => void;
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
  isDragging: externalDragging,
  isSelected,
  dragListeners: _dragListeners, // Currently unused - manual drag used instead for date changes
  onUpdate,
  onDelete,
  onAddMilestone,
  onEdit,
  onEditMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onCopy,
  onEdgeDrag
}: ProjectBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [originalDates, setOriginalDates] = useState({ start: '', end: '' });
  // Preview dates for smooth visual feedback during drag (separate from actual data)
  const [previewDates, setPreviewDates] = useState<{ start: string; end: string } | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const menuJustOpenedRef = useRef(false);
  const [showDependencyArrow, setShowDependencyArrow] = useState(false);

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
  onUpdateRef.current = onUpdate;
  onEdgeDragRef.current = onEdgeDrag;

  // Clear preview when actual data matches what we saved
  // This is more robust than timing-based clearing because React's batching
  // means the parent might not have re-rendered yet when mouseUp handler completes
  useEffect(() => {
    if (previewDates &&
        project.startDate === previewDates.start &&
        project.endDate === previewDates.end) {
      setPreviewDates(null);
    }
  }, [project.startDate, project.endDate, previewDates]);

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
  const displayColor = isPast ? AUTO_BLUE : project.statusColor;

  const handleMouseDown = useCallback((e: React.MouseEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    setDragMode(mode);
    setDragStartX(e.clientX);
    setOriginalDates({ start: project.startDate, end: project.endDate });
  }, [project.startDate, project.endDate]);

  // Track the latest preview for committing on mouseUp
  const latestPreviewRef = useRef<{ start: string; end: string } | null>(null);
  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!dragMode) return;

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

    const handleMouseUp = async () => {
      onEdgeDragRef.current?.(0, false); // Stop edge scrolling

      // Commit the final position to Firebase only on release
      const finalPreview = latestPreviewRef.current;
      if (finalPreview) {
        const hasChanged = finalPreview.start !== originalDates.start || finalPreview.end !== originalDates.end;
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

    document.addEventListener('mousemove', handleMouseMove);
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
  }, [dragMode, dragStartX, originalDates, dayWidth]);

  // Close menu when clicking outside (with defenses against premature closure)
  useEffect(() => {
    if (!showMenu) return;

    let timeoutId: number | null = null;
    let graceTimeoutId: number | null = null;

    const handleClose = (e: MouseEvent) => {
      // Layer 2: Only close on left-clicks (button 0), ignore right-clicks
      if (e.button !== 0) return;

      // Layer 3: Grace period - don't close if menu was just opened
      if (menuJustOpenedRef.current) return;

      setShowMenu(false);
    };

    // Layer 1: Defer listener attachment to next event loop tick
    // This ensures the current right-click event cycle completes before we start listening
    timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClose);
    }, 0);

    // Layer 3: Clear the "just opened" flag after grace period
    graceTimeoutId = setTimeout(() => {
      menuJustOpenedRef.current = false;
    }, 100);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (graceTimeoutId) clearTimeout(graceTimeoutId);
      document.removeEventListener('mousedown', handleClose);
    };
  }, [showMenu]);

  // Calculate milestone stacking
  const milestoneStacks = useMemo(
    () => calculateMilestoneStacks(project.milestones || []),
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
  const projectBarHeight = Math.max(BASE_PROJECT_HEIGHT, dynamicHeight);

  const topPosition = 12 + stackIndex * 68; // Matches LANE_PADDING and PROJECT_HEIGHT in Timeline

  // Keyboard handler for accessibility
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onEdit();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onDelete();
    } else if (e.key === 'c' && (e.metaKey || e.ctrlKey) && onCopy) {
      e.preventDefault();
      onCopy();
    }
  }, [onEdit, onDelete, onCopy]);

  // Handle starting a dependency from this project
  const handleStartDependency = useCallback(() => {
    startCreation({
      projectId: project.id,
      position: {
        x: left + width,
        y: topPosition + projectBarHeight / 2
      }
    });
  }, [project.id, left, width, topPosition, projectBarHeight, startCreation]);

  // Handle click when in dependency creation mode (this project becomes the target)
  const handleDependencyTarget = useCallback(() => {
    if (isCreatingDependency && !isSource) {
      completeCreation({ projectId: project.id });
    }
  }, [isCreatingDependency, isSource, project.id, completeCreation]);

  // Track mouse proximity to end of bar for showing dependency arrow
  const handleMouseMoveForArrow = useCallback((e: React.MouseEvent) => {
    if (!barRef.current || isCreatingDependency) {
      setShowDependencyArrow(false);
      return;
    }
    const rect = barRef.current.getBoundingClientRect();
    const distanceFromEnd = rect.right - e.clientX;
    // Show arrow when within 40px of the right edge
    setShowDependencyArrow(distanceFromEnd <= 40 && distanceFromEnd >= 0);
  }, [isCreatingDependency]);

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
      onKeyDown={handleKeyDown}
      onClick={isTargetable ? handleDependencyTarget : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // Clamp menu position to viewport bounds to prevent clipping
        const menuWidth = 160;
        const menuHeight = 140;
        const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
        const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
        setMenuPosition({ x: Math.max(10, x), y: Math.max(10, y) });
        menuJustOpenedRef.current = true;
        setShowMenu(true);
      }}
      onMouseMove={(e) => {
        // Track proximity to end for showing dependency arrow
        handleMouseMoveForArrow(e);
      }}
      onMouseLeave={() => {
        setShowDependencyArrow(false);
      }}
    >
      {/* Resize handles */}
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

      {/* Dependency arrow button - appears on hover near end */}
      <DependencyArrow
        isVisible={showDependencyArrow}
        isCreatingDependency={isCreatingDependency}
        onStartDependency={handleStartDependency}
      />

      {/* Draggable area - single click opens edit, drag moves dates */}
      <div
        className={styles.dragArea}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          clickStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
          // Start drag mode for date movement
          handleMouseDown(e, 'move');
        }}
        onMouseUp={(e) => {
          if (!clickStartRef.current) return;
          const dx = Math.abs(e.clientX - clickStartRef.current.x);
          const dy = Math.abs(e.clientY - clickStartRef.current.y);
          const elapsed = Date.now() - clickStartRef.current.time;
          // If minimal movement and quick click, open context menu
          if (dx < 5 && dy < 5 && elapsed < 300) {
            // Clamp menu position to viewport bounds
            const menuWidth = 160;
            const menuHeight = 140;
            const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10);
            const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10);
            setMenuPosition({ x: Math.max(10, x), y: Math.max(10, y) });
            menuJustOpenedRef.current = true;
            setShowMenu(true);
          }
          clickStartRef.current = null;
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onEdit();
        }}
      >
        <div className={styles.projectContent}>
          <span className={styles.projectTitle}>{project.title}</span>
          <span className={styles.projectSeparator}>•</span>
          <span className={styles.projectDates}>
            {formatShortDate(project.startDate)} - {formatShortDate(project.endDate)}
          </span>
        </div>
      </div>

      {/* Milestones as lines within the project bar - OUTSIDE dragArea to prevent interference */}
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
            onUpdate={(updates) => onUpdateMilestone(milestone.id, updates)}
            onEdit={() => onEditMilestone(milestone.id)}
            onDelete={() => onDeleteMilestone(milestone.id)}
          />
        ))}
      </div>

      {/* Context menu */}
      {showMenu && (
        <div
          className={styles.contextMenu}
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button onClick={onEdit}>Edit Project</button>
          <button onClick={onAddMilestone}>Add Milestone</button>
          {onCopy && <button onClick={() => { onCopy(); setShowMenu(false); }}>Copy Project</button>}
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}
