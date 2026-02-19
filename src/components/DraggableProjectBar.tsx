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
  stackTopOffset?: number; // Calculated top position within the lane
  laneTop?: number; // Absolute top position of the lane for dependency positioning
  isSelected?: boolean;
  newMilestoneIds?: Set<string>; // IDs of newly created milestones (for entrance animation)
  isLocked?: boolean; // When true, disable drag and edit actions
  isFullscreen?: boolean; // When true, hide milestones for clean view
  onUpdate: (updates: Partial<Project>) => Promise<void>;
  onDelete: () => void;
  onAddMilestone: () => void;
  onEdit: () => void;
  onEditMilestone: (milestoneId: string) => void;
  onUpdateMilestone: (milestoneId: string, updates: Partial<import('../types').Milestone>) => Promise<void>;
  onDeleteMilestone: (milestoneId: string) => void;
  onCopy?: () => void;
  onSelect?: () => void;
  onSelectMilestone?: (milestoneId: string) => void;
  onEdgeDrag?: (mouseX: number, isDragging: boolean) => void;
  onHoverChange?: (hovered: boolean, milestoneId?: string) => void; // For dependency highlighting
}

function DraggableProjectBarComponent({
  project,
  timelineStart,
  dayWidth,
  stackIndex = 0,
  stackTopOffset,
  laneTop = 0,
  isSelected,
  newMilestoneIds,
  isLocked = false,
  isFullscreen = false,
  onUpdate,
  onDelete,
  onAddMilestone,
  onEdit,
  onEditMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onCopy,
  onSelect,
  onSelectMilestone,
  onEdgeDrag,
  onHoverChange
}: DraggableProjectBarProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `project-${project.id}`,
    data: {
      type: 'project',
      project
    },
    disabled: isLocked
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
        stackTopOffset={stackTopOffset}
        laneTop={laneTop}
        isDragging={isDragging}
        isSelected={isSelected}
        newMilestoneIds={newMilestoneIds}
        isLocked={isLocked}
        isFullscreen={isFullscreen}
        dragListeners={listeners}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onAddMilestone={onAddMilestone}
        onEdit={onEdit}
        onEditMilestone={onEditMilestone}
        onUpdateMilestone={onUpdateMilestone}
        onDeleteMilestone={onDeleteMilestone}
        onCopy={onCopy}
        onSelect={onSelect}
        onSelectMilestone={onSelectMilestone}
        onEdgeDrag={onEdgeDrag}
        onHoverChange={onHoverChange}
      />
    </div>
  );
}

// Memoize to prevent unnecessary re-renders during filtering/scrolling
// Only re-render if project data, position, selection, or lock state changes
export const DraggableProjectBar = memo(DraggableProjectBarComponent, (prevProps, nextProps) => {
  return (
    prevProps.project === nextProps.project &&
    prevProps.timelineStart.getTime() === nextProps.timelineStart.getTime() &&
    prevProps.dayWidth === nextProps.dayWidth &&
    prevProps.stackIndex === nextProps.stackIndex &&
    prevProps.stackTopOffset === nextProps.stackTopOffset &&
    prevProps.laneTop === nextProps.laneTop &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.isLocked === nextProps.isLocked &&
    prevProps.isFullscreen === nextProps.isFullscreen
    // Note: Callback props are excluded from comparison as they're typically stable
  );
});
