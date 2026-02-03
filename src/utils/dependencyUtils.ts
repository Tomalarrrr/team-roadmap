import type { Dependency } from '../types';

/**
 * Checks if adding a new dependency would create a circular dependency.
 * Uses depth-first search to detect cycles in the dependency graph.
 *
 * @param dependencies - Current list of dependencies
 * @param fromId - Source project/milestone ID
 * @param toId - Target project/milestone ID
 * @param fromProjectId - Source project ID (for milestones)
 * @param toProjectId - Target project ID (for milestones)
 * @returns true if adding this dependency would create a cycle
 */
export function wouldCreateCycle(
  dependencies: Dependency[],
  fromId: string,
  toId: string,
  fromProjectId?: string,
  toProjectId?: string
): boolean {
  // Self-dependency check
  if (fromId === toId) return true;

  // Build adjacency list for the dependency graph
  const graph = new Map<string, Set<string>>();

  dependencies.forEach(dep => {
    const source = dep.fromMilestoneId || dep.fromProjectId;
    const target = dep.toMilestoneId || dep.toProjectId;

    if (!graph.has(source)) {
      graph.set(source, new Set());
    }
    graph.get(source)!.add(target);
  });

  // Add the new edge temporarily
  if (!graph.has(fromId)) {
    graph.set(fromId, new Set());
  }
  graph.get(fromId)!.add(toId);

  // Check if there's a path from toId back to fromId (which would create a cycle)
  return hasPath(graph, toId, fromId);
}

/**
 * DFS to check if there's a path from start to end in the directed graph
 */
function hasPath(
  graph: Map<string, Set<string>>,
  start: string,
  end: string,
  visited: Set<string> = new Set()
): boolean {
  if (start === end) return true;
  if (visited.has(start)) return false;

  visited.add(start);
  const neighbors = graph.get(start);

  if (!neighbors) return false;

  for (const neighbor of neighbors) {
    if (hasPath(graph, neighbor, end, visited)) {
      return true;
    }
  }

  return false;
}

/**
 * Gets all dependencies that would be affected by removing a project/milestone
 */
export function getAffectedDependencies(
  dependencies: Dependency[],
  projectId: string,
  milestoneId?: string
): Dependency[] {
  return dependencies.filter(dep => {
    if (milestoneId) {
      // Milestone dependencies
      return (
        (dep.fromProjectId === projectId && dep.fromMilestoneId === milestoneId) ||
        (dep.toProjectId === projectId && dep.toMilestoneId === milestoneId)
      );
    } else {
      // Project dependencies (including all its milestones)
      return dep.fromProjectId === projectId || dep.toProjectId === projectId;
    }
  });
}

/**
 * Validates a dependency before creation
 */
export function validateDependency(
  dependencies: Dependency[],
  fromProjectId: string,
  toProjectId: string,
  fromMilestoneId?: string,
  toMilestoneId?: string
): { valid: boolean; error?: string } {
  // Check for duplicate dependency
  const exists = dependencies.some(dep =>
    dep.fromProjectId === fromProjectId &&
    dep.toProjectId === toProjectId &&
    dep.fromMilestoneId === fromMilestoneId &&
    dep.toMilestoneId === toMilestoneId
  );

  if (exists) {
    return { valid: false, error: 'This dependency already exists' };
  }

  // Check for circular dependency
  const fromId = fromMilestoneId || fromProjectId;
  const toId = toMilestoneId || toProjectId;

  if (wouldCreateCycle(dependencies, fromId, toId, fromProjectId, toProjectId)) {
    return { valid: false, error: 'This would create a circular dependency' };
  }

  return { valid: true };
}
