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
import { getSuggestedProjectDates } from './utils/dateUtils';
import { getStatusSlugByHex, normalizeStatusColor } from './utils/statusColors';
import { hasModifierKey } from './utils/platformUtils';
import { TimelineSkeleton } from './components/Skeleton';
import { OfflineBanner } from './components/OfflineBanner';
import { usePresence } from './hooks/usePresence';
import styles from './App.module.css';

// Lazy load form components (not needed until user clicks)
const ProjectForm = lazy(() => import('./components/ProjectForm').then(m => ({ default: m.ProjectForm })));
const MilestoneForm = lazy(() => import('./components/MilestoneForm').then(m => ({ default: m.MilestoneForm })));
const TeamMemberForm = lazy(() => import('./components/TeamMemberForm').then(m => ({ default: m.TeamMemberForm })));
const ShortcutsModal = lazy(() => import('./components/ShortcutsModal').then(m => ({ default: m.ShortcutsModal })));

// Sanitize error messages to prevent XSS
function sanitizeError(error: string): string {
  return String(error).replace(/<[^>]*>/g, '').trim();
}

type ModalType =
  | { type: 'add-project'; ownerName: string; suggestedStart: string; suggestedEnd: string }
  | { type: 'edit-project'; project: Project }
  | { type: 'add-milestone'; projectId: string; project: Project }
  | { type: 'edit-milestone'; projectId: string; project: Project; milestone: Milestone }
  | { type: 'add-member' }
  | { type: 'edit-member'; member: TeamMember }
  | null;

// Generate a simple user ID for this session (in production, use auth)
const getSessionInfo = () => {
  let userId = sessionStorage.getItem('roadmap-user-id');
  let userName = sessionStorage.getItem('roadmap-user-name');

  if (!userId) {
    userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem('roadmap-user-id', userId);
  }

  if (!userName) {
    // Generate anonymous user name
    const adjectives = ['Swift', 'Bright', 'Calm', 'Bold', 'Keen', 'Wise', 'Quick', 'Sharp'];
    const nouns = ['Planner', 'Builder', 'Mapper', 'Maker', 'Viewer', 'Editor', 'Designer', 'Thinker'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    userName = `${adj} ${noun}`;
    sessionStorage.setItem('roadmap-user-name', userName);
  }

  return { userId, userName };
};

// Get session info once at module load
const sessionInfo = getSessionInfo();

function App() {
  const { showToast } = useToast();
  const {
    data,
    loading,
    saveError,
    isOnline,
    isSaving,
    lastSaved,
    newMilestoneIds,
    newDependencyIds,
    clearError,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    reorderTeamMembers,
    addProject,
    updateProject,
    deleteProject,
    addMilestone,
    updateMilestone,
    deleteMilestone,
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
  const [hoveredMember, setHoveredMember] = useState<string | null>(null);

  // View mode lock - persisted in localStorage (defaults to locked for new users)
  const [isLocked, setIsLocked] = useState(() => {
    try {
      const stored = localStorage.getItem('roadmap-view-lock');
      // Default to locked (true) if no preference saved yet
      return stored === null ? true : stored === 'true';
    } catch {
      return true; // Default to locked on error
    }
  });

  // Persist lock state to localStorage
  const handleToggleLock = useCallback(() => {
    setIsLocked(prev => {
      const newValue = !prev;
      try {
        localStorage.setItem('roadmap-view-lock', String(newValue));
      } catch {
        // Ignore localStorage errors
      }
      return newValue;
    });
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

  const handlePasteMilestone = useCallback(async (milestone: Omit<Milestone, 'id'>, projectId: string) => {
    await addMilestone(projectId, milestone);
  }, [addMilestone]);

  // Clipboard
  const {
    copyProject,
    paste,
    hasContent: hasClipboard,
    setSelectedProject,
    setSelectedMilestone
  } = useClipboard({
    onPasteProject: handlePasteProject,
    onPasteMilestone: handlePasteMilestone,
    onShowToast: showToast
  });

  const closeModal = useCallback(() => setModal(null), []);

  // Determine the display status of a project based on its dates and color
  const getProjectDisplayStatus = useCallback((project: Project): ProjectStatus => {
    const today = new Date();
    const endDate = new Date(project.endDate);
    const startDate = new Date(project.startDate);

    // Past projects are always "complete" (auto-blue)
    if (endDate < today) {
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

      // Filter by tags (O(1) lookup per tag)
      if (hasTagFilter) {
        const hasMatchingTag = p.milestones?.some(m =>
          m.tags?.some(t => tags.has(t))
        );
        if (!hasMatchingTag) return false;
      }

      // Filter by status
      if (hasStatusFilter && getProjectDisplayStatus(p) !== filters.status) {
        return false;
      }

      // Filter by search
      if (hasSearchFilter) {
        const titleMatch = p.title.toLowerCase().includes(searchQuery);
        const ownerMatch = p.owner.toLowerCase().includes(searchQuery);
        const milestoneMatch = p.milestones?.some(m =>
          m.title.toLowerCase().includes(searchQuery) ||
          m.tags?.some(t => t.toLowerCase().includes(searchQuery))
        );
        if (!titleMatch && !ownerMatch && !milestoneMatch) return false;
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

    try {
      const hash = window.location.hash;
      if (hash.startsWith('#project=')) {
        const projectId = hash.replace('#project=', '');
        const project = data.projects.find(p => p.id === projectId);
        if (project) {
          hasHandledDeepLink.current = true;
          // Use setTimeout to ensure Timeline is rendered
          setTimeout(() => handleProjectSelect(projectId), 100);
        }
      }
    } catch {
      // Ignore URL parsing errors
    }
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
      // Add more cases as needed
    }
  }, [undo, deleteProject, addProject, updateProject]);

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
          if (newValue) {
            setShowFullscreenHint(true);
            setTimeout(() => setShowFullscreenHint(false), 3000);
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
        const ownerProjects = data.projects.filter(p => p.owner === hoveredMember);
        const { suggestedStart, suggestedEnd } = getSuggestedProjectDates(ownerProjects);
        setModal({ type: 'add-project', ownerName: hoveredMember, suggestedStart, suggestedEnd });
        return;
      }

      // Duplicate selected project with Cmd+D
      if (hasModifierKey(e) && e.key.toLowerCase() === 'd' && selectedProjectId && !isLocked) {
        e.preventDefault();
        const project = data.projects.find(p => p.id === selectedProjectId);
        if (project) {
          // Duplicate with 1 week offset
          const startDate = new Date(project.startDate);
          const endDate = new Date(project.endDate);
          startDate.setDate(startDate.getDate() + 7);
          endDate.setDate(endDate.getDate() + 7);
          addProject({
            title: `${project.title} (copy)`,
            owner: project.owner,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            statusColor: normalizeStatusColor(project.statusColor)
          });
          showToast('Project duplicated', 'success');
        }
        return;
      }

      // [ and ] to shift selected project dates by 1 week
      if ((e.key === '[' || e.key === ']') && selectedProjectId && !isLocked) {
        e.preventDefault();
        const project = data.projects.find(p => p.id === selectedProjectId);
        if (project) {
          const shift = e.key === ']' ? 7 : -7;
          const startDate = new Date(project.startDate);
          const endDate = new Date(project.endDate);
          startDate.setDate(startDate.getDate() + shift);
          endDate.setDate(endDate.getDate() + shift);
          updateProject(project.id, {
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0]
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
  }, [handleUndo, handleRedo, isFullscreen, hoveredMember, isLocked, data.projects, selectedProjectId, addProject, updateProject, showToast]);

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
    async (values: Omit<Project, 'id' | 'milestones'> & { milestones?: Omit<Milestone, 'id'>[] }) => {
      try {
        const { milestones: newMilestones, ...projectData } = values;
        const newProject = await addProject(projectData);
        const addedMilestones: Milestone[] = [];
        if (newProject && newMilestones && newMilestones.length > 0) {
          // Add milestones to the newly created project
          for (const milestone of newMilestones) {
            const added = await addMilestone(newProject.id, milestone);
            if (added) addedMilestones.push(added);
          }
        }
        if (newProject) {
          // Record full project state including milestones for proper undo
          const fullProject = { ...newProject, milestones: addedMilestones };
          recordAction('CREATE_PROJECT', fullProject, createInverse('CREATE_PROJECT', null, fullProject));
        }
        showToast('Project created successfully', 'success');
        closeModal();
      } catch (error) {
        showToast(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    },
    [addProject, addMilestone, closeModal, recordAction, showToast]
  );

  const handleEditProject = useCallback(
    async (values: Omit<Project, 'id' | 'milestones'> & { milestones?: Array<{ id?: string } & Omit<Milestone, 'id'>> }) => {
      if (modal?.type === 'edit-project') {
        try {
          const beforeState = modal.project;
          const { milestones: updatedMilestones, ...projectData } = values;
          await updateProject(modal.project.id, projectData);

          // Handle milestone updates if provided
          if (updatedMilestones) {
            const existingMilestones = modal.project.milestones || [];
            const existingIds = new Set(existingMilestones.map(m => m.id));
            const updatedIds = new Set(updatedMilestones.filter(m => m.id).map(m => m.id));

            // Delete removed milestones
            for (const existing of existingMilestones) {
              if (!updatedIds.has(existing.id)) {
                await deleteMilestone(modal.project.id, existing.id);
              }
            }

            // Update existing and add new milestones
            for (const milestone of updatedMilestones) {
              if (milestone.id && existingIds.has(milestone.id)) {
                // Update existing
                const { id, ...milestoneData } = milestone;
                await updateMilestone(modal.project.id, id, milestoneData);
              } else if (!milestone.id) {
                // Add new
                const { id: _id, ...milestoneData } = milestone;
                await addMilestone(modal.project.id, milestoneData);
              }
            }
          }

          recordAction('UPDATE_PROJECT', values, createInverse('UPDATE_PROJECT', beforeState, values));
          closeModal();
        } catch (error) {
          showToast(`Failed to update project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        }
      }
    },
    [modal, updateProject, updateMilestone, addMilestone, deleteMilestone, closeModal, recordAction, showToast]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      try {
        const project = data.projects.find(p => p.id === projectId);
        if (project) {
          recordAction('DELETE_PROJECT', project, createInverse('DELETE_PROJECT', project, null));
          await deleteProject(projectId);
          // Capture the deleted project for a targeted restore, rather than
          // calling generic handleUndo which undoes the *most recent* action
          // (which might not be this delete if the user acted in between).
          const deletedProject = { ...project };
          showToast('Project deleted', {
            type: 'success',
            action: {
              label: 'Undo',
              onClick: () => { addProject(deletedProject); }
            }
          });
        }
      } catch (error) {
        showToast(`Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    },
    [data.projects, deleteProject, recordAction, showToast, addProject]
  );

  // Milestone handlers
  const handleAddMilestone = useCallback(
    async (values: Omit<Milestone, 'id'>) => {
      if (modal?.type === 'add-milestone') {
        try {
          const project = modal.project;

          // Check if milestone extends beyond project bounds
          const milestoneStart = new Date(values.startDate);
          const milestoneEnd = new Date(values.endDate);
          const projectStart = new Date(project.startDate);
          const projectEnd = new Date(project.endDate);

          const needsExpansion = milestoneStart < projectStart || milestoneEnd > projectEnd;

          // Add the milestone
          await addMilestone(modal.projectId, values);

          // Auto-expand project bounds if milestone extends beyond
          if (needsExpansion) {
            const newStartDate = milestoneStart < projectStart ? values.startDate : project.startDate;
            const newEndDate = milestoneEnd > projectEnd ? values.endDate : project.endDate;

            await updateProject(modal.projectId, {
              startDate: newStartDate,
              endDate: newEndDate
            });
            showToast('Project dates expanded to fit milestone', 'info');
          }

          closeModal();
        } catch (error) {
          showToast(`Failed to add milestone: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        }
      }
    },
    [modal, addMilestone, updateProject, closeModal, showToast]
  );

  const handleEditMilestone = useCallback(
    async (values: Omit<Milestone, 'id'>) => {
      if (modal?.type === 'edit-milestone') {
        try {
          const project = modal.project;

          // Check if milestone extends beyond project bounds
          const milestoneStart = new Date(values.startDate);
          const milestoneEnd = new Date(values.endDate);
          const projectStart = new Date(project.startDate);
          const projectEnd = new Date(project.endDate);

          const needsExpansion = milestoneStart < projectStart || milestoneEnd > projectEnd;

          // Update the milestone
          await updateMilestone(modal.projectId, modal.milestone.id, values);

          // Auto-expand project bounds if milestone extends beyond
          if (needsExpansion) {
            const newStartDate = milestoneStart < projectStart ? values.startDate : project.startDate;
            const newEndDate = milestoneEnd > projectEnd ? values.endDate : project.endDate;

            await updateProject(modal.projectId, {
              startDate: newStartDate,
              endDate: newEndDate
            });
            showToast('Project dates expanded to fit milestone', 'info');
          }

          closeModal();
        } catch (error) {
          showToast(`Failed to update milestone: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
        }
      }
    },
    [modal, updateMilestone, updateProject, closeModal, showToast]
  );

  // Dependency handlers (persisted to Firebase)
  const handleAddDependency = useCallback(async (
    fromProjectId: string,
    toProjectId: string,
    fromMilestoneId?: string,
    toMilestoneId?: string
  ) => {
    try {
      await addDependency(fromProjectId, toProjectId, fromMilestoneId, toMilestoneId);
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

  const openAddMilestone = useCallback(
    (projectId: string) => {
      const project = data.projects.find((p) => p.id === projectId);
      if (project) {
        setModal({ type: 'add-milestone', projectId, project });
      }
    },
    [data.projects]
  );

  const openEditProject = useCallback((project: Project) => {
    setModal({ type: 'edit-project', project });
  }, []);

  const openEditMilestone = useCallback(
    (projectId: string, milestoneId: string) => {
      const project = data.projects.find((p) => p.id === projectId);
      const milestone = project?.milestones?.find((m) => m.id === milestoneId);
      if (project && milestone) {
        setModal({ type: 'edit-milestone', projectId, project, milestone });
      }
    },
    [data.projects]
  );

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
          newMilestoneIds={newMilestoneIds}
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
          onUpdateProject={updateProject}
          onDeleteProject={handleDeleteProject}
          onAddMilestone={openAddMilestone}
          onEditProject={openEditProject}
          onEditMilestone={openEditMilestone}
          onUpdateMilestone={updateMilestone}
          onDeleteMilestone={deleteMilestone}
          onAddTeamMember={() => setModal({ type: 'add-member' })}
          onEditTeamMember={(member) => setModal({ type: 'edit-member', member })}
          onReorderTeamMembers={reorderTeamMembers}
          onCopyProject={copyProject}
          onSelectProject={setSelectedProject}
          onSelectMilestone={(_, __, milestone) => setSelectedMilestone(milestone)}
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
        <Suspense fallback={null}>
          <TeamMemberForm onSubmit={handleAddMember} onCancel={closeModal} />
        </Suspense>
      </Modal>

      {/* Edit Team Member Modal */}
      <Modal isOpen={modal?.type === 'edit-member'} onClose={closeModal} title="Edit Team Member">
        <Suspense fallback={null}>
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
        <Suspense fallback={null}>
          {modal?.type === 'add-project' && (
            <ProjectForm
              initialValues={{
                owner: modal.ownerName,
                startDate: modal.suggestedStart,
                endDate: modal.suggestedEnd
              }}
              onSubmit={handleAddProject}
              onCancel={closeModal}
              hideOwner
            />
          )}
        </Suspense>
      </Modal>

      {/* Edit Project Modal */}
      <Modal isOpen={modal?.type === 'edit-project'} onClose={closeModal} title="Edit Project">
        <Suspense fallback={null}>
          {modal?.type === 'edit-project' && (
            <ProjectForm
              initialValues={{
                title: modal.project.title,
                owner: modal.project.owner,
                startDate: modal.project.startDate,
                endDate: modal.project.endDate,
                statusColor: modal.project.statusColor
              }}
              initialMilestones={modal.project.milestones}
              teamMembers={data.teamMembers}
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

      {/* Add Milestone Modal */}
      <Modal isOpen={modal?.type === 'add-milestone'} onClose={closeModal} title="Add Milestone">
        <Suspense fallback={null}>
          {modal?.type === 'add-milestone' && (
            <MilestoneForm
              projectStartDate={modal.project.startDate}
              projectEndDate={modal.project.endDate}
              onSubmit={handleAddMilestone}
              onCancel={closeModal}
            />
          )}
        </Suspense>
      </Modal>

      {/* Edit Milestone Modal */}
      <Modal isOpen={modal?.type === 'edit-milestone'} onClose={closeModal} title="Edit Milestone">
        <Suspense fallback={null}>
          {modal?.type === 'edit-milestone' && (
            <MilestoneForm
              initialValues={{
                title: modal.milestone.title,
                description: modal.milestone.description,
                startDate: modal.milestone.startDate,
                endDate: modal.milestone.endDate,
                tags: modal.milestone.tags,
                statusColor: modal.milestone.statusColor
              }}
              projectStartDate={modal.project.startDate}
              projectEndDate={modal.project.endDate}
              onSubmit={handleEditMilestone}
              onCancel={closeModal}
              onDelete={async () => {
                await deleteMilestone(modal.projectId, modal.milestone.id);
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
      <Suspense fallback={null}>
        <ShortcutsModal isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />
      </Suspense>
    </div>
  );
}

export default App;
