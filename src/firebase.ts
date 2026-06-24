import type { FirebaseApp } from 'firebase/app';
import type { Database, Unsubscribe } from 'firebase/database';

// Roadmap reads/writes now go through the Vercel proxy (src/api/roadmapApi.ts).
// This module retains only what still talks to the Firebase SDK directly:
//   - lazy Firebase init + cached db module (powers the connection-state and
//     presence listeners below)
//   - global "last activity" tracking (the proxy/useRoadmap stale-detector)
//   - connection-state subscription + the presence system (usePresence)

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
let initPromise: Promise<void> | null = null;

// Cached firebase/database module — avoids repeated `await import()` microtask overhead
// on every function call after initialization.
let dbModule: typeof import('firebase/database') | null = null;

// Dynamically import and initialize Firebase (deferred)
async function initializeFirebase(): Promise<void> {
  if (app && database && dbModule) return;

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
export function getDbModule() {
  if (!dbModule) throw new Error('Firebase not initialized');
  return dbModule;
}

// Ensure Firebase is initialized before use
export function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeFirebase();
  }
  return initPromise;
}

// ============================================
// GLOBAL FIREBASE ACTIVITY TRACKING
// ============================================
// Tracks when *any* Firebase listener (roadmap, ludo, etc.) last
// received data.  The stale-connection detector in useRoadmap checks this so
// it won't force-reconnect when the connection is actually alive (e.g. a game
// is running but the roadmap path is quiet).

let lastFirebaseActivityTs = Date.now();

/** Call from any Firebase onValue/onChildAdded callback to signal the connection is alive. */
export function markFirebaseActivity(): void {
  lastFirebaseActivityTs = Date.now();
}

/** Returns the timestamp of the most recent Firebase data received across all listeners. */
export function getLastFirebaseActivity(): number {
  return lastFirebaseActivityTs;
}

// Disconnect threshold after extended hidden periods. Exported so usePresence
// can align its re-registration threshold. (The SDK connection-lifecycle
// manager that consumed this now lives in src/api/roadmapApi.ts.)
export const HIDDEN_DISCONNECT_MS = 2 * 60 * 1000;

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
