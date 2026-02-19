import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useViewportPosition } from '../hooks/useViewportPosition';
import styles from './LeaveContextMenu.module.css';

interface ItemContextMenuProps {
  x: number;
  y: number;
  title: string;
  onEdit?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

export function ItemContextMenu({
  x,
  y,
  title,
  onEdit,
  onDelete,
  onClose
}: ItemContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const position = useViewportPosition({ position: { x, y }, isOpen: true }, menuRef);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const displayPos = position || { x, y };

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: displayPos.x, top: displayPos.y, minWidth: '120px' }}
    >
      <div className={styles.menuHeader}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '4px 0' }}>
        {onEdit && (
          <button
            className={styles.menuItem}
            onClick={() => {
              onEdit();
              onClose();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            Edit
          </button>
        )}
        {onDelete && (
          <button
            className={styles.menuItemDanger}
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            Delete
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
