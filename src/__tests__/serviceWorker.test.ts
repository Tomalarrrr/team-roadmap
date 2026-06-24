// Ruthless behavioral tests for public/sw.js.
//
// The bug: roadmap reads/writes were moved behind a same-origin proxy
// (/api/db/*, /api/proxy), but the service worker's "always go to network"
// skip-list only matched literal firebase URLs. So data GETs fell through to
// the cache-first catch-all and got frozen — clients saw stale snapshots until
// a hard-refresh-with-cache-clear wiped Cache Storage.
//
// Rather than assert on source text, we load the REAL sw.js into a simulated
// service-worker global scope, dispatch real fetch events, and observe what the
// handler does. A request is "intercepted" iff the handler calls
// event.respondWith(); otherwise the browser handles it on the network — which
// is exactly the safe behavior we want for /api/.
//
// To prove the test actually catches the regression (and isn't vacuously
// green), one case reconstructs the PRE-FIX source by stripping the single
// guard line this change added, and asserts that version serves stale data.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';

// vitest runs with cwd at the project root.
const FIXED_SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8');

// Reconstruct the buggy pre-fix source by removing the /api/ guard.
const BUGGY_SOURCE = FIXED_SOURCE
  .replace(/\n\s*const path = new URL\(url\)\.pathname;/, '')
  .replace(/path\.startsWith\('\/api\/'\) \|\|\s*/, '');

const ORIGIN = 'https://roadmap.example';

type Req = { url: string; method?: string; mode?: string };

/** Boot a fresh, isolated service-worker scope from `source`. */
function instantiate(source: string) {
  const fetchCalls: string[] = [];
  // Per-URL incrementing body so a cache hit (stale body) is distinguishable
  // from a fresh network fetch (incremented body).
  const netCounter: Record<string, number> = {};
  const netConfig: Record<string, { status?: number; reject?: boolean }> = {};

  const fetchMock = (req: Req | string) => {
    const url = typeof req === 'string' ? req : req.url;
    fetchCalls.push(url);
    const cfg = netConfig[url] || {};
    if (cfg.reject) return Promise.reject(new Error('network down'));
    const n = (netCounter[url] = (netCounter[url] || 0) + 1);
    return Promise.resolve(new Response(`NETWORK#${n}:${url}`, { status: cfg.status ?? 200 }));
  };

  // Minimal but faithful Cache API, keyed by request URL. Honors the
  // { ignoreSearch } option by comparing origin+pathname (query stripped),
  // resolving bare paths like '/' against ORIGIN — exactly like the real API.
  type MatchOpts = { ignoreSearch?: boolean };
  const keysMatch = (storedUrl: string, wanted: string, opts?: MatchOpts) => {
    if (!opts || !opts.ignoreSearch) return storedUrl === wanted;
    const a = new URL(storedUrl, ORIGIN);
    const b = new URL(wanted, ORIGIN);
    return a.origin === b.origin && a.pathname === b.pathname;
  };
  class FakeCache {
    map = new Map<string, Response>();
    async match(req: Req | string, opts?: MatchOpts) {
      const want = typeof req === 'string' ? req : req.url;
      for (const [k, v] of this.map) if (keysMatch(k, want, opts)) return v;
      return undefined;
    }
    async put(req: Req | string, res: Response) {
      this.map.set(typeof req === 'string' ? req : req.url, res);
    }
  }
  const buckets = new Map<string, FakeCache>();
  const caches = {
    async open(name: string) {
      if (!buckets.has(name)) buckets.set(name, new FakeCache());
      return buckets.get(name)!;
    },
    async match(req: Req | string, opts?: MatchOpts) {
      for (const c of buckets.values()) {
        const r = await c.match(req, opts);
        if (r) return r;
      }
      return undefined;
    },
    async keys() {
      return [...buckets.keys()];
    },
    async delete(name: string) {
      return buckets.delete(name);
    },
  };

  const handlers: Record<string, (e: unknown) => void> = {};
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      handlers[type] = fn;
    },
    skipWaiting: () => {},
    clients: { claim: () => {}, matchAll: async () => [] },
  };

  const sandbox = { self, caches, fetch: fetchMock, Response, URL, Promise, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  async function dispatch(request: Req) {
    request.method = request.method ?? 'GET';
    let responded: Promise<Response> | undefined;
    handlers.fetch({
      request,
      respondWith: (p: Promise<Response>) => {
        responded = p;
      },
      waitUntil: () => {},
    });
    if (responded === undefined) {
      return { intercepted: false as const, body: null as string | null, status: null as number | null };
    }
    const res = await responded;
    // A handler can respondWith a promise that resolves to undefined (e.g. an
    // offline fallback that finds nothing cached) — surface that as a null body
    // rather than throwing on res.text().
    if (!res) return { intercepted: true as const, body: null as string | null, status: null as number | null };
    return { intercepted: true as const, body: await res.text(), status: res.status };
  }

  async function seedCache(url: string, body: string) {
    const c = await caches.open('preexisting');
    await c.put(url, new Response(body, { status: 200 }));
  }

  return { dispatch, seedCache, fetchCalls, netConfig };
}

describe('service worker — /api/ data requests must never be cached (the fix)', () => {
  it('does NOT intercept GET /api/db/roadmap, even when a stale copy is cached', async () => {
    const sw = instantiate(FIXED_SOURCE);
    const url = `${ORIGIN}/api/db/roadmap`;
    await sw.seedCache(url, 'STALE'); // poison the cache like a real frozen snapshot

    const r = await sw.dispatch({ url });

    // Not intercepted => the browser fetches from network; the SW never serves
    // the stale cached copy, and never even touches fetch itself.
    expect(r.intercepted).toBe(false);
    expect(sw.fetchCalls).not.toContain(url);
  });

  it('does NOT intercept GET /api/proxy (the rewrite target)', async () => {
    const sw = instantiate(FIXED_SOURCE);
    const r = await sw.dispatch({ url: `${ORIGIN}/api/proxy?dbpath=roadmap` });
    expect(r.intercepted).toBe(false);
  });

  it('does NOT intercept /api/db/* reads that carry a query string', async () => {
    const sw = instantiate(FIXED_SOURCE);
    const r = await sw.dispatch({ url: `${ORIGIN}/api/db/roadmap/projects/abc?cacheBust=1` });
    expect(r.intercepted).toBe(false);
  });

  it('does NOT intercept non-GET writes to /api (PUT/PATCH still hit the network)', async () => {
    const sw = instantiate(FIXED_SOURCE);
    const put = await sw.dispatch({ url: `${ORIGIN}/api/db/roadmap`, method: 'PUT' });
    const patch = await sw.dispatch({ url: `${ORIGIN}/api/db/roadmap`, method: 'PATCH' });
    expect(put.intercepted).toBe(false);
    expect(patch.intercepted).toBe(false);
  });

  it('still skips direct Firebase URLs (existing behavior preserved)', async () => {
    const sw = instantiate(FIXED_SOURCE);
    const r = await sw.dispatch({ url: 'https://my-app.firebaseio.com/roadmap.json' });
    expect(r.intercepted).toBe(false);
  });
});

describe('service worker — discriminator: the PRE-FIX code reproduces the bug', () => {
  it('reconstruction is valid: the fix exists and was actually stripped', () => {
    expect(FIXED_SOURCE).toContain("path.startsWith('/api/')");
    expect(BUGGY_SOURCE).not.toContain("startsWith('/api/')");
    expect(BUGGY_SOURCE).not.toBe(FIXED_SOURCE);
  });

  it('the buggy source DOES serve a stale cached /api/db/roadmap (proves the test bites)', async () => {
    const sw = instantiate(BUGGY_SOURCE);
    const url = `${ORIGIN}/api/db/roadmap`;
    await sw.seedCache(url, 'STALE');

    const r = await sw.dispatch({ url });

    // Without the /api/ guard, the data GET falls into the cache-first branch
    // and the user gets the frozen snapshot — exactly the reported symptom.
    expect(r.intercepted).toBe(true);
    expect(r.body).toBe('STALE');
  });
});

describe('service worker — other responsibilities still work (no collateral damage)', () => {
  it('genuine static assets remain cache-first', async () => {
    const sw = instantiate(FIXED_SOURCE);
    const url = `${ORIGIN}/Airedale.png`;

    const first = await sw.dispatch({ url });
    const second = await sw.dispatch({ url });

    expect(first.intercepted).toBe(true);
    expect(first.body).toBe(`NETWORK#1:${url}`); // first miss -> network, then cached
    expect(second.body).toBe(`NETWORK#1:${url}`); // second served from cache (same body)
    expect(sw.fetchCalls.filter((u) => u === url)).toHaveLength(1); // network hit once
  });

  it('a static asset with /api/ only in its query string is treated as an asset', async () => {
    // Proves the guard checks the PATH, not a naive whole-URL substring.
    const sw = instantiate(FIXED_SOURCE);
    const r = await sw.dispatch({ url: `${ORIGIN}/logo.png?ref=/api/db/roadmap` });
    expect(r.intercepted).toBe(true);
    expect(r.body).toBe(`NETWORK#1:${ORIGIN}/logo.png?ref=/api/db/roadmap`);
  });

  it('navigation requests are network-first (fresh HTML wins over cache)', async () => {
    const sw = instantiate(FIXED_SOURCE);
    const url = `${ORIGIN}/`;
    await sw.seedCache(url, 'STALE_HTML');
    const r = await sw.dispatch({ url, mode: 'navigate' });
    expect(r.intercepted).toBe(true);
    expect(r.body).toBe(`NETWORK#1:${url}`);
  });

  it('offline navigation falls back to a shell cached under a query string', async () => {
    // The shell was first cached under a query-bearing URL (e.g. an /?utm= entry
    // landing, or a share link). A later OFFLINE navigation to the bare root must
    // still be served the cached shell via ignoreSearch, not left blank.
    const sw = instantiate(FIXED_SOURCE);
    const shellUrl = `${ORIGIN}/?utm=launch`;
    await sw.seedCache(shellUrl, 'SHELL_HTML');

    const bare = `${ORIGIN}/`;
    sw.netConfig[bare] = { reject: true }; // offline

    const r = await sw.dispatch({ url: bare, mode: 'navigate' });

    expect(r.intercepted).toBe(true);
    expect(r.body).toBe('SHELL_HTML'); // served the query-keyed shell
  });

  it('discriminator: WITHOUT ignoreSearch the query-keyed shell is missed offline', async () => {
    // Reconstruct the pre-fix navigate fallback (exact-match '/') and prove it
    // leaves an offline navigation with no shell — exactly the gap the fix closes.
    const noIgnoreSearch = FIXED_SOURCE.replace(
      "caches.match('/', { ignoreSearch: true })",
      "caches.match('/')",
    );
    expect(noIgnoreSearch).not.toBe(FIXED_SOURCE); // the replacement actually fired

    const sw = instantiate(noIgnoreSearch);
    const shellUrl = `${ORIGIN}/?utm=launch`;
    await sw.seedCache(shellUrl, 'SHELL_HTML');
    const bare = `${ORIGIN}/`;
    sw.netConfig[bare] = { reject: true };

    const r = await sw.dispatch({ url: bare, mode: 'navigate' });

    expect(r.intercepted).toBe(true);
    expect(r.body).toBeNull(); // exact '/' match misses the query-keyed entry
  });

  it('hashed /assets/* are network-first, with cache fallback when offline', async () => {
    const sw = instantiate(FIXED_SOURCE);
    const url = `${ORIGIN}/assets/index-abc123.js`;
    await sw.seedCache(url, 'STALE_ASSET');

    const online = await sw.dispatch({ url });
    expect(online.body).toBe(`NETWORK#1:${url}`); // network preferred

    sw.netConfig[url] = { reject: true }; // simulate offline / VPN drop
    const offline = await sw.dispatch({ url });
    expect(offline.body).toBe('STALE_ASSET'); // falls back to cache
  });
});
