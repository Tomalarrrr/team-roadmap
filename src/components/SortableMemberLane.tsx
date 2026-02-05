import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TeamMember } from '../types';
import styles from './Timeline.module.css';

interface SortableMemberLaneProps {
  member: TeamMember;
  height: number;
  isLocked?: boolean; // When true, disable sorting and add project
  onEdit: () => void;
  onAddProject: () => void;
}

export function SortableMemberLane({ member, height, isLocked = false, onEdit, onAddProject }: SortableMemberLaneProps) {
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
      className={`${styles.memberLane} ${isDragging ? styles.dragging : ''}`}
    >
      <div className={styles.memberLaneContent}>
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
          <span className={styles.memberTitle}>{member.jobTitle}</span>
        </div>
      </div>
      <button
        className={styles.addProjectBtn}
        onClick={onAddProject}
        disabled={isLocked}
      >
        + Add Project
      </button>
    </div>
  );
}
