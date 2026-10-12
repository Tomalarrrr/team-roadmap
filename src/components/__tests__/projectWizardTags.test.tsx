import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProjectWizard } from '../ProjectWizard';
import type { Project } from '../../types';

// react-dom requires this flag to run act() outside a full test framework integration.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver; the date rail uses one.
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const editing: Project = {
  id: 'p1',
  title: 'Ward handover',
  owner: 'Amy',
  startDate: '2026-01-01',
  endDate: '2026-03-01',
  statusColor: '#457028',
  size: 'small',
  tags: ['Clinical'],
  milestones: [],
};
const other: Project = { ...editing, id: 'p2', title: 'Network refresh', tags: ['Infrastructure'] };

// React tracks an input's value itself, so a plain `input.value = x` is
// invisible to it; the native setter plus an input event is what typing does.
function type(input: HTMLInputElement, text: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setValue.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ProjectWizard tags', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function mount(onSubmit: (values: { tags?: string[] }) => void) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(
      <ProjectWizard
        initialValues={editing}
        projects={[editing, other]}
        editingProjectId={editing.id}
        onSubmit={onSubmit}
        onCancel={() => {}}
        isEditing
      />
    ));
    return {
      tagInput: container.querySelector('#pw-tag') as HTMLInputElement,
      save: () => {
        const button = [...container!.querySelectorAll('button')].find(b => b.textContent === 'Save changes')!;
        return act(async () => { button.click(); });
      },
    };
  }

  // A submitted `tags` key is written as the whole list, so sending it back
  // unedited would overwrite a tag someone else added in the meantime.
  it('leaves tags out of the save when they were not edited', async () => {
    const onSubmit = vi.fn();
    const { tagInput, save } = mount(onSubmit);
    act(() => (container!.querySelector('[aria-label="Remove tag Clinical"]') as HTMLButtonElement).click());
    type(tagInput, 'clinical');
    await save();
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].title).toBe('Ward handover');
    expect('tags' in onSubmit.mock.calls[0][0]).toBe(false);
  });

  it('saves a swap that leaves the count unchanged', async () => {
    const onSubmit = vi.fn();
    const { tagInput, save } = mount(onSubmit);
    act(() => (container!.querySelector('[aria-label="Remove tag Clinical"]') as HTMLButtonElement).click());
    type(tagInput, 'Finance');
    await save();
    expect(onSubmit.mock.calls[0][0].tags).toEqual(['Finance']);
  });

  it('removes a tag, adds one with Enter, and keeps one typed but not entered', async () => {
    const onSubmit = vi.fn();
    const { tagInput, save } = mount(onSubmit);

    act(() => (container!.querySelector('[aria-label="Remove tag Clinical"]') as HTMLButtonElement).click());

    // Lower-case on purpose: it should land as the board's existing "Infrastructure".
    type(tagInput, 'infrastructure');
    act(() => { tagInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(tagInput.value).toBe('');

    type(tagInput, 'Finance');
    await save();

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].tags).toEqual(['Infrastructure', 'Finance']);
  });

  it('saves an empty list when the last tag is removed, so the removal is written', async () => {
    const onSubmit = vi.fn();
    const { save } = mount(onSubmit);
    act(() => (container!.querySelector('[aria-label="Remove tag Clinical"]') as HTMLButtonElement).click());
    await save();
    expect(onSubmit.mock.calls[0][0].tags).toEqual([]);
  });
});
