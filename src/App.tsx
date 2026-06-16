import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useRoadmap } from './hooks/useRoadmap';
import { useUndoManager, createInverse } from './hooks/useUndoManager';
import { useClipboard } from './hooks/useClipboard';
import { useToast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { Timeline, type TimelineRef } from './components/Timeline';
import { Modal } from './components/Modal';
import type { Project, Milestone, TeamMember, Dependency, LeaveType, LeaveCoverage } from './types';
import { isProject } from './types';
import type { FilterState, ProjectStatus } from './components/SearchFilter';
import { getSuggestedProjectDates, parseLocalDate, toDateString, isDatePast } from './utils/dateUtils';
import { evaluateAssignment, formatCapacityMessage, isCapacityExempt, DEFAULT_SIZE, type CapacityItem, type ProjectSize } from './utils/capacity';
import { getStatusSlugByHex, normalizeStatusColor } from './utils/statusColors';
import { hasModifierKey } from './utils/platformUtils';
import { TimelineSkeleton } from './components/Skeleton';
import { OfflineBanner } from './components/OfflineBanner';
import { usePresence } from './hooks/usePresence';
import { VaultUnlock } from './components/VaultUnlock';
import { generateSessionId } from './utils/gameUtils';
import styles from './App.module.css';

// Lazy load form components (not needed until user clicks)
const ProjectForm = lazy(() => import('./components/ProjectForm').then(m => ({ default: m.ProjectForm })));
const TeamMemberForm = lazy(() => import('./components/TeamMemberForm').then(m => ({ default: m.TeamMemberForm })));
const ShortcutsModal = lazy(() => import('./components/ShortcutsModal').then(m => ({ default: m.ShortcutsModal })));

// Sanitize error messages to prevent XSS
function sanitizeError(error: string): string {
  return String(error).replace(/<[^>]*>/g, '').trim();
}

type ModalType =
  | { type: 'add-project'; ownerName: string; suggestedStart: string; suggestedEnd: string }
  | { type: 'edit-project'; project: Project }
  | { type: 'add-member' }
  | { type: 'edit-member'; member: TeamMember }
  | null;

// Generate a simple user ID for this session (in production, use auth)
const getSessionInfo = () => {
  // userId is always per-tab (sessionStorage) so two tabs = two players.
  // userName is stored in localStorage so it survives tab close/reopen for
  // game reconnection by name matching.
  let userId = sessionStorage.getItem('roadmap-user-id');
  let userName = localStorage.getItem('roadmap-user-name') || sessionStorage.getItem('roadmap-user-name');

  if (!userId) {
    userId = generateSessionId();
    sessionStorage.setItem('roadmap-user-id', userId);
  }

  if (!userName) {
    // Generate anonymous user name
    const adjectives = ['Swift', 'Bright', 'Calm', 'Bold', 'Keen', 'Wise', 'Quick', 'Sharp'];
    const nouns = ['Planner', 'Builder', 'Mapper', 'Maker', 'Viewer', 'Editor', 'Designer', 'Thinker'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    userName = `${adj} ${noun}`;
  }
  localStorage.setItem('roadmap-user-name', userName);
  sessionStorage.setItem('roadmap-user-name', userName);

  return { userId, userName };
};

// Get session info once at module load
const sessionInfo = getSessionInfo();

const formFallback = <div className={styles.formLoading}><span className={styles.spinner} /></div>;

function App() {
  const { showToast } = useToast();
  const {
    data,
    loading,
    saveError,
    isOnline,
    isSaving,
    lastSaved,
    newDependencyIds,
    clearError,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    reorderTeamMembers,
    addProject,
    updateProject,
    deleteProject,
    addDependency,
    removeDependency,
    updateDependency,
    addLeaveBlock,
    deleteLeaveBlock,
    addPeriodMarker,
    updatePeriodMarker,
    deletePeriodMarker
  } = useRoadmap();

  // Real-time presence for collaboration
  const { users: presenceUsers } = usePresence({
    sessionId: sessionInfo.userId,
    userName: sessionInfo.userName,
    enabled: isOnline
  });

  const [modal, setModal] = useState<ModalType>(null);
  // Zoom level persistence - load from localStorage
  const [dayWidth, setDayWidth] = useState(() => {
    try {
      const stored = localStorage.getItem('roadmap-zoom');
      if (stored) {
        const parsed = parseFloat(stored);
        if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 12) {
          return parsed;
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return 3; // Default to month view (3 px/day)
  });

  // Save zoom level to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem('roadmap-zoom', String(dayWidth));
    } catch {
      // Ignore localStorage errors
    }
  }, [dayWidth]);

  // Collapsed lanes state - persisted to localStorage
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('roadmap-collapsed-lanes');
      if (stored) {
        return new Set(JSON.parse(stored));
      }
    } catch {
      // Ignore localStorage errors
    }
    return new Set();
  });

  // Save collapsed lanes to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem('roadmap-collapsed-lanes', JSON.stringify(Array.from(collapsedLanes)));
    } catch {
      // Ignore localStorage errors
    }
  }, [collapsedLanes]);

  // Toggle lane collapse
  const toggleLaneCollapse = useCallback((memberId: string) => {
    setCollapsedLanes(prev => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  }, []);

  // Ref for Timeline to call scrollToToday
  const timelineRef = useRef<TimelineRef>(null);
  // Filter persistence - load from localStorage
  const [filters, setFilters] = useState<FilterState>(() => {
    try {
      const stored = localStorage.getItem('roadmap-filters');
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate structure and return, but always clear search on fresh load
        if (parsed && typeof parsed === 'object') {
          return {
            search: '', // Always start with empty search
            owners: Array.isArray(parsed.owners) ? parsed.owners : [],
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            dateRange: parsed.dateRange || null,
            status: parsed.status || 'all'
          };
        }
      }
    } catch {
      // Ignore localStorage errors
    }
    return {
      search: '',
      owners: [],
      tags: [],
      dateRange: null,
      status: 'all'
    };
  });

  // Save filters to localStorage when they change (debounced, excluding search)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        // Don't persist search text, only the filter selections
        const toStore = {
          owners: filters.owners,
          tags: filters.tags,
          dateRange: filters.dateRange,
          status: filters.status
        };
        localStorage.setItem('roadmap-filters', JSON.stringify(toStore));
      } catch {
        // Ignore localStorage errors
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [filters.owners, filters.tags, filters.dateRange, filters.status]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenHint, setShowFullscreenHint] = useState(false);
  const fullscreenHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredMember, setHoveredMember] = useState<string | null>(null);

  // Ref to avoid re-registering keyboard handler on every Firebase snapshot
  const projectsRef = useRef(data.projects);
  useEffect(() => {
    projectsRef.current = data.projects;
  }, [data.projects]);

  // Shared capacity guard. Given a candidate placement, returns an error message
  // if it would push the owner over CAPACITY, or null if it fits / is exempt.
  // Reads the live project list from a ref so it has no reactive deps and is
  // safe to call from the keyboard handler without re-registering listeners.
  // Every path that moves work onto a member — drag/resize, keyboard date-shift,
  // and duplicate — funnels through here so the ceiling is enforced uniformly.
  const checkCapacityFit = useCallback(
    (candidate: { id: string; owner?: string; title?: string; startDate: string; endDate: string; size?: ProjectSize }): string | null => {
      if (!candidate.owner || isCapacityExempt(candidate)) return null;
      const byOwner: Record<string, CapacityItem[]> = {};
      projectsRef.current.forEach(p => {
        if (!p.owner) return;
        if (isCapacityExempt(p)) return;
        (byOwner[p.owner] ??= []).push(p);
      });
      const item: CapacityItem = {
        id: candidate.id,
        startDate: candidate.startDate,
        endDate: candidate.endDate,
        size: candidate.size ?? DEFAULT_SIZE,
      };
      const verdict = evaluateAssignment(byOwner, item, candidate.owner, toDateString(new Date()));
      return verdict.fits ? null : (formatCapacityMessage(verdict, candidate.owner, item.size) ?? 'Over capacity');
    },
    []
  );

  // View mode lock — always starts locked; unlock is session-only (resets on tab close)
  const [isLocked, setIsLocked] = useState(true);
  const [showVaultUnlock, setShowVaultUnlock] = useState(false);

  // Toggle lock — unlocking requires vault PIN entry
  const handleToggleLock = useCallback(() => {
    if (isLocked) {
      setShowVaultUnlock(true);
    } else {
      setIsLocked(true);
    }
  }, [isLocked]);

  const handleVaultUnlocked = useCallback(() => {
    setShowVaultUnlock(false);
    setIsLocked(false);
  }, []);

  const handleVaultCancel = useCallback(() => {
    setShowVaultUnlock(false);
  }, []);

  // Cleanup fullscreen hint timeout on unmount
  useEffect(() => {
    return () => {
      if (fullscreenHintTimeoutRef.current) {
        clearTimeout(fullscreenHintTimeoutRef.current);
      }
    };
  }, []);

  // Show save errors as toasts
  useEffect(() => {
    if (saveError) {
      showToast(sanitizeError(saveError), 'error');
      clearError();
    }
  }, [saveError, showToast, clearError]);

  // Undo manager
  const {
    recordAction,
    undo,
    redo,
    canUndo,
    canRedo
  } = useUndoManager({ userId: sessionInfo.userId });

  // Handle paste from clipboard
  const handlePasteProject = useCallback(async (project: Omit<Project, 'id'>) => {
    await addProject(project);
  }, [addProject]);

  // Clipboard
  const {
    copyProject,
    paste,
    hasContent: hasClipboard,
    setSelectedProject
  } = useClipboard({
    onPasteProject: handlePasteProject,
    onShowToast: showToast
  });

  const closeModal = useCallback(() => setModal(null), []);

  // Determine the display status of a project based on its dates and color
  const getProjectDisplayStatus = useCallback((project: Project): ProjectStatus => {
    const today = new Date();
    const startDate = parseLocalDate(project.startDate);

    // Past projects are always "complete" (auto-blue). Compare at day
    // granularity (via isDatePast) so a project on its final day still counts
    // as active — matches ProjectBar, which also uses isDatePast. A time-of-day
    // comparison would mis-classify a project ending today as complete.
    if (isDatePast(project.endDate)) {
      return 'complete';
    }

    // For active/future projects, determine status from color (handles legacy hex values)
    const slug = getStatusSlugByHex(project.statusColor);
    if (slug && slug !== 'complete') {
      return slug as ProjectStatus;
    }

    // Default: if start date is in future, it's "to-start", otherwise "on-track"
    if (startDate > today) return 'to-start';
    return 'on-track';
  }, []);

  // Pre-compute filter Sets for O(1) lookups
  const filterSets = useMemo(() => ({
    owners: new Set(filters.owners),
    tags: new Set(filters.tags),
    searchQuery: filters.search.trim().toLowerCase()
  }), [filters.owners, filters.tags, filters.search]);

  // Filter projects based on current filters (optimized with Sets)
  const filteredProjects = useMemo(() => {
    const { owners, tags, searchQuery } = filterSets;
    const hasOwnerFilter = owners.size > 0;
    const hasTagFilter = tags.size > 0;
    const hasStatusFilter = filters.status !== 'all';
    const hasSearchFilter = searchQuery.length > 0;

    // Early return if no filters
    if (!hasOwnerFilter && !hasTagFilter && !hasStatusFilter && !hasSearchFilter) {
      return data.projects;
    }

    return data.projects.filter(p => {
      // Filter by owners (O(1) lookup)
      if (hasOwnerFilter && !owners.has(p.owner)) {
        return false;
      }

      // Filter by status
      if (hasStatusFilter && getProjectDisplayStatus(p) !== filters.status) {
        return false;
      }

      // Filter by search
      if (hasSearchFilter) {
        const titleMatch = p.title.toLowerCase().includes(searchQuery);
        const ownerMatch = p.owner.toLowerCase().includes(searchQuery);
        if (!titleMatch && !ownerMatch) return false;
      }

      return true;
    });
  }, [data.projects, filterSets, filters.status, getProjectDisplayStatus]);

  // Scroll to project when selected from search
  const handleProjectSelect = useCallback((projectId: string) => {
    // Clear any existing timeout
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current);
    }
    setSelectedProjectId(projectId);

    // Update URL hash for deep linking (shareable link)
    try {
      const url = new URL(window.location.href);
      url.hash = `project=${projectId}`;
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Ignore URL errors
    }

    // The Timeline component will handle scrolling
    selectionTimeoutRef.current = setTimeout(() => setSelectedProjectId(null), 2000);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (selectionTimeoutRef.current) {
        clearTimeout(selectionTimeoutRef.current);
      }
    };
  }, []);

  // URL Deep Linking - scroll to project from URL hash on initial load
  const hasHandledDeepLink = useRef(false);
  useEffect(() => {
    if (loading || hasHandledDeepLink.current || data.projects.length === 0) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const hash = window.location.hash;
      if (hash.startsWith('#project=')) {
        const projectId = hash.replace('#project=', '');
        const project = data.projects.find(p => p.id === projectId);
        if (project) {
          hasHandledDeepLink.current = true;
          // Use setTimeout to ensure Timeline is rendered
          timer = setTimeout(() => handleProjectSelect(projectId), 100);
        }
      }
    } catch {
      // Ignore URL parsing errors
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [loading, data.projects, handleProjectSelect]);

  // Handle undo
  const handleUndo = useCallback(() => {
    const action = undo();
    if (!action) return;

    // Validate inverse structure
    const inverse = action.inverse;
    if (!inverse || typeof inverse !== 'object') {
      console.warn('Invalid undo action: inverse data missing or malformed');
      return;
    }
    const inverseObj = inverse as { action?: string; data?: unknown };
    if (typeof inverseObj.action !== 'string' || inverseObj.data === undefined) {
      console.warn('Invalid undo action: missing action or data property');
      return;
    }

    // Apply the inverse action with type validation
    switch (action.type) {
      case 'CREATE_PROJECT':
        if (inverseObj.action === 'delete' && isProject(inverseObj.data)) {
          deleteProject(inverseObj.data.id);
        } else if (inverseObj.action === 'delete') {
          console.warn('Undo CREATE_PROJECT failed: data is not a valid Project');
        }
        break;
      case 'DELETE_PROJECT':
        if (inverseObj.action === 'restore' && isProject(inverseObj.data)) {
          addProject(inverseObj.data);
          // Restore dependencies that were cleaned up with the project
          const deps = (inverse as { dependencies?: Dependency[] }).dependencies;
          if (deps && deps.length > 0) {
            for (const dep of deps) {
              addDependency(
                dep.fromProjectId, dep.toProjectId,
                undefined, undefined, dep.type
              ).catch(() => { /* target may have been deleted */ });
            }
          }
        } else if (inverseObj.action === 'restore') {
          console.warn('Undo DELETE_PROJECT failed: data is not a valid Project');
        }
        break;
      case 'UPDATE_PROJECT':
        if (inverseObj.action === 'update' && isProject(inverseObj.data)) {
          updateProject(inverseObj.data.id, inverseObj.data);
        } else if (inverseObj.action === 'update') {
          console.warn('Undo UPDATE_PROJECT failed: data is not a valid Project');
        }
        break;
      // Currently only project operations are recorded for undo.
      // Milestone, member, dependency, and leave types are defined in the
      // ActionType union but not yet wired into recordAction calls.
      default:
        console.warn(`Undo not implemented for action type: ${action.type}`);
        break;
    }
  }, [undo, deleteProject, addProject, updateProject, addDependency]);

  // Handle redo
  const handleRedo = useCallback(() => {
    const action = redo();
    if (!action) return;

    // Apply the original action with type validation
    switch (action.type) {
      case 'CREATE_PROJECT': {
        if (isProject(action.data)) {
          addProject(action.data);
        } else {
          console.warn('Redo CREATE_PROJECT failed: data is not a valid Project');
        }
        break;
      }
      case 'DELETE_PROJECT': {
        if (isProject(action.data)) {
          deleteProject(action.data.id);
        } else {
          console.warn('Redo DELETE_PROJECT failed: data is not a valid Project');
        }
        break;
      }
      case 'UPDATE_PROJECT': {
        if (isProject(action.data)) {
          updateProject(action.data.id, action.data);
        } else {
          console.warn('Redo UPDATE_PROJECT failed: data is not a valid Project');
        }
        break;
      }
    }
  }, [redo, addProject, deleteProject, updateProject]);

  // Keyboard shortcuts for undo/redo, shortcuts modal, and fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // F11 or Cmd/Ctrl+Shift+F to toggle fullscreen
      if (e.key === 'F11' || (hasModifierKey(e) && e.shiftKey && e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        setIsFullscreen(prev => {
          const newValue = !prev;
          // Clear any pending hint timeout from a previous toggle
          if (fullscreenHintTimeoutRef.current) {
            clearTimeout(fullscreenHintTimeoutRef.current);
            fullscreenHintTimeoutRef.current = null;
          }
          if (newValue) {
            setShowFullscreenHint(true);
            fullscreenHintTimeoutRef.current = setTimeout(() => {
              setShowFullscreenHint(false);
              fullscreenHintTimeoutRef.current = null;
            }, 3000);
          } else {
            setShowFullscreenHint(false);
          }
          return newValue;
        });
        return;
      }

      // Escape to exit fullscreen or deselect (always handle, even in inputs)
      if (e.key === 'Escape') {
        e.preventDefault();
        if (isFullscreen) {
          setIsFullscreen(false);
        } else if (selectedProjectId) {
          // Clear selection
          setSelectedProjectId(null);
          // Also clear URL hash
          try {
            const url = new URL(window.location.href);
            url.hash = '';
            window.history.replaceState({}, '', url.toString());
          } catch {
            // Ignore URL errors
          }
        }
        return;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Show shortcuts modal with '?'
      if (e.key === '?' && !hasModifierKey(e)) {
        e.preventDefault();
        setShowShortcuts(prev => !prev);
        return;
      }

      // T key to jump to today
      if (e.key.toLowerCase() === 't' && !hasModifierKey(e)) {
        e.preventDefault();
        timelineRef.current?.scrollToToday();
        return;
      }

      // Zoom shortcuts: Cmd+= (zoom in), Cmd+- (zoom out), Cmd+0 (reset)
      if (hasModifierKey(e) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setDayWidth(prev => Math.min(12, prev * 1.3));
        return;
      }
      if (hasModifierKey(e) && e.key === '-') {
        e.preventDefault();
        setDayWidth(prev => Math.max(0.5, prev / 1.3));
        return;
      }
      if (hasModifierKey(e) && e.key === '0') {
        e.preventDefault();
        setDayWidth(3);
        return;
      }

      // Quick create project with N when hovering a lane
      if (e.key.toLowerCase() === 'n' && !hasModifierKey(e) && hoveredMember && !isLocked) {
        e.preventDefault();
        const ownerProjects = projectsRef.current.filter(p => p.owner === hoveredMember);
        const { suggestedStart, suggestedEnd } = getSuggestedProjectDates(ownerProjects);
        setModal({ type: 'add-project', ownerName: hoveredMember, suggestedStart, suggestedEnd });
        return;
      }

      // Duplicate selected project with Cmd+D
      if (hasModifierKey(e) && e.key.toLowerCase() === 'd' && selectedProjectId && !isLocked) {
        e.preventDefault();
        const project = projectsRef.current.find(p => p.id === selectedProjectId);
        if (project) {
          // Duplicate with 1 week offset
          const startDate = parseLocalDate(project.startDate);
          const endDate = parseLocalDate(project.endDate);
          startDate.setDate(startDate.getDate() + 7);
          endDate.setDate(endDate.getDate() + 7);
          const newStart = toDateString(startDate);
          const newEnd = toDateString(endDate);
          // Enforce the same capacity ceiling as drag/resize and the form.
          const capacityError = checkCapacityFit({
            id: '__duplicate__', // sentinel: not in the owner's set, so purely additive
            owner: project.owner,
            title: `${project.title} (copy)`,
            startDate: newStart,
            endDate: newEnd,
            size: project.size ?? DEFAULT_SIZE,
          });
          if (capacityError) {
            showToast(capacityError, 'error');
            return;
          }
          addProject({
            title: `${project.title} (copy)`,
            owner: project.owner,
            startDate: newStart,
            endDate: newEnd,
            statusColor: normalizeStatusColor(project.statusColor),
            size: project.size ?? DEFAULT_SIZE
          }).then(() => {
            showToast('Project duplicated', 'success');
          }).catch(() => {
            // Error feedback handled by useRoadmap's setSaveError
          });
        }
        return;
      }

      // [ and ] to shift selected project dates by 1 week
      if ((e.key === '[' || e.key === ']') && selectedProjectId && !isLocked) {
        e.preventDefault();
        const project = projectsRef.current.find(p => p.id === selectedProjectId);
        if (project) {
          const shift = e.key === ']' ? 7 : -7;
          const startDate = parseLocalDate(project.startDate);
          const endDate = parseLocalDate(project.endDate);
          startDate.setDate(startDate.getDate() + shift);
          endDate.setDate(endDate.getDate() + shift);
          const newStart = toDateString(startDate);
          const newEnd = toDateString(endDate);
          // Enforce the same capacity ceiling as drag/resize and the form.
          const capacityError = checkCapacityFit({ ...project, startDate: newStart, endDate: newEnd });
          if (capacityError) {
            showToast(capacityError, 'error');
            return;
          }
          updateProject(project.id, {
            startDate: newStart,
            endDate: newEnd
          });
        }
        return;
      }

      if (hasModifierKey(e) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (hasModifierKey(e) && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        // Support both Cmd+Shift+Z (Mac) and Ctrl+Y (Windows) for redo
        e.preventDefault();
        handleRedo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, isFullscreen, hoveredMember, isLocked, selectedProjectId, addProject, updateProject, showToast, checkCapacityFit]);

  // Team member handlers
  const handleAddMember = useCallback(
    async (values: { name: string; jobTitle: string }) => {
      try {
        await addTeamMember(values);
        closeModal();
      } catch (error) {
        showToast(`Failed to add member: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    },
    [addTeamMember, closeModal, showToast]
  );

  const handleEditMember = useCallback(
    async (values: { name: string; jobTitle: string }) => {
      if (modal?.type === 'edit-member') {
        try {
          await updateTeamMember(modal.member.id, values);
          closeModal();
        } catch (error) {
          showToast(`Failed to update member: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        }
      }
    },
    [modal, updateTeamMember, closeModal, showToast]
  );

  const handleDeleteMember = useCallback(async () => {
    if (modal?.type === 'edit-member') {
      try {
        await deleteTeamMember(modal.member.id);
        closeModal();
      } catch (error) {
        showToast(`Failed to delete member: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    }
  }, [modal, deleteTeamMember, closeModal, showToast]);

  // Project handlers with undo support
  const handleAddProject = useCallback(
    async (values: Omit<Project, 'id' | 'milestones'> & { milestones?: Milestone[] }) => {
      try {
        // Milestones are no longer created through the form; ignore the field.
        const { milestones: _milestones, ...projectData } = values; // eslint-disable-line @typescript-eslint/no-unused-vars -- field intentionally dropped
        const newProject = await addProject(projectData);
        if (newProject) {
          recordAction('CREATE_PROJECT', newProject, createInverse('CREATE_PROJECT', null, newProject));
        }
        showToast('Project created successfully', 'success');
        closeModal();
      } catch (error) {
        showToast(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    },
    [addProject, closeModal, recordAction, showToast]
  );

  const handleEditProject = useCallback(
    async (values: Omit<Project, 'id' | 'milestones'> & { milestones?: Milestone[] }) => {
      if (modal?.type === 'edit-project') {
        try {
          const beforeState = modal.project;
          // Milestones aren't edited here; omit the field so existing milestone data is preserved.
          const { milestones: _milestones, ...projectData } = values; // eslint-disable-line @typescript-eslint/no-unused-vars -- field intentionally dropped
          await updateProject(modal.project.id, projectData);
          // Record the full merged project (with id + preserved milestones) as the
          // redo target — `projectData`/`values` alone lack an `id`, so redo's
          // isProject() guard would reject it and silently do nothing.
          const afterState: Project = { ...beforeState, ...projectData };
          recordAction('UPDATE_PROJECT', afterState, createInverse('UPDATE_PROJECT', beforeState, afterState));
          closeModal();
        } catch (error) {
          showToast(`Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        }
      }
    },
    [modal, updateProject, closeModal, recordAction, showToast]
  );

  // Capacity-guarded update used by the timeline (drag to reassign / resize).
  // Rejects changes that would push an owner over their 4-slot capacity; the
  // pill reverts to its prior position and a toast explains why.
  const handleTimelineUpdateProject = useCallback(
    async (projectId: string, updates: Partial<Project>) => {
      const current = data.projects.find(p => p.id === projectId);
      const affectsCapacity =
        updates.owner !== undefined ||
        updates.startDate !== undefined ||
        updates.endDate !== undefined ||
        updates.size !== undefined;

      const merged = current ? { ...current, ...updates } : null;
      if (merged && affectsCapacity) {
        const capacityError = checkCapacityFit(merged);
        if (capacityError) {
          showToast(capacityError, 'error');
          return; // reject — ProjectBar reverts its optimistic preview
        }
      }

      await updateProject(projectId, updates);
    },
    [data.projects, updateProject, showToast, checkCapacityFit]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      try {
        const project = data.projects.find(p => p.id === projectId);
        if (project) {
          // Capture dependencies that will be cleaned up by deleteProject
          const affectedDeps = (data.dependencies || []).filter(
            d => d.fromProjectId === projectId || d.toProjectId === projectId
          );
          recordAction('DELETE_PROJECT', project, { action: 'restore', data: project, dependencies: affectedDeps });
          await deleteProject(projectId);
          // Capture the deleted project for a targeted restore, rather than
          // calling generic handleUndo which undoes the *most recent* action
          // (which might not be this delete if the user acted in between).
          const deletedProject = { ...project };
          showToast('Project deleted', {
            type: 'success',
            action: {
              label: 'Undo',
              onClick: async () => {
                await addProject(deletedProject);
                // Restore dependencies that were cleaned up
                for (const dep of affectedDeps) {
                  try {
                    await addDependency(
                      dep.fromProjectId,
                      dep.toProjectId,
                      undefined,
                      undefined,
                      dep.type
                    );
                  } catch {
                    // Dependency restore may fail if target was also deleted
                  }
                }
              }
            }
          });
        }
      } catch (error) {
        showToast(`Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    },
    [data.projects, data.dependencies, deleteProject, recordAction, showToast, addProject, addDependency]
  );

  // Dependency handlers (persisted to Firebase) — project-level only.
  const handleAddDependency = useCallback(async (
    fromProjectId: string,
    toProjectId: string
  ) => {
    try {
      await addDependency(fromProjectId, toProjectId);
      showToast('Dependency created', 'success');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      showToast(errorMsg, 'error');
    }
  }, [addDependency, showToast]);

  const handleRemoveDependency = useCallback(async (depId: string) => {
    try {
      await removeDependency(depId);
      showToast('Dependency removed', 'success');
    } catch (error) {
      showToast(`Failed to remove dependency: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [removeDependency, showToast]);

  const handleUpdateDependency = useCallback(async (depId: string, updates: Partial<Dependency>) => {
    try {
      await updateDependency(depId, updates);
    } catch (error) {
      showToast(`Failed to update dependency: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [updateDependency, showToast]);

  // Leave block handlers
  const handleAddLeaveBlock = useCallback(async (leaveData: {
    memberId: string;
    startDate: string;
    endDate: string;
    type: LeaveType;
    coverage: LeaveCoverage;
    label?: string;
  }) => {
    try {
      await addLeaveBlock(leaveData);
      showToast('Leave added', 'success');
    } catch (error) {
      showToast(`Failed to add leave: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [addLeaveBlock, showToast]);

  const handleDeleteLeaveBlock = useCallback(async (leaveId: string) => {
    try {
      await deleteLeaveBlock(leaveId);
      showToast('Leave removed', 'success');
    } catch (error) {
      showToast(`Failed to remove leave: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [deleteLeaveBlock, showToast]);

  const handleAddPeriodMarker = useCallback(async (markerData: {
    startDate: string;
    endDate: string;
    color: 'grey' | 'yellow' | 'orange' | 'red' | 'green';
    label?: string;
  }) => {
    try {
      await addPeriodMarker(markerData);
      showToast('Period marker added', 'success');
    } catch (error) {
      showToast(`Failed to add marker: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [addPeriodMarker, showToast]);

  const handleDeletePeriodMarker = useCallback(async (markerId: string) => {
    try {
      await deletePeriodMarker(markerId);
      showToast('Marker removed', 'success');
    } catch (error) {
      showToast(`Failed to remove marker: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [deletePeriodMarker, showToast]);

  const handleEditPeriodMarker = useCallback(async (markerId: string, updates: {
    startDate: string;
    endDate: string;
    color: 'grey' | 'yellow' | 'orange' | 'red' | 'green';
    label?: string;
  }) => {
    try {
      await updatePeriodMarker(markerId, updates);
      showToast('Marker updated', 'success');
    } catch (error) {
      showToast(`Failed to update marker: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
    }
  }, [updatePeriodMarker, showToast]);

  const openEditProject = useCallback((project: Project) => {
    setModal({ type: 'edit-project', project });
  }, []);

  if (loading) {
    return (
      <div className={styles.app}>
        <TimelineSkeleton />
      </div>
    );
  }

  return (
    <div className={`${styles.app} ${isFullscreen ? styles.fullscreen : ''}`}>
      {/* Fullscreen hint */}
      {showFullscreenHint && (
        <div className={styles.fullscreenHint}>
          Press Esc to exit fullscreen
        </div>
      )}

      {/* Hide toolbar in fullscreen mode */}
      {!isFullscreen && (
        <Toolbar
          projects={data.projects}
          teamMembers={data.teamMembers}
          dependencies={data.dependencies || []}
          onFilterChange={setFilters}
          onProjectSelect={handleProjectSelect}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={handleUndo}
          onRedo={handleRedo}
          hasClipboard={hasClipboard}
          onPaste={() => paste()}
          dayWidth={dayWidth}
          onDayWidthChange={setDayWidth}
          isSaving={isSaving}
          lastSaved={lastSaved}
          saveError={saveError}
          isOnline={isOnline}
          isLocked={isLocked}
          onToggleLock={handleToggleLock}
          presenceUsers={presenceUsers}
          currentUserId={sessionInfo.userId}
        />
      )}

      <main className={styles.main}>
        <Timeline
          ref={timelineRef}
          projects={filteredProjects}
          teamMembers={data.teamMembers}
          dependencies={data.dependencies || []}
          leaveBlocks={data.leaveBlocks || []}
          dayWidth={dayWidth}
          selectedProjectId={selectedProjectId}
          filteredOwners={filters.owners.length > 0 ? filters.owners : undefined}
          newDependencyIds={newDependencyIds}
          isLocked={isLocked}
          isFullscreen={isFullscreen}
          onAddProject={(ownerName, dragStart, dragEnd) => {
            // If dates are provided (drag-to-create), use them; otherwise calculate suggestions
            if (dragStart && dragEnd) {
              setModal({ type: 'add-project', ownerName, suggestedStart: dragStart, suggestedEnd: dragEnd });
            } else {
              const ownerProjects = data.projects.filter(p => p.owner === ownerName);
              const { suggestedStart, suggestedEnd } = getSuggestedProjectDates(ownerProjects);
              setModal({ type: 'add-project', ownerName, suggestedStart, suggestedEnd });
            }
          }}
          onUpdateProject={handleTimelineUpdateProject}
          onDeleteProject={handleDeleteProject}
          onEditProject={openEditProject}
          onAddTeamMember={() => setModal({ type: 'add-member' })}
          onEditTeamMember={(member) => setModal({ type: 'edit-member', member })}
          onReorderTeamMembers={reorderTeamMembers}
          onCopyProject={copyProject}
          onSelectProject={setSelectedProject}
          onAddDependency={handleAddDependency}
          onRemoveDependency={handleRemoveDependency}
          onUpdateDependency={handleUpdateDependency}
          onAddLeaveBlock={handleAddLeaveBlock}
          onDeleteLeaveBlock={handleDeleteLeaveBlock}
          periodMarkers={data.periodMarkers || []}
          onAddPeriodMarker={handleAddPeriodMarker}
          onDeletePeriodMarker={handleDeletePeriodMarker}
          onEditPeriodMarker={handleEditPeriodMarker}
          onDayWidthChange={setDayWidth}
          onHoveredMemberChange={setHoveredMember}
          collapsedLanes={collapsedLanes}
          onToggleLaneCollapse={toggleLaneCollapse}
        />
      </main>

      {/* Add Team Member Modal */}
      <Modal isOpen={modal?.type === 'add-member'} onClose={closeModal} title="Add Team Member">
        <Suspense fallback={formFallback}>
          <TeamMemberForm onSubmit={handleAddMember} onCancel={closeModal} />
        </Suspense>
      </Modal>

      {/* Edit Team Member Modal */}
      <Modal isOpen={modal?.type === 'edit-member'} onClose={closeModal} title="Edit Team Member">
        <Suspense fallback={formFallback}>
          {modal?.type === 'edit-member' && (
            <TeamMemberForm
              initialValues={{ name: modal.member.name, jobTitle: modal.member.jobTitle }}
              onSubmit={handleEditMember}
              onCancel={closeModal}
              onDelete={handleDeleteMember}
              isEditing
              projectCount={data.projects.filter(p => p.owner === modal.member.name).length}
            />
          )}
        </Suspense>
      </Modal>

      {/* Add Project Modal */}
      <Modal isOpen={modal?.type === 'add-project'} onClose={closeModal} title="New Project">
        <Suspense fallback={formFallback}>
          {modal?.type === 'add-project' && (
            <ProjectForm
              initialValues={{
                owner: modal.ownerName,
                startDate: modal.suggestedStart,
                endDate: modal.suggestedEnd
              }}
              teamMembers={data.teamMembers}
              projects={data.projects}
              onSubmit={handleAddProject}
              onCancel={closeModal}
              hideOwner
            />
          )}
        </Suspense>
      </Modal>

      {/* Edit Project Modal */}
      <Modal isOpen={modal?.type === 'edit-project'} onClose={closeModal} title="Edit Project">
        <Suspense fallback={formFallback}>
          {modal?.type === 'edit-project' && (
            <ProjectForm
              initialValues={{
                title: modal.project.title,
                owner: modal.project.owner,
                startDate: modal.project.startDate,
                endDate: modal.project.endDate,
                statusColor: modal.project.statusColor,
                size: modal.project.size
              }}
              initialMilestones={modal.project.milestones}
              teamMembers={data.teamMembers}
              projects={data.projects}
              editingProjectId={modal.project.id}
              onSubmit={handleEditProject}
              onCancel={closeModal}
              onDelete={async () => {
                await handleDeleteProject(modal.project.id);
                closeModal();
              }}
              isEditing
            />
          )}
        </Suspense>
      </Modal>

      {/* Offline/Sync Status Banner */}
      <OfflineBanner isOnline={isOnline} isSyncing={isSaving} />

      {/* Keyboard Shortcuts Modal */}
      <Suspense fallback={formFallback}>
        <ShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      </Suspense>

      {/* Vault Unlock Overlay */}
      <VaultUnlock
        isOpen={showVaultUnlock}
        onUnlocked={handleVaultUnlocked}
        onCancel={handleVaultCancel}
      />
    </div>
  );
}

export default App;
