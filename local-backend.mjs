// Minimal local stand-in for the Firebase Realtime Database REST API.
//
// The roadmap app talks to a backend through the Vite dev proxy, which rewrites
//   /api/db/<path>  ->  <DB_URL>/<path>.json
// and expects Firebase RTDB REST semantics (GET / PUT / PATCH, null for misses).
//
// This server implements exactly that contract against a JSON file on disk, so
// `npm run dev` works fully locally with no Firebase project. Point the proxy at
// it by setting FIREBASE_DATABASE_URL=http://localhost:9000 in .env.

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createDbEngine, segments } from './local-db-engine.mjs';

const PORT = process.env.LOCAL_DB_PORT ? Number(process.env.LOCAL_DB_PORT) : 9000;
const DB_FILE = new URL('./.local-db.json', import.meta.url);

let initial = {};
try {
  if (existsSync(DB_FILE)) initial = JSON.parse(readFileSync(DB_FILE, 'utf-8')) || {};
} catch {
  initial = {};
}

// All RTDB-shaped read/write logic lives in the shared engine so the server and
// its unit tests exercise exactly the same code path.
const engine = createDbEngine(initial);

function persist() {
  try {
    writeFileSync(DB_FILE, JSON.stringify(engine.snapshot(), null, 2));
  } catch (err) {
    console.error('[local-db] failed to persist:', err);
  }
}

const getAt = (parts) => engine.get(parts);
const setAt = (parts, value) => engine.set(parts, value);
const patchAt = (parts, obj) => engine.patch(parts, obj);

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

const server = createServer(async (req, res) => {
  // CORS / preflight — harmless for same-origin proxy use, helpful otherwise.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);
  const parts = segments(pathname);

  try {
    if (req.method === 'GET') {
      res.writeHead(200);
      return res.end(JSON.stringify(getAt(parts)));
    }

    if (req.method === 'PUT') {
      const body = await readBody(req);
      const value = body ? JSON.parse(body) : null;
      setAt(parts, value);
      persist();
      res.writeHead(200);
      return res.end(JSON.stringify(value));
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req);
      const value = body ? JSON.parse(body) : {};
      patchAt(parts, value);
      persist();
      res.writeHead(200);
      return res.end(JSON.stringify(value));
    }

    if (req.method === 'DELETE') {
      setAt(parts, null);
      persist();
      res.writeHead(200);
      return res.end('null');
    }

    res.writeHead(405);
    return res.end(JSON.stringify({ error: 'method not allowed' }));
  } catch (err) {
    res.writeHead(400);
    return res.end(JSON.stringify({ error: String(err?.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(`[local-db] Firebase-REST stand-in listening on http://localhost:${PORT}`);
  console.log(`[local-db] data file: ${DB_FILE.pathname}`);
});
