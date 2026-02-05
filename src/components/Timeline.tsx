import { useRef, useEffect, useMemo, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
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
import type { Project, TeamMember, Dependency, LeaveBlock as LeaveBlockType, LeaveType, LeaveCoverage, PeriodMarker as PeriodMarkerType, PeriodMarkerColor } from '../types';
import { SortableMemberLane } from './SortableMemberLane';
import { DraggableProjectBar } from './DraggableProjectBar';
import { DroppableLane } from './DroppableLane';
import { DependencyLine } from './DependencyLine';
import { DependencyCreationOverlay } from './DependencyCreationOverlay';
import { DependencyCreationProvider } from '../contexts/DependencyCreationContext';
import { LeaveBlock } from './LeaveBlock';
import { LeaveContextMenu } from './LeaveContextMenu';
import { PeriodMarker } from './PeriodMarker';
import { PeriodMarkerContextMenu } from './PeriodMarkerContextMenu';
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

export type ZoomLevel = 'week' | 'month' | 'year';

// Display mode thresholds based on dayWidth
// dayWidth <= 1.5: year view (FY headers)
// dayWidth > 1.5: month view (month headers)
const YEAR_VIEW_THRESHOLD = 1.5;
const WEEK_VIEW_THRESHOLD = 5;

// Detect overlapping projects for conflict highlighting
// Returns a Set of project IDs that have conflicts (overlap with other projects from same owner)
function detectProjectConflicts(projectsByOwner: Record<string, Project[]>): Set<string> {
  const conflicts = new Set<string>();

  Object.values(projectsByOwner).forEach(projects => {
    if (projects.length < 2) return; // Need at least 2 projects to have a conflict

    // Sort by start date for efficient overlap detection
    const sorted = [...projects].sort((a, b) =>
      new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
    );

    // Check each pair of consecutive projects for overlap
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i];
        const b = sorted[j];

        const aStart = new Date(a.startDate).getTime();
        const aEnd = new Date(a.endDate).getTime();
        const bStart = new Date(b.startDate).getTime();
        const bEnd = new Date(b.endDate).getTime();

        // Check for overlap: startA <= endB AND endA >= startB
        if (aStart <= bEnd && aEnd >= bStart) {
          conflicts.add(a.id);
          conflicts.add(b.id);
        }
      }
    }
  });

  return conflicts;
}

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
  leaveBlocks?: LeaveBlockType[];
  zoomLevel?: ZoomLevel; // Deprecated: use dayWidth instead
  dayWidth?: number; // Pixels per day (0.5 - 12)
  selectedProjectId?: string | null;
  filteredOwners?: string[]; // When set, only show swimlanes for these owners
  newMilestoneIds?: Set<string>; // IDs of newly created milestones (for entrance animation)
  newDependencyIds?: Set<string>; // IDs of newly created dependencies (for entrance animation)
  isLocked?: boolean; // When true, disable all editing actions (view mode)
  isFullscreen?: boolean; // When true, timeline takes full viewport
  onAddProject: (ownerName: string, suggestedStart?: string, suggestedEnd?: string) => void;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
  onAddMilestone: (projectId: string) => void;
  onEditProject: (project: Project) => void;
  onEditMilestone: (projectId: string, milestoneId: string) => void;
  onUpdateMilestone: (projectId: string, milestoneId: string, updates: Partial<import('../types').Milestone>) => Promise<void>;
  onDeleteMilestone: (projectId: string, milestoneId: string) => void;
  onAddTeamMember: () => void;
  onEditTeamMember: (member: TeamMember) => void;
  onReorderTeamMembers: (fromIndex: number, toIndex: number) => void;
  onCopyProject?: (project: Project) => void;
  onSelectProject?: (project: Project) => void;
  onSelectMilestone?: (projectId: string, milestoneId: string, milestone: import('../types').Milestone) => void;
  onAddDependency?: (
    fromProjectId: string,
    toProjectId: string,
    fromMilestoneId?: string,
    toMilestoneId?: string
  ) => void;
  onRemoveDependency?: (depId: string) => void;
  onUpdateDependency?: (depId: string, updates: Partial<Dependency>) => void;
  onAddLeaveBlock?: (data: {
    memberId: string;
    startDate: string;
    endDate: string;
    type: LeaveType;
    coverage: LeaveCoverage;
    label?: string;
  }) => void;
  onDeleteLeaveBlock?: (leaveId: string) => void;
  periodMarkers?: PeriodMarkerType[];
  onAddPeriodMarker?: (data: {
    startDate: string;
    endDate: string;
    color: PeriodMarkerColor;
    label?: string;
  }) => void;
  onDeletePeriodMarker?: (markerId: string) => void;
  onDayWidthChange?: (newDayWidth: number) => void; // For Ctrl/Cmd + scroll zoom
  onHoveredMemberChange?: (memberName: string | null) => void; // For N key quick create
}

const ZOOM_DAY_WIDTHS: Record<ZoomLevel, number> = {
  week: 8,
  month: 3,
  year: 0.8
};

const DEFAULT_DAY_WIDTH = 3; // Default to month view

const BASE_PROJECT_HEIGHT = 52; // Minimum project bar height
const MILESTONE_ROW_HEIGHT = 24; // Height per milestone row
const PROJECT_CONTENT_HEIGHT = 28; // Height of the title/dates area
const PROJECT_VERTICAL_GAP = 20; // Gap between stacked projects (increased for visual clarity)
const LANE_PADDING = 16; // Padding top and bottom of lane
const LANE_BOTTOM_BUFFER = 8; // Extra buffer at bottom to prevent spillover
const MIN_LANE_HEIGHT = 110; // Minimum to fit sidebar content (name + title + add button)

// Calculate milestone stacks for a single project (replicates ProjectBar logic)
function calculateMilestoneStacks(milestones: { id: string; startDate: string; endDate: string }[]): Map<string, number> {
  const stacks = new Map<string, number>();
  if (!milestones || milestones.length === 0) return stacks;

  const sorted = [...milestones].sort((a, b) =>
    new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  const stackEndTimes: number[] = [];

  sorted.forEach((milestone) => {
    const startTime = new Date(milestone.startDate).getTime();
    const endTime = new Date(milestone.endDate).getTime();

    let assignedStack = -1;
    for (let i = 0; i < stackEndTimes.length; i++) {
      if (stackEndTimes[i] < startTime) {
        assignedStack = i;
        stackEndTimes[i] = endTime;
        break;
      }
    }

    if (assignedStack === -1) {
      assignedStack = stackEndTimes.length;
      stackEndTimes.push(endTime);
    }

    stacks.set(milestone.id, assignedStack);
  });

  return stacks;
}

// Calculate project bar height based on its milestones
function calculateProjectHeight(milestones: { id: string; startDate: string; endDate: string }[] | undefined): number {
  if (!milestones || milestones.length === 0) {
    return BASE_PROJECT_HEIGHT;
  }

  const milestoneStacks = calculateMilestoneStacks(milestones);
  const maxStack = milestoneStacks.size > 0 ? Math.max(...milestoneStacks.values()) : -1;
  const milestoneRows = maxStack + 1;
  const dynamicHeight = PROJECT_CONTENT_HEIGHT + (milestoneRows * MILESTONE_ROW_HEIGHT) + 8;
  return Math.max(BASE_PROJECT_HEIGHT, dynamicHeight);
}

// Ref handle type for parent components
export interface TimelineRef {
  scrollToToday: () => void;
}

export const Timeline = forwardRef<TimelineRef, TimelineProps>(function Timeline({
  projects,
  teamMembers,
  dependencies,
  leaveBlocks = [],
  zoomLevel,
  dayWidth: dayWidthProp,
  selectedProjectId,
  filteredOwners,
  newMilestoneIds,
  newDependencyIds,
  isLocked = false,
  isFullscreen = false,
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
  onSelectProject,
  onSelectMilestone,
  onAddDependency,
  onRemoveDependency,
  onUpdateDependency,
  onAddLeaveBlock,
  onDeleteLeaveBlock,
  periodMarkers = [],
  onAddPeriodMarker,
  onDeletePeriodMarker,
  onDayWidthChange,
  onHoveredMemberChange
}, ref) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const hasInitialScrolledRef = useRef(false);
  const edgeScrollFrameRef = useRef<number | null>(null);
  const lastMouseXRef = useRef<number>(0);
  const prevDayWidthRef = useRef<number | null>(null);

  // Support both old zoomLevel prop and new dayWidth prop
  const dayWidth = dayWidthProp ?? (zoomLevel ? ZOOM_DAY_WIDTHS[zoomLevel] : DEFAULT_DAY_WIDTH);

  // Derive display mode from dayWidth for header rendering
  const displayMode: 'year' | 'month' | 'week' = useMemo(() => {
    if (dayWidth <= YEAR_VIEW_THRESHOLD) return 'year';
    if (dayWidth >= WEEK_VIEW_THRESHOLD) return 'week';
    return 'month';
  }, [dayWidth]);

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
    if (displayMode === 'year') return [];
    const markers: { label: string; left: number; width: number; date: string }[] = [];
    let current = startOfMonth(timelineStart);
    // Use shorter date format when zoomed out (month view) to prevent squashing
    const dateFormat = displayMode === 'week' ? 'MMM yyyy' : "MMM ''yy";
    while (current < timelineEnd) {
      const left = dateFnsDiff(current, timelineStart) * dayWidth;
      // Calculate days in this month for width
      const nextMonth = addMonths(current, 1);
      const daysInMonth = dateFnsDiff(nextMonth, current);
      const width = daysInMonth * dayWidth;
      if (left >= 0 && left < totalWidth) {
        markers.push({
          label: format(current, dateFormat),
          left,
          width,
          date: current.toISOString().split('T')[0]
        });
      }
      current = nextMonth;
    }
    return markers;
  }, [displayMode, timelineStart, timelineEnd, dayWidth, totalWidth]);

  // Memoize todayPosition to prevent unnecessary recalculations on every render
  // getTodayPosition creates new Date() internally, so we only want to recalculate
  // when timelineStart or dayWidth actually changes
  const todayPosition = useMemo(
    () => getTodayPosition(timelineStart, dayWidth),
    [timelineStart, dayWidth]
  );

  // Effect A: One-time initial scroll - position "today" at 1/3 from left
  useEffect(() => {
    if (scrollRef.current && !hasInitialScrolledRef.current) {
      const viewportWidth = scrollRef.current.clientWidth;
      const oneThirdOffset = viewportWidth / 3;
      scrollRef.current.scrollLeft = Math.max(0, todayPosition - oneThirdOffset);
      hasInitialScrolledRef.current = true;
      prevDayWidthRef.current = dayWidth;
    }
  }, [todayPosition, dayWidth]);

  // Effect B: Scroll to selected project only (from search)
  useEffect(() => {
    if (!scrollRef.current || !selectedProjectId) return;
    const project = projects.find(p => p.id === selectedProjectId);
    if (project) {
      const { left } = getBarDimensions(project.startDate, project.endDate, timelineStart, dayWidth);
      const viewportWidth = scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = Math.max(0, left - viewportWidth / 3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, timelineStart, dayWidth]);

  // Effect C: Maintain scroll position when zoom level changes
  useEffect(() => {
    if (!scrollRef.current || !hasInitialScrolledRef.current) return;
    if (prevDayWidthRef.current === null || prevDayWidthRef.current === dayWidth) return;

    // Calculate what date was at the 1/3 point before zoom
    const viewportWidth = scrollRef.current.clientWidth;
    const prevScrollLeft = scrollRef.current.scrollLeft;
    const prevCenterDate = (prevScrollLeft + viewportWidth / 3) / prevDayWidthRef.current;

    // Scroll to put that same date at 1/3 with new dayWidth
    const newScrollLeft = prevCenterDate * dayWidth - viewportWidth / 3;
    scrollRef.current.scrollLeft = Math.max(0, newScrollLeft);

    prevDayWidthRef.current = dayWidth;
  }, [dayWidth]);

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
  // Handles both horizontal scrolling (header drag) and Ctrl/Cmd + scroll zoom
  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (!scrollEl) return;

    const handleWheel = (e: WheelEvent) => {
      // Ctrl/Cmd + scroll to zoom (like Google Maps)
      if ((e.ctrlKey || e.metaKey) && onDayWidthChange) {
        e.preventDefault();
        const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1; // Scroll down = zoom out, up = zoom in
        const newDayWidth = Math.min(12, Math.max(0.5, dayWidth * zoomFactor));
        onDayWidthChange(newDayWidth);
        return;
      }

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
  }, [dayWidth, onDayWidthChange]);

  // Click-drag panning state
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, scrollLeft: 0 });

  // Track which dependency is hovered for isolation effect
  const [hoveredDepId, setHoveredDepId] = useState<string | null>(null);

  // Jump to today handler (for fullscreen mode and T key)
  const scrollToToday = useCallback(() => {
    if (!scrollRef.current) return;
    const viewportWidth = scrollRef.current.clientWidth;
    const oneThirdOffset = viewportWidth / 3;
    scrollRef.current.scrollTo({
      left: Math.max(0, todayPosition - oneThirdOffset),
      behavior: 'smooth'
    });
  }, [todayPosition]);

  // Expose scrollToToday to parent via ref
  useImperativeHandle(ref, () => ({
    scrollToToday
  }), [scrollToToday]);

  // Track which project/milestone is hovered for dependency highlighting
  const [hoveredItemId, setHoveredItemId] = useState<{ projectId: string; milestoneId?: string } | null>(null);

  // Leave context menu state
  const [leaveContextMenu, setLeaveContextMenu] = useState<{
    x: number;
    y: number;
    memberId: string;
    date: string;
  } | null>(null);

  // Period marker context menu state
  const [periodMarkerContextMenu, setPeriodMarkerContextMenu] = useState<{
    x: number;
    y: number;
    date: string;
  } | null>(null);

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

  // Edge scroll during project drag/resize
  const handleEdgeDrag = useCallback((mouseX: number, isDragging: boolean) => {
    lastMouseXRef.current = mouseX;

    if (!isDragging) {
      // Stop scrolling when drag ends
      if (edgeScrollFrameRef.current !== null) {
        cancelAnimationFrame(edgeScrollFrameRef.current);
        edgeScrollFrameRef.current = null;
      }
      return;
    }

    // CRITICAL FIX: Only start the RAF loop if it's not already running
    // This prevents creating hundreds of RAF loops on every mouse move
    if (edgeScrollFrameRef.current !== null) {
      // Loop already running, just update mouseX ref and return
      return;
    }

    const EDGE_THRESHOLD = 80;
    const BASE_SCROLL_SPEED = 10;

    const scrollStep = () => {
      const container = scrollRef.current;
      // Safety check: stop if container is gone
      if (!container) {
        edgeScrollFrameRef.current = null;
        return;
      }

      const rect = container.getBoundingClientRect();
      const mx = lastMouseXRef.current;
      const distFromLeft = mx - rect.left;
      const distFromRight = rect.right - mx;

      let scrollDelta = 0;
      if (distFromLeft < EDGE_THRESHOLD && distFromLeft > 0) {
        scrollDelta = -BASE_SCROLL_SPEED * (1 - distFromLeft / EDGE_THRESHOLD);
      } else if (distFromRight < EDGE_THRESHOLD && distFromRight > 0) {
        scrollDelta = BASE_SCROLL_SPEED * (1 - distFromRight / EDGE_THRESHOLD);
      }

      if (scrollDelta !== 0) {
        container.scrollLeft += scrollDelta;
        // Continue the loop
        edgeScrollFrameRef.current = requestAnimationFrame(scrollStep);
      } else {
        // Stop when not near edge
        edgeScrollFrameRef.current = null;
      }
    };

    // Start the scroll loop (only once)
    edgeScrollFrameRef.current = requestAnimationFrame(scrollStep);
  }, []);

  // Cleanup RAF on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      if (edgeScrollFrameRef.current !== null) {
        cancelAnimationFrame(edgeScrollFrameRef.current);
        edgeScrollFrameRef.current = null;
      }
    };
  }, []);

  // Sync vertical scroll from main content to sidebar using CSS transform
  // Uses RAF for perfect frame timing + GPU-accelerated transform
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const sidebarContentEl = sidebarContentRef.current;
    if (!scrollEl || !sidebarContentEl) return;

    let rafId: number | null = null;
    let lastScrollTop = 0;

    const syncSidebarToMain = () => {
      // Skip if scroll position hasn't changed
      if (scrollEl.scrollTop === lastScrollTop) return;
      lastScrollTop = scrollEl.scrollTop;

      // Cancel any pending frame to avoid queuing multiple updates
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      // Schedule transform update on next frame for perfect sync
      rafId = requestAnimationFrame(() => {
        sidebarContentEl.style.transform = `translate3d(0, -${lastScrollTop}px, 0)`;
        rafId = null;
      });
    };

    // Use passive listener for better scroll performance
    scrollEl.addEventListener('scroll', syncSidebarToMain, { passive: true });

    return () => {
      scrollEl.removeEventListener('scroll', syncSidebarToMain);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  // Handle right-click on lane to add leave
  const handleLaneContextMenu = useCallback((
    e: React.MouseEvent,
    memberId: string
  ) => {
    if (isLocked || !onAddLeaveBlock) return;
    e.preventDefault();

    // Calculate the date from click position
    const scrollContainer = scrollRef.current;
    if (!scrollContainer) return;

    const rect = scrollContainer.getBoundingClientRect();
    const scrollLeft = scrollContainer.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft;
    const daysFromStart = Math.floor(clickX / dayWidth);
    const clickDate = new Date(timelineStart);
    clickDate.setDate(clickDate.getDate() + daysFromStart);

    const dateStr = clickDate.toISOString().split('T')[0];

    setLeaveContextMenu({
      x: e.clientX,
      y: e.clientY,
      memberId,
      date: dateStr
    });
  }, [isLocked, onAddLeaveBlock, dayWidth, timelineStart]);

  // Handle right-click on month header to add period marker
  const handleHeaderContextMenu = useCallback((
    e: React.MouseEvent,
    markerDate: string
  ) => {
    if (isLocked || !onAddPeriodMarker) return;
    e.preventDefault();

    setPeriodMarkerContextMenu({
      x: e.clientX,
      y: e.clientY,
      date: markerDate
    });
  }, [isLocked, onAddPeriodMarker]);

  // Group projects by owner AND calculate stacks in single pass (batched operations)
  const { projectsByOwner, projectStacksByOwner, projectConflicts } = useMemo(() => {
    const grouped: Record<string, Project[]> = {};
    const stacksByOwner: Record<string, Map<string, number>> = {};

    // Initialize for all team members
    teamMembers.forEach(m => {
      grouped[m.name] = [];
    });

    // Group projects by owner
    projects.forEach(p => {
      if (grouped[p.owner]) {
        grouped[p.owner].push(p);
      }
    });

    // Calculate stacks for each owner
    teamMembers.forEach(m => {
      const ownerProjects = grouped[m.name] || [];
      stacksByOwner[m.name] = calculateProjectStacks(ownerProjects);
    });

    // Detect conflicts (overlapping projects)
    const conflicts = detectProjectConflicts(grouped);

    return { projectsByOwner: grouped, projectStacksByOwner: stacksByOwner, projectConflicts: conflicts };
  }, [projects, teamMembers]);

  // Group leave blocks by member ID
  const leaveBlocksByMember = useMemo(() => {
    const grouped: Record<string, LeaveBlockType[]> = {};
    teamMembers.forEach(m => {
      grouped[m.id] = [];
    });
    leaveBlocks.forEach(leave => {
      if (grouped[leave.memberId]) {
        grouped[leave.memberId].push(leave);
      }
    });
    return grouped;
  }, [leaveBlocks, teamMembers]);

  // Create O(1) project lookup map (avoids O(n) .find() in dependency rendering)
  const projectsById = useMemo(() => {
    const map = new Map<string, Project>();
    projects.forEach(p => map.set(p.id, p));
    return map;
  }, [projects]);

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

  // Calculate the maximum project height for each stack row in each lane
  // This accounts for milestones stacking within projects
  const { laneHeights, laneStackHeights } = useMemo(() => {
    const heights: number[] = [];
    const stackHeights: Record<string, number[]> = {};

    displayedTeamMembers.forEach(member => {
      const ownerProjects = projectsByOwner[member.name] || [];
      const stacks = projectStacksByOwner[member.name];
      const maxStack = stacks && stacks.size > 0 ? Math.max(...stacks.values()) : -1;

      // Calculate max height for each stack row
      const rowHeights: number[] = [];
      for (let row = 0; row <= maxStack; row++) {
        // Find all projects in this stack row and get their max height
        const projectsInRow = ownerProjects.filter(p => stacks?.get(p.id) === row);
        const maxHeightInRow = projectsInRow.reduce((max, p) => {
          const height = calculateProjectHeight(p.milestones);
          return Math.max(max, height);
        }, BASE_PROJECT_HEIGHT);
        rowHeights.push(maxHeightInRow);
      }

      stackHeights[member.name] = rowHeights;

      // Total lane height is sum of all row heights + gaps + padding + buffer
      const totalProjectHeight = rowHeights.length > 0
        ? rowHeights.reduce((sum, h) => sum + h, 0) + (rowHeights.length - 1) * PROJECT_VERTICAL_GAP
        : 0;
      const height = Math.max(MIN_LANE_HEIGHT, totalProjectHeight + LANE_PADDING * 2 + LANE_BOTTOM_BUFFER);
      heights.push(height);
    });

    return { laneHeights: heights, laneStackHeights: stackHeights };
  }, [displayedTeamMembers, projectsByOwner, projectStacksByOwner]);

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

  // Helper to calculate cumulative top offset for a project based on stack heights
  const getStackTopOffset = useCallback((ownerName: string, stackIndex: number): number => {
    const stackHeights = laneStackHeights[ownerName] || [];
    let offset = LANE_PADDING;
    for (let i = 0; i < stackIndex; i++) {
      offset += (stackHeights[i] || BASE_PROJECT_HEIGHT) + PROJECT_VERTICAL_GAP;
    }
    return offset;
  }, [laneStackHeights]);


  // Store lane positions in ref for dependency calculation
  const lanePositionsRef = useRef(lanePositions);
  useEffect(() => {
    lanePositionsRef.current = lanePositions;
  }, [lanePositions]);

  const totalLanesHeight = lanePositions.length > 0 && laneHeights.length > 0
    ? lanePositions[lanePositions.length - 1] + laneHeights[laneHeights.length - 1]
    : 0;

  // Memoize dependency lines to prevent recalculation on every render
  const dependencyElements = useMemo(() => {
    return dependencies.map((dep, index) => {
      const fromProject = projectsById.get(dep.fromProjectId);
      const toProject = projectsById.get(dep.toProjectId);
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
          laneStackHeights={laneStackHeights}
          ownerToLaneIndex={ownerToLaneIndex}
          lineIndex={index}
          isAnyHovered={hoveredDepId !== null}
          hoveredItemId={hoveredItemId}
          isNew={newDependencyIds?.has(dep.id) ?? false}
          onHoverChange={(hovered) => setHoveredDepId(hovered ? dep.id : null)}
          onRemove={() => onRemoveDependency?.(dep.id)}
          waypoints={dep.waypoints}
          onUpdateWaypoints={(waypoints) => onUpdateDependency?.(dep.id, { waypoints })}
        />
      );
    });
  }, [dependencies, projectsById, timelineStart, dayWidth, globalProjectStacks, lanePositions, laneStackHeights, ownerToLaneIndex, hoveredDepId, hoveredItemId, onRemoveDependency, onUpdateDependency, newDependencyIds]);

  return (
    <DependencyCreationProvider onAddDependency={onAddDependency}>
    <div id="timeline-container" className={`${styles.container} ${isFullscreen ? styles.fullscreen : ''}`}>
      {/* Fixed left sidebar with team members - hidden in fullscreen */}
      {!isFullscreen && (
      <div ref={sidebarRef} className={styles.sidebar}>
        <div className={styles.sidebarHeader}>Team</div>
        <div ref={sidebarContentRef} className={styles.sidebarContent}>
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
                    isLocked={isLocked}
                    onEdit={() => onEditTeamMember(member)}
                    onAddProject={() => onAddProject(member.name)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
          <button className={styles.addMemberBtn} onClick={onAddTeamMember} disabled={isLocked}>
            + Add Team Member
          </button>
        </div>
      </div>
      )}

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
            {displayMode === 'year' ? (
              fySegments.map(({ fy, left, width }) => (
                <div key={fy} className={styles.fyHeader} style={{ left, width }}>
                  <span className={styles.fyLabel}>FY{fy}</span>
                </div>
              ))
            ) : (
              monthMarkers.map(({ label, left, width, date }, i) => (
                <div
                  key={i}
                  className={`${styles.monthHeader} ${displayMode === 'week' ? styles.weekZoom : styles.monthZoom}`}
                  style={{ left, width }}
                  onContextMenu={(e) => handleHeaderContextMenu(e, date)}
                >
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
            <div ref={lanesRef} className={styles.lanes} data-lanes-container style={{ width: totalWidth, minHeight: totalLanesHeight }}>
              {/* Grid lines */}
              {displayMode === 'year' && fySegments.map(({ fy, left, width }) => (
                <div key={`q-${fy}`}>
                  {[0, 1, 2, 3].map(q => (
                    <div key={q} className={styles.gridLine} style={{ left: left + (width / 4) * q }} />
                  ))}
                </div>
              ))}
              {displayMode === 'month' && monthMarkers.map(({ left }, i) => (
                <div key={i} className={styles.gridLine} style={{ left }} />
              ))}

              {/* Period markers (full-height colored bands) */}
              {periodMarkers.map((marker) => (
                <PeriodMarker
                  key={marker.id}
                  marker={marker}
                  timelineStart={timelineStart}
                  dayWidth={dayWidth}
                  totalHeight={totalLanesHeight}
                  isLocked={isLocked}
                  onDelete={() => onDeletePeriodMarker?.(marker.id)}
                />
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
                {dependencyElements}
              </svg>

              {/* Project lanes */}
              {displayedTeamMembers.map((member, idx) => {
                const stacks = projectStacksByOwner[member.name];
                const memberLeaves = leaveBlocksByMember[member.id] || [];
                return (
                  <DroppableLane
                    key={member.id}
                    id={`lane-${member.id}`}
                    memberName={member.name}
                    top={lanePositions[idx]}
                    height={laneHeights[idx]}
                    onContextMenu={(e) => handleLaneContextMenu(e, member.id)}
                    onHoverChange={(isHovered) => onHoveredMemberChange?.(isHovered ? member.name : null)}
                    timelineStart={timelineStart}
                    dayWidth={dayWidth}
                    isLocked={isLocked}
                    onDragCreate={(startDate, endDate) => {
                      // Open add project modal with pre-filled dates from drag
                      onAddProject(member.name, startDate, endDate);
                    }}
                  >
                    {/* Leave blocks (rendered behind projects) */}
                    {memberLeaves.map((leave) => (
                      <LeaveBlock
                        key={leave.id}
                        leave={leave}
                        timelineStart={timelineStart}
                        dayWidth={dayWidth}
                        laneHeight={laneHeights[idx]}
                        isLocked={isLocked}
                        onDelete={() => onDeleteLeaveBlock?.(leave.id)}
                      />
                    ))}
                    {/* Projects */}
                    {projectsByOwner[member.name]?.map((project) => {
                      const stackIdx = stacks?.get(project.id) ?? 0;
                      return (
                      <DraggableProjectBar
                        key={project.id}
                        project={project}
                        timelineStart={timelineStart}
                        dayWidth={dayWidth}
                        stackIndex={stackIdx}
                        stackTopOffset={getStackTopOffset(member.name, stackIdx)}
                        laneTop={lanePositions[idx]}
                        isSelected={project.id === selectedProjectId}
                        hasConflict={projectConflicts.has(project.id)}
                        newMilestoneIds={newMilestoneIds}
                        isLocked={isLocked}
                        onUpdate={(updates) => onUpdateProject(project.id, updates)}
                        onDelete={() => onDeleteProject(project.id)}
                        onAddMilestone={() => onAddMilestone(project.id)}
                        onEdit={() => onEditProject(project)}
                        onEditMilestone={(mid) => onEditMilestone(project.id, mid)}
                        onUpdateMilestone={(mid, updates) => onUpdateMilestone(project.id, mid, updates)}
                        onDeleteMilestone={(mid) => onDeleteMilestone(project.id, mid)}
                        onCopy={onCopyProject ? () => onCopyProject(project) : undefined}
                        onSelect={onSelectProject ? () => onSelectProject(project) : undefined}
                        onSelectMilestone={onSelectMilestone ? (mid) => {
                          const milestone = project.milestones?.find(m => m.id === mid);
                          if (milestone) onSelectMilestone(project.id, mid, milestone);
                        } : undefined}
                        onEdgeDrag={handleEdgeDrag}
                        onHoverChange={(hovered, milestoneId) => setHoveredItemId(
                          hovered ? { projectId: project.id, milestoneId } : null
                        )}
                      />
                      );
                    })}
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

      {/* Leave context menu */}
      {leaveContextMenu && onAddLeaveBlock && (
        <LeaveContextMenu
          x={leaveContextMenu.x}
          y={leaveContextMenu.y}
          memberId={leaveContextMenu.memberId}
          date={leaveContextMenu.date}
          onAddLeave={onAddLeaveBlock}
          onClose={() => setLeaveContextMenu(null)}
        />
      )}

      {/* Period marker context menu */}
      {periodMarkerContextMenu && onAddPeriodMarker && (
        <PeriodMarkerContextMenu
          x={periodMarkerContextMenu.x}
          y={periodMarkerContextMenu.y}
          date={periodMarkerContextMenu.date}
          onAddMarker={onAddPeriodMarker}
          onClose={() => setPeriodMarkerContextMenu(null)}
        />
      )}

      {/* Jump to Today floating button - fullscreen only */}
      {isFullscreen && (
        <button
          className={styles.jumpToTodayBtn}
          onClick={scrollToToday}
          title="Jump to today (T)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
          Today
        </button>
      )}
    </div>
    </DependencyCreationProvider>
  );
});
