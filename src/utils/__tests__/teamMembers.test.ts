import { describe, it, expect } from 'vitest';
import { leaversLast, dimsLeavers, ownerRenamePaths, memberOrderPaths, isNameTaken } from '../teamMembers';
import { INITIAL_FILTERS } from '../projectFilters';
import type { Project, TeamMember } from '../../types';

const member = (id: string, left?: boolean): TeamMember => ({ id, name: id, jobTitle: 'PM', left });

describe('leaversLast', () => {
  it('moves leavers to the bottom and keeps the saved order within each group', () => {
    const ordered = leaversLast([member('a', true), member('b'), member('c', true), member('d')]);
    expect(ordered.map(m => m.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('leaves a team with no leavers in its saved order', () => {
    expect(leaversLast([member('a'), member('b', false)]).map(m => m.id)).toEqual(['a', 'b']);
  });
});

describe('dimsLeavers', () => {
  it('greys leavers with no status filter', () => {
    expect(dimsLeavers(INITIAL_FILTERS)).toBe(true);
  });

  it('shows leavers at full strength when the only status filter is Complete', () => {
    expect(dimsLeavers({ ...INITIAL_FILTERS, statuses: ['complete'] })).toBe(false);
  });

  it('keeps greying when Complete is one of several statuses, or a different one', () => {
    expect(dimsLeavers({ ...INITIAL_FILTERS, statuses: ['complete', 'on-track'] })).toBe(true);
    expect(dimsLeavers({ ...INITIAL_FILTERS, statuses: ['on-track'] })).toBe(true);
  });
});

describe('ownerRenamePaths', () => {
  const project = (id: string, owner: string): Project => ({
    id, owner, title: id, startDate: '2026-01-01', endDate: '2026-02-01', statusColor: '#457028', size: 'medium', milestones: []
  });

  it('moves every project of the renamed person, and nobody else\'s', () => {
    const projects = [project('p1', 'Amy'), project('p2', 'Ben'), project('p3', 'Amy')];
    expect(ownerRenamePaths(projects, 'Amy', 'Amy Jones')).toEqual({
      'projects/p1/owner': 'Amy Jones',
      'projects/p3/owner': 'Amy Jones'
    });
  });

  it('has nothing to move for someone with no projects', () => {
    expect(ownerRenamePaths([project('p1', 'Ben')], 'Amy', 'Amy Jones')).toEqual({});
  });
});

describe('isNameTaken', () => {
  it('matches regardless of case and outer spaces', () => {
    expect(isNameTaken(' amy ', ['Ben', 'Amy'])).toBe(true);
  });

  it('does not match a different or longer name', () => {
    expect(isNameTaken('Amy Jones', ['Ben', 'Amy'])).toBe(false);
    expect(isNameTaken('Amy', [])).toBe(false);
  });
});

describe('memberOrderPaths', () => {
  const placed = (id: string, order?: number): TeamMember => ({
    id, name: `Name ${id}`, jobTitle: 'PM', left: true, order
  });

  it('writes only the order of the people whose position changed', () => {
    const moved = [placed('a', 0), placed('c', 2), placed('b', 1), placed('d', 3)];
    expect(memberOrderPaths(moved)).toEqual({
      'teamMembers/c/order': 1,
      'teamMembers/b/order': 2
    });
  });

  it('renumbers everyone between the two ends of a longer move', () => {
    const moved = [placed('d', 3), placed('a', 0), placed('b', 1), placed('c', 2)];
    expect(memberOrderPaths(moved)).toEqual({
      'teamMembers/d/order': 0,
      'teamMembers/a/order': 1,
      'teamMembers/b/order': 2,
      'teamMembers/c/order': 3
    });
  });

  it('gives a number to someone saved without one, even where they already sit', () => {
    expect(memberOrderPaths([placed('a', 0), placed('b')])).toEqual({ 'teamMembers/b/order': 1 });
  });

  it('has nothing to write when everyone already holds their position', () => {
    expect(memberOrderPaths([placed('a', 0), placed('b', 1)])).toEqual({});
  });
});
