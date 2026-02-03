import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import type { Project, Milestone } from '../types';
import { MilestoneLine } from './MilestoneLine';
import {
  getBarDimensions,
  toISODateString,
  formatShortDate
} from '../utils/dateUtils';
import { parseISO, areIntervalsOverlapping } from 'date-fns';
import styles from './ProjectBar.module.css';

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
  onUpdate: (updates: Partial<Project>) => void;
  onDelete: () => void;
  onAddMilestone: () => void;
  onEdit: () => void;
  onEditMilestone: (milestoneId: string) => void;
  onUpdateMilestone: (milestoneId: string, updates: Partial<import('../types').Milestone>) => void;
  onDeleteMilestone: (milestoneId: string) => void;
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
  onUpdate,
  onDelete,
  onAddMilestone,
  onEdit,
  onEditMilestone,
  onUpdateMilestone,
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

  return (
    <div
      ref={barRef}
      className={`${styles.projectBar} ${dragMode ? styles.dragging : ''}`}
      style={{
        left,
        width,
        top: topPosition,
        height: projectBarHeight,
        backgroundColor: project.statusColor || '#1e3a5f'
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
        onDoubleClick={onAddMilestone}
      >
        <div className={styles.projectContent}>
          <span className={styles.projectTitle}>{project.title}</span>
          <span className={styles.projectSeparator}>•</span>
          <span className={styles.projectDates}>
            {formatShortDate(project.startDate)} - {formatShortDate(project.endDate)}
          </span>
        </div>

        {/* Milestones as lines within the project bar */}
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
