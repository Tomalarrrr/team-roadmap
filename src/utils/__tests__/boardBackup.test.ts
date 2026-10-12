import { describe, it, expect } from 'vitest';
import { boardBackup } from '../exportUtils';
import type { RoadmapData } from '../../types';

describe('boardBackup', () => {
  const board: RoadmapData = {
    projects: [{ id: 'p1', title: 'A', owner: 'Amy', startDate: '2026-01-01', endDate: '2026-02-01', statusColor: '#457028', size: 'small', milestones: [] }],
    teamMembers: [{ id: 'm1', name: 'Amy', jobTitle: 'PM' }],
    dependencies: [],
    leaveBlocks: [{ id: 'l1', memberId: 'm1', startDate: '2026-03-02', endDate: '2026-03-06', type: 'annual-leave', coverage: 'full' }],
    periodMarkers: [{ id: 'k1', startDate: '2026-12-21', endDate: '2027-01-04', color: 'red', label: 'Change freeze' }],
    settings: { graceDays: 3, programmes: ['EPR'] }
  };

  it('carries time away, period markers and board rules as well as the projects', () => {
    expect(boardBackup(board, '2026-10-12T09:00:00.000Z')).toEqual({ exportedAt: '2026-10-12T09:00:00.000Z', ...board });
  });
});
