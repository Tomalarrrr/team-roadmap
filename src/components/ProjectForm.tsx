import { useState } from 'react';
import styles from './Form.module.css';

interface ProjectFormProps {
  initialValues?: Partial<{
    title: string;
    owner: string;
    startDate: string;
    endDate: string;
    statusColor: string;
  }>;
  onSubmit: (values: {
    title: string;
    owner: string;
    startDate: string;
    endDate: string;
    statusColor: string;
  }) => void;
  onCancel: () => void;
  isEditing?: boolean;
  hideOwner?: boolean;
}

const DEFAULT_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Purple
  '#ec4899', // Pink
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#ef4444', // Red
];

export function ProjectForm({
  initialValues,
  onSubmit,
  onCancel,
  isEditing = false,
  hideOwner = false
}: ProjectFormProps) {
  const [title, setTitle] = useState(initialValues?.title || '');
  const [owner, setOwner] = useState(initialValues?.owner || '');
  const [startDate, setStartDate] = useState(initialValues?.startDate || '');
  const [endDate, setEndDate] = useState(initialValues?.endDate || '');
  const [statusColor, setStatusColor] = useState(initialValues?.statusColor || DEFAULT_COLORS[0]);
  const [customColor, setCustomColor] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !owner.trim() || !startDate || !endDate) return;
    onSubmit({
      title: title.trim(),
      owner: owner.trim(),
      startDate,
      endDate,
      statusColor
    });
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="title" className={styles.label}>Project Title</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={styles.input}
          placeholder="Enter project title"
          autoFocus
          required
        />
      </div>

      {!hideOwner && (
        <div className={styles.field}>
          <label htmlFor="owner" className={styles.label}>Owner / Team Member</label>
          <input
            id="owner"
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={styles.input}
            placeholder="Enter owner name"
            required
          />
        </div>
      )}

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="startDate" className={styles.label}>Start Date</label>
          <input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={styles.input}
            required
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="endDate" className={styles.label}>End Date</label>
          <input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={styles.input}
            required
          />
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label}>Status Color</label>
        <div className={styles.colorPicker}>
          {DEFAULT_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`${styles.colorSwatch} ${statusColor === color ? styles.selected : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => setStatusColor(color)}
              aria-label={`Select color ${color}`}
            />
          ))}
          <div className={styles.customColorWrapper}>
            <input
              type="color"
              value={customColor || statusColor}
              onChange={(e) => {
                setCustomColor(e.target.value);
                setStatusColor(e.target.value);
              }}
              className={styles.customColorInput}
              aria-label="Custom color picker"
            />
          </div>
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={onCancel} className={styles.cancelBtn}>
          Cancel
        </button>
        <button type="submit" className={styles.submitBtn}>
          {isEditing ? 'Save Changes' : 'Create Project'}
        </button>
      </div>
    </form>
  );
}
