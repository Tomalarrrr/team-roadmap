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

// Parse a YYYY-MM-DD string as local midnight.
// `new Date('2025-06-15')` is parsed as UTC midnight per ECMAScript spec,
// which becomes the PREVIOUS day in UTC- timezones. This helper ensures
// the Date represents midnight LOCAL time, so getDate/setDate arithmetic
// and toDateString() all stay in the same timezone.
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Timezone-safe YYYY-MM-DD string from a local Date.
// Unlike Date.toISOString().split('T')[0] which converts to UTC first
// (and can shift the date ±1 day), this uses local year/month/day.
export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

// Calculate stack indices for overlapping date-range items (milestones, projects)
// Optimized O(n log n) interval scheduling algorithm
export function calculateStacks<T extends { id: string; startDate: string; endDate: string }>(
  items: T[]
): Map<string, number> {
  const stacks = new Map<string, number>();
  if (!items || items.length === 0) return stacks;

  // Sort by start date (O(n log n))
  const sorted = [...items].sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  // Track the end time of the last item in each stack
  const stackEndTimes: number[] = [];

  sorted.forEach((item) => {
    const startTime = new Date(item.startDate).getTime();
    const endTime = new Date(item.endDate).getTime();

    // Find the first available stack (no overlap)
    let assignedStack = -1;
    for (let i = 0; i < stackEndTimes.length; i++) {
      if (stackEndTimes[i] < startTime) {
        assignedStack = i;
        stackEndTimes[i] = endTime;
        break;
      }
    }

    // No available stack — create a new one
    if (assignedStack === -1) {
      assignedStack = stackEndTimes.length;
      stackEndTimes.push(endTime);
    }

    stacks.set(item.id, assignedStack);
  });

  return stacks;
}
