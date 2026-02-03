import type { ZoomLevel } from './Timeline';
import styles from './Header.module.css';

interface HeaderProps {
  zoomLevel: ZoomLevel;
  onZoomChange: (level: ZoomLevel) => void;
}

const ZOOM_OPTIONS: { value: ZoomLevel; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export function Header({ zoomLevel, onZoomChange }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.title}>Digital Roadmap Overview</h1>
      </div>
      <div className={styles.center}>
        <div className={styles.zoomControl}>
          <span className={styles.zoomLabel}>View:</span>
          <div className={styles.zoomButtons}>
            {ZOOM_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                className={`${styles.zoomBtn} ${zoomLevel === value ? styles.active : ''}`}
                onClick={() => onZoomChange(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className={styles.right} />
    </header>
  );
}
