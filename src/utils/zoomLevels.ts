/**
 * The three scales the time axis is drawn at. Zoom itself is continuous (a
 * pinch lands anywhere), so a level is a band of day widths: the timeline
 * picks its header rows from it and the toolbar says which one is showing.
 */
export type ZoomLevel = 'year' | 'month' | 'week';

const YEAR_VIEW_THRESHOLD = 1.5;
const WEEK_VIEW_THRESHOLD = 5;

export function zoomLevelOf(dayWidth: number): ZoomLevel {
  if (dayWidth <= YEAR_VIEW_THRESHOLD) return 'year';
  if (dayWidth >= WEEK_VIEW_THRESHOLD) return 'week';
  return 'month';
}

/** Day width (px) the toolbar jumps to for each level. */
export const ZOOM_LEVEL_WIDTH: Record<ZoomLevel, number> = { year: 0.8, month: 3, week: 8 };
