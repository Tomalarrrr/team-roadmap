// Vercel serverless API route that proxies requests to Firebase Realtime
// Database. Why: corporate VPNs / proxies (e.g. Imprivata, Zscaler) often
// block or break direct connections to firebasedatabase.app — both
// WebSockets and the long-polling fallback the Firebase SDK relies on.
//
// The browser instead talks to *this* Vercel function on the same origin
// as the app. The proxy then makes a normal server-to-server HTTPS call to
// Firebase. The corporate proxy only ever sees traffic to the app domain,
// which is already allow-listed because the page itself loads from there.
//
// Maps directly onto Firebase's REST API conventions:
//   GET    /api/db/roadmap                → read
//   PUT    /api/db/roadmap                → overwrite
//   PATCH  /api/db/roadmap                → merge fields
//   DELETE /api/db/roadmap/projects/abc   → delete subtree
//
// Path is taken from the [...path] catch-all and forwarded as
// `<db-url>/<path>.json` exactly as the Firebase SDK would internally.

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

  // Extract path after /api/db/
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/db\/?/, '').replace(/\/+$/, '');

  // Reject paths that contain anything but alphanumerics, dashes, underscores,
  // and slashes. Prevents path-traversal and query-string injection.
  if (!PATH_REGEX.test(path)) {
    return jsonError(400, 'Invalid path');
  }

  // This proxy exists only for the roadmap data tree. Games and presence still
  // use the Firebase SDK directly, so there's no reason to expose any other
  // subtree (or the DB root) through here. Restricting the prefix keeps the
  // proxy from being a general-purpose open read/write gateway to the whole DB.
  if (path !== 'roadmap' && !path.startsWith('roadmap/')) {
    return jsonError(403, 'Path not allowed');
  }

  const upstreamUrl = `${databaseUrl.replace(/\/$/, '')}/${path}.json`;

  // For mutating requests, read body as text and forward verbatim.
  let body: string | undefined;
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    body = await request.text();
    if (body.length > 1024 * 1024) {
      // 1 MB cap — Firebase write limit is 16 MB but no reason for our payloads
      // to be remotely that large. A small cap reduces abuse / runaway saves.
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
