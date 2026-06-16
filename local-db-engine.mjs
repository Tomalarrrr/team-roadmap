// Pure, in-memory implementation of the subset of Firebase Realtime Database
// REST semantics the roadmap app relies on. Kept separate from the HTTP server
// (local-backend.mjs) so the behaviour can be unit-tested in isolation — see
// src/__tests__/localDbEngine.test.ts.
//
// The contract that MUST match real Firebase RTDB:
//   GET   path            -> value at path, or null for a miss
//   PUT   path value      -> overwrite the subtree at path (null deletes)
//   PATCH path {k: v, …}  -> multi-path update: each key may itself be a
//                            slash-delimited deep path *relative to path*, set
//                            independently; a null value deletes that path.
// The roadmap app depends on the PATCH deep-key behaviour: every add/delete op
// sends batchUpdate({ "projects/<id>": {...}, "dependencies/<id>": null, … })
// as a single PATCH to /roadmap.

/** Split "/roadmap/projects/abc.json" -> ["roadmap","projects","abc"]. */
export function segments(pathname) {
  return pathname
    .replace(/\.json$/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
}

export function createDbEngine(initial = {}) {
  let db = initial && typeof initial === 'object' ? initial : {};

  function getAt(parts) {
    let node = db;
    for (const p of parts) {
      if (node == null || typeof node !== 'object') return null;
      node = node[p];
    }
    return node === undefined ? null : node;
  }

  function setAt(parts, value) {
    if (parts.length === 0) {
      db = value && typeof value === 'object' ? value : {};
      return;
    }
    let node = db;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (node[p] == null || typeof node[p] !== 'object') node[p] = {};
      node = node[p];
    }
    const last = parts[parts.length - 1];
    if (value === null) delete node[last];
    else node[last] = value;
  }

  // Emulate Firebase RTDB's multi-path update: each key in the patch body may be
  // a slash-delimited deep path relative to `parts`, applied independently (a
  // `null` value deletes that path). Keys without slashes are a shallow field
  // merge. A non-object body replaces the value wholesale (matches PUT).
  function patchAt(parts, obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      setAt(parts, obj);
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      const keySegments = key
        .split('/')
        .filter(Boolean)
        .map(decodeURIComponent);
      setAt([...parts, ...keySegments], value);
    }
  }

  return {
    get: (parts) => getAt(parts),
    set: (parts, value) => setAt(parts, value),
    patch: (parts, obj) => patchAt(parts, obj),
    snapshot: () => db,
  };
}
