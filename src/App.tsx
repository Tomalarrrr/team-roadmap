import { useState, useCallback } from 'react';
import { useRoadmap } from './hooks/useRoadmap';
import { Header } from './components/Header';
import { Timeline, type ZoomLevel } from './components/Timeline';
import { Modal } from './components/Modal';
import { ProjectForm } from './components/ProjectForm';
import { MilestoneForm } from './components/MilestoneForm';
import type { Project, Milestone } from './types';
import styles from './App.module.css';

type ModalType =
  | { type: 'add-project' }
  | { type: 'edit-project'; project: Project }
  | { type: 'add-milestone'; projectId: string; project: Project }
  | { type: 'edit-milestone'; projectId: string; project: Project; milestone: Milestone }
  | null;

function App() {
  const {
    data,
    loading,
    addProject,
    updateProject,
    deleteProject,
    addMilestone,
    updateMilestone,
    deleteMilestone
  } = useRoadmap();

  const [modal, setModal] = useState<ModalType>(null);
  const [zoomLevel, setZoomLevel] = useState<ZoomLevel>('month'); // Default to month view

  const closeModal = useCallback(() => setModal(null), []);

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
        await updateProject(modal.project.id, values);
        closeModal();
      }
    },
    [modal, updateProject, closeModal]
  );

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
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <p>Loading roadmap...</p>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <Header
        onAddProject={() => setModal({ type: 'add-project' })}
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
      />

      <main className={styles.main}>
        <Timeline
          projects={data.projects}
          zoomLevel={zoomLevel}
          onUpdateProject={updateProject}
          onDeleteProject={deleteProject}
          onAddMilestone={openAddMilestone}
          onEditProject={openEditProject}
          onEditMilestone={openEditMilestone}
          onDeleteMilestone={deleteMilestone}
        />
      </main>

      {/* Add Project Modal */}
      <Modal
        isOpen={modal?.type === 'add-project'}
        onClose={closeModal}
        title="New Project"
      >
        <ProjectForm onSubmit={handleAddProject} onCancel={closeModal} />
      </Modal>

      {/* Edit Project Modal */}
      <Modal
        isOpen={modal?.type === 'edit-project'}
        onClose={closeModal}
        title="Edit Project"
      >
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
      <Modal
        isOpen={modal?.type === 'add-milestone'}
        onClose={closeModal}
        title="Add Milestone"
      >
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
      <Modal
        isOpen={modal?.type === 'edit-milestone'}
        onClose={closeModal}
        title="Edit Milestone"
      >
        {modal?.type === 'edit-milestone' && (
          <MilestoneForm
            initialValues={{
              title: modal.milestone.title,
              startDate: modal.milestone.startDate,
              endDate: modal.milestone.endDate,
              tags: modal.milestone.tags,
              statusColor: modal.milestone.statusColor,
              manualColorOverride: modal.milestone.manualColorOverride
            }}
            projectStartDate={modal.project.startDate}
            projectEndDate={modal.project.endDate}
            onSubmit={handleEditMilestone}
            onCancel={closeModal}
            isEditing
          />
        )}
      </Modal>
    </div>
  );
}

export default App;
