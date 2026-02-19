import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LeaveType, LeaveCoverage } from '../types';
import styles from './LeaveContextMenu.module.css';

interface LeaveContextMenuProps {
  x: number;
  y: number;
  memberId: string;
  date: string;
  onAddLeave: (data: {
    memberId: string;
    startDate: string;
    endDate: string;
    type: LeaveType;
    coverage: LeaveCoverage;
    label?: string;
  }) => void;
  onClose: () => void;
}

export function LeaveContextMenu({
  x,
  y,
  memberId,
  date,
  onAddLeave,
  onClose
}: LeaveContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [startDate, setStartDate] = useState(date);
  const [endDate, setEndDate] = useState(date);

  // Adjust menu position to stay within viewport via direct DOM mutation.
  // useLayoutEffect runs before paint, preventing position flash.
  useLayoutEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    let adjustedX = x;
    let adjustedY = y;
    if (x + rect.width > window.innerWidth) {
      adjustedX = window.innerWidth - rect.width - 10;
    }
    if (y + rect.height > window.innerHeight) {
      adjustedY = window.innerHeight - rect.height - 10;
    }
    menuRef.current.style.left = `${adjustedX}px`;
    menuRef.current.style.top = `${adjustedY}px`;
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
    if (startDate && endDate && endDate >= startDate) {
      onAddLeave({
        memberId,
        startDate,
        endDate,
        type: 'annual-leave',
        coverage: 'full'
      });
      onClose();
    }
  };

  return createPortal(
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: x, top: y }}
    >
      <div className={styles.menuHeader}>Add Annual Leave</div>
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
      <button
        className={styles.submitBtn}
        onClick={handleSubmit}
        disabled={!startDate || !endDate || endDate < startDate}
      >
        Add Leave
      </button>
    </div>,
    document.body
  );
}
