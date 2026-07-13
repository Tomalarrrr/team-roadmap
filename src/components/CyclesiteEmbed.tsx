import { useEffect } from 'react';
import styles from './CyclesiteEmbed.module.css';

interface CyclesiteEmbedProps {
  onClose: () => void;
}

// Hidden feature: full-screen embed of the Cyclesite traffic-flow dashboard.
// Opened by searching "cyclesite" (see SearchFilter) or via the ?cyclesite URL param.
export function CyclesiteEmbed({ onClose }: CyclesiteEmbedProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    // Prevent the page behind the full-screen overlay from scrolling.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className={styles.overlay}>
      <button className={styles.closeBtn} onClick={onClose} aria-label="Close Cyclesite">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
          <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <iframe
        className={styles.frame}
        src="https://cyclesite-flows.2tpsouthern.workers.dev/?k=f4fe8bb239a3d523339a0e7116a5a125"
        loading="lazy"
        title="Cyclesite traffic flows"
      />
    </div>
  );
}
