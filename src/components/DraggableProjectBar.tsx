import { memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { Project } from '../types';
import { ProjectBar } from './ProjectBar';

interface DraggableProjectBarProps {
  project: Project;
  timelineStart: Date;
  dayWidth: number;
  stackIndex?: number;
  isSelected?: boolean;
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

function DraggableProjectBarComponent({
  project,
  timelineStart,
  dayWidth,
  stackIndex = 0,
  isSelected,
  onUpdate,
  onDelete,
  onAddMilestone,
  onEdit,
  onEditMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onCopy,
  onEdgeDrag
}: DraggableProjectBarProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `project-${project.id}`,
    data: {
      type: 'project',
      project
    }
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.8 : 1
    // z-index handled by CSS to prevent stacking context conflicts
  } as React.CSSProperties;

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <ProjectBar
        project={project}
        timelineStart={timelineStart}
        dayWidth={dayWidth}
        stackIndex={stackIndex}
        isDragging={isDragging}
        isSelected={isSelected}
        dragListeners={listeners}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onAddMilestone={onAddMilestone}
        onEdit={onEdit}
        onEditMilestone={onEditMilestone}
        onUpdateMilestone={onUpdateMilestone}
        onDeleteMilestone={onDeleteMilestone}
        onCopy={onCopy}
        onEdgeDrag={onEdgeDrag}
      />
    </div>
  );
}

// Memoize to prevent unnecessary re-renders during filtering/scrolling
// Only re-render if project data, position, or selection state changes
export const DraggableProjectBar = memo(DraggableProjectBarComponent, (prevProps, nextProps) => {
  return (
    prevProps.project === nextProps.project &&
    prevProps.timelineStart.getTime() === nextProps.timelineStart.getTime() &&
    prevProps.dayWidth === nextProps.dayWidth &&
    prevProps.stackIndex === nextProps.stackIndex &&
    prevProps.isSelected === nextProps.isSelected
    // Note: Callback props are excluded from comparison as they're typically stable
  );
});
