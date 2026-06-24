import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Make backoff instant and jitter deterministic; delegate fetchWithTimeout to
// the global fetch mock so we control every request/response.
vi.mock('../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: (url: string, init?: RequestInit) => (globalThis.fetch as typeof fetch)(url, init),
  sleep: () => Promise.resolve(),
  jitter: (n: number) => n,
  TimeoutError: class TimeoutError extends Error {},
}));

// Avoid executing the real firebase.ts module (which validates env on load).
vi.mock('../../firebase', () => ({
  ensureInitialized: vi.fn(),
  getDbModule: vi.fn(),
  markFirebaseActivity: vi.fn(),
}));

import { makeMove, addBot, createGame, type LudoGameState } from '../ludoApi';
import { deserializeRollStats } from '../../ludoPowerUps';

type FakeRes = {
  ok: boolean;
  status: number;
  headers: { get: (k: string) => string | null };
  text: () => Promise<string>;
};

function res(body: unknown, opts: { status?: number; etag?: string | null } = {}): FakeRes {
  const status = opts.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k.toLowerCase() === 'etag' ? opts.etag ?? null : null) },
    text: async () => (body === null ? 'null' : JSON.stringify(body)),
  };
}

const baseState = (over: Partial<LudoGameState> = {}): LudoGameState =>
  ({
    players: { red: { sessionId: 's-red', name: 'Red' }, green: { sessionId: 's-green', name: 'Green' } },
    tokens: 'bas'.repeat(16),
    currentTurn: 'red',
    turnPhase: 'roll',
    diceValue: null,
    consecutiveSixes: 0,
    winner: null,
    finishOrder: '',
    createdAt: 1,
    startedAt: 1,
    turnStartedAt: 1,
    playerCount: 2,
    ...over,
  }) as LudoGameState;

const moveUpdates = {
  tokens: 'bas'.repeat(16),
  currentTurn: 'green' as const,
  turnPhase: 'roll' as const,
  diceValue: null,
  consecutiveSixes: 0,
  winner: null,
  finishOrder: '',
  turnStartedAt: 1,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('makeMove (transaction emulation)', () => {
  it('commits and sends if-match with the read ETag when it is the players turn', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState({ currentTurn: 'red' }), { etag: 'e1' })) // GET w/ etag
      .mockResolvedValueOnce(res(null, { status: 200, etag: 'e2' })); // conditional PUT

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const putInit = fetchMock.mock.calls[1][1];
    expect(putInit.method).toBe('PUT');
    expect(putInit.headers['if-match']).toBe('e1');
    expect(JSON.parse(putInit.body).currentTurn).toBe('green');
  });

  it('aborts (no write) when it is not the players turn', async () => {
    fetchMock.mockResolvedValueOnce(res(baseState({ currentTurn: 'green' }), { etag: 'e1' }));

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // GET only, no PUT
  });

  it('aborts when the game is already won', async () => {
    fetchMock.mockResolvedValueOnce(res(baseState({ currentTurn: 'red', winner: 'green' }), { etag: 'e1' }));

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 412 conflict then commits', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState(), { etag: 'e1' })) // GET
      .mockResolvedValueOnce(res(null, { status: 412 })) // PUT conflict
      .mockResolvedValueOnce(res(baseState(), { etag: 'e2' })) // GET (retry)
      .mockResolvedValueOnce(res(null, { status: 200 })); // PUT success

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Second PUT must use the freshly re-read ETag, not the stale one.
    expect(fetchMock.mock.calls[3][1].headers['if-match']).toBe('e2');
  });

  it('gives up after exhausting retries when every write conflicts', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === 'GET') return Promise.resolve(res(baseState(), { etag: 'e' }));
      return Promise.resolve(res(null, { status: 412 })); // PUT always conflicts
    });

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(false);
    const puts = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT');
    expect(puts.length).toBe(12); // MAX_TXN_RETRIES
  });

  it('throws on a non-412 write error', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState(), { etag: 'e1' }))
      .mockResolvedValueOnce(res({ error: 'boom' }, { status: 500 }));

    await expect(makeMove('GAME', 'red', moveUpdates)).rejects.toThrow(/500/);
  });
});

describe('makeMove rollStats merge (anti-clobber)', () => {
  // rollStats packs all four colours' counts in one field; format per colour is
  // "r1,r2,r3,r4,r5,r6,captures" joined by "|". Index 5 is the count of 6s.
  const stats = (redSixes: number, greenSixes: number, redCaps = 0, greenCaps = 0) =>
    `0,0,0,0,0,${redSixes},${redCaps}|0,0,0,0,0,${greenSixes},${greenCaps}|0,0,0,0,0,0,0|0,0,0,0,0,0,0`;

  it('takes the per-cell max so a stale writer cannot wipe another player\'s rolls', async () => {
    // Server already has red=5 sixes, green=2. A client that only saw red=3
    // writes its fresh green=4 — red must NOT regress to 3.
    fetchMock
      .mockResolvedValueOnce(res(baseState({ currentTurn: 'red', rollStats: stats(5, 2, 1, 0) }), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    const ok = await makeMove('GAME', 'red', { ...moveUpdates, rollStats: stats(3, 4, 0, 3) });

    expect(ok).toBe(true);
    const merged = deserializeRollStats(JSON.parse(fetchMock.mock.calls[1][1].body).rollStats);
    expect(merged[0].rolls[5]).toBe(5); // red sixes: max(5,3)
    expect(merged[1].rolls[5]).toBe(4); // green sixes: max(2,4)
    expect(merged[0].captures).toBe(1); // red captures: max(1,0)
    expect(merged[1].captures).toBe(3); // green captures: max(0,3)
  });

  it('passes rollStats through untouched when the server has none yet', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState({ currentTurn: 'red', rollStats: undefined }), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    const ok = await makeMove('GAME', 'red', { ...moveUpdates, rollStats: stats(1, 0) });

    expect(ok).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).rollStats).toBe(stats(1, 0));
  });
});

describe('addBot (transaction emulation)', () => {
  it('adds a bot to an empty slot before the game starts', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res(baseState({ players: { red: { sessionId: 's-red', name: 'Red' } }, startedAt: null }), { etag: 'e1' })
      )
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await addBot('GAME', 'green');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.players.green.sessionId).toBe('bot-green');
  });

  it('does not write if the slot is already taken', async () => {
    fetchMock.mockResolvedValueOnce(
      res(baseState({ players: { red: { sessionId: 'r', name: 'R' }, green: { sessionId: 'g', name: 'G' } }, startedAt: null }), { etag: 'e1' })
    );

    await addBot('GAME', 'green');

    expect(fetchMock).toHaveBeenCalledTimes(1); // aborted, no PUT
  });
});

describe('createGame (create-if-not-exists)', () => {
  it('creates a game when the code is free and PUTs with the null ETag', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === 'GET') return Promise.resolve(res(null, { etag: 'null_etag' }));
      return Promise.resolve(res(null, { status: 200 })); // PUT + cleanup writes ok
    });

    const code = await createGame('sess', 'Player');

    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(0);
    const firstPut = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(firstPut?.[1].headers['if-match']).toBe('null_etag');
  });
});
