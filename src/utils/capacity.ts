import { parseISO, addDays, differenceInDays, format } from 'date-fns';

/**
 * Capacity model.
 *
 * Each team member has a fixed capacity of CAPACITY "slots". A project consumes
 * slots according to its size. Capacity is a *point-in-time* constraint: at any
 * moment on the timeline, the slots of the projects that overlap there must sum
 * to no more than CAPACITY. A member can hold many projects over a year as long
 * as no single instant exceeds CAPACITY.
 *
 * This module is intentionally decoupled from the app's `Project` type — it
 * works on the minimal `CapacityItem` shape so it can't collide with concurrent
 * edits to the shared model files.
 */

export type ProjectSize = 'large' | 'medium' | 'small';

export const CAPACITY = 4;

export const SIZE_SLOTS: Record<ProjectSize, number> = {
  large: 2,
  medium: 1.5,
  small: 1,
};

/**
 * Default size for projects with no explicit size yet (e.g. historic projects
 * that predate the size field). Treated as a Small (1 slot) starting point so an
 * unsized backlog doesn't silently consume 1.5 slots each and block legitimate
 * work — bump individual projects up once they're properly sized.
 */
export const DEFAULT_SIZE: ProjectSize = 'small';

/** Days of recovery buffer added after a project ends before its slots free up. */
export const RECOVERY_BUFFER_DAYS = 7;

/**
 * Title of the always-on "Digital Queue" workstream. It's ongoing BAU rather
 * than a scheduled project, so it's exempt from the capacity model: it neither
 * consumes a member's slots nor counts toward the CAPACITY ceiling.
 */
export const DIGITAL_QUEUE_TITLE = 'Digital Queue';

/**
 * True if a project is exempt from capacity accounting (the Digital Queue).
 * Exempt projects are filtered out before any fit/peak-load check, so they never
 * push a member over CAPACITY and never reduce displayed free slots.
 *
 * Matched case-insensitively on EITHER the title or the owner: the queue is used
 * both ways in practice — as a project literally titled "Digital Queue", and as a
 * holding-bay lane whose *owner* is "Digital Queue" and which carries many
 * differently-titled projects waiting to start. Either form is exempt, so the
 * queue never caps how many projects can pile up in it.
 */
export function isCapacityExempt(project: { title?: string; owner?: string }): boolean {
  const queue = DIGITAL_QUEUE_TITLE.toLowerCase();
  const matches = (value?: string) => (value ?? '').trim().toLowerCase() === queue;
  return matches(project.title) || matches(project.owner);
}

export interface CapacityItem {
  id: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  startDate: string;
  /** Inclusive ISO date (YYYY-MM-DD). */
  endDate: string;
  size: ProjectSize;
}

export function slotsFor(size: ProjectSize): number {
  // Fall back to the default size for missing/unknown values so a malformed
  // record (e.g. one saved before the size field existed) can never poison a
  // capacity sum with NaN.
  return SIZE_SLOTS[size] ?? SIZE_SLOTS[DEFAULT_SIZE];
}

/** Pixels per capacity slot — the unit that ties pill height to slot cost.
 *  Small = 34, Medium = 51, Large = 68 (single-line pill content fits ≥34). */
export const UNIT_HEIGHT = 34;

export const SIZE_LABELS: Record<ProjectSize, string> = {
  large: 'Large',
  medium: 'Medium',
  small: 'Small',
};

/** Pill height in pixels for a size: height is literally its slot cost. */
export function heightForSize(size: ProjectSize): number {
  return slotsFor(size) * UNIT_HEIGHT;
}

/** Inclusive overlap test for two ISO date ranges. ISO strings sort lexically. */
function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

/** True if the item is active on the given ISO date (inclusive). */
function activeOn(item: CapacityItem, date: string): boolean {
  return item.startDate <= date && date <= item.endDate;
}

/**
 * Peak concurrent load contributed by `items` within the window [start, end].
 *
 * Load is piecewise-constant and only steps up at an item's start date, so it's
 * sufficient to evaluate at the window start plus each item start that falls
 * inside the window.
 */
export function peakLoadInRange(items: CapacityItem[], start: string, end: string): number {
  const sample = (date: string): number =>
    items.reduce((sum, it) => (activeOn(it, date) ? sum + slotsFor(it.size) : sum), 0);

  let peak = sample(start);
  for (const it of items) {
    if (it.startDate >= start && it.startDate <= end) {
      const load = sample(it.startDate);
      if (load > peak) peak = load;
    }
  }
  return peak;
}

/** Peak load contributed by items that actually overlap [start, end]. */
function peakOverlappingLoad(items: CapacityItem[], start: string, end: string): number {
  const overlapping = items.filter(it => rangesOverlap(it.startDate, it.endDate, start, end));
  return peakLoadInRange(overlapping, start, end);
}

export interface FitResult {
  fits: boolean;
  /** Highest concurrent load over the candidate's range if it were added. */
  peakLoad: number;
  /** Slots still free at the busiest point in the candidate's range. */
  freeSlots: number;
}

/**
 * Can `candidate` be added to `existing` (the owner's other projects) without
 * any instant in the candidate's range exceeding CAPACITY?
 *
 * `existing` should NOT include the candidate itself (filter by id upstream when
 * checking a move/resize of an already-placed project).
 *
 * When `asOf` (an ISO date, typically today) is given, capacity is only checked
 * from that date forward: a clash that sits entirely in the past can't be acted
 * on, so it must never block an edit. The candidate's window is clamped to start
 * no earlier than `asOf`, which also drops any item that ended before `asOf` out
 * of the overlap.
 */
export function checkFit(existing: CapacityItem[], candidate: CapacityItem, asOf?: string): FitResult {
  const windowStart = asOf && asOf > candidate.startDate ? asOf : candidate.startDate;
  const existingPeak = peakOverlappingLoad(existing, windowStart, candidate.endDate);
  const peakLoad = existingPeak + slotsFor(candidate.size);
  return {
    fits: peakLoad <= CAPACITY,
    peakLoad,
    freeSlots: CAPACITY - existingPeak,
  };
}

export interface MemberSuggestion {
  owner: string;
  /** The owner's currently free slots over the candidate's date range. */
  freeSlots: number;
}

/**
 * Among other owners, which can absorb `candidate` over its date range?
 * `freeSlots` is each owner's current spare capacity in that window. Sorted by
 * most free capacity first.
 */
export function suggestMembers(
  projectsByOwner: Record<string, CapacityItem[]>,
  candidate: CapacityItem,
  excludeOwner: string,
  asOf?: string,
): MemberSuggestion[] {
  const suggestions: MemberSuggestion[] = [];
  for (const owner of Object.keys(projectsByOwner)) {
    if (owner === excludeOwner) continue;
    const others = projectsByOwner[owner].filter(p => p.id !== candidate.id);
    const result = checkFit(others, candidate, asOf);
    if (result.fits) {
      suggestions.push({ owner, freeSlots: result.freeSlots });
    }
  }
  return suggestions.sort((a, b) => b.freeSlots - a.freeSlots);
}

/**
 * Earliest date the intended owner could start `candidate` (keeping its
 * duration) without exceeding capacity.
 *
 * Candidate start dates are the requested start plus, for each blocking project,
 * one week after it ends — the point its slots are considered recovered. Returns
 * the earliest candidate start whose shifted window fits, or null if none found
 * within the considered horizon.
 */
export function earliestAvailableDate(
  existing: CapacityItem[],
  candidate: CapacityItem,
  asOf?: string,
): string | null {
  const others = existing.filter(p => p.id !== candidate.id);
  const spanDays = differenceInDays(parseISO(candidate.endDate), parseISO(candidate.startDate));

  // Build sorted, de-duplicated candidate start dates.
  const starts = new Set<string>([candidate.startDate]);
  for (const p of others) {
    const freedFrom = format(addDays(parseISO(p.endDate), RECOVERY_BUFFER_DAYS + 1), 'yyyy-MM-dd');
    if (freedFrom > candidate.startDate) starts.add(freedFrom);
  }

  const sortedStarts = [...starts].sort();
  for (const start of sortedStarts) {
    const end = format(addDays(parseISO(start), spanDays), 'yyyy-MM-dd');
    if (checkFit(others, { ...candidate, startDate: start, endDate: end }, asOf).fits) {
      return start;
    }
  }
  return null;
}

export interface CapacityVerdict {
  fits: boolean;
  peakLoad: number;
  /** Owners who could take it instead (only populated when it doesn't fit). */
  alternativeOwners: MemberSuggestion[];
  /** Earliest date the intended owner frees up (only when it doesn't fit). */
  availableFrom: string | null;
}

/**
 * Full assignment verdict for the UI: does it fit, and if not, who else can take
 * it and from when can the intended owner.
 */
export function evaluateAssignment(
  projectsByOwner: Record<string, CapacityItem[]>,
  candidate: CapacityItem,
  intendedOwner: string,
  asOf?: string,
): CapacityVerdict {
  const ownerProjects = (projectsByOwner[intendedOwner] ?? []).filter(p => p.id !== candidate.id);
  const result = checkFit(ownerProjects, candidate, asOf);

  if (result.fits) {
    return { fits: true, peakLoad: result.peakLoad, alternativeOwners: [], availableFrom: null };
  }

  return {
    fits: false,
    peakLoad: result.peakLoad,
    alternativeOwners: suggestMembers(projectsByOwner, candidate, intendedOwner, asOf),
    availableFrom: earliestAvailableDate(ownerProjects, candidate, asOf),
  };
}

/**
 * Human-readable explanation of a blocked assignment, for the form and toasts.
 * Returns null when it fits (nothing to say).
 */
export function formatCapacityMessage(
  verdict: CapacityVerdict,
  ownerName: string,
  size: ProjectSize,
): string | null {
  if (verdict.fits) return null;

  const need = slotsFor(size);
  const lines = [
    `${ownerName} can't take this ${SIZE_LABELS[size]} project (${need} slot${need === 1 ? '' : 's'}): it would push their load to ${verdict.peakLoad} of ${CAPACITY} during these dates.`,
  ];

  if (verdict.alternativeOwners.length > 0) {
    const who = verdict.alternativeOwners
      .slice(0, 3)
      .map(o => `${o.owner} (${o.freeSlots} free)`)
      .join(', ');
    lines.push(`Who could take it now: ${who}.`);
  } else {
    lines.push('No one else has capacity in this window.');
  }

  if (verdict.availableFrom) {
    lines.push(`${ownerName} frees up on ${verdict.availableFrom}.`);
  }

  return lines.join(' ');
}

export interface SupportSegment {
  /** Inclusive ISO start of the segment. */
  startDate: string;
  /** Inclusive ISO end of the segment. */
  endDate: string;
  /** Free slots (CAPACITY - load) across this segment. */
  freeSlots: number;
}

/**
 * Break an owner's timeline into maximal segments of constant load and report
 * the free capacity (CAPACITY - load) in each.
 *
 * Pure helper retained for capacity analysis and tests; it no longer drives any
 * UI (the "Team Support / Development" filler band was removed). Bounded to
 * [windowStart, windowEnd] so callers can scope it to the visible timeline.
 */
export function supportSegments(
  items: CapacityItem[],
  windowStart: string,
  windowEnd: string,
): SupportSegment[] {
  if (items.length === 0) {
    return [{ startDate: windowStart, endDate: windowEnd, freeSlots: CAPACITY }];
  }

  // Collect boundary dates: window edges, each start, and the day after each end.
  const boundaries = new Set<string>([windowStart]);
  for (const it of items) {
    if (it.startDate > windowStart && it.startDate <= windowEnd) boundaries.add(it.startDate);
    const dayAfterEnd = format(addDays(parseISO(it.endDate), 1), 'yyyy-MM-dd');
    if (dayAfterEnd > windowStart && dayAfterEnd <= windowEnd) boundaries.add(dayAfterEnd);
  }

  const points = [...boundaries].sort();
  const segments: SupportSegment[] = [];

  for (let i = 0; i < points.length; i++) {
    const segStart = points[i];
    const nextPoint = points[i + 1];
    const segEnd = nextPoint
      ? format(addDays(parseISO(nextPoint), -1), 'yyyy-MM-dd')
      : windowEnd;
    if (segStart > segEnd) continue;

    const load = items.reduce(
      (sum, it) => (activeOn(it, segStart) ? sum + slotsFor(it.size) : sum),
      0,
    );
    const freeSlots = CAPACITY - load;

    // Merge with previous segment if free capacity is unchanged.
    const prev = segments[segments.length - 1];
    if (prev && prev.freeSlots === freeSlots) {
      prev.endDate = segEnd;
    } else {
      segments.push({ startDate: segStart, endDate: segEnd, freeSlots });
    }
  }

  return segments;
}
