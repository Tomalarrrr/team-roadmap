/**
 * Bidirectional conversion between Firebase keyed-object format and app array format.
 *
 * Firebase stores collections as keyed objects: { "abc123": {...}, "def456": {...} }
 * The app works with arrays: [{id: "abc123", ...}, {id: "def456", ...}]
 *
 * These functions handle both legacy array format (pre-migration) and new keyed-object
 * format transparently, so the app works correctly during and after the transition.
 */

import type { RoadmapData, Project, Milestone, TeamMember, Dependency, LeaveBlock, PeriodMarker } from '../types';

// ---------- Firebase storage types ----------

interface FirebaseProject extends Omit<Project, 'milestones'> {
  milestones: Record<string, Milestone> | Milestone[];
}

export interface FirebaseRoadmapData {
  projects: Record<string, FirebaseProject> | FirebaseProject[];
  teamMembers: Record<string, TeamMember> | TeamMember[];
  dependencies: Record<string, Dependency> | Dependency[];
  leaveBlocks: Record<string, LeaveBlock> | LeaveBlock[];
  periodMarkers: Record<string, PeriodMarker> | PeriodMarker[];
}

// ---------- Generic converters ----------

/**
 * Convert a Firebase value (array or keyed object) to an array.
 * Handles: null, undefined, actual arrays (legacy), and keyed objects (new format).
 * Firebase may also return objects with numeric string keys for sparse arrays.
 */
export function keyedObjectToArray<T>(obj: Record<string, T> | T[] | null | undefined): T[] {
  if (obj == null) return [];
  if (Array.isArray(obj)) return obj.filter(item => item != null);
  if (typeof obj === 'object') {
    return Object.values(obj).filter(item => item != null);
  }
  return [];
}

/**
 * Convert an array of items with `id` fields to a keyed object.
 */
export function arrayToKeyedObject<T extends { id: string }>(arr: T[]): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of arr) {
    if (item && item.id) {
      result[item.id] = item;
    }
  }
  return result;
}

// ---------- Project-specific converters ----------

/**
 * Normalize a single project from Firebase format.
 * Converts milestones from keyed object to array if needed.
 */
function projectFromFirebase(raw: FirebaseProject | null): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const milestones = keyedObjectToArray<Milestone>(
    raw.milestones as Record<string, Milestone> | Milestone[] | null
  );
  return { ...raw, milestones } as Project;
}

/**
 * Convert a single project to Firebase format.
 * Converts milestones array to keyed object.
 */
export function projectToFirebase(project: Project): FirebaseProject {
  return {
    ...project,
    milestones: arrayToKeyedObject(project.milestones || [])
  };
}

// ---------- Format detection ----------

/**
 * Check if Firebase data is in legacy array format (pre-migration).
 * Returns true if any top-level collection is an actual JavaScript array,
 * which means it was written as an array and needs to be converted to keyed objects.
 */
export function isLegacyArrayFormat(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const raw = data as Record<string, unknown>;
  return (
    Array.isArray(raw.projects) ||
    Array.isArray(raw.teamMembers) ||
    Array.isArray(raw.dependencies) ||
    Array.isArray(raw.leaveBlocks) ||
    Array.isArray(raw.periodMarkers)
  );
}

// ---------- Full RoadmapData converters ----------

/**
 * Convert a Firebase snapshot value to the app's RoadmapData format (arrays).
 * Handles both legacy array data and new keyed-object data transparently.
 */
export function firebaseSnapshotToRoadmapData(data: unknown): RoadmapData {
  if (!data || typeof data !== 'object') {
    return {
      projects: [],
      teamMembers: [],
      dependencies: [],
      leaveBlocks: [],
      periodMarkers: []
    };
  }

  const raw = data as Partial<FirebaseRoadmapData>;

  // Convert projects (with nested milestone conversion)
  const rawProjects = keyedObjectToArray<FirebaseProject>(
    raw.projects as Record<string, FirebaseProject> | FirebaseProject[] | undefined
  );
  const projects: Project[] = rawProjects
    .map(p => projectFromFirebase(p))
    .filter((p): p is Project => p !== null);

  // Convert team members and sort by order field
  const teamMembers = keyedObjectToArray<TeamMember>(
    raw.teamMembers as Record<string, TeamMember> | TeamMember[] | undefined
  ).sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER;
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER;
    if (orderA !== orderB) return orderA - orderB;
    // Stable fallback: sort by id to prevent random reordering
    return a.id.localeCompare(b.id);
  });

  // Convert remaining collections (flat, no nesting)
  const dependencies = keyedObjectToArray<Dependency>(
    raw.dependencies as Record<string, Dependency> | Dependency[] | undefined
  );
  const leaveBlocks = keyedObjectToArray<LeaveBlock>(
    raw.leaveBlocks as Record<string, LeaveBlock> | LeaveBlock[] | undefined
  );
  const periodMarkers = keyedObjectToArray<PeriodMarker>(
    raw.periodMarkers as Record<string, PeriodMarker> | PeriodMarker[] | undefined
  );

  return { projects, teamMembers, dependencies, leaveBlocks, periodMarkers };
}

/**
 * Convert the app's RoadmapData (arrays) to Firebase keyed-object format for writing.
 * Assigns `order` fields to teamMembers based on array position.
 */
export function roadmapDataToFirebaseFormat(data: RoadmapData): FirebaseRoadmapData {
  // Assign order to team members based on current array position
  const orderedMembers = data.teamMembers.map((m, i) => ({ ...m, order: i }));

  // Convert projects with nested milestones
  const projectsObj: Record<string, FirebaseProject> = {};
  for (const project of data.projects) {
    if (project && project.id) {
      projectsObj[project.id] = projectToFirebase(project);
    }
  }

  return {
    projects: projectsObj,
    teamMembers: arrayToKeyedObject(orderedMembers),
    dependencies: arrayToKeyedObject(data.dependencies || []),
    leaveBlocks: arrayToKeyedObject(data.leaveBlocks || []),
    periodMarkers: arrayToKeyedObject(data.periodMarkers || [])
  };
}
