import { describe, it, expect } from 'vitest';
import { groupByProgramme, newProgrammeName } from '../programmes';
import { boardRules, DEFAULT_GRACE_DAYS } from '../boardSettings';
import { RECOVERY_BUFFER_DAYS } from '../capacity';
import type { Project } from '../../types';

const project = (title: string, startDate: string, programme?: string): Project => ({
  id: title,
  title,
  owner: 'A',
  startDate,
  endDate: '2026-12-31',
  statusColor: '#000000',
  size: 'small',
  milestones: [],
  ...(programme && { programme }),
});

describe('groupByProgramme', () => {
  const projects = [
    project('late', '2026-06-01', 'Estates'),
    project('loose', '2026-01-01'),
    project('early', '2026-02-01', 'Estates'),
    project('clinic', '2026-03-01', 'Clinical'),
    project('retired', '2026-04-01', 'Old name'),
  ];

  it('follows the list order, then off-list programmes, then unassigned work', () => {
    const groups = groupByProgramme(projects, ['Clinical', 'Estates', 'Empty']);
    expect(groups.map(g => g.programme)).toEqual(['Clinical', 'Estates', 'Old name', null]);
  });

  it('orders each group by start date and loses no project', () => {
    const groups = groupByProgramme(projects, ['Clinical', 'Estates']);
    expect(groups[1].projects.map(p => p.title)).toEqual(['early', 'late']);
    expect(groups.flatMap(g => g.projects)).toHaveLength(projects.length);
  });

  it('has no unassigned group when every project has a programme', () => {
    expect(groupByProgramme([project('a', '2026-01-01', 'Clinical')], ['Clinical']).map(g => g.programme)).toEqual(['Clinical']);
  });
});

describe('newProgrammeName', () => {
  it('tidies spacing', () => {
    expect(newProgrammeName('  Digital   front  door ', [])).toBe('Digital front door');
  });

  it('rejects a blank name and a duplicate in any case', () => {
    expect(newProgrammeName('   ', [])).toBeNull();
    expect(newProgrammeName('clinical', ['Clinical'])).toBeNull();
  });
});

describe('boardRules', () => {
  it('falls back to the stated defaults when nothing is stored', () => {
    expect(boardRules(undefined)).toEqual({ graceDays: DEFAULT_GRACE_DAYS, recoveryDays: RECOVERY_BUFFER_DAYS, programmes: [] });
  });

  it('keeps a stored zero rather than treating it as unset', () => {
    expect(boardRules({ graceDays: 0, recoveryDays: 0 })).toMatchObject({ graceDays: 0, recoveryDays: 0 });
  });

  it('uses what the board has stored', () => {
    expect(boardRules({ graceDays: 14, programmes: ['Clinical'] })).toEqual({
      graceDays: 14,
      recoveryDays: RECOVERY_BUFFER_DAYS,
      programmes: ['Clinical'],
    });
  });
});
