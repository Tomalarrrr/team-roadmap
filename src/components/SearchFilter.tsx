import { useState, useEffect, useRef, useCallback, useMemo, memo, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import type { Project, TeamMember } from '../types';
import { STATUS_CONFIG, normalizeStatusColor } from '../utils/statusColors';
import { getModifierKeySymbol } from '../utils/platformUtils';
import styles from './SearchFilter.module.css';

const LudoGame = lazy(() => import('./LudoGame').then(m => ({ default: m.LudoGame })));
import { GameErrorBoundary } from './GameErrorBoundary';

interface SearchFilterProps {
  projects: Project[];
  teamMembers: TeamMember[];
  onFilterChange: (filters: FilterState) => void;
  onProjectSelect: (projectId: string) => void;
  isLocked?: boolean;
}

export type ProjectStatus = 'discovery' | 'initiation' | 'ready-to-start' | 'on-track' | 'at-risk' | 'off-track' | 'on-hold' | 'deferred' | 'complete';

export interface FilterState {
  search: string;
  owners: string[];
  tags: string[];
  dateRange: { start: string; end: string } | null;
  status: 'all' | ProjectStatus;
}

const INITIAL_FILTERS: FilterState = {
  search: '',
  owners: [],
  tags: [],
  dateRange: null,
  status: 'all'
};

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
  teamMembers,
  onFilterChange,
  onProjectSelect,
  isLocked = true
}: SearchFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentProjectIds, setRecentProjectIds] = useState<string[]>(loadRecentProjectIds);
  // Auto-open games from shareable URL params (?ludo) — initialised here
  // instead of in a mount effect so there's no setState-after-mount.
  const [showLudo, setShowLudo] = useState(
    // .has() (not !!get()) so the intended shareable form "?ludo" opens the game —
    // get() returns "" for a valueless param, which is falsy.
    () => new URLSearchParams(window.location.search).has('ludo')
  );
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
        // Only close modal, preserve active filters
        setIsOpen(false);
        // Clear search text but keep filter selections
        setFilters(f => ({ ...f, search: '' }));
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
    const magic = filters.search.trim().toLowerCase();
    if (magic === 'ludo') {
      setShowLudo(true);
      setFilters(f => ({ ...f, search: '' }));
      setIsOpen(false);
    }
  }

  // Compute search results as derived state (no effect needed)
  const { searchResults, totalResultCount } = useMemo(() => {
    if (!filters.search.trim()) {
      return { searchResults: recentProjects, totalResultCount: recentProjects.length };
    }

    const query = filters.search.toLowerCase();
    const results = projects.filter(p => {
      const matchesTitle = p.title.toLowerCase().includes(query);
      const matchesOwner = p.owner.toLowerCase().includes(query);
      return matchesTitle || matchesOwner;
    });

    return { searchResults: results.slice(0, 8), totalResultCount: results.length };
  }, [filters.search, projects, recentProjects]);

  // Reset selection when search changes — derived during render (search is a
  // string, so the comparison is stable and this converges immediately).
  const [prevSearch, setPrevSearch] = useState(filters.search);
  if (prevSearch !== filters.search) {
    setPrevSearch(filters.search);
    setSelectedIndex(0);
  }

  // Handle selecting a project (saves to recent)
  const handleSelectProject = useCallback((projectId: string) => {
    saveRecentProjectId(projectId);
    setRecentProjectIds(loadRecentProjectIds());
    onProjectSelect(projectId);
    setIsOpen(false);
    setFilters(f => ({ ...f, search: '' }));
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

  // Apply filters
  useEffect(() => {
    onFilterChange(filters);
  }, [filters, onFilterChange]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const hasActiveFilters = filters.owners.length > 0 ||
    filters.tags.length > 0 ||
    filters.dateRange !== null ||
    filters.status !== 'all';

  const clearFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  return (
    <>
      {/* Trigger button */}
      <button
        className={`${styles.trigger} ${hasActiveFilters ? styles.active : ''}`}
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
        {hasActiveFilters && <span className={styles.filterBadge}>{filters.owners.length + filters.tags.length + (filters.status !== 'all' ? 1 : 0) + (filters.dateRange ? 1 : 0)}</span>}
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
                value={filters.search}
                onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                onKeyDown={handleKeyDown}
                className={styles.searchInput}
              />
              {filters.search && (
                <button
                  className={styles.clearSearch}
                  onClick={() => setFilters(f => ({ ...f, search: '' }))}
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
                {!filters.search.trim() && recentProjects.length > 0 && (
                  <div className={styles.resultCount}>Recent</div>
                )}
                {filters.search.trim() && totalResultCount > 8 && (
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
            ) : filters.search.trim() ? (
              <div className={styles.emptyResults}>
                <span className={styles.emptyIcon}>🔍</span>
                <span>No projects found for "{filters.search}"</span>
              </div>
            ) : null}

            {/* Filters */}
            <div className={styles.filters}>
              <div className={styles.filterSection}>
                <span className={styles.filterLabel}>Owner</span>
                <div className={styles.filterChips}>
                  {teamMembers.map(member => (
                    <button
                      key={member.id}
                      className={`${styles.chip} ${filters.owners.includes(member.name) ? styles.chipActive : ''}`}
                      onClick={() => setFilters(f => ({
                        ...f,
                        owners: f.owners.includes(member.name)
                          ? f.owners.filter(o => o !== member.name)
                          : [...f.owners, member.name]
                      }))}
                    >
                      {member.name}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.filterSection}>
                <span className={styles.filterLabel}>Status</span>
                <div className={styles.filterChips}>
                  <button
                    className={`${styles.chip} ${filters.status === 'all' ? styles.chipActive : ''}`}
                    onClick={() => setFilters(f => ({ ...f, status: 'all' }))}
                  >
                    All
                  </button>
                  {(Object.entries(STATUS_CONFIG) as [ProjectStatus, { label: string; color: string }][]).map(([status, config]) => (
                    <button
                      key={status}
                      className={`${styles.chip} ${styles.statusChip} ${filters.status === status ? styles.chipActive : ''}`}
                      onClick={() => setFilters(f => ({ ...f, status }))}
                    >
                      <span
                        className={styles.statusDot}
                        style={{ backgroundColor: config.color }}
                      />
                      {config.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className={styles.footer}>
              {hasActiveFilters && (
                <button className={styles.clearBtn} onClick={clearFilters}>
                  Clear filters
                </button>
              )}
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
    </>
  );
});
