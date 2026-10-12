import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProgrammeView } from '../ProgrammeView';
import { ProjectWizard } from '../ProjectWizard';
import { TeamMemberForm } from '../TeamMemberForm';
import { BoardRulesContext, boardRules } from '../../utils/boardSettings';
import { projectsToCSV } from '../../utils/exportUtils';
import type { BoardSettings, Project, TeamMember } from '../../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const ON_TRACK = '#457028';
const COMPLETE = '#4179B5';

const team: TeamMember[] = [
  { id: 'm1', name: 'Amy', jobTitle: 'PM' },
  { id: 'm2', name: 'Ben', jobTitle: 'PM', capacity: 2 },
  { id: 'm3', name: 'Cal', jobTitle: 'PM', left: true },
];

const project = (id: string, extra: Partial<Project>): Project => ({
  id,
  title: id,
  owner: 'Amy',
  startDate: '2026-05-01',
  endDate: '2026-12-31',
  statusColor: ON_TRACK,
  size: 'small',
  milestones: [],
  ...extra,
});

describe('board rules, capacity and programme views', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 12, 12));
  });

  afterEach(() => {
    if (root) act(() => root!.unmount());
    container?.remove();
    root = null;
    container = null;
    vi.useRealTimers();
  });

  function render(node: React.ReactNode, settings?: BoardSettings) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(
      <BoardRulesContext.Provider value={boardRules(settings)}>{node}</BoardRulesContext.Provider>
    ));
    return container;
  }

  function type(input: HTMLInputElement | HTMLSelectElement, value: string) {
    const proto = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    act(() => {
      Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    });
  }
  const click = (el: Element) => act(() => { (el as HTMLElement).click(); });

  describe('ProgrammeView', () => {
    const projects = [
      project('Alpha', { programme: 'Clinical', baselineEndDate: '2026-12-10', statusSetOn: '2026-09-04' }),
      project('Bravo', { programme: 'Estates', endDate: '2026-10-08' }),
      project('Charlie', { programme: 'Estates', endDate: '2026-09-01' }),
      project('Delta', { statusColor: COMPLETE, baselineEndDate: '2026-12-31', statusSetOn: '2026-10-01' }),
      project('Old', { startDate: '2025-04-01', endDate: '2026-03-31' }),
    ];
    const headings = (el: HTMLElement) => [...el.querySelectorAll('h3')].map(h => h.textContent);
    const row = (el: HTMLElement, title: string) => [...el.querySelectorAll('li')].find(li => li.textContent!.startsWith(title))!.textContent;

    it('groups this year\'s work by programme in list order with unassigned last', () => {
      const el = render(<ProgrammeView projects={projects} />, { programmes: ['Estates', 'Clinical'] });
      expect(el.querySelector('h2')!.textContent).toBe('2026/27');
      expect(headings(el)).toEqual(['Estates2', 'Clinical1', 'No programme1']);
      expect(el.textContent).not.toContain('Old');
    });

    it('heads the columns, names each project\'s size and draws a thicker bar for a bigger one', () => {
      const el = render(<ProgrammeView projects={[project('Wee', {}), project('Huge', { size: 'full-time' }), project('Old', { startDate: '2025-04-01', endDate: '2026-03-31' })]} />);
      const head = () => el.querySelector('h3')!.parentElement!.previousElementSibling!.textContent;
      // Today, 12 Oct, sits where the Oct label would be, so it replaces it.
      expect(head()).toBe('ProjectOwnerSizeStatusAprJulJan12 OctEnd date');
      expect(row(el, 'Huge')).toBe('HugeAmyFull TimeOn Track31 Dec 2026');
      const height = (title: string) =>
        [...el.querySelectorAll('li')].find(li => li.textContent!.startsWith(title))!.querySelector<HTMLElement>('span[style*="width"]')!.style.height;
      expect([height('Wee'), height('Huge')]).toEqual(['4px', '10px']);
      click(el.querySelector('[aria-label="Previous financial year"]')!);
      expect(head()).toBe('ProjectOwnerSizeStatusAprJulOctJanEnd date');
    });

    it('cuts a bar square where the project runs past the edge of the year', () => {
      const el = render(<ProgrammeView projects={[
        project('Within', {}),
        project('Early', { startDate: '2026-01-10' }),
        project('Late', { endDate: '2027-04-17' }),
      ]} />);
      const bar = (title: string) =>
        [...el.querySelectorAll('li')].find(li => li.textContent!.startsWith(title))!.querySelector<HTMLElement>('span[style*="width"]')!;
      const cuts = (title: string) => bar(title).className.split(' ').filter(c => /cut/.test(c)).map(c => c.match(/cut(Start|End)/)![0]);
      expect([cuts('Within'), cuts('Early'), cuts('Late')]).toEqual([[], ['cutStart'], ['cutEnd']]);
      expect(bar('Late').parentElement!.title).toBe('1 May 2026 to 17 Apr 2027');
    });

    it('counts from the data, with overdue kept apart from complete and unconfirmed completions footnoted', () => {
      const el = render(<ProgrammeView projects={projects} />, { programmes: ['Estates', 'Clinical'] });
      expect(el.textContent).toContain('2 On Track2 Complete4 projects, 1 overdue.');
      expect(el.textContent).toContain('1 project is counted complete because the end date passed more than 7 days ago; nobody has confirmed it.');
      expect(el.textContent).not.toMatch(/assumed/i);
      expect(el.textContent).toContain('Of the 2 with a first planned end date, 1 now ends later.');
      expect(row(el, 'Bravo')).toContain('On Track, 4d overdue');
      expect(row(el, 'Charlie')).toBe('CharlieAmySmallComplete1 Sep 2026');
      expect(row(el, 'Delta')).toContain('AmySmallCompleteupdated 1 Oct');
      expect(row(el, 'Alpha')).toContain('updated 4 Sep');
      expect(row(el, 'Alpha')).toContain('31 Dec 20263 weeks later');
    });

    it('moves Bravo from overdue to assumed when the board\'s grace period is shorter', () => {
      const el = render(<ProgrammeView projects={projects} />, { graceDays: 3 });
      expect(el.textContent).toContain('1 On Track3 Complete4 projects, 0 overdue.');
      expect(el.textContent).toContain('2 projects are counted complete because the end date passed more than 3 days ago; nobody has confirmed them.');
    });

    it('says how many projects have no first planned end date or status date instead of showing a zero', () => {
      const el = render(<ProgrammeView projects={projects} />);
      expect(el.textContent).toContain('2 projects have no first planned end date, so no movement is shown for them.');
      expect(el.textContent).toContain('2 projects have no record of when the status was last set.');
      expect(row(el, 'Bravo')).toMatch(/8 Oct 2026$/);
      expect(row(el, 'Delta')).toMatch(/31 Dec 2026$/);
    });

    it('steps to another financial year and says so when it is empty', () => {
      const el = render(<ProgrammeView projects={projects} />);
      click(el.querySelector('[aria-label="Previous financial year"]')!);
      expect(el.querySelector('h2')!.textContent).toBe('2025/26');
      expect([...el.querySelectorAll('li')].map(li => li.textContent!.slice(0, 3))).toEqual(['Old']);
      click(el.querySelector('[aria-label="Previous financial year"]')!);
      expect(el.textContent).toContain('No projects run in 2024/25.');
    });
  });

  describe('project form', () => {
    const editing = project('p1', { title: 'Ward handover', programme: 'Clinical', baselineEndDate: '2026-12-10' });
    const open = (onSubmit: (v: Record<string, unknown>) => void, values: Project = editing) => render(
      <ProjectWizard initialValues={values} teamMembers={team} projects={[values]} editingProjectId="p1" onSubmit={onSubmit} onCancel={() => {}} isEditing />,
      { programmes: ['Clinical', 'Estates'] },
    );
    const submit = (el: HTMLElement) => act(async () => { el.querySelector('form')!.requestSubmit(); });

    it('offers the board\'s programmes and leaves programme and baseline out of an untouched save', async () => {
      const onSubmit = vi.fn();
      const el = open(onSubmit);
      expect([...el.querySelectorAll('#pw-programme option')].map(o => o.textContent)).toEqual(['No programme', 'Clinical', 'Estates']);
      expect(el.textContent).toContain('First planned to end 10 Dec 2026, now 3 weeks later.');
      await submit(el);
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect('programme' in onSubmit.mock.calls[0][0]).toBe(false);
      expect('baselineEndDate' in onSubmit.mock.calls[0][0]).toBe(false);
    });

    it('saves a cleared programme as an explicit undefined so the merge removes it', async () => {
      const onSubmit = vi.fn();
      const el = open(onSubmit);
      type(el.querySelector<HTMLSelectElement>('#pw-programme')!, '');
      await submit(el);
      expect('programme' in onSubmit.mock.calls[0][0]).toBe(true);
      expect(onSubmit.mock.calls[0][0].programme).toBeUndefined();
    });

    it('re-plans the baseline to the current end date only when asked', async () => {
      const onSubmit = vi.fn();
      const el = open(onSubmit);
      click([...el.querySelectorAll('button')].find(b => b.textContent === 'Re-plan from this end date')!);
      expect(el.textContent).toContain('First planned to end 31 Dec 2026.');
      await submit(el);
      expect(onSubmit.mock.calls[0][0].baselineEndDate).toBe('2026-12-31');
    });

    it('says a project has no first planned end date and can record one', async () => {
      const onSubmit = vi.fn();
      const el = open(onSubmit, project('p1', { title: 'Legacy' }));
      expect(el.textContent).toContain('No first planned end date was recorded for this project.');
      click([...el.querySelectorAll('button')].find(b => b.textContent === 'Record this end date')!);
      await submit(el);
      expect(onSubmit.mock.calls[0][0].baselineEndDate).toBe('2026-12-31');
    });
  });

  describe('team member form', () => {
    it('writes capacity only when it is changed', async () => {
      const onSubmit = vi.fn();
      const el = render(<TeamMemberForm initialValues={{ name: 'Ben', jobTitle: 'PM', capacity: 2 }} onSubmit={onSubmit} onCancel={() => {}} isEditing otherNames={[]} />);
      const select = el.querySelector<HTMLSelectElement>('#member-capacity')!;
      expect(select.value).toBe('2');
      await act(async () => { el.querySelector('form')!.requestSubmit(); });
      expect(onSubmit.mock.calls[0][0]).toEqual({ name: 'Ben', jobTitle: 'PM' });
      type(select, '3');
      await act(async () => { el.querySelector('form')!.requestSubmit(); });
      expect(onSubmit.mock.calls[1][0]).toEqual({ name: 'Ben', jobTitle: 'PM', capacity: 3 });
    });
  });

  describe('projectsToCSV', () => {
    it('exports programme, first planned end and the board\'s completion wording', () => {
      const csv = projectsToCSV(
        [
          project('Alpha', { programme: 'Clinical', baselineEndDate: '2026-12-10', statusSetOn: '2026-09-04' }),
          project('Charlie', { endDate: '2026-09-01' }),
        ],
        '2026-10-12',
        7,
      ).split('\n');
      expect(csv[0]).toBe('Title,Owner,Programme,Start Date,End Date,First Planned End,Status,Status Set On,Size,EPR,Tags,Milestones Count');
      expect(csv[1]).toBe('Alpha,Amy,Clinical,2026-05-01,2026-12-31,2026-12-10,On Track,2026-09-04,Small,No,,0');
      expect(csv[2]).toBe('Charlie,Amy,,2026-05-01,2026-09-01,,Complete (assumed),,Small,No,,0');
    });
  });
});
