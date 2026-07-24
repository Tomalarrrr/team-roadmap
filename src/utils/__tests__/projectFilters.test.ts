import { describe, it, expect } from 'vitest';
import type { Project, ProjectStatus } from '../../types';
import {
  INITIAL_FILTERS,
  countActiveFilters,
  hasActiveFilters,
  filterProjects,
  parseStoredFilters,
  timeframeOf,
} from '../projectFilters';

// Fixed "today" so the timeframe tests don't drift with the real clock.
const TODAY = '2026-02-01';

// Status is injected (App derives it from colour + dates); here we just map by id.
const STATUS_BY_ID: Record<string, ProjectStatus> = {};
const getStatus = (p: Project): ProjectStatus => STATUS_BY_ID[p.id] ?? 'on-track';

function makeProject(overrides: Partial<Project> & { id: string }): Project {
  return {
    title: overrides.id,
    owner: 'Amy',
    startDate: '2026-01-01',
    endDate: '2026-03-01',
    statusColor: '#457028',
    size: 'small',
    milestones: [],
    ...overrides,
  };
}

const projects: Project[] = [
  makeProject({ id: 'alpha', title: 'Alpha Portal', owner: 'Amy', size: 'small', epr: true }),
  makeProject({ id: 'beta', title: 'Beta Migration', owner: 'Ben', size: 'large' }),
  makeProject({ id: 'gamma', title: 'Gamma Rollout', owner: 'Amy', size: 'medium', epr: false }),
  // Legacy record: no size field at all.
  makeProject({ id: 'delta', title: 'Delta Review', owner: 'Cat', size: undefined as never }),
];
STATUS_BY_ID.alpha = 'on-track';
STATUS_BY_ID.beta = 'at-risk';
STATUS_BY_ID.gamma = 'complete';
STATUS_BY_ID.delta = 'on-track';

describe('filterProjects', () => {
  it('returns the same array reference when no filters are active', () => {
    expect(filterProjects(projects, INITIAL_FILTERS, getStatus, TODAY)).toBe(projects);
  });

  it('filters by owner (multi-select ORs within the dimension)', () => {
    const result = filterProjects(projects, { ...INITIAL_FILTERS, owners: ['Ben', 'Cat'] }, getStatus, TODAY);
    expect(result.map(p => p.id)).toEqual(['beta', 'delta']);
  });

  it('filters by size, treating a missing size as small', () => {
    const result = filterProjects(projects, { ...INITIAL_FILTERS, sizes: ['small'] }, getStatus, TODAY);
    expect(result.map(p => p.id)).toEqual(['alpha', 'delta']);
  });

  it('filters by multiple statuses', () => {
    const result = filterProjects(projects, { ...INITIAL_FILTERS, statuses: ['at-risk', 'complete'] }, getStatus, TODAY);
    expect(result.map(p => p.id)).toEqual(['beta', 'gamma']);
  });

  it("'yes' keeps only epr === true", () => {
    const result = filterProjects(projects, { ...INITIAL_FILTERS, epr: ['yes'] }, getStatus, TODAY);
    expect(result.map(p => p.id)).toEqual(['alpha']);
  });

  it("'no' keeps everything not flagged — epr false AND epr absent", () => {
    const result = filterProjects(projects, { ...INITIAL_FILTERS, epr: ['no'] }, getStatus, TODAY);
    expect(result.map(p => p.id)).toEqual(['beta', 'gamma', 'delta']);
  });

  it('selecting both EPR chips matches every project', () => {
    const result = filterProjects(projects, { ...INITIAL_FILTERS, epr: ['yes', 'no'] }, getStatus, TODAY);
    expect(result.map(p => p.id)).toEqual(projects.map(p => p.id));
  });

  it('search matches title or owner, case-insensitively', () => {
    expect(filterProjects(projects, { ...INITIAL_FILTERS, search: 'MIGRATION' }, getStatus, TODAY).map(p => p.id)).toEqual(['beta']);
    expect(filterProjects(projects, { ...INITIAL_FILTERS, search: 'amy' }, getStatus, TODAY).map(p => p.id)).toEqual(['alpha', 'gamma']);
    expect(filterProjects(projects, { ...INITIAL_FILTERS, search: '   ' }, getStatus, TODAY)).toBe(projects);
  });

  it('dimensions AND together', () => {
    const result = filterProjects(
      projects,
      { ...INITIAL_FILTERS, owners: ['Amy'], sizes: ['small', 'medium'], epr: ['yes'] },
      getStatus,
      TODAY,
    );
    expect(result.map(p => p.id)).toEqual(['alpha']);
  });
});

describe('timeframeOf', () => {
  const at = (startDate: string, endDate: string) => makeProject({ id: 't', startDate, endDate });

  it('classifies relative to today, with both bounds inclusive', () => {
    expect(timeframeOf(at('2026-01-01', '2026-01-31'), TODAY)).toBe('past');
    expect(timeframeOf(at('2026-01-01', '2026-03-01'), TODAY)).toBe('current');
    expect(timeframeOf(at('2026-03-01', '2026-04-01'), TODAY)).toBe('upcoming');
    // A project on its first or last day is still current, matching isDatePast.
    expect(timeframeOf(at(TODAY, '2026-03-01'), TODAY)).toBe('current');
    expect(timeframeOf(at('2026-01-01', TODAY), TODAY)).toBe('current');
  });
});

describe('timeframe filtering', () => {
  const dated: Project[] = [
    makeProject({ id: 'done', startDate: '2025-01-01', endDate: '2025-06-01' }),
    makeProject({ id: 'live', startDate: '2026-01-01', endDate: '2026-06-01' }),
    makeProject({ id: 'later', startDate: '2026-09-01', endDate: '2026-12-01' }),
  ];

  it('filters to a single timeframe', () => {
    expect(filterProjects(dated, { ...INITIAL_FILTERS, timeframes: ['current'] }, getStatus, TODAY).map(p => p.id))
      .toEqual(['live']);
    expect(filterProjects(dated, { ...INITIAL_FILTERS, timeframes: ['upcoming'] }, getStatus, TODAY).map(p => p.id))
      .toEqual(['later']);
    expect(filterProjects(dated, { ...INITIAL_FILTERS, timeframes: ['past'] }, getStatus, TODAY).map(p => p.id))
      .toEqual(['done']);
  });

  it('ORs multiple timeframes and covers everything when all three are on', () => {
    expect(filterProjects(dated, { ...INITIAL_FILTERS, timeframes: ['current', 'upcoming'] }, getStatus, TODAY).map(p => p.id))
      .toEqual(['live', 'later']);
    expect(filterProjects(dated, { ...INITIAL_FILTERS, timeframes: ['past', 'current', 'upcoming'] }, getStatus, TODAY))
      .toHaveLength(3);
  });
});

describe('active filter counting', () => {
  it('counts selections across dimensions, excluding search', () => {
    expect(countActiveFilters(INITIAL_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...INITIAL_FILTERS, search: 'x' })).toBe(0);
    expect(countActiveFilters({
      search: '',
      owners: ['Amy', 'Ben'],
      sizes: ['large'],
      statuses: ['at-risk'],
      epr: ['yes'],
      timeframes: ['current'],
    })).toBe(6);
    // Both EPR chips count as two selections, matching the other dimensions.
    expect(countActiveFilters({ ...INITIAL_FILTERS, epr: ['yes', 'no'] })).toBe(2);
  });

  it('hasActiveFilters mirrors the count', () => {
    expect(hasActiveFilters(INITIAL_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...INITIAL_FILTERS, epr: ['no'] })).toBe(true);
  });
});

describe('parseStoredFilters', () => {
  it('returns initial state for garbage input', () => {
    expect(parseStoredFilters(null)).toEqual(INITIAL_FILTERS);
    expect(parseStoredFilters('nope')).toEqual(INITIAL_FILTERS);
    expect(parseStoredFilters(42)).toEqual(INITIAL_FILTERS);
  });

  it('restores the current shape and always clears search', () => {
    const parsed = parseStoredFilters({
      search: 'stale',
      owners: ['Amy'],
      sizes: ['large', 'bogus'],
      statuses: ['at-risk', 'not-a-status'],
      epr: ['no', 'maybe'],
      timeframes: ['current', 'someday'],
    });
    expect(parsed).toEqual({
      search: '',
      owners: ['Amy'],
      sizes: ['large'],
      statuses: ['at-risk'],
      epr: ['no'],
      timeframes: ['current'],
    });
  });

  it('migrates the legacy boolean epr flag', () => {
    expect(parseStoredFilters({ epr: true }).epr).toEqual(['yes']);
    expect(parseStoredFilters({ epr: false }).epr).toEqual([]);
  });

  it('migrates the legacy single-select status shape', () => {
    expect(parseStoredFilters({ owners: [], status: 'on-hold' }).statuses).toEqual(['on-hold']);
    expect(parseStoredFilters({ status: 'all' }).statuses).toEqual([]);
    // Legacy tags/dateRange fields are simply dropped.
    expect(parseStoredFilters({ tags: ['x'], dateRange: { start: 'a', end: 'b' } })).toEqual(INITIAL_FILTERS);
  });

  it('ignores epr values that are neither a valid array nor the legacy boolean', () => {
    expect(parseStoredFilters({ epr: 'true' }).epr).toEqual([]);
    expect(parseStoredFilters({ epr: 1 }).epr).toEqual([]);
    expect(parseStoredFilters({ epr: ['nonsense'] }).epr).toEqual([]);
  });
});
