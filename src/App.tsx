import { useState, useCallback } from 'react';
import { useRoadmap } from './hooks/useRoadmap';
import { Header } from './components/Header';
import { Timeline, type ZoomLevel } from './components/Timeline';
import { Modal } from './components/Modal';
import { ProjectForm } from './components/ProjectForm';
import { MilestoneForm } from './components/MilestoneForm';
import { TeamMemberForm } from './components/TeamMemberForm';
import type { Project, Milestone, TeamMember } from './types';
import styles from './App.module.css';

type ModalType =
  | { type: 'add-project'; ownerName: string }
  | { type: 'edit-project'; project: Project }
  | { type: 'add-milestone'; projectId: string; project: Project }
  | { type: 'edit-milestone'; projectId: string; project: Project; milestone: Milestone }
  | { type: 'add-member' }
  | { type: 'edit-member'; member: TeamMember }
  | null;

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

  const closeModal = useCallback(() => setModal(null), []);

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

  // Project handlers
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
      <Header zoomLevel={zoomLevel} onZoomChange={setZoomLevel} />

      <main className={styles.main}>
        <Timeline
          projects={data.projects}
          teamMembers={data.teamMembers}
          zoomLevel={zoomLevel}
          onAddProject={(ownerName) => setModal({ type: 'add-project', ownerName })}
          onUpdateProject={updateProject}
          onDeleteProject={deleteProject}
          onAddMilestone={openAddMilestone}
          onEditProject={openEditProject}
          onEditMilestone={openEditMilestone}
          onUpdateMilestone={updateMilestone}
          onDeleteMilestone={deleteMilestone}
          onAddTeamMember={() => setModal({ type: 'add-member' })}
          onEditTeamMember={(member) => setModal({ type: 'edit-member', member })}
          onReorderTeamMembers={reorderTeamMembers}
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
            initialValues={{ owner: modal.ownerName }}
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
