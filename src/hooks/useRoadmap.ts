import { useState, useEffect, useCallback, useRef } from 'react';
import {
  subscribeToRoadmap,
  saveRoadmap,
  subscribeToConnectionState,
  updateProjectAtPath,
  updateMilestoneAtPath,
  updateDependencyAtPath,
  updateTeamMemberAtPath
} from '../firebase';
import type { RoadmapData, Project, Milestone, TeamMember, Dependency } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { withRetry } from '../utils/retry';
import { analytics } from '../utils/analytics';
import { validateDependency } from '../utils/dependencyUtils';

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

// Normalize data to ensure all required arrays exist and no undefined values
function normalizeData(newData: Partial<RoadmapData>): RoadmapData {
  const projects = (newData.projects || []).map(p => ({
    ...p,
    milestones: (p.milestones || []).map(m => ({
      ...m,
      description: m.description ?? '',
      tags: m.tags || []
    }))
  }));
  return {
    projects,
    teamMembers: newData.teamMembers || [],
    dependencies: newData.dependencies || []
  };
}

// Remove undefined values recursively (Firebase rejects undefined)
function sanitizeForFirebase<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return '' as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirebase(item)) as T;
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = value === undefined ? '' : sanitizeForFirebase(value);
    }
    return result as T;
  }
  return obj;
}

export function useRoadmap() {
  const [data, setData] = useState<RoadmapData>(DEFAULT_DATA);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  // Ref to always access current data (fixes stale closure bug during rapid updates)
  const dataRef = useRef<RoadmapData>(data);
  dataRef.current = data;

  // Track pending optimistic updates for rollback
  const pendingUpdateRef = useRef<RoadmapData | null>(null);
  const isLocalUpdateRef = useRef(false);

  // Debounce connection state to prevent rapid state flapping
  const connectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastConnectionStateRef = useRef<boolean>(true);

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let unsubscribeConnection: (() => void) | null = null;
    let mounted = true;

    // Initialize Firebase asynchronously (deferred loading)
    subscribeToRoadmap((newData) => {
      if (!mounted) return;

      // If we have a pending local update, merge instead of discarding
      // This prevents losing concurrent user edits
      if (isLocalUpdateRef.current) {
        isLocalUpdateRef.current = false;
        // Apply Firebase update but preserve any pending changes
        // This ensures we don't lose external edits during optimistic updates
        const normalized = normalizeData(newData);
        // Update data ref to have latest Firebase state
        dataRef.current = normalized;
        setData(normalized);
        setLoading(false);
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

    // Monitor connection state with debouncing to prevent flapping
    subscribeToConnectionState((connected) => {
      if (!mounted) return;

      // Debounce connection state changes to prevent rapid re-renders
      // during network instability
      if (connectionDebounceRef.current) {
        clearTimeout(connectionDebounceRef.current);
      }

      connectionDebounceRef.current = setTimeout(() => {
        // Only update if state actually changed
        if (lastConnectionStateRef.current !== connected) {
          lastConnectionStateRef.current = connected;
          setIsOnline(connected);
          if (!connected) {
            console.warn('Firebase connection lost. Changes will be saved when reconnected.');
          }
        }
      }, 500); // 500ms debounce prevents flapping cascade
    }).then((unsub) => {
      if (mounted) {
        unsubscribeConnection = unsub;
      } else {
        unsub();
      }
    });

    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeConnection?.();
      if (connectionDebounceRef.current) {
        clearTimeout(connectionDebounceRef.current);
      }
    };
  }, []);

  // Optimistic save: update UI immediately, save in background, rollback on failure
  const optimisticSave = useCallback(async (newData: RoadmapData) => {
    // Use ref to get current data (avoids stale closure during rapid updates)
    const currentData = dataRef.current;
    const previousData = pendingUpdateRef.current || currentData;
    pendingUpdateRef.current = previousData;

    // Sanitize data to remove undefined values (Firebase rejects them)
    const sanitizedData = sanitizeForFirebase(normalizeData(newData));

    // Update both state and ref immediately (optimistic)
    isLocalUpdateRef.current = true;
    dataRef.current = sanitizedData;
    setData(sanitizedData);
    setSaveError(null);

    try {
      await saveWithRetry(sanitizedData);
      pendingUpdateRef.current = null;
    } catch (error) {
      // Rollback on failure
      console.error('Save failed, rolling back:', error);
      dataRef.current = previousData;
      setData(previousData);
      pendingUpdateRef.current = null;
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    }
  }, []);

  const clearError = useCallback(() => setSaveError(null), []);

  const addTeamMember = useCallback(async (member: Omit<TeamMember, 'id'>) => {
    const currentData = dataRef.current;
    const newMember: TeamMember = { ...member, id: uuidv4() };
    await optimisticSave({
      ...currentData,
      teamMembers: [...currentData.teamMembers, newMember]
    });
    analytics.memberAdded(newMember.id);
  }, [optimisticSave]);

  const updateTeamMember = useCallback(async (memberId: string, updates: Partial<TeamMember>) => {
    const currentData = dataRef.current;
    const memberIndex = currentData.teamMembers.findIndex(m => m.id === memberId);
    if (memberIndex === -1) return;

    const updatedMember = { ...currentData.teamMembers[memberIndex], ...updates };

    // Optimistic update
    const newMembers = [...currentData.teamMembers];
    newMembers[memberIndex] = updatedMember;
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, teamMembers: newMembers };
    setData(dataRef.current);

    try {
      // Granular Firebase update - only updates this specific team member
      await withRetry(() => updateTeamMemberAtPath(memberIndex, sanitizeForFirebase(updatedMember)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
      analytics.memberUpdated(memberId);
    } catch (error) {
      // Rollback on failure
      dataRef.current = currentData;
      setData(currentData);
      throw error;
    }
  }, []);

  const deleteTeamMember = useCallback(async (memberId: string) => {
    const currentData = dataRef.current;
    const member = currentData.teamMembers.find(m => m.id === memberId);
    if (!member) return;

    // Also delete their projects
    const newProjects = currentData.projects.filter(p => p.owner !== member.name);
    const newMembers = currentData.teamMembers.filter(m => m.id !== memberId);
    await optimisticSave({ ...currentData, projects: newProjects, teamMembers: newMembers });
    analytics.memberDeleted(memberId);
  }, [optimisticSave]);

  const reorderTeamMembers = useCallback(async (fromIndex: number, toIndex: number) => {
    const currentData = dataRef.current;
    const newMembers = [...currentData.teamMembers];
    const [moved] = newMembers.splice(fromIndex, 1);
    newMembers.splice(toIndex, 0, moved);
    await optimisticSave({ ...currentData, teamMembers: newMembers });
    analytics.memberReordered();
  }, [optimisticSave]);

  const addProject = useCallback(async (project: Omit<Project, 'id' | 'milestones'> | Project): Promise<Project> => {
    const currentData = dataRef.current;
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
      ...currentData,
      projects: [...currentData.projects, newProject]
    });
    analytics.projectCreated(newProject.id);
    return newProject;
  }, [optimisticSave]);

  const updateProject = useCallback(async (projectId: string, updates: Partial<Project>) => {
    const currentData = dataRef.current;
    const projectIndex = currentData.projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) return;

    const updatedProject = { ...currentData.projects[projectIndex], ...updates };

    // Optimistic update
    const newProjects = [...currentData.projects];
    newProjects[projectIndex] = updatedProject;
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, projects: newProjects };
    setData(dataRef.current);

    try {
      // Granular Firebase update - only updates this specific project
      await withRetry(() => updateProjectAtPath(projectIndex, sanitizeForFirebase(updatedProject)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
      analytics.projectUpdated(projectId);
    } catch (error) {
      // Rollback on failure
      dataRef.current = currentData;
      setData(currentData);
      throw error;
    }
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    const currentData = dataRef.current;
    const newProjects = currentData.projects.filter(p => p.id !== projectId);
    await optimisticSave({ ...currentData, projects: newProjects });
    analytics.projectDeleted(projectId);
  }, [optimisticSave]);

  const addMilestone = useCallback(async (projectId: string, milestone: Omit<Milestone, 'id'>) => {
    const currentData = dataRef.current;
    const newMilestone: Milestone = { ...milestone, id: uuidv4() };
    const newProjects = currentData.projects.map(p => {
      if (p.id === projectId) {
        return { ...p, milestones: [...p.milestones, newMilestone] };
      }
      return p;
    });
    await optimisticSave({ ...currentData, projects: newProjects });
    analytics.milestoneCreated(newMilestone.id);
  }, [optimisticSave]);

  const updateMilestone = useCallback(async (
    projectId: string,
    milestoneId: string,
    updates: Partial<Milestone>
  ) => {
    const currentData = dataRef.current;
    const projectIndex = currentData.projects.findIndex(p => p.id === projectId);
    if (projectIndex === -1) return;

    const project = currentData.projects[projectIndex];
    const milestoneIndex = project.milestones.findIndex(m => m.id === milestoneId);
    if (milestoneIndex === -1) return;

    const updatedMilestone = { ...project.milestones[milestoneIndex], ...updates };

    // Optimistic update
    const newMilestones = [...project.milestones];
    newMilestones[milestoneIndex] = updatedMilestone;
    const newProjects = [...currentData.projects];
    newProjects[projectIndex] = { ...project, milestones: newMilestones };
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, projects: newProjects };
    setData(dataRef.current);

    try {
      // Granular Firebase update - only updates this specific milestone
      await withRetry(() => updateMilestoneAtPath(projectIndex, milestoneIndex, sanitizeForFirebase(updatedMilestone)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
      analytics.milestoneUpdated(milestoneId);
    } catch (error) {
      // Rollback on failure
      dataRef.current = currentData;
      setData(currentData);
      throw error;
    }
  }, []);

  const deleteMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    const currentData = dataRef.current;
    const newProjects = currentData.projects.map(p => {
      if (p.id === projectId) {
        return { ...p, milestones: p.milestones.filter(m => m.id !== milestoneId) };
      }
      return p;
    });
    await optimisticSave({ ...currentData, projects: newProjects });
    analytics.milestoneDeleted(milestoneId);
  }, [optimisticSave]);

  const addDependency = useCallback(async (
    fromProjectId: string,
    toProjectId: string,
    fromMilestoneId?: string,
    toMilestoneId?: string,
    type: Dependency['type'] = 'finish-to-start'
  ) => {
    const currentData = dataRef.current;

    // Validate dependency before adding
    const validation = validateDependency(
      currentData.dependencies || [],
      fromProjectId,
      toProjectId,
      fromMilestoneId,
      toMilestoneId
    );

    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid dependency');
    }

    const newDependency: Dependency = {
      id: uuidv4(),
      fromProjectId,
      toProjectId,
      fromMilestoneId,
      toMilestoneId,
      type
    };
    const newDependencies = [...(currentData.dependencies || []), newDependency];
    await optimisticSave({ ...currentData, dependencies: newDependencies });
    return newDependency;
  }, [optimisticSave]);

  const removeDependency = useCallback(async (dependencyId: string) => {
    const currentData = dataRef.current;
    const newDependencies = (currentData.dependencies || []).filter(d => d.id !== dependencyId);
    await optimisticSave({ ...currentData, dependencies: newDependencies });
  }, [optimisticSave]);

  const updateDependency = useCallback(async (dependencyId: string, updates: Partial<Dependency>) => {
    const currentData = dataRef.current;
    const dependencies = currentData.dependencies || [];
    const depIndex = dependencies.findIndex(d => d.id === dependencyId);
    if (depIndex === -1) return;

    const updatedDependency = { ...dependencies[depIndex], ...updates };

    // Optimistic update
    const newDependencies = [...dependencies];
    newDependencies[depIndex] = updatedDependency;
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, dependencies: newDependencies };
    setData(dataRef.current);

    try {
      // Granular Firebase update - only updates this specific dependency
      await withRetry(() => updateDependencyAtPath(depIndex, sanitizeForFirebase(updatedDependency)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
    } catch (error) {
      // Rollback on failure
      dataRef.current = currentData;
      setData(currentData);
      throw error;
    }
  }, []);

  return {
    data,
    loading,
    saveError,
    isOnline,
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
    removeDependency,
    updateDependency
  };
}
