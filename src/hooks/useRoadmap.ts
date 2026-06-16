import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
// Roadmap reads/writes go through our Vercel API proxy (src/api/roadmapApi.ts)
// rather than the Firebase SDK directly. This is the workaround for corporate
// VPNs / proxies (e.g. Imprivata, Zscaler) that block Firebase's WebSocket and
// long-polling endpoints. See api/db/[...path].ts.
import {
  subscribeToRoadmap,
  saveRoadmap,
  subscribeToConnectionState,
  updateProjectAtPath,
  updateMilestoneAtPath,
  updateDependencyAtPath,
  updateTeamMemberAtPath,
  updateLeaveBlockAtPath,
  batchUpdate,
  setupConnectionLifecycle,
  forceReconnect,
} from '../api/roadmapApi';
import { getLastFirebaseActivity } from '../firebase';
import { projectToFirebase } from '../utils/firebaseConversions';
import { createWriteCoalescer } from '../utils/writeCoalescer';
import { changedFields } from '../utils/objectDiff';
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

// Wrap a targeted multi-path PATCH (only the changed paths) with the same retry
// policy. Used by add/delete ops so they no longer re-upload the whole roadmap.
const batchWithRetry = (updates: Record<string, unknown>) =>
  withRetry(() => batchUpdate(updates), {
    maxRetries: 3,
    baseDelayMs: 500,
    onRetry: (error, attempt) => {
      console.warn(`Batch update failed, retry ${attempt}/3:`, error.message);
    }
  });

// Trailing debounce for the bursty project-edit write path (e.g. holding [ / ]
// to nudge dates). Long enough to coalesce a key-repeat burst, short enough
// that a single edit persists promptly. Optimistic UI is unaffected.
const WRITE_DEBOUNCE_MS = 400;

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

// Remove undefined values recursively (Firebase rejects undefined but accepts null)
export function sanitizeForFirebase<T>(obj: T): T {
  if (obj === undefined) {
    return null as T;
  }
  if (obj === null) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirebase(item)) as T;
  }
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) continue; // Strip undefined keys entirely
      result[key] = sanitizeForFirebase(value);
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
  // Also drives remote-echo suppression for the polling sync model: while any
  // write is in flight (count > 0), incoming poll snapshots are ignored so they
  // can't clobber freshly-applied optimistic state. `lastSaveCompletedAtRef`
  // extends that protection for a short cooldown after the last write settles,
  // covering the read-after-write race where a poll request issued *before* our
  // write reached the server returns stale data *after* the write completes.
  const savingCountRef = useRef(0);
  const lastSaveCompletedAtRef = useRef(0);
  const startSaving = useCallback(() => {
    savingCountRef.current++;
    setIsSaving(true);
  }, []);
  const finishSaving = useCallback(() => {
    savingCountRef.current = Math.max(0, savingCountRef.current - 1);
    if (savingCountRef.current === 0) {
      setIsSaving(false);
      lastSaveCompletedAtRef.current = Date.now();
    }
  }, []);

  // Coalesces bursts of project edits into one trailing write. Bracketing each
  // burst with startSaving/finishSaving keeps the "saving" indicator on and —
  // crucially — keeps remote-echo poll suppression active for the whole window,
  // so an in-flight poll can't overwrite the optimistic edit before it persists.
  const writeCoalescer = useMemo(
    () => createWriteCoalescer(WRITE_DEBOUNCE_MS, { onBurstStart: startSaving, onBurstEnd: finishSaving }),
    [startSaving, finishSaving]
  );
  // Per-key pre-burst snapshot, used to roll back if a coalesced write fails.
  const writeRollbackRef = useRef<Map<string, RoadmapData>>(new Map());

  // Don't lose a debounced edit if the tab is hidden/closed or the hook unmounts
  // mid-window: flush any pending coalesced writes immediately.
  useEffect(() => {
    const flush = () => writeCoalescer.flushAll();
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      writeCoalescer.flushAll();
    };
  }, [writeCoalescer]);

  // Track pending optimistic updates for rollback
  const pendingUpdateRef = useRef<RoadmapData | null>(null);
  // Serialized snapshot of the last remote data we applied — lets the poll
  // callback skip redundant setData() calls when nothing changed since the
  // previous poll (the proxy always delivers every tick).
  const lastSyncedRef = useRef<string | null>(null);
  // A remote snapshot that arrived while our own write was in flight (or during
  // the post-save cooldown) and was therefore deferred rather than applied.
  // Because the proxy de-dupes via ETag, an unchanged snapshot is never
  // re-delivered, so we must hold the deferred one and apply it once the
  // suppression window clears — otherwise a teammate's concurrent change is
  // lost until the next unrelated write or a full reload.
  const deferredSnapshotRef = useRef<{ data: RoadmapData; receivedAt: number } | null>(null);
  const deferredFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Suppress remote snapshots while our own writes are in flight, and for a
    // short cooldown afterwards, so a stale poll can't overwrite optimistic
    // state during the read-after-write race.
    const POST_SAVE_COOLDOWN_MS = 1500;

    const isSuppressing = () =>
      savingCountRef.current > 0 ||
      Date.now() - lastSaveCompletedAtRef.current < POST_SAVE_COOLDOWN_MS;

    // Apply a snapshot to local state, de-duping against the last applied one
    // (the proxy delivers a snapshot every poll, so skip setState when nothing
    // actually changed).
    const applySnapshot = (newData: RoadmapData) => {
      const normalized = normalizeData(newData);
      const serialized = JSON.stringify(normalized);
      if (serialized === lastSyncedRef.current) {
        setLoading(false);
        return;
      }
      lastSyncedRef.current = serialized;
      setData(normalized);
      setLoading(false);
    };

    // After the suppression window clears, apply the snapshot we deferred (if
    // any). Only apply one that arrived *after* our last write settled — an
    // older one may predate our own change and would revert it; that case
    // self-heals because the proxy ETag advanced past it, so the next poll
    // re-delivers the correct merged state.
    const scheduleDeferredFlush = () => {
      if (deferredFlushTimerRef.current) return;
      const elapsed = Date.now() - lastSaveCompletedAtRef.current;
      const delay = Math.max(POST_SAVE_COOLDOWN_MS - elapsed, 50);
      deferredFlushTimerRef.current = setTimeout(() => {
        deferredFlushTimerRef.current = null;
        if (!mounted) return;
        if (isSuppressing()) {
          scheduleDeferredFlush();
          return;
        }
        const pending = deferredSnapshotRef.current;
        deferredSnapshotRef.current = null;
        if (pending && pending.receivedAt >= lastSaveCompletedAtRef.current) {
          applySnapshot(pending.data);
        }
      }, delay);
    };

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

          if (isSuppressing()) {
            // Don't apply now, but hold onto it: the proxy won't re-deliver an
            // unchanged snapshot, so dropping it outright would lose a
            // teammate's concurrent change.
            deferredSnapshotRef.current = { data: newData, receivedAt: Date.now() };
            scheduleDeferredFlush();
            setLoading(false);
            return;
          }

          // A fresh snapshot supersedes any deferred one.
          deferredSnapshotRef.current = null;
          applySnapshot(newData);
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
            setLoading(false);
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
    // Also checks global Firebase activity (game listeners, presence, etc.) so
    // we don't force-reconnect when the connection is alive but only the
    // roadmap path is quiet (e.g. user is playing a game).
    const STALE_THRESHOLD_MS = 5 * 60 * 1000;
    const STALE_RECONNECT_COOLDOWN_MS = 2 * 60 * 1000; // 2 min between retries
    let lastStaleReconnectTime = 0;
    staleCheckIntervalRef.current = setInterval(() => {
      if (!mounted) return;
      const now = Date.now();
      const timeSinceData = now - lastDataReceivedRef.current;

      // No action needed if we've received data recently on the roadmap path
      if (timeSinceData < STALE_THRESHOLD_MS) return;

      // Also skip if ANY Firebase listener received data recently (e.g. game in progress)
      const timeSinceAnyActivity = now - getLastFirebaseActivity();
      if (timeSinceAnyActivity < STALE_THRESHOLD_MS) return;

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
      if (deferredFlushTimerRef.current) {
        clearTimeout(deferredFlushTimerRef.current);
        deferredFlushTimerRef.current = null;
      }
      if (staleCheckIntervalRef.current) {
        clearInterval(staleCheckIntervalRef.current);
      }
      // Clean up animation timeouts (uses value captured at effect start)
      animationTimeouts.forEach(t => clearTimeout(t));
      animationTimeouts.clear();
    };
  }, []);

  // Tracks how many optimisticSave calls are currently in-flight.
  // Only clear the rollback snapshot when ALL have resolved.
  const pendingSaveCountRef = useRef(0);

  // Optimistic save: update UI immediately, save in background, rollback on failure.
  //
  // `write` lets the caller persist only the paths that actually changed via a
  // targeted PATCH instead of re-uploading the whole roadmap. This is both
  // cheaper (no full-tree payload) and safer for concurrent editing: a full PUT
  // overwrites the entire tree and can clobber another user's unrelated change,
  // whereas a PATCH touches only the given paths. When omitted we fall back to
  // the full-tree save (used for rollback and any whole-document rewrite).
  const optimisticSave = useCallback(async (
    newData: RoadmapData,
    write?: () => Promise<void>
  ) => {
    // Capture pre-save state for rollback. On first concurrent save, snapshot current data.
    // Subsequent concurrent saves keep the original pre-save snapshot.
    const rollbackData = pendingUpdateRef.current ?? dataRef.current;
    pendingUpdateRef.current = rollbackData;
    pendingSaveCountRef.current++;

    // Sanitize data to remove undefined values (Firebase rejects them)
    const sanitizedData = sanitizeForFirebase(normalizeData(newData));

    // Update both state and ref immediately (optimistic)
    dataRef.current = sanitizedData;
    setData(sanitizedData);
    setSaveError(null);
    startSaving();

    try {
      await (write ? write() : saveWithRetry(sanitizedData));
      setLastSaved(new Date());
    } catch (error) {
      // Rollback on failure to pre-save snapshot
      console.error('Save failed, rolling back:', error);
      dataRef.current = rollbackData;
      setData(rollbackData);
      setSaveError(error instanceof Error ? error.message : 'Failed to save');
      throw error;
    } finally {
      pendingSaveCountRef.current--;
      // Only clear rollback snapshot when ALL concurrent saves have finished
      if (pendingSaveCountRef.current === 0) {
        pendingUpdateRef.current = null;
      }
      finishSaving();
    }
  }, [startSaving, finishSaving]);

  const clearError = useCallback(() => setSaveError(null), []);

  const addTeamMember = useCallback(async (member: Omit<TeamMember, 'id'>) => {
    const currentData = dataRef.current;
    // Assign order explicitly (a full save would renumber by index, but a
    // targeted write won't, so append at the end of the current list).
    const newMember: TeamMember = { ...member, id: uuidv4(), order: currentData.teamMembers.length };
    await optimisticSave(
      { ...currentData, teamMembers: [...currentData.teamMembers, newMember] },
      () => batchWithRetry({ [`teamMembers/${newMember.id}`]: sanitizeForFirebase(newMember) })
    );
    analytics.memberAdded(newMember.id);
  }, [optimisticSave]);

  const updateTeamMember = useCallback(async (memberId: string, updates: Partial<TeamMember>) => {
    const currentData = dataRef.current;
    const existingMember = currentData.teamMembers.find(m => m.id === memberId);
    if (!existingMember) return;

    const updatedMember = { ...existingMember, ...updates };

    // Optimistic update
    const newMembers = currentData.teamMembers.map(m => m.id === memberId ? updatedMember : m);
    dataRef.current = { ...currentData, teamMembers: newMembers };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific team member by ID
      // Write only the changed fields (field-level merge), not the whole member.
      await withRetry(() => updateTeamMemberAtPath(memberId, sanitizeForFirebase(updates)), {
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
    // Delete exactly the affected paths (member + owned projects + orphaned
    // dependencies + orphaned leave blocks) in one atomic PATCH.
    const paths: Record<string, unknown> = { [`teamMembers/${memberId}`]: null };
    for (const id of deletedProjectIds) paths[`projects/${id}`] = null;
    for (const d of (currentData.dependencies || [])) {
      if (deletedProjectIds.has(d.fromProjectId) || deletedProjectIds.has(d.toProjectId)) {
        paths[`dependencies/${d.id}`] = null;
      }
    }
    for (const l of (currentData.leaveBlocks || [])) {
      if (l.memberId === memberId) paths[`leaveBlocks/${l.id}`] = null;
    }
    await optimisticSave(
      { ...currentData, projects: newProjects, teamMembers: newMembers, dependencies: newDependencies, leaveBlocks: newLeaveBlocks },
      () => batchWithRetry(paths)
    );
    analytics.memberDeleted(memberId);
  }, [optimisticSave]);

  const reorderTeamMembers = useCallback(async (fromIndex: number, toIndex: number) => {
    const currentData = dataRef.current;
    const newMembers = [...currentData.teamMembers];
    const [moved] = newMembers.splice(fromIndex, 1);
    newMembers.splice(toIndex, 0, moved);
    // Assign order fields based on new positions for ID-keyed Firebase storage
    const orderedMembers = newMembers.map((m, i) => ({ ...m, order: i }));
    // Write only the teamMembers subtree (one path per member) so the reorder
    // doesn't rewrite — and risk clobbering — unrelated collections.
    const paths: Record<string, unknown> = {};
    for (const m of orderedMembers) paths[`teamMembers/${m.id}`] = sanitizeForFirebase(m);
    await optimisticSave({ ...currentData, teamMembers: orderedMembers }, () => batchWithRetry(paths));
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
    await optimisticSave(
      { ...currentData, projects: [...currentData.projects, newProject] },
      () => batchWithRetry({ [`projects/${newProject.id}`]: projectToFirebase(sanitizeForFirebase(newProject)) })
    );
    analytics.projectCreated(newProject.id);
    return newProject;
  }, [optimisticSave]);

  // The one hot, bursty write path: holding [ / ] to nudge a selected project's
  // dates fires this on every key-repeat. Each call applies the optimistic state
  // immediately, but the network write is coalesced (one trailing PUT per
  // project) so a burst is a single write rather than dozens. On failure the
  // optimistic state rolls back to the pre-burst snapshot and the error surfaces
  // via the global saveError toast (so we deliberately don't reject here — many
  // callers fire-and-forget, and an unhandled rejection would be noise).
  const updateProject = useCallback((projectId: string, updates: Partial<Project>): Promise<void> => {
    const currentData = dataRef.current;
    const existingProject = currentData.projects.find(p => p.id === projectId);
    if (!existingProject) return Promise.resolve();

    const updatedProject = { ...existingProject, ...updates };

    // Optimistic update (immediate, on every call)
    const newProjects = currentData.projects.map(p => p.id === projectId ? updatedProject : p);
    dataRef.current = { ...currentData, projects: newProjects };
    setData(dataRef.current);

    const key = `project:${projectId}`;
    // Capture the pre-burst snapshot once, on the first edit of a burst.
    if (!writeCoalescer.has(key)) writeRollbackRef.current.set(key, currentData);

    writeCoalescer.schedule(key, async () => {
      const rollback = writeRollbackRef.current.get(key);
      writeRollbackRef.current.delete(key);
      // Diff the *accumulated* burst against the pre-burst snapshot, then write
      // only the changed fields. Reading from dataRef here (not the closed-over
      // value) captures every edit in the burst — polls are suppressed while
      // saving, so dataRef only reflects our own optimistic edits. This both
      // coalesces the burst into one write and avoids clobbering a concurrent
      // edit to other fields of the same project.
      const before = rollback?.projects.find(p => p.id === projectId);
      const after = dataRef.current.projects.find(p => p.id === projectId);
      if (!after) return; // project was deleted mid-burst
      const patch = changedFields(before, after);
      if (Object.keys(patch).length === 0) return; // nothing actually changed
      try {
        await withRetry(() => updateProjectAtPath(projectId, sanitizeForFirebase(patch)), {
          maxRetries: 3,
          baseDelayMs: 500
        });
        analytics.projectUpdated(projectId);
        setLastSaved(new Date());
      } catch (error) {
        if (rollback) {
          dataRef.current = rollback;
          setData(rollback);
        }
        setSaveError(error instanceof Error ? error.message : 'Failed to save');
      }
    });

    // Resolve immediately: the optimistic update is already applied and the
    // persisted write is coalesced. Failures surface via saveError, not a reject.
    return Promise.resolve();
  }, [writeCoalescer]);

  const deleteProject = useCallback(async (projectId: string) => {
    const currentData = dataRef.current;
    const newProjects = currentData.projects.filter(p => p.id !== projectId);
    // Clean up orphaned dependencies that reference this project
    const newDependencies = (currentData.dependencies || []).filter(
      d => d.fromProjectId !== projectId && d.toProjectId !== projectId
    );
    const paths: Record<string, unknown> = { [`projects/${projectId}`]: null };
    for (const d of (currentData.dependencies || [])) {
      if (d.fromProjectId === projectId || d.toProjectId === projectId) {
        paths[`dependencies/${d.id}`] = null;
      }
    }
    await optimisticSave(
      { ...currentData, projects: newProjects, dependencies: newDependencies },
      () => batchWithRetry(paths)
    );
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
    await optimisticSave(
      { ...currentData, projects: newProjects },
      () => batchWithRetry({ [`projects/${projectId}/milestones/${newMilestone.id}`]: sanitizeForFirebase(newMilestone) })
    );
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
    dataRef.current = { ...currentData, projects: newProjects };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific milestone by ID
      // Write only the changed fields (field-level merge), not the whole milestone.
      await withRetry(() => updateMilestoneAtPath(projectId, milestoneId, sanitizeForFirebase(updates)), {
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
    const paths: Record<string, unknown> = { [`projects/${projectId}/milestones/${milestoneId}`]: null };
    for (const d of (currentData.dependencies || [])) {
      if (d.fromMilestoneId === milestoneId || d.toMilestoneId === milestoneId) {
        paths[`dependencies/${d.id}`] = null;
      }
    }
    await optimisticSave(
      { ...currentData, projects: newProjects, dependencies: newDependencies },
      () => batchWithRetry(paths)
    );
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
    await optimisticSave(
      { ...currentData, dependencies: newDependencies },
      () => batchWithRetry({ [`dependencies/${newDependency.id}`]: sanitizeForFirebase(newDependency) })
    );

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
    await optimisticSave(
      { ...currentData, dependencies: newDependencies },
      () => batchWithRetry({ [`dependencies/${dependencyId}`]: null })
    );
  }, [optimisticSave]);

  const updateDependency = useCallback(async (dependencyId: string, updates: Partial<Dependency>) => {
    const currentData = dataRef.current;
    const dependencies = currentData.dependencies || [];
    const existingDep = dependencies.find(d => d.id === dependencyId);
    if (!existingDep) return;

    const updatedDependency = { ...existingDep, ...updates };

    // Optimistic update
    const newDependencies = dependencies.map(d => d.id === dependencyId ? updatedDependency : d);
    dataRef.current = { ...currentData, dependencies: newDependencies };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific dependency by ID
      // Write only the changed fields (field-level merge), not the whole dependency.
      await withRetry(() => updateDependencyAtPath(dependencyId, sanitizeForFirebase(updates)), {
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
    await optimisticSave(
      { ...currentData, leaveBlocks: newLeaveBlocks },
      () => batchWithRetry({ [`leaveBlocks/${newLeaveBlock.id}`]: sanitizeForFirebase(newLeaveBlock) })
    );
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
    dataRef.current = { ...currentData, leaveBlocks: newLeaveBlocks };
    setData(dataRef.current);
    startSaving();

    try {
      // Granular Firebase update - only updates this specific leave block by ID
      // Write only the changed fields (field-level merge), not the whole leave block.
      await withRetry(() => updateLeaveBlockAtPath(leaveId, sanitizeForFirebase(updates)), {
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
    await optimisticSave(
      { ...currentData, leaveBlocks: newLeaveBlocks },
      () => batchWithRetry({ [`leaveBlocks/${leaveId}`]: null })
    );
  }, [optimisticSave]);

  // Period marker CRUD operations
  const addPeriodMarker = useCallback(async (marker: Omit<PeriodMarker, 'id'>) => {
    const currentData = dataRef.current;
    const newMarker: PeriodMarker = { ...marker, id: uuidv4() };
    const newMarkers = [...(currentData.periodMarkers || []), newMarker];
    await optimisticSave(
      { ...currentData, periodMarkers: newMarkers },
      () => batchWithRetry({ [`periodMarkers/${newMarker.id}`]: sanitizeForFirebase(newMarker) })
    );
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
    await optimisticSave(
      { ...currentData, periodMarkers: newMarkers },
      () => batchWithRetry({ [`periodMarkers/${markerId}`]: sanitizeForFirebase(updatedMarker) })
    );
  }, [optimisticSave]);

  const deletePeriodMarker = useCallback(async (markerId: string) => {
    const currentData = dataRef.current;
    const newMarkers = (currentData.periodMarkers || []).filter(m => m.id !== markerId);
    await optimisticSave(
      { ...currentData, periodMarkers: newMarkers },
      () => batchWithRetry({ [`periodMarkers/${markerId}`]: null })
    );
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
