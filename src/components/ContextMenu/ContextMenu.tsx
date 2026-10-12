import { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ContextMenuItem, ContextMenuPosition } from '../../types';
import { useViewportPosition } from '../../hooks/useViewportPosition';
import styles from './ContextMenu.module.css';

interface ContextMenuProps {
  isOpen: boolean;
  position: ContextMenuPosition | null;
  items: ContextMenuItem[];
  onClose: () => void;
  isOpeningRef: React.RefObject<boolean>;
}

export function ContextMenu({
  isOpen,
  position,
  items,
  onClose,
  isOpeningRef
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const computedPosition = useViewportPosition({ position, isOpen }, menuRef);

  // Click-outside handler
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      // Ignore if we're still in the opening event cycle
      if (isOpeningRef.current) return;
      // Only left-click closes the menu
      if (e.button !== 0) return;
      // Check if click is outside menu
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    // Use capture phase to ensure we catch events before they bubble
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen, onClose, isOpeningRef]);

  // Keyboard handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !position) return null;

  // The menu has to be in the DOM before useViewportPosition can measure it, so
  // it mounts hidden at the pointer and is shown once it has been fitted to the
  // viewport.
  const placed = computedPosition ?? position;

  const content = (
    <div
      ref={menuRef}
      className={styles.contextMenu}
      style={{
        left: placed.x,
        top: placed.y,
        visibility: computedPosition ? 'visible' : 'hidden'
      }}
      role="menu"
      aria-orientation="vertical"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => (
        <div key={item.id}>
          <button
            className={`${styles.menuItem} ${item.variant === 'danger' ? styles.danger : ''}`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
            disabled={item.disabled}
            role="menuitem"
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span className={styles.label}>{item.label}</span>
          </button>
          {item.divider && <div className={styles.divider} />}
        </div>
      ))}
    </div>
  );

  // Render via portal to document.body
  return createPortal(content, document.body);
}
