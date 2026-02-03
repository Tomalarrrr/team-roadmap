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
import type { Project, TeamMember, Dependency } from '../types';
import { SortableMemberLane } from './SortableMemberLane';
import { DraggableProjectBar } from './DraggableProjectBar';
import { DroppableLane } from './DroppableLane';
import { DependencyLine } from './DependencyLine';
import { DependencyCreationOverlay } from './DependencyCreationOverlay';
import { DependencyCreationProvider } from '../contexts/DependencyCreationContext';
import {
  getFYStart,
  getFYEnd,
  getVisibleFYs,
  getTodayPosition,
  getBarDimensions
} from '../utils/dateUtils';
import { differenceInDays as dateFnsDiff, addMonths, startOfMonth, format } from 'date-fns';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import styles from './Timeline.module.css';

export type ZoomLevel = 'day' | 'week' | 'month' | 'year';

// Calculate stack indices for non-overlapping projects (optimized flight path algorithm)
// Time complexity: O(n log n) instead of O(n²)
function calculateProjectStacks(projects: Project[]): Map<string, number> {
  const stacks = new Map<string, number>();
  if (!projects || projects.length === 0) return stacks;

  // Sort projects by start date, then by end date for consistent ordering
  const sorted = [...projects].sort((a, b) => {
    const startDiff = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    if (startDiff !== 0) return startDiff;
    return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
  });

  // Track the end time of the last project in each stack (for O(1) availability check)
  const stackEndTimes: number[] = [];

  sorted.forEach((project) => {
    const projectStart = new Date(project.startDate).getTime();
    const projectEnd = new Date(project.endDate).getTime();

    // Find the lowest available stack where this project fits
    // A stack is available if its last project ended before this one starts
    let stackIndex = -1;
    for (let i = 0; i < stackEndTimes.length; i++) {
      // Allow same-day adjacency (end < start, not <=)
      if (stackEndTimes[i] < projectStart) {
        stackIndex = i;
        break;
      }
    }

    // No available stack found, create a new one
    if (stackIndex === -1) {
      stackIndex = stackEndTimes.length;
      stackEndTimes.push(projectEnd);
    } else {
      stackEndTimes[stackIndex] = projectEnd;
    }

    stacks.set(project.id, stackIndex);
  });

  return stacks;
}

interface TimelineProps {
  projects: Project[];
  teamMembers: TeamMember[];
  dependencies: Dependency[];
  zoomLevel: ZoomLevel;
  selectedProjectId?: string | null;
  filteredOwners?: string[]; // When set, only show swimlanes for these owners
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
  onCopyProject?: (project: Project) => void;
  onAddDependency?: (
    fromProjectId: string,
    toProjectId: string,
    fromMilestoneId?: string,
    toMilestoneId?: string
  ) => void;
  onRemoveDependency?: (depId: string) => void;
}

const ZOOM_DAY_WIDTHS: Record<ZoomLevel, number> = {
  day: 30,
  week: 8,
  month: 3,
  year: 0.8
};

const PROJECT_HEIGHT = 68; // Height including spacing between projects
const LANE_PADDING = 12;
const MIN_LANE_HEIGHT = 110; // Minimum to fit sidebar content (name + title + add button)

export function Timeline({
  projects,
  teamMembers,
  dependencies,
  zoomLevel,
  selectedProjectId,
  filteredOwners,
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
  onReorderTeamMembers,
  onCopyProject,
  onAddDependency,
  onRemoveDependency
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
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

  // Filter team members when owner filter is active
  const displayedTeamMembers = useMemo(() => {
    if (!filteredOwners || filteredOwners.length === 0) {
      return teamMembers;
    }
    return teamMembers.filter(m => filteredOwners.includes(m.name));
  }, [teamMembers, filteredOwners]);

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

  // Scroll to selected project or today
  useEffect(() => {
    if (scrollRef.current) {
      if (selectedProjectId) {
        // Find and scroll to the selected project
        const project = projects.find(p => p.id === selectedProjectId);
        if (project) {
          const { left } = getBarDimensions(project.startDate, project.endDate, timelineStart, dayWidth);
          scrollRef.current.scrollLeft = Math.max(0, left - 200);
        }
      } else {
        // Scroll to show today with some padding on the left
        const todayPos = todayPosition - 200; // 200px padding from left
        scrollRef.current.scrollLeft = Math.max(0, todayPos);
      }
    }
  }, [zoomLevel, todayPosition, selectedProjectId, projects, timelineStart, dayWidth]);

  // Keyboard navigation for timeline panning
  const KEYBOARD_SCROLL_AMOUNT = 100;
  useKeyboardNavigation({
    onNavigate: useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
      if (!scrollRef.current) return;
      if (direction === 'left') {
        scrollRef.current.scrollLeft -= KEYBOARD_SCROLL_AMOUNT;
      } else if (direction === 'right') {
        scrollRef.current.scrollLeft += KEYBOARD_SCROLL_AMOUNT;
      }
    }, []),
    enabled: true
  });

  // Use native wheel event listener with { passive: false } to allow preventDefault
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleWheel = (e: WheelEvent) => {
      // Only allow horizontal scrolling via wheel when mouse is over the header
      const target = e.target as HTMLElement;
      if (!headerRef.current?.contains(target)) return;

      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        scrollEl.scrollLeft += e.deltaY;
      }
    };

    scrollEl.addEventListener('wheel', handleWheel, { passive: false });
    return () => scrollEl.removeEventListener('wheel', handleWheel);
  }, []);

  // Click-drag panning state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, scrollLeft: 0 });

  // Track which dependency is hovered for isolation effect
  const [hoveredDepId, setHoveredDepId] = useState<string | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start pan if clicking within the header area
    const target = e.target as HTMLElement;
    if (!headerRef.current?.contains(target)) return;

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

  // Create a global project stacks map for dependency rendering
  const globalProjectStacks = useMemo(() => {
    const stacks = new Map<string, number>();

    teamMembers.forEach((member) => {
      const memberStacks = projectStacksByOwner[member.name];
      memberStacks?.forEach((stackIdx, projectId) => {
        stacks.set(projectId, stackIdx);
      });
    });

    return stacks;
  }, [teamMembers, projectStacksByOwner]);

  // Calculate lane heights based on max stack index (not project count)
  const laneHeights = useMemo(() => {
    return displayedTeamMembers.map(member => {
      const stacks = projectStacksByOwner[member.name];
      const maxStack = stacks && stacks.size > 0 ? Math.max(...stacks.values()) : -1;
      const rowCount = maxStack + 1; // Number of rows needed
      const height = Math.max(MIN_LANE_HEIGHT, rowCount * PROJECT_HEIGHT + LANE_PADDING * 2);
      return height;
    });
  }, [displayedTeamMembers, projectStacksByOwner]);

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

  // Create owner-to-lane-index mapping for dependency rendering
  const ownerToLaneIndex = useMemo(() => {
    const map = new Map<string, number>();
    displayedTeamMembers.forEach((member, idx) => {
      map.set(member.name, idx);
    });
    return map;
  }, [displayedTeamMembers]);

  // Store lane positions in ref for dependency calculation
  const lanePositionsRef = useRef(lanePositions);
  useEffect(() => {
    lanePositionsRef.current = lanePositions;
  }, [lanePositions]);

  const totalLanesHeight = lanePositions.length > 0
    ? lanePositions[lanePositions.length - 1] + laneHeights[laneHeights.length - 1]
    : 0;

  return (
    <DependencyCreationProvider onAddDependency={onAddDependency}>
    <div id="timeline-container" className={styles.container}>
      {/* Fixed left sidebar with team members */}
      <div className={styles.sidebar}>
        <div className={styles.sidebarHeader}>Team</div>
        {displayedTeamMembers.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>👥</div>
            <p className={styles.emptyTitle}>No team members yet</p>
            <p className={styles.emptyText}>Add team members to start planning your roadmap</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleMemberDragEnd}
          >
            <SortableContext
              items={displayedTeamMembers.map(m => m.id)}
              strategy={verticalListSortingStrategy}
            >
              {displayedTeamMembers.map((member, idx) => (
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
        )}
        <button className={styles.addMemberBtn} onClick={onAddTeamMember}>
          + Add Team Member
        </button>
      </div>

      {/* Scrollable timeline */}
      <div className={styles.timelineWrapper}>
        <div
          ref={scrollRef}
          className={`${styles.scrollContainer} ${isPanning ? styles.panning : ''}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          {/* Header */}
          <div ref={headerRef} className={styles.header} style={{ width: totalWidth }}>
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
            <div ref={lanesRef} className={styles.lanes} style={{ width: totalWidth, minHeight: totalLanesHeight }}>
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

              {/* Dependencies SVG layer */}
              <svg
                className={styles.dependenciesLayer}
                style={{ width: totalWidth, height: totalLanesHeight }}
              >
                {dependencies.map((dep, index) => {
                  const fromProject = projects.find(p => p.id === dep.fromProjectId);
                  const toProject = projects.find(p => p.id === dep.toProjectId);
                  if (!fromProject || !toProject) return null;

                  return (
                    <DependencyLine
                      key={dep.id}
                      fromProject={fromProject}
                      toProject={toProject}
                      fromMilestoneId={dep.fromMilestoneId}
                      toMilestoneId={dep.toMilestoneId}
                      timelineStart={timelineStart}
                      dayWidth={dayWidth}
                      projectStacks={globalProjectStacks}
                      lanePositions={lanePositions}
                      ownerToLaneIndex={ownerToLaneIndex}
                      lineIndex={index}
                      isAnyHovered={hoveredDepId !== null}
                      onHoverChange={(hovered) => setHoveredDepId(hovered ? dep.id : null)}
                      onRemove={() => onRemoveDependency?.(dep.id)}
                    />
                  );
                })}
              </svg>

              {/* Project lanes */}
              {displayedTeamMembers.map((member, idx) => {
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
                        isSelected={project.id === selectedProjectId}
                        onUpdate={(updates) => onUpdateProject(project.id, updates)}
                        onDelete={() => onDeleteProject(project.id)}
                        onAddMilestone={() => onAddMilestone(project.id)}
                        onEdit={() => onEditProject(project)}
                        onEditMilestone={(mid) => onEditMilestone(project.id, mid)}
                        onUpdateMilestone={(mid, updates) => onUpdateMilestone(project.id, mid, updates)}
                        onDeleteMilestone={(mid) => onDeleteMilestone(project.id, mid)}
                        onCopy={onCopyProject ? () => onCopyProject(project) : undefined}
                      />
                    ))}
                  </DroppableLane>
                );
              })}

              {/* Dependency creation preview overlay */}
              <DependencyCreationOverlay
                containerRef={lanesRef}
                scrollRef={scrollRef}
              />
            </div>
          </DndContext>
        </div>
      </div>
    </div>
    </DependencyCreationProvider>
  );
}
