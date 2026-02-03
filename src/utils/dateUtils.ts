import {
  parseISO,
  differenceInDays,
  addDays,
  format,
  startOfDay,
  isAfter,
  isBefore
} from 'date-fns';

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
  const d = typeof date === 'string' ? parseISO(date) : date;
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
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'dd MMM yyyy');
}

export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, 'dd MMM');
}

export function isDatePast(date: Date | string): boolean {
  const d = typeof date === 'string' ? parseISO(date) : date;
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
  const start = parseISO(startDate);
  const end = parseISO(endDate);
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
