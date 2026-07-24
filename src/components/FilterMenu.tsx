import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { EprFilter, FilterState, ProjectSize, ProjectStatus, TeamMember, Timeframe } from '../types';
import { STATUS_COLORS } from '../utils/statusColors';
import { SIZE_LABELS } from '../utils/capacity';
import { countActiveFilters, INITIAL_FILTERS } from '../utils/projectFilters';
import styles from './FilterMenu.module.css';

/**
 * Header filter control: a quiet chip that opens an anchored panel of filter
 * dimensions (EPR / people / size / status). All selections are multi-select
 * and applied instantly; the active count sits on the trigger so the state is
 * visible while the panel is closed. Search lives separately in SearchFilter —
 * this menu owns everything persistent.
 */

interface FilterMenuProps {
  filters: FilterState;
  teamMembers: TeamMember[];
  onFiltersChange: (filters: FilterState) => void;
  /** Projects passing the current filters / total on the board — the panel's summary line. */
  filteredCount: number;
  totalCount: number;
}

// Smallest first — matches how people reason about effort, not the slot-cost
// ordering used internally.
const SIZE_OPTIONS: ProjectSize[] = ['small', 'medium', 'large', 'full-time'];

// Both selected is the same result set as neither — that's fine, it's how every
// other dimension here behaves.
const EPR_OPTIONS: { value: EprFilter; label: string }[] = [
  { value: 'yes', label: 'EPR' },
  { value: 'no', label: 'Non-EPR' },
];

// Chronological, so the row reads like the timeline itself.
const TIMEFRAME_OPTIONS: { value: Timeframe; label: string }[] = [
  { value: 'past', label: 'Past' },
  { value: 'current', label: 'Current' },
  { value: 'upcoming', label: 'Upcoming' },
];

/** Toggle a value in a selection list, preserving selection order. */
function toggled<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value];
}

export const FilterMenu = memo(function FilterMenu({
  filters,
  teamMembers,
  onFiltersChange,
  filteredCount,
  totalCount,
}: FilterMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const activeCount = countActiveFilters(filters);

  // Move focus into the panel when it opens so Escape/Tab work immediately.
  useEffect(() => {
    if (isOpen) panelRef.current?.focus();
  }, [isOpen]);

  // Escape closes and hands focus back to the trigger; click-outside just closes.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [isOpen]);

  const clearAll = useCallback(() => {
    // Reset the menu's dimensions only — typed search isn't this menu's to clear.
    onFiltersChange({ ...INITIAL_FILTERS, search: filters.search });
  }, [filters.search, onFiltersChange]);

  return (
    <div ref={containerRef} className={styles.container}>
      <button
        ref={triggerRef}
        className={`${styles.trigger} ${activeCount > 0 ? styles.active : ''}`}
        onClick={() => setIsOpen(open => !open)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 3.5H14M4.5 8H11.5M7 12.5H9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span>Filter</span>
        {activeCount > 0 && <span className={styles.badge}>{activeCount}</span>}
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className={styles.panel}
          role="dialog"
          aria-label="Filter projects"
          tabIndex={-1}
        >
          <div className={styles.section}>
            <span className={styles.sectionLabel}>EPR</span>
            <div className={styles.chips}>
              {EPR_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`${styles.chip} ${filters.epr.includes(value) ? styles.chipActive : ''}`}
                  onClick={() => onFiltersChange({ ...filters, epr: toggled(filters.epr, value) })}
                  aria-pressed={filters.epr.includes(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Timeframe</span>
            <div className={styles.chips}>
              {TIMEFRAME_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  className={`${styles.chip} ${filters.timeframes.includes(value) ? styles.chipActive : ''}`}
                  onClick={() => onFiltersChange({ ...filters, timeframes: toggled(filters.timeframes, value) })}
                  aria-pressed={filters.timeframes.includes(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>People</span>
            <div className={styles.chips}>
              {teamMembers.map(member => (
                <button
                  key={member.id}
                  className={`${styles.chip} ${filters.owners.includes(member.name) ? styles.chipActive : ''}`}
                  onClick={() => onFiltersChange({ ...filters, owners: toggled(filters.owners, member.name) })}
                  aria-pressed={filters.owners.includes(member.name)}
                >
                  {member.name}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Size</span>
            <div className={styles.chips}>
              {SIZE_OPTIONS.map(size => (
                <button
                  key={size}
                  className={`${styles.chip} ${filters.sizes.includes(size) ? styles.chipActive : ''}`}
                  onClick={() => onFiltersChange({ ...filters, sizes: toggled(filters.sizes, size) })}
                  aria-pressed={filters.sizes.includes(size)}
                >
                  {SIZE_LABELS[size]}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionLabel}>Status</span>
            <div className={styles.chips}>
              {STATUS_COLORS.map(({ slug, name, hex }) => (
                <button
                  key={slug}
                  className={`${styles.chip} ${filters.statuses.includes(slug as ProjectStatus) ? styles.chipActive : ''}`}
                  onClick={() => onFiltersChange({ ...filters, statuses: toggled(filters.statuses, slug as ProjectStatus) })}
                  aria-pressed={filters.statuses.includes(slug as ProjectStatus)}
                >
                  <span className={styles.statusDot} style={{ backgroundColor: hex }} />
                  {name}
                </button>
              ))}
            </div>
          </div>

          {activeCount > 0 && (
            <div className={styles.footer}>
              <span className={styles.count}>
                {filteredCount} of {totalCount} projects
              </span>
              <button className={styles.clearBtn} onClick={clearAll}>
                Clear filters
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
});
