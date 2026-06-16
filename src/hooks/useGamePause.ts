import { useCallback, useSyncExternalStore } from 'react';
import { ensureInitialized, getDbModule, getFirebaseDatabase } from '../firebase';

let cachedPaused: boolean | null = null;
const listeners = new Set<() => void>();
let globalUnsub: (() => void) | null = null;
let initPromise: Promise<void> | null = null; // prevents duplicate listener race

function startGlobalListener() {
  if (globalUnsub || initPromise) return;
  initPromise = ensureInitialized().then(() => {
    // Re-check after async — another caller may have stopped while we awaited
    if (listeners.size === 0) { initPromise = null; return; }
    const { ref, onValue } = getDbModule();
    const db = getFirebaseDatabase();
    const pauseRef = ref(db, 'gamePaused');
    globalUnsub = onValue(pauseRef, (snapshot) => {
      cachedPaused = snapshot.val() === true;
      listeners.forEach(fn => fn());
    });
    initPromise = null;
  }).catch(() => { initPromise = null; });
}

function stopGlobalListener() {
  if (globalUnsub && listeners.size === 0) {
    globalUnsub();
    globalUnsub = null;
    cachedPaused = null;
  }
}

// External-store wiring for useSyncExternalStore: subscribing registers a
// no-arg notifier and (re)starts the shared Firebase listener; the snapshot is
// read from the module-level cache. This is the canonical way to mirror an
// external data source into React state without a setState-in-effect.
function subscribePause(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  startGlobalListener();
  return () => {
    listeners.delete(onStoreChange);
    stopGlobalListener();
  };
}

function getPauseSnapshot(): boolean {
  return cachedPaused ?? false;
}

export function useGamePause() {
  const paused = useSyncExternalStore(subscribePause, getPauseSnapshot, getPauseSnapshot);

  const togglePause = useCallback(async () => {
    await ensureInitialized();
    const { ref, runTransaction } = getDbModule();
    const db = getFirebaseDatabase();
    const pauseRef = ref(db, 'gamePaused');
    await runTransaction(pauseRef, (current: boolean | null) => !(current ?? false));
  }, []);

  return { paused, togglePause };
}
