import { useState, useEffect, useCallback, useRef } from 'react';
import { ensureInitialized, getDbModule, getFirebaseDatabase } from '../firebase';

let cachedPaused: boolean | null = null;
let listeners = new Set<(paused: boolean) => void>();
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
      const val = snapshot.val() === true;
      cachedPaused = val;
      listeners.forEach(fn => fn(val));
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

export function useGamePause() {
  const [paused, setPaused] = useState(cachedPaused ?? false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const handler = (val: boolean) => {
      if (mountedRef.current) setPaused(val);
    };
    listeners.add(handler);
    startGlobalListener();
    if (cachedPaused !== null) setPaused(cachedPaused);
    return () => {
      mountedRef.current = false;
      listeners.delete(handler);
      stopGlobalListener();
    };
  }, []);

  const togglePause = useCallback(async () => {
    await ensureInitialized();
    const { ref, runTransaction } = getDbModule();
    const db = getFirebaseDatabase();
    const pauseRef = ref(db, 'gamePaused');
    await runTransaction(pauseRef, (current: boolean | null) => !(current ?? false));
  }, []);

  return { paused, togglePause };
}
