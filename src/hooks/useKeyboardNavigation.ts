import { useEffect, useCallback, useState } from 'react';

interface KeyboardNavOptions {
  onNavigate?: (direction: 'up' | 'down' | 'left' | 'right') => void;
  onSelect?: () => void;
  onEscape?: () => void;
  onDelete?: () => void;
  enabled?: boolean;
}

export function useKeyboardNavigation(options: KeyboardNavOptions) {
  const { onNavigate, onSelect, onEscape, onDelete, enabled = true } = options;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Skip if typing in an input
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      !enabled
    ) {
      return;
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        onNavigate?.('up');
        break;
      case 'ArrowDown':
        e.preventDefault();
        onNavigate?.('down');
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onNavigate?.('left');
        break;
      case 'ArrowRight':
        e.preventDefault();
        onNavigate?.('right');
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect?.();
        break;
      case 'Escape':
        e.preventDefault();
        onEscape?.();
        break;
      case 'Delete':
      case 'Backspace':
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          onDelete?.();
        }
        break;
    }
  }, [onNavigate, onSelect, onEscape, onDelete, enabled]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

// Hook to track focused element index
export function useFocusIndex(itemCount: number) {
  const [focusIndex, setFocusIndex] = useState(-1);

  const moveFocus = useCallback((direction: 'up' | 'down') => {
    setFocusIndex(prev => {
      if (direction === 'up') {
        return prev <= 0 ? itemCount - 1 : prev - 1;
      }
      return prev >= itemCount - 1 ? 0 : prev + 1;
    });
  }, [itemCount]);

  const resetFocus = useCallback(() => setFocusIndex(-1), []);

  return { focusIndex, setFocusIndex, moveFocus, resetFocus };
}
