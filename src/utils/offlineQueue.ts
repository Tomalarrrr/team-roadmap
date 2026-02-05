/**
 * Offline Queue Utility
 *
 * Queues failed operations when offline and automatically retries when connection restores.
 * Uses IndexedDB for persistence across page reloads.
 */

import type { RoadmapData } from '../types';

// Queue item structure
export interface QueuedOperation {
  id: string;
  timestamp: number;
  type: 'full-save' | 'project-update' | 'milestone-update' | 'dependency-update' | 'member-update' | 'leave-update';
  data: RoadmapData | Record<string, unknown>;
  path?: string; // For granular updates: e.g., "projects/0" or "dependencies/2"
  retryCount: number;
  lastError?: string;
}

// IndexedDB configuration
const DB_NAME = 'roadmap-offline';
const DB_VERSION = 1;
const STORE_NAME = 'pending-operations';

// Event listeners for queue changes
type QueueChangeListener = (queue: QueuedOperation[]) => void;
const listeners: Set<QueueChangeListener> = new Set();

let db: IDBDatabase | null = null;

/**
 * Initialize IndexedDB for offline queue storage.
 */
async function initDB(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open offline queue database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create object store for pending operations
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };
  });
}

/**
 * Add an operation to the offline queue.
 */
export async function addToQueue(operation: Omit<QueuedOperation, 'id' | 'timestamp' | 'retryCount'>): Promise<QueuedOperation> {
  const database = await initDB();

  const queuedOp: QueuedOperation = {
    ...operation,
    id: `op-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: Date.now(),
    retryCount: 0
  };

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(queuedOp);

    request.onsuccess = () => {
      notifyListeners();
      resolve(queuedOp);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Remove an operation from the queue (after successful processing).
 */
export async function removeFromQueue(operationId: string): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(operationId);

    request.onsuccess = () => {
      notifyListeners();
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Update an operation in the queue (e.g., increment retry count).
 */
export async function updateQueueItem(operationId: string, updates: Partial<QueuedOperation>): Promise<void> {
  const database = await initDB();
  const existing = await getQueueItem(operationId);

  if (!existing) return;

  const updated = { ...existing, ...updates };

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(updated);

    request.onsuccess = () => {
      notifyListeners();
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Get a single queue item by ID.
 */
async function getQueueItem(operationId: string): Promise<QueuedOperation | undefined> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(operationId);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Get all pending operations in the queue, sorted by timestamp.
 */
export async function getQueue(): Promise<QueuedOperation[]> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Get the number of pending operations.
 */
export async function getQueueSize(): Promise<number> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Clear all operations from the queue.
 */
export async function clearQueue(): Promise<void> {
  const database = await initDB();

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      notifyListeners();
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Subscribe to queue changes.
 */
export function subscribeToQueueChanges(listener: QueueChangeListener): () => void {
  listeners.add(listener);

  // Immediately notify with current queue
  getQueue().then(queue => listener(queue)).catch(console.error);

  return () => {
    listeners.delete(listener);
  };
}

/**
 * Notify all listeners of queue changes.
 */
async function notifyListeners(): Promise<void> {
  try {
    const queue = await getQueue();
    listeners.forEach(listener => listener(queue));
  } catch (error) {
    console.error('Failed to notify queue listeners:', error);
  }
}

/**
 * Process all queued operations with a processor function.
 * Returns the number of successfully processed operations.
 */
export async function processQueue(
  processor: (operation: QueuedOperation) => Promise<void>,
  options: {
    maxRetries?: number;
    onProgress?: (processed: number, total: number) => void;
    onError?: (operation: QueuedOperation, error: Error) => void;
  } = {}
): Promise<{ processed: number; failed: number }> {
  const { maxRetries = 3, onProgress, onError } = options;
  const queue = await getQueue();

  let processed = 0;
  let failed = 0;

  for (const operation of queue) {
    try {
      await processor(operation);
      await removeFromQueue(operation.id);
      processed++;
      onProgress?.(processed, queue.length);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (operation.retryCount >= maxRetries) {
        // Max retries exceeded, remove from queue but count as failed
        await removeFromQueue(operation.id);
        failed++;
        onError?.(operation, err);
      } else {
        // Increment retry count and keep in queue
        await updateQueueItem(operation.id, {
          retryCount: operation.retryCount + 1,
          lastError: err.message
        });
        failed++;
        onError?.(operation, err);
      }
    }
  }

  return { processed, failed };
}

/**
 * Check if there are any pending operations.
 */
export async function hasPendingOperations(): Promise<boolean> {
  const size = await getQueueSize();
  return size > 0;
}

// Initialize database on module load
initDB().catch(console.error);
