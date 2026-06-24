import { describe, it, expect } from 'vitest';
import {
  evaluateAssignment,
  checkFit,
  supportSegments,
  type CapacityItem,
} from '../capacity';

/**
 * UAT scenarios mapped directly to the requirements:
 *  - Project must be sized S/M/L/Full Time (S=1, M=2, L=3, Full Time=4 slots).
 *  - Each member has 4 slots; concurrent load must never exceed 4.
 *  - Unused capacity (e.g. the 1 spare slot when at 3) surfaces as Team Support.
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
  it('Scenario 1 — Senior tries to overload someone already at 3', () => {
    log('Priya already holds in January: 1 Large (3.0) = 3 / 4');
    const board: Record<string, CapacityItem[]> = {
      Priya: [
        p('A', '2026-01-01', '2026-01-31', 'large'),
      ],
      Sam: [],
      Lee: [p('C', '2026-01-01', '2026-01-31', 'small')], // 1.0 used
    };
    const newProject = p('NEW', '2026-01-10', '2026-01-20', 'medium'); // +2 -> 5.0
    log('Senior assigns Priya a new Medium (2.0) overlapping mid-January...');

    const verdict = evaluateAssignment(board, newProject, 'Priya');
    log('-> Peak load would be', verdict.peakLoad, '/ 4  =>  ASSIGNMENT', verdict.fits ? 'ALLOWED' : 'BLOCKED');
    log('-> Who else can take it:', verdict.alternativeOwners.map(o => `${o.owner} (${o.freeSlots} free)`).join(', '));
    log('-> Or Priya is free from:', verdict.availableFrom);

    expect(verdict.fits).toBe(false);
    expect(verdict.peakLoad).toBe(5);
    expect(verdict.alternativeOwners.map(o => o.owner)).toEqual(['Sam', 'Lee']); // Sam most free first
    expect(verdict.availableFrom).toBe('2026-02-08'); // a week after Jan 31 blocker
  });

  it('Scenario 2 — the spare slot at load 3 surfaces as Team Support', () => {
    const priya = [
      p('A', '2026-01-01', '2026-01-31', 'large'), // 3
    ];
    const segments = supportSegments(priya, '2026-01-01', '2026-01-31');
    log('Priya in January (load 3) -> support segments:');
    segments.forEach(s => log(`   ${s.startDate}..${s.endDate}: ${s.freeSlots} slot(s) Team Support`));

    const jan = segments.find(s => s.startDate === '2026-01-01');
    expect(jan?.freeSlots).toBe(1);
  });

  it('Scenario 3 — capacity is time-aware, not a yearly bucket', () => {
    log('Lee is fully booked in March but empty in June.');
    const board: Record<string, CapacityItem[]> = {
      Lee: [
        p('M1', '2026-03-01', '2026-03-31', 'full-time'), // 4.0 in March (full)
      ],
    };
    const juneProject = p('J', '2026-06-01', '2026-06-30', 'large');
    log('Assign Lee a Large in June...');
    const verdict = evaluateAssignment(board, juneProject, 'Lee');
    log('-> June assignment', verdict.fits ? 'ALLOWED' : 'BLOCKED', '(March load is irrelevant to June)');
    expect(verdict.fits).toBe(true);
  });

  it('Scenario 4 — exactly hitting 4 is allowed; one slot more is blocked', () => {
    const lee = [p('A', '2026-02-01', '2026-02-28', 'large')]; // 3.0
    const topUp = p('B', '2026-02-10', '2026-02-20', 'small'); // -> 4.0 exactly
    log('Lee has 1 Large; add an overlapping Small -> 4.0 exactly');
    expect(checkFit(lee, topUp).fits).toBe(true);

    const lee4 = [...lee, topUp];
    const oneSmallMore = p('C', '2026-02-12', '2026-02-15', 'small'); // -> 5.0
    log('Now add a Small on top of a full 4.0 -> 5.0');
    expect(checkFit(lee4, oneSmallMore).fits).toBe(false);
  });

  it('Scenario 5 — nobody else is free: only a date is offered', () => {
    log('Whole team is fully booked in January.');
    const board: Record<string, CapacityItem[]> = {
      Priya: [p('A', '2026-01-01', '2026-01-31', 'full-time')], // 4.0 (full)
      Sam: [p('C', '2026-01-01', '2026-01-31', 'full-time')], // 4.0 (full)
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
    expect(verdict.peakLoad).toBe(3);
  });
});
