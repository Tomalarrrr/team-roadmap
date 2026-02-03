import {
  parseISO,
  differenceInDays,
  addDays,
  format,
  startOfDay,
  isAfter,
  isBefore
} from 'date-fns';

// Date parsing cache to avoid repeated parseISO calls
// Using Map instead of WeakMap since strings are primitives
const parsedDateCache = new Map<string, Date>();

// Cached parseISO with automatic cleanup to prevent memory leaks
function getCachedDate(dateStr: string): Date {
  let cached = parsedDateCache.get(dateStr);
  if (!cached) {
    cached = parseISO(dateStr);
    parsedDateCache.set(dateStr, cached);

    // Auto-cleanup: keep cache size under 1000 entries
    if (parsedDateCache.size > 1000) {
      // Remove oldest 200 entries
      const keysToDelete = Array.from(parsedDateCache.keys()).slice(0, 200);
      keysToDelete.forEach(key => parsedDateCache.delete(key));
    }
  }
  return cached;
}

// UK Financial Year: April 1 - March 31
// FY2025 = April 1, 2025 - March 31, 2026

export function getFYStart(fy: number): Date {
  return new Date(fy, 3, 1); // April 1 of the FY year
}

export function getFYEnd(fy: number): Date {
  return new Date(fy + 1, 2, 31); // March 31 of next year
}

export function getFYFromDate(date: Date): number {
  const month = date.getMonth();
  const year = date.getFullYear();
  // If Jan-March, we're in the previous FY
  if (month < 3) {
    return year - 1;
  }
  return year;
}

export function getVisibleFYs(startFY: number, count: number): number[] {
  return Array.from({ length: count }, (_, i) => startFY + i);
}

export function dateToTimelinePosition(
  date: Date | string,
  timelineStart: Date,
  dayWidth: number
): number {
  const d = typeof date === 'string' ? getCachedDate(date) : date;
  const days = differenceInDays(startOfDay(d), startOfDay(timelineStart));
  return days * dayWidth;
}

export function timelinePositionToDate(
  position: number,
  timelineStart: Date,
  dayWidth: number
): Date {
  const days = Math.round(position / dayWidth);
  return addDays(timelineStart, days);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? getCachedDate(date) : date;
  return format(d, 'dd MMM yyyy');
}

export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? getCachedDate(date) : date;
  return format(d, 'dd MMM');
}

export function isDatePast(date: Date | string): boolean {
  const d = typeof date === 'string' ? getCachedDate(date) : date;
  return isBefore(startOfDay(d), startOfDay(new Date()));
}

export function isMilestonePast(endDate: string): boolean {
  return isDatePast(endDate);
}

export function getTodayPosition(timelineStart: Date, dayWidth: number): number {
  return dateToTimelinePosition(new Date(), timelineStart, dayWidth);
}

export function getBarDimensions(
  startDate: string,
  endDate: string,
  timelineStart: Date,
  dayWidth: number
): { left: number; width: number } {
  const start = getCachedDate(startDate);
  const end = getCachedDate(endDate);
  const left = dateToTimelinePosition(start, timelineStart, dayWidth);
  const days = differenceInDays(end, start) + 1; // Include end date
  const width = Math.max(days * dayWidth, dayWidth); // Minimum 1 day width
  return { left, width };
}

export function clampDateToRange(
  date: Date,
  minDate: Date,
  maxDate: Date
): Date {
  if (isBefore(date, minDate)) return minDate;
  if (isAfter(date, maxDate)) return maxDate;
  return date;
}

export function toISODateString(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

// Find the optimal start date for a new project (flight path algorithm)
// Returns the earliest available date following any existing project
export function getSuggestedProjectDates(
  ownerProjects: { startDate: string; endDate: string }[],
  defaultDuration: number = 30 // Default project duration in days
): { suggestedStart: string; suggestedEnd: string; hasExisting: boolean } {
  const today = startOfDay(new Date());

  if (ownerProjects.length === 0) {
    // No existing projects, start today
    const suggestedStart = toISODateString(today);
    const suggestedEnd = toISODateString(addDays(today, defaultDuration));
    return { suggestedStart, suggestedEnd, hasExisting: false };
  }

  // Find the earliest ending project that ends after today
  // This gives the user the soonest available slot
  let earliestEndDate: Date | null = null;

  ownerProjects.forEach(proj => {
    const endDate = parseISO(proj.endDate);
    // Only consider projects that haven't ended yet
    if (!isBefore(endDate, today)) {
      if (!earliestEndDate || isBefore(endDate, earliestEndDate)) {
        earliestEndDate = endDate;
      }
    }
  });

  // If no future projects, start today
  if (!earliestEndDate) {
    const suggestedStart = toISODateString(today);
    const suggestedEnd = toISODateString(addDays(today, defaultDuration));
    return { suggestedStart, suggestedEnd, hasExisting: true };
  }

  // Start the day after the earliest ending project
  const suggestedStart = toISODateString(addDays(earliestEndDate, 1));
  const suggestedEnd = toISODateString(addDays(earliestEndDate, 1 + defaultDuration));

  return { suggestedStart, suggestedEnd, hasExisting: true };
}
