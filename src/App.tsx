import { useState, useCallback, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useRoadmap } from './hooks/useRoadmap';
import { useUndoManager, createInverse } from './hooks/useUndoManager';
import { useClipboard } from './hooks/useClipboard';
import { useToast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { Timeline, type TimelineRef } from './components/Timeline';
import { Modal } from './components/Modal';
import type { BoardSettings, Project, Milestone, TeamMember, Dependency, LeaveType, LeaveCoverage, FilterState, ProjectStatus } from './types';
import { isProject } from './types';
import { filterProjects, parseStoredFilters, hasActiveFilters, withKnownTags, INITIAL_FILTERS } from './utils/projectFilters';
import { tagsInUse } from './utils/projectTags';
import { revertPatch, valueChanges } from './utils/objectDiff';
import { getSuggestedProjectDates, parseLocalDate, toDateString } from './utils/dateUtils';
import { DEFAULT_SIZE } from './utils/capacity';
import { normalizeStatusColor } from './utils/statusColors';
import { displayStatusOf, statusStamp } from './utils/completion';
import { BoardRulesContext, boardRules } from './utils/boardSettings';
import { hasModifierKey } from './utils/platformUtils';
import { TimelineSkeleton } from './components/Skeleton';
import { OfflineBanner } from './components/OfflineBanner';
import { usePresence } from './hooks/usePresence';
import { VaultUnlock } from './components/VaultUnlock';
import { generateSessionId } from './utils/gameUtils';
import { isEmbedMode } from './utils/embedMode';
import { boardViewFromSearch, searchWithBoardView, type BoardView } from './utils/boardView';
import { ProgrammeView } from './components/ProgrammeView';
import { dimsLeavers } from './utils/teamMembers';
import styles from './App.module.css';

// Lazy load form components (not needed until user clicks)
const ProjectWizard = lazy(() => import('./components/ProjectWizard').then(m => ({ default: m.ProjectWizard })));
const BoardRulesPanel = lazy(() => import('./components/BoardRulesPanel').then(m => ({ default: m.BoardRulesPanel })));
const CapacityView = lazy(() => import('./components/CapacityView').then(m => ({ default: m.CapacityView })));
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
  | { type: 'capacity' }
  | { type: 'rules' }
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

// Whether this page is a framed, read-only embed (e.g. inside SharePoint).
// Resolved once from the URL — it never changes over a page's lifetime.
const embedMode = isEmbedMode();

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
    deletePeriodMarker,
    updateSettings,
    replaceProgramme
  } = useRoadmap();

  // Real-time presence for collaboration
  const { users: presenceUsers } = usePresence({
    sessionId: sessionInfo.userId,
    userName: sessionInfo.userName,
    enabled: isOnline
  });

  const [modal, setModal] = useState<ModalType>(null);
  const [view, setView] = useState<BoardView>(() => boardViewFromSearch(window.location.search));
  // Kept in the URL so the programme view can be linked to and embedded.
  const handleViewChange = useCallback((next: BoardView) => {
    setView(next);
    window.history.replaceState(null, '', `${window.location.pathname}${searchWithBoardView(window.location.search, next)}${window.location.hash}`);
  }, []);
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

  // Save zoom level to localStorage once it settles: a pinch changes dayWidth
  // every frame, and a synchronous storage write per frame is felt as stutter.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem('roadmap-zoom', String(dayWidth));
      } catch {
        // Ignore localStorage errors
      }
    }, 250);
    return () => clearTimeout(timer);
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
  // Filter persistence - load from localStorage (parseStoredFilters validates
  // entries and migrates the legacy single-select status shape)
  const [storedFilters, setFilters] = useState<FilterState>(() => {
    try {
      const stored = localStorage.getItem('roadmap-filters');
      if (stored) return parseStoredFilters(JSON.parse(stored));
    } catch {
      // Ignore localStorage errors
    }
    return INITIAL_FILTERS;
  });

  // Save filters to localStorage when they change (debounced, excluding search)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        // Don't persist search text, only the filter selections
        const toStore = {
          owners: storedFilters.owners,
          sizes: storedFilters.sizes,
          statuses: storedFilters.statuses,
          epr: storedFilters.epr,
          tags: storedFilters.tags,
          timeframes: storedFilters.timeframes
        };
        localStorage.setItem('roadmap-filters', JSON.stringify(toStore));
      } catch {
        // Ignore localStorage errors
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [storedFilters.owners, storedFilters.sizes, storedFilters.statuses, storedFilters.epr, storedFilters.tags, storedFilters.timeframes]);

  // Tags live on the projects, so the board is the tag list. A stored tag
  // filter is applied only while some project still carries that tag.
  const projectTags = useMemo(() => tagsInUse(data.projects), [data.projects]);
  const filters = useMemo(() => withKnownTags(storedFilters, projectTags), [storedFilters, projectTags]);

  // Live search text from the search modal (kept out of Toolbar's setFilters
  // path so SearchFilter's notify effect can't clobber menu-set filters)
  const handleSearchChange = useCallback((search: string) => {
    setFilters(f => (f.search === search ? f : { ...f, search }));
  }, []);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showFullscreenHint, setShowFullscreenHint] = useState(false);
  const fullscreenHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A ref, not state: only the N shortcut reads it, and as state every lane the
  // cursor crossed re-rendered the whole app.
  const hoveredMemberRef = useRef<string | null>(null);
  const setHoveredMember = useCallback((memberName: string | null) => {
    hoveredMemberRef.current = memberName;
  }, []);

  // Ref to avoid re-registering keyboard handler on every Firebase snapshot
  const projectsRef = useRef(data.projects);
  useEffect(() => {
    projectsRef.current = data.projects;
  }, [data.projects]);

  // View mode lock — always starts locked; unlock is session-only (resets on tab close).
  // In embed mode the lock is permanent: it starts on and there is no path to turn it off.
  const [isLocked, setIsLocked] = useState(true);
  const [showVaultUnlock, setShowVaultUnlock] = useState(false);

  // Toggle lock — unlocking requires vault PIN entry. Disabled entirely in embed
  // mode so a framed viewer can never open the vault (the toggle button is also
  // hidden; this is the belt-and-braces guard behind it).
  const handleToggleLock = useCallback(() => {
    if (embedMode) return;
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

  const rules = useMemo(() => boardRules(data.settings), [data.settings]);

  // The status a project filters as: its own, or Complete once it is confirmed
  // or assumed (utils/completion, the same rule the bar's badge follows).
  const getProjectDisplayStatus = useCallback((project: Project): ProjectStatus => {
    const today = new Date();
    const status = displayStatusOf(project, toDateString(today), rules.graceDays);
    if (status) return status;

    // A colour that is not a known status: if the start date is in the future
    // it's "ready-to-start", otherwise "on-track".
    if (parseLocalDate(project.startDate) > today) return 'ready-to-start';
    return 'on-track';
  }, [rules.graceDays]);

  // Apply the active filters (owners / sizes / statuses / EPR / tags / timeframe /
  // search) to the board. All the interpretation lives in utils/projectFilters
  // so the Filter menu's badge and summary count can never disagree with what's
  // shown. `today` is resolved once per render rather than inside the filter so
  // the helper stays pure and testable.
  const today = toDateString(new Date());
  const filteredProjects = useMemo(
    () => filterProjects(data.projects, filters, getProjectDisplayStatus, today),
    [data.projects, filters, getProjectDisplayStatus, today]
  );

  // Select a project from search and scroll to it. Selection is persistent (no
  // auto-clear) so the per-project shortcuts ([ ] / Cmd+D / Backspace) stay usable
  // — it clears on Escape or when another project is selected.
  const handleProjectSelect = useCallback((projectId: string) => {
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current);
      selectionTimeoutRef.current = null;
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
    // The Timeline component will handle scrolling.
  }, []);

  // Select a project by clicking its bar: highlight it + track it for clipboard
  // copy. Persistent, same as search selection above.
  const handleSelectBarProject = useCallback((project: Project) => {
    if (selectionTimeoutRef.current) {
      clearTimeout(selectionTimeoutRef.current);
      selectionTimeoutRef.current = null;
    }
    setSelectedProjectId(project.id);
    setSelectedProject(project);
  }, [setSelectedProject]);

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

  // Puts a deleted project back along with the dependencies deleteProject
  // removed with it. Shared by Ctrl+Z and the "Project deleted" toast so the two
  // cannot restore different things.
  const restoreProject = useCallback(async (project: Project, dependencies: Dependency[]) => {
    // The toast's Undo and Ctrl+Z can both be used on the same delete.
    if (projectsRef.current.some(p => p.id === project.id)) return;
    await addProject(project);
    for (const dep of dependencies) {
      // A link to a project that has itself been deleted since would dangle.
      const otherEnd = dep.fromProjectId === project.id ? dep.toProjectId : dep.fromProjectId;
      if (!projectsRef.current.some(p => p.id === otherEnd)) continue;
      try {
        const restored = await addDependency(
          dep.fromProjectId, dep.toProjectId,
          dep.fromMilestoneId, dep.toMilestoneId, dep.type
        );
        // addDependency has no waypoints parameter, so the hand-shaped path
        // goes on in a second write.
        if (dep.waypoints) await updateDependency(restored.id, { waypoints: dep.waypoints });
      } catch (error) {
        showToast(`Could not restore a dependency: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    }
  }, [addProject, addDependency, updateDependency, showToast]);

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
          restoreProject(inverseObj.data, action.inverse.dependencies);
        } else if (inverseObj.action === 'restore') {
          console.warn('Undo DELETE_PROJECT failed: data is not a valid Project');
        }
        break;
      case 'UPDATE_PROJECT': {
        const { id, ...patch } = action.inverse.data;
        updateProject(id, patch);
        break;
      }
      // Currently only project operations are recorded for undo.
      // Milestone, member, dependency, and leave types are defined in the
      // ActionType union but not yet wired into recordAction calls.
      default:
        console.warn(`Undo not implemented for action type: ${action.type}`);
        break;
    }
  }, [undo, deleteProject, updateProject, restoreProject]);

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
        const { id, ...patch } = action.data;
        updateProject(id, patch);
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

      // Escape exits fullscreen or deselects. In a field it belongs to that
      // field's dialog, which closes itself; acting here too dropped the
      // selection behind it.
      if (e.key === 'Escape') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
          return;
        }
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
      const hoveredMember = hoveredMemberRef.current;
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
          addProject({
            title: `${project.title} (copy)`,
            owner: project.owner,
            startDate: newStart,
            endDate: newEnd,
            statusColor: normalizeStatusColor(project.statusColor),
            size: project.size ?? DEFAULT_SIZE,
            epr: project.epr,
            programme: project.programme,
            scoring: project.scoring,
            tags: project.tags
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
  }, [handleUndo, handleRedo, isFullscreen, isLocked, selectedProjectId, addProject, updateProject, showToast]);

  // Team member handlers
  const handleAddMember = useCallback(
    async (values: { name: string; jobTitle: string; capacity?: number }) => {
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
    async (values: { name: string; jobTitle: string; left?: boolean; capacity?: number }) => {
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

  // The rules panel saves each change as it is made, with no form to submit,
  // so a failed write has to surface here.
  const saveRules = useCallback((updates: BoardSettings) => {
    updateSettings(updates).catch(error => showToast(`Failed to save rules: ${error instanceof Error ? error.message : String(error)}`, 'error'));
  }, [updateSettings, showToast]);

  const saveProgramme = useCallback((from: string, to: string | null) => {
    replaceProgramme(from, to).catch(error => showToast(`Failed to save programmes: ${error instanceof Error ? error.message : String(error)}`, 'error'));
  }, [replaceProgramme, showToast]);

  const saveMemberRule = useCallback((memberId: string, updates: Partial<TeamMember>) => {
    updateTeamMember(memberId, updates).catch(error => showToast(`Failed to update member: ${error instanceof Error ? error.message : String(error)}`, 'error'));
  }, [updateTeamMember, showToast]);

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
        if (!newProject) {
          // addProject resolved without creating a project — don't claim success.
          showToast('Could not create project — please try again', 'error');
          return;
        }
        recordAction('CREATE_PROJECT', newProject, createInverse('CREATE_PROJECT', null, newProject));
        closeModal();
      } catch (error) {
        showToast(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    },
    [addProject, closeModal, recordAction, showToast]
  );

  // Undo and redo each replay only the fields this edit changed, so neither
  // overwrites what a colleague has done to the project's other fields since.
  const recordProjectUpdate = useCallback((before: Project, updates: Partial<Project>) => {
    const undoPatch = revertPatch(before, updates);
    if (Object.keys(undoPatch).length === 0) return;
    const redoPatch = revertPatch({ ...before, ...updates }, undoPatch);
    const redoData = { id: before.id, ...redoPatch };
    recordAction('UPDATE_PROJECT', redoData, createInverse('UPDATE_PROJECT', { id: before.id, ...undoPatch }, redoData));
  }, [recordAction]);

  const handleEditProject = useCallback(
    async (values: Omit<Project, 'id' | 'milestones'> & { milestones?: Milestone[] }) => {
      if (modal?.type === 'edit-project') {
        try {
          const beforeState = modal.project;
          // Milestones aren't edited here; omit the field so existing milestone data is preserved.
          const { milestones: _milestones, ...edited } = values; // eslint-disable-line @typescript-eslint/no-unused-vars -- field intentionally dropped
          const projectData = valueChanges(beforeState, { ...edited, ...statusStamp(beforeState, edited, toDateString(new Date())) });
          await updateProject(modal.project.id, projectData);
          recordProjectUpdate(beforeState, projectData);
          closeModal();
        } catch (error) {
          showToast(`Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        }
      }
    },
    [modal, updateProject, closeModal, recordProjectUpdate, showToast]
  );

  // Update used by the timeline (drag to reassign / resize). Over-capacity moves
  // are allowed — a member can be deliberately overloaded — and surfaced visually
  // on the timeline with an over-allocation marker rather than being blocked here.
  const handleTimelineUpdateProject = useCallback(
    async (projectId: string, change: Partial<Project>) => {
      const before = projectsRef.current.find(p => p.id === projectId);
      const updates = before ? { ...change, ...statusStamp(before, change, toDateString(new Date())) } : change;
      await updateProject(projectId, updates);
      // Moves, resizes, reassignments and status changes made on the board are
      // undoable like edits made in the form.
      if (before) recordProjectUpdate(before, updates);
    },
    [updateProject, recordProjectUpdate]
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
          // Restore this project specifically, rather than calling generic
          // handleUndo which undoes the *most recent* action (which might not be
          // this delete if the user acted in between).
          showToast('Project deleted', {
            type: 'success',
            action: {
              label: 'Undo',
              onClick: () => restoreProject(project, affectedDeps)
            }
          });
        }
      } catch (error) {
        showToast(`Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    },
    [data.projects, data.dependencies, deleteProject, recordAction, showToast, restoreProject]
  );

  // Dependency handlers (persisted to Firebase) — project-level only.
  const handleAddDependency = useCallback(async (
    fromProjectId: string,
    toProjectId: string
  ) => {
    try {
      await addDependency(fromProjectId, toProjectId);
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
    <BoardRulesContext.Provider value={rules}>
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
          board={data}
          filters={filters}
          tags={projectTags}
          onFiltersChange={setFilters}
          onSearchChange={handleSearchChange}
          filteredProjects={filteredProjects}
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
          embedMode={embedMode}
          view={view}
          onViewChange={handleViewChange}
          onOpenCapacity={() => setModal({ type: 'capacity' })}
          onOpenRules={() => setModal({ type: 'rules' })}
          presenceUsers={presenceUsers}
          currentUserId={sessionInfo.userId}
        />
      )}

      {/* Filters that match nothing would otherwise just leave a blank board with
          no explanation of why. Scoped to the Filter menu's dimensions: a search
          that matches nothing is reported inside the search modal, and the text
          is cleared whenever that modal closes. */}
      {!isFullscreen && hasActiveFilters(filters) && filteredProjects.length === 0 && data.projects.length > 0 && (
        <div className={styles.noMatches}>
          <span>No projects match the current filters.</span>
          <button
            className={styles.noMatchesClear}
            onClick={() => setFilters(f => ({ ...INITIAL_FILTERS, search: f.search }))}
          >
            Clear filters
          </button>
        </div>
      )}

      <main className={styles.main}>
        {view === 'programmes' ? <ProgrammeView projects={filteredProjects} /> : (
        <Timeline
          ref={timelineRef}
          projects={filteredProjects}
          allProjects={data.projects}
          teamMembers={data.teamMembers}
          dependencies={data.dependencies || []}
          leaveBlocks={data.leaveBlocks || []}
          dayWidth={dayWidth}
          selectedProjectId={selectedProjectId}
          filteredOwners={filters.owners.length > 0 ? filters.owners : undefined}
          dimLeavers={dimsLeavers(filters)}
          slimEmptyLanes={hasActiveFilters(filters)}
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
          onSelectProject={handleSelectBarProject}
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
        )}
      </main>

      <Modal isOpen={modal?.type === 'capacity'} onClose={closeModal} title="Capacity, next 26 weeks">
        <Suspense fallback={formFallback}>
          {modal?.type === 'capacity' && <CapacityView teamMembers={data.teamMembers} projects={data.projects} />}
        </Suspense>
      </Modal>

      <Modal isOpen={modal?.type === 'rules'} onClose={closeModal} title="Board rules">
        <Suspense fallback={formFallback}>
          {modal?.type === 'rules' && (
            <BoardRulesPanel
              teamMembers={data.teamMembers}
              projects={data.projects}
              onUpdateSettings={saveRules}
              onReplaceProgramme={saveProgramme}
              onUpdateMember={saveMemberRule}
            />
          )}
        </Suspense>
      </Modal>

      {/* Add Team Member Modal */}
      <Modal isOpen={modal?.type === 'add-member'} onClose={closeModal} title="Add team member">
        <Suspense fallback={formFallback}>
          <TeamMemberForm onSubmit={handleAddMember} onCancel={closeModal} otherNames={data.teamMembers.map(m => m.name)} />
        </Suspense>
      </Modal>

      {/* Edit Team Member Modal */}
      <Modal isOpen={modal?.type === 'edit-member'} onClose={closeModal} title="Edit team member">
        <Suspense fallback={formFallback}>
          {modal?.type === 'edit-member' && (
            <TeamMemberForm
              initialValues={{ name: modal.member.name, jobTitle: modal.member.jobTitle, left: modal.member.left, capacity: modal.member.capacity }}
              onSubmit={handleEditMember}
              onCancel={closeModal}
              onDelete={handleDeleteMember}
              onAddProject={() => {
                const ownerProjects = data.projects.filter(p => p.owner === modal.member.name);
                const { suggestedStart, suggestedEnd } = getSuggestedProjectDates(ownerProjects);
                setModal({ type: 'add-project', ownerName: modal.member.name, suggestedStart, suggestedEnd });
              }}
              isEditing
              projectCount={data.projects.filter(p => p.owner === modal.member.name).length}
              otherNames={data.teamMembers.filter(m => m.id !== modal.member.id).map(m => m.name)}
            />
          )}
        </Suspense>
      </Modal>

      {/* Add Project Modal */}
      <Modal isOpen={modal?.type === 'add-project'} onClose={closeModal} title="New project">
        <Suspense fallback={formFallback}>
          {modal?.type === 'add-project' && (
            <ProjectWizard
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
      <Modal isOpen={modal?.type === 'edit-project'} onClose={closeModal} title="Edit project">
        <Suspense fallback={formFallback}>
          {modal?.type === 'edit-project' && (
            <ProjectWizard
              initialValues={{
                title: modal.project.title,
                owner: modal.project.owner,
                startDate: modal.project.startDate,
                endDate: modal.project.endDate,
                statusColor: modal.project.statusColor,
                size: modal.project.size,
                epr: modal.project.epr,
                tags: modal.project.tags,
                programme: modal.project.programme,
                baselineEndDate: modal.project.baselineEndDate
              }}
              initialScoring={modal.project.scoring}
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

      {/* Vault Unlock Overlay — never mounted in embed mode, so a framed
          viewer has no way to reach the unlock PIN. */}
      {!embedMode && (
        <VaultUnlock
          isOpen={showVaultUnlock}
          onUnlocked={handleVaultUnlocked}
          onCancel={handleVaultCancel}
        />
      )}
    </div>
    </BoardRulesContext.Provider>
  );
}

export default App;
