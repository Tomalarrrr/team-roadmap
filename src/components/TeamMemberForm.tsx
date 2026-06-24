import { useState } from 'react';
import { teamMemberSchema, validateForm } from '../utils/validation';
import styles from './Form.module.css';

interface TeamMemberFormProps {
  initialValues?: {
    name: string;
    jobTitle: string;
  };
  onSubmit: (values: { name: string; jobTitle: string }) => void | Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
  onAddProject?: () => void; // Open the new-project form for this member
  isEditing?: boolean;
  projectCount?: number; // Number of projects owned by this member (for delete warning)
}

export function TeamMemberForm({
  initialValues,
  onSubmit,
  onCancel,
  onDelete,
  onAddProject,
  isEditing = false,
  projectCount = 0
}: TeamMemberFormProps) {
  const [name, setName] = useState(initialValues?.name || '');
  const [jobTitle, setJobTitle] = useState(initialValues?.jobTitle || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isSaving) return;

    const result = validateForm(teamMemberSchema, {
      name: name.trim(),
      jobTitle: jobTitle.trim()
    });

    if (!result.success) {
      setErrors(result.errors);
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
