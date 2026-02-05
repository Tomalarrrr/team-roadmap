import { useEffect, useCallback, useRef } from 'react';
import { useDependencyCreation } from '../contexts/DependencyCreationContext';
import styles from './DependencyCreationOverlay.module.css';

interface DependencyCreationOverlayProps {
  containerRef: React.RefObject<HTMLElement | null>;
  scrollRef: React.RefObject<HTMLElement | null>;
}

export function DependencyCreationOverlay({
  containerRef,
  scrollRef
}: DependencyCreationOverlayProps) {
  const { state, updateCursorPosition, cancelCreation } = useDependencyCreation();
  const rafRef = useRef<number | null>(null);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!state.isCreating || !containerRef.current || !scrollRef.current) return;

    // Throttle updates with requestAnimationFrame
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }

    rafRef.current = requestAnimationFrame(() => {
      const scrollContainerRect = scrollRef.current?.getBoundingClientRect();
      const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
      const scrollTop = scrollRef.current?.scrollTop ?? 0;

      if (scrollContainerRect) {
        // Use scrollContainerRect as a stable reference that doesn't change when scrolling.
        // When scrolled, the content moves but scrollContainerRect stays fixed.
        // Adding scroll values converts viewport coords to content coords.

        // For X: scrollContainerRect.left is stable regardless of horizontal scroll
        const cursorX = e.clientX - scrollContainerRect.left + scrollLeft;

        // For Y: account for the sticky header (48px) that stays at the top
        const HEADER_HEIGHT = 48;
        const cursorY = e.clientY - scrollContainerRect.top - HEADER_HEIGHT + scrollTop;

        updateCursorPosition({
          x: cursorX,
          y: cursorY
        });
      }
    });
  }, [state.isCreating, containerRef, scrollRef, updateCursorPosition]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape' && state.isCreating) {
      cancelCreation();
    }
  }, [state.isCreating, cancelCreation]);

  const handleClick = useCallback((e: MouseEvent) => {
    // Only cancel if clicking on the overlay background (not on a pill)
    const target = e.target as HTMLElement;
    if (target.closest('[data-dependency-target]')) {
      return; // Let the pill handle it
    }
    if (state.isCreating) {
      cancelCreation();
    }
  }, [state.isCreating, cancelCreation]);

  useEffect(() => {
    if (!state.isCreating) return;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('keydown', handleKeyDown);
    // Use capture phase for click to detect clicks on empty space
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClick, true);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [state.isCreating, handleMouseMove, handleKeyDown, handleClick]);

  if (!state.isCreating || !state.source || !state.cursorPosition) {
    return null;
  }

  const { source, cursorPosition } = state;

  // Simple straight line from source to cursor
  const path = `M ${source.position.x} ${source.position.y} L ${cursorPosition.x} ${cursorPosition.y}`;

  // Arrow head pointing in the direction of travel
  const angle = Math.atan2(
    cursorPosition.y - source.position.y,
    cursorPosition.x - source.position.x
  );
  const arrowSize = 8;
  const arrowPoints = [
    { x: cursorPosition.x, y: cursorPosition.y },
    {
      x: cursorPosition.x - arrowSize * Math.cos(angle - Math.PI / 6),
      y: cursorPosition.y - arrowSize * Math.sin(angle - Math.PI / 6)
    },
    {
      x: cursorPosition.x - arrowSize * Math.cos(angle + Math.PI / 6),
      y: cursorPosition.y - arrowSize * Math.sin(angle + Math.PI / 6)
    }
  ];
  const arrowPath = `${arrowPoints[0].x},${arrowPoints[0].y} ${arrowPoints[1].x},${arrowPoints[1].y} ${arrowPoints[2].x},${arrowPoints[2].y}`;

  return (
    <svg className={styles.overlay}>
      {/* Preview line */}
      <path
        d={path}
        fill="none"
        stroke="var(--accent-blue)"
        strokeWidth="2"
        strokeDasharray="6 4"
        className={styles.previewLine}
      />
      {/* Arrow head */}
      <polygon
        points={arrowPath}
        fill="var(--accent-blue)"
        className={styles.arrowHead}
      />
      {/* Source indicator dot */}
      <circle
        cx={source.position.x}
        cy={source.position.y}
        r="4"
        fill="var(--accent-blue)"
        className={styles.sourceDot}
      />
    </svg>
  );
}
