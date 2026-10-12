import { useMemo } from 'react';
import { addWeeks, differenceInCalendarDays, format, parseISO, startOfMonth, addMonths } from 'date-fns';
import type { Project, TeamMember } from '../types';
import { useBoardRules } from '../utils/boardSettings';
import { capacityOfMember, isCapacityExempt, nextFreeDate, supportSegments } from '../utils/capacity';
import { isOnHold } from '../utils/statusColors';
import s from './CapacityView.module.css';

interface CapacityViewProps {
  teamMembers: TeamMember[];
  projects: Project[];
}

const WINDOW_WEEKS = 26;

export function CapacityView({ teamMembers, projects }: CapacityViewProps) {
  const { recoveryDays } = useBoardRules();

  const { rows, months, totalDays, today } = useMemo(() => {
    const start = new Date();
    const today = format(start, 'yyyy-MM-dd');
    const windowEnd = format(addWeeks(start, WINDOW_WEEKS), 'yyyy-MM-dd');
    const totalDays = differenceInCalendarDays(parseISO(windowEnd), parseISO(today)) + 1;

    const months: { label: string; offset: number }[] = [];
    for (let month = addMonths(startOfMonth(start), 1); format(month, 'yyyy-MM-dd') <= windowEnd; month = addMonths(month, 1)) {
      months.push({ label: format(month, 'MMM'), offset: differenceInCalendarDays(month, parseISO(today)) / totalDays });
    }

    // Same load rule as the board's over-capacity marker: on-hold work and
    // the Digital Queue holding lane carry no load.
    const rows = teamMembers
      .filter(member => !member.left && !isCapacityExempt({ owner: member.name }))
      .map(member => {
        const capacity = capacityOfMember(member);
        const items = projects.filter(p => p.owner === member.name && !isCapacityExempt(p) && !isOnHold(p.statusColor));
        const segments = supportSegments(items, today, windowEnd, capacity);
        return { member, capacity, segments, freeNow: segments[0].freeSlots, nextFree: nextFreeDate(segments, 1, recoveryDays) };
      });
    return { rows, months, totalDays, today };
  }, [teamMembers, projects, recoveryDays]);

  if (rows.length === 0) {
    return <p className={s.empty}>Nobody is on the team yet, so there is no capacity to show.</p>;
  }

  const teamCapacity = rows.reduce((sum, row) => sum + row.capacity, 0);
  const teamFree = rows.reduce((sum, row) => sum + Math.max(0, row.freeNow), 0);
  const over = rows.filter(row => row.freeNow < 0).length;

  return (
    <div className={s.view}>
      <p className={s.summary}>
        {teamFree} of {teamCapacity} slots are free today across {rows.length} {rows.length === 1 ? 'person' : 'people'}
        {over > 0 && `; ${over} ${over === 1 ? 'person is' : 'people are'} over capacity`}.
      </p>

      <div className={s.table} role="table" aria-label={`Capacity over the next ${WINDOW_WEEKS} weeks`}>
        <div className={s.head} role="row">
          <span role="columnheader">Person</span>
          <span role="columnheader">Free today</span>
          <span role="columnheader" className={s.axis}>
            <span className={s.axisStart}>Today</span>
            {months.map(month => (
              <span key={month.offset} className={s.month} style={{ left: `${month.offset * 100}%` }}>{month.label}</span>
            ))}
          </span>
          <span role="columnheader">Next free slot</span>
        </div>

        {rows.map(({ member, capacity, segments, freeNow, nextFree }) => (
          <div key={member.id} className={s.row} role="row">
            <span role="cell" className={s.name} title={member.name}>{member.name}</span>
            <span role="cell" className={s.figure}>
              {freeNow < 0 ? `${-freeNow} over` : `${freeNow} of ${capacity}`}
            </span>
            <span role="cell" className={s.strip}>
              {segments.map(segment => {
                const days = differenceInCalendarDays(parseISO(segment.endDate), parseISO(segment.startDate)) + 1;
                const used = capacity - segment.freeSlots;
                const range = `${format(parseISO(segment.startDate), 'd MMM')} to ${format(parseISO(segment.endDate), 'd MMM')}`;
                return (
                  <span
                    key={segment.startDate}
                    className={`${s.segment} ${segment.freeSlots < 0 ? s.segmentOver : ''}`}
                    style={{ flexGrow: days / totalDays, ['--used' as string]: Math.min(1, used / capacity) }}
                    title={segment.freeSlots < 0
                      ? `${range}: ${-segment.freeSlots} over (${used} of ${capacity} slots in use)`
                      : `${range}: ${segment.freeSlots} free (${used} of ${capacity} slots in use)`}
                  />
                );
              })}
            </span>
            <span role="cell" className={s.figure}>
              {nextFree === null ? `None in ${WINDOW_WEEKS} weeks` : nextFree === today ? 'Now' : format(parseISO(nextFree), 'd MMM yyyy')}
            </span>
          </div>
        ))}
      </div>

      <p className={s.note}>
        Darker means more slots in use; a hatched stretch is over capacity. On-hold work is not counted. A slot that
        opens later counts as free {recoveryDays} {recoveryDays === 1 ? 'day' : 'days'} after the work in front of it
        ends. That figure, and each person&rsquo;s slots, are set in Board rules.
      </p>
    </div>
  );
}
