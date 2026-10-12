import type { PeriodMarkerColor } from '../types';

// Background and dot colors for the pattern (matching LeaveBlock style)
export const MARKER_COLORS: Record<PeriodMarkerColor, { bg: string; dot: string }> = {
  grey:   { bg: '#eef0f2', dot: '#697883' },
  yellow: { bg: '#fdf3d7', dot: '#986F00' },
  orange: { bg: '#ffedd5', dot: '#e67635' },
  red:    { bg: '#fce4e8', dot: '#B5444A' },
  green:  { bg: '#e0f2e0', dot: '#457028' }
};
