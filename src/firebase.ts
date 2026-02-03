import type { RoadmapData } from './types';
import type { FirebaseApp } from 'firebase/app';
import type { Database, DatabaseReference, Unsubscribe } from 'firebase/database';

// Firebase configuration - Replace with your own config
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "YOUR_API_KEY",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "YOUR_PROJECT.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://YOUR_PROJECT.firebaseio.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "YOUR_PROJECT_ID",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "YOUR_PROJECT.appspot.com",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "YOUR_SENDER_ID",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "YOUR_APP_ID"
};

// Lazy-loaded Firebase instances
let app: FirebaseApp | null = null;
let database: Database | null = null;
let roadmapRef: DatabaseReference | null = null;
let initPromise: Promise<void> | null = null;

// Dynamically import and initialize Firebase (deferred)
async function initializeFirebase(): Promise<void> {
  if (app && database && roadmapRef) return;

  const [{ initializeApp }, { getDatabase, ref }] = await Promise.all([
    import('firebase/app'),
    import('firebase/database')
  ]);

  app = initializeApp(firebaseConfig);
  database = getDatabase(app);
  roadmapRef = ref(database, 'roadmap');
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
      dependencies: data?.dependencies || []
    });
  });
  return unsubscribe;
}

export async function saveRoadmap(data: RoadmapData): Promise<void> {
  await ensureInitialized();
  const { set } = await import('firebase/database');
  await set(roadmapRef!, data);
}

export async function getRoadmap(): Promise<RoadmapData> {
  await ensureInitialized();
  const { get } = await import('firebase/database');
  const snapshot = await get(roadmapRef!);
  const data = snapshot.val();
  return {
    projects: data?.projects || [],
    teamMembers: data?.teamMembers || [],
    dependencies: data?.dependencies || []
  };
}

export function getDatabaseInstance(): Database | null {
  return database;
}
