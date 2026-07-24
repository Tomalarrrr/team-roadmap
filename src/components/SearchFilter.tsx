import { useState, useEffect, useRef, useCallback, useMemo, memo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import type { Project } from '../types';
import { normalizeStatusColor } from '../utils/statusColors';
import { getModifierKeySymbol } from '../utils/platformUtils';
import styles from './SearchFilter.module.css';

const LudoGame = lazy(() => import('./LudoGame').then(m => ({ default: m.LudoGame })));
import { GameErrorBoundary } from './GameErrorBoundary';
import { CyclesiteEmbed } from './CyclesiteEmbed';

/**
 * Quick-find (Cmd+K): search projects by title or owner and jump to one.
 * Typing also live-filters the board via onSearchChange; the text is cleared
 * whenever the modal closes, so a hidden search can never keep filtering the
 * board with no visible cue. The persistent filter dimensions live in the
 * header FilterMenu, not here.
 */
interface SearchFilterProps {
  projects: Project[];
  onSearchChange: (search: string) => void;
  onProjectSelect: (projectId: string) => void;
  isLocked?: boolean;
}

// Recent projects storage key
const RECENT_PROJECTS_KEY = 'roadmap-recent-projects';
const MAX_RECENT = 3;

// Load recent project IDs from localStorage
function loadRecentProjectIds(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_PROJECTS_KEY);
    if (stored) {
      const ids = JSON.parse(stored);
      if (Array.isArray(ids)) return ids.slice(0, MAX_RECENT);
    }
  } catch {
    // Ignore errors
  }
  return [];
}

// Save recent project ID to localStorage
function saveRecentProjectId(projectId: string): void {
  try {
    const existing = loadRecentProjectIds();
    // Remove if already exists, then add to front
    const filtered = existing.filter(id => id !== projectId);
    const updated = [projectId, ...filtered].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore errors
  }
}

export const SearchFilter = memo(function SearchFilter({
  projects,
  onSearchChange,
  onProjectSelect,
  isLocked = true
}: SearchFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>(loadRecentProjectIds);
  // Hidden features (Ludo game, Cyclesite traffic-flow embed). Deliberately NOT
  // openable via URL params: the only entry point is the secret search term
  // below, which is gated on the vault being unlocked — so a locked viewer or
  // read-only embed can never reach them, and the URL can't be shared around
  // the lock.
  const [showLudo, setShowLudo] = useState(false);
  const [showCyclesite, setShowCyclesite] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get recent projects from IDs
  const recentProjects = useMemo(() => {
    return recentProjectIds
      .map(id => projects.find(p => p.id === id))
      .filter((p): p is Project => p !== undefined);
  }, [recentProjectIds, projects]);

  // Get platform-appropriate modifier key symbol
  const modifierKey = getModifierKeySymbol();

  // Keyboard shortcut to open (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Easter egg: typing "ludo" opens the game (only when the site is unlocked).
  // Handled during render rather than in an effect — it converges because the
  // matching branch immediately clears the search box, so the condition is
  // false on the next render. All state here is local.
  if (!isLocked) {
    const magic = search.trim().toLowerCase();
    if (magic === 'ludo') {
      setShowLudo(true);
      setSearch('');
      setIsOpen(false);
    } else if (magic === 'cyclesite') {
      setShowCyclesite(true);
      setSearch('');
      setIsOpen(false);
    }
  }

  // Compute search results as derived state (no effect needed)
  const { searchResults, totalResultCount } = useMemo(() => {
    if (!search.trim()) {
      return { searchResults: recentProjects, totalResultCount: recentProjects.length };
    }

    const query = search.toLowerCase();
    const results = projects.filter(p => {
      const matchesTitle = p.title.toLowerCase().includes(query);
      const matchesOwner = p.owner.toLowerCase().includes(query);
      return matchesTitle || matchesOwner;
    });

    return { searchResults: results.slice(0, 8), totalResultCount: results.length };
  }, [search, projects, recentProjects]);

  // Reset selection when search changes — derived during render (search is a
  // string, so the comparison is stable and this converges immediately).
  const [prevSearch, setPrevSearch] = useState(search);
  if (prevSearch !== search) {
    setPrevSearch(search);
    setSelectedIndex(0);
  }

  // Handle selecting a project (saves to recent)
  const handleSelectProject = useCallback((projectId: string) => {
    saveRecentProjectId(projectId);
    setRecentProjectIds(loadRecentProjectIds());
    onProjectSelect(projectId);
    setIsOpen(false);
    setSearch('');
  }, [onProjectSelect]);

  // Navigate results with arrow keys
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, searchResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && searchResults[selectedIndex]) {
      e.preventDefault();
      handleSelectProject(searchResults[selectedIndex].id);
    }
  }, [searchResults, selectedIndex, handleSelectProject]);

  // Propagate the live search text so the board filters as you type. An effect
  // (rather than notifying inside each setter) keeps the render-phase easter-egg
  // clearing above safe — parent state is never touched mid-render.
  useEffect(() => {
    onSearchChange(search);
  }, [search, onSearchChange]);

  // Click outside closes AND clears — same contract as Escape/select, so a
  // dismissed modal never leaves an invisible text filter on the board.
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  return (
    <>
      {/* Trigger button */}
      <button
        className={styles.trigger}
        onClick={() => {
          setIsOpen(true);
          setTimeout(() => inputRef.current?.focus(), 0);
        }}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <path d="M7 12C9.76142 12 12 9.76142 12 7C12 4.23858 9.76142 2 7 2C4.23858 2 2 4.23858 2 7C2 9.76142 4.23858 12 7 12Z" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M14 14L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span>Search</span>
        <kbd className={styles.shortcut}>
          <span>{modifierKey}</span>K
        </kbd>
      </button>

      {/* Modal */}
      {isOpen && (
        <div className={styles.overlay}>
          <div ref={containerRef} className={styles.modal}>
            {/* Search input */}
            <div className={styles.searchBox}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M7 12C9.76142 12 12 9.76142 12 7C12 4.23858 9.76142 2 7 2C4.23858 2 2 4.23858 2 7C2 9.76142 4.23858 12 7 12Z" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M14 14L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                placeholder="Search projects..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleKeyDown}
                className={styles.searchInput}
              />
              {search && (
                <button
                  className={styles.clearSearch}
                  onClick={() => setSearch('')}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Search results */}
            {searchResults.length > 0 ? (
              <div className={styles.results}>
                {!search.trim() && recentProjects.length > 0 && (
                  <div className={styles.resultCount}>Recent</div>
                )}
                {search.trim() && totalResultCount > 8 && (
                  <div className={styles.resultCount}>
                    Showing 8 of {totalResultCount} results
                  </div>
                )}
                {searchResults.map((project, index) => (
                  <button
                    key={project.id}
                    className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                    onClick={() => handleSelectProject(project.id)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div
                      className={styles.resultColor}
                      style={{ backgroundColor: normalizeStatusColor(project.statusColor) }}
                    />
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{project.title}</span>
                      <span className={styles.resultOwner}>{project.owner}</span>
                    </div>
                    <span className={styles.resultHint}>↵</span>
                  </button>
                ))}
              </div>
            ) : search.trim() ? (
              <div className={styles.emptyResults}>
                <span>No projects found for "{search}"</span>
              </div>
            ) : null}

            {/* Footer */}
            <div className={styles.footer}>
              <div className={styles.hints}>
                <span><kbd>↑↓</kbd> Navigate</span>
                <span><kbd>↵</kbd> Select</span>
                <span><kbd>esc</kbd> Close</span>
              </div>
            </div>
          </div>
        </div>
      )}
      {showLudo && createPortal(
        <GameErrorBoundary gameName="Ludo" onClose={() => setShowLudo(false)}>
          <Suspense fallback={null}>
            <LudoGame onClose={() => setShowLudo(false)} isSearchOpen={isOpen} />
          </Suspense>
        </GameErrorBoundary>,
        document.body
      )}
      {showCyclesite && createPortal(
        <CyclesiteEmbed onClose={() => setShowCyclesite(false)} />,
        document.body
      )}
    </>
  );
});
