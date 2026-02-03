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
  '#1e3a5f', // Navy Blue
  '#7c3aed', // Purple
  '#991b1b', // Deep Red
  '#d97706', // Amber
  '#059669', // Green
  '#6b7280', // Grey
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
