import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import type { Project, TeamMember } from '../types';
import styles from './SearchFilter.module.css';

interface SearchFilterProps {
  projects: Project[];
  teamMembers: TeamMember[];
  onFilterChange: (filters: FilterState) => void;
  onProjectSelect: (projectId: string) => void;
}

export interface FilterState {
  search: string;
  owners: string[];
  tags: string[];
  dateRange: { start: string; end: string } | null;
  status: 'all' | 'active' | 'past' | 'upcoming';
}

const INITIAL_FILTERS: FilterState = {
  search: '',
  owners: [],
  tags: [],
  dateRange: null,
  status: 'all'
};

export function SearchFilter({
  projects,
  teamMembers,
  onFilterChange,
  onProjectSelect
}: SearchFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [searchResults, setSearchResults] = useState<Project[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Extract all unique tags from projects
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    projects.forEach(p => {
      p.milestones?.forEach(m => {
        m.tags?.forEach(t => tags.add(t));
      });
    });
    return Array.from(tags).sort();
  }, [projects]);

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
        setFilters(INITIAL_FILTERS);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Search projects
  useEffect(() => {
    if (!filters.search.trim()) {
      setSearchResults([]);
      return;
    }

    const query = filters.search.toLowerCase();
    const results = projects.filter(p => {
      const matchesTitle = p.title.toLowerCase().includes(query);
      const matchesOwner = p.owner.toLowerCase().includes(query);
      const matchesMilestone = p.milestones?.some(m =>
        m.title.toLowerCase().includes(query) ||
        m.tags?.some(t => t.toLowerCase().includes(query))
      );
      return matchesTitle || matchesOwner || matchesMilestone;
    });

    setSearchResults(results.slice(0, 8));
    setSelectedIndex(0);
  }, [filters.search, projects]);

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
      onProjectSelect(searchResults[selectedIndex].id);
      setIsOpen(false);
      setFilters(INITIAL_FILTERS);
    }
  }, [searchResults, selectedIndex, onProjectSelect]);

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
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M7 12C9.76142 12 12 9.76142 12 7C12 4.23858 9.76142 2 7 2C4.23858 2 2 4.23858 2 7C2 9.76142 4.23858 12 7 12Z" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M14 14L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className={styles.triggerText}>Search</span>
        <kbd className={styles.shortcut}>
          <span>⌘</span>K
        </kbd>
        {hasActiveFilters && <span className={styles.filterBadge}>{filters.owners.length + filters.tags.length + (filters.status !== 'all' ? 1 : 0)}</span>}
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
                placeholder="Search projects, milestones, tags..."
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
            {searchResults.length > 0 && (
              <div className={styles.results}>
                {searchResults.map((project, index) => (
                  <button
                    key={project.id}
                    className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                    onClick={() => {
                      onProjectSelect(project.id);
                      setIsOpen(false);
                      setFilters(INITIAL_FILTERS);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    <div
                      className={styles.resultColor}
                      style={{ backgroundColor: project.statusColor }}
                    />
                    <div className={styles.resultInfo}>
                      <span className={styles.resultTitle}>{project.title}</span>
                      <span className={styles.resultOwner}>{project.owner}</span>
                    </div>
                    <span className={styles.resultHint}>↵</span>
                  </button>
                ))}
              </div>
            )}

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

              {allTags.length > 0 && (
                <div className={styles.filterSection}>
                  <span className={styles.filterLabel}>Tags</span>
                  <div className={styles.filterChips}>
                    {allTags.slice(0, 10).map(tag => (
                      <button
                        key={tag}
                        className={`${styles.chip} ${filters.tags.includes(tag) ? styles.chipActive : ''}`}
                        onClick={() => setFilters(f => ({
                          ...f,
                          tags: f.tags.includes(tag)
                            ? f.tags.filter(t => t !== tag)
                            : [...f.tags, tag]
                        }))}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.filterSection}>
                <span className={styles.filterLabel}>Status</span>
                <div className={styles.filterChips}>
                  {(['all', 'active', 'past', 'upcoming'] as const).map(status => (
                    <button
                      key={status}
                      className={`${styles.chip} ${filters.status === status ? styles.chipActive : ''}`}
                      onClick={() => setFilters(f => ({ ...f, status }))}
                    >
                      {status.charAt(0).toUpperCase() + status.slice(1)}
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
    </>
  );
}
