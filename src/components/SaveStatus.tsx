import { useState, useEffect } from 'react';
import { formatDistanceToNow } from 'date-fns';
import styles from './SaveStatus.module.css';

interface SaveStatusProps {
  isSaving: boolean;
  lastSaved: Date | null;
  saveError: string | null;
  isOnline?: boolean;
}

export function SaveStatus({ isSaving, lastSaved, saveError, isOnline = true }: SaveStatusProps) {
  const [, forceUpdate] = useState({});

  // Update "X ago" text every 30 seconds
  useEffect(() => {
    if (!lastSaved) return;
    const interval = setInterval(() => forceUpdate({}), 30000);
    return () => clearInterval(interval);
  }, [lastSaved]);

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
        <span>Saved {formatDistanceToNow(lastSaved, { addSuffix: true })}</span>
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
