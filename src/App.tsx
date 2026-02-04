import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRoadmap } from './hooks/useRoadmap';
import { useUndoManager, createInverse } from './hooks/useUndoManager';
import { useClipboard } from './hooks/useClipboard';
import { useToast } from './components/Toast';
import { Toolbar } from './components/Toolbar';
import { Timeline, type ZoomLevel } from './components/Timeline';
import { Modal } from './components/Modal';
import { ProjectForm } from './components/ProjectForm';
import { MilestoneForm } from './components/MilestoneForm';
import { TeamMemberForm } from './components/TeamMemberForm';
import type { Project, Milestone, TeamMember, Dependency } from './types';
import { isProject } from './types';
import type { FilterState, ProjectStatus } from './components/SearchFilter';
import { getSuggestedProjectDates } from './utils/dateUtils';
import { TimelineSkeleton } from './components/Skeleton';
import styles from './App.module.css';

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
const getUserId = () => {
  let userId = sessionStorage.getItem('roadmap-user-id');
  if (!userId) {
    userId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    sessionStorage.setItem('roadmap-user-id', userId);
  }
  return userId;
};

function App() {
  const { showToast } = useToast();
  const {
    data,
    loading,
    saveError,
    isOnline,
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
    updateDependency
  } = useRoadmap();

  const [modal, setModal] = useState<ModalType>(null);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('month');
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    owners: [],
    tags: [],
    dateRange: null,
    status: 'all'
  });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const selectionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Show save errors as toasts
  useEffect(() => {
    if (saveError) {
      showToast(sanitizeError(saveError), 'error');
      clearError();
    }
  }, [saveError, showToast, clearError]);

  // Undo manager
  const userId = useMemo(() => getUserId(), []);
  const {
    recordAction,
    undo,
    redo,
    canUndo,
    canRedo
  } = useUndoManager({ userId });

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

    // For active/future projects, determine status from color
    const statusColor = project.statusColor.toLowerCase();

    // Map colors to statuses
    if (statusColor === '#7612c3') return 'on-hold';
    if (statusColor === '#9ca3af') return 'to-start';
    if (statusColor === '#04b050') return 'on-track';
    if (statusColor === '#ffc002') return 'at-risk';
    if (statusColor === '#ff0100') return 'off-track';

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

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (modifier && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        // Support both Cmd+Shift+Z (Mac) and Ctrl+Y (Windows) for redo
        e.preventDefault();
        handleRedo();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // Team member handlers
  const handleAddMember = useCallback(
    async (values: { name: string; jobTitle: string }) => {
      await addTeamMember(values);
      closeModal();
    },
    [addTeamMember, closeModal]
  );

  const handleEditMember = useCallback(
    async (values: { name: string; jobTitle: string }) => {
      if (modal?.type === 'edit-member') {
        await updateTeamMember(modal.member.id, values);
        closeModal();
      }
    },
    [modal, updateTeamMember, closeModal]
  );

  const handleDeleteMember = useCallback(async () => {
    if (modal?.type === 'edit-member') {
      await deleteTeamMember(modal.member.id);
      closeModal();
    }
  }, [modal, deleteTeamMember, closeModal]);

  // Project handlers with undo support
  const handleAddProject = useCallback(
    async (values: Omit<Project, 'id' | 'milestones'> & { milestones?: Omit<Milestone, 'id'>[] }) => {
      try {
        const { milestones: newMilestones, ...projectData } = values;
        const newProject = await addProject(projectData);
        if (newProject && newMilestones && newMilestones.length > 0) {
          // Add milestones to the newly created project
          for (const milestone of newMilestones) {
            await addMilestone(newProject.id, milestone);
          }
        }
        if (newProject) {
          recordAction('CREATE_PROJECT', newProject, createInverse('CREATE_PROJECT', null, newProject));
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
      }
    },
    [modal, updateProject, updateMilestone, addMilestone, deleteMilestone, closeModal, recordAction]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      try {
        const project = data.projects.find(p => p.id === projectId);
        if (project) {
          recordAction('DELETE_PROJECT', project, createInverse('DELETE_PROJECT', project, null));
          await deleteProject(projectId);
          showToast('Project deleted', 'success');
        }
      } catch (error) {
        showToast(`Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    },
    [data.projects, deleteProject, recordAction, showToast]
  );

  // Milestone handlers
  const handleAddMilestone = useCallback(
    async (values: Omit<Milestone, 'id'>) => {
      if (modal?.type === 'add-milestone') {
        await addMilestone(modal.projectId, values);
        closeModal();
      }
    },
    [modal, addMilestone, closeModal]
  );

  const handleEditMilestone = useCallback(
    async (values: Omit<Milestone, 'id'>) => {
      if (modal?.type === 'edit-milestone') {
        await updateMilestone(modal.projectId, modal.milestone.id, values);
        closeModal();
      }
    },
    [modal, updateMilestone, closeModal]
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
    <div className={styles.app}>
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
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
      />

      <main className={styles.main}>
        <Timeline
          projects={filteredProjects}
          teamMembers={data.teamMembers}
          dependencies={data.dependencies || []}
          zoomLevel={zoomLevel}
          selectedProjectId={selectedProjectId}
          filteredOwners={filters.owners.length > 0 ? filters.owners : undefined}
          onAddProject={(ownerName) => {
            const ownerProjects = data.projects.filter(p => p.owner === ownerName);
            const { suggestedStart, suggestedEnd } = getSuggestedProjectDates(ownerProjects);
            setModal({ type: 'add-project', ownerName, suggestedStart, suggestedEnd });
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
        />
      </main>

      {/* Add Team Member Modal */}
      <Modal isOpen={modal?.type === 'add-member'} onClose={closeModal} title="Add Team Member">
        <TeamMemberForm onSubmit={handleAddMember} onCancel={closeModal} />
      </Modal>

      {/* Edit Team Member Modal */}
      <Modal isOpen={modal?.type === 'edit-member'} onClose={closeModal} title="Edit Team Member">
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
      </Modal>

      {/* Add Project Modal */}
      <Modal isOpen={modal?.type === 'add-project'} onClose={closeModal} title="New Project">
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
      </Modal>

      {/* Edit Project Modal */}
      <Modal isOpen={modal?.type === 'edit-project'} onClose={closeModal} title="Edit Project">
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
            onSubmit={handleEditProject}
            onCancel={closeModal}
            onDelete={async () => {
              await handleDeleteProject(modal.project.id);
              closeModal();
            }}
            isEditing
          />
        )}
      </Modal>

      {/* Add Milestone Modal */}
      <Modal isOpen={modal?.type === 'add-milestone'} onClose={closeModal} title="Add Milestone">
        {modal?.type === 'add-milestone' && (
          <MilestoneForm
            projectStartDate={modal.project.startDate}
            projectEndDate={modal.project.endDate}
            onSubmit={handleAddMilestone}
            onCancel={closeModal}
          />
        )}
      </Modal>

      {/* Edit Milestone Modal */}
      <Modal isOpen={modal?.type === 'edit-milestone'} onClose={closeModal} title="Edit Milestone">
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
      </Modal>

      {/* Offline Indicator */}
      {!isOnline && (
        <div className={styles.offlineToast}>
          <span>📡 Offline - Changes will be saved when reconnected</span>
        </div>
      )}
    </div>
  );
}

export default App;
