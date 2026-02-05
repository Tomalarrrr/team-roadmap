import { useMemo } from 'react';
import type { LeaveBlock as LeaveBlockType } from '../types';
import { differenceInDays } from 'date-fns';
import styles from './LeaveBlock.module.css';

interface LeaveBlockProps {
  leave: LeaveBlockType;
  timelineStart: Date;
  dayWidth: number;
  laneHeight: number;
  isLocked?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

// Purple color scheme for annual leave
const LEAVE_COLORS = { bg: '#f3e8ff', dot: '#a855f7' };

export function LeaveBlock({
  leave,
  timelineStart,
  dayWidth,
  laneHeight,
  isLocked = false,
  onEdit,
  onDelete
}: LeaveBlockProps) {
  const { left, width, height, top } = useMemo(() => {
    const startDate = new Date(leave.startDate);
    const endDate = new Date(leave.endDate);
    const daysFromStart = differenceInDays(startDate, timelineStart);
    const duration = differenceInDays(endDate, startDate) + 1;

    // Always use full height
    const blockHeight = laneHeight - 8; // 8px padding
    const blockTop = 4;

    return {
      left: daysFromStart * dayWidth,
      width: duration * dayWidth,
      height: blockHeight,
      top: blockTop
    };
  }, [leave, timelineStart, dayWidth, laneHeight]);

  // Dotted pattern using radial gradient
  const dotPattern = `radial-gradient(circle, ${LEAVE_COLORS.dot} 1px, transparent 1px)`;

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isLocked) return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isLocked) return;
    e.stopPropagation();
    onEdit?.();
  };

  const handleDelete = (e: React.MouseEvent) => {
    if (isLocked) return;
    e.stopPropagation();
    onDelete?.();
  };

  return (
    <div
      className={styles.leaveBlock}
      style={{
        left,
        width,
        height,
        top,
        backgroundColor: LEAVE_COLORS.bg,
        backgroundImage: dotPattern,
        backgroundSize: '6px 6px'
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      title="Annual Leave"
    >
      {!isLocked && (
        <button
          className={styles.deleteBtn}
          onClick={handleDelete}
          title="Delete"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}
