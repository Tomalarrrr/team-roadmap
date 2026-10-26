import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WORLDS, type SwarmMatch } from '../../swarmGameLogic';
import { PLAN_LAYOUTS, PLAN_MOST_HUTS, gridOf, parsePlan, type Spot } from '../../swarmPlan';
import type { SwarmRoom } from '../../api/swarmApi';
import type { PlanEditFn } from '../swarm/SwarmMapDrawer';
import { SwarmGame } from '../swarm/SwarmGame';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const api = vi.hoisted(() => ({
  room: null as SwarmRoom | null,
  drawHere: vi.fn(async () => {}),
  // Makes the edit on the room's drawing as it is, the way the transaction does, without writing it back.
  editPlan: vi.fn(async (_code: string, _session: string, edit: PlanEditFn) => {
    const done = edit(parsePlan(api.room!.m.plan!), 2);
    if (done && 'refusal' in done) throw new Error(done.refusal);
  }),
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
    drawHere: api.drawHere,
    editPlan: api.editPlan,
  };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(node: React.ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}

const flush = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});
const button = (name: string) => [...container!.querySelectorAll('button')].find((b) => b.textContent === name) ?? null;
const select = (label: string) => [...container!.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))?.querySelector('select') ?? null;
const choose = (label: string, value: string) =>
  act(() => {
    const field = select(label)!;
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
const board = () => container!.querySelector<HTMLCanvasElement>('canvas[aria-label="Map being drawn"]');
// The board is laid out at the world's own size, so a world point is the point tapped.
const fire = async (type: string, spot: Spot) => {
  const at = gridOf('medium').cell(spot);
  await act(async () => {
    board()!.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y }));
  });
  await flush();
};
const tap = (spot: Spot) => fire('click', spot);
// As a browser sends it: the press, the lift somewhere else, then the click it makes.
const dragTo = async (from: Spot, to: Spot) => {
  await fire('pointerdown', from);
  await fire('pointermove', to);
  await fire('pointerup', to);
  await fire('click', to);
};
const huts = () => [...container!.querySelectorAll('span')].find((each) => /^\d+ of \d+ huts$/.test(each.textContent ?? ''))!.textContent;
const click = async (name: string) => {
  await act(async () => button(name)!.click());
  await flush();
};
const said = () => container!.querySelector('[aria-live="polite"]')!.textContent;

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const { w, h } = WORLDS.medium;
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: w, height: h, x: 0, y: 0, right: w, bottom: h, toJSON: () => ({}) });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
  sessionStorage.setItem('roadmap-user-id', 's-ann');
  api.drawHere.mockClear();
  api.editPlan.mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe('drawing a map against the computer', () => {
  it('holds the game back until the drawing plays, and starts it once it does', async () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    expect(board()).toBe(null);
    choose('Map', 'drawn');
    expect(board()).not.toBe(null);
    const play = () => button('Play the computer')!;
    expect(play().disabled).toBe(true);
    expect(container!.textContent).toContain('There is no way between the homes yet.');
    expect([...select('Size')!.options].find((o) => o.value === 'small')!.disabled).toBe(true);

    await tap({ c: 2, r: 2 });
    await tap({ c: 2, r: 0 });
    choose('Draw', 'road');
    await tap({ c: 4, r: 2 });
    expect(said()).toBe('Start a path on a hut.');
    // A run of road: from the home, through the hut, to the hut's copy for the other side, then stopped.
    await tap({ c: 0, r: 2 });
    await tap({ c: 2, r: 2 });
    await tap({ c: 6, r: 2 });
    expect(said()).toBe('Tap where it goes next, or the same spot again to stop.');
    await tap({ c: 6, r: 2 });
    expect(said()).toBe('The plain path. Over a river it is a bridge. Tap where it starts, or drag it from end to end.');
    expect(container!.textContent).toContain('2 huts have no path to the rest.');
    await tap({ c: 0, r: 2 });
    await tap({ c: 2, r: 0 });
    expect(play().disabled).toBe(false);

    act(() => play().click());
    expect(board()).toBe(null);
    expect(button('Menu')).not.toBe(null);
  });

  it('says why a piece cannot go down, and puts nothing down', async () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    choose('Map', 'drawn');
    await tap({ c: 0, r: 2 });
    expect(said()).toBe('A side starts there.');
    await tap({ c: 2, r: 2 });
    choose('Draw', 'erase');
    await tap({ c: 6, r: 2 });
    expect(said()).toContain('Tap a hut, path or river');
    // The hut and its copy went together.
    choose('Draw', 'road');
    await tap({ c: 2, r: 2 });
    expect(said()).toBe('Start a path on a hut.');
    choose('Draw', 'erase');
    await tap({ c: 4, r: 0 });
    expect(said()).toBe('There is nothing there to rub out.');
  });

  it('draws a path dragged from hut to hut, without taking the drag for a tap as well', async () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    choose('Map', 'drawn');
    await tap({ c: 2, r: 2 });
    await tap({ c: 2, r: 0 });
    choose('Draw', 'road');
    await dragTo({ c: 0, r: 2 }, { c: 2, r: 2 });
    // Taken for a tap too, the click would have started a path from the hut it ended on.
    expect(said()).toBe('The plain path. Over a river it is a bridge. Tap where it starts, or drag it from end to end.');
    await dragTo({ c: 2, r: 2 }, { c: 6, r: 2 });
    expect(container!.textContent).toContain('2 huts have no path to the rest.');
    await dragTo({ c: 0, r: 2 }, { c: 2, r: 0 });
    expect(button('Play the computer')!.disabled).toBe(false);
  });

  it('counts the huts against the most a map holds, and undoes the last edit, then the one before', async () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    choose('Map', 'drawn');
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    expect(button('Undo')!.disabled).toBe(true);
    await tap({ c: 2, r: 2 });
    await tap({ c: 2, r: 0 });
    expect(huts()).toBe(`6 of ${PLAN_MOST_HUTS} huts`);
    await click('Undo');
    expect(huts()).toBe(`4 of ${PLAN_MOST_HUTS} huts`);
    await click('Undo');
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    expect(button('Undo')!.disabled).toBe(true);
    // A hut put where the same hut stands changes nothing, so there is nothing of it to undo.
    await tap({ c: 2, r: 2 });
    await tap({ c: 2, r: 2 });
    await click('Undo');
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    expect(button('Undo')!.disabled).toBe(true);
  });

  it('clears the board without asking, since the clearing can be undone', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    choose('Map', 'drawn');
    expect(button('Clear')!.disabled).toBe(true);
    await tap({ c: 2, r: 2 });
    await click('Clear');
    expect(confirm).not.toHaveBeenCalled();
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    await click('Undo');
    expect(huts()).toBe(`4 of ${PLAN_MOST_HUTS} huts`);
  });

  it('starts from a ready-made layout on an empty board, and offers none once drawing has begun', async () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    choose('Map', 'drawn');
    expect([...select('Start from')!.options].slice(1).map((o) => o.value)).toEqual(PLAN_LAYOUTS.map((each) => each.name));
    choose('Start from', PLAN_LAYOUTS[0].name);
    await flush();
    expect(button('Play the computer')!.disabled).toBe(false);
    expect(select('Start from')).toBe(null);
    await click('Undo');
    expect(button('Play the computer')!.disabled).toBe(true);
    await tap({ c: 2, r: 2 });
    expect(select('Start from')).toBe(null);
  });
});

describe('drawing a map in a room', () => {
  const people = { a: { sessionId: 's-ann', name: 'Ann' }, b: { sessionId: 's-bob', name: 'Bob' } };
  const roomOf = (m: Partial<SwarmMatch>): SwarmRoom => ({ m: { status: 'waiting', createdAt: 0, seed: 5, players: people, game: 0, startAt: 0, ...m } });

  async function inRoom(room: SwarmRoom) {
    api.room = room;
    sessionStorage.setItem('swarm-room', 'ROOM');
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    await flush();
  }

  it('turns drawing on for the room when picked', async () => {
    await inRoom(roomOf({}));
    choose('Map', 'drawn');
    await flush();
    expect(api.drawHere).toHaveBeenCalledWith('ROOM', 's-ann', true);
  });

  it('shows the room\'s drawing to everyone, and sends each tap to the room as an edit', async () => {
    await inRoom(roomOf({ plan: '' }));
    expect(select('Map')!.value).toBe('drawn');
    expect(button('Start game')!.disabled).toBe(true);
    await tap({ c: 3, r: 3 });
    expect(api.editPlan).toHaveBeenCalledTimes(1);
    const [code, session, edit] = api.editPlan.mock.calls[0] as unknown as [string, string, PlanEditFn];
    expect([code, session]).toEqual(['ROOM', 's-ann']);
    expect(edit(parsePlan(''), 2)).toEqual({ items: [{ is: 'piece', piece: 'hut', at: { c: 3, r: 3 } }] });
  });

  it('undoes only this player\'s own edit, leaving what someone else drew since', async () => {
    await inRoom(roomOf({ plan: '' }));
    await tap({ c: 3, r: 3 });
    // The room as it is now: the hut drawn here, and one someone else drew after it.
    api.room!.m.plan = 'h33h20';
    await click('Undo');
    const [, , undo] = api.editPlan.mock.calls[1] as unknown as [string, string, PlanEditFn];
    expect(undo(parsePlan('h33h20'), 2)).toEqual({ items: [{ is: 'piece', piece: 'hut', at: { c: 2, r: 0 } }] });
    expect(button('Undo')!.disabled).toBe(true);
  });

  it('says when its edit cannot be undone any more, and lets it go', async () => {
    await inRoom(roomOf({ plan: '' }));
    await tap({ c: 3, r: 3 });
    // Someone else has rubbed the hut out since.
    api.room!.m.plan = '';
    await click('Undo');
    expect(said()).toBe('Not undone. Someone else has changed that since.');
    expect(button('Undo')!.disabled).toBe(true);
  });

  it('asks before clearing the drawing for everyone, and leaves it on no', async () => {
    await inRoom(roomOf({ plan: 'h22' }));
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    await click('Clear');
    expect(confirm).toHaveBeenCalledWith('Clear the map drawn here for everyone?');
    expect(api.editPlan).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click('Clear');
    const [, , edit] = api.editPlan.mock.calls[0] as unknown as [string, string, PlanEditFn];
    expect(edit(parsePlan('h22'), 2)).toEqual([]);
  });

  it('asks before throwing a drawing away for everyone, and keeps it on no', async () => {
    await inRoom(roomOf({ plan: 'h22' }));
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    choose('Map', 'meadow');
    await flush();
    expect(confirm).toHaveBeenCalledWith('Throw away the map drawn here for everyone?');
    expect(api.drawHere).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    choose('Map', 'meadow');
    await flush();
    expect(api.drawHere).toHaveBeenCalledWith('ROOM', 's-ann', false);
  });
});
