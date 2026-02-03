import { useRef, useEffect, useMemo, useCallback, useState } from 'react';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable';
import type { Project, TeamMember } from '../types';
import { SortableMemberLane } from './SortableMemberLane';
import { DraggableProjectBar } from './DraggableProjectBar';
import { DroppableLane } from './DroppableLane';
import {
  getFYStart,
  getFYEnd,
  getVisibleFYs,
  getTodayPosition
} from '../utils/dateUtils';
import { differenceInDays as dateFnsDiff, addMonths, startOfMonth, format, areIntervalsOverlapping } from 'date-fns';
import styles from './Timeline.module.css';

export type ZoomLevel = 'day' | 'week' | 'month' | 'year';

// Calculate stack indices for non-overlapping projects (flight path algorithm)
function calculateProjectStacks(projects: Project[]): Map<string, number> {
  const stacks = new Map<string, number>();
  if (!projects || projects.length === 0) return stacks;

  // Sort projects by start date, then by end date for consistent ordering
  const sorted = [...projects].sort((a, b) => {
    const startDiff = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    if (startDiff !== 0) return startDiff;
    return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
  });

  sorted.forEach((project) => {
    let stackIndex = 0;
    const projectInterval = {
      start: new Date(project.startDate),
      end: new Date(project.endDate)
    };

    // Find the lowest available stack index where this project doesn't overlap
    while (true) {
      let canUseStack = true;
      for (const [otherId, otherStack] of stacks) {
        if (otherStack !== stackIndex) continue;
        const other = projects.find(p => p.id === otherId);
        if (!other) continue;

        const otherInterval = {
          start: new Date(other.startDate),
          end: new Date(other.endDate)
        };

        // Check if intervals overlap (inclusive for same-day adjacency)
        if (areIntervalsOverlapping(projectInterval, otherInterval, { inclusive: true })) {
          canUseStack = false;
          break;
        }
      }
      if (canUseStack) break;
      stackIndex++;
    }
    stacks.set(project.id, stackIndex);
  });

  return stacks;

}

interface TimelineProps {
  projects: Project[];
  teamMembers: TeamMember[];
  zoomLevel: ZoomLevel;
  onAddProject: (ownerName: string) => void;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => void;
  onDeleteProject: (projectId: string) => void;
  onAddMilestone: (projectId: string) => void;
  onEditProject: (project: Project) => void;
  onEditMilestone: (projectId: string, milestoneId: string) => void;
  onUpdateMilestone: (projectId: string, milestoneId: string, updates: Partial<import('../types').Milestone>) => void;
  onDeleteMilestone: (projectId: string, milestoneId: string) => void;
  onAddTeamMember: () => void;
  onEditTeamMember: (member: TeamMember) => void;
  onReorderTeamMembers: (fromIndex: number, toIndex: number) => void;
}

const ZOOM_DAY_WIDTHS: Record<ZoomLevel, number> = {
  day: 30,
  week: 8,
  month: 3,
  year: 0.8
};

const PROJECT_HEIGHT = 68; // Height including spacing between projects
const LANE_PADDING = 12;
const MIN_LANE_HEIGHT = 80;

export function Timeline({
  projects,
  teamMembers,
  zoomLevel,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
  onAddMilestone,
  onEditProject,
  onEditMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onAddTeamMember,
  onEditTeamMember,
  onReorderTeamMembers
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dayWidth = ZOOM_DAY_WIDTHS[zoomLevel];

  // DnD sensors with activation constraint for responsive feel
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8 // Require 8px movement before drag starts
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );

  // Handler for team member reordering
  const handleMemberDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = teamMembers.findIndex(m => m.id === active.id);
      const newIndex = teamMembers.findIndex(m => m.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onReorderTeamMembers(oldIndex, newIndex);
      }
    }
  };

  // Handler for project drag to different lanes
  const handleProjectDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    // Check if dragging a project onto a lane
    if (activeData?.type === 'project' && overData?.type === 'lane') {
      const project = activeData.project as Project;
      const newOwner = overData.memberName as string;

      // Only update if the owner changed
      if (project.owner !== newOwner) {
        onUpdateProject(project.id, { owner: newOwner });
      }
    }
  }, [onUpdateProject]);

  const { timelineStart, timelineEnd, visibleFYs } = useMemo(() => {
    // All views now show January 2025 to December 2030
    const start = new Date(2025, 0, 1); // January 1, 2025
    const end = new Date(2030, 11, 31); // December 31, 2030
    const fys = getVisibleFYs(2025, 6); // FY2025 to FY2030
    return { timelineStart: start, timelineEnd: end, visibleFYs: fys };
  }, []);

  const totalDays = dateFnsDiff(timelineEnd, timelineStart);
  const totalWidth = totalDays * dayWidth;

  const fySegments = useMemo(() => {
    return visibleFYs.map(fy => {
      const start = getFYStart(fy);
      const end = getFYEnd(fy);
      const startPos = Math.max(0, dateFnsDiff(start, timelineStart)) * dayWidth;
      const endPos = Math.min(totalWidth, dateFnsDiff(end, timelineStart) * dayWidth + dayWidth);
      return { fy, left: startPos, width: endPos - startPos };
    }).filter(seg => seg.width > 0);
  }, [visibleFYs, timelineStart, dayWidth, totalWidth]);

  const monthMarkers = useMemo(() => {
    if (zoomLevel === 'year') return [];
    const markers: { label: string; left: number }[] = [];
    let current = startOfMonth(timelineStart);
    while (current < timelineEnd) {
      const left = dateFnsDiff(current, timelineStart) * dayWidth;
      if (left >= 0 && left < totalWidth) {
        markers.push({ label: format(current, 'MMM yyyy'), left });
      }
      current = addMonths(current, 1);
    }
    return markers;
  }, [zoomLevel, timelineStart, timelineEnd, dayWidth, totalWidth]);

  const todayPosition = getTodayPosition(timelineStart, dayWidth);

  useEffect(() => {
    if (scrollRef.current) {
      // Scroll to show today with some padding on the left
      const todayPos = todayPosition - 200; // 200px padding from left
      scrollRef.current.scrollLeft = Math.max(0, todayPos);
    }
  }, [zoomLevel, todayPosition]);

  const handleWheel = (e: React.WheelEvent) => {
    if (scrollRef.current && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scrollRef.current.scrollLeft += e.deltaY;
    }
  };

  // Click-drag panning state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, scrollLeft: 0 });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start pan if clicking on empty area (not on projects/milestones)
    const target = e.target as HTMLElement;
    if (target.closest('[data-draggable]') || target.closest('button')) return;

    if (scrollRef.current) {
      setIsPanning(true);
      setPanStart({
        x: e.clientX,
        scrollLeft: scrollRef.current.scrollLeft
      });
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning || !scrollRef.current) return;
    const dx = e.clientX - panStart.x;
    scrollRef.current.scrollLeft = panStart.scrollLeft - dx;
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Group projects by owner
  const projectsByOwner = useMemo(() => {
    const grouped: Record<string, Project[]> = {};
    teamMembers.forEach(m => { grouped[m.name] = []; });
    projects.forEach(p => {
      if (grouped[p.owner]) {
        grouped[p.owner].push(p);
      }
    });
    return grouped;
  }, [projects, teamMembers]);

  // Calculate project stacks for each owner (flight path algorithm)
  const projectStacksByOwner = useMemo(() => {
    const stacksByOwner: Record<string, Map<string, number>> = {};
    teamMembers.forEach(m => {
      const ownerProjects = projectsByOwner[m.name] || [];
      stacksByOwner[m.name] = calculateProjectStacks(ownerProjects);
    });
    return stacksByOwner;
  }, [teamMembers, projectsByOwner]);

  // Calculate lane heights based on max stack index (not project count)
  const laneHeights = useMemo(() => {
    return teamMembers.map(member => {
      const stacks = projectStacksByOwner[member.name];
      const maxStack = stacks && stacks.size > 0 ? Math.max(...stacks.values()) : -1;
      const rowCount = maxStack + 1; // Number of rows needed
      const height = Math.max(MIN_LANE_HEIGHT, rowCount * PROJECT_HEIGHT + LANE_PADDING * 2);
      return height;
    });
  }, [teamMembers, projectStacksByOwner]);

  // Calculate cumulative lane positions
  const lanePositions = useMemo(() => {
    const positions: number[] = [];
    let cumulative = 0;
    laneHeights.forEach(height => {
      positions.push(cumulative);
      cumulative += height;
    });
    return positions;
  }, [laneHeights]);

  const totalLanesHeight = lanePositions.length > 0
    ? lanePositions[lanePositions.length - 1] + laneHeights[laneHeights.length - 1]
    : 0;

  return (
    <div className={styles.container}>
      {/* Fixed left sidebar with team members */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>Team</div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleMemberDragEnd}
        >
          <SortableContext
            items={teamMembers.map(m => m.id)}
            strategy={verticalListSortingStrategy}
          >
            {teamMembers.map((member, idx) => (
              <SortableMemberLane
                key={member.id}
                member={member}
                height={laneHeights[idx]}
                onEdit={() => onEditTeamMember(member)}
                onAddProject={() => onAddProject(member.name)}
              />
            ))}
          </SortableContext>
        </DndContext>
        <button className={styles.addMemberBtn} onClick={onAddTeamMember}>
          + Add Team Member
        </button>
      </div>

      {/* Scrollable timeline */}
      <div className={styles.timelineWrapper}>
        <div
          ref={scrollRef}
          className={`${styles.scrollContainer} ${isPanning ? styles.panning : ''}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {/* Header */}
          <div className={styles.header} style={{ width: totalWidth }}>
            {zoomLevel === 'year' ? (
              fySegments.map(({ fy, left, width }) => (
                <div key={fy} className={styles.fyHeader} style={{ left, width }}>
                  <span className={styles.fyLabel}>FY{fy}</span>
                </div>
              ))
            ) : (
              monthMarkers.map(({ label, left }, i) => (
                <div key={i} className={styles.monthHeader} style={{ left }}>
                  <span className={styles.monthLabel}>{label}</span>
                </div>
              ))
            )}
          </div>

          {/* Lanes */}
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragEnd={handleProjectDragEnd}
          >
            <div className={styles.lanes} style={{ width: totalWidth, minHeight: totalLanesHeight }}>
              {/* Grid lines */}
              {zoomLevel === 'year' && fySegments.map(({ fy, left, width }) => (
                <div key={`q-${fy}`}>
                  {[0, 1, 2, 3].map(q => (
                    <div key={q} className={styles.gridLine} style={{ left: left + (width / 4) * q }} />
                  ))}
                </div>
              ))}
              {zoomLevel === 'month' && monthMarkers.map(({ left }, i) => (
                <div key={i} className={styles.gridLine} style={{ left }} />
              ))}

              {/* Today line */}
              {todayPosition >= 0 && todayPosition <= totalWidth && (
                <div className={styles.todayLine} style={{ left: todayPosition }}>
                  <div className={styles.todayLabel}>Today</div>
                </div>
              )}

              {/* Project lanes */}
              {teamMembers.map((member, idx) => {
                const stacks = projectStacksByOwner[member.name];
                return (
                  <DroppableLane
                    key={member.id}
                    id={`lane-${member.id}`}
                    memberName={member.name}
                    top={lanePositions[idx]}
                    height={laneHeights[idx]}
                  >
                    {projectsByOwner[member.name]?.map((project) => (
                      <DraggableProjectBar
                        key={project.id}
                        project={project}
                        timelineStart={timelineStart}
                        dayWidth={dayWidth}
                        stackIndex={stacks?.get(project.id) ?? 0}
                        onUpdate={(updates) => onUpdateProject(project.id, updates)}
                        onDelete={() => onDeleteProject(project.id)}
                        onAddMilestone={() => onAddMilestone(project.id)}
                        onEdit={() => onEditProject(project)}
                        onEditMilestone={(mid) => onEditMilestone(project.id, mid)}
                        onUpdateMilestone={(mid, updates) => onUpdateMilestone(project.id, mid, updates)}
                        onDeleteMilestone={(mid) => onDeleteMilestone(project.id, mid)}
                      />
                    ))}
                  </DroppableLane>
                );
              })}
            </div>
          </DndContext>
        </div>
      </div>
    </div>
  );
}
