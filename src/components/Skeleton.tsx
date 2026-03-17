import { useState, useEffect } from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string;
}

export function Skeleton({ width, height, borderRadius }: SkeletonProps) {
  return (
    <div
      className={styles.skeleton}
      style={{
        width: typeof width === 'number' ? width + 'px' : width,
        height: typeof height === 'number' ? height + 'px' : height,
        borderRadius
      }}
    />
  );
}

const STALE_LOAD_MS = 8000;

function clearCacheAndReload() {
  // Unregister all service workers
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => {
      regs.forEach(r => r.unregister());
    });
  }
  // Clear all Cache API caches
  if ('caches' in window) {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
  }
  // Small delay to let unregister/cache-clear settle, then hard reload
  setTimeout(() => {
    window.location.reload();
  }, 300);
}

export function TimelineSkeleton() {
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowRecovery(true), STALE_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={styles.timelineSkeleton}>
      <div className={styles.sidebarSkeleton}>
        <Skeleton height={40} borderRadius="var(--radius-md)" />
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={styles.memberSkeleton}>
            <Skeleton width={120} height={20} borderRadius="var(--radius-sm)" />
            <Skeleton width={80} height={14} borderRadius="var(--radius-sm)" />
          </div>
        ))}
      </div>
      <div className={styles.gridSkeleton}>
        <div className={styles.headerSkeleton}>
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} width={80} height={24} borderRadius="var(--radius-sm)" />
          ))}
        </div>
        <div className={styles.lanesSkeleton}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className={styles.laneSkeleton}>
              <Skeleton width="45%" height={52} borderRadius="var(--radius-md)" />
            </div>
          ))}
        </div>
        {showRecovery && (
          <div className={styles.recoveryBanner}>
            <p>Taking longer than expected to load.</p>
            <button className={styles.recoveryButton} onClick={clearCacheAndReload}>
              Clear cache &amp; reload
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
