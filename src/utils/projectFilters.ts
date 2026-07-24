import type { EprFilter, FilterState, Project, ProjectSize, ProjectStatus, Timeframe } from '../types';
import { DEFAULT_SIZE, SIZE_SLOTS } from './capacity';
import { STATUS_COLORS } from './statusColors';

/**
 * Filtering engine for the roadmap view. App owns the FilterState; the header
 * Filter menu edits the persistent dimensions (owners / sizes / statuses / EPR)
 * and the search modal edits the transient `search` text. This module is the
 * single place the state is interpreted, so the badge count, the "n of m"
 * summary, and the board itself can never disagree.
 */

export const INITIAL_FILTERS: FilterState = {
  search: '',
  owners: [],
  sizes: [],
  statuses: [],
  epr: [],
  timeframes: [],
};

/**
 * Where a project sits relative to `today`. Both bounds are inclusive, so a
 * project on its first or last day counts as current — matching how the rest of
 * the app treats end dates (see isDatePast). ISO dates sort lexically, so plain
 * string comparison is correct and avoids timezone drift.
 */
export function timeframeOf(project: Project, today: string): Timeframe {
  if (project.endDate < today) return 'past';
  if (project.startDate > today) return 'upcoming';
  return 'current';
}

/** Number of active selections across the persistent dimensions (search is
 *  transient and excluded — the badge sits on the Filter button, not Search). */
export function countActiveFilters(filters: FilterState): number {
  return (
    filters.owners.length +
    filters.sizes.length +
    filters.statuses.length +
    filters.epr.length +
    filters.timeframes.length
  );
}

export function hasActiveFilters(filters: FilterState): boolean {
  return countActiveFilters(filters) > 0;
}

/**
 * Apply the active filters to the project list. Dimensions AND together; the
 * selections within a dimension OR together (owner is Amy OR Ben). Returns the
 * input array untouched when nothing is active, so referential equality holds
 * and downstream memos don't re-fire.
 *
 * `getDisplayStatus` resolves a project's *display* status (auto-complete for
 * elapsed projects etc.) and `today` is an ISO date — both injected so this
 * stays pure and independent of the clock.
 */
export function filterProjects(
  projects: Project[],
  filters: FilterState,
  getDisplayStatus: (project: Project) => ProjectStatus,
  today: string,
): Project[] {
  const owners = new Set(filters.owners);
  const sizes = new Set(filters.sizes);
  const statuses = new Set(filters.statuses);
  const epr = new Set(filters.epr);
  const timeframes = new Set(filters.timeframes);
  const searchQuery = filters.search.trim().toLowerCase();

  const hasOwnerFilter = owners.size > 0;
  const hasSizeFilter = sizes.size > 0;
  const hasStatusFilter = statuses.size > 0;
  const hasEprFilter = epr.size > 0;
  const hasTimeframeFilter = timeframes.size > 0;
  const hasSearchFilter = searchQuery.length > 0;

  if (
    !hasOwnerFilter && !hasSizeFilter && !hasStatusFilter &&
    !hasEprFilter && !hasTimeframeFilter && !hasSearchFilter
  ) {
    return projects;
  }

  return projects.filter(p => {
    if (hasOwnerFilter && !owners.has(p.owner)) return false;
    // Unsized legacy projects behave as their effective size (small) everywhere
    // else in the app, so the size filter treats them the same way.
    if (hasSizeFilter && !sizes.has(p.size ?? DEFAULT_SIZE)) return false;
    if (hasStatusFilter && !statuses.has(getDisplayStatus(p))) return false;
    // Anything not explicitly flagged counts as non-EPR — including projects
    // created before the field existed. Selecting both chips matches everything.
    if (hasEprFilter && !epr.has(p.epr === true ? 'yes' : 'no')) return false;
    if (hasTimeframeFilter && !timeframes.has(timeframeOf(p, today))) return false;
    if (hasSearchFilter) {
      const matches =
        p.title.toLowerCase().includes(searchQuery) ||
        p.owner.toLowerCase().includes(searchQuery);
      if (!matches) return false;
    }
    return true;
  });
}

const VALID_SIZES = new Set<string>(Object.keys(SIZE_SLOTS));
const VALID_STATUSES = new Set<string>(STATUS_COLORS.map(s => s.slug));
const VALID_EPR = new Set<string>(['yes', 'no']);
const VALID_TIMEFRAMES = new Set<string>(['current', 'upcoming', 'past']);

/**
 * Rebuild a FilterState from a persisted (localStorage) value. Tolerates
 * anything: unknown fields are dropped, invalid entries filtered out, and two
 * older shapes migrate forward — the pre-FilterMenu `status: 'at-risk' | 'all'`
 * single-select, and the EPR-only-boolean that predated the Non-EPR chip.
 * Search always starts empty on a fresh load.
 */
export function parseStoredFilters(raw: unknown): FilterState {
  if (!raw || typeof raw !== 'object') return INITIAL_FILTERS;
  const stored = raw as Record<string, unknown>;

  const strings = (value: unknown, valid?: Set<string>): string[] =>
    Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string' && (!valid || valid.has(v)))
      : [];

  // Legacy single-select status ('all' meant no filter).
  const legacyStatus =
    typeof stored.status === 'string' && VALID_STATUSES.has(stored.status)
      ? [stored.status as ProjectStatus]
      : [];
  const statuses = strings(stored.statuses, VALID_STATUSES) as ProjectStatus[];

  // `epr` used to be a plain boolean meaning "EPR only" (there was no Non-EPR
  // chip); true migrates to ['yes'], false/absent to no filter.
  const epr = Array.isArray(stored.epr)
    ? (strings(stored.epr, VALID_EPR) as EprFilter[])
    : stored.epr === true
      ? (['yes'] as EprFilter[])
      : [];

  return {
    search: '',
    owners: strings(stored.owners),
    sizes: strings(stored.sizes, VALID_SIZES) as ProjectSize[],
    statuses: statuses.length > 0 ? statuses : legacyStatus,
    epr,
    timeframes: strings(stored.timeframes, VALID_TIMEFRAMES) as Timeframe[],
  };
}
