import { memo } from 'react';
import { SearchFilter } from './SearchFilter';
import { FilterMenu } from './FilterMenu';
import { ExportMenu } from './ExportMenu';
import { ZoomSlider } from './ZoomSlider';
import { SaveStatus } from './SaveStatus';
import { PresenceAvatars } from './PresenceAvatars';
import type { Project, TeamMember, RoadmapData, FilterState } from '../types';
import type { PresenceUser } from '../hooks/usePresence';
import type { BoardView } from '../utils/boardView';
import { isMacPlatform } from '../utils/platformUtils';
import styles from './Toolbar.module.css';

interface ToolbarProps {
  projects: Project[];
  teamMembers: TeamMember[];
  board: RoadmapData;
  filters: FilterState;
  /** Every tag in use on the board — the Filter menu's tag chips. */
  tags: string[];
  onFiltersChange: (filters: FilterState) => void;
  onSearchChange: (search: string) => void;
  /** Projects passing the active filters. Drives the filter panel's summary and
   *  is what Export writes out — the image/PDF exports capture the rendered
   *  board, so the data exports have to agree with it. */
  filteredProjects: Project[];
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
  // Read-only embed (e.g. framed in SharePoint): hides editor-only controls.
  embedMode?: boolean;
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  onOpenCapacity: () => void;
  onOpenRules: () => void;
  // Presence props
  presenceUsers?: PresenceUser[];
  currentUserId?: string;
}

export const Toolbar = memo(function Toolbar({
  projects,
  teamMembers,
  board,
  filters,
  tags,
  onFiltersChange,
  onSearchChange,
  filteredProjects,
  onProjectSelect,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasClipboard: _hasClipboard, // eslint-disable-line @typescript-eslint/no-unused-vars -- Reserved for future paste button
  onPaste: _onPaste, // eslint-disable-line @typescript-eslint/no-unused-vars -- Reserved for future paste button
  dayWidth,
  onDayWidthChange,
  isSaving,
  lastSaved,
  saveError,
  isOnline,
  isLocked,
  onToggleLock,
  embedMode = false,
  view,
  onViewChange,
  onOpenCapacity,
  onOpenRules,
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
        {/* Save state lives with the document title — quiet, and it gives the
            left side some weight to balance the controls on the right. */}
        <SaveStatus isSaving={isSaving} lastSaved={lastSaved} saveError={saveError} isOnline={isOnline} />
      </div>

      <div className={styles.center}>
        <div className={styles.views} role="group" aria-label="Board layout">
          {(['people', 'programmes'] as const).map(option => (
            <button
              key={option}
              type="button"
              className={`${styles.viewBtn} ${view === option ? styles.viewBtnOn : ''}`}
              aria-pressed={view === option}
              onClick={() => onViewChange(option)}
            >
              {option === 'people' ? 'People' : 'Programmes'}
            </button>
          ))}
        </div>
        <SearchFilter
          projects={projects}
          onSearchChange={onSearchChange}
          onProjectSelect={onProjectSelect}
          isLocked={isLocked}
        />
        <FilterMenu
          filters={filters}
          teamMembers={teamMembers}
          tags={tags}
          onFiltersChange={onFiltersChange}
          filteredCount={filteredProjects.length}
          totalCount={projects.length}
        />
      </div>

      <div className={styles.right}>
        {/* Presence avatars (collaborators) — only when someone else is here */}
        {presenceUsers.length > 1 && (
          <>
            <PresenceAvatars
              users={presenceUsers}
              currentUserId={currentUserId}
            />
            <div className={styles.divider} />
          </>
        )}

        {/* View — zoom. The programme view always shows a whole year. */}
        {view === 'people' && (
          <>
            <ZoomSlider value={dayWidth} onChange={onDayWidthChange} />
            <div className={styles.divider} />
          </>
        )}

        {/* Actions — one consistent icon-button group. Undo/redo and the lock
            toggle are editor-only, so they're dropped in read-only embed mode;
            Export stays useful to viewers. */}
        <div className={styles.actions}>
          {!embedMode && (
            <>
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
            </>
          )}

          <button className={styles.iconBtn} onClick={onOpenCapacity} title="Capacity: who has room, and when" aria-label="Capacity">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3 13V8M8 13V3M13 13V6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>

          {/* The rules change how the whole board reads, so they sit behind the
              same lock as every other edit. */}
          {!embedMode && !isLocked && (
            <button className={styles.iconBtn} onClick={onOpenRules} title="Board rules" aria-label="Board rules">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M2.5 4.5h4M10.5 4.5h3M2.5 11.5h3M9.5 11.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <circle cx="8.5" cy="4.5" r="1.75" stroke="currentColor" strokeWidth="1.5"/>
                <circle cx="7.5" cy="11.5" r="1.75" stroke="currentColor" strokeWidth="1.5"/>
              </svg>
            </button>
          )}

          <ExportMenu
            boardVisible={view === 'people'}
            projects={filteredProjects}
            allProjects={projects}
            board={board}
            embedMode={embedMode}
          />
        </div>

        <div className={styles.divider} />

        <img src="/Airedale.png" alt="Airedale NHS Foundation Trust" className={styles.logo} />
      </div>
    </div>
  );
});
