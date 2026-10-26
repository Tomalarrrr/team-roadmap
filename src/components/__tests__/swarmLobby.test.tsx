import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MODE_IDS, TWISTS, type ModeId } from '../../swarmGameLogic';
import { clashOf, surpriseOf, unfit, type RulesChoice } from '../swarm/swarmLobby';
import { RulesPicker, SwarmGame } from '../swarm/SwarmGame';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('what a mode needs of the sides', () => {
  it('holds Teams to exactly four sides, counting computers', () => {
    expect(unfit('teams', 1, 1)).toBe('Teams needs 4 sides; there are 2.');
    expect(unfit('teams', 2, 1)).toBe('Teams needs 4 sides; there are 3.');
    expect(unfit('teams', 1, 3)).toBe(null);
    expect(unfit('teams', 4, 0)).toBe(null);
  });

  it('holds Survival to at least one person and one computer', () => {
    expect(unfit('survival', 3, 0)).toBe('Survival needs a computer side to hold out against.');
    expect(unfit('survival', 0, 2)).toBe('Survival needs a person to play it.');
    expect(unfit('survival', 1, 1)).toBe(null);
  });

  it('asks nothing of the sides in the other modes', () => {
    for (const mode of MODE_IDS.filter((each) => each !== 'teams' && each !== 'survival')) expect(unfit(mode, 1, 0)).toBe(null);
  });
});

describe('twists that clash with a mode', () => {
  it('says why Queens is idle in Regicide, and nothing of any other pair', () => {
    expect(clashOf('queens', 'regicide')).toMatch(/^Queens does nothing in Regicide/);
    expect(clashOf('queens', 'classic')).toBe(null);
    for (const twist of TWISTS.filter((each) => each !== 'queens')) expect(clashOf(twist, 'regicide')).toBe(null);
  });
});

describe('the Surprise draw', () => {
  const all = () => true;
  const twoSides = (mode: ModeId) => mode !== 'teams' && mode !== 'survival';

  it('is the same for the same seed and press, wherever it is drawn', () => {
    expect(surpriseOf(1234, 0, all)).toEqual(surpriseOf(1234, 0, all));
    expect(surpriseOf(1234, 5, twoSides)).toEqual(surpriseOf(1234, 5, twoSides));
  });

  it('draws something else on the next press and from another seed', () => {
    const presses = new Set(Array.from({ length: 20 }, (_, roll) => JSON.stringify(surpriseOf(99, roll, all))));
    expect(presses.size).toBeGreaterThan(15);
    const seeds = new Set(Array.from({ length: 20 }, (_, seed) => JSON.stringify(surpriseOf(seed, 0, all))));
    expect(seeds.size).toBeGreaterThan(15);
  });

  it('never draws Classic or Home, nor a mode the sides cannot play, and comes to every other mode', () => {
    const modes = new Set<ModeId>();
    for (let roll = 0; roll < 400; roll++) {
      const draw = surpriseOf(7, roll, twoSides);
      expect(draw.mode).not.toBe('classic');
      expect(draw.start).not.toBe('home');
      expect(twoSides(draw.mode)).toBe(true);
      modes.add(draw.mode);
    }
    expect([...modes].sort()).toEqual(MODE_IDS.filter((mode) => mode !== 'classic' && twoSides(mode)).sort());
  });

  it('draws two different twists in list order, never one that clashes with the mode', () => {
    let regicides = 0;
    for (let roll = 0; roll < 400; roll++) {
      const draw = surpriseOf(31, roll, all);
      expect(draw.twists).toHaveLength(2);
      expect(draw.twists[0]).not.toBe(draw.twists[1]);
      expect(TWISTS.indexOf(draw.twists[0])).toBeLessThan(TWISTS.indexOf(draw.twists[1]));
      for (const twist of draw.twists) expect(clashOf(twist, draw.mode)).toBe(null);
      if (draw.mode === 'regicide') regicides++;
    }
    // A positive control: the clash rule was put to the test, not skipped for want of a Regicide draw.
    expect(regicides).toBeGreaterThan(20);
  });
});

describe('the rules picker', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  const PLAIN: RulesChoice = { mode: 'classic', start: 'home', twists: [] };
  const surprise = { seed: 4242, fits: (mode: ModeId) => mode !== 'teams' };

  function mount(choice: RulesChoice, onChoice?: (choice: RulesChoice) => void, nest?: { pick: 'big' | 'many'; onPick: (nest: 'big' | 'many') => void }) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<RulesPicker choice={choice} onChoice={onChoice} idle="Idle words" nest={nest} surprise={surprise} />));
    return container;
  }
  const twistsBtn = () => [...container!.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')][0];
  // The twists sit in a list the button opens, so each lookup opens it first.
  const box = (name: string) => {
    if (twistsBtn().getAttribute('aria-expanded') === 'false') act(() => twistsBtn().click());
    const item = [...container!.querySelectorAll('[aria-label="Twists"] label')].find((l) => l.querySelector('span span')?.textContent === name)!;
    return { input: item.querySelector('input')!, about: item.querySelectorAll('span span')[1].textContent };
  };
  const select = (label: string) => [...container!.querySelectorAll('label')].find((l) => l.textContent?.startsWith(label))?.querySelector('select') ?? null;
  const line = () => container!.querySelector('[aria-live="polite"]')!.textContent;
  const button = (name: string) => [...container!.querySelectorAll('button')].find((b) => b.textContent === name) ?? null;
  const choose = (el: HTMLSelectElement, value: string) =>
    act(() => {
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

  it('names the twists that are on in its button, and keeps the list shut until pressed', () => {
    mount({ ...PLAIN, twists: ['flood', 'fog'] }, vi.fn());
    expect(twistsBtn().textContent).toBe('Flood, Fog');
    expect(container!.querySelector('[aria-label="Twists"]')).toBe(null);
    act(() => root!.unmount());
    root = null;
    mount(PLAIN, vi.fn());
    expect(twistsBtn().textContent).toBe('None');
  });

  it('turns a twist on and off through the choice, with what it does beside it', () => {
    const onChoice = vi.fn();
    mount({ ...PLAIN, twists: ['fog'] }, onChoice);
    expect(box('Fog').input.checked).toBe(true);
    expect(box('Flood').input.checked).toBe(false);
    expect(box('Flood').about).toMatch(/^After 40% of the clock/);
    act(() => box('Flood').input.click());
    expect(onChoice).toHaveBeenLastCalledWith({ mode: 'classic', start: 'home', twists: ['fog', 'flood'] });
    act(() => box('Fog').input.click());
    expect(onChoice).toHaveBeenLastCalledWith({ mode: 'classic', start: 'home', twists: [] });
  });

  it('holds a clashing twist off, and says why in place of what it does', () => {
    const onChoice = vi.fn();
    mount({ mode: 'regicide', start: 'home', twists: [] }, onChoice);
    expect(box('Queens').input.disabled).toBe(true);
    expect(box('Fog').input.disabled).toBe(false);
    expect(box('Queens').about).toMatch(/^Queens does nothing in Regicide/);
    act(() => box('Queens').input.click());
    expect(onChoice).not.toHaveBeenCalled();
  });

  it('lets go of a twist the new mode has no use for, and keeps the rest', () => {
    const onChoice = vi.fn();
    mount({ ...PLAIN, twists: ['fog', 'queens'] }, onChoice);
    choose(select('Mode')!, 'regicide');
    expect(onChoice).toHaveBeenLastCalledWith({ mode: 'regicide', start: 'home', twists: ['fog'] });
    choose(select('Start')!, 'draft');
    expect(onChoice).toHaveBeenLastCalledWith({ mode: 'classic', start: 'draft', twists: ['fog', 'queens'] });
  });

  it('shows a guest the host\'s choice and lets them read it, but change none of it', () => {
    mount({ mode: 'hill', start: 'close', twists: ['golden'] });
    expect(select('Mode')!.disabled).toBe(true);
    expect(select('Mode')!.value).toBe('hill');
    expect(select('Start')!.disabled).toBe(true);
    expect(button('Surprise')).toBe(null);
    expect(container!.textContent).toContain('Idle words');
    expect(box('Golden hut').input.checked).toBe(true);
    expect(box('Fog').input.disabled).toBe(true);
    expect(box('Fog').about).toMatch(/^You see only near your own huts/);
    act(() => box('Fog').input.click());
    expect(box('Fog').input.checked).toBe(false);
  });

  it('makes each Surprise press the next draw from the seed, with the modes the sides can play', () => {
    const onChoice = vi.fn();
    mount(PLAIN, onChoice);
    expect(line()).toBe('Idle words');
    act(() => button('Surprise')!.click());
    act(() => button('Surprise')!.click());
    expect(onChoice.mock.calls.map(([choice]) => choice)).toEqual([surpriseOf(4242, 0, surprise.fits), surpriseOf(4242, 1, surprise.fits)]);
    expect(line()).toMatch(/^Drawn: a mode, a start and 2 twists/);
  });

  it('offers the nest only with the nests start and somewhere to put it', () => {
    const onPick = vi.fn();
    mount({ ...PLAIN, start: 'nests' }, vi.fn(), { pick: 'big', onPick });
    choose(select('Nest')!, 'many');
    expect(onPick).toHaveBeenCalledWith('many');
    act(() => root!.unmount());
    root = null;
    mount({ ...PLAIN, start: 'draft' }, vi.fn(), { pick: 'big', onPick });
    expect(select('Nest')).toBe(null);
    act(() => root!.unmount());
    root = null;
    mount({ ...PLAIN, start: 'nests' }, vi.fn());
    expect(select('Nest')).toBe(null);
  });
});

describe('the lobby against the computer', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    // jsdom draws nothing; the map pictures skip a canvas they cannot get a context for.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it('keeps Play the computer off with the reason until there are sides enough for the mode', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<SwarmGame onClose={() => {}} isSearchOpen={false} />));
    const play = () => [...container!.querySelectorAll('button')].find((b) => b.textContent === 'Play the computer')!;
    const mode = [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Mode'))!.querySelector('select')!;
    expect(play().disabled).toBe(false);
    act(() => {
      mode.value = 'teams';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(play().disabled).toBe(true);
    expect(container.textContent).toContain('Teams needs 4 sides; there are 2.');
    const computers = [...container.querySelectorAll('label')].find((l) => l.textContent?.startsWith('Computers'))!.querySelector('select')!;
    act(() => {
      computers.value = '3';
      computers.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(play().disabled).toBe(false);
    expect(container.textContent).not.toContain('Teams needs 4 sides');
  });

  it('greys out each size the picked map is not played on for the sides there are', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<SwarmGame onClose={() => {}} isSearchOpen={false} />));
    const field = (name: string) => [...container!.querySelectorAll('label')].find((l) => l.textContent?.startsWith(name))!.querySelector('select')!;
    const choose = (name: string, value: string) =>
      act(() => {
        field(name).value = value;
        field(name).dispatchEvent(new Event('change', { bubbles: true }));
      });
    const greyed = () => [...field('Size').options].filter((option) => option.disabled).map((option) => option.value);
    choose('Map', 'villages');
    expect(greyed()).toEqual([]);
    choose('Computers', '2');
    expect(greyed()).toEqual(['small', 'medium']);
    choose('Map', 'maze');
    expect(greyed()).toEqual(['huge']);
    choose('Computers', '3');
    expect(greyed()).toEqual(['small', 'medium']);
  });
});
