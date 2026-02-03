import { describe, it, expect } from 'vitest';
import { projectSchema, teamMemberSchema, validateForm } from '../validation';

describe('projectSchema', () => {
  it('validates a valid project', () => {
    const result = validateForm(projectSchema, {
      title: 'Test Project',
      owner: 'John Doe',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      statusColor: '#ff0000'
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty title', () => {
    const result = validateForm(projectSchema, {
      title: '',
      owner: 'John Doe',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      statusColor: '#ff0000'
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
      statusColor: '#ff0000'
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.endDate).toBe('End date must be after start date');
    }
  });

  it('rejects invalid color format', () => {
    const result = validateForm(projectSchema, {
      title: 'Test',
      owner: 'John',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      statusColor: 'red'
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
