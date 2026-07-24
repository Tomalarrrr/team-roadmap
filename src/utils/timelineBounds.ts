import type { Project } from '../types';

/**
 * The roadmap's horizontal extent.
 *
 * ONE definition, shared by the Timeline component and the image exports. They
 * must agree exactly: the exports derive the per-day pixel width from the
 * rendered header's width divided by this range's total days, then measure every
 * crop offset from `start`. If the two computed different ranges, that per-day
 * width and all offsets would be taken against the wrong origin and the captured
 * window would land somewhere else entirely. Keeping a single function makes
 * that agreement structural instead of a comment asking the next person to keep
 * two copies in sync.
 *
 * Always measure over the UNFILTERED project list. Deriving the range from a
 * filtered subset moves the axis whenever a filter changes, which slides the
 * viewport off whatever the user was looking at.
 */

// Default window: FY2025–FY2030. Anything outside is absorbed by widening the
// range, so an out-of-range project never renders at a negative offset or past
// the right edge.
export const DEFAULT_MIN_YEAR = 2025;
export const DEFAULT_MAX_YEAR = 2030;

export interface TimelineBounds {
  start: Date;
  end: Date;
  minYear: number;
  maxYear: number;
}

export function getTimelineBounds(projects: Project[]): TimelineBounds {
  let minYear = DEFAULT_MIN_YEAR;
  let maxYear = DEFAULT_MAX_YEAR;

  // Dates are ISO "YYYY-MM-DD" — read the calendar year off the string rather
  // than constructing a Date, which would drift across timezones.
  const consider = (iso?: string) => {
    const year = iso ? parseInt(iso.slice(0, 4), 10) : NaN;
    if (Number.isNaN(year)) return;
    if (year < minYear) minYear = year;
    if (year > maxYear) maxYear = year;
  };

  projects.forEach(p => { consider(p.startDate); consider(p.endDate); });

  return {
    start: new Date(minYear, 0, 1),   // January 1
    end: new Date(maxYear, 11, 31),   // December 31
    minYear,
    maxYear,
  };
}
