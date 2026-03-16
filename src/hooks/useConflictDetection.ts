import { useState, useCallback, useRef, useEffect } from 'react';
import type { RoadmapData } from '../types';

/**
 * Conflict detection for concurrent edits.
 *
 * Tracks when the user has unsaved local changes that might conflict
 * with incoming remote changes.
 */
export interface ConflictInfo {
  hasLocalChanges: boolean;
  remoteChangeDetected: boolean;
  lastLocalChangeTime: number | null;
  lastRemoteChangeTime: number | null;
}

export interface ConflictDetectionResult {
  conflict: ConflictInfo;
  markLocalChange: () => void;
  markRemoteChange: () => void;
  markSynced: () => void;
  shouldWarnAboutConflict: () => boolean;
}

/**
 * Hook for detecting potential conflicts between local and remote changes.
 *
 * Usage:
 * - Call `markLocalChange()` when the user makes a local edit
 * - Call `markRemoteChange()` when data is received from Firebase
 * - Call `markSynced()` when a save successfully completes
 * - Check `shouldWarnAboutConflict()` to determine if user should be warned
 */
export function useConflictDetection(): ConflictDetectionResult {
  const [conflict, setConflict] = useState<ConflictInfo>({
    hasLocalChanges: false,
    remoteChangeDetected: false,
    lastLocalChangeTime: null,
    lastRemoteChangeTime: null
  });

  // Track if we're the one making changes (to ignore our own updates)
  const isLocalOperationRef = useRef(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    };
  }, []);

  const markLocalChange = useCallback(() => {
    isLocalOperationRef.current = true;
    setConflict(prev => ({
      ...prev,
      hasLocalChanges: true,
      lastLocalChangeTime: Date.now()
    }));

    // Clear any existing timeout before setting a new one
    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);
    resetTimeoutRef.current = setTimeout(() => {
      isLocalOperationRef.current = false;
      resetTimeoutRef.current = null;
    }, 5000); // Must exceed max save retry time (3 retries × 500ms base + jitter)
  }, []);

  const markRemoteChange = useCallback(() => {
    // Don't mark as remote change if this was triggered by our own operation
    if (isLocalOperationRef.current) return;

    setConflict(prev => ({
      ...prev,
      remoteChangeDetected: true,
      lastRemoteChangeTime: Date.now()
    }));
  }, []);

  const markSynced = useCallback(() => {
    setConflict({
      hasLocalChanges: false,
      remoteChangeDetected: false,
      lastLocalChangeTime: null,
      lastRemoteChangeTime: null
    });
  }, []);

  const shouldWarnAboutConflict = useCallback(() => {
    return conflict.hasLocalChanges && conflict.remoteChangeDetected;
  }, [conflict.hasLocalChanges, conflict.remoteChangeDetected]);

  return {
    conflict,
    markLocalChange,
    markRemoteChange,
    markSynced,
    shouldWarnAboutConflict
  };
}

/**
 * Simple hash function for comparing data states.
 * Used to detect if data has actually changed.
 */
export function hashData(data: RoadmapData): string {
  // Hash structural IDs AND content fields so field-level edits are detected
  const str = JSON.stringify({
    projects: data.projects.map(p => ({
      id: p.id, title: p.title, owner: p.owner, startDate: p.startDate, endDate: p.endDate,
      statusColor: p.statusColor,
      milestones: (p.milestones || []).map(m => ({
        id: m.id, title: m.title, startDate: m.startDate, endDate: m.endDate, statusColor: m.statusColor,
      })).sort((a, b) => a.id.localeCompare(b.id)),
    })).sort((a, b) => a.id.localeCompare(b.id)),
    members: data.teamMembers.map(m => ({ id: m.id, name: m.name })).sort((a, b) => a.id.localeCompare(b.id)),
    deps: (data.dependencies || []).map(d => ({ id: d.id, from: d.fromProjectId, to: d.toProjectId, type: d.type })).sort((a, b) => a.id.localeCompare(b.id)),
    leaves: (data.leaveBlocks || []).map(l => ({ id: l.id, memberId: l.memberId, start: l.startDate, end: l.endDate })).sort((a, b) => a.id.localeCompare(b.id)),
    markerCount: (data.periodMarkers || []).length,
  });

  // Simple hash
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Hook for tracking data version/hash for conflict detection.
 */
export function useDataVersion(data: RoadmapData): {
  currentHash: string;
  previousHash: string | null;
  hasChanged: boolean;
} {
  const currentHash = hashData(data);
  const previousHashRef = useRef<string | null>(null);

  useEffect(() => {
    // After render, shift: current becomes previous for next comparison
    previousHashRef.current = currentHash;
  }, [currentHash]);

  return {
    currentHash,
    previousHash: previousHashRef.current,
    hasChanged: previousHashRef.current !== null && previousHashRef.current !== currentHash
  };
}
