import { describe, it, expect } from 'vitest';
import { firebaseSnapshotToRoadmapData, roadmapDataToFirebaseFormat } from '../firebaseConversions';
import { colorSchema } from '../../schemas/primitives';

// End-to-end regression test for the "edit doesn't save" bug.
//
// Reproduces the exact data shape that caused it: a Firebase snapshot whose
// colors are rgb() strings (the old seed/import format). Before the fix these
// flowed unchanged into app state, so the hex-only form schema rejected them on
// save and the write was silently dropped. The read boundary must now hand the
// rest of the app canonical hex that the schema accepts.
const RGB_SNAPSHOT = {
  projects: {
    'p-1': {
      id: 'p-1',
      title: 'Patient Portal',
      owner: 'Priya Patel',
      startDate: '2026-04-01',
      endDate: '2026-08-15',
      statusColor: 'rgb(139, 92, 246)',
      milestones: {
        'm-1': {
          id: 'm-1',
          title: 'Discovery',
          startDate: '2026-04-01',
          endDate: '2026-04-30',
          tags: [],
          statusColor: 'rgb(37, 99, 235)',
        },
      },
    },
  },
  teamMembers: {
    'tm-1': { id: 'tm-1', name: 'Priya Patel', jobTitle: 'UX', nameColor: 'rgb(124, 58, 237)', order: 0 },
    'tm-2': { id: 'tm-2', name: 'Tom Becker', jobTitle: 'Data', order: 1 }, // no nameColor
  },
  dependencies: {},
  leaveBlocks: {},
  periodMarkers: {},
};

describe('color normalization at the Firebase read boundary', () => {
  const data = firebaseSnapshotToRoadmapData(RGB_SNAPSHOT);

  it('converts project + milestone rgb() colors to schema-valid hex', () => {
    const project = data.projects[0];
    expect(colorSchema.safeParse(project.statusColor).success).toBe(true);
    expect(project.statusColor).toBe('#8B5CF6');

    const milestone = project.milestones[0];
    expect(colorSchema.safeParse(milestone.statusColor).success).toBe(true);
    expect(milestone.statusColor).toBe('#2563EB');
  });

  it('converts member nameColor to hex but leaves missing nameColor undefined', () => {
    const [priya, tom] = data.teamMembers;
    expect(priya.nameColor).toBe('#7C3AED');
    expect(colorSchema.safeParse(priya.nameColor).success).toBe(true);
    expect(tom.nameColor).toBeUndefined(); // must not invent a color
  });

  it('is idempotent: re-converting already-hex data is stable (no poll churn)', () => {
    // Round-trip back to Firebase format, then read again — colors must not drift.
    const round2 = firebaseSnapshotToRoadmapData(roadmapDataToFirebaseFormat(data));
    expect(round2.projects[0].statusColor).toBe('#8B5CF6');
    expect(round2.projects[0].milestones[0].statusColor).toBe('#2563EB');
    expect(round2.teamMembers.find(m => m.id === 'tm-1')?.nameColor).toBe('#7C3AED');
    // Serialized form is identical on the second pass → the 5s poll de-dupe
    // won't see a phantom change every tick.
    expect(JSON.stringify(round2)).toBe(JSON.stringify(data));
  });
});
