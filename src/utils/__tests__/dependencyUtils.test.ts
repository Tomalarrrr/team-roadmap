import { describe, it, expect } from 'vitest';
import { wouldCreateCycle, validateDependency, getAffectedDependencies } from '../dependencyUtils';
import type { Dependency } from '../../types';

const dep = (id: string, from: string, to: string, extra: Partial<Dependency> = {}): Dependency => ({
  id,
  fromProjectId: from,
  toProjectId: to,
  type: 'finish-to-start',
  ...extra,
});

describe('wouldCreateCycle', () => {
  it('flags a direct self-dependency', () => {
    expect(wouldCreateCycle([], 'P1', 'P1')).toBe(true);
  });

  it('allows an acyclic edge', () => {
    expect(wouldCreateCycle([dep('d1', 'P1', 'P2')], 'P2', 'P3')).toBe(false);
  });

  it('flags a direct 2-cycle (P1→P2 then P2→P1)', () => {
    expect(wouldCreateCycle([dep('d1', 'P1', 'P2')], 'P2', 'P1')).toBe(true);
  });

  it('flags a transitive cycle (P1→P2→P3 then P3→P1)', () => {
    const deps = [dep('d1', 'P1', 'P2'), dep('d2', 'P2', 'P3')];
    expect(wouldCreateCycle(deps, 'P3', 'P1')).toBe(true);
  });

  it('does not falsely flag a diamond (P1→P2, P1→P3, then P2→P4)', () => {
    const deps = [dep('d1', 'P1', 'P2'), dep('d2', 'P1', 'P3')];
    expect(wouldCreateCycle(deps, 'P2', 'P4')).toBe(false);
  });

  it('detects a cross-namespace cycle routed through a milestone-anchored edge (regression: C1)', () => {
    // P1 → P2 (project), plus an existing milestone-anchored edge whose PROJECTS
    // are P2 → P1. Adding/representing these forms a real P1↔P2 project cycle
    // that a milestone-keyed graph would have missed.
    const existing = [dep('d1', 'P2', 'P1', { fromMilestoneId: 'm1' })];
    expect(wouldCreateCycle(existing, 'P1', 'P2')).toBe(true);
  });
});

describe('validateDependency', () => {
  it('rejects an exact duplicate', () => {
    const deps = [dep('d1', 'P1', 'P2')];
    expect(validateDependency(deps, 'P1', 'P2')).toEqual({
      valid: false,
      error: 'This dependency already exists',
    });
  });

  it('treats different milestone anchors between the same projects as distinct', () => {
    const deps = [dep('d1', 'P1', 'P2', { fromMilestoneId: 'm1' })];
    // Same project pair, different milestone anchor → not a duplicate.
    expect(validateDependency(deps, 'P1', 'P2', 'm2').valid).toBe(true);
  });

  it('rejects a dependency that would create a cycle', () => {
    const deps = [dep('d1', 'P1', 'P2')];
    expect(validateDependency(deps, 'P2', 'P1')).toEqual({
      valid: false,
      error: 'This would create a circular dependency',
    });
  });

  it('accepts a valid new dependency', () => {
    expect(validateDependency([dep('d1', 'P1', 'P2')], 'P2', 'P3')).toEqual({ valid: true });
  });
});

describe('getAffectedDependencies', () => {
  const deps = [
    dep('d1', 'P1', 'P2'),
    dep('d2', 'P2', 'P3', { fromMilestoneId: 'm1' }),
    dep('d3', 'P3', 'P4'),
  ];

  it('returns all dependencies touching a project', () => {
    expect(getAffectedDependencies(deps, 'P2').map(d => d.id)).toEqual(['d1', 'd2']);
  });

  it('scopes to a specific milestone anchor when given', () => {
    expect(getAffectedDependencies(deps, 'P2', 'm1').map(d => d.id)).toEqual(['d2']);
  });
});
