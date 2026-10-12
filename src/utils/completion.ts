import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { Project, ProjectStatus } from '../types';
import { AUTO_COMPLETE_COLOR, getStatusNameByHex, getStatusSlugByHex, isAutoCompleteExempt, normalizeStatusColor } from './statusColors';

/**
 * What the board can honestly say about whether a project has finished.
 *
 * - `open`: not past its end date, or in a stage where an elapsed end date says
 *   nothing (Discovery, Initiation, Ready to Start, On Hold, Deferred).
 * - `overdue`: past its end date, inside the grace period, and nobody has said
 *   it finished. It keeps its own status so it is not counted as delivered.
 * - `assumed`: the grace period ran out with no word either way. Treated as
 *   complete on its planned end date, and labelled as an assumption.
 * - `confirmed`: a person set the status to Complete.
 */
export type Completion = 'open' | 'overdue' | 'assumed' | 'confirmed';

type Dated = Pick<Project, 'endDate' | 'statusColor'>;

/** Whole days `today` is past the project's end date; 0 on or before it. */
export function daysPastEnd(project: Pick<Project, 'endDate'>, today: string): number {
  return Math.max(0, differenceInCalendarDays(parseISO(today), parseISO(project.endDate)));
}

export function completionOf(project: Dated, today: string, graceDays: number): Completion {
  if (getStatusSlugByHex(project.statusColor) === 'complete') return 'confirmed';
  if (isAutoCompleteExempt(project.statusColor)) return 'open';
  const past = daysPastEnd(project, today);
  if (past === 0) return 'open';
  return past <= graceDays ? 'overdue' : 'assumed';
}

/** The status a project filters and counts as. An overdue project is still
 *  whatever its owner last said it was. */
export function displayStatusOf(project: Dated, today: string, graceDays: number): ProjectStatus | undefined {
  const completion = completionOf(project, today, graceDays);
  if (completion === 'assumed' || completion === 'confirmed') return 'complete';
  return getStatusSlugByHex(project.statusColor) as ProjectStatus | undefined;
}

/** Bar colour: an assumed completion takes the Complete colour, everything else
 *  keeps the colour its status has. */
export function displayColorOf(project: Dated, today: string, graceDays: number): string {
  return completionOf(project, today, graceDays) === 'assumed'
    ? AUTO_COMPLETE_COLOR
    : normalizeStatusColor(project.statusColor);
}

/** The words for a project's status, with the completion state spelled out. */
export function statusTextOf(project: Dated, today: string, graceDays: number): string | undefined {
  const completion = completionOf(project, today, graceDays);
  if (completion === 'assumed') return 'Complete (assumed)';
  const name = getStatusNameByHex(project.statusColor);
  if (completion === 'overdue' && name) return `${name}, ${daysPastEnd(project, today)}d overdue`;
  return name;
}

/**
 * Days the end date has moved from the one first agreed: positive is later.
 * Null when the project has no baseline, which is every project created before
 * baselines were recorded. A missing baseline is not a slip of zero.
 */
export function slipDays(project: Pick<Project, 'endDate' | 'baselineEndDate'>): number | null {
  if (!project.baselineEndDate) return null;
  return differenceInCalendarDays(parseISO(project.endDate), parseISO(project.baselineEndDate));
}

/** "3 weeks later", "2 days earlier", "on plan". Whole weeks once it reaches 14 days. */
export function describeSlip(days: number): string {
  if (days === 0) return 'on plan';
  const size = Math.abs(days);
  const amount = size >= 14 ? `${Math.round(size / 7)} weeks` : `${size} day${size === 1 ? '' : 's'}`;
  return `${amount} ${days > 0 ? 'later' : 'earlier'}`;
}

/**
 * Fields to add to an edit so the board records when a person last chose the
 * status. Empty when the edit leaves the status alone.
 */
export function statusStamp(
  before: Pick<Project, 'statusColor'>,
  updates: Partial<Project>,
  today: string,
): Pick<Project, 'statusSetOn'> | Record<string, never> {
  if (updates.statusColor === undefined) return {};
  if (normalizeStatusColor(updates.statusColor) === normalizeStatusColor(before.statusColor)) return {};
  return { statusSetOn: today };
}
