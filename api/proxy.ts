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

const ALLOWED_METHODS = new Set(['GET', 'PUT', 'PATCH', 'POST', 'DELETE']);
const PATH_REGEX = /^[a-zA-Z0-9_\-/]*$/;

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

  // This proxy exists only for the roadmap data tree. Games and presence still
  // use the Firebase SDK directly, so there's no reason to expose any other
  // subtree (or the DB root) through here.
  if (path !== 'roadmap' && !path.startsWith('roadmap/')) {
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

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: request.method,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upstream fetch failed';
    return jsonError(502, `Upstream error: ${message}`);
  }

  // Pass through status and body. Force no-store so corporate caching proxies
  // don't serve stale roadmap reads.
  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
