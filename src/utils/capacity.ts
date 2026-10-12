import { parseISO, addDays, addWeeks, differenceInDays, format } from 'date-fns';

/**
 * Capacity model.
 *
 * A lane is CAPACITY "slots" tall, and that is what a team member has unless
 * their own `capacity` says fewer (part-time, or a role that is only partly
 * project work). A project consumes slots according to its size. Capacity is a
 * *point-in-time* constraint: at any moment on the timeline, the slots of the
 * projects that overlap there must sum to no more than the member's capacity. A
 * member can hold many projects over a year as long as no single instant exceeds it.
 *
 * This module is intentionally decoupled from the app's `Project` type — it
 * works on the minimal `CapacityItem` shape so it can't collide with concurrent
 * edits to the shared model files.
 */

export type ProjectSize = 'full-time' | 'large' | 'medium' | 'small';

export const CAPACITY = 4;

// Slot cost equals the size's "value": Small 1, Medium 2, Large 3, Full Time 4.
// Pixel heights follow the same scale but also absorb the inter-pill gaps (see
// heightForSize), so a Medium spans exactly two stacked Smalls, a Large three,
// and a Full Time all four — i.e. a Full Time alone fills a member's whole
// 4-slot capacity band.
export const SIZE_SLOTS: Record<ProjectSize, number> = {
  'full-time': 4,
  large: 3,
  medium: 2,
  small: 1,
};

/**
 * Default size for projects with no explicit size yet (e.g. historic projects
 * that predate the size field). Treated as a Small (1 slot) starting point so an
 * unsized backlog doesn't silently consume extra slots each and block legitimate
 * work — bump individual projects up once they're properly sized.
 */
export const DEFAULT_SIZE: ProjectSize = 'small';

/** Days of recovery buffer added after a project ends before its slots free up.
 *  The default; a board can set its own in its rules. */
export const RECOVERY_BUFFER_DAYS = 7;

/** Slots a member has for project work: their own figure, or the full lane. */
export function capacityOfMember(member: { capacity?: number }): number {
  return member.capacity ?? CAPACITY;
}

/** Look up capacity by owner name. An owner who is not a team member (the
 *  Digital Queue lane, a name typed before owners were a list) gets the full lane. */
export function capacityByOwner(teamMembers: { name: string; capacity?: number }[]): (owner: string) => number {
  const byName = new Map(teamMembers.map(m => [m.name, capacityOfMember(m)]));
  return owner => byName.get(owner) ?? CAPACITY;
}

/**
 * Title of the always-on "Digital Queue" workstream. It's ongoing BAU rather
 * than a scheduled project, so it's exempt from the capacity model: it neither
 * consumes a member's slots nor counts toward the CAPACITY ceiling.
 */
const DIGITAL_QUEUE_TITLE = 'Digital Queue';

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

/** Pixels of pill height contributed per capacity slot — the unit that ties pill
 *  height to slot cost. A Small (1 slot) is exactly UNIT_HEIGHT: just tall enough
 *  for its single label line with tight, symmetric breathing room. Larger sizes
 *  are slots * UNIT_HEIGHT PLUS the internal gaps a Smalls-stack would span (see
 *  heightForSize) — Small 28 / Medium 62 / Large 96 / Full Time 130. */
export const UNIT_HEIGHT = 28;

/** Vertical gap (px) between stacked pills. Kept here as the single source of
 *  truth so the timeline and dependency-arrow geometry can't drift apart. */
export const SLOT_GAP = 6;

/** Vertical distance (px) from one slot row to the next: one slot plus the gap.
 *  A pill placed at slot offset N has its top at LANE_PADDING + N * SLOT_PITCH.
 *  Pills are positioned on this shared grid so a tall project (e.g. Full Time)
 *  occupies the SAME vertical band as the short projects stacked beside it at a
 *  non-overlapping time, instead of being pushed onto its own row below them. */
export const SLOT_PITCH = UNIT_HEIGHT + SLOT_GAP;

export const SIZE_LABELS: Record<ProjectSize, string> = {
  'full-time': 'Full Time',
  large: 'Large',
  medium: 'Medium',
  small: 'Small',
};

/**
 * Pill height in pixels for a size. A pill must fill the SAME vertical band that
 * the equivalent stack of Smalls spans on the slot grid — i.e. its slot heights
 * PLUS the gaps that would sit between those Smalls. A naive `slots * UNIT_HEIGHT`
 * omits those internal gaps, leaving a multi-slot pill short by (slots-1)*SLOT_GAP:
 * a Full Time (112px) ended up 18px shorter than the four Smalls (130px) stacked
 * beside it. Including the gaps makes Medium = 2 Smalls, Large = 3 Smalls, and
 * Full Time = 4 Smalls (and the whole 4-slot capacityFrame) exactly.
 *
 * Equivalently: (slots - 1) * SLOT_PITCH + UNIT_HEIGHT.
 * Small 28 / Medium 62 / Large 96 / Full Time 130 px.
 */
export function heightForSize(size: ProjectSize): number {
  const slots = slotsFor(size);
  return slots * UNIT_HEIGHT + (slots - 1) * SLOT_GAP;
}

/**
 * Vertical centre (in lane-container pixels) of a project pill — the point a
 * dependency endpoint should anchor to.
 *
 * A pill's height scales with its slot cost (Small 28 / Medium 62 / Large 96 /
 * Full Time 130 px — see heightForSize), NOT a fixed value. Anchoring to a
 * constant half-height makes arrows attach off-centre: low on a Small pill
 * (effectively its bottom edge) and high on a Large/Full Time pill. The centre
 * must therefore be derived from each endpoint's own size. Unknown/missing sizes
 * fall back to Small via slotsFor, so this never produces NaN.
 */
export function projectAnchorY(
  size: ProjectSize | undefined,
  laneOffset: number,
  stackOffset: number,
): number {
  return laneOffset + stackOffset + heightForSize(size ?? DEFAULT_SIZE) / 2;
}

/**
 * Corners of a dependency line whose target starts to the left of where its
 * source ends. `from` is the source pill's end and `to` the target pill's start,
 * each at the pill's vertical centre. The line steps out past the source, runs
 * back through the gap beside the target (half a SLOT_GAP clear of it, on the
 * side facing the source, or beneath both pills when they share a row) and comes
 * in at the target's start.
 */
export function backwardDependencyCorners(
  from: { x: number; y: number; height: number },
  to: { x: number; y: number; height: number },
  gap: number,
): Array<{ x: number; y: number }> {
  const clear = SLOT_GAP / 2;
  const toHalf = to.height / 2;
  const sameRow = Math.abs(to.y - from.y) < toHalf + from.height / 2;
  const runY = sameRow
    ? Math.max(from.y + from.height / 2, to.y + toHalf) + clear
    : to.y + (from.y < to.y ? -1 : 1) * (toHalf + clear);
  return [
    { x: from.x + gap, y: from.y },
    { x: from.x + gap, y: runY },
    { x: to.x - gap, y: runY },
    { x: to.x - gap, y: to.y },
  ];
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
 * any instant in the candidate's range exceeding `capacity`?
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
export function checkFit(
  existing: CapacityItem[],
  candidate: CapacityItem,
  asOf?: string,
  capacity: number = CAPACITY,
): FitResult {
  const windowStart = asOf && asOf > candidate.startDate ? asOf : candidate.startDate;
  const existingPeak = peakOverlappingLoad(existing, windowStart, candidate.endDate);
  const peakLoad = existingPeak + slotsFor(candidate.size);
  return {
    fits: peakLoad <= capacity,
    peakLoad,
    freeSlots: capacity - existingPeak,
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
  capacityOf: (owner: string) => number = () => CAPACITY,
): MemberSuggestion[] {
  const suggestions: MemberSuggestion[] = [];
  for (const owner of Object.keys(projectsByOwner)) {
    if (owner === excludeOwner) continue;
    const others = projectsByOwner[owner].filter(p => p.id !== candidate.id);
    const result = checkFit(others, candidate, asOf, capacityOf(owner));
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
 * `recoveryDays` after it ends — the point its slots are considered recovered. Returns
 * the earliest candidate start whose shifted window fits, or null if none found
 * within the considered horizon.
 */
export function earliestAvailableDate(
  existing: CapacityItem[],
  candidate: CapacityItem,
  asOf?: string,
  capacity: number = CAPACITY,
  recoveryDays: number = RECOVERY_BUFFER_DAYS,
): string | null {
  const others = existing.filter(p => p.id !== candidate.id);
  const spanDays = differenceInDays(parseISO(candidate.endDate), parseISO(candidate.startDate));

  // Build sorted, de-duplicated candidate start dates.
  const starts = new Set<string>([candidate.startDate]);
  for (const p of others) {
    const freedFrom = format(addDays(parseISO(p.endDate), recoveryDays + 1), 'yyyy-MM-dd');
    if (freedFrom > candidate.startDate) starts.add(freedFrom);
  }

  const sortedStarts = [...starts].sort();
  for (const start of sortedStarts) {
    const end = format(addDays(parseISO(start), spanDays), 'yyyy-MM-dd');
    if (checkFit(others, { ...candidate, startDate: start, endDate: end }, asOf, capacity).fits) {
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
  capacityOf: (owner: string) => number = () => CAPACITY,
  recoveryDays: number = RECOVERY_BUFFER_DAYS,
): CapacityVerdict {
  const ownerProjects = (projectsByOwner[intendedOwner] ?? []).filter(p => p.id !== candidate.id);
  const capacity = capacityOf(intendedOwner);
  const result = checkFit(ownerProjects, candidate, asOf, capacity);

  if (result.fits) {
    return { fits: true, peakLoad: result.peakLoad, alternativeOwners: [], availableFrom: null };
  }

  return {
    fits: false,
    peakLoad: result.peakLoad,
    alternativeOwners: suggestMembers(projectsByOwner, candidate, intendedOwner, asOf, capacityOf),
    availableFrom: earliestAvailableDate(ownerProjects, candidate, asOf, capacity, recoveryDays),
  };
}

export interface SupportSegment {
  /** Inclusive ISO start of the segment. */
  startDate: string;
  /** Inclusive ISO end of the segment. */
  endDate: string;
  /** Free slots (capacity - load) across this segment; negative when over. */
  freeSlots: number;
}

/**
 * Break an owner's timeline into maximal segments of constant load and report
 * the free capacity (capacity - load) in each.
 *
 * Drives each lane's availability line. Bounded to
 * [windowStart, windowEnd] so callers can scope it to the period they show.
 */
export function supportSegments(
  items: CapacityItem[],
  windowStart: string,
  windowEnd: string,
  capacity: number = CAPACITY,
): SupportSegment[] {
  if (items.length === 0) {
    return [{ startDate: windowStart, endDate: windowEnd, freeSlots: capacity }];
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
    const freeSlots = capacity - load;

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

/**
 * First date an owner has at least `slots` free, read off their segments.
 *
 * Capacity that is free at the start of the window is free now. Capacity that
 * opens later only counts `recoveryDays` after the work in front of it ends,
 * the same recovery rule the project form applies, and only if the gap is
 * still open by then. Null when nothing that size opens in the window.
 */
export function nextFreeDate(segments: SupportSegment[], slots: number, recoveryDays: number): string | null {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.freeSlots < slots) continue;
    if (i === 0) return segment.startDate;
    const recovered = format(addDays(parseISO(segment.startDate), recoveryDays), 'yyyy-MM-dd');
    if (recovered <= segment.endDate) return recovered;
  }
  return null;
}

/** How far ahead a lane looks for its next free slot. */
export const AVAILABILITY_WEEKS = 26;

/**
 * The line under a person's name on the board: how many slots they have free
 * today, or failing that the date the next one opens. `items` is the work that
 * counts against them, so on-hold and exempt projects are filtered out upstream.
 */
export function availabilityLabel(items: CapacityItem[], today: string, capacity: number, recoveryDays: number): string {
  const windowEnd = format(addWeeks(parseISO(today), AVAILABILITY_WEEKS), 'yyyy-MM-dd');
  const segments = supportSegments(items, today, windowEnd, capacity);
  const freeNow = segments[0].freeSlots;
  if (freeNow > 0) return `${freeNow} of ${capacity} slots free`;
  const nextFree = nextFreeDate(segments, 1, recoveryDays);
  if (nextFree === null) return `No slot free in ${AVAILABILITY_WEEKS} weeks`;
  const sameYear = nextFree.slice(0, 4) === today.slice(0, 4);
  return `Free from ${format(parseISO(nextFree), sameYear ? 'd MMM' : 'd MMM yyyy')}`;
}
