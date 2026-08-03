import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Make backoff instant and jitter deterministic; delegate fetchWithTimeout to
// the global fetch mock so we control every request/response.
vi.mock('../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: (url: string, init?: RequestInit) => (globalThis.fetch as typeof fetch)(url, init),
  sleep: () => Promise.resolve(),
  jitter: (n: number) => n,
  TimeoutError: class TimeoutError extends Error {},
}));

import {
  makeMove,
  addBot,
  removeBot,
  createGame,
  joinGame,
  startGame,
  leaveGame,
  type Ludo2GameState,
} from '../ludo2Api';
import { deserializeRollStats } from '../../ludo2Board';

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

const baseState = (over: Partial<Ludo2GameState> = {}): Ludo2GameState =>
  ({
    players: { red: { sessionId: 's-red', name: 'Red' }, green: { sessionId: 's-green', name: 'Green' } },
    tokens: 'bas'.repeat(12),
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
  }) as Ludo2GameState;

const moveUpdates = {
  tokens: 'bas'.repeat(12),
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

describe('makeMove', () => {
  it('commits against the ludo2 namespace with the read ETag', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState({ currentTurn: 'red' }), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/db/ludo2/GAME');
    const putInit = fetchMock.mock.calls[1][1];
    expect(putInit.method).toBe('PUT');
    expect(putInit.headers['if-match']).toBe('e1');
    expect(JSON.parse(putInit.body).currentTurn).toBe('green');
  });

  it('aborts when it is not the players turn', async () => {
    fetchMock.mockResolvedValueOnce(res(baseState({ currentTurn: 'green' }), { etag: 'e1' }));

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('aborts when the game is already won', async () => {
    fetchMock.mockResolvedValueOnce(res(baseState({ currentTurn: 'red', winner: 'yellow' }), { etag: 'e1' }));

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 412 conflict then commits with the fresh ETag', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState(), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 412 }))
      .mockResolvedValueOnce(res(baseState(), { etag: 'e2' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(true);
    expect(fetchMock.mock.calls[3][1].headers['if-match']).toBe('e2');
  });

  it('merges rollStats per-cell max so a stale writer cannot wipe rolls', async () => {
    // 3 colour groups: red|green|yellow, each "r1..r6,captures"
    const stats = (redSixes: number, greenSixes: number) =>
      `0,0,0,0,0,${redSixes},0|0,0,0,0,0,${greenSixes},0|0,0,0,0,0,0,0`;
    fetchMock
      .mockResolvedValueOnce(res(baseState({ rollStats: stats(5, 2) }), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    const ok = await makeMove('GAME', 'red', { ...moveUpdates, rollStats: stats(3, 4) });

    expect(ok).toBe(true);
    const merged = deserializeRollStats(JSON.parse(fetchMock.mock.calls[1][1].body).rollStats);
    expect(merged[0].rolls[5]).toBe(5); // red sixes: max(5,3)
    expect(merged[1].rolls[5]).toBe(4); // green sixes: max(2,4)
  });
});

describe('addBot / removeBot', () => {
  it('adds a bot to an empty slot before the game starts', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res(baseState({ players: { red: { sessionId: 's-red', name: 'Red' } }, startedAt: null }), { etag: 'e1' })
      )
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await addBot('GAME', 'green', 's-red');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.players.green.sessionId).toBe('bot-green');
  });

  it('does not write if the slot is already taken', async () => {
    fetchMock.mockResolvedValueOnce(res(baseState({ startedAt: null }), { etag: 'e1' }));

    await addBot('GAME', 'green', 's-red');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to seat a bot for anyone but the host', async () => {
    // The lobby only offers the control to the host; this is the same rule
    // somewhere a second tab or a stale client cannot talk its way around.
    fetchMock.mockResolvedValueOnce(
      res(baseState({ players: { red: { sessionId: 's-red', name: 'Red' } }, startedAt: null }), { etag: 'e1' })
    );

    await addBot('GAME', 'green', 's-green');

    expect(fetchMock).toHaveBeenCalledTimes(1); // aborted, no PUT
  });

  it('honours a stored host that is not red', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res(
          baseState({
            players: { green: { sessionId: 's-green', name: 'Green' } },
            host: 'green',
            startedAt: null,
          }),
          { etag: 'e1' }
        )
      )
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await addBot('GAME', 'red', 's-green');

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).players.red.sessionId).toBe('bot-red');
  });

  it('removes a bot for the host and refuses to remove a human', async () => {
    const withBot = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        green: { sessionId: 'bot-green', name: 'Bot Green' },
      },
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(withBot, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await removeBot('GAME', 'green', 's-red');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).players.green).toBeUndefined();

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(res(baseState({ startedAt: null }), { etag: 'e2' }));
    await removeBot('GAME', 'green', 's-red'); // green is a human here
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('leaveGame', () => {
  it('empties the seat outright before the game starts', async () => {
    const waiting = baseState({ startedAt: null });
    fetchMock
      .mockResolvedValueOnce(res(waiting, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await leaveGame('GAME', 's-green');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.players.green).toBeUndefined();
    expect(putBody.players.red.sessionId).toBe('s-red');
  });

  it('leaves a bot behind mid-game so the rotation keeps turning', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState(), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await leaveGame('GAME', 's-green');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.players.green.sessionId).toBe('bot-green');
    expect(putBody.singlePlayer).toBe(true);
  });

  it('hands the host seat to a remaining human', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState({ host: 'red' }), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await leaveGame('GAME', 's-red');

    expect(JSON.parse(fetchMock.mock.calls[1][1].body).host).toBe('green');
  });

  it('removes the room once the last human walks away', async () => {
    const soloWithBot = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        green: { sessionId: 'bot-green', name: 'Bot Green' },
      },
    });
    fetchMock
      .mockResolvedValueOnce(res(soloWithBot, { etag: 'e1' })) // txn GET
      .mockResolvedValueOnce(res(null, { status: 200 })) // txn PUT
      .mockResolvedValueOnce(res(null, { status: 200 })); // DELETE

    await leaveGame('GAME', 's-red');

    const del = fetchMock.mock.calls.find((c) => c[1]?.method === 'DELETE');
    expect(del).toBeDefined();
    expect(del![0]).toContain('/api/db/ludo2/GAME');
  });

  it('does nothing for someone who is not at the table', async () => {
    fetchMock.mockResolvedValueOnce(res(baseState(), { etag: 'e1' }));

    await leaveGame('GAME', 's-stranger');

    expect(fetchMock).toHaveBeenCalledTimes(1); // aborted, no PUT
  });
});

describe('joinGame', () => {
  it('assigns green first, then yellow', async () => {
    const oneHuman = baseState({
      players: { red: { sessionId: 's-red', name: 'Red' } },
      startedAt: null,
    });
    const afterJoin = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        green: { sessionId: 's-new', name: 'New' },
      },
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(oneHuman, { etag: 'e1' })) // txn GET
      .mockResolvedValueOnce(res(null, { status: 200 })) // txn PUT
      .mockResolvedValueOnce(res(afterJoin)); // confirm GET

    const { assignedColor } = await joinGame('GAME', 's-new', 'New');

    expect(assignedColor).toBe('green');
    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.players.green.sessionId).toBe('s-new');
  });

  it('reconnects an existing player by sessionId without claiming a new slot', async () => {
    const state = baseState({ startedAt: null });
    fetchMock
      .mockResolvedValueOnce(res(state, { etag: 'e1' })) // txn GET
      .mockResolvedValueOnce(res(null, { status: 200 })) // idempotent PUT of unchanged state
      .mockResolvedValueOnce(res(state)); // confirm GET

    const { assignedColor } = await joinGame('GAME', 's-green', 'Green');

    expect(assignedColor).toBe('green');
    // The write must not have moved the player to a different slot
    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.players.green.sessionId).toBe('s-green');
    expect(putBody.players.yellow).toBeUndefined();
  });

  it('throws when the game is full', async () => {
    const full = baseState({
      players: {
        red: { sessionId: 'a', name: 'A' },
        green: { sessionId: 'b', name: 'B' },
        yellow: { sessionId: 'c', name: 'C' },
      },
      startedAt: null,
    });
    fetchMock.mockResolvedValueOnce(res(full, { etag: 'e1' }));

    await expect(joinGame('GAME', 's-new', 'New')).rejects.toThrow('Game is full');
  });
});

describe('startGame', () => {
  it('closes the gap between seats instead of filling it with a bot', async () => {
    // Seats are dealt at random, so two humans can easily land on red and
    // yellow with green empty. The turn order is a rotation over the first
    // `playerCount` seats, so the gap has to go: slide yellow down into green
    // and it is a two-player game. Padding it out to three put a bot nobody
    // asked for into a game between two people.
    const state = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        yellow: { sessionId: 's-yellow', name: 'Yellow' },
      },
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(state, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await startGame('GAME');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.playerCount).toBe(2);
    expect(putBody.players.red.sessionId).toBe('s-red');
    expect(putBody.players.green.sessionId).toBe('s-yellow');
    expect(putBody.players.yellow).toBeUndefined();
    expect(putBody.singlePlayer).toBeUndefined();
    expect(['red', 'green']).toContain(putBody.currentTurn);
  });

  it('keeps a real bot and flags the game single-player', async () => {
    const state = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        green: { sessionId: 'bot-green', name: 'Bot Green' },
      },
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(state, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await startGame('GAME');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.playerCount).toBe(2);
    expect(putBody.singlePlayer).toBe(true);
  });

  it('moves the host seat along with the host', async () => {
    // The host was on yellow and yellow slides into green. Following the colour
    // would leave `host` pointing at the seat somebody else just moved into.
    const state = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        yellow: { sessionId: 's-yellow', name: 'Yellow' },
      },
      host: 'yellow',
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(state, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await startGame('GAME');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.host).toBe('green');
    expect(putBody.players.green.sessionId).toBe('s-yellow');
  });

  it('refuses to start with fewer than 2 players', async () => {
    const state = baseState({
      players: { red: { sessionId: 's-red', name: 'Red' } },
      startedAt: null,
    });
    fetchMock.mockResolvedValueOnce(res(state, { etag: 'e1' }));

    await startGame('GAME');

    expect(fetchMock).toHaveBeenCalledTimes(1); // aborted, no PUT
  });
});

describe('createGame', () => {
  it('creates a 3-seat classic game with 45-char tokens', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === 'GET') return Promise.resolve(res(null, { etag: 'null_etag' }));
      return Promise.resolve(res(null, { status: 200 }));
    });

    const { code, color } = await createGame('sess', 'Player');

    expect(typeof code).toBe('string');
    // Seats are dealt at random — the creator is not always red
    expect(['red', 'green', 'yellow']).toContain(color);
    const firstPut = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
    const body = JSON.parse(firstPut![1].body);
    expect(body.host).toBe(color);
    expect(body.players[color].sessionId).toBe('sess');
    expect(Object.keys(body.players)).toHaveLength(1);
    expect(body.tokens).toHaveLength(45);
    expect(body.playerCount).toBe(3);
    expect(body.rollStats.split('|')).toHaveLength(3);
    expect(firstPut?.[1].headers['if-match']).toBe('null_etag');
    expect(firstPut?.[0]).toContain('/api/db/ludo2/');
  });
});
