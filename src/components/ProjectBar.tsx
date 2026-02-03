import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { Project, Milestone } from '../types';
import { MilestoneLine } from './MilestoneLine';
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
  dragListeners,
  onUpdate,
  onDelete,
  onAddMilestone,
  onEdit,
  onEditMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onCopy
}: ProjectBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [originalDates, setOriginalDates] = useState({ start: '', end: '' });
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0, below: false });

  // Click-to-edit tracking (distinguish from drag)
  const clickStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

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
      setDragMode(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, dragStartX, originalDates, dayWidth, onUpdate]);

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

  const topPosition = 8 + stackIndex * 68; // Matches PROJECT_HEIGHT in Timeline

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

  return (
    <div
      ref={barRef}
      className={`${styles.projectBar} ${dragMode || externalDragging ? styles.dragging : ''} ${isSelected ? styles.selected : ''}`}
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
        if (!dragMode && !externalDragging && barRef.current) {
          const rect = barRef.current.getBoundingClientRect();
          const tooltipHeight = 150; // Estimated tooltip height
          // Check if there's room above, if not show below
          const showBelow = rect.top < tooltipHeight + 20;
          setTooltipPosition({
            x: rect.left + rect.width / 2,
            y: showBelow ? rect.bottom : rect.top,
            below: showBelow
          });
          setShowTooltip(true);
        }
      }}
      onMouseLeave={() => setShowTooltip(false)}
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

      {/* Draggable area - single click opens edit */}
      <div
        className={styles.dragArea}
        onMouseDown={(e) => {
          clickStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
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
        {...dragListeners}
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
            timelineStart={timelineStart}
            dayWidth={dayWidth}
            projectLeft={left}
            projectWidth={width}
            stackIndex={milestoneStacks.get(milestone.id) || 0}
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

      {/* Tooltip */}
      {showTooltip && !dragMode && !externalDragging && !showMenu && (
        <div
          className={styles.tooltip}
          style={{
            position: 'fixed',
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: tooltipPosition.below
              ? 'translateX(-50%) translateY(0)'
              : 'translateX(-50%) translateY(-100%)',
            marginTop: tooltipPosition.below ? 8 : -8
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
