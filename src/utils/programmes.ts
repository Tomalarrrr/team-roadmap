import type { Project } from '../types';

/**
 * A project reports under at most one programme, picked from the list kept in
 * the board's rules. The list is the order the programme view shows them in.
 */

/** Heading for work that reports under no programme. */
export const UNASSIGNED_PROGRAMME = 'No programme';

export interface ProgrammeGroup {
  /** Programme name, or null for the unassigned group. */
  programme: string | null;
  projects: Project[];
}

/**
 * Projects grouped under the listed programmes, in list order, each group in
 * start-date order. A programme with no work is left out. Work whose programme
 * is no longer on the list is not hidden: it follows the listed groups under
 * its own name, and unassigned work comes last.
 */
export function groupByProgramme(projects: Project[], programmes: string[]): ProgrammeGroup[] {
  const byName = new Map<string, Project[]>();
  const unassigned: Project[] = [];
  for (const project of projects) {
    if (!project.programme) { unassigned.push(project); continue; }
    const list = byName.get(project.programme);
    if (list) list.push(project); else byName.set(project.programme, [project]);
  }
  const offList = [...byName.keys()].filter(name => !programmes.includes(name)).sort((a, b) => a.localeCompare(b));
  const byStart = (a: Project, b: Project) => a.startDate.localeCompare(b.startDate) || a.title.localeCompare(b.title);
  const groups: ProgrammeGroup[] = [...programmes, ...offList]
    .filter(name => byName.has(name))
    .map(name => ({ programme: name, projects: byName.get(name)!.sort(byStart) }));
  if (unassigned.length > 0) groups.push({ programme: null, projects: unassigned.sort(byStart) });
  return groups;
}

/** A typed name tidied for the list, or null when it is blank or already there
 *  (compared without regard to case). */
export function newProgrammeName(typed: string, programmes: string[]): string | null {
  const name = typed.trim().replace(/\s+/g, ' ');
  if (!name) return null;
  return programmes.some(p => p.toLowerCase() === name.toLowerCase()) ? null : name;
}
