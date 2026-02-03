import { useState, useEffect, useCallback, useRef } from 'react';
import type { Milestone } from '../types';
import { DependencyArrow } from './DependencyArrow';
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
  onUpdate: (updates: Partial<Milestone>) => void;
  onEdit: () => void;
  onDelete: () => void;
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
  onDelete
}: MilestoneLineProps) {
  const milestoneRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0, below: false, showLeft: false });
  const [showMenu, setShowMenu] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [originalDates, setOriginalDates] = useState({ start: '', end: '' });
  const [showDependencyArrow, setShowDependencyArrow] = useState(false);

  // Dependency creation context
  const { state: depState, startCreation, completeCreation } = useDependencyCreation();
  const isCreatingDependency = depState.isCreating;
  const isSource = depState.source?.projectId === projectId && depState.source?.milestoneId === milestone.id;

  // Click-to-edit tracking (distinguish from drag)
  const clickStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const { left: milestoneLeft, width: milestoneWidth } = getBarDimensions(
    milestone.startDate,
    milestone.endDate,
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
    setShowTooltip(false);
  }, [milestone.startDate, milestone.endDate]);

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
      onMouseEnter={(e) => {
        if (!dragMode) {
          setShowTooltip(true);
          // Initial position near cursor
          const tooltipHeight = 120;
          const tooltipWidth = 180;
          const cursorOffset = 15;
          const showBelow = e.clientY < tooltipHeight + 20;
          const showLeft = e.clientX + tooltipWidth + cursorOffset > window.innerWidth;
          setTooltipPosition({
            x: showLeft ? e.clientX - cursorOffset : e.clientX + cursorOffset,
            y: showBelow ? e.clientY + cursorOffset : e.clientY - cursorOffset,
            below: showBelow,
            showLeft
          });
        }
      }}
      onMouseMove={(e) => {
        handleMouseMoveForArrow(e);
        // Update tooltip position to follow cursor
        if (!dragMode && showTooltip) {
          const tooltipHeight = 120;
          const tooltipWidth = 180;
          const cursorOffset = 15;
          const showBelow = e.clientY < tooltipHeight + 20;
          const showLeft = e.clientX + tooltipWidth + cursorOffset > window.innerWidth;
          setTooltipPosition({
            x: showLeft ? e.clientX - cursorOffset : e.clientX + cursorOffset,
            y: showBelow ? e.clientY + cursorOffset : e.clientY - cursorOffset,
            below: showBelow,
            showLeft
          });
        }
      }}
      onMouseLeave={() => {
        setShowTooltip(false);
        setShowDependencyArrow(false);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuPosition({ x: e.clientX, y: e.clientY });
        setShowMenu(true);
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
          clickStartRef.current = { x: e.clientX, y: e.clientY, time: Date.now() };
          handleMouseDown(e, 'move');
        }}
        onMouseUp={(e) => {
          if (!clickStartRef.current) return;
          const dx = Math.abs(e.clientX - clickStartRef.current.x);
          const dy = Math.abs(e.clientY - clickStartRef.current.y);
          const elapsed = Date.now() - clickStartRef.current.time;
          // If minimal movement and quick click, open edit
          if (dx < 5 && dy < 5 && elapsed < 300) {
            e.stopPropagation();
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

      {/* Tooltip - positioned next to cursor */}
      {showTooltip && !dragMode && (
        <div
          className={styles.tooltip}
          style={{
            position: 'fixed',
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: `${tooltipPosition.showLeft ? 'translateX(-100%)' : ''} ${tooltipPosition.below ? '' : 'translateY(-100%)'}`.trim() || 'none'
          }}
        >
          <div className={styles.tooltipTitle}>{milestone.title}</div>
          <div className={styles.tooltipDates}>
            {formatShortDate(milestone.startDate)} - {formatShortDate(milestone.endDate)}
          </div>
          {milestone.description && (
            <div className={styles.tooltipDescription}>{milestone.description}</div>
          )}
          {(milestone.tags?.length ?? 0) > 0 && (
            <div className={styles.tooltipTags}>
              {(milestone.tags || []).map((tag, i) => (
                <span key={i} className={styles.tag}>{tag}</span>
              ))}
            </div>
          )}
          {isPast && (
            <div className={styles.pastBadge}>Complete</div>
          )}
          <div className={styles.tooltipHint}>Click to edit • Drag to move</div>
        </div>
      )}

      {/* Context menu */}
      {showMenu && (
        <div
          className={styles.contextMenu}
          style={{ left: menuPosition.x, top: menuPosition.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={onEdit}>Edit Milestone</button>
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}
