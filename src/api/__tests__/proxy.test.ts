import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler from '../../../api/proxy';

const DB = 'https://db.example.com';

function makeReq(dbpath: string, init: RequestInit = {}): Request {
  const qs = dbpath ? `?dbpath=${encodeURIComponent(dbpath)}` : '';
  return new Request(`https://app.test/api/proxy${qs}`, init);
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('FIREBASE_DATABASE_URL', DB);
  fetchMock = vi.fn().mockResolvedValue(
    new Response('{"ok":true}', { status: 200, headers: { ETag: 'srv-etag' } })
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('proxy path/root validation', () => {
  it('forwards an allowed roadmap read to the right upstream URL', async () => {
    const r = await handler(makeReq('roadmap'));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${DB}/roadmap.json`, expect.objectContaining({ method: 'GET' }));
    expect(r.headers.get('Cache-Control')).toBe('no-store');
  });

  it('forwards a deep multi-segment roadmap path', async () => {
    await handler(makeReq('roadmap/projects/abc/milestones/xyz'));
    expect(fetchMock).toHaveBeenCalledWith(`${DB}/roadmap/projects/abc/milestones/xyz.json`, expect.anything());
  });

  it('allows the ludo subtree', async () => {
    const r = await handler(makeReq('ludo/ABCD'));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${DB}/ludo/ABCD.json`, expect.anything());
  });

  it('allows the snake subtree, down to a seat', async () => {
    const r = await handler(makeReq('snake/ABCD/s/a'));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${DB}/snake/ABCD/s/a.json`, expect.anything());
  });

  it('allows the ludo3 subtree', async () => {
    const r = await handler(makeReq('ludo3/ABCD'));
    expect(r.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(`${DB}/ludo3/ABCD.json`, expect.anything());
  });

  it('blocks other subtrees (presence, connectFour) with 403 and no upstream call', async () => {
    for (const p of ['presence', 'connectFour/x', 'gamePaused']) {
      fetchMock.mockClear();
      const r = await handler(makeReq(p));
      expect(r.status).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  it('does not allow a prefix-only match like "roadmapX"', async () => {
    const r = await handler(makeReq('roadmapX'));
    expect(r.status).toBe(403);
  });

  it('rejects paths with illegal characters (400)', async () => {
    const r = await handler(makeReq('roadmap/../secret'));
    expect(r.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('proxy method handling', () => {
  it('rejects disallowed methods with 405', async () => {
    const r = await handler(makeReq('roadmap', { method: 'OPTIONS' }));
    expect(r.status).toBe(405);
  });

  it('forwards a PATCH body to the upstream', async () => {
    await handler(makeReq('roadmap', { method: 'PATCH', body: JSON.stringify({ a: 1 }) }));
    const init = fetchMock.mock.calls[0][1];
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
  });

  it('returns 413 for an oversized write body', async () => {
    const big = 'x'.repeat(1024 * 1024 + 10);
    const r = await handler(makeReq('roadmap', { method: 'PUT', body: big }));
    expect(r.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('proxy ETag handling (transaction support)', () => {
  it('forwards X-Firebase-ETag and surfaces the upstream ETag', async () => {
    const r = await handler(makeReq('ludo/ABCD', { headers: { 'X-Firebase-ETag': 'true' } }));
    const upstreamInit = fetchMock.mock.calls[0][1];
    expect(upstreamInit.headers['X-Firebase-ETag']).toBe('true');
    expect(r.headers.get('ETag')).toBe('srv-etag');
  });

  it('forwards if-match on conditional writes and passes through 412', async () => {
    fetchMock.mockResolvedValueOnce(new Response('null', { status: 412, headers: { ETag: 'current' } }));
    const r = await handler(makeReq('ludo/ABCD', { method: 'PUT', body: '{}', headers: { 'if-match': 'stale' } }));
    expect(fetchMock.mock.calls[0][1].headers['if-match']).toBe('stale');
    expect(r.status).toBe(412);
    expect(r.headers.get('ETag')).toBe('current');
  });
});

describe('proxy conditional GET (poll 304s)', () => {
  beforeEach(() => {
    // Fresh Response per call: a Response body can only be read once, and these
    // tests invoke the handler more than once.
    fetchMock.mockImplementation(async () =>
      new Response('{"ok":true}', { status: 200, headers: { ETag: 'srv-etag' } })
    );
  });

  it('returns a computed ETag and 304 (no body) when If-None-Match matches', async () => {
    const first = await handler(makeReq('roadmap'));
    expect(first.status).toBe(200);
    const tag = first.headers.get('ETag');
    expect(tag).toBeTruthy();

    // Identical upstream body → identical computed tag → unchanged.
    const second = await handler(makeReq('roadmap', { headers: { 'If-None-Match': tag! } }));
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
    expect(second.headers.get('ETag')).toBe(tag);
  });

  it('returns 200 with the body when If-None-Match does not match', async () => {
    const r = await handler(makeReq('roadmap', { headers: { 'If-None-Match': 'W/"stale"' } }));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('{"ok":true}');
  });

  it('never 304s a read that requested the Firebase ETag (ludo transactions)', async () => {
    // Transaction reads must always get the opaque upstream ETag and a real
    // body, even if a stale If-None-Match rides along.
    const r = await handler(makeReq('ludo/ABCD', {
      headers: { 'X-Firebase-ETag': 'true', 'If-None-Match': 'anything' },
    }));
    expect(r.status).toBe(200);
    expect(r.headers.get('ETag')).toBe('srv-etag');
    expect(await r.text()).toBe('{"ok":true}');
  });
});

describe('proxy event stream (live rooms)', () => {
  const streamReq = (dbpath: string) => makeReq(dbpath, { headers: { Accept: 'text/event-stream' } });

  it('asks Firebase for a stream and passes its body through as it arrives', async () => {
    const events = 'event: put\ndata: {"path":"/","data":{"m":1}}\n\n';
    fetchMock.mockResolvedValue(new Response(events, { status: 200 }));
    const r = await handler(streamReq('swarm/ABCD'));
    expect(fetchMock).toHaveBeenCalledWith(`${DB}/swarm/ABCD.json`, { headers: { Accept: 'text/event-stream' } });
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('text/event-stream');
    expect(r.headers.get('Cache-Control')).toBe('no-store, no-transform');
    expect(await r.text()).toBe(events);
  });

  it('passes on a refusal from Firebase as an error, not a stream', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"Permission denied"}', { status: 401 }));
    const r = await handler(streamReq('swarm/ABCD'));
    expect(r.status).toBe(401);
    expect(r.headers.get('Content-Type')).toBe('application/json');
  });

  it('still refuses a root outside the allowed list', async () => {
    const r = await handler(streamReq('presence'));
    expect(r.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves a plain read as a plain read', async () => {
    const r = await handler(makeReq('swarm/ABCD'));
    expect(r.headers.get('Content-Type')).toBe('application/json');
    expect(fetchMock).toHaveBeenCalledWith(`${DB}/swarm/ABCD.json`, expect.objectContaining({ method: 'GET' }));
  });
});

describe('proxy configuration errors', () => {
  it('returns 500 when the database URL is not configured', async () => {
    vi.stubEnv('FIREBASE_DATABASE_URL', '');
    vi.stubEnv('VITE_FIREBASE_DATABASE_URL', '');
    const r = await handler(makeReq('roadmap'));
    expect(r.status).toBe(500);
  });

  it('returns 502 when the upstream fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    const r = await handler(makeReq('roadmap'));
    expect(r.status).toBe(502);
  });
});
