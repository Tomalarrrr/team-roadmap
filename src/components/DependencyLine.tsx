import { useMemo } from 'react';
import type { Project } from '../types';
import { getBarDimensions } from '../utils/dateUtils';

interface DependencyLineProps {
  fromProject: Project;
  toProject: Project;
  timelineStart: Date;
  dayWidth: number;
  projectStacks: Map<string, number>;
  onRemove: () => void;
}

const PROJECT_HEIGHT = 68;
const BAR_VERTICAL_OFFSET = 8;
const BAR_HEIGHT = 52;

export function DependencyLine({
  fromProject,
  toProject,
  timelineStart,
  dayWidth,
  projectStacks,
  onRemove
}: DependencyLineProps) {
  const line = useMemo(() => {
    const fromDims = getBarDimensions(
      fromProject.startDate,
      fromProject.endDate,
      timelineStart,
      dayWidth
    );
    const toDims = getBarDimensions(
      toProject.startDate,
      toProject.endDate,
      timelineStart,
      dayWidth
    );

    const fromStack = projectStacks.get(fromProject.id) || 0;
    const toStack = projectStacks.get(toProject.id) || 0;

    // Calculate positions
    const fromX = fromDims.left + fromDims.width; // End of from project
    const fromY = BAR_VERTICAL_OFFSET + fromStack * PROJECT_HEIGHT + BAR_HEIGHT / 2;
    const toX = toDims.left; // Start of to project
    const toY = BAR_VERTICAL_OFFSET + toStack * PROJECT_HEIGHT + BAR_HEIGHT / 2;

    // Create smooth bezier curve
    const midX = (fromX + toX) / 2;
    const controlOffset = Math.min(Math.abs(toX - fromX) * 0.4, 80);

    return {
      fromX,
      fromY,
      toX,
      toY,
      path: `M ${fromX} ${fromY} C ${fromX + controlOffset} ${fromY}, ${toX - controlOffset} ${toY}, ${toX} ${toY}`,
      midX,
      midY: (fromY + toY) / 2
    };
  }, [fromProject, toProject, timelineStart, dayWidth, projectStacks]);

  return (
    <g className="dependency-line" style={{ pointerEvents: 'auto' }}>
      {/* Main line */}
      <path
        d={line.path}
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
        strokeDasharray="4 3"
        opacity="0.5"
        style={{ transition: 'opacity 0.15s, stroke 0.15s' }}
      />
      {/* Arrow head */}
      <polygon
        points={`${line.toX},${line.toY} ${line.toX - 8},${line.toY - 4} ${line.toX - 8},${line.toY + 4}`}
        fill="var(--text-muted)"
        opacity="0.5"
      />
      {/* Invisible wider path for easier interaction */}
      <path
        d={line.path}
        fill="none"
        stroke="transparent"
        strokeWidth="12"
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      />
      {/* Hover indicator dot */}
      <circle
        cx={line.midX}
        cy={line.midY}
        r="0"
        fill="var(--accent-blue)"
        className="dependency-remove-indicator"
        style={{ transition: 'r 0.15s' }}
      />
      <style>{`
        .dependency-line:hover path {
          opacity: 0.8 !important;
          stroke: var(--accent-blue) !important;
        }
        .dependency-line:hover polygon {
          opacity: 0.8 !important;
          fill: var(--accent-blue) !important;
        }
        .dependency-line:hover .dependency-remove-indicator {
          r: 6px;
        }
      `}</style>
    </g>
  );
}
