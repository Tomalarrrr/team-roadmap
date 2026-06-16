import { describe, it, expect } from 'vitest';
// The local dev backend (local-backend.mjs) stands in for Firebase RTDB so the
// app can run/test with no Firebase project. Its DB engine MUST match real RTDB
// REST semantics — especially PATCH's multi-path deep-key merge, which every
// add/delete op depends on. A regression here silently corrupts saves locally
// (literal "projects/<id>" keys instead of nested writes), so it is pinned here.
// @ts-expect-error — .mjs dev script, no type declarations needed for this test.
import { createDbEngine, segments } from '../../local-db-engine.mjs';

type Engine = {
  get: (parts: string[]) => unknown;
  set: (parts: string[], value: unknown) => void;
  patch: (parts: string[], obj: unknown) => void;
  snapshot: () => Record<string, unknown>;
};

const seed = () =>
  createDbEngine({
    roadmap: {
      projects: {
        'p-1': { id: 'p-1', title: 'Existing', owner: 'Sarah', startDate: '2026-04-01', endDate: '2026-05-01' },
      },
      dependencies: { 'd-1': { id: 'd-1', fromProjectId: 'p-1', toProjectId: 'p-2' } },
    },
  }) as Engine;

describe('segments', () => {
  it('splits, strips .json, and decodes', () => {
    expect(segments('/roadmap/projects/abc.json')).toEqual(['roadmap', 'projects', 'abc']);
    expect(segments('/roadmap/projects/a%20b.json')).toEqual(['roadmap', 'projects', 'a b']);
    expect(segments('/')).toEqual([]);
  });
});

describe('GET semantics', () => {
  it('returns the value at a path and null for a miss', () => {
    const e = seed();
    expect((e.get(['roadmap', 'projects', 'p-1']) as { title: string }).title).toBe('Existing');
    expect(e.get(['roadmap', 'projects', 'nope'])).toBeNull();
    expect(e.get(['roadmap', 'nothing', 'deep'])).toBeNull();
  });
});

describe('PUT semantics', () => {
  it('overwrites a subtree, and null deletes it', () => {
    const e = seed();
    e.set(['roadmap', 'projects', 'p-1'], { id: 'p-1', title: 'Replaced' });
    expect(e.get(['roadmap', 'projects', 'p-1'])).toEqual({ id: 'p-1', title: 'Replaced' });
    e.set(['roadmap', 'projects', 'p-1'], null);
    expect(e.get(['roadmap', 'projects', 'p-1'])).toBeNull();
  });
});

describe('PATCH multi-path deep-key semantics (the save-path contract)', () => {
  it('nests a slash-keyed add under the correct subtree (addProject)', () => {
    const e = seed();
    // Exactly what batchUpdate sends for addProject.
    e.patch(['roadmap'], { 'projects/p-2': { id: 'p-2', title: 'New' } });
    expect((e.get(['roadmap', 'projects', 'p-2']) as { title: string }).title).toBe('New');
    // No corrupt literal "projects/p-2" key at the roadmap level.
    expect(Object.keys(e.get(['roadmap']) as object)).not.toContain('projects/p-2');
  });

  it('adds a deeply-nested milestone via slash key (addMilestone)', () => {
    const e = seed();
    e.patch(['roadmap'], { 'projects/p-1/milestones/m-1': { id: 'm-1', title: 'M1' } });
    expect((e.get(['roadmap', 'projects', 'p-1', 'milestones', 'm-1']) as { title: string }).title).toBe('M1');
  });

  it('applies a multi-path delete atomically (deleteProject + orphan dep cleanup)', () => {
    const e = seed();
    e.patch(['roadmap'], { 'projects/p-1': null, 'dependencies/d-1': null });
    expect(e.get(['roadmap', 'projects', 'p-1'])).toBeNull();
    expect(e.get(['roadmap', 'dependencies', 'd-1'])).toBeNull();
  });

  it('shallow-merges non-slash keys without clobbering siblings (updateProject field write)', () => {
    const e = seed();
    e.patch(['roadmap', 'projects', 'p-1'], { title: 'Renamed', endDate: '2026-06-01' });
    expect(e.get(['roadmap', 'projects', 'p-1'])).toEqual({
      id: 'p-1', title: 'Renamed', owner: 'Sarah', startDate: '2026-04-01', endDate: '2026-06-01',
    });
  });

  it('leaves unrelated subtrees untouched after a slash-keyed write', () => {
    const e = seed();
    e.patch(['roadmap'], { 'projects/p-2': { id: 'p-2' } });
    expect((e.get(['roadmap', 'projects', 'p-1']) as { title: string }).title).toBe('Existing');
    expect((e.get(['roadmap', 'dependencies', 'd-1']) as { id: string }).id).toBe('d-1');
  });

  it('decodes percent-encoded id segments in slash keys (proxy encodes ids)', () => {
    const e = seed();
    e.patch(['roadmap'], { 'projects/a%20b': { id: 'a b', title: 'Spaced' } });
    expect((e.get(['roadmap', 'projects', 'a b']) as { title: string }).title).toBe('Spaced');
  });
});
