import { describe, it, expect } from 'vitest';
import {
  completionOf,
  daysPastEnd,
  describeSlip,
  displayColorOf,
  displayStatusOf,
  slipDays,
  statusStamp,
  statusTextOf,
} from '../completion';
import { AUTO_COMPLETE_COLOR, STATUS_COLORS } from '../statusColors';

const hex = (slug: string): string => {
  const status = STATUS_COLORS.find(s => s.slug === slug);
  if (!status) throw new Error(`no status ${slug}`);
  return status.hex;
};

const ending = (endDate: string, slug = 'on-track') => ({ endDate, statusColor: hex(slug) });

describe('completionOf', () => {
  const project = ending('2026-03-10');

  it('is open up to and on the end date', () => {
    expect(completionOf(project, '2026-03-09', 7)).toBe('open');
    expect(completionOf(project, '2026-03-10', 7)).toBe('open');
  });

  it('is overdue from the day after the end date to the last day of grace', () => {
    expect(completionOf(project, '2026-03-11', 7)).toBe('overdue');
    expect(completionOf(project, '2026-03-17', 7)).toBe('overdue');
  });

  it('is assumed complete the day after grace runs out', () => {
    expect(completionOf(project, '2026-03-18', 7)).toBe('assumed');
  });

  it('follows the grace period it is given', () => {
    expect(completionOf(project, '2026-03-11', 0)).toBe('assumed');
    expect(completionOf(project, '2026-03-18', 14)).toBe('overdue');
    expect(completionOf(project, '2026-03-25', 14)).toBe('assumed');
  });

  it('is confirmed only when the status is Complete, whatever the dates', () => {
    expect(completionOf(ending('2026-03-10', 'complete'), '2026-01-01', 7)).toBe('confirmed');
    expect(completionOf(ending('2026-03-10', 'complete'), '2027-01-01', 7)).toBe('confirmed');
  });

  it.each(['discovery', 'initiation', 'ready-to-start', 'on-hold', 'deferred'])(
    'never assumes a %s project finished',
    slug => {
      expect(completionOf(ending('2026-03-10', slug), '2027-01-01', 7)).toBe('open');
    },
  );
});

describe('what an overdue or assumed project shows as', () => {
  const project = ending('2026-03-10', 'at-risk');

  it('keeps its own status and colour while overdue', () => {
    expect(displayStatusOf(project, '2026-03-12', 7)).toBe('at-risk');
    expect(displayColorOf(project, '2026-03-12', 7)).toBe(hex('at-risk'));
    expect(statusTextOf(project, '2026-03-12', 7)).toBe('At Risk, 2d overdue');
  });

  it('counts and colours as complete once assumed, and says it is an assumption', () => {
    expect(displayStatusOf(project, '2026-03-18', 7)).toBe('complete');
    expect(displayColorOf(project, '2026-03-18', 7)).toBe(AUTO_COMPLETE_COLOR);
    expect(statusTextOf(project, '2026-03-18', 7)).toBe('Complete (assumed)');
  });

  it('gives the plain status name when open', () => {
    expect(statusTextOf(project, '2026-03-01', 7)).toBe('At Risk');
  });
});

describe('daysPastEnd', () => {
  it('counts whole days past the end and never goes negative', () => {
    expect(daysPastEnd({ endDate: '2026-03-10' }, '2026-03-01')).toBe(0);
    expect(daysPastEnd({ endDate: '2026-03-10' }, '2026-03-13')).toBe(3);
  });
});

describe('slipDays', () => {
  it('is null without a baseline, not zero', () => {
    expect(slipDays({ endDate: '2026-03-10' })).toBeNull();
  });

  it('is zero on plan, positive when later, negative when earlier', () => {
    expect(slipDays({ endDate: '2026-03-10', baselineEndDate: '2026-03-10' })).toBe(0);
    expect(slipDays({ endDate: '2026-03-31', baselineEndDate: '2026-03-10' })).toBe(21);
    expect(slipDays({ endDate: '2026-03-05', baselineEndDate: '2026-03-10' })).toBe(-5);
  });
});

describe('describeSlip', () => {
  it('uses days under a fortnight and whole weeks from there', () => {
    expect(describeSlip(0)).toBe('on plan');
    expect(describeSlip(1)).toBe('1 day later');
    expect(describeSlip(13)).toBe('13 days later');
    expect(describeSlip(14)).toBe('2 weeks later');
    expect(describeSlip(21)).toBe('3 weeks later');
    expect(describeSlip(-5)).toBe('5 days earlier');
  });
});

describe('statusStamp', () => {
  const before = { statusColor: hex('on-track') };

  it('stamps today when the status changes', () => {
    expect(statusStamp(before, { statusColor: hex('at-risk') }, '2026-04-02')).toEqual({ statusSetOn: '2026-04-02' });
  });

  it('adds nothing when the edit leaves the status alone', () => {
    expect(statusStamp(before, { endDate: '2026-05-01' }, '2026-04-02')).toEqual({});
    expect(statusStamp(before, { statusColor: hex('on-track') }, '2026-04-02')).toEqual({});
  });
});
