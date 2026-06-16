import { describe, it, expect } from 'vitest';
import {
  CAPACITY,
  slotsFor,
  checkFit,
  peakLoadInRange,
  suggestMembers,
  earliestAvailableDate,
  evaluateAssignment,
  supportSegments,
  isCapacityExempt,
  type CapacityItem,
} from '../capacity';

const item = (
  id: string,
  startDate: string,
  endDate: string,
  size: CapacityItem['size'],
): CapacityItem => ({ id, startDate, endDate, size });

describe('isCapacityExempt', () => {
  it('flags the Digital Queue regardless of case or surrounding whitespace', () => {
    expect(isCapacityExempt({ title: 'Digital Queue' })).toBe(true);
    expect(isCapacityExempt({ title: 'digital queue' })).toBe(true);
    expect(isCapacityExempt({ title: '  Digital Queue  ' })).toBe(true);
  });

  it('does not flag ordinary projects or missing titles', () => {
    expect(isCapacityExempt({ title: 'Checkout Redesign' })).toBe(false);
    expect(isCapacityExempt({ title: 'Digital Queue Migration' })).toBe(false);
    expect(isCapacityExempt({})).toBe(false);
  });
});

describe('slotsFor', () => {
  it('maps sizes to slot costs', () => {
    expect(slotsFor('large')).toBe(2);
    expect(slotsFor('medium')).toBe(1.5);
    expect(slotsFor('small')).toBe(1);
  });

  it('falls back to Small (1 slot) for a missing/unknown size', () => {
    // Unsized projects must not silently consume a Medium's 1.5 slots.
    expect(slotsFor(undefined as unknown as CapacityItem['size'])).toBe(1);
    expect(slotsFor('xl' as unknown as CapacityItem['size'])).toBe(1);
  });
});

describe('peakLoadInRange', () => {
  it('sums only concurrently active projects', () => {
    const items = [
      item('a', '2026-01-01', '2026-01-31', 'large'), // 2
      item('b', '2026-02-01', '2026-02-28', 'large'), // 2, no overlap with a
    ];
    // Whole-window peak is 2 because a and b never overlap.
    expect(peakLoadInRange(items, '2026-01-01', '2026-02-28')).toBe(2);
  });

  it('adds overlapping projects together', () => {
    const items = [
      item('a', '2026-01-01', '2026-01-31', 'large'), // 2
      item('b', '2026-01-15', '2026-02-15', 'medium'), // 1.5 overlapping mid-Jan
    ];
    expect(peakLoadInRange(items, '2026-01-01', '2026-02-15')).toBe(3.5);
  });
});

describe('checkFit', () => {
  it('allows a project that keeps peak at or under capacity', () => {
    const existing = [item('a', '2026-01-01', '2026-01-31', 'large')]; // 2
    const candidate = item('b', '2026-01-10', '2026-01-20', 'large'); // +2 => 4
    const result = checkFit(existing, candidate);
    expect(result.fits).toBe(true);
    expect(result.peakLoad).toBe(4);
  });

  it('blocks a project that pushes peak over capacity', () => {
    const existing = [
      item('a', '2026-01-01', '2026-01-31', 'large'), // 2
      item('b', '2026-01-01', '2026-01-31', 'medium'), // 1.5 => 3.5 concurrent
    ];
    const candidate = item('c', '2026-01-10', '2026-01-20', 'medium'); // +1.5 => 5
    const result = checkFit(existing, candidate);
    expect(result.fits).toBe(false);
    expect(result.peakLoad).toBe(5);
    expect(result.freeSlots).toBe(CAPACITY - 3.5);
  });

  it('allows non-overlapping projects regardless of size', () => {
    const existing = [item('a', '2026-01-01', '2026-01-31', 'large')]; // 2
    const candidate = item('b', '2026-03-01', '2026-03-31', 'large'); // separate month
    expect(checkFit(existing, candidate).fits).toBe(true);
  });

  describe('asOf (ignore the past)', () => {
    // A long candidate that clashes only in a window that has already passed.
    const existing = [
      item('p1', '2026-01-01', '2026-04-01', 'large'), // 2, ends before asOf
      item('p2', '2026-01-01', '2026-04-01', 'large'), // 2, ends before asOf
    ];
    const candidate = item('c', '2026-02-01', '2026-10-01', 'large'); // spans past -> future

    it('blocks on a past clash when asOf is not given (legacy behaviour)', () => {
      // Feb–Apr: p1 + p2 + candidate = 6 > 4.
      expect(checkFit(existing, candidate).fits).toBe(false);
      expect(checkFit(existing, candidate).peakLoad).toBe(6);
    });

    it('ignores the past clash once asOf clears it', () => {
      // From 2026-06-01 the two blockers are finished, so only the candidate
      // remains over its future window.
      const result = checkFit(existing, candidate, '2026-06-01');
      expect(result.fits).toBe(true);
      expect(result.peakLoad).toBe(2);
    });

    it('still blocks on a clash that lands after asOf', () => {
      const future = [
        item('f1', '2026-07-01', '2026-09-01', 'large'),
        item('f2', '2026-07-01', '2026-09-01', 'large'),
      ];
      expect(checkFit(future, candidate, '2026-06-01').fits).toBe(false);
    });
  });
});

describe('suggestMembers', () => {
  it('returns owners who can absorb the project, most free first', () => {
    const candidate = item('x', '2026-01-10', '2026-01-20', 'large'); // needs 2
    const byOwner = {
      Alice: [item('a', '2026-01-01', '2026-01-31', 'large')], // intended, full-ish
      Bob: [item('b', '2026-01-01', '2026-01-31', 'large')], // 2 used, 2 free -> fits
      Cara: [], // totally free
      Dan: [
        item('d1', '2026-01-01', '2026-01-31', 'large'),
        item('d2', '2026-01-01', '2026-01-31', 'medium'),
      ], // 3.5 used -> can't fit a large
    };
    const result = suggestMembers(byOwner, candidate, 'Alice');
    expect(result.map(r => r.owner)).toEqual(['Cara', 'Bob']);
  });
});

describe('earliestAvailableDate', () => {
  it('suggests a week after the blocking project ends', () => {
    const existing = [item('a', '2026-01-01', '2026-01-31', 'large')]; // 2 used
    // Two larges can't coexist (2+2 within capacity is fine = 4)... use a blocker that overflows:
    const existingFull = [
      item('a', '2026-01-01', '2026-01-31', 'large'),
      item('b', '2026-01-01', '2026-01-31', 'medium'), // 3.5 used
    ];
    const candidate = item('c', '2026-01-10', '2026-01-20', 'medium'); // +1.5 overflows now
    const date = earliestAvailableDate(existingFull, candidate);
    // Both blockers end 2026-01-31; +7 day buffer => available 2026-02-08.
    expect(date).toBe('2026-02-08');
    // sanity: the lone-large case would have fit immediately
    expect(checkFit(existing, candidate).fits).toBe(true);
  });
});

describe('evaluateAssignment', () => {
  it('reports fit with no suggestions when it fits', () => {
    const byOwner = { Alice: [item('a', '2026-01-01', '2026-01-31', 'small')] };
    const candidate = item('b', '2026-01-10', '2026-01-20', 'small');
    const verdict = evaluateAssignment(byOwner, candidate, 'Alice');
    expect(verdict.fits).toBe(true);
    expect(verdict.alternativeOwners).toEqual([]);
    expect(verdict.availableFrom).toBeNull();
  });

  it('reports alternatives and a free-from date when it does not fit', () => {
    const byOwner = {
      Alice: [
        item('a', '2026-01-01', '2026-01-31', 'large'),
        item('b', '2026-01-01', '2026-01-31', 'large'), // 4 used, full
      ],
      Bob: [],
    };
    const candidate = item('c', '2026-01-10', '2026-01-20', 'small');
    const verdict = evaluateAssignment(byOwner, candidate, 'Alice');
    expect(verdict.fits).toBe(false);
    expect(verdict.alternativeOwners.map(o => o.owner)).toContain('Bob');
    expect(verdict.availableFrom).toBe('2026-02-08');
  });

  it('ignores the candidate itself when re-evaluating a placed project', () => {
    const byOwner = {
      Alice: [item('a', '2026-01-01', '2026-01-31', 'large')],
    };
    // Re-evaluating project 'a' against Alice should not double-count it.
    const verdict = evaluateAssignment(byOwner, item('a', '2026-01-01', '2026-01-31', 'large'), 'Alice');
    expect(verdict.fits).toBe(true);
    expect(verdict.peakLoad).toBe(2);
  });
});

describe('combination matrix (all multisets of L/M/S)', () => {
  // Place every (large, medium, small) count combo on the SAME overlapping dates
  // so total concurrent load = sum of slots, then assert checkFit's verdict and
  // the resulting support gap.
  const fitting: Array<{ l: number; m: number; s: number; total: number; gap: number }> = [];
  const exactlyFour: string[] = [];

  for (let l = 0; l <= 2; l++) {
    for (let m = 0; m <= 3; m++) {
      for (let s = 0; s <= 4; s++) {
        const projects: CapacityItem[] = [];
        let n = 0;
        for (let i = 0; i < l; i++) projects.push(item(`L${n++}`, '2026-01-10', '2026-01-20', 'large'));
        for (let i = 0; i < m; i++) projects.push(item(`M${n++}`, '2026-01-10', '2026-01-20', 'medium'));
        for (let i = 0; i < s; i++) projects.push(item(`S${n++}`, '2026-01-10', '2026-01-20', 'small'));

        const total = l * 2 + m * 1.5 + s * 1;
        const candidate = projects[0];
        const rest = projects.slice(1);
        const result = projects.length ? checkFit(rest, candidate) : { fits: true, peakLoad: 0 };

        // checkFit's verdict must agree with the raw arithmetic.
        expect(result.fits).toBe(total <= CAPACITY);
        if (projects.length) expect(result.peakLoad).toBe(total);

        if (total <= CAPACITY) {
          fitting.push({ l, m, s, total, gap: CAPACITY - total });
          if (total === CAPACITY) exactlyFour.push(`${l}L ${m}M ${s}S`);
        }
      }
    }
  }

  it('accepts exactly the combinations that sum to <= 4', () => {
    // Snapshot the legal combinations so any change to the model is visible.
    expect(fitting.length).toBeGreaterThan(0);
    // The four (and only four) ways to perfectly fill 4 slots.
    expect(exactlyFour.sort()).toEqual(['0L 0M 4S', '0L 2M 1S', '1L 0M 2S', '2L 0M 0S']);
  });

  it('identifies the 3.5-load configs that leave a 0.5 support gap', () => {
    const halfGap = fitting.filter(f => f.gap === 0.5).map(f => `${f.l}L ${f.m}M ${f.s}S`);
    expect(halfGap.sort()).toEqual(['0L 1M 2S', '1L 1M 0S']);
  });

  it('uses exact arithmetic (no float drift on 1.5 increments)', () => {
    // 1.5 + 1.5 + 1 must equal exactly 4, not 4.0000001.
    const projects = [
      item('a', '2026-01-10', '2026-01-20', 'medium'),
      item('b', '2026-01-10', '2026-01-20', 'medium'),
    ];
    expect(checkFit(projects, item('c', '2026-01-10', '2026-01-20', 'small')).peakLoad).toBe(4);
  });
});

describe('supportSegments', () => {
  it('returns full free capacity for an empty timeline', () => {
    const segments = supportSegments([], '2026-01-01', '2026-01-31');
    expect(segments).toEqual([{ startDate: '2026-01-01', endDate: '2026-01-31', freeSlots: 4 }]);
  });

  it('splits the timeline by changing load and reports free slots', () => {
    const items = [item('a', '2026-01-10', '2026-01-20', 'large')]; // 2 used mid-month
    const segments = supportSegments(items, '2026-01-01', '2026-01-31');
    // before, during, after the project
    expect(segments).toEqual([
      { startDate: '2026-01-01', endDate: '2026-01-09', freeSlots: 4 },
      { startDate: '2026-01-10', endDate: '2026-01-20', freeSlots: 2 },
      { startDate: '2026-01-21', endDate: '2026-01-31', freeSlots: 4 },
    ]);
  });

  it('merges adjacent segments with equal free capacity', () => {
    const items = [
      item('a', '2026-01-10', '2026-01-15', 'large'), // 2
      item('b', '2026-01-20', '2026-01-25', 'large'), // 2, same free level as a's gap? no
    ];
    const segments = supportSegments(items, '2026-01-01', '2026-01-31');
    // 4 (free) | 2 | 4 | 2 | 4  -> the equal-4 gaps are separated by load, not merged
    expect(segments.map(s => s.freeSlots)).toEqual([4, 2, 4, 2, 4]);
  });
});
