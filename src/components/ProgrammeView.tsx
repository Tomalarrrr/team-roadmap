import { useMemo, useState } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { Project } from '../types';
import { useBoardRules } from '../utils/boardSettings';
import { completionOf, describeSlip, displayColorOf, slipDays, statusTextOf } from '../utils/completion';
import { getFYEnd, getFYFromDate, getFYStart, toDateString } from '../utils/dateUtils';
import { UNASSIGNED_PROGRAMME, groupByProgramme } from '../utils/programmes';
import s from './ProgrammeView.module.css';

interface ProgrammeViewProps {
  /** Projects passing the toolbar's filters. */
  projects: Project[];
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ProgrammeView({ projects }: ProgrammeViewProps) {
  const { graceDays, programmes } = useBoardRules();
  const today = toDateString(new Date());
  const [fy, setFy] = useState(() => getFYFromDate(new Date()));
  const fyStart = toDateString(getFYStart(fy));
  const fyEnd = toDateString(getFYEnd(fy));
  const fyDays = differenceInCalendarDays(parseISO(fyEnd), parseISO(fyStart)) + 1;
  const fyLabel = `${fy}/${String(fy + 1).slice(2)}`;

  const inYear = useMemo(
    () => projects.filter(p => p.startDate <= fyEnd && p.endDate >= fyStart),
    [projects, fyStart, fyEnd],
  );
  const groups = useMemo(() => groupByProgramme(inYear, programmes), [inYear, programmes]);

  const tally = { open: 0, overdue: 0, assumed: 0, confirmed: 0 };
  for (const project of inYear) tally[completionOf(project, today, graceDays)]++;
  const slips = inYear.map(slipDays);
  const withBaseline = slips.filter(days => days !== null).length;
  const later = slips.filter(days => days !== null && days > 0).length;
  const noStatusDate = inYear.filter(p => !p.statusSetOn).length;

  // Fraction of the year's width for a date, clamped to the year.
  const at = (date: string) =>
    Math.min(1, Math.max(0, differenceInCalendarDays(parseISO(date), parseISO(fyStart)) / fyDays));
  const todayInYear = today >= fyStart && today <= fyEnd;

  return (
    <div className={s.view}>
      <div className={s.top}>
        <div className={s.year}>
          <button type="button" className={s.yearBtn} onClick={() => setFy(fy - 1)} aria-label="Previous financial year">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <h2 className={s.yearLabel}>{fyLabel}</h2>
          <button type="button" className={s.yearBtn} onClick={() => setFy(fy + 1)} aria-label="Next financial year">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </div>
        {inYear.length > 0 && (
          <p className={s.summary}>
            {count(inYear.length, 'project', 'projects')}: {tally.open} open, {tally.overdue} overdue,{' '}
            {tally.confirmed} complete, {tally.assumed} assumed complete.
            {withBaseline > 0 && ` Of the ${withBaseline} with a first planned end date, ${later} now ${later === 1 ? 'ends' : 'end'} later.`}
          </p>
        )}
      </div>

      {inYear.length === 0 && (
        <p className={s.empty}>
          {projects.length === 0 ? 'No projects to show.' : `No projects run in ${fyLabel}.`}
        </p>
      )}

      {groups.map(group => (
        <section key={group.programme ?? ''} className={s.group}>
          <h3 className={s.groupName}>
            {group.programme ?? UNASSIGNED_PROGRAMME}
            <span className={s.groupCount}>{group.projects.length}</span>
          </h3>
          <ul className={s.rows}>
            {group.projects.map(project => {
              const slip = slipDays(project);
              const left = at(project.startDate);
              // A bar ends at the close of its end date, hence the extra day.
              const right = Math.min(1, at(project.endDate) + 1 / fyDays);
              return (
                <li key={project.id} className={s.row}>
                  <span className={s.title} title={project.title}>{project.title}</span>
                  <span className={s.owner}>{project.owner}</span>
                  <span className={s.status}>
                    <span className={s.swatch} style={{ backgroundColor: displayColorOf(project, today, graceDays) }} />
                    {statusTextOf(project, today, graceDays)}
                    {project.statusSetOn && <span className={s.quiet}>set {format(parseISO(project.statusSetOn), 'd MMM')}</span>}
                  </span>
                  <span className={s.track}>
                    {todayInYear && <span className={s.today} style={{ left: `${at(today) * 100}%` }} />}
                    <span
                      className={s.bar}
                      style={{
                        left: `${left * 100}%`,
                        width: `${(right - left) * 100}%`,
                        backgroundColor: displayColorOf(project, today, graceDays),
                      }}
                    />
                  </span>
                  <span className={s.end}>
                    {format(parseISO(project.endDate), 'd MMM yyyy')}
                    {slip !== null && slip !== 0 && <span className={s.quiet}>{describeSlip(slip)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {inYear.length > 0 && (inYear.length > withBaseline || noStatusDate > 0) && (
        <p className={s.note}>
          {inYear.length > withBaseline &&
            `${count(inYear.length - withBaseline, 'project has', 'projects have')} no first planned end date, so no movement is shown for ${inYear.length - withBaseline === 1 ? 'it' : 'them'}. `}
          {noStatusDate > 0 &&
            `${count(noStatusDate, 'project has', 'projects have')} no record of when the status was last set.`}
        </p>
      )}
    </div>
  );
}
