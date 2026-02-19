import { useMemo } from 'react';
import type { LeaveBlock as LeaveBlockType } from '../types';
import { differenceInDays } from 'date-fns';
import { parseLocalDate } from '../utils/dateUtils';
import styles from './LeaveBlock.module.css';

interface LeaveBlockProps {
  leave: LeaveBlockType;
  timelineStart: Date;
  dayWidth: number;
  laneHeight: number;
  isLocked?: boolean;
  onEdit?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
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
  onContextMenu
}: LeaveBlockProps) {
  const { left, width, height, top } = useMemo(() => {
    const startDate = parseLocalDate(leave.startDate);
    const endDate = parseLocalDate(leave.endDate);
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
    onContextMenu?.(e);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (isLocked) return;
    e.stopPropagation();
    onEdit?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isLocked) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onEdit?.();
    }
  };

  const tooltipText = leave.label
    ? `${leave.label} (${leave.startDate} to ${leave.endDate})`
    : `Annual Leave (${leave.startDate} to ${leave.endDate})`;

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
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      role="button"
      aria-label={tooltipText}
      tabIndex={isLocked ? -1 : 0}
      data-leave-block
    >
      <span className={styles.tooltip}>{tooltipText}</span>
    </div>
  );
}
