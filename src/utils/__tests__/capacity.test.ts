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
  nextFreeDate,
  availabilityLabel,
  capacityOfMember,
  capacityByOwner,
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
    expect(slotsFor('full-time')).toBe(4);
    expect(slotsFor('large')).toBe(3);
    expect(slotsFor('medium')).toBe(2);
    expect(slotsFor('small')).toBe(1);
  });

  it('falls back to Small (1 slot) for a missing/unknown size', () => {
    // Unsized projects must not silently consume more than a Small's 1 slot.
    expect(slotsFor(undefined as unknown as CapacityItem['size'])).toBe(1);
    expect(slotsFor('xl' as unknown as CapacityItem['size'])).toBe(1);
  });
});

describe('peakLoadInRange', () => {
  it('sums only concurrently active projects', () => {
    const items = [
      item('a', '2026-01-01', '2026-01-31', 'large'), // 3
      item('b', '2026-02-01', '2026-02-28', 'large'), // 3, no overlap with a
    ];
    // Whole-window peak is 3 because a and b never overlap.
    expect(peakLoadInRange(items, '2026-01-01', '2026-02-28')).toBe(3);
  });

  it('adds overlapping projects together', () => {
    const items = [
      item('a', '2026-01-01', '2026-01-31', 'medium'), // 2
      item('b', '2026-01-15', '2026-02-15', 'medium'), // 2 overlapping mid-Jan
    ];
    expect(peakLoadInRange(items, '2026-01-01', '2026-02-15')).toBe(4);
  });
});

describe('checkFit', () => {
  it('allows a project that keeps peak at or under capacity', () => {
    const existing = [item('a', '2026-01-01', '2026-01-31', 'large')]; // 3
    const candidate = item('b', '2026-01-10', '2026-01-20', 'small'); // +1 => 4
    const result = checkFit(existing, candidate);
    expect(result.fits).toBe(true);
    expect(result.peakLoad).toBe(4);
  });

  it('blocks a project that pushes peak over capacity', () => {
    const existing = [
      item('a', '2026-01-01', '2026-01-31', 'medium'), // 2
      item('b', '2026-01-01', '2026-01-31', 'small'), // 1 => 3 concurrent
    ];
    const candidate = item('c', '2026-01-10', '2026-01-20', 'medium'); // +2 => 5
    const result = checkFit(existing, candidate);
    expect(result.fits).toBe(false);
    expect(result.peakLoad).toBe(5);
    expect(result.freeSlots).toBe(CAPACITY - 3);
  });

  it('allows non-overlapping projects regardless of size', () => {
    const existing = [item('a', '2026-01-01', '2026-01-31', 'large')]; // 3
    const candidate = item('b', '2026-03-01', '2026-03-31', 'large'); // separate month
    expect(checkFit(existing, candidate).fits).toBe(true);
  });

  describe('asOf (ignore the past)', () => {
    // A long candidate that clashes only in a window that has already passed.
    const existing = [
      item('p1', '2026-01-01', '2026-04-01', 'large'), // 3, ends before asOf
      item('p2', '2026-01-01', '2026-04-01', 'large'), // 3, ends before asOf
    ];
    const candidate = item('c', '2026-02-01', '2026-10-01', 'large'); // spans past -> future

    it('blocks on a past clash when asOf is not given (legacy behaviour)', () => {
      // Feb–Apr: p1 + p2 + candidate = 9 > 4.
      expect(checkFit(existing, candidate).fits).toBe(false);
      expect(checkFit(existing, candidate).peakLoad).toBe(9);
    });

    it('ignores the past clash once asOf clears it', () => {
      // From 2026-06-01 the two blockers are finished, so only the candidate
      // remains over its future window.
      const result = checkFit(existing, candidate, '2026-06-01');
      expect(result.fits).toBe(true);
      expect(result.peakLoad).toBe(3);
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
    const candidate = item('x', '2026-01-10', '2026-01-20', 'large'); // needs 3
    const byOwner = {
      Alice: [item('a', '2026-01-01', '2026-01-31', 'large')], // intended, full-ish
      Bob: [item('b', '2026-01-01', '2026-01-31', 'small')], // 1 used, 3 free -> fits
      Cara: [], // totally free
      Dan: [
        item('d1', '2026-01-01', '2026-01-31', 'medium'),
      ], // 2 used, 2 free -> can't fit a large
    };
    const result = suggestMembers(byOwner, candidate, 'Alice');
    expect(result.map(r => r.owner)).toEqual(['Cara', 'Bob']);
  });
});

describe('earliestAvailableDate', () => {
  it('suggests a week after the blocking project ends', () => {
    const existing = [item('a', '2026-01-01', '2026-01-31', 'large')]; // 3 used
    // A Large + a Small fills capacity exactly (3 + 1 = 4)...
    const existingFull = [
      item('a', '2026-01-01', '2026-01-31', 'large'),
      item('b', '2026-01-01', '2026-01-31', 'small'), // 4 used, full
    ];
    const candidate = item('c', '2026-01-10', '2026-01-20', 'small'); // +1 overflows now
    const date = earliestAvailableDate(existingFull, candidate);
    // Both blockers end 2026-01-31; +7 day buffer => available 2026-02-08.
    expect(date).toBe('2026-02-08');
    // sanity: the lone-large case would have fit immediately (3 + 1 = 4)
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
        item('b', '2026-01-01', '2026-01-31', 'small'), // 4 used, full
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
    expect(verdict.peakLoad).toBe(3);
  });
});

describe('combination matrix (all multisets of FT/L/M/S)', () => {
  // Place every (full-time, large, medium, small) count combo on the SAME
  // overlapping dates so total concurrent load = sum of slots, then assert
  // checkFit's verdict and the resulting support gap.
  const fitting: Array<{ ft: number; l: number; m: number; s: number; total: number; gap: number }> = [];
  const exactlyFour: string[] = [];

  const label = (ft: number, l: number, m: number, s: number) => `${ft}FT ${l}L ${m}M ${s}S`;

  for (let ft = 0; ft <= 2; ft++) {
    for (let l = 0; l <= 2; l++) {
      for (let m = 0; m <= 3; m++) {
        for (let s = 0; s <= 5; s++) {
          const projects: CapacityItem[] = [];
          let n = 0;
          for (let i = 0; i < ft; i++) projects.push(item(`FT${n++}`, '2026-01-10', '2026-01-20', 'full-time'));
          for (let i = 0; i < l; i++) projects.push(item(`L${n++}`, '2026-01-10', '2026-01-20', 'large'));
          for (let i = 0; i < m; i++) projects.push(item(`M${n++}`, '2026-01-10', '2026-01-20', 'medium'));
          for (let i = 0; i < s; i++) projects.push(item(`S${n++}`, '2026-01-10', '2026-01-20', 'small'));

          const total = ft * 4 + l * 3 + m * 2 + s * 1;
          const candidate = projects[0];
          const rest = projects.slice(1);
          const result = projects.length ? checkFit(rest, candidate) : { fits: true, peakLoad: 0 };

          // checkFit's verdict must agree with the raw arithmetic.
          expect(result.fits).toBe(total <= CAPACITY);
          if (projects.length) expect(result.peakLoad).toBe(total);

          if (total <= CAPACITY) {
            fitting.push({ ft, l, m, s, total, gap: CAPACITY - total });
            if (total === CAPACITY) exactlyFour.push(label(ft, l, m, s));
          }
        }
      }
    }
  }

  it('accepts exactly the combinations that sum to <= 4', () => {
    // Snapshot the legal combinations so any change to the model is visible.
    expect(fitting.length).toBeGreaterThan(0);
    // The five (and only five) ways to perfectly fill 4 slots.
    expect(exactlyFour.sort()).toEqual([
      '0FT 0L 0M 4S', // 4 × Small
      '0FT 0L 1M 2S', // Medium + 2 Small
      '0FT 0L 2M 0S', // 2 × Medium
      '0FT 1L 0M 1S', // Large + Small
      '1FT 0L 0M 0S', // 1 × Full Time
    ]);
  });

  it('identifies the configs that leave a single free slot (load 3)', () => {
    const oneGap = fitting.filter(f => f.gap === 1).map(f => label(f.ft, f.l, f.m, f.s));
    expect(oneGap.sort()).toEqual([
      '0FT 0L 0M 3S', // 3 × Small
      '0FT 0L 1M 1S', // Medium + Small
      '0FT 1L 0M 0S', // 1 × Large
    ]);
  });

  it('uses exact integer arithmetic (slot costs sum cleanly)', () => {
    // Large + Small must equal exactly 4.
    const projects = [item('a', '2026-01-10', '2026-01-20', 'large')];
    expect(checkFit(projects, item('c', '2026-01-10', '2026-01-20', 'small')).peakLoad).toBe(4);
  });
});

describe('supportSegments', () => {
  it('returns full free capacity for an empty timeline', () => {
    const segments = supportSegments([], '2026-01-01', '2026-01-31');
    expect(segments).toEqual([{ startDate: '2026-01-01', endDate: '2026-01-31', freeSlots: 4 }]);
  });

  it('splits the timeline by changing load and reports free slots', () => {
    const items = [item('a', '2026-01-10', '2026-01-20', 'large')]; // 3 used mid-month
    const segments = supportSegments(items, '2026-01-01', '2026-01-31');
    // before, during, after the project
    expect(segments).toEqual([
      { startDate: '2026-01-01', endDate: '2026-01-09', freeSlots: 4 },
      { startDate: '2026-01-10', endDate: '2026-01-20', freeSlots: 1 },
      { startDate: '2026-01-21', endDate: '2026-01-31', freeSlots: 4 },
    ]);
  });

  it('merges adjacent segments with equal free capacity', () => {
    const items = [
      item('a', '2026-01-10', '2026-01-15', 'large'), // 3
      item('b', '2026-01-20', '2026-01-25', 'large'), // 3, same free level as a's gap? no
    ];
    const segments = supportSegments(items, '2026-01-01', '2026-01-31');
    // 4 (free) | 1 | 4 | 1 | 4  -> the equal-4 gaps are separated by load, not merged
    expect(segments.map(s => s.freeSlots)).toEqual([4, 1, 4, 1, 4]);
  });
});

describe('per-person capacity', () => {
  it('is the full lane unless the member has their own figure', () => {
    expect(capacityOfMember({})).toBe(CAPACITY);
    expect(capacityOfMember({ capacity: 2 })).toBe(2);
  });

  it('looks capacity up by owner name, with the full lane for an unknown owner', () => {
    const capacityOf = capacityByOwner([{ name: 'Priya', capacity: 2 }, { name: 'Sam' }]);
    expect(capacityOf('Priya')).toBe(2);
    expect(capacityOf('Sam')).toBe(CAPACITY);
    expect(capacityOf('Nobody')).toBe(CAPACITY);
  });

  it('fits a medium beside a medium at four slots but not at three', () => {
    const existing = [item('a', '2026-01-01', '2026-01-31', 'medium')];
    const candidate = item('b', '2026-01-10', '2026-01-20', 'medium');
    expect(checkFit(existing, candidate).fits).toBe(true);
    expect(checkFit(existing, candidate, undefined, 3)).toEqual({ fits: false, peakLoad: 4, freeSlots: 1 });
  });

  it('judges the intended owner and the alternatives each by their own capacity', () => {
    const byOwner = {
      Priya: [item('a', '2026-01-01', '2026-01-31', 'medium')],
      Sam: [item('c', '2026-01-01', '2026-01-31', 'medium')],
      Lee: [item('d', '2026-01-01', '2026-01-31', 'medium')],
    };
    const candidate = item('b', '2026-01-10', '2026-01-20', 'medium');
    const capacityOf = capacityByOwner([{ name: 'Priya', capacity: 3 }, { name: 'Sam', capacity: 3 }, { name: 'Lee' }]);
    const verdict = evaluateAssignment(byOwner, candidate, 'Priya', undefined, capacityOf);
    expect(verdict.fits).toBe(false);
    expect(verdict.alternativeOwners.map(a => a.owner)).toEqual(['Lee']);
  });

  it('frees the owner the given number of recovery days after the blocking work', () => {
    const existing = [item('a', '2026-01-01', '2026-01-31', 'full-time')];
    const candidate = item('b', '2026-01-10', '2026-01-20', 'small');
    expect(earliestAvailableDate(existing, candidate, undefined, CAPACITY, 7)).toBe('2026-02-08');
    expect(earliestAvailableDate(existing, candidate, undefined, CAPACITY, 0)).toBe('2026-02-01');
  });

  it('reports free slots against the capacity given, going negative when over', () => {
    const items = [item('a', '2026-01-10', '2026-01-20', 'large')];
    expect(supportSegments(items, '2026-01-01', '2026-01-31', 2).map(s => s.freeSlots)).toEqual([2, -1, 2]);
  });
});

describe('nextFreeDate', () => {
  const segments = supportSegments([item('a', '2026-01-01', '2026-01-20', 'large')], '2026-01-01', '2026-03-31');

  it('is the start of the window when that much is free already', () => {
    expect(nextFreeDate(segments, 1, 7)).toBe('2026-01-01');
  });

  it('adds the recovery days when the room only opens later', () => {
    expect(nextFreeDate(segments, 2, 7)).toBe('2026-01-28');
    expect(nextFreeDate(segments, 2, 0)).toBe('2026-01-21');
  });

  it('skips a gap that closes before recovery is over', () => {
    const tight = supportSegments(
      [item('a', '2026-01-01', '2026-01-20', 'full-time'), item('b', '2026-01-24', '2026-02-10', 'full-time')],
      '2026-01-01',
      '2026-03-31',
    );
    expect(nextFreeDate(tight, 1, 7)).toBe('2026-02-18');
  });

  it('is null when nothing that size opens in the window', () => {
    expect(nextFreeDate(segments, 5, 7)).toBeNull();
  });
});

describe('availabilityLabel', () => {
  const today = '2026-10-12';

  it('counts the slots free today against the person\'s own capacity', () => {
    expect(availabilityLabel([], today, 4, 7)).toBe('4 of 4 slots free');
    expect(availabilityLabel([item('a', '2026-09-01', '2026-11-30', 'large')], today, 4, 7)).toBe('1 of 4 slots free');
  });

  it('gives the date the next slot opens, after recovery, when nothing is free today', () => {
    const items = [item('a', '2026-09-01', '2026-10-31', 'medium')];
    expect(availabilityLabel(items, today, 2, 3)).toBe('Free from 4 Nov');
    expect(availabilityLabel(items, today, 2, 7)).toBe('Free from 8 Nov');
  });

  it('adds the year when the slot opens in a later one', () => {
    expect(availabilityLabel([item('a', '2026-09-01', '2027-01-10', 'full-time')], today, 4, 7)).toBe('Free from 18 Jan 2027');
  });

  it('says so when someone is full or over for the whole look-ahead', () => {
    expect(availabilityLabel([item('a', '2026-09-01', '2027-12-31', 'large')], today, 2, 7)).toBe('No slot free in 26 weeks');
  });
});
