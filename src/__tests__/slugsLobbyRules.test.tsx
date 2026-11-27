import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlugsMatch, SlugsRoom } from '../api/slugsApi';

// A room set up on other rules than this client's cannot be played here. The
// host moves it onto their own, and a guest cannot be ready for it, so the host
// cannot start a game the two of them would play differently.

vi.mock('../api/slugsApi', async (actual) => ({
  ...(await actual<typeof import('../api/slugsApi')>()),
  joinRoom: vi.fn(async () => {}),
  getRoom: vi.fn(),
  putSeat: vi.fn(async () => {}),
  setSettings: vi.fn(async () => {}),
  setReady: vi.fn(async () => {}),
}));

const api = await import('../api/slugsApi');
const { SlugsLobby } = await import('../components/slugs/SlugsLobby');
const { choicesOf, DEFAULT_SETTINGS, RULES, stamped } = await import('../components/slugs/slugsSync');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OTHER = (RULES % 9999) + 1;

const lobby = (set: string | undefined, ready = false): SlugsRoom => ({
  m: {
    status: 'waiting',
    createdAt: 0,
    seed: 0,
    game: 0,
    players: { a: { sessionId: 'session-a', name: 'Ann' }, b: { sessionId: 'session-b', name: 'Bob', ...(ready && { ready: true }) } },
    ...(set !== undefined && { set }),
  } satisfies SlugsMatch,
});

let box: HTMLDivElement;
let root: Root;

async function open(as: string, room: SlugsRoom) {
  sessionStorage.setItem('roadmap-user-id', as);
  vi.mocked(api.getRoom).mockResolvedValue(room);
  box = document.createElement('div');
  document.body.appendChild(box);
  root = createRoot(box);
  await act(async () => {
    root.render(createElement(SlugsLobby, {
      onStart: () => {},
      onBack: () => {},
      inviteCode: 'QX7Z',
      choices: choicesOf(DEFAULT_SETTINGS),
      onChoices: () => {},
    }));
  });
  // The join, then the first read of the room.
  await act(async () => {});
  await act(async () => {});
}

const button = (label: string) => [...box.querySelectorAll('button')].find((b) => b.textContent === label)!;

beforeEach(() => {
  vi.mocked(api.setSettings).mockClear();
  vi.mocked(api.setReady).mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

describe('a room on other rules', () => {
  it('is moved onto the host’s rules by the host, keeping its settings', async () => {
    await open('session-a', lobby(`perTeam=2;rules=${OTHER}`, true));
    expect(api.setSettings).toHaveBeenCalledTimes(1);
    expect(api.setSettings).toHaveBeenCalledWith('QX7Z', 'session-a', `perTeam=2;rules=${RULES}`);
    expect(button('Start').disabled).toBe(true);
  });

  it('is moved by the host when it is from before rooms carried their rules', async () => {
    await open('session-a', lobby('perTeam=2'));
    expect(api.setSettings).toHaveBeenCalledWith('QX7Z', 'session-a', `perTeam=2;rules=${RULES}`);
  });

  it('is left alone by the host while it is still being made', async () => {
    await open('session-a', lobby(undefined));
    expect(api.setSettings).not.toHaveBeenCalled();
  });

  it('is left alone, and can be started, when it is on the host’s own rules', async () => {
    await open('session-a', lobby(stamped('perTeam=2'), true));
    expect(api.setSettings).not.toHaveBeenCalled();
    expect(button('Start').disabled).toBe(false);
  });

  it('cannot be readied by a guest, who is told why', async () => {
    await open('session-b', lobby(`perTeam=2;rules=${OTHER}`));
    expect(button('Ready').disabled).toBe(true);
    expect(box.textContent).toContain('The host has a different version of Slugs. Both of you reload the page.');
    expect(api.setSettings).not.toHaveBeenCalled();
  });

  it('can be readied by a guest on the host’s rules', async () => {
    await open('session-b', lobby(stamped('perTeam=2')));
    expect(button('Ready').disabled).toBe(false);
  });
});
