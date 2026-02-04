import { useState, useRef, useCallback } from 'react';
import type { ContextMenuPosition } from '../types';

export function useContextMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);
  const isOpeningRef = useRef(false);

  const open = useCallback((pos: ContextMenuPosition) => {
    isOpeningRef.current = true;
    setPosition(pos);
    setIsOpen(true);

    // Clear flag after current event cycle (only justified timing hack)
    // This ensures the opening mousedown doesn't trigger the click-outside handler
    requestAnimationFrame(() => {
      isOpeningRef.current = false;
    });
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setPosition(null);
  }, []);

  return { isOpen, position, open, close, isOpeningRef };
}
