import { describe, it, expect } from 'vitest';
import { changedFields } from '../objectDiff';

describe('changedFields', () => {
  it('returns only the keys whose values changed', () => {
    const before = { a: 1, b: 'x', c: true };
    const after = { a: 1, b: 'y', c: true };
    expect(changedFields(before, after)).toEqual({ b: 'y' });
  });

  it('returns an empty object when nothing changed', () => {
    const before = { a: 1, b: 'x' };
    const after = { a: 1, b: 'x' };
    expect(changedFields(before, after)).toEqual({});
  });

  it('returns a shallow copy of all fields when there is no prior snapshot', () => {
    const after = { a: 1, b: 'x' };
    const result = changedFields(undefined, after);
    expect(result).toEqual({ a: 1, b: 'x' });
    expect(result).not.toBe(after);
  });

  it('compares nested values by reference (unchanged ref is excluded)', () => {
    const shared = [{ id: 'm1' }];
    const before = { title: 'A', milestones: shared };
    const after = { title: 'B', milestones: shared }; // same array ref
    expect(changedFields(before, after)).toEqual({ title: 'B' });
  });

  it('includes a nested field when its reference changed', () => {
    const before = { title: 'A', milestones: [{ id: 'm1' }] };
    const after = { title: 'A', milestones: [{ id: 'm1' }, { id: 'm2' }] };
    expect(changedFields(before, after)).toEqual({ milestones: after.milestones });
  });
});
