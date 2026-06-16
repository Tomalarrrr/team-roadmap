// Shallow "which top-level fields changed" diff.
//
// Used to turn an accumulated optimistic edit back into a minimal field-level
// patch: writing only the keys that actually changed (vs a pre-edit snapshot)
// means a concurrent edit to *other* fields of the same record isn't clobbered.
// Comparison is by reference/identity, which is exactly right for our state —
// unchanged nested values keep their reference, changed ones get a new one.

export function changedFields<T extends object>(before: T | undefined, after: T): Partial<T> {
  if (!before) return { ...after };
  const diff: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (before[key] !== after[key]) {
      diff[key] = after[key];
    }
  }
  return diff;
}
