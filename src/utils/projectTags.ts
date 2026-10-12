import type { Project } from '../types';

/**
 * Tags are free-text category labels stored on each project. There is no
 * separate list to maintain: a tag exists for as long as a project carries it,
 * so adding one to a project creates it and removing it from the last project
 * retires it.
 */

/** Every tag in use on the board, alphabetical. */
export function tagsInUse(projects: Project[]): string[] {
  const seen = new Set<string>();
  for (const project of projects) {
    for (const tag of project.tags ?? []) seen.add(tag);
  }
  return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * Add what the user typed to a project's tags. Matching is case-insensitive and
 * adopts the spelling already on the board (`known`), so "epr" typed on one
 * project and "EPR" on another stay one tag and one filter chip. A comma
 * separates tags, so a pasted "Clinical, Finance" lands as two. Returns the
 * input array untouched when there is nothing to add.
 */
export function addTag(tags: string[], typed: string, known: string[]): string[] {
  let result = tags;
  for (const part of typed.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ');
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (result.some(t => t.toLowerCase() === key)) continue;
    result = [...result, known.find(t => t.toLowerCase() === key) ?? tag];
  }
  return result;
}
