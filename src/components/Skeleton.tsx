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

export function TimelineSkeleton() {
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
      </div>
    </div>
  );
}
