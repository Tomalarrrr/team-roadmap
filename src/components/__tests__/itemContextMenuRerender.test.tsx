import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ItemContextMenu } from '../ItemContextMenu';

// react-dom requires this flag to run act() outside a full test framework integration.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver; the positioning hook uses one.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Regression guard for production React error #301 ("Too many re-renders").
// ItemContextMenu fed `useViewportPosition` a fresh `{ x, y }` object literal on
// every render. The hook compares that prop by reference during render and calls
// setState when it differs — so each synchronous re-render produced yet another
// new object, never converging. Whenever the open menu re-rendered (e.g. a
// background save updated `data`), React hit its 25-re-render cap and threw.
describe('ItemContextMenu re-render stability', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  it('does not loop forever when the open menu re-renders with the same coords', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const props = { x: 120, y: 80, title: 'Annual Leave', onClose: () => {} };

    // First render (menu opens) — fine on its own.
    act(() => root!.render(<ItemContextMenu {...props} />));

    // A parent re-render (what a background save causes) with identical coords.
    // Must NOT throw "Too many re-renders".
    expect(() => {
      act(() => root!.render(<ItemContextMenu {...props} />));
    }).not.toThrow();

    // The menu is still mounted and positioned.
    const menu = document.querySelector('[style*="left"]') as HTMLElement | null;
    expect(menu?.textContent).toContain('Annual Leave');
  });
});
