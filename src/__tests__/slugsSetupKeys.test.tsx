import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

// jsdom has no 2D canvas for the icons, portraits and map thumbnails setup shows.
vi.mock('../components/slugs/menuArt', async (actual) => ({
  ...(await actual<typeof import('../components/slugs/menuArt')>()),
  iconOf: () => '',
  portraitOf: () => '',
  paintMapThumb: () => {},
}));

const { SlugsGame } = await import('../components/slugs/SlugsGame');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The roadmap behind listens on document: [ and ] move a project's dates, Cmd+Backspace deletes it.
let host: HTMLDivElement;
let root: Root;
let onClose: Mock<() => void>;
let reached: string[];
const roadmap = (e: KeyboardEvent) => reached.push(`${e.metaKey ? 'Meta+' : ''}${e.key}`);

const press = (key: string, init: KeyboardEventInit = {}) =>
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });

beforeEach(() => {
  reached = [];
  onClose = vi.fn<() => void>();
  document.addEventListener('keydown', roadmap);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(SlugsGame, { onClose, isSearchOpen: false })));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.removeEventListener('keydown', roadmap);
});

describe('keys on the Slugs setup screen', () => {
  it('keeps the roadmap’s shortcuts from the roadmap behind it', () => {
    press('[');
    press(']');
    press('Backspace', { metaKey: true });
    press('?');
    expect(reached).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('lets Cmd+K through to open search', () => {
    press('k', { metaKey: true });
    expect(reached).toEqual(['Meta+k']);
  });

  it('closes on Escape', () => {
    press('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('lets every key through to search when search is open over it', () => {
    act(() => root.render(createElement(SlugsGame, { onClose, isSearchOpen: true })));
    press('[');
    press('Escape');
    expect(reached).toEqual(['[', 'Escape']);
    expect(onClose).not.toHaveBeenCalled();
  });
});
