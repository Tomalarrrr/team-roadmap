import { useState, useEffect, useCallback, useRef } from 'react';
import {
  subscribeToRoadmap,
  saveRoadmap,
  subscribeToConnectionState,
  updateProjectAtPath,
  updateMilestoneAtPath,
  updateDependencyAtPath,
  updateTeamMemberAtPath,
  updateLeaveBlockAtPath,
  setupConnectionLifecycle,
  forceReconnect
} from '../firebase';
import type { RoadmapData, Project, Milestone, TeamMember, Dependency, LeaveBlock, PeriodMarker } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { withRetry } from '../utils/retry';
import { analytics } from '../utils/analytics';
import { validateDependency } from '../utils/dependencyUtils';
import { safeValidateRoadmapData, formatValidationErrors } from '../schemas/roadmap';

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
  dependencies: [],
  leaveBlocks: [],
  periodMarkers: []
};

// Normalize data to ensure all required arrays exist and no undefined values
// Uses Zod schema validation for data integrity
function normalizeData(newData: Partial<RoadmapData>): RoadmapData {
  // Try Zod validation first for better type safety and normalization
  const result = safeValidateRoadmapData(newData);

  if (result.success) {
    return result.data;
  }

  // Log validation errors in development
  if (import.meta.env.DEV) {
    console.warn('Data validation warnings:', formatValidationErrors(result.error));
  }

  // Fall back to manual normalization for backwards compatibility
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
    dependencies: newData.dependencies || [],
    leaveBlocks: newData.leaveBlocks || [],
    periodMarkers: newData.periodMarkers || []
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
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Track newly created IDs for entrance animations
  const [newMilestoneIds, setNewMilestoneIds] = useState<Set<string>>(new Set());
  const [newDependencyIds, setNewDependencyIds] = useState<Set<string>>(new Set());

  // Ref to always access current data (fixes stale closure bug during rapid updates)
  const dataRef = useRef<RoadmapData>(data);
  dataRef.current = data;

  // Counter-based save tracking: prevents isSaving from flashing false between
  // concurrent saves. Increment on save start, decrement on save end.
  const savingCountRef = useRef(0);
  const startSaving = useCallback(() => {
    savingCountRef.current++;
    setIsSaving(true);
  }, []);
  const finishSaving = useCallback(() => {
    savingCountRef.current = Math.max(0, savingCountRef.current - 1);
    if (savingCountRef.current === 0) {
      setIsSaving(false);
    }
  }, []);

  // Track pending optimistic updates for rollback
  const pendingUpdateRef = useRef<RoadmapData | null>(null);
  const isLocalUpdateRef = useRef(false);

  // Debounce connection state to prevent rapid state flapping
  const connectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastConnectionStateRef = useRef<boolean>(true);
  // Track last successful data receive for stale connection detection
  const lastDataReceivedRef = useRef<number>(Date.now());
  const staleCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Track subscription for re-subscribe on error
  const resubscribeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether error recovery is in progress to avoid competing with stale check
  const isRecoveringRef = useRef(false);
  // Track animation cleanup timeouts for proper cleanup on unmount
  const animationTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let unsubscribeConnection: (() => void) | null = null;
    let mounted = true;
    let resubscribeAttempts = 0;
    const MAX_RESUBSCRIBE_ATTEMPTS = 5;
    // Capture ref value at effect start for cleanup (avoids stale ref warning)
    const animationTimeouts = animationTimeoutsRef.current;

    // Set up visibility-based connection management
    const cleanupLifecycle = setupConnectionLifecycle();

    // Subscribe to roadmap data with error recovery.
    // subscriptionId tracks the current attempt — if a stale promise resolves
    // after a newer attempt started, its unsub is cleaned up immediately.
    let currentSubscriptionId = 0;

    const setupRoadmapSubscription = () => {
      const myId = ++currentSubscriptionId;
      isRecoveringRef.current = true;

      subscribeToRoadmap(
        (newData) => {
          if (!mounted) return;
          lastDataReceivedRef.current = Date.now();
          resubscribeAttempts = 0; // Reset on successful data
          isRecoveringRef.current = false;

          // If we have a pending local update, merge instead of discarding
          if (isLocalUpdateRef.current) {
            isLocalUpdateRef.current = false;
            const normalized = normalizeData(newData);
            dataRef.current = normalized;
            setData(normalized);
            setLoading(false);
            return;
          }

          setData(normalizeData(newData));
          setLoading(false);
        },
        (error) => {
          // Listener error - attempt to resubscribe with backoff
          if (!mounted) return;
          console.error('[useRoadmap] Listener error, will attempt resubscribe:', error);
          isRecoveringRef.current = true;

          // Clean up old subscription
          unsubscribe?.();
          unsubscribe = null;

          if (resubscribeAttempts < MAX_RESUBSCRIBE_ATTEMPTS) {
            resubscribeAttempts++;
            const delay = Math.min(1000 * Math.pow(2, resubscribeAttempts - 1), 30000);
            console.info(`[useRoadmap] Resubscribing in ${delay}ms (attempt ${resubscribeAttempts}/${MAX_RESUBSCRIBE_ATTEMPTS})`);

            resubscribeTimeoutRef.current = setTimeout(() => {
              if (mounted) setupRoadmapSubscription();
            }, delay);
          } else {
            isRecoveringRef.current = false;
            setSaveError('Connection lost. Please refresh the page.');
          }
        }
      ).then((unsub) => {
        if (!mounted) {
          unsub();
        } else if (myId !== currentSubscriptionId) {
          // A newer subscription attempt started — this one is stale, clean it up
          unsub();
        } else {
          unsubscribe = unsub;
          isRecoveringRef.current = false;
        }
      }).catch((error) => {
        // Only handle if this is still the active subscription attempt
        if (!mounted || myId !== currentSubscriptionId) return;

        console.error('[useRoadmap] Failed to subscribe to roadmap:', error);
        // Retry the initial subscription with backoff
        if (resubscribeAttempts < MAX_RESUBSCRIBE_ATTEMPTS) {
          resubscribeAttempts++;
          const delay = Math.min(1000 * Math.pow(2, resubscribeAttempts - 1), 30000);
          resubscribeTimeoutRef.current = setTimeout(() => {
            if (mounted) setupRoadmapSubscription();
          }, delay);
        } else {
          isRecoveringRef.current = false;
          setSaveError('Connection failed. Please refresh the page.');
          setLoading(false);
        }
      });
    };

    setupRoadmapSubscription();

    // Monitor connection state with debouncing to prevent flapping
    subscribeToConnectionState((connected) => {
      if (!mounted) return;

      if (connectionDebounceRef.current) {
        clearTimeout(connectionDebounceRef.current);
      }

      connectionDebounceRef.current = setTimeout(() => {
        if (lastConnectionStateRef.current !== connected) {
          const wasOffline = !lastConnectionStateRef.current;
          lastConnectionStateRef.current = connected;
          setIsOnline(connected);

          if (!connected) {
            console.warn('[Firebase] Connection lost. Changes will be saved when reconnected.');
          } else if (wasOffline) {
            // Coming back online - reset data timestamp to avoid false stale detection
            lastDataReceivedRef.current = Date.now();
            console.info('[Firebase] Connection restored.');
          }
        }
      }, 500);
    }).then((unsub) => {
      if (mounted) {
        unsubscribeConnection = unsub;
      } else {
        unsub();
      }
    }).catch((error) => {
      console.warn('[useRoadmap] Failed to monitor connection state:', error);
    });

    // Stale connection detection: if we think we're online but haven't received
    // data in 5 minutes, force reconnect to recover from zombie WebSockets.
    // Uses a cooldown (not a one-shot) so it retries if the first reconnect
    // doesn't restore data flow, but doesn't spam reconnects.
    const STALE_THRESHOLD_MS = 5 * 60 * 1000;
    const STALE_RECONNECT_COOLDOWN_MS = 2 * 60 * 1000; // 2 min between retries
    let lastStaleReconnectTime = 0;
    staleCheckIntervalRef.current = setInterval(() => {
      if (!mounted) return;
      const now = Date.now();
      const timeSinceData = now - lastDataReceivedRef.current;

      // No action needed if we've received data recently
      if (timeSinceData < STALE_THRESHOLD_MS) return;

      // Skip if: error recovery is running, we know we're offline, or cooldown active
      if (isRecoveringRef.current || !lastConnectionStateRef.current) return;
      if (now - lastStaleReconnectTime < STALE_RECONNECT_COOLDOWN_MS) return;

      lastStaleReconnectTime = now;
      console.warn(`[Firebase] No data received in ${Math.round(timeSinceData / 1000)}s while "connected". Force reconnecting...`);
      forceReconnect().catch(console.error);
    }, 60000); // Check every minute

    return () => {
      mounted = false;
      unsubscribe?.();
      unsubscribeConnection?.();
      cleanupLifecycle();
      if (connectionDebounceRef.current) {
        clearTimeout(connectionDebounceRef.current);
      }
      if (resubscribeTimeoutRef.current) {
        clearTimeout(resubscribeTimeoutRef.current);
      }
      if (staleCheckIntervalRef.current) {
        clearInterval(staleCheckIntervalRef.current);
      }
      // Clean up animation timeouts (uses value captured at effect start)
      animationTimeouts.forEach(t => clearTimeout(t));
      animationTimeouts.clear();
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
    startSaving();

    try {
      await saveWithRetry(sanitizedData);
      pendingUpdateRef.current = null;
      setLastSaved(new Date());
    } catch (error) {
      // Rollback on failure
      console.error('Save failed, rolling back:', error);
      dataRef.current = previousData;
      setData(previousData);
      pendingUpdateRef.current = null;
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    } finally {
      finishSaving();
    }
  }, [startSaving, finishSaving]);

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
    const existingMember = currentData.teamMembers.find(m => m.id === memberId);
    if (!existingMember) return;

    const updatedMember = { ...existingMember, ...updates };

    // Optimistic update
    const newMembers = currentData.teamMembers.map(m => m.id === memberId ? updatedMember : m);
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, teamMembers: newMembers };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific team member by ID
      await withRetry(() => updateTeamMemberAtPath(memberId, sanitizeForFirebase(updatedMember)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
      analytics.memberUpdated(memberId);
      setLastSaved(new Date());
    } catch (error) {
      // Rollback on failure
      dataRef.current = currentData;
      setData(currentData);
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    } finally {
      finishSaving();
    }
  }, [startSaving, finishSaving]);

  const deleteTeamMember = useCallback(async (memberId: string) => {
    const currentData = dataRef.current;
    const member = currentData.teamMembers.find(m => m.id === memberId);
    if (!member) return;

    // Collect IDs of projects being deleted (for dependency cleanup)
    const deletedProjectIds = new Set(
      currentData.projects.filter(p => p.owner === member.name).map(p => p.id)
    );
    const newProjects = currentData.projects.filter(p => p.owner !== member.name);
    const newMembers = currentData.teamMembers.filter(m => m.id !== memberId);
    // Clean up orphaned dependencies that reference the deleted projects
    const newDependencies = (currentData.dependencies || []).filter(
      d => !deletedProjectIds.has(d.fromProjectId) && !deletedProjectIds.has(d.toProjectId)
    );
    // Clean up orphaned leave blocks for this member
    const newLeaveBlocks = (currentData.leaveBlocks || []).filter(
      l => l.memberId !== memberId
    );
    await optimisticSave({
      ...currentData,
      projects: newProjects,
      teamMembers: newMembers,
      dependencies: newDependencies,
      leaveBlocks: newLeaveBlocks
    });
    analytics.memberDeleted(memberId);
  }, [optimisticSave]);

  const reorderTeamMembers = useCallback(async (fromIndex: number, toIndex: number) => {
    const currentData = dataRef.current;
    const newMembers = [...currentData.teamMembers];
    const [moved] = newMembers.splice(fromIndex, 1);
    newMembers.splice(toIndex, 0, moved);
    // Assign order fields based on new positions for ID-keyed Firebase storage
    const orderedMembers = newMembers.map((m, i) => ({ ...m, order: i }));
    await optimisticSave({ ...currentData, teamMembers: orderedMembers });
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
    const existingProject = currentData.projects.find(p => p.id === projectId);
    if (!existingProject) return;

    const updatedProject = { ...existingProject, ...updates };

    // Optimistic update
    const newProjects = currentData.projects.map(p => p.id === projectId ? updatedProject : p);
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, projects: newProjects };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific project by ID
      await withRetry(() => updateProjectAtPath(projectId, sanitizeForFirebase(updatedProject)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
      analytics.projectUpdated(projectId);
      setLastSaved(new Date());
    } catch (error) {
      // Rollback on failure
      dataRef.current = currentData;
      setData(currentData);
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    } finally {
      finishSaving();
    }
  }, [startSaving, finishSaving]);

  const deleteProject = useCallback(async (projectId: string) => {
    const currentData = dataRef.current;
    const newProjects = currentData.projects.filter(p => p.id !== projectId);
    // Clean up orphaned dependencies that reference this project
    const newDependencies = (currentData.dependencies || []).filter(
      d => d.fromProjectId !== projectId && d.toProjectId !== projectId
    );
    await optimisticSave({ ...currentData, projects: newProjects, dependencies: newDependencies });
    analytics.projectDeleted(projectId);
  }, [optimisticSave]);

  const addMilestone = useCallback(async (projectId: string, milestone: Omit<Milestone, 'id'>): Promise<Milestone> => {
    const currentData = dataRef.current;
    const newMilestone: Milestone = { ...milestone, id: uuidv4() };
    const newProjects = currentData.projects.map(p => {
      if (p.id === projectId) {
        // Guard against undefined milestones array
        return { ...p, milestones: [...(p.milestones || []), newMilestone] };
      }
      return p;
    });
    await optimisticSave({ ...currentData, projects: newProjects });
    analytics.milestoneCreated(newMilestone.id);

    // Track new milestone for entrance animation
    setNewMilestoneIds(prev => new Set(prev).add(newMilestone.id));
    // Clear after animation duration
    const timer = setTimeout(() => {
      animationTimeoutsRef.current.delete(timer);
      setNewMilestoneIds(prev => {
        const next = new Set(prev);
        next.delete(newMilestone.id);
        return next;
      });
    }, 500);
    animationTimeoutsRef.current.add(timer);

    return newMilestone;
  }, [optimisticSave]);

  const updateMilestone = useCallback(async (
    projectId: string,
    milestoneId: string,
    updates: Partial<Milestone>
  ) => {
    const currentData = dataRef.current;
    const project = currentData.projects.find(p => p.id === projectId);
    if (!project) return;

    // Guard against undefined milestones array
    const milestones = project.milestones || [];
    const existingMilestone = milestones.find(m => m.id === milestoneId);
    if (!existingMilestone) return;

    const updatedMilestone = { ...existingMilestone, ...updates };

    // Optimistic update
    const newMilestones = milestones.map(m => m.id === milestoneId ? updatedMilestone : m);
    const newProjects = currentData.projects.map(p =>
      p.id === projectId ? { ...p, milestones: newMilestones } : p
    );
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, projects: newProjects };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific milestone by ID
      await withRetry(() => updateMilestoneAtPath(projectId, milestoneId, sanitizeForFirebase(updatedMilestone)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
      analytics.milestoneUpdated(milestoneId);
      setLastSaved(new Date());
    } catch (error) {
      // Rollback on failure
      dataRef.current = currentData;
      setData(currentData);
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    } finally {
      finishSaving();
    }
  }, [startSaving, finishSaving]);

  const deleteMilestone = useCallback(async (projectId: string, milestoneId: string) => {
    const currentData = dataRef.current;
    const newProjects = currentData.projects.map(p => {
      if (p.id === projectId) {
        // Guard against undefined milestones array
        return { ...p, milestones: (p.milestones || []).filter(m => m.id !== milestoneId) };
      }
      return p;
    });
    // Clean up orphaned dependencies that reference this milestone
    const newDependencies = (currentData.dependencies || []).filter(
      d => d.fromMilestoneId !== milestoneId && d.toMilestoneId !== milestoneId
    );
    await optimisticSave({ ...currentData, projects: newProjects, dependencies: newDependencies });
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

    // Track new dependency for entrance animation
    setNewDependencyIds(prev => new Set(prev).add(newDependency.id));
    // Clear after animation duration
    const depTimer = setTimeout(() => {
      animationTimeoutsRef.current.delete(depTimer);
      setNewDependencyIds(prev => {
        const next = new Set(prev);
        next.delete(newDependency.id);
        return next;
      });
    }, 600);
    animationTimeoutsRef.current.add(depTimer);

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
    const existingDep = dependencies.find(d => d.id === dependencyId);
    if (!existingDep) return;

    const updatedDependency = { ...existingDep, ...updates };

    // Optimistic update
    const newDependencies = dependencies.map(d => d.id === dependencyId ? updatedDependency : d);
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, dependencies: newDependencies };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific dependency by ID
      await withRetry(() => updateDependencyAtPath(dependencyId, sanitizeForFirebase(updatedDependency)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
      setLastSaved(new Date());
    } catch (error) {
      // Rollback on failure
      dataRef.current = currentData;
      setData(currentData);
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    } finally {
      finishSaving();
    }
  }, [startSaving, finishSaving]);

  // Leave block operations
  const addLeaveBlock = useCallback(async (leaveBlock: Omit<LeaveBlock, 'id'>) => {
    const currentData = dataRef.current;
    const newLeaveBlock: LeaveBlock = { ...leaveBlock, id: uuidv4() };
    const newLeaveBlocks = [...(currentData.leaveBlocks || []), newLeaveBlock];
    await optimisticSave({ ...currentData, leaveBlocks: newLeaveBlocks });
    return newLeaveBlock;
  }, [optimisticSave]);

  const updateLeaveBlock = useCallback(async (leaveId: string, updates: Partial<LeaveBlock>) => {
    const currentData = dataRef.current;
    const leaveBlocks = currentData.leaveBlocks || [];
    const existingLeave = leaveBlocks.find(l => l.id === leaveId);
    if (!existingLeave) return;

    const updatedLeaveBlock = { ...existingLeave, ...updates };

    // Optimistic update
    const newLeaveBlocks = leaveBlocks.map(l => l.id === leaveId ? updatedLeaveBlock : l);
    isLocalUpdateRef.current = true;
    dataRef.current = { ...currentData, leaveBlocks: newLeaveBlocks };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific leave block by ID
      await withRetry(() => updateLeaveBlockAtPath(leaveId, sanitizeForFirebase(updatedLeaveBlock)), {
        maxRetries: 3,
        baseDelayMs: 500
      });
      setLastSaved(new Date());
    } catch (error) {
      dataRef.current = currentData;
      setData(currentData);
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    } finally {
      finishSaving();
    }
  }, [startSaving, finishSaving]);

  const deleteLeaveBlock = useCallback(async (leaveId: string) => {
    const currentData = dataRef.current;
    const newLeaveBlocks = (currentData.leaveBlocks || []).filter(l => l.id !== leaveId);
    await optimisticSave({ ...currentData, leaveBlocks: newLeaveBlocks });
  }, [optimisticSave]);

  // Period marker CRUD operations
  const addPeriodMarker = useCallback(async (marker: Omit<PeriodMarker, 'id'>) => {
    const currentData = dataRef.current;
    const newMarker: PeriodMarker = { ...marker, id: uuidv4() };
    const newMarkers = [...(currentData.periodMarkers || []), newMarker];
    await optimisticSave({ ...currentData, periodMarkers: newMarkers });
    return newMarker;
  }, [optimisticSave]);

  const updatePeriodMarker = useCallback(async (markerId: string, updates: Partial<PeriodMarker>) => {
    const currentData = dataRef.current;
    const markers = currentData.periodMarkers || [];
    const markerIndex = markers.findIndex(m => m.id === markerId);
    if (markerIndex === -1) return;

    const updatedMarker = { ...markers[markerIndex], ...updates };
    const newMarkers = [...markers];
    newMarkers[markerIndex] = updatedMarker;
    await optimisticSave({ ...currentData, periodMarkers: newMarkers });
  }, [optimisticSave]);

  const deletePeriodMarker = useCallback(async (markerId: string) => {
    const currentData = dataRef.current;
    const newMarkers = (currentData.periodMarkers || []).filter(m => m.id !== markerId);
    await optimisticSave({ ...currentData, periodMarkers: newMarkers });
  }, [optimisticSave]);

  return {
    data,
    loading,
    saveError,
    isOnline,
    isSaving,
    lastSaved,
    newMilestoneIds,
    newDependencyIds,
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
    updateDependency,
    addLeaveBlock,
    updateLeaveBlock,
    deleteLeaveBlock,
    addPeriodMarker,
    updatePeriodMarker,
    deletePeriodMarker
  };
}
