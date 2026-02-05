import { useEffect, useRef, useCallback } from 'react';
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  groupShortcutsByCategory,
  CATEGORY_NAMES
} from '../utils/shortcuts';
import styles from './ShortcutsModal.module.css';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Selector for focusable elements
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Handle tab key for focus trap
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    if (focusableElements.length === 0) {
      e.preventDefault();
      return;
    }

    if (e.shiftKey) {
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      }
    } else {
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }, []);

  // Handle escape key, click outside, and focus management
  useEffect(() => {
    if (!isOpen) return;

    // Store currently focused element to restore later
    previouslyFocusedRef.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Tab') {
        handleTabKey(e);
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    document.body.style.overflow = 'hidden';

    // Focus first focusable element
    requestAnimationFrame(() => {
      if (modalRef.current) {
        const firstFocusable = modalRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        if (firstFocusable) {
          firstFocusable.focus();
        }
      }
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
      document.body.style.overflow = '';
      // Restore focus to previously focused element
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, onClose, handleTabKey]);

  if (!isOpen) return null;

  const groupedShortcuts = groupShortcutsByCategory(DEFAULT_SHORTCUTS);
  const categoryOrder = ['general', 'editing', 'view', 'navigation'];

  return (
    <div className={styles.overlay}>
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
      >
        <div className={styles.header}>
          <h2 id="shortcuts-title" className={styles.title}>Keyboard Shortcuts</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className={styles.content}>
          {categoryOrder.map((category) => {
            const shortcuts = groupedShortcuts[category];
            if (!shortcuts?.length) return null;

            return (
              <div key={category} className={styles.category}>
                <h3 className={styles.categoryTitle}>{CATEGORY_NAMES[category]}</h3>
                <div className={styles.shortcutList}>
                  {shortcuts.map((shortcut) => (
                    <div key={shortcut.id} className={styles.shortcutItem}>
                      <span className={styles.description}>{shortcut.description}</span>
                      <kbd className={styles.kbd}>{formatShortcut(shortcut)}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>Press <kbd className={styles.kbdSmall}>?</kbd> to toggle this dialog</span>
        </div>
      </div>
    </div>
  );
}
