import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, get } from 'firebase/database';
import type { RoadmapData } from './types';

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

const app = initializeApp(firebaseConfig);
const database = getDatabase(app);

const roadmapRef = ref(database, 'roadmap');

export function subscribeToRoadmap(callback: (data: RoadmapData) => void): () => void {
  const unsubscribe = onValue(roadmapRef, (snapshot) => {
    const data = snapshot.val();
    callback(data || { projects: [] });
  });
  return unsubscribe;
}

export async function saveRoadmap(data: RoadmapData): Promise<void> {
  await set(roadmapRef, data);
}

export async function getRoadmap(): Promise<RoadmapData> {
  const snapshot = await get(roadmapRef);
  return snapshot.val() || { projects: [] };
}

export { database };
