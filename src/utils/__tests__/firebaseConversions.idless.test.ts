import { describe, it, expect } from 'vitest';
import { arrayToKeyedObject, roadmapDataToFirebaseFormat } from '../firebaseConversions';
import type { RoadmapData } from '../../types';

describe('arrayToKeyedObject id preservation', () => {
  it('mints an id for an id-less item instead of dropping it', () => {
    const arr = [{ id: 'a', v: 1 }, { id: '', v: 2 }] as { id: string; v: number }[];
    const result = arrayToKeyedObject(arr);
    const keys = Object.keys(result);
    expect(keys).toHaveLength(2); // neither item lost
    // The id-less item kept its data and gained an id matching its key.
    const minted = Object.values(result).find(x => x.v === 2)!;
    expect(minted.id).toBeTruthy();
    expect(result[minted.id]).toBe(minted);
  });

  it('skips only null/undefined holes', () => {
    const arr = [null, { id: 'a', v: 1 }, undefined] as unknown as { id: string; v: number }[];
    expect(Object.keys(arrayToKeyedObject(arr))).toEqual(['a']);
  });
});

describe('roadmapDataToFirebaseFormat id preservation', () => {
  it('does not drop a project that is missing its id', () => {
    const data = {
      projects: [
        { id: 'p1', title: 'Has id', owner: 'A', startDate: '2026-01-01', endDate: '2026-01-10', statusColor: '#00aa00', size: 'small', milestones: [] },
        // Malformed project with no id — must be preserved, not silently lost.
        { id: '', title: 'No id', owner: 'B', startDate: '2026-02-01', endDate: '2026-02-10', statusColor: '#00aa00', size: 'small', milestones: [] },
      ],
      teamMembers: [],
      dependencies: [],
      leaveBlocks: [],
      periodMarkers: [],
    } as unknown as RoadmapData;

    const fb = roadmapDataToFirebaseFormat(data);
    const projects = fb.projects as Record<string, { title: string }>;
    const titles = Object.values(projects).map(p => p.title).sort();
    expect(titles).toEqual(['Has id', 'No id']);
  });
});
