import { describe, it, expect } from 'vitest';
import { changedFields, revertPatch, valueChanges } from '../objectDiff';

// The merge an undo goes through (useRoadmap.updateProject).
const applyUpdate = <T extends object>(existing: T, updates: Partial<T>): T => ({ ...existing, ...updates });

describe('revertPatch', () => {
  it('names a field the edit introduced so the merge actually clears it', () => {
    // Regression: ticking `epr` on a project created before that field existed,
    // then undoing, used to leave epr set — the inverse simply omitted the key,
    // so the merge kept the new value.
    const before: { id: string; title: string; epr?: boolean } = { id: '1', title: 'Legacy' };
    const written = { title: 'Legacy', epr: true };
    const after = applyUpdate(before, written);
    expect(after.epr).toBe(true);

    const undone = applyUpdate(after, revertPatch(before, written));
    expect(undone.epr).toBeUndefined();
    // ...and the resulting Firebase patch deletes the path rather than dropping it.
    expect(changedFields(after, undone)).toEqual({ epr: null });
  });

  it('leaves an existing field to the normal merge', () => {
    const before = { id: '1', epr: false };
    const undone = applyUpdate({ id: '1', epr: true }, revertPatch(before, { epr: true }));
    expect(undone.epr).toBe(false);
  });

  it('does not invent keys the edit never wrote', () => {
    expect(revertPatch({ a: 1 }, { a: 2 })).toEqual({ a: 1 });
    expect(Object.keys(revertPatch({ a: 1 }, { a: 2 }))).toEqual(['a']);
  });

  describe('against a colleague editing the same record', () => {
    type Row = { id: string; title: string; status: string; milestones: string[]; epr?: boolean };
    const before: Row = { id: '1', title: 'Old', status: 'on-track', milestones: ['m1'] };
    // The edit form submits every field; only title and epr differ here.
    const written: Partial<Row> = { title: 'New', status: 'on-track', epr: true };
    const after = applyUpdate(before, written);
    const undoPatch = revertPatch(before, written);
    const redoPatch = revertPatch(after, undoPatch);
    // What a poll brings in before the undo: someone else moved the status and
    // added a milestone.
    const theirs = { status: 'at-risk', milestones: ['m1', 'm2'] };

    it('undo carries only the keys the edit changed', () => {
      expect(Object.keys(undoPatch).sort()).toEqual(['epr', 'title']);
      expect(undoPatch).toEqual({ title: 'Old', epr: undefined });
    });

    it('undo leaves their later change to other fields in place', () => {
      const current = applyUpdate(after, theirs);
      const undone = applyUpdate(current, undoPatch);
      expect(undone).toEqual({ id: '1', title: 'Old', status: 'at-risk', milestones: ['m1', 'm2'], epr: undefined });
      expect(changedFields(current, undone)).toEqual({ title: 'Old', epr: null });
    });

    it('redo carries the same keys with the values the edit wrote', () => {
      expect(Object.keys(redoPatch).sort()).toEqual(['epr', 'title']);
      expect(redoPatch).toEqual({ title: 'New', epr: true });
    });

    it('redo leaves their change in place too', () => {
      const current = applyUpdate(applyUpdate(applyUpdate(after, theirs), undoPatch), { status: 'off-track' });
      const redone = applyUpdate(current, redoPatch);
      expect(redone).toEqual({ id: '1', title: 'New', status: 'off-track', milestones: ['m1', 'm2'], epr: true });
      expect(changedFields(current, redone)).toEqual({ title: 'New', epr: true });
    });

    it('redo of an edit that cleared a field clears it again', () => {
      const tagged: Row = { ...before, epr: true };
      const undo = revertPatch(tagged, { epr: undefined });
      expect(undo).toEqual({ epr: true });
      const redo = revertPatch(applyUpdate(tagged, { epr: undefined }), undo);
      expect(Object.keys(redo)).toEqual(['epr']);
      expect(changedFields(tagged, applyUpdate(tagged, redo))).toEqual({ epr: null });
    });
  });
});

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

  it('emits null for a field that was removed (so the PATCH deletes it)', () => {
    const before = { title: 'A', label: 'urgent' } as { title: string; label?: string };
    const after = { title: 'A' } as { title: string; label?: string };
    expect(changedFields(before, after)).toEqual({ label: null });
  });

  it('emits null for a field explicitly cleared to undefined', () => {
    const before = { title: 'A', label: 'urgent' } as { title: string; label?: string };
    const after = { title: 'A', label: undefined } as { title: string; label?: string };
    expect(changedFields(before, after)).toEqual({ label: null });
  });

  it('does not emit a field that was absent in both', () => {
    const before = { title: 'A', label: undefined } as { title: string; label?: string };
    const after = { title: 'B', label: undefined } as { title: string; label?: string };
    expect(changedFields(before, after)).toEqual({ title: 'B' });
  });
});

describe('valueChanges', () => {
  const opened = { title: 'A', tags: ['x', 'y'], scoring: { total: 6 }, epr: true as boolean | undefined };

  it('ignores arrays and objects the form rebuilt with the same contents', () => {
    const submitted = { title: 'B', tags: ['x', 'y'], scoring: { total: 6 }, epr: true };
    expect(valueChanges(opened, submitted)).toEqual({ title: 'B' });
  });

  it('keeps a nested value that really changed', () => {
    expect(valueChanges(opened, { title: 'A', tags: ['x'] })).toEqual({ tags: ['x'] });
  });

  it('keeps a field the form cleared', () => {
    const changes = valueChanges(opened, { epr: undefined });
    expect(Object.keys(changes)).toEqual(['epr']);
    expect(changes.epr).toBeUndefined();
  });

  it('has nothing to save when the form is submitted untouched', () => {
    expect(valueChanges(opened, { ...opened, tags: [...opened.tags] })).toEqual({});
  });
});
