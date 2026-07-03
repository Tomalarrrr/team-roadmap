// Embed mode — a locked, read-only presentation of the roadmap intended to be
// framed inside another page (e.g. a SharePoint "Embed" web part).
//
// Activated by an `embed` query param on the URL: `?embed`, `?embed=1`, or
// `?embed=true`. Explicitly opt out with `?embed=0` / `?embed=false` (so a
// stray param can't silently lock the main app).
//
// What it changes (see App.tsx / Toolbar.tsx):
//   - forces the view lock on and removes any way to unlock it (the vault PIN
//     dialog is never reachable), so a framed viewer cannot edit;
//   - hides editor-only toolbar controls (undo/redo, the lock toggle).
//
// This is a presentation/affordance guard, not a security boundary — the same
// caveat as the vault PIN. The database is world-readable/writable, so embed
// mode stops casual edits through the UI, nothing more.

const FALSY = new Set(['0', 'false', 'no', 'off']);

export function isEmbedMode(search: string = window.location.search): boolean {
  const params = new URLSearchParams(search);
  if (!params.has('embed')) return false;
  // `?embed` with no value → get() returns '' → treat as enabled.
  const value = (params.get('embed') ?? '').trim().toLowerCase();
  return !FALSY.has(value);
}
