import { SearchFilter, type FilterState } from './SearchFilter';
import { ExportMenu } from './ExportMenu';
import { ZoomSlider } from './ZoomSlider';
import { SaveStatus } from './SaveStatus';
import { PresenceAvatars } from './PresenceAvatars';
import type { Project, TeamMember, Dependency } from '../types';
import type { PresenceUser } from '../hooks/usePresence';
import { isMacPlatform } from '../utils/platformUtils';
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
  isSaving: boolean;
  lastSaved: Date | null;
  saveError: string | null;
  isOnline: boolean;
  isLocked: boolean;
  onToggleLock: () => void;
  // Presence props
  presenceUsers?: PresenceUser[];
  currentUserId?: string;
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
  onDayWidthChange,
  isSaving,
  lastSaved,
  saveError,
  isOnline,
  isLocked,
  onToggleLock,
  presenceUsers = [],
  currentUserId = ''
}: ToolbarProps) {
  // Get platform-appropriate modifier key symbol for shortcut display
  const isMac = isMacPlatform();
  const mod = isMac ? '\u2318' : 'Ctrl+';

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
        {/* Presence Avatars */}
        {presenceUsers.length > 1 && (
          <>
            <PresenceAvatars
              users={presenceUsers}
              currentUserId={currentUserId}
            />
            <div className={styles.divider} />
          </>
        )}

        {/* Save Status */}
        <SaveStatus isSaving={isSaving} lastSaved={lastSaved} saveError={saveError} isOnline={isOnline} />

        <div className={styles.divider} />

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

        {/* View Lock */}
        <button
          className={`${styles.iconBtn} ${isLocked ? styles.locked : ''}`}
          onClick={onToggleLock}
          title={isLocked ? 'Unlock editing' : 'Lock for viewing only'}
        >
          {isLocked ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5 7V5C5 3.34315 6.34315 2 8 2C9.65685 2 11 3.34315 11 5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="3" y="7" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M11 7V5C11 3.34315 9.65685 2 8 2C7.1 2 6.3 2.4 5.7 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          )}
        </button>

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
