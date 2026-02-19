import { useState, useEffect, useCallback, useRef } from 'react';
import {
  updatePresence,
  updateEditingStatus,
  removePresence,
  subscribeToPresence,
  subscribeToConnectionState,
  heartbeatPresence,
  HIDDEN_DISCONNECT_MS,
  type PresenceUser
} from '../firebase';

// Predefined colors for presence avatars
const PRESENCE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
];

/**
 * Get a consistent color for a user based on their session ID.
 */
function getColorForUser(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i++) {
    const char = sessionId.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

/**
 * Generate initials from a name.
 */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

interface UsePresenceOptions {
  sessionId: string;
  userName: string;
  enabled?: boolean;
}

interface UsePresenceResult {
  /** All online users (including self) */
  users: PresenceUser[];
  /** Other online users (excluding self) */
  otherUsers: PresenceUser[];
  /** Current user's presence data */
  currentUser: PresenceUser | null;
  /** Set the project ID being edited */
  setEditingProject: (projectId: string | null) => void;
  /** Check if a project is being edited by someone else */
  isProjectBeingEdited: (projectId: string) => PresenceUser | null;
  /** Whether presence is connected */
  isConnected: boolean;
}

/**
 * Hook for managing real-time presence.
 *
 * Usage:
 * ```tsx
 * const { users, otherUsers, setEditingProject, isProjectBeingEdited } = usePresence({
 *   sessionId: 'user-123',
 *   userName: 'John Doe'
 * });
 * ```
 */
export function usePresence({
  sessionId,
  userName,
  enabled = true
}: UsePresenceOptions): UsePresenceResult {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Initialize presence
  useEffect(() => {
    if (!enabled || !sessionId || !userName) return;

    let mounted = true;
    const color = getColorForUser(sessionId);

    // Set up presence
    const setup = async () => {
      try {
        // Update presence
        await updatePresence(sessionId, { name: userName, color });

        if (!mounted) return;
        setIsConnected(true);

        // Subscribe to presence updates
        const unsubscribe = await subscribeToPresence((presenceUsers) => {
          if (mounted) {
            setUsers(presenceUsers);
          }
        });

        cleanupRef.current = unsubscribe;

        // Set up heartbeat (every 30 seconds)
        heartbeatRef.current = setInterval(() => {
          heartbeatPresence(sessionId).catch(console.error);
        }, 30000);
      } catch (error) {
        console.error('Failed to initialize presence:', error);
        if (mounted) {
          setIsConnected(false);
        }
      }
    };

    setup();

    // Cleanup on unmount
    return () => {
      mounted = false;

      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }

      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      // Remove presence (fire and forget)
      removePresence(sessionId).catch(console.error);
    };
  }, [sessionId, userName, enabled]);

  // Handle page visibility changes - pause heartbeats when hidden, resume when visible.
  // On return from extended hidden period, re-register full presence because
  // goOffline() triggers server-side onDisconnect which deletes our presence entry.
  const hiddenAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !sessionId) return;

    const color = getColorForUser(sessionId);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const wasHiddenFor = hiddenAtRef.current ? Date.now() - hiddenAtRef.current : 0;
        hiddenAtRef.current = null;

        if (wasHiddenFor >= HIDDEN_DISCONNECT_MS) {
          // After extended hidden period, onDisconnect may have deleted our presence.
          // Re-register full presence (not just heartbeat) to restore name, color, etc.
          updatePresence(sessionId, { name: userName, color }).catch(console.error);
        } else {
          // Short hide — just heartbeat to update lastSeen
          heartbeatPresence(sessionId).catch(console.error);
        }

        // Restart heartbeat interval if it was cleared
        if (!heartbeatRef.current) {
          heartbeatRef.current = setInterval(() => {
            heartbeatPresence(sessionId).catch(console.error);
          }, 30000);
        }
      } else {
        hiddenAtRef.current = Date.now();
        // Tab hidden - stop heartbeat interval to reduce unnecessary writes
        if (heartbeatRef.current) {
          clearInterval(heartbeatRef.current);
          heartbeatRef.current = null;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [sessionId, userName, enabled]);

  // Handle page unload
  useEffect(() => {
    if (!enabled || !sessionId) return;

    const handleBeforeUnload = () => {
      // Try to remove presence on page close
      // Note: This may not always succeed due to browser restrictions
      removePresence(sessionId).catch(() => {
        // Ignore errors on unload
      });
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [sessionId, enabled]);

  // Re-register onDisconnect when Firebase silently reconnects.
  // Without this, a network interruption would lose the server-side onDisconnect
  // handler, leaving zombie presence entries if the user later closes the tab.
  useEffect(() => {
    if (!enabled || !sessionId || !userName) return;

    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    const color = getColorForUser(sessionId);

    // Track previous connection state to detect false→true transitions
    let wasConnected = true; // Assume initially connected (initial setup handles first registration)

    subscribeToConnectionState((connected) => {
      if (!mounted) return;
      if (connected && !wasConnected) {
        // Connection restored — re-register full presence + onDisconnect
        updatePresence(sessionId, { name: userName, color }).catch(console.error);
      }
      wasConnected = connected;
    }).then((unsub) => {
      if (mounted) {
        unsubscribe = unsub;
      } else {
        unsub();
      }
    }).catch(console.error);

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [sessionId, userName, enabled]);

  const setEditingProject = useCallback((projectId: string | null) => {
    if (!enabled || !sessionId) return;
    updateEditingStatus(sessionId, projectId).catch(console.error);
  }, [sessionId, enabled]);

  const isProjectBeingEdited = useCallback((projectId: string): PresenceUser | null => {
    return users.find(
      (user) => user.id !== sessionId && user.editingProjectId === projectId
    ) || null;
  }, [users, sessionId]);

  const currentUser = users.find((u) => u.id === sessionId) || null;
  const otherUsers = users.filter((u) => u.id !== sessionId);

  return {
    users,
    otherUsers,
    currentUser,
    setEditingProject,
    isProjectBeingEdited,
    isConnected
  };
}

export type { PresenceUser };
