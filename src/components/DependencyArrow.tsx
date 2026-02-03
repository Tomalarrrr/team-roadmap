import { useCallback } from 'react';
import styles from './DependencyArrow.module.css';

interface DependencyArrowProps {
  isVisible: boolean;
  isCreatingDependency: boolean;
  onStartDependency: (e: React.MouseEvent) => void;
}

export function DependencyArrow({
  isVisible,
  isCreatingDependency,
  onStartDependency
}: DependencyArrowProps) {
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onStartDependency(e);
  }, [onStartDependency]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (isCreatingDependency) return null;

  return (
    <button
      className={`${styles.dependencyArrow} ${isVisible ? styles.visible : ''}`}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      title="Create dependency"
      aria-label="Create dependency to another project or milestone"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M2 6H10M10 6L7 3M10 6L7 9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
