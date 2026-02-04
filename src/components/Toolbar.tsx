import { SearchFilter, type FilterState } from './SearchFilter';
import { ExportMenu } from './ExportMenu';
import { ZoomSlider } from './ZoomSlider';
import type { Project, TeamMember, Dependency } from '../types';
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
  dayWidth: number;
  onDayWidthChange: (width: number) => void;
}

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
  dayWidth,
  onDayWidthChange
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
        <ZoomSlider value={dayWidth} onChange={onDayWidthChange} />

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
