// Vercel Edge function that proxies requests to Firebase Realtime Database.
// Why: corporate VPNs / proxies (e.g. Imprivata, Zscaler) block or break direct
// connections to firebasedatabase.app — both WebSockets and the long-polling
// fallback the Firebase SDK relies on. The browser instead talks to this
// function on the same origin as the app, which then makes a normal
// server-to-server HTTPS call to Firebase. The corporate proxy only ever sees
// traffic to the app domain, which is already allow-listed.
//
// Routing: the client calls /api/db/<path>. A rewrite in vercel.json maps that
// to this function with the Firebase path passed as the `dbpath` query param
// (catch-all filesystem routing like api/db/[...path].ts only matched a single
// segment on this Vite-on-Vercel setup, 404ing on deeper paths). We forward to
// `<db-url>/<dbpath>.json`, matching Firebase's REST conventions:
//   GET    /api/db/roadmap                       → read
//   PUT    /api/db/roadmap/projects/abc          → overwrite a project
//   PATCH  /api/db/roadmap                       → merge fields
//   DELETE /api/db/roadmap/projects/abc          → delete subtree

export const config = { runtime: 'edge' };

// Locally declare the only Node/runtime global we need, so this file is
// self-contained and type-checks under both the API and app tsconfigs (a test
// in src/ imports it) without depending on @types/node.
declare const process: { env: Record<string, string | undefined> };

const ALLOWED_METHODS = new Set(['GET', 'PUT', 'PATCH', 'POST', 'DELETE']);
const PATH_REGEX = /^[a-zA-Z0-9_\-/]*$/;
// Subtrees this proxy is allowed to touch. Roadmap is the core data; `ludo` is
// the hidden game, routed through here so it works behind corporate VPNs that
// block Firebase's WebSocket. Everything else (presence, connectFour, DB root)
// still goes via the Firebase SDK and must not be reachable through the proxy.
const ALLOWED_ROOTS = ['roadmap', 'ludo'];

export default async function handler(request: Request): Promise<Response> {
  const databaseUrl =
    process.env.FIREBASE_DATABASE_URL ?? process.env.VITE_FIREBASE_DATABASE_URL;

  if (!databaseUrl) {
    return jsonError(500, 'FIREBASE_DATABASE_URL not configured on server');
  }

  if (!ALLOWED_METHODS.has(request.method)) {
    return jsonError(405, `Method ${request.method} not allowed`);
  }

  // The Firebase path comes from the rewrite's `dbpath` query param. Fall back
  // to parsing the pathname after /api/db/ in case the request reaches this
  // function without going through the rewrite (e.g. direct invocation).
  const url = new URL(request.url);
  let path = url.searchParams.get('dbpath') ?? '';
  if (!path) {
    path = url.pathname.replace(/^\/api\/(db|proxy)\/?/, '');
  }
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');

  // Reject paths containing anything but alphanumerics, dashes, underscores,
  // and slashes. Prevents path-traversal and query-string injection.
  if (!PATH_REGEX.test(path)) {
    return jsonError(400, 'Invalid path');
  }

  // Restrict to the allowed subtrees only — this proxy must not be a
  // general-purpose read/write gateway to the whole database.
  const root = path.split('/')[0];
  if (!ALLOWED_ROOTS.includes(root)) {
    return jsonError(403, 'Path not allowed');
  }

  const upstreamUrl = `${databaseUrl.replace(/\/$/, '')}/${path}.json`;

  // For mutating requests, read body as text and forward verbatim.
  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    body = await request.text();
    if (body.length > 1024 * 1024) {
      // 1 MB cap — Firebase's write limit is far higher, but our payloads have
      // no reason to approach it. A small cap limits abuse / runaway saves.
      return jsonError(413, 'Payload too large');
    }
  }

  // Forward Firebase's ETag headers so the client can emulate transactions:
  // GET with `X-Firebase-ETag: true` returns an ETag; a conditional write with
  // `if-match: <etag>` succeeds only if the value is unchanged (else 412).
  const upstreamHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  const reqEtag = request.headers.get('x-firebase-etag');
  if (reqEtag) upstreamHeaders['X-Firebase-ETag'] = reqEtag;
  const ifMatch = request.headers.get('if-match');
  if (ifMatch) upstreamHeaders['if-match'] = ifMatch;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed';
    return jsonError(502, `Upstream error: ${message}`);
  }

  // Pass through status and body. Force no-store so corporate caching proxies
  // don't serve stale reads. Surface the upstream ETag for transaction support.
  const text = await upstream.text();
  const responseHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
  const respEtag = upstream.headers.get('etag');
  if (respEtag) responseHeaders['ETag'] = respEtag;

  // Conditional GET for ordinary reads (the 5s roadmap poll is the hot path).
  // Firebase only returns its own ETag when X-Firebase-ETag is requested
  // (the ludo transaction reads), so for plain reads we derive a content hash
  // here and honour If-None-Match: on an unchanged snapshot we reply 304 with
  // no body, sparing the client a full-payload transfer over the (often slow,
  // VPN-bound) link plus the JSON parse + diff it would otherwise do every
  // quiet tick. Skipped when the client asked for the Firebase ETag so we never
  // shadow the opaque token the if-match transaction flow depends on.
  if (request.method === 'GET' && !reqEtag && upstream.ok) {
    const computed = `W/"${text.length.toString(36)}-${weakHash(text)}"`;
    responseHeaders['ETag'] = computed;
    if (request.headers.get('if-none-match') === computed) {
      return new Response(null, { status: 304, headers: responseHeaders });
    }
  }

  return new Response(text, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

// Fast non-cryptographic hash (cyrb53) used only to detect whether a snapshot
// changed since the client's last poll. We don't need collision resistance
// against an adversary — just a stable fingerprint — so this avoids the cost of
// crypto.subtle in the edge hot path. Paired with the body length in the ETag,
// a false match is astronomically unlikely.
function weakHash(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hash = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return hash.toString(36);
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
