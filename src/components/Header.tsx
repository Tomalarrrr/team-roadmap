import type { ZoomLevel } from './Timeline';
import styles from './Header.module.css';

interface HeaderProps {
  onAddProject: () => void;
  zoomLevel: ZoomLevel;
  onZoomChange: (level: ZoomLevel) => void;
}

const ZOOM_OPTIONS: { value: ZoomLevel; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

export function Header({ onAddProject, zoomLevel, onZoomChange }: HeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <h1 className={styles.title}>Team Roadmap</h1>
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
      <div className={styles.right}>
        <button className={styles.addBtn} onClick={onAddProject}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3V13M3 8H13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          Add Project
        </button>
      </div>
    </header>
  );
}
