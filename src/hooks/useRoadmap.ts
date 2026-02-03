import { useState, useEffect, useCallback } from 'react';
import { subscribeToRoadmap, saveRoadmap } from '../firebase';
import type { RoadmapData, Project, Milestone, TeamMember } from '../types';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_DATA: RoadmapData = {
  projects: [],
  teamMembers: []
};

export function useRoadmap() {
  const [data, setData] = useState<RoadmapData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToRoadmap((newData) => {
      // Normalize data to ensure all required arrays exist
      const projects = (newData.projects || []).map(p => ({
        ...p,
        milestones: (p.milestones || []).map(m => ({
          ...m,
          tags: m.tags || []
        }))
      }));
      setData({
        projects,
        teamMembers: newData.teamMembers || []
      });
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const addTeamMember = useCallback(async (member: Omit<TeamMember, 'id'>) => {
    const newMember: TeamMember = { ...member, id: uuidv4() };
    await saveRoadmap({
      ...data,
      teamMembers: [...data.teamMembers, newMember]
    });
  }, [data]);

  const updateTeamMember = useCallback(async (memberId: string, updates: Partial<TeamMember>) => {
    const newMembers = data.teamMembers.map(m =>
      m.id === memberId ? { ...m, ...updates } : m
    );
    await saveRoadmap({ ...data, teamMembers: newMembers });
  }, [data]);

  const deleteTeamMember = useCallback(async (memberId: string) => {
    const member = data.teamMembers.find(m => m.id === memberId);
    if (!member) return;

    // Also delete their projects
    const newProjects = data.projects.filter(p => p.owner !== member.name);
    const newMembers = data.teamMembers.filter(m => m.id !== memberId);
    await saveRoadmap({ ...data, projects: newProjects, teamMembers: newMembers });
  }, [data]);

  const reorderTeamMembers = useCallback(async (fromIndex: number, toIndex: number) => {
    const newMembers = [...data.teamMembers];
    const [moved] = newMembers.splice(fromIndex, 1);
    newMembers.splice(toIndex, 0, moved);
    await saveRoadmap({ ...data, teamMembers: newMembers });
  }, [data]);

  const addProject = useCallback(async (project: Omit<Project, 'id' | 'milestones'>) => {
    const newProject: Project = {
      ...project,
      id: uuidv4(),
      milestones: []
    };
    await saveRoadmap({
      ...data,
      projects: [...data.projects, newProject]
    });
  }, [data]);

  const updateProject = useCallback(async (projectId: string, updates: Partial<Project>) => {
    const newProjects = data.projects.map(p =>
      p.id === projectId ? { ...p, ...updates } : p
    );
    await saveRoadmap({ ...data, projects: newProjects });
  }, [data]);

  const deleteProject = useCallback(async (projectId: string) => {
    const newProjects = data.projects.filter(p => p.id !== projectId);
    await saveRoadmap({ ...data, projects: newProjects });
  }, [data]);

  const addMilestone = useCallback(async (projectId: string, milestone: Omit<Milestone, 'id'>) => {
    const newMilestone: Milestone = { ...milestone, id: uuidv4() };
    const newProjects = data.projects.map(p => {
      if (p.id === projectId) {
        return { ...p, milestones: [...p.milestones, newMilestone] };
      }
      return p;
    });
    await saveRoadmap({ ...data, projects: newProjects });
  }, [data]);

  const updateMilestone = useCallback(async (
    projectId: string,
    milestoneId: string,
    updates: Partial<Milestone>
  ) => {
    const newProjects = data.projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          milestones: p.milestones.map(m =>
            m.id === milestoneId ? { ...m, ...updates } : m
          )
        };
      }
      return p;
    });
    await saveRoadmap({ ...data, projects: newProjects });
  }, [data]);

  const deleteMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    const newProjects = data.projects.map(p => {
      if (p.id === projectId) {
        return { ...p, milestones: p.milestones.filter(m => m.id !== milestoneId) };
      }
      return p;
    });
    await saveRoadmap({ ...data, projects: newProjects });
  }, [data]);

  return {
    data,
    loading,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    reorderTeamMembers,
    addProject,
    updateProject,
    deleteProject,
    addMilestone,
    updateMilestone,
    deleteMilestone
  };
}
