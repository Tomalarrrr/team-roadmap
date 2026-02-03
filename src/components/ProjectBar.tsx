import { useRef, useState, useCallback, useEffect } from 'react';
import type { Project } from '../types';
import { MilestoneLine } from './MilestoneLine';
import {
  getBarDimensions,
  toISODateString,
  formatShortDate
} from '../utils/dateUtils';
import { parseISO } from 'date-fns';
import styles from './ProjectBar.module.css';

interface ProjectBarProps {
  project: Project;
  timelineStart: Date;
  dayWidth: number;
  onUpdate: (updates: Partial<Project>) => void;
  onDelete: () => void;
  onAddMilestone: () => void;
  onEdit: () => void;
  onEditMilestone: (milestoneId: string) => void;
  onDeleteMilestone: (milestoneId: string) => void;
}

type DragMode = 'move' | 'resize-start' | 'resize-end' | null;

export function ProjectBar({
  project,
  timelineStart,
  dayWidth,
  onUpdate,
  onDelete,
  onAddMilestone,
  onEdit,
  onEditMilestone,
  onDeleteMilestone
}: ProjectBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [originalDates, setOriginalDates] = useState({ start: '', end: '' });
  const [showMenu, setShowMenu] = useState(false);

  const { left, width } = getBarDimensions(
    project.startDate,
    project.endDate,
    timelineStart,
    dayWidth
  );

  const handleMouseDown = useCallback((e: React.MouseEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    setDragMode(mode);
    setDragStartX(e.clientX);
    setOriginalDates({ start: project.startDate, end: project.endDate });
  }, [project.startDate, project.endDate]);

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

  return (
    <div
      ref={barRef}
      className={`${styles.projectBar} ${dragMode ? styles.dragging : ''}`}
      style={{
        left,
        width,
        backgroundColor: project.statusColor || '#6366f1'
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowMenu(true);
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

      {/* Draggable area */}
      <div
        className={styles.dragArea}
        onMouseDown={(e) => handleMouseDown(e, 'move')}
        onDoubleClick={onEdit}
      >
        <div className={styles.projectContent}>
          <span className={styles.projectTitle}>{project.title}</span>
          <span className={styles.projectDates}>
            {formatShortDate(project.startDate)} - {formatShortDate(project.endDate)}
          </span>
        </div>

        {/* Milestones as lines within the project bar */}
        <div className={styles.milestonesContainer}>
          {(project.milestones || []).map((milestone) => (
            <MilestoneLine
              key={milestone.id}
              milestone={milestone}
              timelineStart={timelineStart}
              dayWidth={dayWidth}
              projectLeft={left}
              projectWidth={width}
              onEdit={() => onEditMilestone(milestone.id)}
              onDelete={() => onDeleteMilestone(milestone.id)}
            />
          ))}
        </div>
      </div>

      {/* Context menu */}
      {showMenu && (
        <div className={styles.contextMenu} onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit}>Edit Project</button>
          <button onClick={onAddMilestone}>Add Milestone</button>
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}
