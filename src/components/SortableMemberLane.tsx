import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TeamMember } from '../types';
import styles from './Timeline.module.css';

interface SortableMemberLaneProps {
  member: TeamMember;
  height: number;
  isLocked?: boolean; // When true, disable sorting and add project
  isCollapsed?: boolean; // When true, lane is collapsed to minimal height
  // True when a filter has left this lane with nothing to show. Renders at the
  // same slim height as a collapsed lane, but is NOT the user's collapse state —
  // the chevron still reads "expanded", because expanding it wouldn't reveal
  // anything and clearing the filter restores the lane on its own.
  isEmpty?: boolean;
  railMode?: boolean; // When true, the whole sidebar is a thin vertical rail
  onToggleCollapse?: () => void;
  onEdit: () => void;
  onAddProject: () => void;
}

export function SortableMemberLane({ member, height, isLocked = false, isCollapsed = false, isEmpty = false, railMode = false, onToggleCollapse, onEdit, onAddProject }: SortableMemberLaneProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: member.id, disabled: isLocked || railMode });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform var(--transition-normal)',
    opacity: isDragging ? 0.9 : 1,
    zIndex: isDragging ? 100 : 'auto',
    // Published as a custom property rather than an inline `height`, so the
    // stylesheet stays in charge of layout. As an inline height it beat every
    // media query — the ≤768px rule that lays the sidebar out as a horizontal
    // strip sets `height: auto`, which could never apply, so on a phone each
    // lane kept its full desktop row height and the panel became an unusable
    // 200px-tall column of gaps.
    ['--lane-h' as string]: `${height}px`,
    boxShadow: isDragging ? 'var(--shadow-hover)' : undefined,
    background: isDragging ? 'var(--bg-primary)' : undefined
  } as React.CSSProperties;

  // Rail mode: the sidebar is collapsed to a thin strip, so we show only the
  // member's name turned 90° (reading bottom-to-top), centred in the lane. The
  // full name + title live in the tooltip, and clicking still opens the editor.
  if (railMode) {
    return (
      <div
        ref={setNodeRef}
        style={style}
        className={`${styles.memberLane} ${styles.memberLaneRail}`}
        onClick={isLocked ? undefined : onEdit}
        title={member.jobTitle ? `${member.name} — ${member.jobTitle}` : member.name}
      >
        <span className={styles.railName}>
          {member.name}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.memberLane} ${isDragging ? styles.dragging : ''} ${isCollapsed || isEmpty ? styles.collapsed : ''}`}
    >
      <div className={styles.memberLaneContent}>
        {/* Collapse toggle button */}
        {onToggleCollapse && (
          <button
            className={styles.collapseBtn}
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand lane' : 'Collapse lane'}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              {isCollapsed ? (
                // Chevron right (expand)
                <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                // Chevron down (collapse)
                <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        )}
        {/* The handle's box is always rendered — only its glyph and drag
            listeners are conditional. Reserving the gutter in both states stops
            the lane name from reflowing (and sometimes wrapping to a second
            line) the instant the board is unlocked. */}
        <div
          className={`${styles.dragHandle} ${isLocked ? styles.dragHandleReserved : ''}`}
          aria-hidden={isLocked || undefined}
          {...(isLocked ? {} : attributes)}
          {...(isLocked ? {} : listeners)}
        >
          {!isLocked && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="3" cy="2" r="1.5" />
              <circle cx="9" cy="2" r="1.5" />
              <circle cx="3" cy="6" r="1.5" />
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="3" cy="10" r="1.5" />
              <circle cx="9" cy="10" r="1.5" />
            </svg>
          )}
        </div>
        <div className={styles.memberInfo} onClick={isLocked ? undefined : onEdit} style={{ cursor: isLocked ? 'default' : 'pointer' }}>
          <span className={styles.memberName}>{member.name}</span>
          {!isCollapsed && !isEmpty && <span className={styles.memberTitle}>{member.jobTitle}</span>}
        </div>
      </div>
      {!isCollapsed && !isEmpty && (
        <button
          className={styles.addProjectBtn}
          onClick={onAddProject}
          disabled={isLocked}
        >
          + Add Project
        </button>
      )}
    </div>
  );
}
