import { useState, useEffect, useRef, useCallback } from 'react';
import styles from './Modal.module.css';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

// Selector for focusable elements
const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const EXIT_ANIMATION_MS = 150;

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const closingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Exit animation state
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Opening: render immediately, cancel any pending close
      if (closingTimeoutRef.current) {
        clearTimeout(closingTimeoutRef.current);
        closingTimeoutRef.current = null;
      }
      setIsClosing(false);
      setShouldRender(true);
    } else if (shouldRender) {
      // Closing: start exit animation, then unmount
      setIsClosing(true);
      closingTimeoutRef.current = setTimeout(() => {
        setShouldRender(false);
        setIsClosing(false);
        closingTimeoutRef.current = null;
      }, EXIT_ANIMATION_MS);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closingTimeoutRef.current) {
        clearTimeout(closingTimeoutRef.current);
      }
    };
  }, []);

  // Handle tab key for focus trap
  const handleTabKey = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // No focusable elements
    if (focusableElements.length === 0) {
      e.preventDefault();
      return;
    }

    if (e.shiftKey) {
      // Shift+Tab: if on first element, go to last
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      }
    } else {
      // Tab: if on last element, go to first
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }
  }, []);

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

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    // Focus first focusable element or modal itself
    requestAnimationFrame(() => {
      if (modalRef.current) {
        const firstFocusable = modalRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        if (firstFocusable) {
          firstFocusable.focus();
        } else {
          modalRef.current.focus();
        }
      }
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      // Restore focus to previously focused element
      previouslyFocusedRef.current?.focus();
    };
  }, [isOpen, onClose, handleTabKey]);

  // Block all mouse events from reaching background (prevents drag operations)
  const handleMouseEvent = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!shouldRender) return null;

  return (
    <div
      className={`${styles.overlay} ${isClosing ? styles.exiting : ''}`}
      onClick={onClose}
      onMouseDown={handleMouseEvent}
      onMouseMove={handleMouseEvent}
      onMouseUp={handleMouseEvent}
    >
      <div
        ref={modalRef}
        className={`${styles.modal} ${isClosing ? styles.exiting : ''}`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className={styles.header}>
          <h2 id="modal-title" className={styles.title}>{title}</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close modal"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M15 5L5 15M5 5L15 15"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
        <div className={styles.content}>
          {children}
        </div>
      </div>
    </div>
  );
}
