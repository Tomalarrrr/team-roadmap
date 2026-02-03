import { useState } from 'react';
import styles from './Form.module.css';

interface MilestoneFormProps {
  initialValues?: {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    tags: string[];
    statusColor: string;
    manualColorOverride?: boolean;
  };
  projectStartDate: string;
  projectEndDate: string;
  onSubmit: (values: {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    tags: string[];
    statusColor: string;
    manualColorOverride?: boolean;
  }) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isEditing?: boolean;
}

const DEFAULT_COLORS = [
  '#6B8CAE', // Soft Blue
  '#9F8FBF', // Soft Purple
  '#C98B8B', // Soft Rose
  '#D4A574', // Soft Amber
  '#7BAF8E', // Soft Green
  '#9CA3AF', // Soft Grey
];

export function MilestoneForm({
  initialValues,
  projectStartDate,
  onSubmit,
  onCancel,
  onDelete,
  isEditing = false
}: MilestoneFormProps) {
  const [title, setTitle] = useState(initialValues?.title || '');
  const [description, setDescription] = useState(initialValues?.description || '');
  const [startDate, setStartDate] = useState(initialValues?.startDate || projectStartDate);
  const [endDate, setEndDate] = useState(initialValues?.endDate || projectStartDate);
  const [tagsInput, setTagsInput] = useState(initialValues?.tags?.join(', ') || '');
  const [statusColor, setStatusColor] = useState(initialValues?.statusColor || DEFAULT_COLORS[0]);
  const [manualColorOverride, setManualColorOverride] = useState(
    initialValues?.manualColorOverride || false
  );
  const [customColor, setCustomColor] = useState('');
  const [dateError, setDateError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDate || !endDate) return;

    if (new Date(endDate) < new Date(startDate)) {
      setDateError('End date cannot be before start date');
      return;
    }
    setDateError('');

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      startDate,
      endDate,
      tags,
      statusColor,
      manualColorOverride
    });
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="title" className={styles.label}>Milestone Title</label>
        <input
          id="title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={styles.input}
          placeholder="Enter milestone title"
          autoFocus
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="description" className={styles.label}>Description <span className={styles.optional}>(optional)</span></label>
        <textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={styles.textarea}
          placeholder="Add details about this milestone..."
          rows={3}
        />
      </div>

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
              setDateError('');
            }}
            className={styles.input}
            required
          />
        </div>
      </div>

      {dateError && <div className={styles.error}>{dateError}</div>}

      <div className={styles.field}>
        <label htmlFor="tags" className={styles.label}>Tags</label>
        <input
          id="tags"
          type="text"
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          className={styles.input}
          placeholder="Enter tags separated by commas"
        />
        <span className={styles.hint}>Separate multiple tags with commas</span>
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
              onClick={() => {
                setStatusColor(color);
                setManualColorOverride(true);
              }}
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
                setManualColorOverride(true);
              }}
              className={styles.customColorInput}
              aria-label="Custom color picker"
            />
          </div>
        </div>
      </div>

      <div className={styles.checkboxField}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={manualColorOverride}
            onChange={(e) => setManualColorOverride(e.target.checked)}
            className={styles.checkbox}
          />
          <span>Keep this color (don't auto-change to blue when past due)</span>
        </label>
      </div>

      <div className={styles.actions}>
        {isEditing && onDelete && (
          <button type="button" onClick={onDelete} className={styles.deleteBtn}>
            Delete
          </button>
        )}
        <div className={styles.actionsSpacer} />
        <button type="button" onClick={onCancel} className={styles.cancelBtn}>
          Cancel
        </button>
        <button type="submit" className={styles.submitBtn}>
          {isEditing ? 'Save Changes' : 'Add Milestone'}
        </button>
      </div>
    </form>
  );
}
