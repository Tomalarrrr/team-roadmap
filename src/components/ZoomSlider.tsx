import { useRef, useCallback, useState, useEffect } from 'react';
import styles from './ZoomSlider.module.css';

interface ZoomSliderProps {
  value: number; // dayWidth in pixels
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

// Preset zoom levels for reference ticks
const ZOOM_PRESETS = [
  { value: 0.8, label: 'Year' },
  { value: 3, label: 'Month' },
  { value: 8, label: 'Week' },
];

export function ZoomSlider({
  value,
  onChange,
  min = 0.5,
  max = 12
}: ZoomSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Instant zoom - Timeline's useLayoutEffect handles smooth centering
  const handleZoom = useCallback((targetValue: number) => {
    onChange(Math.max(min, Math.min(max, targetValue)));
  }, [min, max, onChange]);

  // Convert dayWidth to slider position (0-1) using logarithmic scale
  // This makes zooming feel more natural - equal slider movement = equal visual change
  const valueToPosition = useCallback((val: number) => {
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const logVal = Math.log(Math.max(min, Math.min(max, val)));
    return (logVal - logMin) / (logMax - logMin);
  }, [min, max]);

  // Convert slider position (0-1) back to dayWidth
  const positionToValue = useCallback((pos: number) => {
    const logMin = Math.log(min);
    const logMax = Math.log(max);
    const logVal = logMin + pos * (logMax - logMin);
    return Math.exp(logVal);
  }, [min, max]);

  const handleDrag = useCallback((clientX: number) => {
    if (!trackRef.current) return;

    const rect = trackRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newValue = positionToValue(pos);
    onChange(newValue);
  }, [positionToValue, onChange]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    handleDrag(e.clientX);
  }, [handleDrag]);

  // Global mouse events for smooth dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleDrag(e.clientX);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleDrag]);

  // Get the current zoom level label
  const getCurrentLabel = () => {
    if (value >= 5) return 'Week';
    if (value >= 1.8) return 'Month';
    return 'Year';
  };

  const position = valueToPosition(value);

  return (
    <div className={styles.zoomSlider}>
      <button
        className={styles.zoomBtn}
        onClick={() => handleZoom(value / 1.3)}
        title="Zoom out"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>

      <div className={styles.sliderContainer}>
        <div
          ref={trackRef}
          className={`${styles.track} ${isDragging ? styles.dragging : ''}`}
          onMouseDown={handleMouseDown}
        >
          {/* Track fill */}
          <div
            className={styles.trackFill}
            style={{ width: `${position * 100}%` }}
          />

          {/* Preset tick marks */}
          {ZOOM_PRESETS.map((preset) => {
            const tickPos = valueToPosition(preset.value);
            return (
              <div
                key={preset.label}
                className={styles.tick}
                style={{ left: `${tickPos * 100}%` }}
              />
            );
          })}

          {/* Thumb */}
          <div
            className={styles.thumb}
            style={{ left: `${position * 100}%` }}
          />
        </div>

        {/* Current level indicator */}
        <span className={styles.levelLabel}>{getCurrentLabel()}</span>
      </div>

      <button
        className={styles.zoomBtn}
        onClick={() => handleZoom(value * 1.3)}
        title="Zoom in"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 3V11M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
