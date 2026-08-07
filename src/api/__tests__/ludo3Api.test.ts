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
  type Ludo3GameState,
} from '../ludo3Api';
import { deserializeRollStats, PLAYER_COLORS } from '../../ludo3Board';

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

const baseState = (over: Partial<Ludo3GameState> = {}): Ludo3GameState =>
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
  }) as Ludo3GameState;

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
  it('commits against the ludo3 namespace with the read ETag', async () => {
    fetchMock
      .mockResolvedValueOnce(res(baseState({ currentTurn: 'red' }), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    const ok = await makeMove('GAME', 'red', moveUpdates);

    expect(ok).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/db/ludo3/GAME');
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
    fetchMock.mockResolvedValueOnce(res(baseState({ currentTurn: 'red', winner: 'blue' }), { etag: 'e1' }));

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
    // 3 colour groups: red|green|blue, each "r1..r6,captures"
    const stats = (redSixes: number, blueSixes: number) =>
      `0,0,0,0,0,${redSixes},0|0,0,0,0,0,0,0|0,0,0,0,0,${blueSixes},0`;
    fetchMock
      .mockResolvedValueOnce(res(baseState({ rollStats: stats(5, 2) }), { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    const ok = await makeMove('GAME', 'red', { ...moveUpdates, rollStats: stats(3, 4) });

    expect(ok).toBe(true);
    const merged = deserializeRollStats(JSON.parse(fetchMock.mock.calls[1][1].body).rollStats);
    expect(merged[0].rolls[5]).toBe(5); // red sixes: max(5,3)
    expect(merged[2].rolls[5]).toBe(4); // blue sixes: max(2,4)
  });
});

describe('addBot / removeBot', () => {
  it('seats a bot in the next free chair, closing any gap', async () => {
    fetchMock
      .mockResolvedValueOnce(
        res(baseState({ players: { red: { sessionId: 's-red', name: 'Red' } }, startedAt: null }), { etag: 'e1' })
      )
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await addBot('GAME', 'blue', 's-red');

    // Asked for blue, seated in green: the turn rotation runs over the first
    // `playerCount` colours, so a gap is a chair nobody can play from. Packing
    // it out here rather than at the off is what stops a player's colour
    // changing under them when the board appears — and a bot re-keys to the
    // seat it lands in, name and id together.
    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.players.blue).toBeUndefined();
    expect(putBody.players.green.sessionId).toBe('bot-green');
    expect(putBody.players.green.name).toBe('Bot Green');
    expect(putBody.players.red.sessionId).toBe('s-red');
  });

  it('does not write if the slot is already taken', async () => {
    fetchMock.mockResolvedValueOnce(res(baseState({ startedAt: null }), { etag: 'e1' }));

    await addBot('GAME', 'green', 's-red');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to seat a bot for anyone but the host', async () => {
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
            players: { blue: { sessionId: 's-blue', name: 'Blue' } },
            host: 'blue',
            startedAt: null,
          }),
          { etag: 'e1' }
        )
      )
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await addBot('GAME', 'red', 's-blue');

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

// The lobby promises a colour; the game has to keep it.
//
// The turn rotation is a cycle over the first `playerCount` colours, so an
// empty chair in the middle is a seat nobody can play from. That gap used to be
// closed when the game started, which meant a player could sit in the lobby as
// Blue and find themselves Green the moment the board appeared, with nothing on
// screen to explain it. Every seat is now packed as it changes, so the gap
// never exists and the pack-down at the off has nothing to do.
describe('seating never leaves a gap', () => {
  it('packs the room when a player in the middle leaves', async () => {
    const waiting = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        green: { sessionId: 's-mid', name: 'Mid' },
        blue: { sessionId: 's-high', name: 'High' },
      },
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(waiting, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await leaveGame('GAME', 's-mid');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.players.red.sessionId).toBe('s-red');
    // The player above the hole slid down into it *now*, in the lobby, where
    // everyone can see it happen — not silently at kick-off.
    expect(putBody.players.green.sessionId).toBe('s-high');
    expect(putBody.players.blue).toBeUndefined();
  });

  it('keeps the host with the person, not the colour, across a re-seat', async () => {
    const waiting = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        green: { sessionId: 's-mid', name: 'Mid' },
        blue: { sessionId: 's-host', name: 'Host' },
      },
      host: 'blue',
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(waiting, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await leaveGame('GAME', 's-mid');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    // The host moved down a chair; the host field has to move with them, or the
    // room hands its controls to whoever slid into the colour they left.
    expect(putBody.players[putBody.host].sessionId).toBe('s-host');
  });

  it('starts a full table without moving anybody', async () => {
    // Every arm taken. The seats are rotations of one another, so there is
    // nothing to draw for — and a colour that changes as the board appears is
    // the thing players read as a bug.
    const players: Record<string, { sessionId: string; name: string }> = {};
    PLAYER_COLORS.forEach((c, i) => { players[c] = { sessionId: `s-${i}`, name: `P${i}` }; });
    const waiting = baseState({ players, host: 'red', startedAt: null } as never);
    fetchMock
      .mockResolvedValueOnce(res(waiting, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await startGame('GAME', 's-0');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    PLAYER_COLORS.forEach((c, i) => {
      expect(putBody.players[c].sessionId).toBe(`s-${i}`);
    });
    expect(putBody.playerCount).toBe(PLAYER_COLORS.length);
  });

  it('draws for the seats when short-handed, where they are not even', async () => {
    // Two of three (or four) arms: one seat really is better, so which player
    // gets it is a coin flip rather than a fixture. Run the draw enough times
    // that a fixed assignment could not survive.
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const waiting = baseState({
        players: {
          red: { sessionId: 's-a', name: 'A' },
          green: { sessionId: 's-b', name: 'B' },
        },
        host: 'red',
        startedAt: null,
      });
      fetchMock
        .mockResolvedValueOnce(res(waiting, { etag: 'e1' }))
        .mockResolvedValueOnce(res(null, { status: 200 }));
      await startGame('GAME', 's-a');
      const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      seen.add(putBody.players.red.sessionId);
    }
    expect(seen).toEqual(new Set(['s-a', 's-b']));
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
    expect(del![0]).toContain('/api/db/ludo3/GAME');
  });

  it('does nothing for someone who is not at the table', async () => {
    fetchMock.mockResolvedValueOnce(res(baseState(), { etag: 'e1' }));

    await leaveGame('GAME', 's-stranger');

    expect(fetchMock).toHaveBeenCalledTimes(1); // aborted, no PUT
  });
});

describe('joinGame', () => {
  it('assigns the first open seat in board order', async () => {
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
    expect(putBody.players.blue).toBeUndefined();
  });

  it('throws when all three seats are taken', async () => {
    const full = baseState({
      players: {
        red: { sessionId: 'a', name: 'A' },
        green: { sessionId: 'b', name: 'B' },
        blue: { sessionId: 'c', name: 'C' },
      },
      startedAt: null,
    });
    fetchMock.mockResolvedValueOnce(res(full, { etag: 'e1' }));

    await expect(joinGame('GAME', 's-new', 'New')).rejects.toThrow('Game is full');
  });
});

describe('startGame', () => {
  it('closes the gap between seats instead of filling it with a bot', async () => {
    // Seats are dealt at random, so two humans can easily land on red and blue
    // with two empty seats between them. The turn order is a rotation over the
    // first `playerCount` seats, so the gaps have to go: slide blue down into
    // green and it is a two-player game.
    const state = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        blue: { sessionId: 's-blue', name: 'Blue' },
      },
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(state, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await startGame('GAME', 's-red');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.playerCount).toBe(2);
    // Both players end up on the first two colours, one each. *Which* of them
    // takes red is a coin flip (see startGame) — the seats are not equivalent
    // when only two of three arms are in play, so the favoured one is dealt at
    // random rather than always going to whoever joined second.
    expect([putBody.players.red.sessionId, putBody.players.green.sessionId].sort())
      .toEqual(['s-blue', 's-red']);
    expect(putBody.players.blue).toBeUndefined();
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

    await startGame('GAME', 's-red');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(putBody.playerCount).toBe(2);
    expect(putBody.singlePlayer).toBe(true);
  });

  it('moves the host seat along with the host', async () => {
    const state = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        blue: { sessionId: 's-blue', name: 'Blue' },
      },
      host: 'blue',
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(state, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await startGame('GAME', 's-blue');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    // Wherever the shuffle put them, the host field points at the seat their
    // session actually holds — following them by colour instead would leave it
    // pointing at whoever landed on the colour they used to have.
    expect(putBody.players[putBody.host].sessionId).toBe('s-blue');
  });

  it('re-keys a bot onto the seat it slid into', async () => {
    const state = baseState({
      players: {
        red: { sessionId: 's-red', name: 'Red' },
        blue: { sessionId: 'bot-blue', name: 'Bot Blue' },
      },
      startedAt: null,
    });
    fetchMock
      .mockResolvedValueOnce(res(state, { etag: 'e1' }))
      .mockResolvedValueOnce(res(null, { status: 200 }));

    await startGame('GAME', 's-red');

    const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    // A bot carries its seat in both its id and its name, so whichever colour
    // the shuffle deals it has to be re-keyed to match — slid across untouched,
    // a green chair spends the game labelled "Bot Blue" beside a green dot.
    const botSeat = Object.keys(putBody.players).find(
      (c) => putBody.players[c].sessionId.startsWith('bot-')
    );
    expect(botSeat).toBeDefined();
    expect(putBody.players[botSeat!]).toEqual({
      sessionId: `bot-${botSeat}`,
      name: `Bot ${botSeat![0].toUpperCase()}${botSeat!.slice(1)}`,
    });
    expect(putBody.singlePlayer).toBe(true);
  });

  /* The seats are not equivalent when fewer people play than the board has
     arms, so which player gets the favoured one has to be a coin flip. Board
     order made it the joiner's two games in three: the creator draws a colour
     at random and the joiner takes the first free one, so the joiner was on the
     first colour whenever the creator had not drawn it. */
  it('deals the seats at random, not in board order', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      fetchMock.mockReset();
      fetchMock
        .mockResolvedValueOnce(res(baseState({
          players: {
            red: { sessionId: 's-red', name: 'Red' },
            green: { sessionId: 's-green', name: 'Green' },
          },
          startedAt: null,
        }), { etag: 'e1' }))
        .mockResolvedValueOnce(res(null, { status: 200 }));
      await startGame('GAME', 's-red');
      const putBody = JSON.parse(fetchMock.mock.calls[1][1].body);
      seen.add(putBody.players.red.sessionId);
    }
    // Both players land on red across 60 starts. A board-order slide would only
    // ever produce one of these (odds of a fair deal failing this: 2^-59).
    expect([...seen].sort()).toEqual(['s-green', 's-red']);
  });

  it('refuses to start with fewer than 2 players', async () => {
    const state = baseState({
      players: { red: { sessionId: 's-red', name: 'Red' } },
      startedAt: null,
    });
    fetchMock.mockResolvedValueOnce(res(state, { etag: 'e1' }));

    await startGame('GAME', 's-red');

    expect(fetchMock).toHaveBeenCalledTimes(1); // aborted, no PUT
  });

  it('refuses to start for anyone but the host', async () => {
    const state = baseState({ startedAt: null });
    fetchMock.mockResolvedValueOnce(res(state, { etag: 'e1' }));

    await startGame('GAME', 's-green');

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
    expect(['red', 'green', 'blue']).toContain(color);
    const firstPut = fetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
    const body = JSON.parse(firstPut![1].body);
    expect(body.host).toBe(color);
    expect(body.players[color].sessionId).toBe('sess');
    expect(Object.keys(body.players)).toHaveLength(1);
    expect(body.tokens).toHaveLength(45);
    expect(body.playerCount).toBe(3);
    expect(body.rollStats.split('|')).toHaveLength(3);
    // Every seat starts cold — the warm die never inherits a count.
    expect(body.yardMisses).toBe('0,0,0');
    expect(firstPut?.[1].headers['if-match']).toBe('null_etag');
    expect(firstPut?.[0]).toContain('/api/db/ludo3/');
  });
});
