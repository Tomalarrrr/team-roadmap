import type { RoadmapData, Project, Milestone, Dependency, TeamMember, LeaveBlock } from './types';
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

// Dynamically import and initialize Firebase (deferred)
async function initializeFirebase(): Promise<void> {
  if (app && database && roadmapRef) return;

  try {
    const [{ initializeApp }, { getDatabase, ref }] = await Promise.all([
      import('firebase/app'),
      import('firebase/database')
    ]);

    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
    roadmapRef = ref(database, 'roadmap');
  } catch (error) {
    throw new Error(
      `Failed to initialize Firebase: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
      'Please check your Firebase configuration and network connection.'
    );
  }
}

// Ensure Firebase is initialized before use
function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeFirebase();
  }
  return initPromise;
}

export async function subscribeToRoadmap(callback: (data: RoadmapData) => void): Promise<Unsubscribe> {
  await ensureInitialized();
  const { onValue } = await import('firebase/database');

  const unsubscribe = onValue(roadmapRef!, (snapshot) => {
    const data = snapshot.val();
    callback({
      projects: data?.projects || [],
      teamMembers: data?.teamMembers || [],
      dependencies: data?.dependencies || [],
      leaveBlocks: data?.leaveBlocks || [],
      periodMarkers: data?.periodMarkers || []
    });
  });
  return unsubscribe;
}

export async function subscribeToConnectionState(callback: (connected: boolean) => void): Promise<Unsubscribe> {
  await ensureInitialized();
  const { onValue, ref } = await import('firebase/database');

  // Firebase's special .info/connected location tracks connection state
  const connectedRef = ref(database!, '.info/connected');

  const unsubscribe = onValue(connectedRef, (snapshot) => {
    const connected = snapshot.val() === true;
    callback(connected);
  });

  return unsubscribe;
}

export async function saveRoadmap(data: RoadmapData): Promise<void> {
  await ensureInitialized();
  const { set } = await import('firebase/database');
  await set(roadmapRef!, data);
}

// Granular update functions for concurrent editing support
// These use Firebase's update() which merges changes instead of overwriting

export async function updateProjectAtPath(projectIndex: number, project: Project): Promise<void> {
  await ensureInitialized();
  const { ref, set } = await import('firebase/database');
  const projectRef = ref(database!, `roadmap/projects/${projectIndex}`);
  await set(projectRef, project);
}

export async function updateProjectField(projectIndex: number, field: string, value: unknown): Promise<void> {
  await ensureInitialized();
  const { ref, set } = await import('firebase/database');
  const fieldRef = ref(database!, `roadmap/projects/${projectIndex}/${field}`);
  await set(fieldRef, value);
}

export async function updateMilestoneAtPath(
  projectIndex: number,
  milestoneIndex: number,
  milestone: Milestone
): Promise<void> {
  await ensureInitialized();
  const { ref, set } = await import('firebase/database');
  const milestoneRef = ref(database!, `roadmap/projects/${projectIndex}/milestones/${milestoneIndex}`);
  await set(milestoneRef, milestone);
}

export async function updateDependencyAtPath(depIndex: number, dependency: Dependency): Promise<void> {
  await ensureInitialized();
  const { ref, set } = await import('firebase/database');
  const depRef = ref(database!, `roadmap/dependencies/${depIndex}`);
  await set(depRef, dependency);
}

export async function updateTeamMemberAtPath(memberIndex: number, member: TeamMember): Promise<void> {
  await ensureInitialized();
  const { ref, set } = await import('firebase/database');
  const memberRef = ref(database!, `roadmap/teamMembers/${memberIndex}`);
  await set(memberRef, member);
}

// Batch update using Firebase's update() - merges multiple paths atomically
export async function batchUpdate(updates: Record<string, unknown>): Promise<void> {
  await ensureInitialized();
  const { ref, update } = await import('firebase/database');
  const rootRef = ref(database!, 'roadmap');
  await update(rootRef, updates);
}

export async function getRoadmap(): Promise<RoadmapData> {
  await ensureInitialized();
  const { get } = await import('firebase/database');
  const snapshot = await get(roadmapRef!);
  const data = snapshot.val();
  return {
    projects: data?.projects || [],
    teamMembers: data?.teamMembers || [],
    dependencies: data?.dependencies || [],
    leaveBlocks: data?.leaveBlocks || [],
    periodMarkers: data?.periodMarkers || []
  };
}

export async function updateLeaveBlockAtPath(leaveIndex: number, leaveBlock: LeaveBlock): Promise<void> {
  await ensureInitialized();
  const { ref, set } = await import('firebase/database');
  const leaveRef = ref(database!, `roadmap/leaveBlocks/${leaveIndex}`);
  await set(leaveRef, leaveBlock);
}

export function getDatabaseInstance(): Database | null {
  return database;
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
  const { ref, set, onDisconnect } = await import('firebase/database');

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
  const { ref, set } = await import('firebase/database');

  const editingRef = ref(database!, `presence/${sessionId}/editingProjectId`);
  await set(editingRef, projectId);
}

/**
 * Remove current user's presence (on logout/close).
 */
export async function removePresence(sessionId: string): Promise<void> {
  await ensureInitialized();
  const { ref, remove } = await import('firebase/database');

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
  const { ref, onValue } = await import('firebase/database');

  const presenceRef = ref(database!, 'presence');

  const unsubscribe = onValue(presenceRef, (snapshot) => {
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
  });

  return unsubscribe;
}

/**
 * Heartbeat to keep presence alive.
 * Should be called periodically (e.g., every 30 seconds).
 */
export async function heartbeatPresence(sessionId: string): Promise<void> {
  await ensureInitialized();
  const { ref, set } = await import('firebase/database');

  const lastSeenRef = ref(database!, `presence/${sessionId}/lastSeen`);
  await set(lastSeenRef, Date.now());
}
