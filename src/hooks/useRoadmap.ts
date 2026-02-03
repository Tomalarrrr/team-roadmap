import { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeToRoadmap, saveRoadmap } from '../firebase';
import type { RoadmapData, Project, Milestone, TeamMember, Dependency } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { withRetry } from '../utils/retry';
import { analytics } from '../utils/analytics';

// Wrap saveRoadmap with retry logic
const saveWithRetry = (data: RoadmapData) =>
  withRetry(() => saveRoadmap(data), {
    maxRetries: 3,
    baseDelayMs: 500,
    onRetry: (error, attempt) => {
      console.warn(`Save failed, retry ${attempt}/3:`, error.message);
    }
  });

const DEFAULT_DATA: RoadmapData = {
  projects: [],
  teamMembers: [],
  dependencies: []
};

// Normalize data to ensure all required arrays exist
function normalizeData(newData: Partial<RoadmapData>): RoadmapData {
  const projects = (newData.projects || []).map(p => ({
    ...p,
    milestones: (p.milestones || []).map(m => ({
      ...m,
      tags: m.tags || []
    }))
  }));
  return {
    projects,
    teamMembers: newData.teamMembers || [],
    dependencies: newData.dependencies || []
  };
}

export function useRoadmap() {
  const [data, setData] = useState<RoadmapData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Track pending optimistic updates for rollback
  const pendingUpdateRef = useRef<RoadmapData | null>(null);
  const isLocalUpdateRef = useRef(false);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let mounted = true;

    // Initialize Firebase asynchronously (deferred loading)
    subscribeToRoadmap((newData) => {
      if (!mounted) return;

      // Skip Firebase updates if we have a pending local update
      // This prevents flickering during optimistic updates
      if (isLocalUpdateRef.current) {
        isLocalUpdateRef.current = false;
        return;
      }

      setData(normalizeData(newData));
      setLoading(false);
    }).then((unsub) => {
      if (mounted) {
        unsubscribe = unsub;
      } else {
        unsub(); // Component unmounted, clean up immediately
      }
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  // Optimistic save: update UI immediately, save in background, rollback on failure
  const optimisticSave = useCallback(async (newData: RoadmapData) => {
    const previousData = pendingUpdateRef.current || data;
    pendingUpdateRef.current = previousData;

    // Update UI immediately (optimistic)
    isLocalUpdateRef.current = true;
    setData(newData);
    setSaveError(null);

    try {
      await saveWithRetry(newData);
      pendingUpdateRef.current = null;
    } catch (error) {
      // Rollback on failure
      console.error('Save failed, rolling back:', error);
      setData(previousData);
      pendingUpdateRef.current = null;
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    }
  }, [data]);

  const clearError = useCallback(() => setSaveError(null), []);

  const addTeamMember = useCallback(async (member: Omit<TeamMember, 'id'>) => {
    const newMember: TeamMember = { ...member, id: uuidv4() };
    await optimisticSave({
      ...data,
      teamMembers: [...data.teamMembers, newMember]
    });
    analytics.memberAdded(newMember.id);
  }, [data, optimisticSave]);

  const updateTeamMember = useCallback(async (memberId: string, updates: Partial<TeamMember>) => {
    const newMembers = data.teamMembers.map(m =>
      m.id === memberId ? { ...m, ...updates } : m
    );
    await optimisticSave({ ...data, teamMembers: newMembers });
    analytics.memberUpdated(memberId);
  }, [data, optimisticSave]);

  const deleteTeamMember = useCallback(async (memberId: string) => {
    const member = data.teamMembers.find(m => m.id === memberId);
    if (!member) return;

    // Also delete their projects
    const newProjects = data.projects.filter(p => p.owner !== member.name);
    const newMembers = data.teamMembers.filter(m => m.id !== memberId);
    await optimisticSave({ ...data, projects: newProjects, teamMembers: newMembers });
    analytics.memberDeleted(memberId);
  }, [data, optimisticSave]);

  const reorderTeamMembers = useCallback(async (fromIndex: number, toIndex: number) => {
    const newMembers = [...data.teamMembers];
    const [moved] = newMembers.splice(fromIndex, 1);
    newMembers.splice(toIndex, 0, moved);
    await optimisticSave({ ...data, teamMembers: newMembers });
    analytics.memberReordered();
  }, [data, optimisticSave]);

  const addProject = useCallback(async (project: Omit<Project, 'id' | 'milestones'> | Project): Promise<Project> => {
    // If project already has an id (e.g., from undo restore), use it as-is
    const newProject: Project = 'id' in project && project.id ? {
      ...project,
      milestones: (project as Project).milestones || []
    } as Project : {
      ...project,
      id: uuidv4(),
      milestones: []
    };
    await optimisticSave({
      ...data,
      projects: [...data.projects, newProject]
    });
    analytics.projectCreated(newProject.id);
    return newProject;
  }, [data, optimisticSave]);

  const updateProject = useCallback(async (projectId: string, updates: Partial<Project>) => {
    const newProjects = data.projects.map(p =>
      p.id === projectId ? { ...p, ...updates } : p
    );
    await optimisticSave({ ...data, projects: newProjects });
    analytics.projectUpdated(projectId);
  }, [data, optimisticSave]);

  const deleteProject = useCallback(async (projectId: string) => {
    const newProjects = data.projects.filter(p => p.id !== projectId);
    await optimisticSave({ ...data, projects: newProjects });
    analytics.projectDeleted(projectId);
  }, [data, optimisticSave]);

  const addMilestone = useCallback(async (projectId: string, milestone: Omit<Milestone, 'id'>) => {
    const newMilestone: Milestone = { ...milestone, id: uuidv4() };
    const newProjects = data.projects.map(p => {
      if (p.id === projectId) {
        return { ...p, milestones: [...p.milestones, newMilestone] };
      }
      return p;
    });
    await optimisticSave({ ...data, projects: newProjects });
    analytics.milestoneCreated(newMilestone.id);
  }, [data, optimisticSave]);

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
    await optimisticSave({ ...data, projects: newProjects });
    analytics.milestoneUpdated(milestoneId);
  }, [data, optimisticSave]);

  const deleteMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    const newProjects = data.projects.map(p => {
      if (p.id === projectId) {
        return { ...p, milestones: p.milestones.filter(m => m.id !== milestoneId) };
      }
      return p;
    });
    await optimisticSave({ ...data, projects: newProjects });
    analytics.milestoneDeleted(milestoneId);
  }, [data, optimisticSave]);

  const addDependency = useCallback(async (
    fromProjectId: string,
    toProjectId: string,
    fromMilestoneId?: string,
    toMilestoneId?: string,
    type: Dependency['type'] = 'finish-to-start'
  ) => {
    const newDependency: Dependency = {
      id: uuidv4(),
      fromProjectId,
      toProjectId,
      fromMilestoneId,
      toMilestoneId,
      type
    };
    const newDependencies = [...(data.dependencies || []), newDependency];
    await optimisticSave({ ...data, dependencies: newDependencies });
    return newDependency;
  }, [data, optimisticSave]);

  const removeDependency = useCallback(async (dependencyId: string) => {
    const newDependencies = (data.dependencies || []).filter(d => d.id !== dependencyId);
    await optimisticSave({ ...data, dependencies: newDependencies });
  }, [data, optimisticSave]);

  return {
    data,
    loading,
    saveError,
    clearError,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    reorderTeamMembers,
    addProject,
    updateProject,
    deleteProject,
    addMilestone,
    updateMilestone,
    deleteMilestone,
    addDependency,
    removeDependency
  };
}
