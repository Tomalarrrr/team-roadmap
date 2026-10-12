import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ContextMenu } from '../ContextMenu';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver. This one reports once on observe, as a browser
// does for a newly observed element, which is what lets the menu place itself.
class ImmediateResizeObserver {
  private callback: () => void;
  constructor(callback: () => void) {
    this.callback = callback;
  }
  observe() {
    this.callback();
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ImmediateResizeObserver;

describe('ContextMenu', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function mount(isOpen: boolean, onClick = vi.fn()) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const isOpeningRef = createRef<boolean>() as React.RefObject<boolean>;
    act(() => {
      root!.render(
        <ContextMenu
          isOpen={isOpen}
          position={isOpen ? { x: 40, y: 60 } : null}
          items={[{ id: 'edit', label: 'Edit project', onClick }]}
          onClose={() => {}}
          isOpeningRef={isOpeningRef}
        />
      );
    });
    return onClick;
  }

  it('shows its items at the pointer once opened', () => {
    mount(true);
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.style.visibility).toBe('visible');
    expect(menu?.style.left).toBe('40px');
    expect(menu?.style.top).toBe('60px');
    expect([...document.querySelectorAll('[role="menuitem"]')].map(i => i.textContent)).toEqual(['Edit project']);
  });

  it('runs the item that is clicked', () => {
    const onClick = mount(true);
    act(() => document.querySelector<HTMLElement>('[role="menuitem"]')!.click());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders nothing while closed', () => {
    mount(false);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
