import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SEATS, buildMap, kindsOf, newState } from '../../swarmGameLogic';
import { FLAG_HOLD_MS, FlagButton } from '../swarm/SwarmGame';
import { addEvents, newScene, ownerShown } from '../swarm/swarmRender';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the white flag button', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let onRaise: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    onRaise = vi.fn();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<FlagButton onRaise={onRaise} />));
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  const flag = () => container!.querySelector('button')!;
  const fill = () => flag().querySelector('span')!.style.transitionDuration;
  // jsdom has no PointerEvent; React reads the type and the button off a mouse event just the same.
  const pointer = (type: string, button = 0) => act(() => flag().dispatchEvent(new MouseEvent(type, { bubbles: true, button })));
  const key = (type: 'keydown' | 'keyup', name: string, repeat = false) =>
    act(() => flag().dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: name, repeat })));
  const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it('goes up once after a full hold, filling at the pace of the hold', () => {
    expect(fill()).toBe('0s');
    pointer('pointerdown');
    expect(fill()).toBe(`${FLAG_HOLD_MS}ms`);
    wait(FLAG_HOLD_MS - 1);
    expect(onRaise).not.toHaveBeenCalled();
    wait(1);
    expect(onRaise).toHaveBeenCalledTimes(1);
    expect(fill()).toBe('0s');
    wait(FLAG_HOLD_MS * 3);
    expect(onRaise).toHaveBeenCalledTimes(1);
  });

  it('raises nothing when let go a moment short, and empties at once', () => {
    pointer('pointerdown');
    wait(FLAG_HOLD_MS - 1);
    pointer('pointerup');
    expect(fill()).toBe('0s');
    wait(FLAG_HOLD_MS * 2);
    expect(onRaise).not.toHaveBeenCalled();
  });

  it('raises nothing when the finger slides off or the press is taken over', () => {
    pointer('pointerdown');
    wait(FLAG_HOLD_MS / 2);
    // React makes a pointer leaving out of the pointer going out to nowhere.
    pointer('pointerout');
    wait(FLAG_HOLD_MS);
    pointer('pointerdown');
    wait(FLAG_HOLD_MS / 2);
    pointer('pointercancel');
    wait(FLAG_HOLD_MS);
    expect(onRaise).not.toHaveBeenCalled();
  });

  it('is not started by a right or middle press', () => {
    pointer('pointerdown', 2);
    pointer('pointerdown', 1);
    expect(fill()).toBe('0s');
    wait(FLAG_HOLD_MS * 2);
    expect(onRaise).not.toHaveBeenCalled();
  });

  it('can be held from the keyboard, and a held key repeating does not start the hold again', () => {
    key('keydown', ' ');
    wait(FLAG_HOLD_MS - 500);
    key('keydown', ' ', true);
    wait(500);
    expect(onRaise).toHaveBeenCalledTimes(1);
    // Still held after the flag went up: the key repeats, and nothing goes up twice.
    key('keydown', ' ', true);
    wait(FLAG_HOLD_MS);
    expect(onRaise).toHaveBeenCalledTimes(1);
    key('keyup', ' ');
    key('keydown', 'Enter');
    wait(FLAG_HOLD_MS - 1);
    key('keyup', 'Enter');
    wait(FLAG_HOLD_MS);
    expect(onRaise).toHaveBeenCalledTimes(1);
    key('keydown', 'a');
    wait(FLAG_HOLD_MS);
    expect(onRaise).toHaveBeenCalledTimes(1);
  });

  it('raises nothing when it goes away mid-hold', () => {
    pointer('pointerdown');
    wait(FLAG_HOLD_MS / 2);
    act(() => root!.unmount());
    root = null;
    wait(FLAG_HOLD_MS);
    expect(onRaise).not.toHaveBeenCalled();
  });
});

describe('a hut given up under the white flag', () => {
  const map = buildMap(1, 'meadow', ['a', 'b']);
  const state = newState(map);
  const scene = newScene(map, 1, kindsOf({ players: {} }, SEATS));
  const home = map.homes[0];
  const other = map.homes[1];
  addEvents(scene, state, [{ kind: 'flag', seat: 'a', huts: [home] }], 1000, 'b');

  it('shows the side that gave it up and nobody by turns, twice, then nobody', () => {
    const beats = [0, 1, 2, 3, 4, 5, 8].map((beat) => ownerShown(scene, home, null, 1000 + beat * 250 + 10));
    expect(beats).toEqual(['a', null, 'a', null, null, null, null]);
    expect(ownerShown(scene, home, null, 990)).toBe(null);
  });

  it('shows a side that has since taken it, and leaves other huts alone', () => {
    expect(ownerShown(scene, home, 'b', 1010)).toBe('b');
    expect(ownerShown(scene, other, null, 1010)).toBe(null);
    expect(ownerShown(scene, other, 'b', 1010)).toBe('b');
  });
});
