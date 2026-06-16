// Coalesces a burst of writes to the same key into a single deferred write.
//
// Why: edits like holding a keyboard shortcut to nudge a project's dates fire
// many updates per second. Each one already updates the UI optimistically, but
// without coalescing each also fires its own network write to the proxy. This
// collapses a burst into one trailing write per key, cutting redundant traffic
// and load while leaving the optimistic UI untouched.
//
// Lifecycle hooks let the caller bracket a burst (e.g. to keep a "saving"
// indicator on and suppress remote-echo polls for the whole window):
//   onBurstStart fires when a key goes idle -> pending,
//   onBurstEnd   fires once the key's write has settled (success or failure).
// They are always balanced: exactly one onBurstEnd per onBurstStart.

export interface WriteCoalescer {
  /** Queue (or replace) the pending write for `key`, (re)starting its timer. */
  schedule(key: string, write: () => Promise<void>): void;
  /** Whether a write is currently pending for `key` (i.e. a burst is active). */
  has(key: string): boolean;
  /** Fire every pending write immediately — e.g. on unmount / page hide. */
  flushAll(): void;
  /** Drop every pending write without firing it, balancing onBurstEnd. */
  cancelAll(): void;
  /** Number of keys with a pending write. */
  readonly pending: number;
}

interface CoalescerHooks {
  onBurstStart?: () => void;
  onBurstEnd?: () => void;
}

export function createWriteCoalescer(
  delayMs: number,
  hooks: CoalescerHooks = {}
): WriteCoalescer {
  interface Entry {
    timer: ReturnType<typeof setTimeout>;
    write: () => Promise<void>;
  }
  const entries = new Map<string, Entry>();

  const runFlush = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    clearTimeout(entry.timer);
    // The write fn owns its own error handling; we only guarantee the burst is
    // closed out exactly once whether it resolves or rejects.
    Promise.resolve()
      .then(entry.write)
      .catch(() => { /* swallowed: write fn surfaces its own failures */ })
      .finally(() => hooks.onBurstEnd?.());
  };

  return {
    schedule(key, write) {
      const existing = entries.get(key);
      if (existing) {
        // Coalesce: keep only the latest write and restart the debounce window.
        existing.write = write;
        clearTimeout(existing.timer);
        existing.timer = setTimeout(() => runFlush(key), delayMs);
      } else {
        hooks.onBurstStart?.();
        entries.set(key, { write, timer: setTimeout(() => runFlush(key), delayMs) });
      }
    },
    has: (key) => entries.has(key),
    flushAll() {
      for (const key of [...entries.keys()]) runFlush(key);
    },
    cancelAll() {
      const count = entries.size;
      for (const entry of entries.values()) clearTimeout(entry.timer);
      entries.clear();
      // Balance the onBurstStart already emitted for each dropped burst so a
      // saving indicator driven by these hooks doesn't get stuck on.
      for (let i = 0; i < count; i++) hooks.onBurstEnd?.();
    },
    get pending() {
      return entries.size;
    },
  };
}
