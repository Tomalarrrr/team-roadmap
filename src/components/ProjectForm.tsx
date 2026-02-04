import { useState } from 'react';
import { format, addDays } from 'date-fns';
import { projectSchema, validateForm, milestoneSchema } from '../utils/validation';
import type { Milestone } from '../types';
import styles from './Form.module.css';

interface MilestoneData {
  id?: string;
  title: string;
  description?: string;
  startDate: string;
  endDate: string;
  tags: string[];
  statusColor: string;
}

interface ProjectFormProps {
  initialValues?: Partial<{
    title: string;
    owner: string;
    startDate: string;
    endDate: string;
    statusColor: string;
  }>;
  initialMilestones?: Milestone[];
  onSubmit: (values: {
    title: string;
    owner: string;
    startDate: string;
    endDate: string;
    statusColor: string;
    milestones?: MilestoneData[];
  }) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isEditing?: boolean;
  hideOwner?: boolean;
  milestoneCount?: number;
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

// Milestone status colors
const MILESTONE_COLORS = [
  { hex: '#0070c0', name: 'Complete' },
  { hex: '#04b050', name: 'On Track' },
  { hex: '#ffc002', name: 'At Risk' },
  { hex: '#ff0100', name: 'Off Track' },
  { hex: '#7612c3', name: 'On Hold' },
  { hex: '#9ca3af', name: 'To Start' },
];

export function ProjectForm({
  initialValues,
  initialMilestones,
  onSubmit,
  onCancel,
  onDelete,
  isEditing = false,
  hideOwner = false
}: ProjectFormProps) {
  const [title, setTitle] = useState(initialValues?.title || '');
  const [owner, setOwner] = useState(initialValues?.owner || '');
  const [startDate, setStartDate] = useState(initialValues?.startDate || '');
  const [endDate, setEndDate] = useState(initialValues?.endDate || '');
  const [statusColor, setStatusColor] = useState(initialValues?.statusColor || STATUS_COLORS[0].hex);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Milestone management state
  const [milestones, setMilestones] = useState<MilestoneData[]>(
    initialMilestones?.map(m => ({
      id: m.id,
      title: m.title,
      description: m.description,
      startDate: m.startDate,
      endDate: m.endDate,
      tags: m.tags,
      statusColor: m.statusColor
    })) || []
  );
  const [showMilestoneForm, setShowMilestoneForm] = useState(false);
  const [editingMilestoneIndex, setEditingMilestoneIndex] = useState<number | null>(null);
  const [milestoneTitle, setMilestoneTitle] = useState('');
  const [milestoneDescription, setMilestoneDescription] = useState('');
  const [milestoneStartDate, setMilestoneStartDate] = useState('');
  const [milestoneEndDate, setMilestoneEndDate] = useState('');
  const [milestoneTags, setMilestoneTags] = useState('');
  const [milestoneColor, setMilestoneColor] = useState(MILESTONE_COLORS[0].hex);
  const [milestoneErrors, setMilestoneErrors] = useState<Record<string, string>>({});

  const resetMilestoneForm = () => {
    setMilestoneTitle('');
    setMilestoneDescription('');
    setMilestoneStartDate(startDate || '');
    setMilestoneEndDate(startDate || '');
    setMilestoneTags('');
    setMilestoneColor(MILESTONE_COLORS[0].hex);
    setMilestoneErrors({});
    setShowMilestoneForm(false);
    setEditingMilestoneIndex(null);
  };

  const handleAddMilestoneClick = () => {
    setMilestoneStartDate(startDate || '');
    setMilestoneEndDate(startDate || '');
    setShowMilestoneForm(true);
    setEditingMilestoneIndex(null);
  };

  const handleEditMilestone = (index: number) => {
    const m = milestones[index];
    setMilestoneTitle(m.title);
    setMilestoneDescription(m.description || '');
    setMilestoneStartDate(m.startDate);
    setMilestoneEndDate(m.endDate);
    setMilestoneTags(m.tags.join(', '));
    setMilestoneColor(m.statusColor);
    setEditingMilestoneIndex(index);
    setShowMilestoneForm(true);
  };

  const handleDeleteMilestone = (index: number) => {
    setMilestones(prev => prev.filter((_, i) => i !== index));
    if (editingMilestoneIndex === index) {
      resetMilestoneForm();
    }
  };

  const handleSaveMilestone = () => {
    const tags = milestoneTags
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const milestoneData = {
      title: milestoneTitle.trim(),
      description: milestoneDescription.trim() || '',
      startDate: milestoneStartDate,
      endDate: milestoneEndDate,
      tags,
      statusColor: milestoneColor
    };

    const result = validateForm(milestoneSchema, milestoneData);
    if (!result.success) {
      setMilestoneErrors(result.errors);
      return;
    }

    if (editingMilestoneIndex !== null) {
      // Update existing milestone
      setMilestones(prev => prev.map((m, i) =>
        i === editingMilestoneIndex
          ? { ...milestoneData, id: m.id }
          : m
      ));
    } else {
      // Add new milestone
      setMilestones(prev => [...prev, milestoneData]);
    }

    resetMilestoneForm();
  };

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
    onSubmit({ ...result.data, milestones });
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
        <label className={styles.label}>Project Status</label>
        <div className={styles.colorPicker}>
          {STATUS_COLORS.map(({ hex, name }) => (
            <div key={hex} className={styles.colorOption}>
              <button
                type="button"
                className={`${styles.colorSwatch} ${statusColor === hex ? styles.selected : ''}`}
                style={{ backgroundColor: hex }}
                onClick={() => setStatusColor(hex)}
                aria-label={`Select ${name} status`}
                title={name}
              />
              <span className={styles.colorLabel}>{name}</span>
            </div>
          ))}
        </div>
        <div className={styles.statusPreview}>
          <div
            className={styles.statusPreviewDot}
            style={{ backgroundColor: statusColor }}
          />
          <span className={styles.statusPreviewText}>
            {STATUS_COLORS.find(c => c.hex === statusColor)?.name || 'Custom'}
          </span>
        </div>
      </div>

      {/* Milestones Section */}
      <div className={styles.milestonesSection}>
        <div className={styles.milestonesSectionHeader}>
          <label className={styles.label}>Milestones</label>
          <span className={styles.hint}>Optional</span>
        </div>

        {/* Existing milestones list */}
        {milestones.length > 0 && (
          <div className={styles.milestonesList}>
            {milestones.map((m, index) => (
              <div key={m.id || index} className={styles.milestoneItem}>
                <div
                  className={styles.milestoneColorDot}
                  style={{ backgroundColor: m.statusColor }}
                />
                <div className={styles.milestoneInfo}>
                  <span className={styles.milestoneTitle}>{m.title}</span>
                  <span className={styles.milestoneDates}>
                    {m.startDate} - {m.endDate}
                  </span>
                </div>
                <div className={styles.milestoneActions}>
                  <button
                    type="button"
                    className={styles.milestoneEditBtn}
                    onClick={() => handleEditMilestone(index)}
                    aria-label="Edit milestone"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.milestoneDeleteBtn}
                    onClick={() => handleDeleteMilestone(index)}
                    aria-label="Delete milestone"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add/Edit milestone form */}
        {showMilestoneForm ? (
          <div className={styles.milestoneFormInline}>
            <div className={styles.field}>
              <label htmlFor="milestoneTitle" className={styles.label}>Title</label>
              <input
                id="milestoneTitle"
                type="text"
                value={milestoneTitle}
                onChange={(e) => setMilestoneTitle(e.target.value)}
                className={styles.input}
                placeholder="Milestone title"
              />
              {milestoneErrors.title && (
                <span className={styles.fieldError}>{milestoneErrors.title}</span>
              )}
            </div>

            <div className={styles.field}>
              <label htmlFor="milestoneDescription" className={styles.label}>
                Description <span className={styles.optional}>(optional)</span>
              </label>
              <textarea
                id="milestoneDescription"
                value={milestoneDescription}
                onChange={(e) => setMilestoneDescription(e.target.value)}
                className={styles.textarea}
                placeholder="Add details..."
                rows={2}
              />
            </div>

            <div className={styles.row}>
              <div className={styles.field}>
                <label htmlFor="milestoneStartDate" className={styles.label}>Start</label>
                <input
                  id="milestoneStartDate"
                  type="date"
                  value={milestoneStartDate}
                  onChange={(e) => setMilestoneStartDate(e.target.value)}
                  className={styles.input}
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="milestoneEndDate" className={styles.label}>End</label>
                <input
                  id="milestoneEndDate"
                  type="date"
                  value={milestoneEndDate}
                  onChange={(e) => {
                    setMilestoneEndDate(e.target.value);
                    setMilestoneErrors(prev => ({ ...prev, endDate: '' }));
                  }}
                  className={styles.input}
                />
              </div>
            </div>
            {milestoneErrors.endDate && (
              <span className={styles.fieldError}>{milestoneErrors.endDate}</span>
            )}

            <div className={styles.field}>
              <label htmlFor="milestoneTags" className={styles.label}>Tags</label>
              <input
                id="milestoneTags"
                type="text"
                value={milestoneTags}
                onChange={(e) => setMilestoneTags(e.target.value)}
                className={styles.input}
                placeholder="Comma-separated tags"
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Status</label>
              <div className={styles.colorPicker}>
                {MILESTONE_COLORS.map(({ hex, name }) => (
                  <div key={hex} className={styles.colorOption}>
                    <button
                      type="button"
                      className={`${styles.colorSwatch} ${milestoneColor === hex ? styles.selected : ''}`}
                      style={{ backgroundColor: hex }}
                      onClick={() => setMilestoneColor(hex)}
                      aria-label={`Select ${name} status`}
                      title={name}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.milestoneFormActions}>
              <button
                type="button"
                onClick={resetMilestoneForm}
                className={styles.cancelBtn}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveMilestone}
                className={styles.submitBtn}
              >
                {editingMilestoneIndex !== null ? 'Update' : 'Add'} Milestone
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleAddMilestoneClick}
            className={styles.addMilestoneBtn}
          >
            + Add Milestone
          </button>
        )}
      </div>

      {showDeleteConfirm && (
        <div className={styles.deleteConfirm}>
          <p>Are you sure you want to delete this project and all its milestones?</p>
          <div className={styles.deleteConfirmActions}>
            <button type="button" onClick={() => setShowDeleteConfirm(false)} className={styles.cancelBtn}>
              Cancel
            </button>
            <button type="button" onClick={onDelete} className={styles.deleteConfirmBtn}>
              Delete Project
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
            {isEditing ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      )}
    </form>
  );
}
