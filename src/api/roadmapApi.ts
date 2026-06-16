// Roadmap data access layer that talks to our Vercel API proxy instead of
// Firebase directly. Why: corporate proxies / VPNs (Imprivata, Zscaler, etc.)
// frequently break the persistent WebSocket and long-polling connections the
// Firebase JS SDK uses. By routing all roadmap reads/writes through
// `/api/db/*` on the same origin as the app, we look like normal first-party
// HTTPS traffic that any corporate proxy is forced to allow.
//
// Live updates: instead of a Firebase realtime subscription, we poll the
// proxy every `POLL_INTERVAL_MS`. The trade-off is ~5s latency on other
// users' edits; the user's own edits remain instant via optimistic UI.
//
// Mirrors the function names used by the original firebase.ts so the calling
// hooks need only swap imports.

import type {
  RoadmapData,
  Project,
  Milestone,
  Dependency,
  TeamMember,
  LeaveBlock,
} from '../types';
import {
  firebaseSnapshotToRoadmapData,
  roadmapDataToFirebaseFormat,
  arrayToKeyedObject,
  isLegacyArrayFormat,
} from '../utils/firebaseConversions';
import { markFirebaseActivity } from '../firebase';
import { fetchWithTimeout, jitter } from '../utils/fetchWithTimeout';

export type Unsubscribe = () => void;

/** How often to poll for remote changes when the tab is visible. */
const POLL_INTERVAL_MS = 5_000;
/** Slow poll cadence used while the tab is hidden — keeps connection alive without burning battery. */
const HIDDEN_POLL_INTERVAL_MS = 60_000;
/** Upper bound for exponential backoff after consecutive poll failures (flaky VPN). */
const MAX_POLL_BACKOFF_MS = 60_000;
/** Per-request timeout — a hung VPN connection must not stall the poll loop. */
const REQUEST_TIMEOUT_MS = 12_000;

const PROXY_BASE = '/api/db';

// ---------- Low-level fetch helpers ----------

async function proxyFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${PROXY_BASE}/${path.replace(/^\/+/, '')}`;
  const response = await fetchWithTimeout(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  }, REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.json())?.error ?? '';
    } catch {
      // ignore
    }
    throw new Error(
      `Proxy ${init?.method ?? 'GET'} ${path} failed: ${response.status}${detail ? ` (${detail})` : ''}`
    );
  }
  return response;
}

async function proxyGet<T = unknown>(path: string): Promise<T> {
  const response = await proxyFetch(path, { method: 'GET' });
  return (await response.json()) as T;
}

/**
 * Conditional GET for the poll loop. Sends If-None-Match so the proxy can reply
 * 304 (no body) when the snapshot is unchanged — the common case on a 5s poll.
 * Returns `notModified` so the caller can skip the parse/convert/deliver work
 * entirely, and the fresh ETag to send on the next tick.
 */
async function proxyGetConditional(
  path: string,
  etag: string | null
): Promise<{ notModified: boolean; etag: string | null; raw: unknown }> {
  const url = `${PROXY_BASE}/${path.replace(/^\/+/, '')}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      // no-store so neither the browser HTTP cache nor a corporate proxy answers
      // the conditional request — we want our edge proxy to make the 304 call.
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
    },
    REQUEST_TIMEOUT_MS
  );
  if (res.status === 304) {
    return { notModified: true, etag, raw: null };
  }
  if (!res.ok) {
    throw new Error(`Proxy GET ${path} failed: ${res.status}`);
  }
  return { notModified: false, etag: res.headers.get('ETag') ?? null, raw: await res.json() };
}

async function proxyPut(path: string, value: unknown): Promise<void> {
  await proxyFetch(path, { method: 'PUT', body: JSON.stringify(value) });
}

async function proxyPatch(path: string, value: unknown): Promise<void> {
  await proxyFetch(path, { method: 'PATCH', body: JSON.stringify(value) });
}

// ---------- Internal connection-state pub/sub ----------
//
// We derive online/offline from whether subscription polls are succeeding,
// rather than running a separate health-probe loop, so we only make one
// request per poll cycle. Two consecutive failures flips to offline to avoid
// flapping on transient errors.

let connectionState: boolean | null = null;
let consecutivePollFailures = 0;
const connectionListeners = new Set<(connected: boolean) => void>();

function reportPollResult(success: boolean) {
  if (success) {
    consecutivePollFailures = 0;
    setConnectionState(true);
  } else {
    consecutivePollFailures++;
    if (consecutivePollFailures >= 2) setConnectionState(false);
  }
}

function setConnectionState(next: boolean) {
  if (connectionState === next) return;
  connectionState = next;
  for (const listener of connectionListeners) listener(next);
}

// ---------- Public read API ----------

/** One-shot fetch of the full roadmap snapshot. */
export async function getRoadmap(): Promise<RoadmapData> {
  const raw = await proxyGet('roadmap');
  return firebaseSnapshotToRoadmapData(raw);
}

/**
 * Polling-based replacement for Firebase's onValue subscription.
 *
 * Calls `onData` whenever a fetched snapshot differs from the last one we
 * delivered, and `onError` on each poll failure (the caller decides how to
 * react). Pauses polling while the tab is hidden to save bandwidth / Vercel
 * invocations; resumes immediately when the tab regains focus.
 */
export function subscribeToRoadmap(
  onData: (data: RoadmapData) => void,
  onError?: (error: Error) => void
): Promise<Unsubscribe> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let migrationChecked = false;
  // ETag of the last snapshot the proxy returned. Sent back as If-None-Match so
  // an unchanged poll comes back as a body-less 304 we can short-circuit.
  let etag: string | null = null;
  // Consecutive poll failures, used to back off so we don't hammer a flaky /
  // throttled VPN connection. Reset to 0 on any successful poll.
  let consecutiveFailures = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      const { notModified, etag: nextEtag, raw } = await proxyGetConditional('roadmap', etag);
      markFirebaseActivity();
      reportPollResult(true);
      consecutiveFailures = 0;
      etag = nextEtag;

      // 304 Not Modified: nothing changed since the last poll, so skip the
      // parse/convert/deliver work and the caller's diff entirely.
      if (notModified) return;

      const data = firebaseSnapshotToRoadmapData(raw);

      // One-time legacy-format migration: if the data is still in pre-keyed
      // array format, rewrite it via the proxy so subsequent granular updates
      // target stable keys.
      if (!migrationChecked && raw) {
        migrationChecked = true;
        if (isLegacyArrayFormat(raw)) {
          // Fire-and-forget; failures are non-fatal — next tick will retry.
          proxyPut('roadmap', roadmapDataToFirebaseFormat(data)).catch((err) =>
            console.error('[roadmapApi] Migration write failed:', err)
          );
        }
      }

      // Deliver every snapshot. De-dup is the caller's responsibility — it
      // needs to decide whether to apply based on in-flight writes, so we must
      // not drop snapshots here (a dropped snapshot during a save window would
      // never be re-delivered if the data didn't change again).
      onData(data);
    } catch (err) {
      reportPollResult(false);
      consecutiveFailures++;
      onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!stopped) {
        let base = document.visibilityState === 'hidden'
          ? HIDDEN_POLL_INTERVAL_MS
          : POLL_INTERVAL_MS;
        // Exponential backoff while polls keep failing, capped — recovers to the
        // normal cadence on the next success (consecutiveFailures resets to 0).
        if (consecutiveFailures > 0) {
          base = Math.min(base * 2 ** Math.min(consecutiveFailures, 5), MAX_POLL_BACKOFF_MS);
        }
        // Jitter so many clients don't poll the proxy in lockstep.
        timer = setTimeout(tick, jitter(base));
      }
    }
  };

  // Refresh immediately whenever the tab becomes visible — closes the
  // latency gap so returning users see other people's changes fast.
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && !stopped) {
      if (timer) clearTimeout(timer);
      void tick();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Kick off the first poll on next tick so the caller has time to await
  // and bind the unsubscribe before the first onData fires.
  timer = setTimeout(tick, 0);

  const unsubscribe: Unsubscribe = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  return Promise.resolve(unsubscribe);
}

/**
 * Synthetic replacement for Firebase's `.info/connected` subscription.
 * Driven by the subscription's own polls (see `reportPollResult`) so we
 * don't run a duplicate health-probe loop. The current state (if known)
 * is delivered synchronously on subscribe.
 */
export function subscribeToConnectionState(
  callback: (connected: boolean) => void
): Promise<Unsubscribe> {
  connectionListeners.add(callback);
  if (connectionState !== null) callback(connectionState);
  return Promise.resolve(() => {
    connectionListeners.delete(callback);
  });
}

// ---------- Public write API ----------

/** Overwrite the entire roadmap (used by full saves and rollback). */
export async function saveRoadmap(data: RoadmapData): Promise<void> {
  await proxyPut('roadmap', roadmapDataToFirebaseFormat(data));
}

// The granular updaters write only the *changed* fields via PATCH (Firebase's
// merge) rather than PUTting the whole record. This way two users editing
// different fields of the same project/milestone/etc. don't clobber each other:
// each write touches only the keys it actually changed. (Concurrent edits to
// the *same* field remain last-write-wins, which is unavoidable and fine.)

export async function updateProjectAtPath(projectId: string, updates: Partial<Project>): Promise<void> {
  // A `milestones` field only appears on whole-object writes (e.g. undo restore);
  // convert it to keyed-object form so the storage shape stays consistent.
  const patch: Record<string, unknown> = { ...updates };
  if (Array.isArray(patch.milestones)) {
    patch.milestones = arrayToKeyedObject(patch.milestones as Milestone[]);
  }
  await proxyPatch(`roadmap/projects/${encodeURIComponent(projectId)}`, patch);
}

export async function updateMilestoneAtPath(
  projectId: string,
  milestoneId: string,
  updates: Partial<Milestone>
): Promise<void> {
  await proxyPatch(
    `roadmap/projects/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}`,
    { ...updates }
  );
}

export async function updateDependencyAtPath(depId: string, updates: Partial<Dependency>): Promise<void> {
  await proxyPatch(`roadmap/dependencies/${encodeURIComponent(depId)}`, { ...updates });
}

export async function updateTeamMemberAtPath(memberId: string, updates: Partial<TeamMember>): Promise<void> {
  await proxyPatch(`roadmap/teamMembers/${encodeURIComponent(memberId)}`, { ...updates });
}

export async function updateLeaveBlockAtPath(leaveId: string, updates: Partial<LeaveBlock>): Promise<void> {
  await proxyPatch(`roadmap/leaveBlocks/${encodeURIComponent(leaveId)}`, { ...updates });
}

/**
 * Mirrors Firebase's `update(ref, {pathA: valA, pathB: valB})` semantics
 * which merges multiple paths atomically. Firebase's REST API supports
 * PATCH with the same shape (with slash-delimited keys), so we forward
 * the updates object verbatim.
 */
export async function batchUpdate(updates: Record<string, unknown>): Promise<void> {
  await proxyPatch('roadmap', updates);
}

// ---------- Lifecycle stubs (no-ops in polling mode) ----------

/**
 * No-op in the polling model — there is no persistent socket to manage. Kept
 * for signature compatibility with the Firebase-direct code path.
 */
export function setupConnectionLifecycle(): () => void {
  return () => {};
}

/** No-op in polling mode (subscription will retry on its next tick). */
export async function forceReconnect(): Promise<void> {
  // intentional no-op
}
