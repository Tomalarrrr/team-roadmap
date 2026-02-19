import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PeriodMarkerColor, PeriodMarker } from '../types';
import styles from './LeaveContextMenu.module.css';

interface PeriodMarkerContextMenuProps {
  x: number;
  y: number;
  date: string;
  initialValues?: PeriodMarker; // When provided, component is in edit mode
  onAddMarker: (data: {
    startDate: string;
    endDate: string;
    color: PeriodMarkerColor;
    label?: string;
  }) => void;
  onClose: () => void;
}

const MARKER_COLORS: { color: PeriodMarkerColor; label: string; bg: string }[] = [
  { color: 'grey', label: 'Grey', bg: '#6E7D89' },
  { color: 'yellow', label: 'Yellow', bg: '#A67A00' },
  { color: 'orange', label: 'Orange', bg: '#e67635' },
  { color: 'red', label: 'Red', bg: '#B5444A' },
  { color: 'green', label: 'Green', bg: '#457028' }
];

export function PeriodMarkerContextMenu({
  x,
  y,
  date,
  initialValues,
  onAddMarker,
  onClose
}: PeriodMarkerContextMenuProps) {
  const isEditing = !!initialValues;
  const menuRef = useRef<HTMLDivElement>(null);
  const [startDate, setStartDate] = useState(initialValues?.startDate || date);
  const [endDate, setEndDate] = useState(initialValues?.endDate || date);
  const [selectedColor, setSelectedColor] = useState<PeriodMarkerColor>(initialValues?.color || 'grey');
  const [label, setLabel] = useState(initialValues?.label || '');

  // Adjust menu position to stay within viewport
  const [position, setPosition] = useState({ x, y });

  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let adjustedX = x;
      let adjustedY = y;

      if (x + rect.width > viewportWidth) {
        adjustedX = viewportWidth - rect.width - 10;
      }
      if (y + rect.height > viewportHeight) {
        adjustedY = viewportHeight - rect.height - 10;
      }

      setPosition({ x: adjustedX, y: adjustedY });
    }
  }, [x, y]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  const handleSubmit = () => {
    if (startDate && endDate) {
      onAddMarker({
        startDate,
        endDate,
        color: selectedColor,
        label: label.trim() || undefined
      });
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: position.x, top: position.y }}
    >
      <div className={styles.menuHeader}>{isEditing ? 'Edit Period Marker' : 'Add Period Marker'}</div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Color</label>
        <div style={{ display: 'flex', gap: '6px', padding: '4px 0' }}>
          {MARKER_COLORS.map(({ color, label: colorLabel, bg }) => (
            <button
              key={color}
              type="button"
              onClick={() => setSelectedColor(color)}
              title={colorLabel}
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '4px',
                backgroundColor: bg,
                border: selectedColor === color ? '2px solid #1f2937' : '2px solid transparent',
                cursor: 'pointer',
                padding: 0
              }}
            />
          ))}
        </div>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.label}>Start Date</label>
        <input
          type="date"
          className={styles.dateInput}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label}>End Date</label>
        <input
          type="date"
          className={styles.dateInput}
          value={endDate}
          min={startDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
      </div>
      <div className={styles.formGroup}>
        <label className={styles.label}>Label (optional)</label>
        <input
          type="text"
          className={styles.textInput}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g., Code Freeze"
          maxLength={30}
        />
      </div>
      <button
        className={styles.submitBtn}
        onClick={handleSubmit}
        disabled={!startDate || !endDate}
      >
        {isEditing ? 'Save Changes' : 'Add Marker'}
      </button>
    </div>,
    document.body
  );
}
