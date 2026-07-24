import { useRef, useEffect, useLayoutEffect, useMemo, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
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
import { ItemContextMenu } from './ItemContextMenu';
import {
  getFYStart,
  getFYEnd,
  getFYFromDate,
  getVisibleFYs,
  getTodayPosition,
  getBarDimensions
} from '../utils/dateUtils';
import { differenceInDays as dateFnsDiff, addMonths, startOfMonth, format } from 'date-fns';
import {
  CAPACITY,
  UNIT_HEIGHT,
  SLOT_PITCH,
  heightForSize,
  isCapacityExempt,
  slotsFor,
  DEFAULT_SIZE,
} from '../utils/capacity';
import { isOnHold } from '../utils/statusColors';
import { getTimelineBounds } from '../utils/timelineBounds';
import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import styles from './Timeline.module.css';

type ZoomLevel = 'week' | 'month' | 'year';

// Display mode thresholds based on dayWidth
// dayWidth <= 1.5: year view (FY headers)
// dayWidth > 1.5: month view (month headers)
const YEAR_VIEW_THRESHOLD = 1.5;
const WEEK_VIEW_THRESHOLD = 5;


// Assign every project a vertical SLOT OFFSET (in slot units) so the lane reads
// as a shared capacity grid: a Small occupies 1 slot row, a Medium 2, a Large 3,
// a Full Time all 4. Projects are packed in 2D — a pill claims `slots` consecutive
// rows for its date range — so a tall project tucks into the SAME rows that short
// projects use at a non-overlapping time (top-aligned, side by side) instead of
// being shoved onto its own row below them.
//
// The returned number is the project's top slot offset; `top` pixels are then
// LANE_PADDING + offset * SLOT_PITCH (see getStackTopOffset). Offsets can exceed
// the 4-slot capacity when a member is over-allocated — the lane simply grows.
function calculateProjectStacks(projects: Project[]): Map<string, number> {
  const stacks = new Map<string, number>();
  if (!projects || projects.length === 0) return stacks;

  // Sort by start date, then end date, so earlier/shorter work settles first.
  const sorted = [...projects].sort((a, b) => {
    const startDiff = new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
    if (startDiff !== 0) return startDiff;
    return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
  });

  // Already-placed pills, each holding the slot rows [slot, slot + slots).
  const placed: { start: number; end: number; slot: number; slots: number }[] = [];

  sorted.forEach((project) => {
    const start = new Date(project.startDate).getTime();
    const end = new Date(project.endDate).getTime();
    const slots = slotsFor(project.size ?? DEFAULT_SIZE);

    // Rows blocked by pills that overlap this one in time (inclusive: a pill that
    // ends the same day another starts still counts as occupying the row).
    const blocked = new Set<number>();
    for (const q of placed) {
      if (q.start <= end && start <= q.end) {
        for (let s = q.slot; s < q.slot + q.slots; s++) blocked.add(s);
      }
    }

    // Lowest offset where this pill's `slots` consecutive rows are all free.
    let offset = 0;
    while (true) {
      let fits = true;
      for (let s = offset; s < offset + slots; s++) {
        if (blocked.has(s)) { fits = false; break; }
      }
      if (fits) break;
      offset++;
    }

    placed.push({ start, end, slot: offset, slots });
    stacks.set(project.id, offset);
  });

  return stacks;
}

interface TimelineProps {
  projects: Project[];
  // Every project, unfiltered. The timeline's date range is derived from this
  // rather than from `projects` so that applying a filter can't move the axis
  // underneath the viewport — the same scrollLeft would otherwise land on a
  // different year and throw the user off the today line. Falls back to
  // `projects` when omitted.
  allProjects?: Project[];
  teamMembers: TeamMember[];
  dependencies: Dependency[];
  leaveBlocks?: LeaveBlockType[];
  zoomLevel?: ZoomLevel; // Deprecated: use dayWidth instead
  dayWidth?: number; // Pixels per day (0.5 - 12)
  selectedProjectId?: string | null;
  filteredOwners?: string[]; // When set, only show swimlanes for these owners
  // When true, a swimlane with nothing left to show collapses to a slim strip
  // instead of reserving the full capacity frame. Set while a filter is active,
  // so a filtered board doesn't become a column of tall empty lanes. Off
  // otherwise, which keeps the roomy "+ Add Project" empty state for a member
  // who genuinely has no work yet.
  slimEmptyLanes?: boolean;
  newDependencyIds?: Set<string>; // IDs of newly created dependencies (for entrance animation)
  isLocked?: boolean; // When true, disable all editing actions (view mode)
  isFullscreen?: boolean; // When true, timeline takes full viewport
  onAddProject: (ownerName: string, suggestedStart?: string, suggestedEnd?: string) => void;
  onUpdateProject: (projectId: string, updates: Partial<Project>) => Promise<void>;
  onDeleteProject: (projectId: string) => void;
  onEditProject: (project: Project) => void;
  onAddTeamMember: () => void;
  onEditTeamMember: (member: TeamMember) => void;
  onReorderTeamMembers: (fromIndex: number, toIndex: number) => void;
  onCopyProject?: (project: Project) => void;
  onSelectProject?: (project: Project) => void;
  onAddDependency?: (
    fromProjectId: string,
    toProjectId: string
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
  onEditPeriodMarker?: (markerId: string, updates: { startDate: string; endDate: string; color: PeriodMarkerColor; label?: string }) => void;
  onDayWidthChange?: (newDayWidth: number) => void; // For Ctrl/Cmd + scroll zoom
  onHoveredMemberChange?: (memberName: string | null) => void; // For N key quick create
  collapsedLanes?: Set<string>; // IDs of collapsed team member lanes
  onToggleLaneCollapse?: (memberId: string) => void; // Toggle collapse state of a lane
}

const ZOOM_DAY_WIDTHS: Record<ZoomLevel, number> = {
  week: 8,
  month: 3,
  year: 0.8
};

const DEFAULT_DAY_WIDTH = 3; // Default to month view

const LANE_PADDING = 16; // Padding top and bottom of lane
const LANE_BOTTOM_BUFFER = 8; // Extra buffer at bottom to prevent spillover
const MIN_LANE_HEIGHT = 110; // Minimum to fit sidebar content (name + title + add button)
const COLLAPSED_LANE_HEIGHT = 40; // Height for collapsed lanes
// Height for a lane a filter has emptied. Matches the collapsed height so a
// filtered board reads as a consistent stack of slim strips.
const EMPTY_LANE_HEIGHT = 40;

// Stable empty defaults to avoid creating new references on each render
const EMPTY_SET = new Set<string>();
const EMPTY_LEAVE_BLOCKS: LeaveBlockType[] = [];
const EMPTY_PERIOD_MARKERS: PeriodMarkerType[] = [];

// Ref handle type for parent components
export interface TimelineRef {
  scrollToToday: () => void;
}

export const Timeline = forwardRef<TimelineRef, TimelineProps>(function Timeline({
  projects,
  allProjects,
  teamMembers,
  dependencies,
  leaveBlocks = EMPTY_LEAVE_BLOCKS,
  zoomLevel,
  dayWidth: dayWidthProp,
  selectedProjectId,
  filteredOwners,
  slimEmptyLanes = false,
  newDependencyIds,
  isLocked = false,
  isFullscreen = false,
  onAddProject,
  onUpdateProject,
  onDeleteProject,
  onEditProject,
  onAddTeamMember,
  onEditTeamMember,
  onReorderTeamMembers,
  onCopyProject,
  onSelectProject,
  onAddDependency,
  onRemoveDependency,
  onUpdateDependency,
  onAddLeaveBlock,
  onDeleteLeaveBlock,
  periodMarkers = EMPTY_PERIOD_MARKERS,
  onAddPeriodMarker,
  onDeletePeriodMarker,
  onEditPeriodMarker,
  onDayWidthChange,
  onHoveredMemberChange,
  collapsedLanes = EMPTY_SET,
  onToggleLaneCollapse
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
  // Tracks the last selection we actually scrolled to, so Effect B fires once per
  // genuine selection change instead of every time timelineStart/dayWidth churn.
  const prevSelectedProjectIdRef = useRef<string | null>(null);

  // Zoom animation ref for cleanup
  const zoomTimeoutRef = useRef<number | null>(null);

  // Support both old zoomLevel prop and new dayWidth prop
  const dayWidth = dayWidthProp ?? (zoomLevel ? ZOOM_DAY_WIDTHS[zoomLevel] : DEFAULT_DAY_WIDTH);

  // Derive display mode from dayWidth for header rendering
  const displayMode: 'year' | 'month' | 'week' = useMemo(() => {
    if (dayWidth <= YEAR_VIEW_THRESHOLD) return 'year';
    if (dayWidth >= WEEK_VIEW_THRESHOLD) return 'week';
    return 'month';
  }, [dayWidth]);

  // Whole-sidebar collapse into a thin vertical rail to hand horizontal space
  // back to the timeline. Persisted so the choice sticks across sessions.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      // Default to collapsed for first-time visitors; honour an explicit choice once made.
      const stored = localStorage.getItem('roadmap.sidebarCollapsed');
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('roadmap.sidebarCollapsed', String(sidebarCollapsed));
    } catch {
      /* localStorage unavailable — fall back to in-memory state */
    }
  }, [sidebarCollapsed]);

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

  // Source for the date range: the unfiltered list when the parent supplies it,
  // otherwise whatever we were rendered with.
  const boundsProjects = allProjects ?? projects;

  const { timelineStart, timelineEnd, visibleFYs } = useMemo(() => {
    // Measured over ALL projects, not the filtered subset, so the axis doesn't
    // shift when a filter is applied (see allProjects). Shares one definition
    // with the image exports — see utils/timelineBounds.
    const { start, end, minYear, maxYear } = getTimelineBounds(boundsProjects);
    const fys = getVisibleFYs(minYear, maxYear - minYear + 1);
    return { timelineStart: start, timelineEnd: end, visibleFYs: fys };
  }, [boundsProjects]);

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
          date: format(current, 'yyyy-MM-dd')
        });
      }
      current = nextMonth;
    }
    return markers;
  }, [displayMode, timelineStart, timelineEnd, dayWidth, totalWidth]);

  // Fiscal-quarter segments for the header's top band (and quarter/FY gridlines).
  // Fiscal year starts in April, so quarters are Apr–Jun (Q1), Jul–Sep (Q2),
  // Oct–Dec (Q3), Jan–Mar (Q4). The first quarter of an FY (Q1) is flagged so it
  // can carry the stronger FY gridline / divider.
  const quarterSegments = useMemo(() => {
    if (displayMode === 'year') return [];
    const segs: { key: string; label: string; left: number; width: number; isFyStart: boolean }[] = [];
    let current = startOfMonth(timelineStart);
    // Step back to the first month of the quarter this month belongs to.
    const monthsSinceQuarterStart = (((current.getMonth() - 3 + 12) % 12)) % 3;
    current = addMonths(current, -monthsSinceQuarterStart);
    while (current < timelineEnd) {
      const next = addMonths(current, 3);
      const qIndex = Math.floor((((current.getMonth() - 3 + 12) % 12)) / 3); // 0..3
      const fy = getFYFromDate(current);
      const left = dateFnsDiff(current, timelineStart) * dayWidth;
      const width = dateFnsDiff(next, current) * dayWidth;
      segs.push({
        key: `${fy}-Q${qIndex + 1}`,
        label: `Q${qIndex + 1} FY${String(fy).slice(2)}`,
        left,
        width,
        isFyStart: qIndex === 0,
      });
      current = next;
    }
    return segs;
  }, [displayMode, timelineStart, timelineEnd, dayWidth]);

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

  // Effect B: Scroll to the selected project only when the selection actually
  // changes (e.g. from search or a deep-link). timelineStart/dayWidth stay in the
  // deps so the scroll uses current values, but we no-op when selectedProjectId is
  // unchanged — otherwise any churn of timelineStart (a new Date() is allocated
  // whenever the projects prop reference changes: own edits, remote updates,
  // undo/redo, filter changes) or dayWidth (zoom) would yank the viewport back to
  // the still-selected pill while the user has scrolled elsewhere.
  useEffect(() => {
    // Reset the guard when the selection is cleared so re-selecting the same
    // project later (e.g. after Escape) scrolls to it again.
    if (!selectedProjectId) {
      prevSelectedProjectIdRef.current = null;
      return;
    }
    // Only a genuine selection change should move the viewport.
    if (prevSelectedProjectIdRef.current === selectedProjectId) return;
    if (!scrollRef.current) return;
    const project = projects.find(p => p.id === selectedProjectId);
    if (!project) return; // not loaded / filtered out yet — retry on a later render
    const { left } = getBarDimensions(project.startDate, project.endDate, timelineStart, dayWidth);
    const viewportWidth = scrollRef.current.clientWidth;
    scrollRef.current.scrollLeft = Math.max(0, left - viewportWidth / 3);
    // Record the id only AFTER the scroll actually ran, so a selection that
    // arrived before the container mounted (or for a filtered-out project) isn't
    // "consumed" and will still scroll once it becomes resolvable.
    prevSelectedProjectIdRef.current = selectedProjectId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, timelineStart, dayWidth]);

  // Effect C: Smooth zoom animation when dayWidth changes
  // Uses direct DOM manipulation for synchronous transform application
  useLayoutEffect(() => {
    if (!scrollRef.current || !lanesRef.current || !headerRef.current || !hasInitialScrolledRef.current) return;
    if (prevDayWidthRef.current === null || prevDayWidthRef.current === dayWidth) return;

    const lanes = lanesRef.current;
    const header = headerRef.current;
    const scroll = scrollRef.current;

    // Calculate the scale ratio (inverse to counteract the DOM size change)
    const scaleRatio = prevDayWidthRef.current / dayWidth;

    // Calculate what position was at viewport center before zoom
    const viewportWidth = scroll.clientWidth;
    const prevScrollLeft = scroll.scrollLeft;
    const viewportCenterX = prevScrollLeft + viewportWidth / 2;

    // Cancel any existing animation
    if (zoomTimeoutRef.current !== null) {
      clearTimeout(zoomTimeoutRef.current);
      lanes.classList.remove(styles.zooming);
      header.classList.remove(styles.zooming);
    }

    // Step 1: Set transform origin to left edge (simpler math)
    lanes.style.transformOrigin = 'left top';
    header.style.transformOrigin = 'left top';

    // Step 2: Apply inverse scale immediately via DOM (synchronous!)
    lanes.style.transform = `scaleX(${scaleRatio})`;
    header.style.transform = `scaleX(${scaleRatio})`;

    // Step 3: Adjust scroll to keep the same content centered
    // The position that was at viewportCenterX is now at viewportCenterX * (newDayWidth/oldDayWidth)
    const newCenterX = viewportCenterX * (dayWidth / prevDayWidthRef.current);
    scroll.scrollLeft = Math.max(0, newCenterX - viewportWidth / 2);

    // Step 4: In next frame, enable transition and animate to scale(1)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lanes.classList.add(styles.zooming);
        header.classList.add(styles.zooming);
        lanes.style.transform = '';
        header.style.transform = '';

        // Step 5: After animation completes, clean up
        zoomTimeoutRef.current = window.setTimeout(() => {
          lanes.classList.remove(styles.zooming);
          header.classList.remove(styles.zooming);
          zoomTimeoutRef.current = null;
        }, 300); // Match CSS transition duration
      });
    });

    prevDayWidthRef.current = dayWidth;
  }, [dayWidth]);

  // Cleanup zoom timeout on unmount
  useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current !== null) {
        clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, []);

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
  const [hoveredItemId, setHoveredItemId] = useState<{ projectId: string } | null>(null);

  // Leave context menu state
  const [leaveContextMenu, setLeaveContextMenu] = useState<{
    x: number;
    y: number;
    memberId: string;
    date: string;
  } | null>(null);

  // Period marker context menu state (for adding new markers)
  const [periodMarkerContextMenu, setPeriodMarkerContextMenu] = useState<{
    x: number;
    y: number;
    date: string;
  } | null>(null);

  // Item context menu state (for editing/deleting existing period markers)
  const [periodMarkerItemMenu, setPeriodMarkerItemMenu] = useState<{
    x: number;
    y: number;
    markerId: string;
    marker: PeriodMarkerType;
  } | null>(null);

  // Edit form for period markers (opened from item context menu)
  const [periodMarkerEditMenu, setPeriodMarkerEditMenu] = useState<{
    x: number;
    y: number;
    marker: PeriodMarkerType;
  } | null>(null);

  // Item context menu state (for editing/deleting existing leave blocks)
  const [leaveBlockItemMenu, setLeaveBlockItemMenu] = useState<{
    x: number;
    y: number;
    leaveId: string;
    memberId: string;
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
  // Uses useLayoutEffect for synchronous DOM updates before paint
  // This prevents visual flicker when sidebar remounts after exiting fullscreen
  useLayoutEffect(() => {
    const scrollEl = scrollRef.current;
    const sidebarContentEl = sidebarContentRef.current;
    if (!scrollEl || !sidebarContentEl) return;

    let rafId: number | null = null;
    let lastScrollTop = scrollEl.scrollTop;

    // The sidebar is positioned purely via transform, so its own native scrollTop
    // must stay 0. A focus-driven scrollIntoView can force it non-zero, which the
    // transform sync wouldn't account for — labels then drift from their rows.
    // Neutralise any such drift whenever we sync.
    const resetSidebarNativeScroll = () => {
      const sidebarEl = sidebarRef.current;
      if (sidebarEl && sidebarEl.scrollTop !== 0) sidebarEl.scrollTop = 0;
    };

    // Apply initial scroll position synchronously before paint
    // Critical for preventing desync when sidebar remounts after exiting fullscreen
    sidebarContentEl.style.transform = `translate3d(0, -${lastScrollTop}px, 0)`;
    resetSidebarNativeScroll();

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
        resetSidebarNativeScroll();
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
  }, [isFullscreen]); // Re-run when fullscreen changes to sync sidebar after it remounts

  // Handle right-click on lane to add leave
  const handleLaneContextMenu = useCallback((
    e: React.MouseEvent,
    memberId: string
  ) => {
    if (isLocked || !onAddLeaveBlock) return;

    // Use elementsFromPoint to detect elements at any z-index (period markers render before lanes in DOM)
    const elementsAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
    const periodMarkerEl = elementsAtPoint.find(el => el.hasAttribute('data-period-marker'));
    const leaveBlockEl = elementsAtPoint.find(el => el.hasAttribute('data-leave-block'));

    // If clicking on a period marker, show its context menu instead
    if (periodMarkerEl) {
      e.preventDefault();
      const markerId = periodMarkerEl.getAttribute('data-period-marker');
      const marker = markerId ? periodMarkers.find(m => m.id === markerId) : undefined;
      if (markerId && marker) {
        setPeriodMarkerItemMenu({
          x: e.clientX,
          y: e.clientY,
          markerId,
          marker
        });
      }
      return;
    }

    // If clicking on a leave block, let it handle its own context menu
    if (leaveBlockEl) {
      return;
    }

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

    const dateStr = format(clickDate, 'yyyy-MM-dd');

    setLeaveContextMenu({
      x: e.clientX,
      y: e.clientY,
      memberId,
      date: dateStr
    });
  }, [isLocked, onAddLeaveBlock, dayWidth, timelineStart, periodMarkers]);

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
  const { projectsByOwner, projectStacksByOwner } = useMemo(() => {
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

    return { projectsByOwner: grouped, projectStacksByOwner: stacksByOwner };
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

  // Calculate lane heights from where each pill sits on the slot grid. A pill's
  // bottom is its slot top (offset * SLOT_PITCH) plus its own height, so the stack
  // is as tall as the lowest pill bottom — floored at the full 4-slot capacity
  // frame so light lanes still reserve it, and growing past it when a member is
  // over-allocated so every stacked pill stays visible.
  // Lanes a filter has emptied. Only populated while `slimEmptyLanes` is on, so
  // an unfiltered board keeps its full-height empty state.
  const emptyLaneIds = useMemo(() => {
    const ids = new Set<string>();
    if (!slimEmptyLanes) return ids;
    displayedTeamMembers.forEach(member => {
      if ((projectsByOwner[member.name]?.length ?? 0) === 0) ids.add(member.id);
    });
    return ids;
  }, [slimEmptyLanes, displayedTeamMembers, projectsByOwner]);

  const laneHeights = useMemo(() => {
    const heights: number[] = [];
    // The 4-slot frame: four stacked Smalls (3 gaps between them). This equals
    // heightForSize('full-time') by construction — a full-capacity pill fills it
    // exactly — but is kept as its own expression to stay independent of size.
    const capacityFrame = (CAPACITY - 1) * SLOT_PITCH + UNIT_HEIGHT;

    displayedTeamMembers.forEach(member => {
      // Use collapsed height for collapsed lanes
      if (collapsedLanes.has(member.id)) {
        heights.push(COLLAPSED_LANE_HEIGHT);
        return;
      }

      // Filtered down to nothing — don't reserve the capacity frame for a lane
      // with no pills in it.
      if (emptyLaneIds.has(member.id)) {
        heights.push(EMPTY_LANE_HEIGHT);
        return;
      }

      const ownerProjects = projectsByOwner[member.name] || [];
      const stacks = projectStacksByOwner[member.name];

      const maxBottom = ownerProjects.reduce((max, p) => {
        const offset = stacks?.get(p.id) ?? 0;
        const bottom = offset * SLOT_PITCH + heightForSize(p.size ?? DEFAULT_SIZE);
        return Math.max(max, bottom);
      }, 0);

      const stackPx = Math.max(maxBottom, capacityFrame);
      const height = Math.max(MIN_LANE_HEIGHT, stackPx + LANE_PADDING * 2 + LANE_BOTTOM_BUFFER);
      heights.push(height);
    });

    return heights;
  }, [displayedTeamMembers, projectsByOwner, projectStacksByOwner, collapsedLanes, emptyLaneIds]);

  // Over-allocation markers per owner. Capacity is no longer a hard limit — a
  // member can be pushed past their 4 slots — so wherever their concurrent load
  // exceeds CAPACITY from today forward we flag the *top-most* pill in that
  // window: the one that visually tips the stack over its 4-slot frame. That pill
  // shows a single clean "!" warning. The Digital Queue is exempt (it's a holding
  // bay — projects are meant to pile up there), so its lane is never flagged.
  const overAllocatedByOwner = useMemo(() => {
    const today = format(new Date(), 'yyyy-MM-dd');
    const byOwner: Record<string, Set<string>> = {};
    displayedTeamMembers.forEach(member => {
      const flagged = new Set<string>();
      if (!collapsedLanes.has(member.id)) {
        // On-hold projects are paused, so they don't count toward the owner's
        // 4-slot load (they stay visible in the row but never trip the over-cap
        // marker), same as the capacity-exempt Digital Queue.
        const owned = (projectsByOwner[member.name] || [])
          .filter(p => !isCapacityExempt(p) && !isOnHold(p.statusColor));
        const stacks = projectStacksByOwner[member.name];

        // Load is piecewise-constant and only steps up at a project start, so it's
        // enough to sample today plus each start that falls today-or-later.
        const samplePoints = new Set<string>([today]);
        owned.forEach(p => { if (p.startDate >= today) samplePoints.add(p.startDate); });

        samplePoints.forEach(date => {
          const active = owned.filter(p => p.startDate <= date && date <= p.endDate);
          const load = active.reduce((sum, p) => sum + slotsFor(p.size ?? DEFAULT_SIZE), 0);
          if (load > CAPACITY && active.length > 0) {
            const top = active.reduce((a, b) =>
              ((stacks?.get(b.id) ?? 0) > (stacks?.get(a.id) ?? 0) ? b : a));
            flagged.add(top.id);
          }
        });
      }
      byOwner[member.name] = flagged;
    });
    return byOwner;
  }, [displayedTeamMembers, projectsByOwner, projectStacksByOwner, collapsedLanes]);

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

  // Top (px, within the lane) of a pill at a given slot offset: lane padding plus
  // one SLOT_PITCH per slot row above it.
  const getStackTopOffset = useCallback((slotOffset: number): number => {
    return LANE_PADDING + slotOffset * SLOT_PITCH;
  }, []);

  // Store lane positions in ref for dependency calculation
  const lanePositionsRef = useRef(lanePositions);
  useEffect(() => {
    lanePositionsRef.current = lanePositions;
  }, [lanePositions]);

  const totalLanesHeight = lanePositions.length > 0 && laneHeights.length > 0
    ? lanePositions[lanePositions.length - 1] + laneHeights[laneHeights.length - 1]
    : 0;

  // Create owner name to member ID lookup for collapsed lane checks
  const ownerNameToMemberId = useMemo(() => {
    const map = new Map<string, string>();
    displayedTeamMembers.forEach(member => {
      map.set(member.name, member.id);
    });
    return map;
  }, [displayedTeamMembers]);

  // Memoize dependency lines to prevent recalculation on every render
  const dependencyElements = useMemo(() => {
    return dependencies.map((dep, index) => {
      const fromProject = projectsById.get(dep.fromProjectId);
      const toProject = projectsById.get(dep.toProjectId);
      if (!fromProject || !toProject) return null;

      // Hide dependencies when either project's lane is collapsed
      const fromMemberId = ownerNameToMemberId.get(fromProject.owner);
      const toMemberId = ownerNameToMemberId.get(toProject.owner);
      if ((fromMemberId && collapsedLanes.has(fromMemberId)) ||
          (toMemberId && collapsedLanes.has(toMemberId))) {
        return null;
      }

      return (
        <DependencyLine
          key={dep.id}
          fromProject={fromProject}
          toProject={toProject}
          timelineStart={timelineStart}
          dayWidth={dayWidth}
          projectStacks={globalProjectStacks}
          lanePositions={lanePositions}
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
  }, [dependencies, projectsById, timelineStart, dayWidth, globalProjectStacks, lanePositions, ownerToLaneIndex, hoveredDepId, hoveredItemId, onRemoveDependency, onUpdateDependency, newDependencyIds, ownerNameToMemberId, collapsedLanes]);

  return (
    <DependencyCreationProvider onAddDependency={onAddDependency}>
    <div id="timeline-container" className={`${styles.container} ${isFullscreen ? styles.fullscreen : ''}`}>
      {/* Fixed left sidebar with team members - hidden in fullscreen */}
      {!isFullscreen && (
      <div ref={sidebarRef} className={`${styles.sidebar} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
        <div className={styles.sidebarHeader}>
          {sidebarCollapsed ? (
            <button
              className={styles.collapseSidebarBtn}
              onClick={() => setSidebarCollapsed(false)}
              title="Expand team panel"
              aria-label="Expand team panel"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <>
              <span>Team</span>
              <div className={styles.sidebarHeaderActions}>
                <button
                  className={styles.addMemberHeaderBtn}
                  onClick={onAddTeamMember}
                  disabled={isLocked}
                  title="Add team member"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                <button
                  className={styles.collapseSidebarBtn}
                  onClick={() => setSidebarCollapsed(true)}
                  title="Collapse team panel"
                  aria-label="Collapse team panel"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 3L5 7l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </>
          )}
        </div>
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
                    isCollapsed={collapsedLanes.has(member.id)}
                    isEmpty={emptyLaneIds.has(member.id)}
                    railMode={sidebarCollapsed}
                    onToggleCollapse={onToggleLaneCollapse ? () => onToggleLaneCollapse(member.id) : undefined}
                    onEdit={() => onEditTeamMember(member)}
                    onAddProject={() => onAddProject(member.name)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
          {!sidebarCollapsed && (
            <button className={styles.addMemberBtn} onClick={onAddTeamMember} disabled={isLocked}>
              + Add Team Member
            </button>
          )}
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
          <div
            ref={headerRef}
            className={styles.header}
            style={{ width: totalWidth }}
          >
            {displayMode === 'year' ? (
              fySegments.map(({ fy, left, width }) => (
                <div key={fy} className={styles.fyHeader} style={{ left, width }}>
                  <span className={styles.fyLabel}>FY{fy}</span>
                </div>
              ))
            ) : (
              <>
                {/* Tier 1 — fiscal quarter / FY band */}
                {quarterSegments.map(({ key, label, left, width, isFyStart }) => (
                  <div
                    key={key}
                    className={`${styles.quarterHeader} ${isFyStart ? styles.quarterHeaderFyStart : ''}`}
                    style={{ left, width }}
                  >
                    <span className={styles.quarterLabel}>{label}</span>
                  </div>
                ))}
                {/* Tier 2 — months */}
                {monthMarkers.map(({ label, left, width, date }, i) => (
                  <div
                    key={i}
                    className={`${styles.monthHeader} ${displayMode === 'week' ? styles.weekZoom : styles.monthZoom}`}
                    style={{ left, width }}
                    onContextMenu={(e) => handleHeaderContextMenu(e, date)}
                  >
                    <span className={styles.monthLabel}>{label}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Lanes */}
          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragEnd={handleProjectDragEnd}
          >
            <div
              ref={lanesRef}
              className={styles.lanes}
              data-lanes-container
              style={{ width: totalWidth, minHeight: totalLanesHeight }}
            >
              {/* Grid lines */}
              {displayMode === 'year' && fySegments.map(({ fy, left, width }) => (
                <div key={`q-${fy}`}>
                  {[0, 1, 2, 3].map(q => (
                    <div key={q} className={styles.gridLine} style={{ left: left + (width / 4) * q }} />
                  ))}
                </div>
              ))}
              {displayMode !== 'year' && (
                <>
                  {/* Faint month lines */}
                  {monthMarkers.map(({ left }, i) => (
                    <div key={`m-${i}`} className={styles.gridLine} style={{ left }} />
                  ))}
                  {/* Stronger quarter lines, strongest at FY boundaries */}
                  {quarterSegments.map(({ key, left, isFyStart }) => (
                    left > 0 ? (
                      <div
                        key={`q-${key}`}
                        className={isFyStart ? styles.gridLineFy : styles.gridLineQuarter}
                        style={{ left }}
                      />
                    ) : null
                  ))}
                </>
              )}

              {/* Period markers (full-height colored bands) */}
              {periodMarkers.map((marker) => (
                <PeriodMarker
                  key={marker.id}
                  marker={marker}
                  timelineStart={timelineStart}
                  dayWidth={dayWidth}
                  totalHeight={totalLanesHeight}
                  isLocked={isLocked}
                  onContextMenu={(e) => setPeriodMarkerItemMenu({
                    x: e.clientX,
                    y: e.clientY,
                    markerId: marker.id,
                    marker
                  })}
                />
              ))}

              {/* Today line */}
              {todayPosition >= 0 && todayPosition <= totalWidth && (
                <div className={styles.todayLine} style={{ left: todayPosition }}>
                  <span className={styles.todayCap} />
                  <div className={styles.todayLabel}>Today</div>
                </div>
              )}

              {/* Dependencies SVG layer - hidden in fullscreen mode */}
              {!isFullscreen && (
              <svg
                className={styles.dependenciesLayer}
                style={{ width: totalWidth, height: totalLanesHeight }}
              >
                {dependencyElements}
              </svg>
              )}

              {/* Project lanes */}
              {displayedTeamMembers.map((member, idx) => {
                const stacks = projectStacksByOwner[member.name];
                const memberLeaves = leaveBlocksByMember[member.id] || [];
                const isLaneCollapsed = collapsedLanes.has(member.id);
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
                    isCollapsed={isLaneCollapsed}
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
                        onContextMenu={(e) => setLeaveBlockItemMenu({
                          x: e.clientX,
                          y: e.clientY,
                          leaveId: leave.id,
                          memberId: member.id
                        })}
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
                        stackTopOffset={getStackTopOffset(stackIdx)}
                        laneTop={lanePositions[idx]}
                        isSelected={project.id === selectedProjectId}
                        isOverAllocated={overAllocatedByOwner[member.name]?.has(project.id)}
                        isLocked={isLocked}
                        onUpdate={(updates) => onUpdateProject(project.id, updates)}
                        onDelete={() => onDeleteProject(project.id)}
                        onEdit={() => onEditProject(project)}
                        onCopy={onCopyProject ? () => onCopyProject(project) : undefined}
                        onSelect={onSelectProject ? () => onSelectProject(project) : undefined}
                        onEdgeDrag={handleEdgeDrag}
                        onHoverChange={(hovered) => setHoveredItemId(
                          hovered ? { projectId: project.id } : null
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

      {/* Period marker context menu (for adding new markers) */}
      {periodMarkerContextMenu && onAddPeriodMarker && (
        <PeriodMarkerContextMenu
          x={periodMarkerContextMenu.x}
          y={periodMarkerContextMenu.y}
          date={periodMarkerContextMenu.date}
          onAddMarker={onAddPeriodMarker}
          onClose={() => setPeriodMarkerContextMenu(null)}
        />
      )}

      {/* Period marker item context menu (edit/delete existing marker) */}
      {periodMarkerItemMenu && (
        <ItemContextMenu
          x={periodMarkerItemMenu.x}
          y={periodMarkerItemMenu.y}
          title={periodMarkerItemMenu.marker.label || 'Period Marker'}
          onEdit={onEditPeriodMarker ? () => {
            setPeriodMarkerEditMenu({
              x: periodMarkerItemMenu.x,
              y: periodMarkerItemMenu.y,
              marker: periodMarkerItemMenu.marker
            });
          } : undefined}
          onDelete={onDeletePeriodMarker ? () => {
            onDeletePeriodMarker(periodMarkerItemMenu.markerId);
          } : undefined}
          onClose={() => setPeriodMarkerItemMenu(null)}
        />
      )}

      {/* Period marker edit form */}
      {periodMarkerEditMenu && onEditPeriodMarker && (
        <PeriodMarkerContextMenu
          x={periodMarkerEditMenu.x}
          y={periodMarkerEditMenu.y}
          date={periodMarkerEditMenu.marker.startDate}
          initialValues={periodMarkerEditMenu.marker}
          onAddMarker={(data) => {
            onEditPeriodMarker(periodMarkerEditMenu.marker.id, data);
          }}
          onClose={() => setPeriodMarkerEditMenu(null)}
        />
      )}

      {/* Leave block item context menu (edit/delete existing leave) */}
      {leaveBlockItemMenu && (
        <ItemContextMenu
          x={leaveBlockItemMenu.x}
          y={leaveBlockItemMenu.y}
          title="Annual Leave"
          onDelete={onDeleteLeaveBlock ? () => {
            onDeleteLeaveBlock(leaveBlockItemMenu.leaveId);
          } : undefined}
          onClose={() => setLeaveBlockItemMenu(null)}
        />
      )}

      {/* Fullscreen floating controls - Today button + zoom */}
      {isFullscreen && (
        <div className={styles.fullscreenControls}>
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
          {onDayWidthChange && (
            <div className={styles.fullscreenZoom}>
              <button
                className={styles.fullscreenZoomBtn}
                onClick={() => onDayWidthChange(Math.max(0.5, dayWidth / 1.3))}
                title="Zoom out (⌘−)"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
              <span className={styles.fullscreenZoomLabel}>
                {displayMode === 'year' ? 'Year' : displayMode === 'week' ? 'Week' : 'Month'}
              </span>
              <button
                className={styles.fullscreenZoomBtn}
                onClick={() => onDayWidthChange(Math.min(12, dayWidth * 1.3))}
                title="Zoom in (⌘+)"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 3V11M3 7H11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
    </DependencyCreationProvider>
  );
});
