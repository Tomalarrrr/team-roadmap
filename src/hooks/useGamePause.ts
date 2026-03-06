import { useState, useEffect, useCallback, useRef } from 'react';
import { ensureInitialized, getDbModule, getFirebaseDatabase } from '../firebase';

let cachedPaused: boolean | null = null;
let listeners = new Set<(paused: boolean) => void>();
let globalUnsub: (() => void) | null = null;

function startGlobalListener() {
  if (globalUnsub) return;
  ensureInitialized().then(() => {
    const { ref, onValue } = getDbModule();
    const db = getFirebaseDatabase();
    const pauseRef = ref(db, 'gamePaused');
    globalUnsub = onValue(pauseRef, (snapshot) => {
      const val = snapshot.val() === true;
      cachedPaused = val;
      listeners.forEach(fn => fn(val));
    });
  });
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
    const { ref, set } = getDbModule();
    const db = getFirebaseDatabase();
    const pauseRef = ref(db, 'gamePaused');
    await set(pauseRef, !cachedPaused);
  }, []);

  return { paused, togglePause };
}
