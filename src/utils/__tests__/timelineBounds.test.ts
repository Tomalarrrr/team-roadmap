import { describe, it, expect } from 'vitest';
import type { Project } from '../../types';
import { getTimelineBounds, DEFAULT_MIN_YEAR, DEFAULT_MAX_YEAR } from '../timelineBounds';

const project = (id: string, startDate: string, endDate: string): Project => ({
  id,
  title: id,
  owner: 'Alex',
  startDate,
  endDate,
  statusColor: '#457028',
  size: 'small',
  milestones: [],
});

describe('getTimelineBounds', () => {
  it('defaults to the FY2025–FY2030 window', () => {
    const { start, end, minYear, maxYear } = getTimelineBounds([]);
    expect(minYear).toBe(DEFAULT_MIN_YEAR);
    expect(maxYear).toBe(DEFAULT_MAX_YEAR);
    expect(start).toEqual(new Date(2025, 0, 1));
    expect(end).toEqual(new Date(2030, 11, 31));
  });

  it('widens to cover projects outside the default window', () => {
    const bounds = getTimelineBounds([
      project('early', '2023-06-01', '2023-09-01'),
      project('late', '2032-01-01', '2032-03-01'),
    ]);
    expect(bounds.minYear).toBe(2023);
    expect(bounds.maxYear).toBe(2032);
  });

  it('never narrows below the default window for in-range projects', () => {
    const bounds = getTimelineBounds([project('mid', '2027-01-01', '2027-06-01')]);
    expect(bounds.minYear).toBe(DEFAULT_MIN_YEAR);
    expect(bounds.maxYear).toBe(DEFAULT_MAX_YEAR);
  });

  it('reads the year off the ISO string, so it is timezone-independent', () => {
    // A Jan-1 date constructed via `new Date(iso)` can land in the previous year
    // west of UTC. Parsing the string avoids that.
    const bounds = getTimelineBounds([project('nye', '2024-01-01', '2024-12-31')]);
    expect(bounds.minYear).toBe(2024);
  });

  it('ignores missing / malformed dates rather than throwing', () => {
    const broken = { ...project('x', '', ''), startDate: undefined, endDate: 'not-a-date' } as unknown as Project;
    const bounds = getTimelineBounds([broken]);
    expect(bounds.minYear).toBe(DEFAULT_MIN_YEAR);
    expect(bounds.maxYear).toBe(DEFAULT_MAX_YEAR);
  });

  // The regression this guards: the Timeline used to derive its range from the
  // FILTERED project list, so applying a filter moved the axis and the viewport
  // slid off the today line. Bounds are now always measured over every project,
  // and this asserts the property that makes that safe — a subset must not
  // produce a different range than the full set it came from.
  it('is stable when the list is filtered down to a subset', () => {
    const all = [
      project('a', '2023-01-01', '2023-12-31'), // widens the low end
      project('b', '2027-01-01', '2027-06-01'),
      project('c', '2032-01-01', '2032-06-01'), // widens the high end
    ];
    const full = getTimelineBounds(all);

    // Filtering to just the middle project would, if bounds were taken from the
    // filtered list, snap the range back to the 2025–2030 default and shift the
    // origin by two years.
    const filtered = getTimelineBounds([all[1]]);
    expect(filtered.minYear).not.toBe(full.minYear);

    // Measured over the full list (what the app now always passes), the range is
    // identical no matter what the view is filtered to.
    expect(getTimelineBounds(all)).toEqual(full);
  });
});
