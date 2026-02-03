import { useState } from 'react';
import styles from './Form.module.css';

interface TeamMemberFormProps {
  initialValues?: {
    name: string;
    jobTitle: string;
  };
  onSubmit: (values: { name: string; jobTitle: string }) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isEditing?: boolean;
}

export function TeamMemberForm({
  initialValues,
  onSubmit,
  onCancel,
  onDelete,
  isEditing = false
}: TeamMemberFormProps) {
  const [name, setName] = useState(initialValues?.name || '');
  const [jobTitle, setJobTitle] = useState(initialValues?.jobTitle || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !jobTitle.trim()) return;
    onSubmit({ name: name.trim(), jobTitle: jobTitle.trim() });
  };

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="name" className={styles.label}>Name</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={styles.input}
          placeholder="Enter name"
          autoFocus
          required
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="jobTitle" className={styles.label}>Job Title</label>
        <input
          id="jobTitle"
          type="text"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          className={styles.input}
          placeholder="Enter job title"
          required
        />
      </div>

      <div className={styles.actions}>
        {isEditing && onDelete && (
          <button type="button" onClick={onDelete} className={styles.deleteBtn}>
            Delete
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button type="button" onClick={onCancel} className={styles.cancelBtn}>
          Cancel
        </button>
        <button type="submit" className={styles.submitBtn}>
          {isEditing ? 'Save' : 'Add Member'}
        </button>
      </div>
    </form>
  );
}
