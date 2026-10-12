import { useState } from 'react';
import type { BoardSettings, Project, TeamMember } from '../types';
import { MAX_RULE_DAYS, useBoardRules } from '../utils/boardSettings';
import { CAPACITY, capacityOfMember } from '../utils/capacity';
import { newProgrammeName } from '../utils/programmes';
import s from './BoardRulesPanel.module.css';

interface BoardRulesPanelProps {
  teamMembers: TeamMember[];
  projects: Project[];
  onUpdateSettings: (updates: BoardSettings) => void;
  /** Rename a programme, or remove it when `to` is null. Carries its projects. */
  onReplaceProgramme: (from: string, to: string | null) => void;
  onUpdateMember: (memberId: string, updates: Partial<TeamMember>) => void;
}

// A whole number of days, saved when the field is left or Enter is pressed.
// Anything that is not a whole number in range snaps back to the saved value.
function DaysField({ id, value, onCommit }: { id: string; value: number; onCommit: (days: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [saved, setSaved] = useState(value);
  if (saved !== value) {
    setSaved(value);
    setDraft(String(value));
  }

  const commit = () => {
    const days = Number(draft);
    if (draft.trim() === '' || !Number.isInteger(days) || days < 0 || days > MAX_RULE_DAYS) {
      setDraft(String(value));
      return;
    }
    if (days !== value) onCommit(days);
  };

  return (
    <input
      id={id}
      type="number"
      inputMode="numeric"
      min={0}
      max={MAX_RULE_DAYS}
      step={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      className={s.days}
    />
  );
}

export function BoardRulesPanel({ teamMembers, projects, onUpdateSettings, onReplaceProgramme, onUpdateMember }: BoardRulesPanelProps) {
  const rules = useBoardRules();
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<{ from: string; draft: string } | null>(null);
  const addable = newProgrammeName(newName, rules.programmes);

  const addProgramme = () => {
    if (!addable) return;
    onUpdateSettings({ programmes: [...rules.programmes, addable] });
    setNewName('');
  };

  const commitRename = () => {
    if (!renaming) return;
    const others = rules.programmes.filter(p => p !== renaming.from);
    const name = newProgrammeName(renaming.draft, others);
    if (name && name !== renaming.from) onReplaceProgramme(renaming.from, name);
    setRenaming(null);
  };

  const move = (index: number, by: number) => {
    const programmes = [...rules.programmes];
    const [name] = programmes.splice(index, 1);
    programmes.splice(index + by, 0, name);
    onUpdateSettings({ programmes });
  };

  const people = teamMembers.filter(m => !m.left);

  return (
    <div className={s.panel}>
      <section className={s.section}>
        <h3 className={s.heading}>Completion</h3>
        <p className={s.rule}>
          <label htmlFor="rule-grace">A project past its end date is treated as complete after</label>
          <DaysField id="rule-grace" value={rules.graceDays} onCommit={graceDays => onUpdateSettings({ graceDays })} />
          <span>days, unless someone sets its status or moves the date.</span>
        </p>
        <p className={s.note}>
          Until then it shows as overdue and keeps its own status. Discovery, Initiation, Ready to Start, On Hold
          and Deferred work is never treated as complete.
        </p>
      </section>

      <section className={s.section}>
        <h3 className={s.heading}>Capacity</h3>
        <p className={s.rule}>
          <label htmlFor="rule-recovery">A person&rsquo;s slots count as free</label>
          <DaysField id="rule-recovery" value={rules.recoveryDays} onCommit={recoveryDays => onUpdateSettings({ recoveryDays })} />
          <span>days after the work in front of them ends.</span>
        </p>
        {people.length > 0 && (
          <ul className={s.list}>
            {people.map(member => (
              <li key={member.id} className={s.row}>
                <label htmlFor={`rule-capacity-${member.id}`} className={s.rowName}>{member.name}</label>
                <select
                  id={`rule-capacity-${member.id}`}
                  value={capacityOfMember(member)}
                  onChange={(e) => onUpdateMember(member.id, { capacity: Number(e.target.value) })}
                  className={s.select}
                >
                  {Array.from({ length: CAPACITY }, (_, i) => CAPACITY - i).map(n => (
                    <option key={n} value={n}>{n} {n === 1 ? 'slot' : 'slots'}</option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
        <p className={s.note}>A small project takes 1 slot, medium 2, large 3 and full time 4.</p>
      </section>

      <section className={s.section}>
        <h3 className={s.heading}>Programmes</h3>
        <p className={s.note}>
          The programme view lists them in this order. Each project reports under one, chosen on the project form.
        </p>
        {rules.programmes.length > 0 && (
          <ul className={s.list}>
            {rules.programmes.map((name, index) => {
              const count = projects.filter(p => p.programme === name).length;
              return (
                <li key={name} className={s.row}>
                  <input
                    type="text"
                    aria-label={`Programme name: ${name}`}
                    maxLength={50}
                    value={renaming?.from === name ? renaming.draft : name}
                    onChange={(e) => setRenaming({ from: name, draft: e.target.value })}
                    onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
                    className={s.nameInput}
                  />
                  <span className={s.count}>{count} {count === 1 ? 'project' : 'projects'}</span>
                  <button type="button" className={s.rowBtn} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${name} up`}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button type="button" className={s.rowBtn} disabled={index === rules.programmes.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${name} down`}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button
                    type="button"
                    className={s.rowBtn}
                    onClick={() => onReplaceProgramme(name, null)}
                    aria-label={`Remove ${name}`}
                    title={count > 0 ? `Remove. Its ${count} ${count === 1 ? 'project stays' : 'projects stay'} on the board with no programme.` : 'Remove'}
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className={s.add}>
          <input
            type="text"
            aria-label="New programme name"
            placeholder="Add a programme"
            maxLength={50}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProgramme(); } }}
            className={s.nameInput}
          />
          <button type="button" className={s.addBtn} disabled={!addable} onClick={addProgramme}>Add</button>
        </div>
      </section>
    </div>
  );
}
