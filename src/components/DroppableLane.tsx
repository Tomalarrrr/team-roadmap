import { useDroppable } from '@dnd-kit/core';
import type { ReactNode } from 'react';
import styles from './Timeline.module.css';

interface DroppableLaneProps {
  id: string;
  memberName: string;
  top: number;
  height: number;
  children: ReactNode;
}

export function DroppableLane({ id, memberName, top, height, children }: DroppableLaneProps) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: 'lane',
      memberName
    }
  });

  return (
    <div
      ref={setNodeRef}
      className={`${styles.lane} ${isOver ? styles.laneOver : ''}`}
      style={{ top, height }}
      data-member={memberName}
    >
      {children}
    </div>
  );
}
