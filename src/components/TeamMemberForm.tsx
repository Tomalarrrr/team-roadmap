import { useState } from 'react';
import { teamMemberSchema, validateForm } from '../utils/validation';
import { CAPACITY, capacityOfMember } from '../utils/capacity';
import { isNameTaken } from '../utils/teamMembers';
import styles from './Form.module.css';

interface TeamMemberFormProps {
  initialValues?: {
    name: string;
    jobTitle: string;
    left?: boolean;
    capacity?: number;
  };
  onSubmit: (values: { name: string; jobTitle: string; left?: boolean; capacity?: number }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  onAddProject?: () => void; // Open the new-project form for this member
  isEditing?: boolean;
  projectCount?: number; // Number of projects owned by this member (for delete warning)
  // Everyone else on the board. Projects find their owner by name, so two
  // people sharing one would share each other's projects.
  otherNames: string[];
}

export function TeamMemberForm({
  initialValues,
  onSubmit,
  onCancel,
  onDelete,
  onAddProject,
  isEditing = false,
  projectCount = 0,
  otherNames
}: TeamMemberFormProps) {
  const [name, setName] = useState(initialValues?.name || '');
  const [jobTitle, setJobTitle] = useState(initialValues?.jobTitle || '');
  const [left, setLeft] = useState(initialValues?.left === true);
  const [capacity, setCapacity] = useState(capacityOfMember(initialValues ?? {}));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSaving) return;

    const result = validateForm(teamMemberSchema, {
      name: name.trim(),
      jobTitle: jobTitle.trim(),
      // Only an existing member can have left, and an untouched box on someone
      // who never left writes nothing.
      ...(isEditing && left !== (initialValues?.left === true) ? { left } : {}),
      // Written only when it differs from what the member has, so someone on
      // the full four slots keeps no capacity field at all.
      ...(capacity !== capacityOfMember(initialValues ?? {}) ? { capacity } : {})
    });

    if (!result.success) {
      setErrors(result.errors);
      return;
    }

    if (isNameTaken(result.data.name, otherNames)) {
      setErrors({ name: 'Someone on the board already has this name' });
      return;
    }

    setErrors({});
    setIsSaving(true);

    try {
      await onSubmit(result.data);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = () => {
    if (projectCount > 0) {
      setShowDeleteConfirm(true);
    } else {
      onDelete?.();
    }
  };

  return (
    <form onSubmit={handleSubmit} className={`${styles.form} ${isSaving ? styles.formSaving : ''}`}>
      <div className={styles.field}>
        <label htmlFor="name" className={styles.label}>Name</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (errors.name) setErrors(prev => ({ ...prev, name: '' }));
          }}
          className={`${styles.input} ${errors.name ? styles.inputError : ''}`}
          placeholder="Enter name"
          autoFocus
        />
        {errors.name && <span className={styles.fieldError}>{errors.name}</span>}
      </div>

      <div className={styles.field}>
        <label htmlFor="jobTitle" className={styles.label}>Job Title</label>
        <input
          id="jobTitle"
          type="text"
          value={jobTitle}
          onChange={(e) => {
            setJobTitle(e.target.value);
            if (errors.jobTitle) setErrors(prev => ({ ...prev, jobTitle: '' }));
          }}
          className={`${styles.input} ${errors.jobTitle ? styles.inputError : ''}`}
          placeholder="Enter job title"
        />
        {errors.jobTitle && <span className={styles.fieldError}>{errors.jobTitle}</span>}
      </div>

      <div className={styles.field}>
        <label htmlFor="member-capacity" className={styles.label}>Capacity</label>
        <select
          id="member-capacity"
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value))}
          className={styles.input}
        >
          {Array.from({ length: CAPACITY }, (_, i) => CAPACITY - i).map(n => (
            <option key={n} value={n}>{n === CAPACITY ? `${n} slots (full time)` : `${n} of ${CAPACITY} slots`}</option>
          ))}
        </select>
        <span className={styles.hint}>How much project work they can carry at once. A small project takes 1 slot, a full-time one takes 4.</span>
      </div>

      {isEditing && (
        <label className={styles.checkRow} htmlFor="member-left">
          <input
            id="member-left"
            type="checkbox"
            checked={left}
            onChange={(e) => setLeft(e.target.checked)}
          />
          <span>
            Has left the team
            <span className={styles.checkHint}>Their lane moves to the bottom and greys out. Their projects stay on the board.</span>
          </span>
        </label>
      )}

      {showDeleteConfirm && (
        <div className={styles.deleteConfirm}>
          <p>This will also delete <strong>{projectCount} project{projectCount !== 1 ? 's' : ''}</strong> owned by {initialValues?.name}.</p>
          <div className={styles.deleteConfirmActions}>
            <button type="button" onClick={() => setShowDeleteConfirm(false)} className={styles.cancelBtn}>
              Cancel
            </button>
            <button type="button" onClick={onDelete} className={styles.deleteConfirmBtn}>
              Delete Member & Projects
            </button>
          </div>
        </div>
      )}

      {!showDeleteConfirm && (
        <div className={styles.actions}>
          {isEditing && onDelete && (
            <button type="button" onClick={handleDeleteClick} className={styles.deleteBtn}>
              Delete
            </button>
          )}
          {isEditing && onAddProject && (
            <button type="button" onClick={onAddProject} className={styles.secondaryBtn}>
              + Add a project
            </button>
          )}
          <div style={{ flex: 1 }} />
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
              isEditing ? 'Save' : 'Add Member'
            )}
          </button>
        </div>
      )}
    </form>
  );
}
