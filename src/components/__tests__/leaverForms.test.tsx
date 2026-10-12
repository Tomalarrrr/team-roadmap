import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProjectWizard } from '../ProjectWizard';
import { TeamMemberForm } from '../TeamMemberForm';
import type { Project, TeamMember } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver; the wizard's date rail uses one.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const team: TeamMember[] = [
  { id: 'm1', name: 'Amy', jobTitle: 'PM' },
  { id: 'm2', name: 'Ben', jobTitle: 'PM', left: true },
  { id: 'm3', name: 'Cal', jobTitle: 'PM' },
];
const project: Project = {
  id: 'p1',
  title: 'Ward handover',
  owner: 'Amy',
  startDate: '2026-01-01',
  endDate: '2026-03-01',
  statusColor: '#457028',
  size: 'small',
  milestones: [],
};

describe('leavers in the forms', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function render(node: React.ReactNode) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(node));
    return container;
  }

  const ownerOptions = (el: HTMLElement) =>
    [...el.querySelectorAll('#pw-owner option')].map(o => o.textContent).filter(t => t !== 'Choose a person');

  it('does not offer a leaver as the owner of a project', () => {
    const el = render(
      <ProjectWizard initialValues={project} teamMembers={team} projects={[project]} editingProjectId="p1" onSubmit={() => {}} onCancel={() => {}} isEditing />
    );
    expect(ownerOptions(el)).toEqual(['Amy', 'Cal']);
  });

  it('still lists a leaver on the project they already own', () => {
    const owned = { ...project, owner: 'Ben' };
    const el = render(
      <ProjectWizard initialValues={owned} teamMembers={team} projects={[owned]} editingProjectId="p1" onSubmit={() => {}} onCancel={() => {}} isEditing />
    );
    expect(ownerOptions(el)).toContain('Ben');
    expect((el.querySelector('#pw-owner') as HTMLSelectElement).value).toBe('Ben');
  });

  it('saves a ticked "Has left the team" box', async () => {
    const onSubmit = vi.fn();
    const el = render(
      <TeamMemberForm initialValues={{ name: 'Amy', jobTitle: 'PM' }} onSubmit={onSubmit} onCancel={() => {}} isEditing otherNames={[]} />
    );
    act(() => (el.querySelector('#member-left') as HTMLInputElement).click());
    await act(async () => { el.querySelector('form')!.requestSubmit(); });
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Amy', jobTitle: 'PM', left: true });
  });

  it('writes nothing about leaving when the box is untouched', async () => {
    const onSubmit = vi.fn();
    const el = render(
      <TeamMemberForm initialValues={{ name: 'Amy', jobTitle: 'PM' }} onSubmit={onSubmit} onCancel={() => {}} isEditing otherNames={[]} />
    );
    await act(async () => { el.querySelector('form')!.requestSubmit(); });
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Amy', jobTitle: 'PM' });
  });

  it('refuses a name someone else on the board already has, whatever its case', async () => {
    const onSubmit = vi.fn();
    const el = render(
      <TeamMemberForm initialValues={{ name: 'Amy', jobTitle: 'PM' }} onSubmit={onSubmit} onCancel={() => {}} isEditing otherNames={['Ben', 'Cal']} />
    );
    const name = el.querySelector('#name') as HTMLInputElement;
    const type = (value: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(name, value);
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    type(' ben ');
    await act(async () => { el.querySelector('form')!.requestSubmit(); });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Someone on the board already has this name');

    type('Amy Jones');
    await act(async () => { el.querySelector('form')!.requestSubmit(); });
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Amy Jones', jobTitle: 'PM' });
  });

  it('has no leaving box when adding a new person', () => {
    const el = render(<TeamMemberForm onSubmit={() => {}} onCancel={() => {}} otherNames={[]} />);
    expect(el.querySelector('#member-left')).toBeNull();
  });
});
