import { SearchFilter, type FilterState } from './SearchFilter';
import { ExportMenu } from './ExportMenu';
import type { Project, TeamMember, Dependency } from '../types';
import type { ZoomLevel } from './Timeline';
import styles from './Toolbar.module.css';

interface ToolbarProps {
  projects: Project[];
  teamMembers: TeamMember[];
  dependencies: Dependency[];
  onFilterChange: (filters: FilterState) => void;
  onProjectSelect: (projectId: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  hasClipboard: boolean;
  onPaste: () => void;
  zoomLevel: ZoomLevel;
  onZoomChange: (level: ZoomLevel) => void;
}

const ZOOM_OPTIONS: { value: ZoomLevel; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export function Toolbar({
  projects,
  teamMembers,
  dependencies,
  onFilterChange,
  onProjectSelect,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasClipboard: _hasClipboard,
  onPaste: _onPaste,
  zoomLevel,
  onZoomChange
}: ToolbarProps) {
  // Detect platform for shortcut display
  const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const mod = isMac ? '⌘' : 'Ctrl+';

  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>
        <h1 className={styles.title}>Digital Roadmap Overview</h1>
      </div>

      <div className={styles.center}>
        <SearchFilter
          projects={projects}
          teamMembers={teamMembers}
          onFilterChange={onFilterChange}
          onProjectSelect={onProjectSelect}
        />
      </div>

      <div className={styles.right}>
        {/* Zoom Controls */}
        <div className={styles.zoomControl}>
          <span className={styles.zoomLabel}>View:</span>
          <div className={styles.zoomButtons}>
            {ZOOM_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                className={`${styles.zoomBtn} ${zoomLevel === value ? styles.active : ''}`}
                onClick={() => onZoomChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.divider} />

        {/* Undo/Redo */}
        <div className={styles.undoGroup}>
          <button
            className={styles.iconBtn}
            onClick={onUndo}
            disabled={!canUndo}
            title={`Undo (${mod}Z)`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8H11C12.6569 8 14 9.34315 14 11C14 12.6569 12.6569 14 11 14H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M6 5L3 8L6 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <button
            className={styles.iconBtn}
            onClick={onRedo}
            disabled={!canRedo}
            title={`Redo (${isMac ? '⌘⇧Z' : 'Ctrl+Y'})`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M13 8H5C3.34315 8 2 9.34315 2 11C2 12.6569 3.34315 14 5 14H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M10 5L13 8L10 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>

        <div className={styles.divider} />

        <ExportMenu
          projects={projects}
          teamMembers={teamMembers}
          dependencies={dependencies}
        />
      </div>
    </div>
  );
}
