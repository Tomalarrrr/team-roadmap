import type { RoadmapData, Project, Milestone, Dependency, TeamMember, LeaveBlock, PeriodMarker } from './types';
import { firebaseSnapshotToRoadmapData, roadmapDataToFirebaseFormat, projectToFirebase, arrayToKeyedObject, isLegacyArrayFormat } from './utils/firebaseConversions';
import type { FirebaseApp } from 'firebase/app';
import type { Database, DatabaseReference, Unsubscribe } from 'firebase/database';

// Validate Firebase configuration
function validateFirebaseConfig() {
  const requiredEnvVars = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_DATABASE_URL',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_STORAGE_BUCKET',
    'VITE_FIREBASE_MESSAGING_SENDER_ID',
    'VITE_FIREBASE_APP_ID'
  ];

  const missing = requiredEnvVars.filter(key => !import.meta.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required Firebase configuration: ${missing.join(', ')}. ` +
      'Please set these environment variables in your .env file.'
    );
  }
}

// Validate config on module load
validateFirebaseConfig();

// Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Lazy-loaded Firebase instances
let app: FirebaseApp | null = null;
let database: Database | null = null;
let roadmapRef: DatabaseReference | null = null;
let initPromise: Promise<void> | null = null;

// Cached firebase/database module — avoids repeated `await import()` microtask overhead
// on every function call after initialization.
let dbModule: typeof import('firebase/database') | null = null;

// Dynamically import and initialize Firebase (deferred)
async function initializeFirebase(): Promise<void> {
  if (app && database && roadmapRef && dbModule) return;

  try {
    const [firebaseApp, firebaseDb] = await Promise.all([
      import('firebase/app'),
      import('firebase/database')
    ]);

    dbModule = firebaseDb;
    // Use existing app if a previous partial init created it but something else failed
    app = firebaseApp.getApps().length
      ? firebaseApp.getApp()
      : firebaseApp.initializeApp(firebaseConfig);
    database = firebaseDb.getDatabase(app);
    roadmapRef = firebaseDb.ref(database, 'roadmap');
  } catch (error) {
    // Allow re-initialization on failure
    initPromise = null;
    throw new Error(
      `Failed to initialize Firebase: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      'Please check your Firebase configuration and network connection.'
    );
  }
}

// Get the cached database module (only valid after initialization)
function getDbModule() {
  if (!dbModule) throw new Error('Firebase not initialized');
  return dbModule;
}

// Ensure Firebase is initialized before use
function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeFirebase();
  }
  return initPromise;
}

// ============================================
// CONNECTION LIFECYCLE MANAGEMENT
// ============================================

let visibilityHandler: (() => void) | null = null;
// Disconnect after 2 minutes of being hidden to prevent zombie WebSockets.
// Exported so usePresence can align its re-registration threshold.
export const HIDDEN_DISCONNECT_MS = 2 * 60 * 1000;
let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
// Track whether we actually completed a goOffline call
let didGoOffline = false;

/**
 * Manage Firebase connection based on tab visibility.
 * Disconnects after extended hidden periods to prevent zombie WebSockets,
 * and reconnects immediately when the tab becomes visible again.
 */
export function setupConnectionLifecycle(): () => void {
  if (visibilityHandler) return () => {}; // Already set up

  visibilityHandler = () => {
    if (document.visibilityState === 'hidden') {
      // Schedule disconnect after extended hidden period
      hiddenTimer = setTimeout(() => {
        if (!database || !dbModule) return;
        // Check we're still hidden (user may have returned while timer was pending)
        if (document.visibilityState !== 'hidden') return;
        dbModule.goOffline(database);
        didGoOffline = true;
        console.info('[Firebase] Went offline after extended hidden period');
      }, HIDDEN_DISCONNECT_MS);
    } else {
      // Tab became visible - cancel pending disconnect
      if (hiddenTimer) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }

      // Only reconnect if we actually disconnected
      if (didGoOffline && database && dbModule) {
        didGoOffline = false;
        dbModule.goOnline(database);
        console.info('[Firebase] Reconnected after tab became visible');
      }
    }
  };

  document.addEventListener('visibilitychange', visibilityHandler);

  // Also handle beforeunload to clean up
  const unloadHandler = () => {
    if (hiddenTimer) {
      clearTimeout(hiddenTimer);
    }
  };
  window.addEventListener('beforeunload', unloadHandler);

  return () => {
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
    window.removeEventListener('beforeunload', unloadHandler);
    if (hiddenTimer) {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
    }
    didGoOffline = false;
  };
}

/**
 * Force reconnect the Firebase database connection.
 * Useful for recovering from stale WebSocket states.
 */
export async function forceReconnect(): Promise<void> {
  if (!database || !dbModule) return;
  dbModule.goOffline(database);
  // Small delay to ensure clean disconnect before reconnecting
  await new Promise(resolve => setTimeout(resolve, 100));
  dbModule.goOnline(database);
  console.info('[Firebase] Force reconnected');
}

// Auto-migration: tracks whether legacy array→keyed-object migration has been checked/completed.
// Granular update functions await this promise to prevent writes to the wrong path format.
let migrationChecked = false;
let migrationPromise: Promise<void> | null = null;

export async function subscribeToRoadmap(
  callback: (data: RoadmapData) => void,
  onError?: (error: Error) => void
): Promise<Unsubscribe> {
  await ensureInitialized();
  const { onValue, set } = getDbModule();

  const unsubscribe = onValue(
    roadmapRef!,
    (snapshot) => {
      const data = snapshot.val();
      const roadmapData = firebaseSnapshotToRoadmapData(data);

      // One-time auto-migration: if data is in legacy array format,
      // rewrite it in keyed-object format before any granular updates can run.
      if (!migrationChecked && data) {
        migrationChecked = true;
        if (isLegacyArrayFormat(data)) {
          console.info('[Firebase] Legacy array format detected, migrating to keyed-object format...');
          migrationPromise = set(roadmapRef!, roadmapDataToFirebaseFormat(roadmapData))
            .then(() => {
              console.info('[Firebase] Migration complete');
              migrationPromise = null;
            })
            .catch((err) => {
              console.error('[Firebase] Migration failed:', err);
              migrationChecked = false; // Allow retry on next callback
              migrationPromise = null;
            });
        }
      }

      callback(roadmapData);
    },
    (error) => {
      console.error('[Firebase] Roadmap listener error:', error);
      onError?.(error);
    }
  );
  return unsubscribe;
}

export async function subscribeToConnectionState(callback: (connected: boolean) => void): Promise<Unsubscribe> {
  await ensureInitialized();
  const { onValue, ref } = getDbModule();

  // Firebase's special .info/connected location tracks connection state
  const connectedRef = ref(database!, '.info/connected');

  const unsubscribe = onValue(
    connectedRef,
    (snapshot) => {
      const connected = snapshot.val() === true;
      callback(connected);
    },
    (error) => {
      console.error('[Firebase] Connection state listener error:', error);
      // Assume disconnected on listener error
      callback(false);
    }
  );

  return unsubscribe;
}

export async function saveRoadmap(data: RoadmapData): Promise<void> {
  await ensureInitialized();
  const { set } = getDbModule();
  await set(roadmapRef!, roadmapDataToFirebaseFormat(data));
}

// Granular update functions for concurrent editing support.
// These use ID-based paths so concurrent operations target stable keys.
// Each awaits migrationPromise to ensure data is in keyed-object format before writing.

async function awaitMigration(): Promise<void> {
  if (migrationPromise) await migrationPromise;
}

export async function updateProjectAtPath(projectId: string, project: Project): Promise<void> {
  await ensureInitialized();
  await awaitMigration();
  const { ref, set } = getDbModule();
  const projectRef = ref(database!, `roadmap/projects/${projectId}`);
  // Convert milestones array to keyed object for Firebase storage
  await set(projectRef, projectToFirebase(project));
}

export async function updateProjectField(projectId: string, field: string, value: unknown): Promise<void> {
  await ensureInitialized();
  await awaitMigration();
  const { ref, set } = getDbModule();
  const fieldRef = ref(database!, `roadmap/projects/${projectId}/${field}`);
  // If writing milestones, convert array to keyed object
  if (field === 'milestones' && Array.isArray(value)) {
    await set(fieldRef, arrayToKeyedObject(value as Milestone[]));
  } else {
    await set(fieldRef, value);
  }
}

export async function updateMilestoneAtPath(
  projectId: string,
  milestoneId: string,
  milestone: Milestone
): Promise<void> {
  await ensureInitialized();
  await awaitMigration();
  const { ref, set } = getDbModule();
  const milestoneRef = ref(database!, `roadmap/projects/${projectId}/milestones/${milestoneId}`);
  await set(milestoneRef, milestone);
}

export async function updateDependencyAtPath(depId: string, dependency: Dependency): Promise<void> {
  await ensureInitialized();
  await awaitMigration();
  const { ref, set } = getDbModule();
  const depRef = ref(database!, `roadmap/dependencies/${depId}`);
  await set(depRef, dependency);
}

export async function updateTeamMemberAtPath(memberId: string, member: TeamMember): Promise<void> {
  await ensureInitialized();
  await awaitMigration();
  const { ref, set } = getDbModule();
  const memberRef = ref(database!, `roadmap/teamMembers/${memberId}`);
  await set(memberRef, member);
}

export async function updateLeaveBlockAtPath(leaveId: string, leaveBlock: LeaveBlock): Promise<void> {
  await ensureInitialized();
  await awaitMigration();
  const { ref, set } = getDbModule();
  const leaveRef = ref(database!, `roadmap/leaveBlocks/${leaveId}`);
  await set(leaveRef, leaveBlock);
}

// Batch update using Firebase's update() - merges multiple paths atomically
export async function batchUpdate(updates: Record<string, unknown>): Promise<void> {
  await ensureInitialized();
  const { ref, update } = getDbModule();
  const rootRef = ref(database!, 'roadmap');
  await update(rootRef, updates);
}

export async function getRoadmap(): Promise<RoadmapData> {
  await ensureInitialized();
  const { get } = getDbModule();
  const snapshot = await get(roadmapRef!);
  const data = snapshot.val();
  return firebaseSnapshotToRoadmapData(data);
}

// ============================================
// PRESENCE SYSTEM
// ============================================

export interface PresenceUser {
  id: string;
  name: string;
  color: string;
  lastSeen: number;
  editingProjectId?: string;
}

/**
 * Update current user's presence.
 * Sets up onDisconnect to automatically remove presence when connection drops.
 */
export async function updatePresence(sessionId: string, userData: Omit<PresenceUser, 'id' | 'lastSeen'>): Promise<void> {
  await ensureInitialized();
  const { ref, set, onDisconnect } = getDbModule();

  const presenceRef = ref(database!, `presence/${sessionId}`);

  const presenceData: PresenceUser = {
    id: sessionId,
    ...userData,
    lastSeen: Date.now()
  };

  // Set presence data
  await set(presenceRef, presenceData);

  // Remove presence on disconnect
  onDisconnect(presenceRef).remove();
}

/**
 * Update the project being edited by current user.
 */
export async function updateEditingStatus(sessionId: string, projectId: string | null): Promise<void> {
  await ensureInitialized();
  const { ref, set } = getDbModule();

  const editingRef = ref(database!, `presence/${sessionId}/editingProjectId`);
  await set(editingRef, projectId);
}

/**
 * Remove current user's presence (on logout/close).
 */
export async function removePresence(sessionId: string): Promise<void> {
  await ensureInitialized();
  const { ref, remove } = getDbModule();

  const presenceRef = ref(database!, `presence/${sessionId}`);
  await remove(presenceRef);
}

/**
 * Subscribe to all presence data.
 */
export async function subscribeToPresence(
  callback: (users: PresenceUser[]) => void
): Promise<Unsubscribe> {
  await ensureInitialized();
  const { ref, onValue } = getDbModule();

  const presenceRef = ref(database!, 'presence');

  const unsubscribe = onValue(
    presenceRef,
    (snapshot) => {
      const data = snapshot.val();
      if (!data) {
        callback([]);
        return;
      }

      // Convert object to array and filter stale entries (> 2 minutes old)
      const now = Date.now();
      const staleThreshold = 2 * 60 * 1000; // 2 minutes

      const users: PresenceUser[] = Object.values(data)
        .filter((user): user is PresenceUser => {
          if (!user || typeof user !== 'object') return false;
          const u = user as PresenceUser;
          return typeof u.id === 'string' && (now - u.lastSeen) < staleThreshold;
        });

      callback(users);
    },
    (error) => {
      console.error('[Firebase] Presence listener error:', error);
      // Return empty on error so UI doesn't break
      callback([]);
    }
  );

  return unsubscribe;
}

/**
 * Heartbeat to keep presence alive.
 * Should be called periodically (e.g., every 30 seconds).
 */
export async function heartbeatPresence(sessionId: string): Promise<void> {
  await ensureInitialized();
  const { ref, set } = getDbModule();

  const lastSeenRef = ref(database!, `presence/${sessionId}/lastSeen`);
  await set(lastSeenRef, Date.now());
}
