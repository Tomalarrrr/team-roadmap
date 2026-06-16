import type { Dependency } from '../types';

/**
 * Checks if adding a new dependency would create a circular dependency.
 * Uses depth-first search to detect cycles in the dependency graph.
 *
 * A dependency is fundamentally a PROJECT-ordering constraint: even a
 * milestone-anchored edge means its source project must precede its target
 * project. So the cycle graph is keyed purely on project ids. Keying on a mix of
 * milestone and project ids (as an earlier version did) left the two namespaces
 * disconnected, so a cross-namespace cycle — e.g. P1→P2 plus a milestone edge
 * P2.m→P1 — went undetected. Project-keying closes that hole.
 *
 * @param dependencies - Current list of dependencies
 * @param fromProjectId - Source project ID
 * @param toProjectId - Target project ID
 * @returns true if adding this dependency would create a cycle
 */
export function wouldCreateCycle(
  dependencies: Dependency[],
  fromProjectId: string,
  toProjectId: string
): boolean {
  // Self-dependency (a project ordering against itself) is always a cycle.
  if (fromProjectId === toProjectId) return true;

  // Build a project-level adjacency list from every dependency.
  const graph = new Map<string, Set<string>>();
  const addEdge = (source: string, target: string) => {
    if (!graph.has(source)) graph.set(source, new Set());
    graph.get(source)!.add(target);
  };

  dependencies.forEach(dep => addEdge(dep.fromProjectId, dep.toProjectId));

  // Add the candidate edge, then look for a path back from target to source.
  addEdge(fromProjectId, toProjectId);
  return hasPath(graph, toProjectId, fromProjectId);
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

  // Check for circular dependency at the project level (milestone anchoring
  // doesn't change which project must precede which).
  if (wouldCreateCycle(dependencies, fromProjectId, toProjectId)) {
    return { valid: false, error: 'This would create a circular dependency' };
  }

  return { valid: true };
}
