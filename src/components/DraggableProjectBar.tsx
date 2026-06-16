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
  isOverAllocated?: boolean; // True for the pill that tips its owner past capacity
  isLocked?: boolean; // When true, disable drag and edit actions
  onUpdate: (updates: Partial<Project>) => Promise<void>;
  onDelete: () => void;
  onEdit: () => void;
  onCopy?: () => void;
  onSelect?: () => void;
  onEdgeDrag?: (mouseX: number, isDragging: boolean) => void;
  onHoverChange?: (hovered: boolean) => void; // For dependency highlighting
}

function DraggableProjectBarComponent({
  project,
  timelineStart,
  dayWidth,
  stackIndex = 0,
  stackTopOffset,
  laneTop = 0,
  isSelected,
  isOverAllocated = false,
  isLocked = false,
  onUpdate,
  onDelete,
  onEdit,
  onCopy,
  onSelect,
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
        isOverAllocated={isOverAllocated}
        isLocked={isLocked}
        dragListeners={listeners}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onEdit={onEdit}
        onCopy={onCopy}
        onSelect={onSelect}
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
    prevProps.isOverAllocated === nextProps.isOverAllocated &&
    prevProps.isLocked === nextProps.isLocked
    // Note: Callback props are excluded from comparison as they're typically stable
  );
});
