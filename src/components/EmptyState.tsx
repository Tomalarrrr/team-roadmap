import styles from './EmptyState.module.css';

export type EmptyStateType =
  | 'no-projects'
  | 'no-team-members'
  | 'no-search-results'
  | 'no-milestones'
  | 'no-dependencies';

interface EmptyStateProps {
  type: EmptyStateType;
  onAction?: () => void;
  searchQuery?: string;
}

const EMPTY_STATE_CONFIG: Record<EmptyStateType, {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
}> = {
  'no-projects': {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="6" y="14" width="36" height="28" rx="3" />
        <path d="M14 14V10a4 4 0 014-4h12a4 4 0 014 4v4" />
        <path d="M18 26h12M18 34h8" />
      </svg>
    ),
    title: 'No projects yet',
    description: 'Your roadmap is a blank canvas. Create your first project to get started.',
    actionLabel: 'Create Project'
  },
  'no-team-members': {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="24" cy="16" r="8" />
        <path d="M8 42c0-8.837 7.163-16 16-16s16 7.163 16 16" />
        <path d="M36 20l6 6m0-6l-6 6" strokeLinecap="round" />
      </svg>
    ),
    title: 'No team members',
    description: 'Add team members to assign projects and track who is working on what.',
    actionLabel: 'Add Team Member'
  },
  'no-search-results': {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="20" cy="20" r="12" />
        <path d="M29 29l10 10" strokeLinecap="round" />
        <path d="M15 20h10M20 15v10" strokeLinecap="round" opacity="0.5" />
      </svg>
    ),
    title: 'No results found',
    description: 'Try adjusting your search or filters to find what you\'re looking for.'
  },
  'no-milestones': {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M8 24h32" />
        <circle cx="16" cy="24" r="4" fill="currentColor" opacity="0.2" />
        <circle cx="32" cy="24" r="4" fill="currentColor" opacity="0.2" />
        <path d="M24 16v16" strokeDasharray="4 4" opacity="0.5" />
      </svg>
    ),
    title: 'No milestones',
    description: 'Break this project into milestones to track progress along the way.',
    actionLabel: 'Add Milestone'
  },
  'no-dependencies': {
    icon: (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="6" y="8" width="14" height="10" rx="2" />
        <rect x="28" y="30" width="14" height="10" rx="2" />
        <path d="M20 13h4a4 4 0 014 4v14a4 4 0 004 4h0" strokeDasharray="4 4" />
      </svg>
    ),
    title: 'No dependencies',
    description: 'Link related projects to visualize how work flows together.'
  }
};

export function EmptyState({ type, onAction, searchQuery }: EmptyStateProps) {
  const config = EMPTY_STATE_CONFIG[type];

  // Customize message for search results
  const description = type === 'no-search-results' && searchQuery
    ? `No results for "${searchQuery}". Try adjusting your search or filters.`
    : config.description;

  return (
    <div className={styles.container}>
      <div className={styles.icon}>{config.icon}</div>
      <h3 className={styles.title}>{config.title}</h3>
      <p className={styles.description}>{description}</p>
      {config.actionLabel && onAction && (
        <button className={styles.actionBtn} onClick={onAction}>
          {config.actionLabel}
        </button>
      )}
    </div>
  );
}
