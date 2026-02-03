import { useState, useEffect, useCallback, useRef } from 'react';
import type { Milestone } from '../types';
import { getBarDimensions, isMilestonePast, formatShortDate, toISODateString } from '../utils/dateUtils';
import { parseISO } from 'date-fns';
import styles from './MilestoneLine.module.css';

interface MilestoneLineProps {
  milestone: Milestone;
  timelineStart: Date;
  dayWidth: number;
  projectLeft: number;
  projectWidth: number;
  stackIndex?: number;
  onUpdate: (updates: Partial<Milestone>) => void;
  onEdit: () => void;
  onDelete: () => void;
}

const AUTO_BLUE = '#1e3a5f'; // Navy Blue for past milestones

type DragMode = 'move' | 'resize-start' | 'resize-end' | null;

const MILESTONE_HEIGHT = 20;
const MILESTONE_GAP = 4;

export function MilestoneLine({
  milestone,
  timelineStart,
  dayWidth,
  projectLeft,
  projectWidth,
  stackIndex = 0,
  onUpdate,
  onEdit,
  onDelete
}: MilestoneLineProps) {
  const milestoneRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [originalDates, setOriginalDates] = useState({ start: '', end: '' });

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

  // Auto-blue rule: turn blue if milestone end date is past and no manual override
  const isPast = isMilestonePast(milestone.endDate);
  const displayColor = isPast && !milestone.manualColorOverride
    ? AUTO_BLUE
    : milestone.statusColor;

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

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX;
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

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = () => setShowMenu(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showMenu]);

  if (displayWidth <= 0 || displayLeft >= projectWidth) {
    return null; // Milestone outside project bounds
  }

  return (
    <div
      ref={milestoneRef}
      className={`${styles.milestoneLine} ${dragMode ? styles.dragging : ''}`}
      style={{
        left: displayLeft,
        top: stackIndex * (MILESTONE_HEIGHT + MILESTONE_GAP),
        width: Math.max(displayWidth, 24),
        backgroundColor: displayColor || '#10b981'
      }}
      onMouseEnter={() => !dragMode && setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
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

      {/* Drag area */}
      <div
        className={styles.dragArea}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
      >
        <span className={styles.milestoneTitle}>{milestone.title}</span>
      </div>

      {/* Tooltip */}
      {showTooltip && !dragMode && (
        <div className={styles.tooltip}>
          <div className={styles.tooltipTitle}>{milestone.title}</div>
          <div className={styles.tooltipDates}>
            {formatShortDate(milestone.startDate)} - {formatShortDate(milestone.endDate)}
          </div>
          {(milestone.tags?.length ?? 0) > 0 && (
            <div className={styles.tooltipTags}>
              {(milestone.tags || []).map((tag, i) => (
                <span key={i} className={styles.tag}>{tag}</span>
              ))}
            </div>
          )}
          {isPast && !milestone.manualColorOverride && (
            <div className={styles.pastBadge}>Past milestone</div>
          )}
        </div>
      )}

      {/* Context menu */}
      {showMenu && (
        <div className={styles.contextMenu} onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit}>Edit Milestone</button>
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}
