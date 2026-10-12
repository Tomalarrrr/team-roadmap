import type { FilterState, Project, TeamMember } from '../types';

/**
 * People who have left stay on the board so their finished work keeps its
 * owner, but sink below everyone still on the team. Order within each group is
 * unchanged.
 */
export function leaversLast(members: TeamMember[]): TeamMember[] {
  return [...members.filter(m => !m.left), ...members.filter(m => m.left)];
}

/**
 * Leavers are greyed back so the board reads as the current team's workload.
 * The one view where that is wrong is a look back at delivered work: with the
 * status filter set to Complete alone, who is still here is beside the point.
 */
export function dimsLeavers(filters: FilterState): boolean {
  return !(filters.statuses.length === 1 && filters.statuses[0] === 'complete');
}

/**
 * A project names its owner by name, not id, so a rename that wrote only the
 * member would leave their projects pointing at nobody and off the board.
 * These are the extra paths that carry the projects along in the same write.
 */
export function ownerRenamePaths(projects: Project[], from: string, to: string): Record<string, string> {
  const paths: Record<string, string> = {};
  for (const project of projects) {
    if (project.owner === from) paths[`projects/${project.id}/owner`] = to;
  }
  return paths;
}

/**
 * A reorder is sent as each moved person's `order` alone. Writing whole members
 * from this client's copy would put back a name, a leaving date or a capacity
 * that a colleague changed since the last poll. `members` is the list in its
 * new sequence; anyone already holding their position's number is left out.
 */
export function memberOrderPaths(members: TeamMember[]): Record<string, number> {
  const paths: Record<string, number> = {};
  members.forEach((member, index) => {
    if (member.order !== index) paths[`teamMembers/${member.id}/order`] = index;
  });
  return paths;
}

/** Whether `name` is already someone else's, ignoring case and outer spaces. */
export function isNameTaken(name: string, others: string[]): boolean {
  const key = name.trim().toLowerCase();
  return others.some(other => other.trim().toLowerCase() === key);
}
