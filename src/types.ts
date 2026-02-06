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
  nameColor?: string; // Optional custom color for name display
}

export interface Waypoint {
  x: number;
  y: number;
}

export type LeaveType = 'annual-leave' | 'training' | 'conference' | 'other';
export type LeaveCoverage = 'quarter' | 'half' | 'full';

export interface LeaveBlock {
  id: string;
  memberId: string;
  startDate: string;
  endDate: string;
  coverage: LeaveCoverage;
  type: LeaveType;
  label?: string;
}

export interface Dependency {
  id: string;
  fromProjectId: string;
  fromMilestoneId?: string;  // If set, dependency starts from this milestone
  toProjectId: string;
  toMilestoneId?: string;    // If set, dependency ends at this milestone
  type: 'finish-to-start' | 'start-to-start' | 'finish-to-finish';
  waypoints?: Waypoint[];    // Custom control points for manual path shaping
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

// Undo system types (discriminated unions for type safety)
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
  | 'REMOVE_DEPENDENCY'
  | 'CREATE_LEAVE'
  | 'UPDATE_LEAVE'
  | 'DELETE_LEAVE';

// Base undo action interface
interface BaseUndoAction {
  id: string;
  userId: string;
  timestamp: number;
}

// Discriminated union for type-safe undo actions
export type UndoAction =
  | (BaseUndoAction & {
      type: 'CREATE_PROJECT';
      data: Project;
      inverse: { action: 'delete'; data: Project };
    })
  | (BaseUndoAction & {
      type: 'UPDATE_PROJECT';
      data: Project;
      inverse: { action: 'update'; data: Project };
    })
  | (BaseUndoAction & {
      type: 'DELETE_PROJECT';
      data: Project;
      inverse: { action: 'restore'; data: Project };
    })
  | (BaseUndoAction & {
      type: 'CREATE_MILESTONE';
      data: Milestone;
      inverse: { action: 'delete'; data: Milestone };
    })
  | (BaseUndoAction & {
      type: 'UPDATE_MILESTONE';
      data: Milestone;
      inverse: { action: 'update'; data: Milestone };
    })
  | (BaseUndoAction & {
      type: 'DELETE_MILESTONE';
      data: Milestone;
      inverse: { action: 'restore'; data: Milestone };
    })
  | (BaseUndoAction & {
      type: 'CREATE_MEMBER';
      data: TeamMember;
      inverse: { action: 'delete'; data: TeamMember };
    })
  | (BaseUndoAction & {
      type: 'UPDATE_MEMBER';
      data: TeamMember;
      inverse: { action: 'update'; data: TeamMember };
    })
  | (BaseUndoAction & {
      type: 'DELETE_MEMBER';
      data: TeamMember;
      inverse: { action: 'restore'; data: TeamMember };
    })
  | (BaseUndoAction & {
      type: 'REORDER_MEMBERS';
      data: TeamMember[];
      inverse: { action: 'reorder'; data: TeamMember[] };
    })
  | (BaseUndoAction & {
      type: 'ADD_DEPENDENCY';
      data: Dependency;
      inverse: { action: 'delete'; data: Dependency };
    })
  | (BaseUndoAction & {
      type: 'REMOVE_DEPENDENCY';
      data: Dependency;
      inverse: { action: 'restore'; data: Dependency };
    });

export type PeriodMarkerColor = 'grey' | 'yellow' | 'orange' | 'red' | 'green';

export interface PeriodMarker {
  id: string;
  startDate: string;
  endDate: string;
  color: PeriodMarkerColor;
  label?: string;
}

export interface RoadmapData {
  projects: Project[];
  teamMembers: TeamMember[];
  dependencies?: Dependency[];
  leaveBlocks?: LeaveBlock[];
  periodMarkers?: PeriodMarker[];
}

// Clipboard types for copy/paste
export interface ClipboardData {
  type: 'project' | 'milestone';
  data: Project | Milestone;
  copiedAt: number;
}

// Type guards for runtime validation
export function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.owner === 'string' &&
    typeof obj.startDate === 'string' &&
    typeof obj.endDate === 'string' &&
    typeof obj.statusColor === 'string' &&
    Array.isArray(obj.milestones)
  );
}

export function isMilestone(value: unknown): value is Milestone {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.title === 'string' &&
    typeof obj.startDate === 'string' &&
    typeof obj.endDate === 'string' &&
    typeof obj.statusColor === 'string' &&
    Array.isArray(obj.tags)
  );
}

// Context menu types
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  variant?: 'default' | 'danger';
  disabled?: boolean;
  divider?: boolean;
}

export interface ContextMenuPosition {
  x: number;
  y: number;
}
