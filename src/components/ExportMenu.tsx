import { useState, useEffect, useRef } from 'react';
import type { Project, TeamMember, Dependency } from '../types';
import { getExportOptions } from '../utils/exportUtils';
import { getModifierKeySymbol } from '../utils/platformUtils';
import styles from './ExportMenu.module.css';

interface ExportMenuProps {
  projects: Project[];
  teamMembers: TeamMember[];
  dependencies: Dependency[];
}

export function ExportMenu({ projects, teamMembers, dependencies }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Which export is currently running (disables the list and shows progress),
  // and the last error message (so a failed export never fails silently).
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Get platform-appropriate shortcut display
  const exportShortcut = `${getModifierKeySymbol()}E`;

  const exportOptions = getExportOptions(projects, teamMembers, dependencies);

  const runExport = async (option: (typeof exportOptions)[number]) => {
    if (busyId) return; // one export at a time
    setError(null);
    setBusyId(option.id);
    try {
      await option.action();
      setIsOpen(false);
    } catch (err) {
      // Surface the failure instead of letting it become an unhandled rejection
      // with no user feedback (the menu used to just close on a failed PDF).
      console.error(`Export "${option.id}" failed:`, err);
      setError(`${option.label} failed. Please try again.`);
    } finally {
      setBusyId(null);
    }
  };

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

  // Drop any stale error message once the menu is closed, so it doesn't reappear
  // on the next open.
  useEffect(() => {
    if (!isOpen) setError(null);
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
                disabled={busyId !== null}
                aria-busy={busyId === option.id}
                onClick={() => { void runExport(option); }}
              >
                <span className={styles.menuIcon}>{option.icon}</span>
                <div className={styles.menuItemContent}>
                  <span className={styles.menuItemLabel}>
                    {busyId === option.id ? 'Exporting…' : option.label}
                  </span>
                  <span className={styles.menuItemDesc}>{option.description}</span>
                </div>
              </button>
            ))}
          </div>
          {error && <div className={styles.menuError} role="alert">{error}</div>}
        </div>
      )}
    </div>
  );
}
