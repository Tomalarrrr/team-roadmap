import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { projectSchema, validateForm } from '../utils/validation';
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

// Status-aligned colors matching SearchFilter status indicators
const STATUS_COLORS = [
  { hex: '#04b050', name: 'On Track' },
  { hex: '#ffc002', name: 'At Risk' },
  { hex: '#ff0100', name: 'Off Track' },
  { hex: '#7612c3', name: 'On Hold' },
  { hex: '#9ca3af', name: 'To Start' },
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
  const [statusColor, setStatusColor] = useState(initialValues?.statusColor || STATUS_COLORS[0].hex);
  const [customColor, setCustomColor] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const result = validateForm(projectSchema, {
      title: title.trim(),
      owner: owner.trim(),
      startDate,
      endDate,
      statusColor
    });

    if (!result.success) {
      setErrors(result.errors);
      return;
    }

    setErrors({});
    onSubmit(result.data);
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
            onChange={(e) => {
              setEndDate(e.target.value);
              setErrors({});
            }}
            className={styles.input}
            required
          />
        </div>
      </div>

      {!isEditing && (
        <button
          type="button"
          className={styles.newRowBtn}
          onClick={() => {
            const today = new Date();
            setStartDate(format(today, 'yyyy-MM-dd'));
            setEndDate(format(addDays(today, 30), 'yyyy-MM-dd'));
          }}
        >
          ↻ Reset to Today
        </button>
      )}

      {Object.keys(errors).length > 0 && (
        <div className={styles.error}>
          {Object.values(errors).join('. ')}
        </div>
      )}

      <div className={styles.field}>
        <label className={styles.label}>Status</label>
        <div className={styles.colorPicker}>
          {STATUS_COLORS.map(({ hex, name }) => (
            <button
              key={hex}
              type="button"
              className={`${styles.colorSwatch} ${statusColor === hex ? styles.selected : ''}`}
              style={{ backgroundColor: hex }}
              onClick={() => setStatusColor(hex)}
              aria-label={`Select ${name} status`}
              title={name}
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
        <span className={styles.hint}>
          {STATUS_COLORS.find(c => c.hex === statusColor)?.name || 'Custom'}
        </span>
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
