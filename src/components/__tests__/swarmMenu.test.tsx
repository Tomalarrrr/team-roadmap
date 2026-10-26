import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CLASSIC, STANDARD_TUNE, type SwarmMatch, type Tune } from '../../swarmGameLogic';
import type { SwarmRoom } from '../../api/swarmApi';
import { leaveWarning, tuneSummary, type RulesChoice } from '../swarm/swarmLobby';
import { SwarmGame, TunePanel } from '../swarm/SwarmGame';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The room the stream and the reads deliver, and the writes the component makes.
const api = vi.hoisted(() => ({
  room: null as SwarmRoom | null,
  vacateSeat: vi.fn(async () => {}),
  resignSeat: vi.fn(async () => {}),
  backToLobby: vi.fn(async () => {}),
  setRules: vi.fn(async () => {}),
}));

vi.mock('../../api/swarmApi', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../api/swarmApi')>();
  return {
    ...real,
    joinRoom: vi.fn(async () => 'a'),
    followRoom: vi.fn((_code: string, onRoom: (room: SwarmRoom | null) => void) => {
      onRoom(structuredClone(api.room));
      return () => {};
    }),
    getRoom: vi.fn(async () => structuredClone(api.room)),
    putSeat: vi.fn(async () => {}),
    recordResult: vi.fn(async () => {}),
    vacateSeat: api.vacateSeat,
    resignSeat: api.resignSeat,
    backToLobby: api.backToLobby,
    setRules: api.setRules,
  };
});

describe('what the settings say', () => {
  it('names only the settings off standard, with their units', () => {
    expect(tuneSummary(STANDARD_TUNE)).toBe('');
    expect(tuneSummary({ ...STANDARD_TUNE, len: 4, grow: 200, start: 9, reload: 12 })).toBe(
      'Match length 4 min, Breeding 200%, Starting units 9, Tower reload 12 tenths'
    );
  });
});

describe('what leaving costs', () => {
  it('asks nothing outside a game', () => {
    expect(leaveWarning(false, false, 2, 1)).toBe(null);
    expect(leaveWarning(false, true, 4, 0)).toBe(null);
  });

  it('says what happens to the seat in a game', () => {
    expect(leaveWarning(true, true, 2, 0)).toBe('Leave this game? It ends here and is not kept.');
    expect(leaveWarning(true, false, 2, 1)).toBe('Leave this game? The other side wins it. You stay in the room.');
    expect(leaveWarning(true, false, 3, 1)).toBe('Leave this game? The computer plays your side to the end. You watch, and are in the next game.');
    expect(leaveWarning(true, false, 3, 0)).toBe('Leave this game? Nobody else is playing it, so it ends and the room goes back to the lobby.');
  });
});

// The lobby holds whether the settings are open; here a stand-in for it does.
function Panel({ rules = CLASSIC, ...props }: Omit<ComponentProps<typeof TunePanel>, 'open' | 'onOpen' | 'rules'> & { rules?: RulesChoice }) {
  const [open, setOpen] = useState(false);
  return <TunePanel {...props} rules={rules} open={open} onOpen={setOpen} />;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  return container;
}

const button = (name: string) => [...container!.querySelectorAll('button')].find((b) => b.textContent === name) ?? null;
const field = (label: string) => [...container!.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))?.querySelector('input') ?? null;
const type = (input: HTMLInputElement, value: string) =>
  act(() => {
    input.focus();
    // React tracks the value it set; the native setter is what a person's typing goes through.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const leave = (input: HTMLInputElement) => act(() => input.blur());

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('the settings panel', () => {
  it('is folded away until opened, and says nothing while every setting is standard', () => {
    mount(<Panel tune={STANDARD_TUNE} onTune={vi.fn()} idle="Idle words" />);
    expect(field('Match length')).toBe(null);
    expect(container!.textContent).toBe('Settings');
    act(() => button('Settings')!.click());
    expect(container!.querySelectorAll('input')).toHaveLength(9);
    expect(field('Wave every')).toBe(null);
    expect(field('Match length')!.value).toBe('10');
    expect(button('Reset to standard')!.disabled).toBe(true);
    expect(container!.textContent).toContain('Idle words');
  });

  it('shows the knobs of the chosen mode, start and twists, and no others', () => {
    mount(<Panel tune={STANDARD_TUNE} rules={{ mode: 'survival', start: 'draft', twists: ['armoury'] }} idle="" />);
    act(() => button('Settings')!.click());
    const labels = [...container!.querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toHaveLength(14);
    for (const label of ['Wave every', 'Wave size', 'Draft', 'Kit cost', 'Refit cost', 'Overtime']) expect(field(label)).not.toBe(null);
    for (const label of ['Rally', 'Hill to win', 'Big nest', 'Flood every', 'Burn cost']) expect(field(label)).toBe(null);
  });

  it('lets the host set a value, held to its range when the field is left', () => {
    const onTune = vi.fn<(tune: Tune) => void>();
    mount(<Panel tune={STANDARD_TUNE} onTune={onTune} idle="" />);
    act(() => button('Settings')!.click());
    type(field('Match length')!, '4');
    expect(onTune).not.toHaveBeenCalled();
    leave(field('Match length')!);
    expect(onTune).toHaveBeenLastCalledWith({ ...STANDARD_TUNE, len: 4 });
    type(field('Breeding')!, '9999');
    leave(field('Breeding')!);
    expect(onTune).toHaveBeenLastCalledWith({ ...STANDARD_TUNE, grow: 400 });
    expect(onTune).toHaveBeenCalledTimes(2);
  });

  it('lets go of a value that is not a number, or is already the setting, and writes nothing', () => {
    const onTune = vi.fn();
    mount(<Panel tune={STANDARD_TUNE} onTune={onTune} idle="" />);
    act(() => button('Settings')!.click());
    type(field('Marching')!, '');
    leave(field('Marching')!);
    type(field('Tower range')!, '110');
    leave(field('Tower range')!);
    expect(onTune).not.toHaveBeenCalled();
    expect(field('Marching')!.value).toBe('100');
  });

  it('says what a setting does while it is being set, and resets to standard', () => {
    const onTune = vi.fn();
    mount(<Panel tune={{ ...STANDARD_TUNE, cost: 50 }} onTune={onTune} idle="" />);
    expect(container!.textContent).toContain('Settings changed: Upgrade cost 50%.');
    act(() => button('Settings')!.click());
    act(() => field('Tower reload')!.focus());
    expect(container!.querySelector('[aria-live="polite"]')!.textContent).toBe(
      'Tenths of a second between two shots of a tower. Standard is 6 tenths; from 2 to 30.'
    );
    act(() => button('Reset to standard')!.click());
    expect(onTune).toHaveBeenCalledWith(STANDARD_TUNE);
  });

  it('shows a guest the host\'s settings but lets them change none of them', () => {
    mount(<Panel tune={{ ...STANDARD_TUNE, len: 20 }} idle="Ann sets these." />);
    act(() => button('Settings')!.click());
    const len = field('Match length')!;
    expect(len.readOnly).toBe(true);
    expect(len.value).toBe('20');
    expect(button('Reset to standard')).toBe(null);
  });
});

describe('the Menu', () => {
  const people = { a: { sessionId: 's-ann', name: 'Ann' }, b: { sessionId: 's-bob', name: 'Bob' } };
  const roomOf = (m: Partial<SwarmMatch>): SwarmRoom => ({ m: { status: 'waiting', createdAt: 0, seed: 5, players: people, game: 0, startAt: 0, ...m } });
  const flush = () => act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });

  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    // jsdom has no media queries; the game asks one for reduced motion when it starts.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
    sessionStorage.setItem('roadmap-user-id', 's-ann');
    api.vacateSeat.mockClear();
    api.resignSeat.mockClear();
    api.backToLobby.mockClear();
    api.setRules.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  async function inRoom(room: SwarmRoom) {
    api.room = room;
    sessionStorage.setItem('swarm-room', 'ROOM');
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    await flush();
  }

  it('folds the map and rules away while the settings are open, and brings them back on Done', () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    const shown = () => ({ rules: [...container!.querySelectorAll('label')].some((l) => l.textContent?.startsWith('Mode')), settings: field('Match length') !== null });
    expect(shown()).toEqual({ rules: true, settings: false });
    act(() => button('Settings')!.click());
    expect(shown()).toEqual({ rules: false, settings: true });
    expect(button('Play the computer')).not.toBe(null);
    act(() => button('Done')!.click());
    expect(shown()).toEqual({ rules: true, settings: false });
  });

  it('is not on the start screen, which is the menu', () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    expect(button('Create a room')).not.toBe(null);
    expect(button('Menu')).toBe(null);
  });

  it('is Leave in the room\'s own lobby: it gives up the seat at once and goes back to the start screen', async () => {
    await inRoom(roomOf({}));
    expect(button('Start game')).not.toBe(null);
    expect(button('Menu')).toBe(null);
    act(() => button('Leave')!.click());
    expect(api.vacateSeat).toHaveBeenCalledWith('ROOM', 'a', 0);
    expect(button('Create a room')).not.toBe(null);
    expect(sessionStorage.getItem('swarm-room')).toBe(null);
  });

  it('asks first in a game, and on yes gives the game up but keeps the seat and the room', async () => {
    await inRoom(roomOf({ status: 'playing', game: 1, startAt: performance.now() + 60_000 }));
    act(() => button('Lobby')!.click());
    expect(container!.querySelector('[role="alertdialog"]')!.textContent).toContain('Leave this game? The other side wins it. You stay in the room.');
    act(() => button('Keep playing')!.click());
    expect(container!.querySelector('[role="alertdialog"]')).toBe(null);
    expect(api.resignSeat).not.toHaveBeenCalled();
    act(() => button('Lobby')!.click());
    act(() => button('Leave game')!.click());
    expect(api.resignSeat).toHaveBeenCalledWith('ROOM', 'a', 0);
    expect(api.vacateSeat).not.toHaveBeenCalled();
    expect(container!.querySelector('[role="alertdialog"]')).toBe(null);
    expect(container!.querySelector('canvas')).not.toBe(null);
    expect(sessionStorage.getItem('swarm-room')).toBe('ROOM');
  });

  it('is Leave while watching a game already given up, as there is no game of one\'s own to leave', async () => {
    await inRoom(roomOf({ status: 'playing', game: 1, startAt: performance.now() + 60_000, cpu: 'c', out: { a: 0 } }));
    expect(button('Lobby')).toBe(null);
    act(() => button('Leave')!.click());
    expect(container!.querySelector('[role="alertdialog"]')).toBe(null);
    expect(api.vacateSeat).toHaveBeenCalledWith('ROOM', 'a', 0);
  });

  it('takes the room back to its lobby after a game, without asking and keeping the seat', async () => {
    await inRoom(roomOf({ status: 'finished', game: 1, winner: 'b' }));
    expect(button('Play again')).not.toBe(null);
    act(() => button('Lobby')!.click());
    expect(container!.querySelector('[role="alertdialog"]')).toBe(null);
    expect(api.backToLobby).toHaveBeenCalledWith('ROOM', 's-ann');
    expect(api.vacateSeat).not.toHaveBeenCalled();
    act(() => button('Back to lobby')!.click());
    expect(api.backToLobby).toHaveBeenCalledTimes(2);
    act(() => button('Leave room')!.click());
    expect(api.vacateSeat).toHaveBeenCalledWith('ROOM', 'a', 0);
    expect(button('Create a room')).not.toBe(null);
  });

  it('asks before ending a game against the computer, and goes back to the start screen', () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    act(() => button('Play the computer')!.click());
    act(() => button('Menu')!.click());
    expect(container!.textContent).toContain('Leave this game? It ends here and is not kept.');
    act(() => button('Leave game')!.click());
    expect(button('Play the computer')).not.toBe(null);
    expect(api.vacateSeat).not.toHaveBeenCalled();
  });

  it('writes the host\'s settings to the room with the rules, and shows them marked in the game', async () => {
    await inRoom(roomOf({ mode: 'hill' }));
    act(() => button('Settings')!.click());
    type(field('Match length')!, '4');
    leave(field('Match length')!);
    expect(api.setRules).toHaveBeenCalledWith('ROOM', 's-ann', { mode: 'hill', start: 'home', twists: '', tune: 'len=4' });
    act(() => root!.unmount());
    container!.remove();
    root = null;
    await inRoom(roomOf({ status: 'playing', game: 1, startAt: performance.now() + 60_000, tune: 'len=4' }));
    expect(container!.textContent).toContain('Settings changed: Match length 4 min');
  });

  it('leaves a guest the settings to read but not to write', async () => {
    sessionStorage.setItem('roadmap-user-id', 's-bob');
    await inRoom(roomOf({ tune: 'cap=50' }));
    expect(container!.textContent).toContain('Settings changed: Hut room 50%.');
    act(() => button('Settings')!.click());
    expect(field('Hut room')!.readOnly).toBe(true);
    type(field('Hut room')!, '200');
    leave(field('Hut room')!);
    expect(api.setRules).not.toHaveBeenCalled();
  });
});
