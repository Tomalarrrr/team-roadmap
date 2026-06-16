import { useMemo, useState } from 'react';
import { format, addDays } from 'date-fns';
import { projectSchema, validateForm } from '../utils/validation';
import { STATUS_COLORS, DEFAULT_STATUS_COLOR, normalizeStatusColor } from '../utils/statusColors';
import {
  SIZE_LABELS,
  SIZE_SLOTS,
  heightForSize,
  evaluateAssignment,
  formatCapacityMessage,
  isCapacityExempt,
  type CapacityItem,
} from '../utils/capacity';
import type { Milestone, Project, ProjectSize, TeamMember } from '../types';
import styles from './Form.module.css';

const SIZE_OPTIONS: ProjectSize[] = ['large', 'medium', 'small'];

interface ProjectFormProps {
  initialValues?: Partial<{
    title: string;
    owner: string;
    startDate: string;
    endDate: string;
    statusColor: string;
    size: ProjectSize;
  }>;
  // Existing milestones are preserved untouched on submit (no longer editable in the UI).
  initialMilestones?: Milestone[];
  teamMembers?: TeamMember[];
  // All projects on the board — used to enforce per-member capacity (4 slots).
  projects?: Project[];
  // When editing, the project's own id so it isn't counted against its owner's capacity.
  editingProjectId?: string;
  onSubmit: (values: {
    title: string;
    owner: string;
    startDate: string;
    endDate: string;
    statusColor: string;
    size: ProjectSize;
    milestones?: Milestone[];
  }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  isEditing?: boolean;
  hideOwner?: boolean;
}

export function ProjectForm({
  initialValues,
  initialMilestones,
  teamMembers,
  projects,
  editingProjectId,
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
  const [statusColor, setStatusColor] = useState(normalizeStatusColor(initialValues?.statusColor || DEFAULT_STATUS_COLOR));
  const [size, setSize] = useState<ProjectSize>(initialValues?.size || 'medium');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Projects grouped by owner for the capacity engine.
  const projectsByOwner = useMemo(() => {
    const grouped: Record<string, CapacityItem[]> = {};
    (projects ?? []).forEach(p => {
      // The Digital Queue is exempt — it never counts toward an owner's load.
      if (isCapacityExempt(p)) return;
      (grouped[p.owner] ??= []).push(p);
    });
    return grouped;
  }, [projects]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSaving) return;

    const result = validateForm(projectSchema, {
      title: title.trim(),
      owner: owner.trim(),
      startDate,
      endDate,
      statusColor,
      size
    });

    if (!result.success) {
      setErrors(result.errors);
      return;
    }

    // Hard-block over-capacity assignments. Skipped when we have no board
    // context to check against (e.g. the form rendered without `projects`), or
    // when this project itself is exempt (the Digital Queue consumes no slots).
    if (projects && !isCapacityExempt(result.data)) {
      const candidate: CapacityItem = {
        id: editingProjectId ?? '__new__',
        startDate: result.data.startDate,
        endDate: result.data.endDate,
        size: result.data.size,
      };
      const verdict = evaluateAssignment(projectsByOwner, candidate, result.data.owner);
      if (!verdict.fits) {
        setErrors({});
        setCapacityError(formatCapacityMessage(verdict, result.data.owner, result.data.size) ?? 'Over capacity.');
        return;
      }
    }

    setErrors({});
    setCapacityError(null);
    setIsSaving(true);

    try {
      // Preserve any existing milestone data untouched — milestones are no longer edited here.
      await onSubmit({ ...result.data, milestones: initialMilestones });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`${styles.form} ${isSaving ? styles.formSaving : ''}`}>
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
            onChange={(e) => { setOwner(e.target.value); setCapacityError(null); }}
            className={styles.input}
            placeholder="Enter owner name"
            list="owner-suggestions"
            autoComplete="off"
            required
          />
          {teamMembers && teamMembers.length > 0 && (
            <datalist id="owner-suggestions">
              {teamMembers.map(member => (
                <option key={member.id} value={member.name} />
              ))}
            </datalist>
          )}
        </div>
      )}

      <div className={styles.row}>
        <div className={styles.field}>
          <label htmlFor="startDate" className={styles.label}>Start Date</label>
          <input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setCapacityError(null); }}
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
            min={startDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setErrors({});
              setCapacityError(null);
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

      <div className={styles.field}>
        <label className={styles.label}>Project Size</label>
        <div className={styles.sizePicker}>
          {SIZE_OPTIONS.map(opt => (
            <button
              key={opt}
              type="button"
              className={`${styles.sizeOption} ${size === opt ? styles.selected : ''}`}
              onClick={() => { setSize(opt); setCapacityError(null); }}
              aria-pressed={size === opt}
            >
              <span className={styles.sizeOptionBar} style={{ height: heightForSize(opt) / 2 }} />
              <span className={styles.sizeOptionName}>{SIZE_LABELS[opt]}</span>
              <span className={styles.sizeOptionSlots}>
                {SIZE_SLOTS[opt]} slot{SIZE_SLOTS[opt] === 1 ? '' : 's'}
              </span>
            </button>
          ))}
        </div>
      </div>

      {Object.keys(errors).length > 0 && (
        <div className={styles.error}>
          {Object.values(errors).join('. ')}
        </div>
      )}

      {capacityError && (
        <div className={styles.capacityWarning}>
          {capacityError}
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

      {showDeleteConfirm && (
        <div className={styles.deleteConfirm}>
          <p>Are you sure you want to delete this project?</p>
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
          <button type="submit" className={styles.submitBtn} disabled={isSaving}>
            {isSaving ? (
              <>
                <span className={styles.spinner} />
                Saving...
              </>
            ) : (
              isEditing ? 'Save Changes' : 'Create Project'
            )}
          </button>
        </div>
      )}
    </form>
  );
}
