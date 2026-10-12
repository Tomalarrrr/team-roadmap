import { memo } from 'react';
import { SearchFilter } from './SearchFilter';
import { FilterMenu } from './FilterMenu';
import { ExportMenu } from './ExportMenu';
import { SaveStatus } from './SaveStatus';
import { PresenceAvatars } from './PresenceAvatars';
import type { Project, TeamMember, RoadmapData, FilterState } from '../types';
import type { PresenceUser } from '../hooks/usePresence';
import type { BoardView } from '../utils/boardView';
import { isMacPlatform } from '../utils/platformUtils';
import { ZOOM_LEVEL_WIDTH, zoomLevelOf } from '../utils/zoomLevels';
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
  onJumpToToday: () => void;
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
  onJumpToToday,
  isSaving,
  lastSaved,
  saveError,
  isOnline,
  isLocked,
  onToggleLock,
  embedMode = false,
  view,
  onViewChange,
  presenceUsers = [],
  currentUserId = ''
}: ToolbarProps) {
  // Get platform-appropriate modifier key symbol for shortcut display
  const isMac = isMacPlatform();
  const mod = isMac ? '\u2318' : 'Ctrl+';
  const zoomLevel = zoomLevelOf(dayWidth);

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
          <PresenceAvatars
            users={presenceUsers}
            currentUserId={currentUserId}
          />
        )}

        {/* Getting around the time axis: back to today, and the scale. One click
            each; anything finer is a pinch or the zoom shortcuts. The programme view always
            shows a whole year, so it has neither. */}
        {view === 'people' && (
          <>
            <button type="button" className={styles.viewBtn} onClick={onJumpToToday} title="Jump to today (T)">
              Today
            </button>
            <div className={styles.views} role="group" aria-label="Zoom">
              {(['year', 'month', 'week'] as const).map(level => (
                <button
                  key={level}
                  type="button"
                  className={`${styles.viewBtn} ${zoomLevel === level ? styles.viewBtnOn : ''}`}
                  aria-pressed={zoomLevel === level}
                  onClick={() => onDayWidthChange(ZOOM_LEVEL_WIDTH[level])}
                >
                  {level === 'year' ? 'Year' : level === 'month' ? 'Month' : 'Week'}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Actions — one consistent icon-button group. The lock toggle is
            editor-only, so it's dropped in read-only embed mode; undo/redo only
            show while the board can be edited. Export stays useful to viewers. */}
        <div className={styles.actions}>
          {!embedMode && !isLocked && (
            <>
              <button
                className={styles.iconBtn}
                onClick={onUndo}
                disabled={!canUndo}
                title={`Undo (${mod}Z)`}
                aria-label="Undo"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h6.5a3.5 3.5 0 0 1 0 7H7" />
                  <path d="M6 3 3 6l3 3" />
                </svg>
              </button>
              <button
                className={styles.iconBtn}
                onClick={onRedo}
                disabled={!canRedo}
                title={`Redo (${isMac ? '⌘⇧Z' : 'Ctrl+Y'})`}
                aria-label="Redo"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M13 6H6.5a3.5 3.5 0 0 0 0 7H9" />
                  <path d="m10 3 3 3-3 3" />
                </svg>
              </button>
            </>
          )}

          {!embedMode && (
            <button
              className={`${styles.iconBtn} ${isLocked ? styles.locked : ''}`}
              onClick={onToggleLock}
              title={isLocked ? 'Unlock editing' : 'Lock for viewing only'}
              aria-label={isLocked ? 'Unlock editing' : 'Lock for viewing only'}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3.5" y="7.5" width="9" height="6.5" rx="2" />
                <path d={isLocked ? 'M5.5 7.5v-2a2.5 2.5 0 0 1 5 0v2' : 'M5.5 7.5v-2a2.5 2.5 0 0 1 4.67-1.25'} />
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

        <img src="/Airedale.png" alt="Airedale NHS Foundation Trust" className={styles.logo} />
      </div>
    </div>
  );
});
