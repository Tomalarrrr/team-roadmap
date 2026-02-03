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
import { parseISO, areIntervalsOverlapping } from 'date-fns';
import styles from './ProjectBar.module.css';

const AUTO_BLUE = '#0070c0'; // Blue for completed/past projects

// Calculate stack indices for overlapping milestones
function calculateMilestoneStacks(milestones: Milestone[]): Map<string, number> {
  const stacks = new Map<string, number>();
  if (!milestones || milestones.length === 0) return stacks;

  // Sort milestones by start date
  const sorted = [...milestones].sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  sorted.forEach((milestone) => {
    let stackIndex = 0;
    const milestoneInterval = {
      start: new Date(milestone.startDate),
      end: new Date(milestone.endDate)
    };

    // Find the lowest available stack index
    while (true) {
      let canUseStack = true;
      for (const [otherId, otherStack] of stacks) {
        if (otherStack !== stackIndex) continue;
        const other = milestones.find(m => m.id === otherId);
        if (!other) continue;

        const otherInterval = {
          start: new Date(other.startDate),
          end: new Date(other.endDate)
        };

        if (areIntervalsOverlapping(milestoneInterval, otherInterval, { inclusive: true })) {
          canUseStack = false;
          break;
        }
      }
      if (canUseStack) break;
      stackIndex++;
    }
    stacks.set(milestone.id, stackIndex);
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
  onUpdate: (updates: Partial<Project>) => void;
  onDelete: () => void;
  onAddMilestone: () => void;
  onEdit: () => void;
  onEditMilestone: (milestoneId: string) => void;
  onUpdateMilestone: (milestoneId: string, updates: Partial<import('../types').Milestone>) => void;
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
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0, below: false, showLeft: false });
  const [showDependencyArrow, setShowDependencyArrow] = useState(false);

  // Dependency creation context
  const { state: depState, startCreation, completeCreation } = useDependencyCreation();
  const isCreatingDependency = depState.isCreating;
  const isSource = depState.source?.projectId === project.id && !depState.source?.milestoneId;

  // Click-to-edit tracking (distinguish from drag)
  const clickStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Calculate effective dates including milestone extensions
  const effectiveDates = useMemo(() => {
    let effectiveStart = project.startDate;
    let effectiveEnd = project.endDate;

    (project.milestones || []).forEach(milestone => {
      if (milestone.startDate < effectiveStart) {
        effectiveStart = milestone.startDate;
      }
      if (milestone.endDate > effectiveEnd) {
        effectiveEnd = milestone.endDate;
      }
    });

    return { start: effectiveStart, end: effectiveEnd };
  }, [project.startDate, project.endDate, project.milestones]);

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

  useEffect(() => {
    if (!dragMode) return;

    const DRAG_THRESHOLD = 8; // Minimum pixels before drag activates

    const handleMouseMove = (e: MouseEvent) => {
      // Notify edge scroll system
      onEdgeDrag?.(e.clientX, true);

      const deltaX = e.clientX - dragStartX;

      // Don't start moving until we've exceeded the drag threshold
      if (Math.abs(deltaX) < DRAG_THRESHOLD) return;

      const deltaDays = Math.round(deltaX / dayWidth);

      if (deltaDays === 0) return;

      const originalStart = parseISO(originalDates.start);
      const originalEnd = parseISO(originalDates.end);

      if (dragMode === 'move') {
        const newStart = new Date(originalStart);
        const newEnd = new Date(originalEnd);
        newStart.setDate(newStart.getDate() + deltaDays);
        newEnd.setDate(newEnd.getDate() + deltaDays);
        onUpdate({
          startDate: toISODateString(newStart),
          endDate: toISODateString(newEnd)
        });
      } else if (dragMode === 'resize-start') {
        const newStart = new Date(originalStart);
        newStart.setDate(newStart.getDate() + deltaDays);
        if (newStart < originalEnd) {
          onUpdate({ startDate: toISODateString(newStart) });
        }
      } else if (dragMode === 'resize-end') {
        const newEnd = new Date(originalEnd);
        newEnd.setDate(newEnd.getDate() + deltaDays);
        if (newEnd > originalStart) {
          onUpdate({ endDate: toISODateString(newEnd) });
        }
      }
    };

    const handleMouseUp = () => {
      onEdgeDrag?.(0, false); // Stop edge scrolling
      setDragMode(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, dragStartX, originalDates, dayWidth, onUpdate, onEdgeDrag]);

  // Close menu when clicking outside or right-clicking elsewhere
  useEffect(() => {
    if (!showMenu) return;
    const handleClose = () => setShowMenu(false);
    document.addEventListener('click', handleClose);
    document.addEventListener('contextmenu', handleClose);
    return () => {
      document.removeEventListener('click', handleClose);
      document.removeEventListener('contextmenu', handleClose);
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
        setShowMenu(true);
      }}
      onMouseEnter={() => {
        if (!dragMode && !externalDragging) {
          tooltipTimeoutRef.current = setTimeout(() => {
            if (isMountedRef.current) {
              setShowTooltip(true);
            }
          }, 800);
        }
      }}
      onMouseMove={(e) => {
        // Track proximity to end for showing dependency arrow
        handleMouseMoveForArrow(e);

        if (!dragMode && !externalDragging && showTooltip) {
          const tooltipHeight = 150;
          const tooltipWidth = 200;
          const cursorOffset = 15; // Distance from cursor
          // Position near cursor, show below if too close to top
          const showBelow = e.clientY < tooltipHeight + 20;
          // Position to the right of cursor, or left if near right edge
          const showLeft = e.clientX + tooltipWidth + cursorOffset > window.innerWidth;
          const x = showLeft
            ? e.clientX - cursorOffset  // Position to left of cursor
            : e.clientX + cursorOffset; // Position to right of cursor
          setTooltipPosition({
            x,
            y: showBelow ? e.clientY + cursorOffset : e.clientY - cursorOffset,
            below: showBelow,
            showLeft
          });
        }
      }}
      onMouseLeave={() => {
        if (tooltipTimeoutRef.current) {
          clearTimeout(tooltipTimeoutRef.current);
          tooltipTimeoutRef.current = null;
        }
        setShowTooltip(false);
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
          // If minimal movement and quick click, open edit
          if (dx < 5 && dy < 5 && elapsed < 300) {
            onEdit();
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
        >
          <button onClick={onEdit}>Edit Project</button>
          <button onClick={onAddMilestone}>Add Milestone</button>
          {onCopy && <button onClick={() => { onCopy(); setShowMenu(false); }}>Copy Project</button>}
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}

      {/* Tooltip - positioned next to cursor */}
      {showTooltip && !dragMode && !externalDragging && !showMenu && (
        <div
          className={styles.tooltip}
          style={{
            position: 'fixed',
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: `${tooltipPosition.showLeft ? 'translateX(-100%)' : ''} ${tooltipPosition.below ? '' : 'translateY(-100%)'}`.trim() || 'none'
          }}
        >
          <div className={styles.tooltipTitle}>{project.title}</div>
          <div className={styles.tooltipDates}>
            {formatShortDate(project.startDate)} - {formatShortDate(project.endDate)}
          </div>
          {(project.milestones?.length ?? 0) > 0 && (
            <div className={styles.tooltipMilestones}>
              {project.milestones.length} milestone{project.milestones.length !== 1 ? 's' : ''}
            </div>
          )}
          {isPast && (
            <div className={styles.pastBadge}>Complete</div>
          )}
          <div className={styles.tooltipHint}>Click to edit • Drag to move</div>
        </div>
      )}
    </div>
  );
}
