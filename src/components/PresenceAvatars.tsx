import { useState } from 'react';
import { getInitials, type PresenceUser } from '../hooks/usePresence';
import styles from './PresenceAvatars.module.css';

interface PresenceAvatarsProps {
  users: PresenceUser[];
  currentUserId: string;
  maxVisible?: number;
}

export function PresenceAvatars({
  users,
  currentUserId,
  maxVisible = 4
}: PresenceAvatarsProps) {
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  // Filter out current user and sort by lastSeen (most recent first)
  const otherUsers = users
    .filter((u) => u.id !== currentUserId)
    .sort((a, b) => b.lastSeen - a.lastSeen);

  if (otherUsers.length === 0) {
    return null;
  }

  const visibleUsers = otherUsers.slice(0, maxVisible);
  const hiddenCount = otherUsers.length - maxVisible;

  return (
    <div className={styles.container} role="group" aria-label="Active viewers">
      <div className={styles.avatarStack}>
        {visibleUsers.map((user, index) => (
          <div
            key={user.id}
            className={styles.avatarWrapper}
            style={{ zIndex: visibleUsers.length - index }}
            onMouseEnter={() => setShowTooltip(user.id)}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <div
              className={styles.avatar}
              style={{ backgroundColor: user.color }}
              title={user.name}
            >
              {getInitials(user.name)}
              {user.editingProjectId && (
                <span className={styles.editingIndicator} aria-label="Editing" />
              )}
            </div>

            {showTooltip === user.id && (
              <div className={styles.tooltip}>
                <span className={styles.tooltipName}>{user.name}</span>
                {user.editingProjectId && (
                  <span className={styles.tooltipStatus}>Editing...</span>
                )}
              </div>
            )}
          </div>
        ))}

        {hiddenCount > 0 && (
          <div
            className={styles.avatarWrapper}
            style={{ zIndex: 0 }}
            onMouseEnter={() => setShowTooltip('overflow')}
            onMouseLeave={() => setShowTooltip(null)}
          >
            <div className={`${styles.avatar} ${styles.overflowAvatar}`}>
              +{hiddenCount}
            </div>

            {showTooltip === 'overflow' && (
              <div className={styles.tooltip}>
                <span className={styles.tooltipName}>
                  {otherUsers.slice(maxVisible).map((u) => u.name).join(', ')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <span className={styles.label}>
        {otherUsers.length} other{otherUsers.length === 1 ? '' : 's'} viewing
      </span>
    </div>
  );
}
