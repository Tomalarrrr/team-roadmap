export interface Milestone {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  tags: string[];
  statusColor: string;
}

export interface Project {
  id: string;
  title: string;
  owner: string;
  startDate: string;
  endDate: string;
  statusColor: string;
  milestones: Milestone[];
  dependencies?: string[]; // IDs of projects this depends on
}

export interface TeamMember {
  id: string;
  name: string;
  jobTitle: string;
}

export interface Dependency {
  id: string;
  fromProjectId: string;
  fromMilestoneId?: string;  // If set, dependency starts from this milestone
  toProjectId: string;
  toMilestoneId?: string;    // If set, dependency ends at this milestone
  type: 'finish-to-start' | 'start-to-start' | 'finish-to-finish';
}

// Types for dependency creation UI
export interface DependencySource {
  projectId: string;
  milestoneId?: string;
  position: { x: number; y: number };
}

export interface DependencyTarget {
  projectId: string;
  milestoneId?: string;
}

// Undo system types
export type ActionType =
  | 'CREATE_PROJECT'
  | 'UPDATE_PROJECT'
  | 'DELETE_PROJECT'
  | 'CREATE_MILESTONE'
  | 'UPDATE_MILESTONE'
  | 'DELETE_MILESTONE'
  | 'CREATE_MEMBER'
  | 'UPDATE_MEMBER'
  | 'DELETE_MEMBER'
  | 'REORDER_MEMBERS'
  | 'ADD_DEPENDENCY'
  | 'REMOVE_DEPENDENCY';

export interface UndoAction {
  id: string;
  type: ActionType;
  userId: string;
  timestamp: number;
  data: unknown;
  inverse: unknown; // Data needed to reverse the action
}

export interface RoadmapData {
  projects: Project[];
  teamMembers: TeamMember[];
  dependencies?: Dependency[];
}

// Clipboard types for copy/paste
export interface ClipboardData {
  type: 'project' | 'milestone';
  data: Project | Milestone;
  copiedAt: number;
}
