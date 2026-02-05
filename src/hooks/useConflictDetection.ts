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

  const markLocalChange = useCallback(() => {
    isLocalOperationRef.current = true;
    setConflict(prev => ({
      ...prev,
      hasLocalChanges: true,
      lastLocalChangeTime: Date.now()
    }));

    // Reset the flag after a short delay
    setTimeout(() => {
      isLocalOperationRef.current = false;
    }, 500);
  }, []);

  const markRemoteChange = useCallback(() => {
    // Don't mark as remote change if this was triggered by our own operation
    if (isLocalOperationRef.current) return;

    setConflict(prev => ({
      ...prev,
      remoteChangeDetected: prev.hasLocalChanges, // Only flag if we have unsaved local changes
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
  // Simple but fast hash for change detection
  const str = JSON.stringify({
    projectCount: data.projects.length,
    projectIds: data.projects.map(p => p.id).sort(),
    memberCount: data.teamMembers.length,
    memberIds: data.teamMembers.map(m => m.id).sort(),
    depCount: (data.dependencies || []).length,
    leaveCount: (data.leaveBlocks || []).length,
    markerCount: (data.periodMarkers || []).length
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

  const hasChanged = previousHashRef.current !== null && previousHashRef.current !== currentHash;

  // Update previous hash on next render
  useEffect(() => {
    previousHashRef.current = currentHash;
  }, [currentHash]);

  return {
    currentHash,
    previousHash: previousHashRef.current,
    hasChanged
  };
}
