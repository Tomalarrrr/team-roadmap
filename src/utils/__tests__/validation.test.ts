import { describe, it, expect } from 'vitest';
import { projectSchema, teamMemberSchema, validateForm } from '../validation';

describe('projectSchema', () => {
  it('validates a valid project', () => {
    const result = validateForm(projectSchema, {
      title: 'Test Project',
      owner: 'John Doe',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      statusColor: '#ff0000',
      size: 'medium'
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = validateForm(projectSchema, {
      title: '',
      owner: 'John Doe',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      statusColor: '#ff0000',
      size: 'medium'
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.title).toBe('Title is required');
    }
  });

  it('rejects end date before start date', () => {
    const result = validateForm(projectSchema, {
      title: 'Test',
      owner: 'John',
      startDate: '2025-12-31',
      endDate: '2025-01-01',
      statusColor: '#ff0000',
      size: 'medium'
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.endDate).toBe('End date must be on or after start date');
    }
  });

  it('accepts equal start and end dates (single-day project)', () => {
    const result = validateForm(projectSchema, {
      title: 'Test', owner: 'John',
      startDate: '2025-06-15', endDate: '2025-06-15',
      statusColor: '#ff0000', size: 'small'
    });
    expect(result.success).toBe(true);
  });

  it.each([
    ['2025-02-30', 'Feb 30 does not exist'],
    ['2025-04-31', 'April has 30 days'],
    ['2025-13-01', 'month 13 is invalid'],
    ['2025-00-10', 'month 0 is invalid'],
    ['2025-06-00', 'day 0 is invalid'],
    ['2025-13-45', 'month and day both invalid'],
  ])('rejects impossible calendar date %s (%s)', (badDate) => {
    const result = validateForm(projectSchema, {
      title: 'Test', owner: 'John',
      startDate: badDate, endDate: '2025-12-31',
      statusColor: '#ff0000', size: 'medium'
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid leap-day date (2028-02-29)', () => {
    const result = validateForm(projectSchema, {
      title: 'Test', owner: 'John',
      startDate: '2028-02-29', endDate: '2028-03-01',
      statusColor: '#ff0000', size: 'medium'
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-leap-year Feb 29 (2025-02-29)', () => {
    const result = validateForm(projectSchema, {
      title: 'Test', owner: 'John',
      startDate: '2025-02-29', endDate: '2025-12-31',
      statusColor: '#ff0000', size: 'medium'
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid color format', () => {
    const result = validateForm(projectSchema, {
      title: 'Test',
      owner: 'John',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      statusColor: 'red',
      size: 'medium'
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.statusColor).toBe('Invalid color format');
    }
  });
});

describe('teamMemberSchema', () => {
  it('validates a valid team member', () => {
    const result = validateForm(teamMemberSchema, {
      name: 'Jane Doe',
      jobTitle: 'Engineer'
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = validateForm(teamMemberSchema, {
      name: '',
      jobTitle: 'Engineer'
    });
    expect(result.success).toBe(false);
  });
});
