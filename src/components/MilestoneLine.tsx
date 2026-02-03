import { useState, useEffect } from 'react';
import type { Milestone } from '../types';
import { getBarDimensions, isMilestonePast, formatShortDate } from '../utils/dateUtils';
import styles from './MilestoneLine.module.css';

interface MilestoneLineProps {
  milestone: Milestone;
  timelineStart: Date;
  dayWidth: number;
  projectLeft: number;
  projectWidth: number;
  onEdit: () => void;
  onDelete: () => void;
}

const AUTO_BLUE = '#3b82f6';

export function MilestoneLine({
  milestone,
  timelineStart,
  dayWidth,
  projectLeft,
  projectWidth,
  onEdit,
  onDelete
}: MilestoneLineProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const { left: milestoneLeft, width: milestoneWidth } = getBarDimensions(
    milestone.startDate,
    milestone.endDate,
    timelineStart,
    dayWidth
  );

  // Calculate position relative to the project bar
  const relativeLeft = milestoneLeft - projectLeft;
  const displayLeft = Math.max(0, relativeLeft);
  const displayWidth = Math.min(
    milestoneWidth,
    projectWidth - displayLeft - 16 // Account for padding
  );

  // Auto-blue rule: turn blue if milestone end date is past and no manual override
  const isPast = isMilestonePast(milestone.endDate);
  const displayColor = isPast && !milestone.manualColorOverride
    ? AUTO_BLUE
    : milestone.statusColor;

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = () => setShowMenu(false);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [showMenu]);

  if (displayWidth <= 0 || displayLeft >= projectWidth) {
    return null; // Milestone outside project bounds
  }

  return (
    <div
      className={styles.milestoneLine}
      style={{
        left: displayLeft,
        width: Math.max(displayWidth, 20),
        backgroundColor: displayColor || '#10b981'
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setShowMenu(true);
      }}
    >
      {/* Tooltip */}
      {showTooltip && (
        <div className={styles.tooltip}>
          <div className={styles.tooltipTitle}>{milestone.title}</div>
          <div className={styles.tooltipDates}>
            {formatShortDate(milestone.startDate)} - {formatShortDate(milestone.endDate)}
          </div>
          {milestone.tags.length > 0 && (
            <div className={styles.tooltipTags}>
              {milestone.tags.map((tag, i) => (
                <span key={i} className={styles.tag}>{tag}</span>
              ))}
            </div>
          )}
          {isPast && !milestone.manualColorOverride && (
            <div className={styles.pastBadge}>Past milestone</div>
          )}
        </div>
      )}

      {/* Context menu */}
      {showMenu && (
        <div className={styles.contextMenu} onClick={(e) => e.stopPropagation()}>
          <button onClick={onEdit}>Edit Milestone</button>
          <button className={styles.deleteBtn} onClick={onDelete}>Delete</button>
        </div>
      )}
    </div>
  );
}
