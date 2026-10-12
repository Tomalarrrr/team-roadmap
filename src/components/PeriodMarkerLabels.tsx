import type { PeriodMarker } from '../types';
import { getBarDimensions } from '../utils/dateUtils';
import { MARKER_COLORS } from '../utils/periodMarkerColors';
import styles from './PeriodMarker.module.css';

interface PeriodMarkerLabelsProps {
  markers: PeriodMarker[];
  timelineStart: Date;
  dayWidth: number;
  isLocked: boolean;
  onContextMenu: (e: React.MouseEvent, marker: PeriodMarker) => void;
}

export function PeriodMarkerLabels({
  markers,
  timelineStart,
  dayWidth,
  isLocked,
  onContextMenu
}: PeriodMarkerLabelsProps) {
  // Left to right, so where two chips overlap the later one covers only the tail
  // of the earlier one and both keep a visible part to hover.
  const chips = markers
    .filter(m => m.label)
    .map(marker => ({
      marker,
      left: getBarDimensions(marker.startDate, marker.endDate, timelineStart, dayWidth).left
    }))
    .sort((a, b) => a.left - b.left);

  return (
    <>
      {chips.map(({ marker, left }) => (
        <span
          key={marker.id}
          className={styles.label}
          style={{ left }}
          onContextMenu={(e) => {
            if (isLocked) return;
            e.preventDefault();
            e.stopPropagation();
            onContextMenu(e, marker);
          }}
        >
          <span className={styles.labelDot} style={{ backgroundColor: MARKER_COLORS[marker.color].dot }} />
          <span className={styles.labelText}>{marker.label}</span>
        </span>
      ))}
    </>
  );
}
