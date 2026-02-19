import { useState, useEffect } from 'react';
import { subscribeToQueueChanges, type QueuedOperation } from '../utils/offlineQueue';
import styles from './OfflineBanner.module.css';

interface OfflineBannerProps {
  isOnline: boolean;
  isSyncing?: boolean;
}

export function OfflineBanner({ isOnline, isSyncing }: OfflineBannerProps) {
  const [pendingCount, setPendingCount] = useState(0);
  const [cooldown, setCooldown] = useState(false);

  // Subscribe to queue changes to show pending operation count
  useEffect(() => {
    const unsubscribe = subscribeToQueueChanges((queue: QueuedOperation[]) => {
      setPendingCount(queue.length);
    });

    return unsubscribe;
  }, []);

  // Derive visibility: show when offline, has pending, or in cooldown after sync
  const needsDisplay = !isOnline || pendingCount > 0;

  // Detect transition from "needs display" → "doesn't need display" to start cooldown
  // Uses getDerivedStateFromProps pattern (setState during render)
  const [prevNeedsDisplay, setPrevNeedsDisplay] = useState(needsDisplay);
  if (needsDisplay !== prevNeedsDisplay) {
    setPrevNeedsDisplay(needsDisplay);
    if (!needsDisplay) {
      setCooldown(true); // Show "synced" message briefly
    } else {
      setCooldown(false);
    }
  }

  // Clear cooldown after 2s — setState only in timeout callback
  useEffect(() => {
    if (!cooldown) return;
    const timeout = setTimeout(() => setCooldown(false), 2000);
    return () => clearTimeout(timeout);
  }, [cooldown]);

  const isVisible = needsDisplay || cooldown;
  if (!isVisible) return null;

  const getBannerContent = () => {
    if (!isOnline) {
      return {
        icon: (
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M1 1l22 22M9 9a3 3 0 0 0 4.24 4.24M16.24 16.24A9 9 0 0 0 12 21a9 9 0 0 0-9-9c0-1.34.29-2.61.81-3.76M21 12a9 9 0 0 0-2.81-6.53" />
          </svg>
        ),
        message: pendingCount > 0
          ? `You're offline. ${pendingCount} change${pendingCount === 1 ? '' : 's'} pending.`
          : "You're offline. Changes will sync when reconnected.",
        variant: 'offline' as const
      };
    }

    if (isSyncing && pendingCount > 0) {
      return {
        icon: (
          <svg className={`${styles.icon} ${styles.spinning}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c-1.657 0-3-4.03-3-9s1.343-9 3-9m0 18c1.657 0 3-4.03 3-9s-1.343-9-3-9" />
          </svg>
        ),
        message: `Syncing ${pendingCount} change${pendingCount === 1 ? '' : 's'}...`,
        variant: 'syncing' as const
      };
    }

    if (pendingCount === 0 && isOnline) {
      return {
        icon: (
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ),
        message: 'All changes synced',
        variant: 'synced' as const
      };
    }

    return null;
  };

  const content = getBannerContent();
  if (!content) return null;

  return (
    <div
      className={`${styles.banner} ${styles[content.variant]}`}
      role="status"
      aria-live="polite"
    >
      <div className={styles.content}>
        {content.icon}
        <span className={styles.message}>{content.message}</span>
      </div>
    </div>
  );
}
