import { useState, useEffect, useRef } from 'react';
import type { Project, TeamMember, Dependency } from '../types';
import { getExportOptions } from '../utils/exportUtils';
import styles from './ExportMenu.module.css';

interface ExportMenuProps {
  projects: Project[];
  teamMembers: TeamMember[];
  dependencies: Dependency[];
}

export function ExportMenu({ projects, teamMembers, dependencies }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Detect platform for shortcut display
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const exportShortcut = isMac ? '⌘E' : 'Ctrl+E';

  const exportOptions = getExportOptions(projects, teamMembers, dependencies);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  // Keyboard shortcut (Cmd+E)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
        e.preventDefault();
        setIsOpen(o => !o);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div ref={menuRef} className={styles.container}>
      <button
        className={styles.trigger}
        onClick={() => setIsOpen(o => !o)}
        title={`Export (${exportShortcut})`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M3 13H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span>Export</span>
      </button>

      {isOpen && (
        <div className={styles.menu}>
          <div className={styles.menuHeader}>
            <span>Export Options</span>
            <kbd className={styles.shortcut}>{exportShortcut}</kbd>
          </div>
          <div className={styles.menuList}>
            {exportOptions.map(option => (
              <button
                key={option.id}
                className={styles.menuItem}
                onClick={() => {
                  option.action();
                  setIsOpen(false);
                }}
              >
                <span className={styles.menuIcon}>{option.icon}</span>
                <div className={styles.menuItemContent}>
                  <span className={styles.menuItemLabel}>{option.label}</span>
                  <span className={styles.menuItemDesc}>{option.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
