// Game-agnostic Firebase-over-proxy transport, extracted from ludoApi.ts so
// Ludo and Ludo2 share one copy of the subtle parts. Why a proxy at all:
// corporate VPNs (Imprivata) block Firebase's WebSocket, so realtime games talk
// to /api/db/* over plain HTTPS instead of the SDK.
//
// Two SDK behaviours are emulated here:
//  - runTransaction → GET-with-ETag, run the updater, conditional PUT with
//    `if-match`; on 412 (someone else wrote first) back off and retry.
//  - onValue (realtime) → polling (~1.2s while visible). Turn-based games, so
//    the latency is acceptable.

import { fetchWithTimeout, sleep, jitter } from '../utils/fetchWithTimeout';

export type Unsubscribe = () => void;

const PROXY_BASE = '/api/db';
const POLL_INTERVAL_MS = 1200;
const HIDDEN_POLL_INTERVAL_MS = 15000;
/** Faster poll cadence while disconnected, to recover promptly once the proxy is reachable again. */
const RECONNECT_POLL_INTERVAL_MS = 700;
const MAX_TXN_RETRIES = 12;
const REQUEST_TIMEOUT_MS = 12_000;
/** Base backoff between conditional-write conflict retries (grows + jitters). */
const TXN_RETRY_BASE_MS = 80;
const TXN_RETRY_MAX_MS = 1_500;

// Firebase REST honours the server-timestamp sentinel in write bodies, so we
// send it directly instead of the SDK's serverTimestamp() object.
export function getServerTimestamp(): object {
  return { '.sv': 'timestamp' };
}

// Corporate proxies (Imprivata) cache GET responses even when we send
// `Cache-Control: no-store`. That poisons the ETag transaction below: the
// client reads a *stale* ETag, so every conditional PUT returns 412, the retry
// loop never commits, and the join silently fails. Appending a unique param
// makes each GET URL distinct so no intermediary can serve a cached copy. The
// Vercel proxy only reads `dbpath`, so `_cb` is ignored and never hits Firebase.
function bust(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${PROXY_BASE}/${path}${sep}_cb=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function proxyGet<T = unknown>(path: string): Promise<T | null> {
  const res = await fetchWithTimeout(bust(path), { method: 'GET', cache: 'no-store' }, REQUEST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  const text = await res.text();
  return text && text !== 'null' ? (JSON.parse(text) as T) : null;
}

export async function proxyGetWithEtag<T = unknown>(path: string): Promise<{ value: T | null; etag: string }> {
  const res = await fetchWithTimeout(bust(path), {
    method: 'GET',
    headers: { 'X-Firebase-ETag': 'true' },
    cache: 'no-store',
  }, REQUEST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`GET ${path} (etag) failed: ${res.status}`);
  const etag = res.headers.get('ETag') ?? '';
  const text = await res.text();
  const value = text && text !== 'null' ? (JSON.parse(text) as T) : null;
  return { value, etag };
}

export async function proxyRemove(path: string): Promise<void> {
  const res = await fetchWithTimeout(`${PROXY_BASE}/${path}`, { method: 'DELETE' }, REQUEST_TIMEOUT_MS);
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status}`);
}

export interface TxnResult<T> {
  committed: boolean;
  snapshot: T | null;
}

/**
 * Emulate Firebase runTransaction over REST. `updater` receives the current
 * value and returns the new value, or `undefined` to abort (matching the SDK).
 * Uses ETag conditional writes so concurrent writers can't clobber each other.
 *
 * The updater returns `object | null | undefined` rather than strictly `T` to
 * match Firebase's untyped transaction callback — the returned shapes include
 * server-timestamp sentinels and explicit nulls that don't satisfy the strict
 * state type but serialize correctly for the REST write.
 */
export async function proxyTransaction<T>(
  path: string,
  updater: (current: T | null) => object | null | undefined
): Promise<TxnResult<T>> {
  for (let attempt = 0; attempt < MAX_TXN_RETRIES; attempt++) {
    const { value, etag } = await proxyGetWithEtag<T>(path);
    const next = updater(value);
    // undefined = explicit abort; null is only ever returned as a "game doesn't
    // exist, can't proceed" signal — never to delete — so treat it as abort too.
    if (next === undefined || next === null) {
      return { committed: false, snapshot: value };
    }
    const res = await fetchWithTimeout(`${PROXY_BASE}/${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'if-match': etag },
      body: JSON.stringify(next),
    }, REQUEST_TIMEOUT_MS);
    if (res.ok) {
      return { committed: true, snapshot: next as T };
    }
    if (res.status !== 412) {
      throw new Error(`Transaction PUT ${path} failed: ${res.status}`);
    }
    // 412 Precondition Failed → value changed under us. Back off (exponential,
    // capped, jittered) before re-reading so concurrent writers don't hammer
    // the proxy in a tight lockstep loop.
    const backoff = Math.min(TXN_RETRY_BASE_MS * 2 ** attempt, TXN_RETRY_MAX_MS);
    await sleep(jitter(backoff));
  }
  return { committed: false, snapshot: null };
}

/**
 * Poll a DB path and invoke `callback` whenever its value changes (emulates
 * onValue). `onConnectionChange` reports poll health so the UI can show a
 * "reconnecting" indicator — only fired on transitions (connected ⇄
 * disconnected), never on every poll.
 */
export function subscribeToPath<T>(
  path: string,
  logTag: string,
  callback: (state: T | null) => void,
  onConnectionChange?: (connected: boolean) => void
): Promise<Unsubscribe> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSerialized: string | null = null;
  let failures = 0;
  let connected = true;

  const setConnected = (next: boolean) => {
    if (next !== connected) {
      connected = next;
      onConnectionChange?.(next);
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const state = await proxyGet<T>(path);
      failures = 0;
      setConnected(true);
      const serialized = JSON.stringify(state);
      if (serialized !== lastSerialized) {
        lastSerialized = serialized;
        callback(state);
      }
    } catch (err) {
      console.error(`[${logTag}] Poll error:`, err);
      // Keep polling — a transient failure shouldn't drop the player out — but
      // after two misses (~2.4s) surface a disconnect so the player isn't left
      // staring at a silently-frozen board.
      failures += 1;
      if (failures >= 2) setConnected(false);
    } finally {
      if (!stopped) {
        const base =
          document.visibilityState === 'hidden'
            ? HIDDEN_POLL_INTERVAL_MS
            : connected
              ? POLL_INTERVAL_MS
              : RECONNECT_POLL_INTERVAL_MS; // retry sooner while disconnected (polls never overlap)
        timer = setTimeout(tick, jitter(base));
      }
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && !stopped) {
      if (timer) clearTimeout(timer);
      void tick();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  timer = setTimeout(tick, 0);

  const unsubscribe: Unsubscribe = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
  return Promise.resolve(unsubscribe);
}
