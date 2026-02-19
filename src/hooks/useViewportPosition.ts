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

  // Reset computed position when input position changes (prevents stale flash on reopen)
  const [prevPosition, setPrevPosition] = useState(position);
  if (position !== prevPosition) {
    setPrevPosition(position);
    if (computedPosition !== null) {
      setComputedPosition(null);
    }
  }

  useEffect(() => {
    if (!isOpen || !position || !menuRef.current) {
      return;
    }

    // Use ResizeObserver to measure menu dimensions dynamically
    const observer = new ResizeObserver(() => {
      if (!menuRef.current) return;

      const menuRect = menuRef.current.getBoundingClientRect();
      const EDGE_PADDING = 8;

      let x = position.x;
      let y = position.y;

      // Check right edge overflow
      if (x + menuRect.width > window.innerWidth - EDGE_PADDING) {
        x = position.x - menuRect.width;
      }

      // Clamp to left edge
      if (x < EDGE_PADDING) {
        x = EDGE_PADDING;
      }

      // Check bottom edge overflow
      if (y + menuRect.height > window.innerHeight - EDGE_PADDING) {
        y = position.y - menuRect.height;
      }

      // Clamp to top edge
      if (y < EDGE_PADDING) {
        y = EDGE_PADDING;
      }

      setComputedPosition({ x, y });
    });

    observer.observe(menuRef.current);
    return () => observer.disconnect();
  }, [isOpen, position, menuRef]);

  // Return null when closed — bypasses any stale computedPosition
  if (!isOpen) return null;

  return computedPosition;
}
