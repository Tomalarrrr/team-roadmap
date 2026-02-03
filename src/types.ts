export interface Milestone {
  id: string;
  title: string;
  startDate: string; // ISO date string
  endDate: string;
  tags: string[];
  statusColor: string; // RGB/RGBA string
  manualColorOverride?: boolean; // If true, don't auto-change to blue
}

export interface Project {
  id: string;
  title: string;
  owner: string;
  startDate: string;
  endDate: string;
  statusColor: string;
  milestones: Milestone[];
}

export interface RoadmapData {
  projects: Project[];
}
