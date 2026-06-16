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
  // Walk the union of keys so a field that was *removed* (present in `before`,
  // gone or cleared to undefined in `after`) is also captured. Such a field is
  // emitted as null — a field-level Firebase PATCH deletes a path set to null,
  // whereas undefined would be stripped by sanitizeForFirebase and the removal
  // silently lost.
  const keys = new Set<keyof T>([
    ...(Object.keys(before) as (keyof T)[]),
    ...(Object.keys(after) as (keyof T)[]),
  ]);
  for (const key of keys) {
    const afterVal = after[key];
    if (before[key] === afterVal) continue;
    diff[key] = (afterVal === undefined ? null : afterVal) as T[keyof T];
  }
  return diff;
}
