import { useState } from 'react';
import { milestoneSchema, validateForm } from '../utils/validation';
import styles from './Form.module.css';

interface MilestoneFormProps {
  initialValues?: {
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    tags: string[];
    statusColor: string;
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
  }) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isEditing?: boolean;
}

// Status-aligned colors matching SearchFilter status indicators
const STATUS_COLORS = [
  { hex: '#0070c0', name: 'Complete' },
  { hex: '#04b050', name: 'On Track' },
  { hex: '#ffc002', name: 'At Risk' },
  { hex: '#ff0100', name: 'Off Track' },
  { hex: '#7612c3', name: 'On Hold' },
  { hex: '#9ca3af', name: 'To Start' },
];

export function MilestoneForm({
  initialValues,
  projectStartDate,
  projectEndDate,
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
  const [statusColor, setStatusColor] = useState(initialValues?.statusColor || STATUS_COLORS[0].hex);
  const [customColor, setCustomColor] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Check if milestone extends beyond project bounds
  const extendsBeforeProject = startDate && new Date(startDate) < new Date(projectStartDate);
  const extendsAfterProject = endDate && new Date(endDate) > new Date(projectEndDate);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const tags = tagsInput
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const result = validateForm(milestoneSchema, {
      title: title.trim(),
      description: description.trim() || undefined,
      startDate,
      endDate,
      tags,
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
              setErrors({});
            }}
            className={styles.input}
            required
          />
        </div>
      </div>

      {errors.endDate && <div className={styles.error}>{errors.endDate}</div>}

      {(extendsBeforeProject || extendsAfterProject) && (
        <div className={styles.warning}>
          Note: This milestone extends {extendsBeforeProject ? 'before' : ''}{extendsBeforeProject && extendsAfterProject ? ' and ' : ''}{extendsAfterProject ? 'after' : ''} the project dates. The project bar will expand to contain it.
        </div>
      )}

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

      {showDeleteConfirm && (
        <div className={styles.deleteConfirm}>
          <p>Are you sure you want to delete this milestone?</p>
          <div className={styles.deleteConfirmActions}>
            <button type="button" onClick={() => setShowDeleteConfirm(false)} className={styles.cancelBtn}>
              Cancel
            </button>
            <button type="button" onClick={onDelete} className={styles.deleteConfirmBtn}>
              Delete Milestone
            </button>
          </div>
        </div>
      )}

      {!showDeleteConfirm && (
        <div className={styles.actions}>
          {isEditing && onDelete && (
            <button type="button" onClick={() => setShowDeleteConfirm(true)} className={styles.deleteBtn}>
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
      )}
    </form>
  );
}
