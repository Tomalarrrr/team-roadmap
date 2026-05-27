import { useState, useEffect } from 'react';
import styles from './OfflineBanner.module.css';

interface OfflineBannerProps {
  isOnline: boolean;
  isSyncing?: boolean;
}

export function OfflineBanner({ isOnline }: OfflineBannerProps) {
  const [cooldown, setCooldown] = useState(false);

  const needsDisplay = !isOnline;

  // Detect the offline⇄online transition during render (React's "adjust state
  // when a value changes" pattern) rather than in an effect — needsDisplay is a
  // boolean so the comparison is stable and this converges in one extra render.
  const [prevNeedsDisplay, setPrevNeedsDisplay] = useState(needsDisplay);
  if (prevNeedsDisplay !== needsDisplay) {
    setPrevNeedsDisplay(needsDisplay);
    if (prevNeedsDisplay && !needsDisplay) {
      setCooldown(true); // just came back online → show "synced" briefly
    } else if (needsDisplay) {
      setCooldown(false); // went offline → clear any pending cooldown
    }
  }

  // Clear cooldown after 2s
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
        message: "You're offline. Changes will sync when reconnected.",
        variant: 'offline' as const
      };
    }

    if (isOnline) {
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
