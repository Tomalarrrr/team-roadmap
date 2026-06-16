import { describe, it, expect } from 'vitest';
import {
  evaluateAssignment,
  checkFit,
  supportSegments,
  type CapacityItem,
} from '../capacity';

/**
 * UAT scenarios mapped directly to the requirements:
 *  - Project must be sized L/M/S (L=2, M=1.5, S=1 slots).
 *  - Each member has 4 slots; concurrent load must never exceed 4.
 *  - Unused capacity (e.g. the 0.5 when at 3.5) surfaces as Team Support.
 *  - Over-capacity assignment is blocked, with who-else / when-free guidance.
 *
 * console.log lines produce a readable UAT report when run with `npx vitest run`.
 */

const p = (id: string, start: string, end: string, size: CapacityItem['size']): CapacityItem => ({
  id,
  startDate: start,
  endDate: end,
  size,
});

const log = (...args: unknown[]) => console.log('  ', ...args);

describe('UAT: capacity-aware project assignment', () => {
  it('Scenario 1 — Senior tries to overload someone already at 3.5', () => {
    log('Priya already holds in January: 1 Large (2.0) + 1 Medium (1.5) = 3.5 / 4');
    const board: Record<string, CapacityItem[]> = {
      Priya: [
        p('A', '2026-01-01', '2026-01-31', 'large'),
        p('B', '2026-01-01', '2026-01-31', 'medium'),
      ],
      Sam: [],
      Lee: [p('C', '2026-01-01', '2026-01-31', 'large')], // 2.0 used
    };
    const newProject = p('NEW', '2026-01-10', '2026-01-20', 'medium'); // +1.5 -> 5.0
    log('Senior assigns Priya a new Medium (1.5) overlapping mid-January...');

    const verdict = evaluateAssignment(board, newProject, 'Priya');
    log('-> Peak load would be', verdict.peakLoad, '/ 4  =>  ASSIGNMENT', verdict.fits ? 'ALLOWED' : 'BLOCKED');
    log('-> Who else can take it:', verdict.alternativeOwners.map(o => `${o.owner} (${o.freeSlots} free)`).join(', '));
    log('-> Or Priya is free from:', verdict.availableFrom);

    expect(verdict.fits).toBe(false);
    expect(verdict.peakLoad).toBe(5);
    expect(verdict.alternativeOwners.map(o => o.owner)).toEqual(['Sam', 'Lee']); // Sam most free first
    expect(verdict.availableFrom).toBe('2026-02-08'); // a week after Jan 31 blockers
  });

  it('Scenario 2 — the 0.5 gap at 3.5 surfaces as Team Support', () => {
    const priya = [
      p('A', '2026-01-01', '2026-01-31', 'large'),
      p('B', '2026-01-01', '2026-01-31', 'medium'),
    ];
    const segments = supportSegments(priya, '2026-01-01', '2026-01-31');
    log('Priya in January (load 3.5) -> support segments:');
    segments.forEach(s => log(`   ${s.startDate}..${s.endDate}: ${s.freeSlots} slot(s) Team Support`));

    const jan = segments.find(s => s.startDate === '2026-01-01');
    expect(jan?.freeSlots).toBe(0.5);
  });

  it('Scenario 3 — capacity is time-aware, not a yearly bucket', () => {
    log('Lee is fully booked in March but empty in June.');
    const board: Record<string, CapacityItem[]> = {
      Lee: [
        p('M1', '2026-03-01', '2026-03-31', 'large'),
        p('M2', '2026-03-01', '2026-03-31', 'large'), // 4.0 in March
      ],
    };
    const juneProject = p('J', '2026-06-01', '2026-06-30', 'large');
    log('Assign Lee a Large in June...');
    const verdict = evaluateAssignment(board, juneProject, 'Lee');
    log('-> June assignment', verdict.fits ? 'ALLOWED' : 'BLOCKED', '(March load is irrelevant to June)');
    expect(verdict.fits).toBe(true);
  });

  it('Scenario 4 — exactly hitting 4 is allowed; one slot more is blocked', () => {
    const lee = [p('A', '2026-02-01', '2026-02-28', 'large')]; // 2.0
    const secondLarge = p('B', '2026-02-10', '2026-02-20', 'large'); // -> 4.0 exactly
    log('Lee has 1 Large; add a second overlapping Large -> 4.0 exactly');
    expect(checkFit(lee, secondLarge).fits).toBe(true);

    const lee4 = [...lee, secondLarge];
    const oneSmallMore = p('C', '2026-02-12', '2026-02-15', 'small'); // -> 5.0
    log('Now add a Small on top of a full 4.0 -> 5.0');
    expect(checkFit(lee4, oneSmallMore).fits).toBe(false);
  });

  it('Scenario 5 — nobody else is free: only a date is offered', () => {
    log('Whole team is fully booked in January.');
    const board: Record<string, CapacityItem[]> = {
      Priya: [p('A', '2026-01-01', '2026-01-31', 'large'), p('B', '2026-01-01', '2026-01-31', 'large')],
      Sam: [p('C', '2026-01-01', '2026-01-31', 'large'), p('D', '2026-01-01', '2026-01-31', 'large')],
    };
    const newProject = p('NEW', '2026-01-05', '2026-01-15', 'medium');
    const verdict = evaluateAssignment(board, newProject, 'Priya');
    log('-> Alternatives:', verdict.alternativeOwners.length === 0 ? 'none' : verdict.alternativeOwners);
    log('-> Priya free from:', verdict.availableFrom);
    expect(verdict.fits).toBe(false);
    expect(verdict.alternativeOwners).toEqual([]);
    expect(verdict.availableFrom).toBe('2026-02-08');
  });

  it('Scenario 6 — moving an existing project does not falsely count itself', () => {
    log('Priya has one Large. We re-evaluate THAT SAME project (e.g. a drag) against Priya.');
    const board: Record<string, CapacityItem[]> = {
      Priya: [p('A', '2026-01-01', '2026-01-31', 'large')],
    };
    const verdict = evaluateAssignment(board, p('A', '2026-01-05', '2026-02-05', 'large'), 'Priya');
    log('-> Re-placement', verdict.fits ? 'ALLOWED' : 'BLOCKED', '| peak', verdict.peakLoad, '(not double-counted)');
    expect(verdict.fits).toBe(true);
    expect(verdict.peakLoad).toBe(2);
  });
});
