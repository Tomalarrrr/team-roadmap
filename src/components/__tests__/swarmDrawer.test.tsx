import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { WORLDS, type SwarmMatch } from '../../swarmGameLogic';
import { PLAN_LAYOUTS, PLAN_MOST_HUTS, encodePlan, parsePlan, worldOf, type Pt } from '../../swarmPlan';
import type { SwarmRoom } from '../../api/swarmApi';
import type { PlanEditFn } from '../swarm/SwarmMapDrawer';
import { SwarmGame } from '../swarm/SwarmGame';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has neither: the drawer only needs them to be there.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.setPointerCapture = () => {};

const api = vi.hoisted(() => ({
  room: null as SwarmRoom | null,
  drawHere: vi.fn(async () => {}),
  putPointer: vi.fn(async () => {}),
  // Makes the edit on the room's drawing as it is, the way the transaction does, without writing it back.
  editPlan: vi.fn(async (_code: string, _session: string, edit: PlanEditFn): Promise<string | null> => {
    const done = edit(parsePlan(api.room!.m.plan!), 2);
    if (done === null) return null;
    if ('refusal' in done) throw new Error(done.refusal);
    return encodePlan(done.plan);
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
    putPointer: api.putPointer,
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
const shelf = (name: string) => [...container!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) => b.textContent === name)!;
const select = (label: string) => [...container!.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))?.querySelector('select') ?? null;
const choose = (label: string, value: string) =>
  act(() => {
    const field = select(label)!;
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
const board = () => container!.querySelector<HTMLCanvasElement>('canvas[aria-label="Map being drawn"]');

// The board is laid out at the medium world's own size, so a world point is the point pressed.
type Where = Pt | { client: { x: number; y: number } };
const clientOf = (where: Where) => ('client' in where ? where.client : worldOf(where, 'medium'));
/** A point off the right of the board. */
const OFF: Where = { client: { x: WORLDS.medium.w + 80, y: 300 } };

const fire = async (target: Element, type: string, where: Where) => {
  const at = clientOf(where);
  await act(async () => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: at.x, clientY: at.y }));
  });
  await flush();
};
const tap = async (where: Where) => {
  await fire(board()!, 'pointerdown', where);
  await fire(board()!, 'pointerup', where);
};
/** As a browser sends it: the press, a move on the way and one at the end, the lift. */
const dragBoard = async (from: Where, to: Where) => {
  const [a, b] = [clientOf(from), clientOf(to)];
  await fire(board()!, 'pointerdown', from);
  await fire(board()!, 'pointermove', { client: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
  await fire(board()!, 'pointermove', to);
  await fire(board()!, 'pointerup', to);
};
/** A shelf chip holds the pointer, so the whole drag, and the click that ends it, comes to the chip. */
const dragShelf = async (name: string, to: Where) => {
  const chip = shelf(name);
  await fire(chip, 'pointerdown', { client: { x: -400, y: 300 } });
  await fire(chip, 'pointermove', to);
  await fire(chip, 'pointerup', to);
  await act(async () => chip.click());
  await flush();
};
const huts = () => [...container!.querySelectorAll('span')].find((each) => /^\d+ of \d+ huts$/.test(each.textContent ?? ''))!.textContent;
const click = async (name: string) => {
  await act(async () => button(name)!.click());
  await flush();
};
const said = () => container!.querySelector('[aria-live="polite"]')!.textContent;
const mirror = () => [...container!.querySelectorAll('label')].find((l) => l.textContent === 'Copy for every side')!.querySelector('input')!;
const key = async (k: string) => {
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
  await flush();
};

const HOME_A: Pt = { x: 0, y: 49 };
const HOME_B: Pt = { x: 98, y: 49 };
const MIDDLE: Pt = { x: 49, y: 49 };

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const { w, h } = WORLDS.medium;
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 0, width: w, height: h, x: 0, y: 0, right: w, bottom: h, toJSON: () => ({}) });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query }));
  sessionStorage.setItem('roadmap-user-id', 's-ann');
  api.drawHere.mockClear();
  api.editPlan.mockClear();
  api.putPointer.mockClear();
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
  async function drawing() {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    choose('Map', 'drawn');
    await flush();
  }

  it('holds the game back until the drawing plays, and starts it once it does', async () => {
    mount(<SwarmGame onClose={() => {}} isSearchOpen={false} />);
    expect(board()).toBe(null);
    choose('Map', 'drawn');
    expect(board()).not.toBe(null);
    const play = () => button('Play the computer')!;
    expect(play().disabled).toBe(true);
    expect(container!.textContent).toContain('There is no way between the homes yet.');

    await dragShelf('Hut', MIDDLE);
    await dragShelf('Hut', { x: 25, y: 20 });
    await dragShelf('Hut', { x: 73, y: 78 });
    expect(huts()).toBe(`5 of ${PLAN_MOST_HUTS} huts`);
    await act(async () => shelf('Road').click());
    for (const [a, b] of [[HOME_A, MIDDLE], [MIDDLE, HOME_B], [HOME_A, { x: 25, y: 20 }], [HOME_B, { x: 73, y: 78 }]] as const) await dragBoard(a, b);
    expect(container!.textContent).not.toContain('There is no way between the homes yet.');
    expect(play().disabled).toBe(false);

    act(() => play().click());
    expect(board()).toBe(null);
    expect(button('Menu')).not.toBe(null);
  });

  it('puts a piece dragged off the shelf down where it is let go, and nothing when let go off the board', async () => {
    await drawing();
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    await dragShelf('Cannon tower', { x: 30, y: 30 });
    expect(huts()).toBe(`3 of ${PLAN_MOST_HUTS} huts`);
    // The click that ended the drag did not choose the cannon as well.
    expect(shelf('Cannon tower').getAttribute('aria-pressed')).toBe('false');
    await dragShelf('Hut', OFF);
    expect(huts()).toBe(`3 of ${PLAN_MOST_HUTS} huts`);
  });

  it('takes a hut dragged off the board away, saying so before it is let go', async () => {
    await drawing();
    await dragShelf('Hut', { x: 30, y: 30 });
    expect(huts()).toBe(`3 of ${PLAN_MOST_HUTS} huts`);
    await fire(board()!, 'pointerdown', { x: 30, y: 30 });
    await fire(board()!, 'pointermove', OFF);
    expect(said()).toBe('Let go here to take it away.');
    await fire(board()!, 'pointerup', OFF);
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    expect(said()).not.toBe('Let go here to take it away.');
  });

  it('will not take a side’s home away, or put a hut too close to one', async () => {
    await drawing();
    await dragBoard(HOME_A, OFF);
    expect(said()).toBe('A side always starts on its home.');
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    // Clear of the home's reach, so a drop and not a press on it, but nearer than two huts may stand.
    await dragShelf('Hut', { x: 7, y: 49 });
    expect(said()).toBe('That is too close to another hut.');
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
  });

  it('copies for every side only when asked, and stops again', async () => {
    await drawing();
    expect(mirror().checked).toBe(false);
    await dragShelf('Hut', { x: 30, y: 30 });
    await act(async () => mirror().click());
    await flush();
    expect(mirror().checked).toBe(true);
    expect(huts()).toBe(`4 of ${PLAN_MOST_HUTS} huts`);
    await dragShelf('Hut', { x: 30, y: 70 });
    expect(huts()).toBe(`6 of ${PLAN_MOST_HUTS} huts`);
    // Off, each copy stays a hut of its own.
    await act(async () => mirror().click());
    await flush();
    expect(mirror().checked).toBe(false);
    expect(huts()).toBe(`6 of ${PLAN_MOST_HUTS} huts`);
    await dragShelf('Hut', { x: 49, y: 10 });
    expect(huts()).toBe(`7 of ${PLAN_MOST_HUTS} huts`);
  });

  it('undoes the last edit, then the one before', async () => {
    await drawing();
    expect(button('Undo')!.disabled).toBe(true);
    await dragShelf('Hut', { x: 30, y: 30 });
    await dragShelf('Hut', { x: 60, y: 70 });
    expect(huts()).toBe(`4 of ${PLAN_MOST_HUTS} huts`);
    await click('Undo');
    expect(huts()).toBe(`3 of ${PLAN_MOST_HUTS} huts`);
    await key('Escape');
    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    });
    await flush();
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    expect(button('Undo')!.disabled).toBe(true);
  });

  it('puts the chosen piece down a tap at a time, and turns a hut tapped into one', async () => {
    await drawing();
    await act(async () => shelf('Fort').click());
    expect(shelf('Fort').getAttribute('aria-pressed')).toBe('true');
    expect(said()).toContain('Fort: ');
    await tap({ x: 30, y: 30 });
    await tap({ x: 30, y: 70 });
    expect(huts()).toBe(`4 of ${PLAN_MOST_HUTS} huts`);
    await act(async () => shelf('Fort').click());
    expect(shelf('Fort').getAttribute('aria-pressed')).toBe('false');
    await tap({ x: 60, y: 20 });
    expect(said()).toBe('Drag a piece from the shelf onto the map, or choose one and tap the map.');
    await act(async () => shelf('Cannon tower').click());
    await tap(HOME_A);
    expect(said()).toBe('A side’s home stays its home.');
  });

  it('draws a path a tap at a time, and lets go of one half drawn on Escape', async () => {
    await drawing();
    await dragShelf('Hut', MIDDLE);
    await act(async () => shelf('Road').click());
    const road = said();
    expect(road).toContain('Drag from hut to hut');
    await tap({ x: 30, y: 10 });
    expect(said()).toBe('Start a path on a hut.');
    await tap(HOME_A);
    expect(said()).toBe('Tap the next hut, or the same one again to stop.');
    await key('Escape');
    expect(said()).toBe(road);
    // Escape again lets go of the road itself.
    await key('Escape');
    expect(shelf('Road').getAttribute('aria-pressed')).toBe('false');
    await act(async () => shelf('Road').click());
    await tap(HOME_A);
    await tap(MIDDLE);
    await tap(HOME_B);
    await tap(HOME_B);
    expect(said()).toBe(road);
    expect(container!.textContent).not.toContain('There is no way between the homes yet.');
  });

  it('rubs out what is tapped, and says when nothing is there', async () => {
    await drawing();
    await dragShelf('Hut', { x: 30, y: 30 });
    await click('Rub out');
    await tap({ x: 70, y: 80 });
    expect(said()).toBe('There is nothing there to take away.');
    await tap({ x: 30, y: 30 });
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
  });

  it('clears the board without asking, since the clearing can be undone', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    await drawing();
    expect(button('Clear')!.disabled).toBe(true);
    await dragShelf('Hut', { x: 30, y: 30 });
    await click('Clear');
    expect(confirm).not.toHaveBeenCalled();
    expect(huts()).toBe(`2 of ${PLAN_MOST_HUTS} huts`);
    await click('Undo');
    expect(huts()).toBe(`3 of ${PLAN_MOST_HUTS} huts`);
  });

  it('starts from a ready-made layout on an empty board, and offers none once drawing has begun', async () => {
    await drawing();
    expect([...select('Start from')!.options].slice(1).map((o) => o.value)).toEqual(PLAN_LAYOUTS.map((each) => each.name));
    choose('Start from', PLAN_LAYOUTS[0].name);
    await flush();
    expect(button('Play the computer')!.disabled).toBe(false);
    expect(select('Start from')).toBe(null);
    expect(mirror().checked).toBe(true);
    await click('Undo');
    expect(button('Play the computer')!.disabled).toBe(true);
    expect(select('Start from')).not.toBe(null);
  });
});

describe('drawing a map in a room', () => {
  const people = { a: { sessionId: 's-ann', name: 'Ann' }, b: { sessionId: 's-bob', name: 'Bob' } };
  const roomOf = (m: Partial<SwarmMatch>): SwarmRoom => ({ m: { status: 'waiting', createdAt: 0, seed: 5, players: people, game: 0, startAt: 0, ...m } });
  const sent = (k: number) => api.editPlan.mock.calls[k] as unknown as [string, string, PlanEditFn];

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

  it('sends a piece put down to the room as an edit, and shows what it wrote', async () => {
    await inRoom(roomOf({ plan: '' }));
    expect(select('Map')!.value).toBe('drawn');
    expect(button('Start game')!.disabled).toBe(true);
    await dragShelf('Mortar', { x: 30, y: 30 });
    expect(api.editPlan).toHaveBeenCalledTimes(1);
    const [code, session, edit] = sent(0);
    expect([code, session]).toEqual(['ROOM', 's-ann']);
    expect(edit(parsePlan(''), 2)).toEqual({ plan: { mirror: false, items: [{ is: 'piece', id: '4', piece: 'mortar', at: { x: 30, y: 30 } }] } });
    expect(huts()).toBe(`3 of ${PLAN_MOST_HUTS} huts`);
  });

  it('moves a hut dragged on the board, and takes one dragged off it away', async () => {
    await inRoom(roomOf({ plan: 'h43030' }));
    await dragBoard({ x: 30, y: 30 }, { x: 40, y: 60 });
    expect(sent(0)[2](parsePlan('h43030'), 2)).toEqual({ plan: { mirror: false, items: [{ is: 'piece', id: '4', piece: 'hut', at: { x: 40, y: 60 } }] } });
    await dragBoard({ x: 40, y: 60 }, OFF);
    expect(api.editPlan).toHaveBeenCalledTimes(2);
    expect(sent(1)[2](parsePlan('h44060'), 2)).toEqual({ plan: { mirror: false, items: [] } });
  });

  it('undoes only this player’s own edit, leaving what someone else drew since', async () => {
    await inRoom(roomOf({ plan: '' }));
    await dragShelf('Hut', { x: 30, y: 30 });
    // The room as it is now: the hut drawn here, and one someone else drew after it.
    const now = 'h43030h56070';
    api.room!.m.plan = now;
    await click('Undo');
    expect(sent(1)[2](parsePlan(now), 2)).toEqual({ plan: { mirror: false, items: [{ is: 'piece', id: '5', piece: 'hut', at: { x: 60, y: 70 } }] } });
    expect(button('Undo')!.disabled).toBe(true);
  });

  it('says when its edit cannot be undone any more, and lets it go', async () => {
    await inRoom(roomOf({ plan: '' }));
    await dragShelf('Hut', { x: 30, y: 30 });
    // Someone else has taken the hut away since.
    api.room!.m.plan = '';
    await click('Undo');
    expect(said()).toBe('Not undone. Someone else has changed that since.');
    expect(button('Undo')!.disabled).toBe(true);
  });

  it('asks before clearing the drawing for everyone, and leaves it on no', async () => {
    await inRoom(roomOf({ plan: 'Mh43030' }));
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    await click('Clear');
    expect(confirm).toHaveBeenCalledWith('Clear the map drawn here for everyone?');
    expect(api.editPlan).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await click('Clear');
    // Copying stays as the room had it.
    expect(sent(0)[2](parsePlan('Mh43030'), 2)).toEqual({ plan: { mirror: true, items: [] } });
  });

  it('tells the room where this player points, no faster than it can be written, and takes it away on leaving', async () => {
    await inRoom(roomOf({ plan: '' }));
    await fire(board()!, 'pointermove', { x: 10, y: 10 });
    await fire(board()!, 'pointermove', { x: 20, y: 20 });
    await fire(board()!, 'pointermove', { x: 30, y: 30 });
    expect(api.putPointer.mock.calls).toEqual([['ROOM', 'a', '20 20']]);
    await act(() => new Promise((done) => setTimeout(done, 200)));
    expect(api.putPointer.mock.calls).toEqual([['ROOM', 'a', '20 20'], ['ROOM', 'a', '40 40']]);
    act(() => root!.unmount());
    root = null;
    expect(api.putPointer).toHaveBeenLastCalledWith('ROOM', 'a', null);
  });

  it('asks before throwing a drawing away for everyone, and keeps it on no', async () => {
    await inRoom(roomOf({ plan: 'h43030' }));
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
