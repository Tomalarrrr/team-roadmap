export interface Milestone {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  tags: string[];
  statusColor: string;
  manualColorOverride?: boolean;
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

export interface TeamMember {
  id: string;
  name: string;
  jobTitle: string;
}

export interface RoadmapData {
  projects: Project[];
  teamMembers: TeamMember[];
}
