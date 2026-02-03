import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRoadmap } from './hooks/useRoadmap';
import { useUndoManager, createInverse } from './hooks/useUndoManager';
import { useClipboard } from './hooks/useClipboard';
import { Toolbar } from './components/Toolbar';
import { Timeline, type ZoomLevel } from './components/Timeline';
import { Modal } from './components/Modal';
import { ProjectForm } from './components/ProjectForm';
import { MilestoneForm } from './components/MilestoneForm';
import { TeamMemberForm } from './components/TeamMemberForm';
import type { Project, Milestone, TeamMember, Dependency } from './types';
import type { FilterState, ProjectStatus } from './components/SearchFilter';
import { getSuggestedProjectDates } from './utils/dateUtils';
import { TimelineSkeleton } from './components/Skeleton';
import styles from './App.module.css';

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
    userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    sessionStorage.setItem('roadmap-user-id', userId);
  }
  return userId;
};

function App() {
  const {
    data,
    loading,
    addTeamMember,
    updateTeamMember,
    deleteTeamMember,
    reorderTeamMembers,
    addProject,
    updateProject,
    deleteProject,
    addMilestone,
    updateMilestone,
    deleteMilestone
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
  const [dependencies, setDependencies] = useState<Dependency[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

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
    hasContent: hasClipboard
  } = useClipboard({
    onPasteProject: handlePasteProject,
    onPasteMilestone: handlePasteMilestone
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
    if (statusColor === '#7612c3' || statusColor === '#7612c3') return 'on-hold';
    if (statusColor === '#9ca3af') return 'to-start';
    if (statusColor === '#04b050') return 'on-track';
    if (statusColor === '#ffc002') return 'at-risk';
    if (statusColor === '#ff0100') return 'off-track';

    // Default: if start date is in future, it's "to-start", otherwise "on-track"
    if (startDate > today) return 'to-start';
    return 'on-track';
  }, []);

  // Filter projects based on current filters
  const filteredProjects = useMemo(() => {
    let result = data.projects;

    // Filter by owners
    if (filters.owners.length > 0) {
      result = result.filter(p => filters.owners.includes(p.owner));
    }

    // Filter by tags (milestones)
    if (filters.tags.length > 0) {
      result = result.filter(p =>
        p.milestones?.some(m =>
          m.tags?.some(t => filters.tags.includes(t))
        )
      );
    }

    // Filter by status (color-based)
    if (filters.status !== 'all') {
      result = result.filter(p => getProjectDisplayStatus(p) === filters.status);
    }

    // Filter by search (already handled in SearchFilter for selection)
    // But we still filter the display if there's a search term
    if (filters.search.trim()) {
      const query = filters.search.toLowerCase();
      result = result.filter(p =>
        p.title.toLowerCase().includes(query) ||
        p.owner.toLowerCase().includes(query) ||
        p.milestones?.some(m =>
          m.title.toLowerCase().includes(query) ||
          m.tags?.some(t => t.toLowerCase().includes(query))
        )
      );
    }

    return result;
  }, [data.projects, filters, getProjectDisplayStatus]);

  // Scroll to project when selected from search
  const handleProjectSelect = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    // The Timeline component will handle scrolling
    setTimeout(() => setSelectedProjectId(null), 2000);
  }, []);

  // Handle undo
  const handleUndo = useCallback(() => {
    const action = undo();
    if (!action) return;

    // Apply the inverse action
    const inverse = action.inverse as { action: string; data: unknown };
    switch (action.type) {
      case 'CREATE_PROJECT':
        if (inverse.action === 'delete') {
          const proj = inverse.data as Project;
          deleteProject(proj.id);
        }
        break;
      case 'DELETE_PROJECT':
        if (inverse.action === 'restore') {
          const proj = inverse.data as Project;
          addProject(proj);
        }
        break;
      case 'UPDATE_PROJECT':
        if (inverse.action === 'update') {
          const proj = inverse.data as Project;
          updateProject(proj.id, proj);
        }
        break;
      // Add more cases as needed
    }
  }, [undo, deleteProject, addProject, updateProject]);

  // Handle redo
  const handleRedo = useCallback(() => {
    const action = redo();
    if (!action) return;

    // Apply the original action
    switch (action.type) {
      case 'CREATE_PROJECT': {
        const proj = action.data as Project;
        addProject(proj);
        break;
      }
      case 'DELETE_PROJECT': {
        const proj = action.data as Project;
        deleteProject(proj.id);
        break;
      }
      case 'UPDATE_PROJECT': {
        const proj = action.data as Project;
        updateProject(proj.id, proj);
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
      } else if (modifier && e.key === 'z' && e.shiftKey) {
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
    async (values: Omit<Project, 'id' | 'milestones'>) => {
      await addProject(values);
      closeModal();
    },
    [addProject, closeModal]
  );

  const handleEditProject = useCallback(
    async (values: Omit<Project, 'id' | 'milestones'>) => {
      if (modal?.type === 'edit-project') {
        const beforeState = modal.project;
        await updateProject(modal.project.id, values);
        recordAction('UPDATE_PROJECT', values, createInverse('UPDATE_PROJECT', beforeState, values));
        closeModal();
      }
    },
    [modal, updateProject, closeModal, recordAction]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      const project = data.projects.find(p => p.id === projectId);
      if (project) {
        recordAction('DELETE_PROJECT', project, createInverse('DELETE_PROJECT', project, null));
        await deleteProject(projectId);
      }
    },
    [data.projects, deleteProject, recordAction]
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

  // Dependency handlers
  const handleAddDependency = useCallback((fromId: string, toId: string) => {
    const newDep: Dependency = {
      id: `dep-${Date.now()}`,
      fromProjectId: fromId,
      toProjectId: toId,
      type: 'finish-to-start'
    };
    setDependencies(deps => [...deps, newDep]);
  }, []);

  const handleRemoveDependency = useCallback((depId: string) => {
    setDependencies(deps => deps.filter(d => d.id !== depId));
  }, []);

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
      const milestone = project?.milestones.find((m) => m.id === milestoneId);
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
        dependencies={dependencies}
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
          dependencies={dependencies}
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
          onAddDependency={handleAddDependency}
          onRemoveDependency={handleRemoveDependency}
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
            onSubmit={handleEditProject}
            onCancel={closeModal}
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
    </div>
  );
}

export default App;
