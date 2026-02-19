import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { PeriodMarker as PeriodMarkerType, PeriodMarkerColor } from '../types';
import { differenceInDays } from 'date-fns';
import { formatShortDate } from '../utils/dateUtils';
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
  grey:   { bg: '#eef0f2', dot: '#6E7D89' },
  yellow: { bg: '#fdf3d7', dot: '#A67A00' },
  orange: { bg: '#ffedd5', dot: '#e67635' },
  red:    { bg: '#fce4e8', dot: '#B5444A' },
  green:  { bg: '#e0f2e0', dot: '#457028' }
};

const TOOLTIP_DELAY_MS = 400;

function formatDuration(startDate: string, endDate: string): string {
  const days = differenceInDays(new Date(endDate), new Date(startDate)) + 1;
  if (days < 7) return `${days} day${days === 1 ? '' : 's'}`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks} week${weeks === 1 ? '' : 's'}`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? '' : 's'}`;
}

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

  // Tooltip state — rendered via portal to escape z-index stacking context
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTooltipAt = useCallback((e: React.MouseEvent) => {
    tooltipTimerRef.current = setTimeout(() => {
      // Position below the label area, left-aligned with hover point
      setTooltipPos({ x: e.clientX, y: e.clientY + 16 });
      setShowTooltip(true);
    }, TOOLTIP_DELAY_MS);
  }, []);

  const hideTooltip = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setShowTooltip(false);
    setTooltipPos(null);
  }, []);

  // Dismiss on scroll (position becomes stale)
  useEffect(() => {
    if (!showTooltip) return;
    const dismiss = () => hideTooltip();
    window.addEventListener('scroll', dismiss, { capture: true, passive: true });
    return () => window.removeEventListener('scroll', dismiss, { capture: true });
  }, [showTooltip, hideTooltip]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent) => {
    if (isLocked) return;
    e.preventDefault();
    e.stopPropagation();
    hideTooltip();
    onContextMenu?.(e);
  };

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
      <div
        className={styles.hoverZone}
        onContextMenu={handleContextMenu}
        onMouseEnter={showTooltipAt}
        onMouseLeave={hideTooltip}
        data-period-marker={marker.id}
      />

      {marker.label && (
        <span className={styles.label} onContextMenu={handleContextMenu}>{marker.label}</span>
      )}

      {/* Rich tooltip — portal to escape stacking context */}
      {showTooltip && tooltipPos && createPortal(
        <div
          className={styles.tooltip}
          style={{
            position: 'fixed',
            left: tooltipPos.x,
            top: tooltipPos.y
          }}
          role="tooltip"
        >
          <div className={styles.tooltipLabel}>
            <span className={styles.tooltipDot} style={{ backgroundColor: colors.dot }} />
            {marker.label || 'Period Marker'}
          </div>
          <div className={styles.tooltipDates}>
            {formatShortDate(marker.startDate)} {'\u2013'} {formatShortDate(marker.endDate)}
            {' \u00B7 '}{formatDuration(marker.startDate, marker.endDate)}
          </div>
          {!isLocked && (
            <div className={styles.tooltipHint}>Right-click for options</div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
