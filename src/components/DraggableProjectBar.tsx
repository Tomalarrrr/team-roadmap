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
  onUpdate: (updates: Partial<Project>) => void;
  onDelete: () => void;
  onAddMilestone: () => void;
  onEdit: () => void;
  onEditMilestone: (milestoneId: string) => void;
  onUpdateMilestone: (milestoneId: string, updates: Partial<import('../types').Milestone>) => void;
  onDeleteMilestone: (milestoneId: string) => void;
  onCopy?: () => void;
}

export function DraggableProjectBar({
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
  onCopy
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
    opacity: isDragging ? 0.8 : 1,
    zIndex: isDragging ? 1000 : undefined
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
      />
    </div>
  );
}
