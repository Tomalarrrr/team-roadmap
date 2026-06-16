import { useEffect, useState } from 'react';

interface ViewportPositionOptions {
  position: { x: number; y: number } | null;
  isOpen: boolean;
}

export function useViewportPosition(
  options: ViewportPositionOptions,
  menuRef: React.RefObject<HTMLDivElement | null>
) {
  const { position, isOpen } = options;
  const [computedPosition, setComputedPosition] = useState<{ x: number; y: number } | null>(null);

  const posX = position ? position.x : null;
  const posY = position ? position.y : null;

  // Reset computed position when the input coordinates change (prevents a stale
  // flash on reopen). Done by adjusting state *during render* — React's blessed
  // pattern for "reset state on prop change" — rather than in an effect, which
  // would paint a stale frame first and triggers the set-state-in-effect lint.
  //
  // CRITICAL: compare by VALUE (x/y), not object identity. Callers routinely
  // pass a fresh `{ x, y }` literal every render; a reference check here would
  // set state on every render — and because each synchronous re-render builds
  // yet another new object, it would never converge, throwing React error #301
  // ("Too many re-renders"). Comparing the numbers converges in one extra render.
  const [prevPos, setPrevPos] = useState(position);
  const prevX = prevPos ? prevPos.x : null;
  const prevY = prevPos ? prevPos.y : null;
  if (prevX !== posX || prevY !== posY) {
    setPrevPos(position);
    setComputedPosition(null);
  }

  useEffect(() => {
    if (!isOpen || posX === null || posY === null || !menuRef.current) {
      return;
    }

    // Use ResizeObserver to measure menu dimensions dynamically
    const observer = new ResizeObserver(() => {
      if (!menuRef.current) return;

      const menuRect = menuRef.current.getBoundingClientRect();
      const EDGE_PADDING = 8;

      let x = posX;
      let y = posY;

      // Check right edge overflow
      if (x + menuRect.width > window.innerWidth - EDGE_PADDING) {
        x = posX - menuRect.width;
      }

      // Clamp to left edge
      if (x < EDGE_PADDING) {
        x = EDGE_PADDING;
      }

      // Check bottom edge overflow
      if (y + menuRect.height > window.innerHeight - EDGE_PADDING) {
        y = posY - menuRect.height;
      }

      // Clamp to top edge
      if (y < EDGE_PADDING) {
        y = EDGE_PADDING;
      }

      setComputedPosition({ x, y });
    });

    observer.observe(menuRef.current);
    return () => observer.disconnect();
    // Depend on the coordinate VALUES, not the `position` object — an inline
    // `{ x, y }` prop changes identity every render and would otherwise rebuild
    // the observer needlessly on each render.
  }, [isOpen, posX, posY, menuRef]);

  // Return null when closed — bypasses any stale computedPosition
  if (!isOpen) return null;

  return computedPosition;
}
