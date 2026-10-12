// Shallow "which top-level fields changed" diff.
//
// Used to turn an accumulated optimistic edit back into a minimal field-level
// patch: writing only the keys that actually changed (vs a pre-edit snapshot)
// means a concurrent edit to *other* fields of the same record isn't clobbered.
// Comparison is by reference/identity, which is exactly right for our state —
// unchanged nested values keep their reference, changed ones get a new one.

/**
 * Build the `updates` payload that reverts an edit back to `before`.
 *
 * Only the keys the edit actually changed are carried. An undo may run long
 * after the edit, and by then a colleague can have changed other fields of the
 * same record; a payload holding the whole pre-edit record would put those back
 * too. A key the edit wrote with the value it already had is left out for the
 * same reason: the edit form submits every field, changed or not.
 *
 * Reverting goes through a MERGING update (`{...existing, ...updates}`), so a
 * key that's simply absent from `updates` keeps its post-edit value. Undoing an
 * edit that *introduced* a field therefore silently leaves that field set — e.g.
 * ticking `epr` on a project created before that field existed, then undoing.
 * Such a key is carried explicitly, as `undefined`. changedFields then turns
 * that undefined into a null, which a field-level Firebase PATCH treats as
 * "delete this path".
 *
 * Redo is the same call the other way round: `revertPatch(after, undoPatch)`
 * names the same keys with the values the edit wrote.
 */
export function revertPatch<T extends object>(before: T, written: Partial<T>): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(written) as (keyof T)[]) {
    if (before[key] !== written[key]) patch[key] = before[key];
  }
  return patch;
}

/**
 * The fields of a submitted form that differ in value from the record the form
 * was opened on. A form hands back every field, each array and object rebuilt,
 * so comparing by reference would call them all changed and write the lot over
 * whatever a colleague saved while the form was open.
 */
export function valueChanges<T extends object>(opened: T, submitted: Partial<T>): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(submitted) as (keyof T)[]) {
    if (JSON.stringify(opened[key]) !== JSON.stringify(submitted[key])) changes[key] = submitted[key];
  }
  return changes;
}

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
