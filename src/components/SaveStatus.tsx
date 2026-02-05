import { useState, useEffect, useMemo } from 'react';
import styles from './SaveStatus.module.css';

interface SaveStatusProps {
  isSaving: boolean;
  lastSaved: Date | null;
  saveError: string | null;
  isOnline?: boolean;
}

// Lightweight time formatting (avoids date-fns import)
function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function SaveStatus({ isSaving, lastSaved, saveError, isOnline = true }: SaveStatusProps) {
  const [tick, setTick] = useState(0);

  // Update "X ago" text every 30 seconds
  useEffect(() => {
    if (!lastSaved) return;
    const interval = setInterval(() => setTick(t => t + 1), 30000);
    return () => clearInterval(interval);
  }, [lastSaved]);

  // Memoize time string to avoid recalculation
  const timeAgo = useMemo(() => {
    if (!lastSaved) return '';
    return formatTimeAgo(lastSaved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSaved, tick]);

  // Connection indicator dot
  const connectionDot = (
    <span
      className={`${styles.connectionDot} ${isOnline ? styles.online : styles.offline}`}
      title={isOnline ? 'Connected' : 'Offline - changes will sync when reconnected'}
    />
  );

  if (saveError) {
    return (
      <div className={`${styles.saveStatus} ${styles.error}`}>
        {connectionDot}
        <span className={styles.icon}>!</span>
        <span>Save failed</span>
      </div>
    );
  }

  if (isSaving) {
    return (
      <div className={`${styles.saveStatus} ${styles.saving}`}>
        {connectionDot}
        <span className={styles.spinner} />
        <span>Saving...</span>
      </div>
    );
  }

  if (lastSaved) {
    return (
      <div className={`${styles.saveStatus} ${styles.saved}`}>
        {connectionDot}
        <span className={styles.checkIcon}>✓</span>
        <span>Saved {timeAgo}</span>
      </div>
    );
  }

  // Show connection status even when no save state
  return (
    <div className={styles.saveStatus}>
      {connectionDot}
    </div>
  );
}
