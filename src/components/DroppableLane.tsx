import { useDroppable } from '@dnd-kit/core';
import { type ReactNode, useState, useCallback, useRef } from 'react';
import styles from './Timeline.module.css';

interface DroppableLaneProps {
  id: string;
  memberName: string;
  top: number;
  height: number;
  children: ReactNode;
  onContextMenu?: (e: React.MouseEvent) => void;
  onHoverChange?: (isHovered: boolean) => void;
  // Drag to create props
  timelineStart?: Date;
  dayWidth?: number;
  isLocked?: boolean;
  isCollapsed?: boolean; // When true, hide lane content
  onDragCreate?: (startDate: string, endDate: string) => void;
}

export function DroppableLane({
  id,
  memberName,
  top,
  height,
  children,
  onContextMenu,
  onHoverChange,
  timelineStart,
  dayWidth,
  isLocked,
  isCollapsed = false,
  onDragCreate
}: DroppableLaneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: 'lane',
      memberName
    }
  });

  // Drag to create state
  const [isDragging, setIsDragging] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ left: number; width: number } | null>(null);
  const dragStartRef = useRef<{ x: number; date: Date } | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);

  // Calculate date from X position
  const xToDate = useCallback((x: number): Date => {
    if (!timelineStart || !dayWidth) return new Date();
    const days = Math.floor(x / dayWidth);
    const date = new Date(timelineStart);
    date.setDate(date.getDate() + days);
    return date;
  }, [timelineStart, dayWidth]);

  // Format date to ISO string
  const toISODateString = (date: Date): string => {
    return date.toISOString().split('T')[0];
  };

  // Handle mouse down - Shift+click to start drag-to-create
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Prevent text selection during drag
    if (isDragging) {
      e.preventDefault();
      return;
    }

    // Only start drag-to-create if:
    // - Shift key is held
    // - Left mouse button
    // - Not locked
    // - Feature is enabled (has required props)
    // - Clicked on the lane itself (not on a child element like a project)
    if (!e.shiftKey || e.button !== 0) return;
    if (isLocked || !timelineStart || !dayWidth || !onDragCreate) return;

    // Check if click target is the lane itself
    const target = e.target as HTMLElement;
    const lane = laneRef.current;
    if (!lane || target !== lane) return;

    e.preventDefault();

    const rect = lane.getBoundingClientRect();
    const x = e.clientX - rect.left + lane.scrollLeft;
    const date = xToDate(x);

    dragStartRef.current = { x, date };
    setIsDragging(true);
    setDragPreview({ left: x, width: 0 });
  }, [isDragging, isLocked, timelineStart, dayWidth, onDragCreate, xToDate]);

  // Handle mouse move during drag
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current || !laneRef.current) return;

    const rect = laneRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left + laneRef.current.scrollLeft;
    const startX = dragStartRef.current.x;

    // Calculate preview bounds
    const left = Math.min(startX, currentX);
    const width = Math.max(Math.abs(currentX - startX), dayWidth || 20); // Minimum width of 1 day

    setDragPreview({ left, width });
  }, [isDragging, dayWidth]);

  // Handle mouse up to complete drag-to-create (any button releases it)
  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (!isDragging || !dragStartRef.current || !laneRef.current || !onDragCreate || !dayWidth) {
      setIsDragging(false);
      setDragPreview(null);
      dragStartRef.current = null;
      return;
    }

    e.preventDefault();

    const rect = laneRef.current.getBoundingClientRect();
    const endX = e.clientX - rect.left + laneRef.current.scrollLeft;
    const startX = dragStartRef.current.x;

    // Calculate dates
    const startDate = xToDate(Math.min(startX, endX));
    const endDate = xToDate(Math.max(startX, endX));

    // Ensure minimum duration of 1 week
    const minEndDate = new Date(startDate);
    minEndDate.setDate(minEndDate.getDate() + 6);
    const finalEndDate = endDate > minEndDate ? endDate : minEndDate;

    // Cleanup
    setIsDragging(false);
    setDragPreview(null);
    dragStartRef.current = null;

    // Trigger create callback
    onDragCreate(toISODateString(startDate), toISODateString(finalEndDate));
  }, [isDragging, onDragCreate, dayWidth, xToDate]);

  // Handle mouse leave - cancel drag
  const handleMouseLeave = useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      setDragPreview(null);
      dragStartRef.current = null;
    }
    onHoverChange?.(false);
  }, [isDragging, onHoverChange]);

  // Handle double-click to quick-create project at that date
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (isLocked || !timelineStart || !dayWidth || !onDragCreate) return;

    // Check if click target is the lane itself (not a project)
    const target = e.target as HTMLElement;
    const lane = laneRef.current;
    if (!lane || target !== lane) return;

    e.preventDefault();

    const rect = lane.getBoundingClientRect();
    const x = e.clientX - rect.left + lane.scrollLeft;
    const startDate = xToDate(x);

    // Default to 2 weeks duration
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 13);

    onDragCreate(toISODateString(startDate), toISODateString(endDate));
  }, [isLocked, timelineStart, dayWidth, onDragCreate, xToDate]);

  // Combine refs
  const setRefs = useCallback((node: HTMLDivElement | null) => {
    setNodeRef(node);
    laneRef.current = node;
  }, [setNodeRef]);

  return (
    <div
      ref={setRefs}
      className={`${styles.lane} ${isOver ? styles.laneOver : ''} ${isDragging ? styles.laneDragging : ''} ${isCollapsed ? styles.laneCollapsed : ''}`}
      style={{ top, height }}
      data-member={memberName}
      onContextMenu={isCollapsed ? undefined : onContextMenu}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={handleMouseLeave}
      onMouseDown={isCollapsed ? undefined : handleMouseDown}
      onMouseMove={isCollapsed ? undefined : handleMouseMove}
      onMouseUp={isCollapsed ? undefined : handleMouseUp}
      onDoubleClick={isCollapsed ? undefined : handleDoubleClick}
    >
      {!isCollapsed && children}

      {/* Drag-to-create preview */}
      {!isCollapsed && isDragging && dragPreview && (
        <div
          className={styles.dragCreatePreview}
          style={{
            left: dragPreview.left,
            width: Math.max(dragPreview.width, dayWidth || 20)
          }}
        />
      )}
    </div>
  );
}
