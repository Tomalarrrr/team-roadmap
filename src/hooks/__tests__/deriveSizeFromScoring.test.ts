import { describe, it, expect } from 'vitest';
import { deriveSizeFromScoring } from '../useRoadmap';
import type { Project } from '../../types';

// Validates that loading existing projects re-derives `size` from the stored
// Capacity Scoring Matrix total under the CURRENT bands (utils/scoring.ts).
// This is what makes a band change apply to projects already in the database.

const base: Omit<Project, 'size' | 'scoring'> = {
  id: 'p1',
  title: 'Test',
  owner: 'Alex',
  startDate: '2026-01-01',
  endDate: '2026-03-01',
  statusColor: 'green',
  milestones: [],
};

const scored = (total: number, storedSize: Project['size']): Project => ({
  ...base,
  size: storedSize,
  scoring: { scores: {}, total },
});

describe('deriveSizeFromScoring', () => {
  it('re-sizes a stored size that disagrees with the new bands', () => {
    // The exact case the re-band targets: an all-2s project (total 14) was
    // stored as 'large' under the old bands; it must now load as 'medium'.
    const [p] = deriveSizeFromScoring([scored(14, 'large')]);
    expect(p.size).toBe('medium');
  });

  it('maps the new band boundaries from the stored total', () => {
    const cases: Array<[number, Project['size']]> = [
      [6, 'small'],
      [7, 'medium'],
      [14, 'medium'],
      [15, 'large'],
      [18, 'large'],
      [19, 'full-time'],
    ];
    for (const [total, expected] of cases) {
      const [p] = deriveSizeFromScoring([scored(total, 'small')]);
      expect(p.size, `total ${total}`).toBe(expected);
    }
  });

  it('leaves manually-sized projects (no scoring) untouched', () => {
    const legacy: Project = { ...base, size: 'large' };
    const [p] = deriveSizeFromScoring([legacy]);
    expect(p.size).toBe('large');
    expect(p).toBe(legacy); // same reference — not rewritten
  });

  it('does not mutate the input project', () => {
    const input = scored(14, 'large');
    deriveSizeFromScoring([input]);
    expect(input.size).toBe('large');
  });

  it('keeps the stored size when scoring.total is not a finite number', () => {
    // Guards the fallback (validation-failed) path against corrupt data —
    // a bad total must not silently classify a project as full-time.
    const bad = { ...base, size: 'small' as const, scoring: { scores: {}, total: NaN } };
    expect(deriveSizeFromScoring([bad as Project])[0].size).toBe('small');
    const missing = { ...base, size: 'medium' as const, scoring: { scores: {} } };
    expect(deriveSizeFromScoring([missing as unknown as Project])[0].size).toBe('medium');
  });
});
