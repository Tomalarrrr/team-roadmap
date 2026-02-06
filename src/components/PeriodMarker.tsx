import { useMemo } from 'react';
import type { PeriodMarker as PeriodMarkerType, PeriodMarkerColor } from '../types';
import { differenceInDays } from 'date-fns';
import styles from './PeriodMarker.module.css';

interface PeriodMarkerProps {
  marker: PeriodMarkerType;
  timelineStart: Date;
  dayWidth: number;
  totalHeight: number;
  isLocked?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
}

// Background and dot colors for the pattern (matching LeaveBlock style)
const MARKER_COLORS: Record<PeriodMarkerColor, { bg: string; dot: string }> = {
  grey: { bg: '#f3f4f6', dot: '#9ca3af' },
  yellow: { bg: '#fef3c7', dot: '#f59e0b' },
  orange: { bg: '#ffedd5', dot: '#f97316' },
  red: { bg: '#fee2e2', dot: '#ef4444' },
  green: { bg: '#dcfce7', dot: '#22c55e' }
};

export function PeriodMarker({
  marker,
  timelineStart,
  dayWidth,
  totalHeight,
  isLocked = false,
  onContextMenu
}: PeriodMarkerProps) {
  const { left, width } = useMemo(() => {
    const startDate = new Date(marker.startDate);
    const endDate = new Date(marker.endDate);
    const daysFromStart = differenceInDays(startDate, timelineStart);
    const duration = differenceInDays(endDate, startDate) + 1;

    return {
      left: daysFromStart * dayWidth,
      width: duration * dayWidth
    };
  }, [marker, timelineStart, dayWidth]);

  const colors = MARKER_COLORS[marker.color];
  const dotPattern = `radial-gradient(circle, ${colors.dot} 1px, transparent 1px)`;

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isLocked) return;
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e);
  };

  const tooltipText = marker.label
    ? `${marker.label} (${marker.startDate} to ${marker.endDate})`
    : `${marker.startDate} to ${marker.endDate}`;

  return (
    <div
      className={styles.marker}
      style={{
        left,
        width,
        height: totalHeight,
        backgroundColor: colors.bg,
        backgroundImage: dotPattern,
        backgroundSize: '6px 6px'
      }}
      aria-label={marker.label || `${marker.color} period marker: ${marker.startDate} to ${marker.endDate}`}
    >
      {/* Hover zone for tooltip and right-click */}
      <div className={styles.hoverZone} onContextMenu={handleContextMenu} data-period-marker />
      <div className={styles.tooltip}>{tooltipText}</div>
      {marker.label && (
        <span className={styles.label} data-tooltip={tooltipText} onContextMenu={handleContextMenu}>{marker.label}</span>
      )}
    </div>
  );
}
