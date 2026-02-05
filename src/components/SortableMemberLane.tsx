import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TeamMember } from '../types';
import styles from './Timeline.module.css';

interface SortableMemberLaneProps {
  member: TeamMember;
  height: number;
  isLocked?: boolean; // When true, disable sorting and add project
  isCollapsed?: boolean; // When true, lane is collapsed to minimal height
  onToggleCollapse?: () => void;
  onEdit: () => void;
  onAddProject: () => void;
}

export function SortableMemberLane({ member, height, isLocked = false, isCollapsed = false, onToggleCollapse, onEdit, onAddProject }: SortableMemberLaneProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: member.id, disabled: isLocked });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 200ms cubic-bezier(0.25, 1, 0.5, 1)',
    opacity: isDragging ? 0.9 : 1,
    zIndex: isDragging ? 100 : 'auto',
    height,
    minHeight: height,
    boxShadow: isDragging ? '0 8px 24px rgba(0,0,0,0.15)' : undefined,
    background: isDragging ? 'var(--bg-primary)' : undefined
  } as React.CSSProperties;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.memberLane} ${isDragging ? styles.dragging : ''} ${isCollapsed ? styles.collapsed : ''}`}
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
        {!isLocked && (
          <div
            className={styles.dragHandle}
            {...attributes}
            {...listeners}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <circle cx="3" cy="2" r="1.5" />
              <circle cx="9" cy="2" r="1.5" />
              <circle cx="3" cy="6" r="1.5" />
              <circle cx="9" cy="6" r="1.5" />
              <circle cx="3" cy="10" r="1.5" />
              <circle cx="9" cy="10" r="1.5" />
            </svg>
          </div>
        )}
        <div className={styles.memberInfo} onClick={isLocked ? undefined : onEdit} style={{ cursor: isLocked ? 'default' : 'pointer' }}>
          <span className={styles.memberName}>{member.name}</span>
          {!isCollapsed && <span className={styles.memberTitle}>{member.jobTitle}</span>}
        </div>
      </div>
      {!isCollapsed && (
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
