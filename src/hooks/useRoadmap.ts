import { useState, useEffect, useCallback } from 'react';
import { subscribeToRoadmap, saveRoadmap } from '../firebase';
import type { RoadmapData, Project, Milestone } from '../types';
import { v4 as uuidv4 } from 'uuid';

export function useRoadmap() {
  const [data, setData] = useState<RoadmapData>({ projects: [] });
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToRoadmap((newData) => {
      setData(newData);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addProject = useCallback(async (project: Omit<Project, 'id' | 'milestones'>) => {
    const newProject: Project = {
      ...project,
      id: uuidv4(),
      milestones: []
    };
    const newData = {
      ...data,
      projects: [...data.projects, newProject]
    };
    await saveRoadmap(newData);
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
    const newMilestone: Milestone = {
      ...milestone,
      id: uuidv4()
    };
    const newProjects = data.projects.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          milestones: [...p.milestones, newMilestone]
        };
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
        return {
          ...p,
          milestones: p.milestones.filter(m => m.id !== milestoneId)
        };
      }
      return p;
    });
    await saveRoadmap({ ...data, projects: newProjects });
  }, [data]);

  return {
    data,
    loading,
    error,
    addProject,
    updateProject,
    deleteProject,
    addMilestone,
    updateMilestone,
    deleteMilestone
  };
}
