import { z } from 'zod';

// Reusable date validation
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)');

// Project validation schema
export const projectSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title too long'),
  owner: z.string().min(1, 'Owner is required').max(50, 'Owner name too long'),
  startDate: dateString,
  endDate: dateString,
  statusColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format')
}).refine(data => new Date(data.endDate) >= new Date(data.startDate), {
  message: 'End date must be after start date',
  path: ['endDate']
});

// Milestone validation schema
export const milestoneSchema = z.object({
  title: z.string().min(1, 'Title is required').max(100, 'Title too long'),
  description: z.string().max(500, 'Description too long').optional(),
  startDate: dateString,
  endDate: dateString,
  tags: z.array(z.string().max(30, 'Tag too long')).max(10, 'Too many tags'),
  statusColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid color format')
}).refine(data => new Date(data.endDate) >= new Date(data.startDate), {
  message: 'End date must be after start date',
  path: ['endDate']
});

// Team member validation schema
export const teamMemberSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
  jobTitle: z.string().min(1, 'Job title is required').max(50, 'Job title too long')
});

// Type exports
export type ProjectInput = z.infer<typeof projectSchema>;
export type MilestoneInput = z.infer<typeof milestoneSchema>;
export type TeamMemberInput = z.infer<typeof teamMemberSchema>;

// Validation helper
export function validateForm<T>(schema: z.ZodSchema<T>, data: unknown): { success: true; data: T } | { success: false; errors: Record<string, string> } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const errors: Record<string, string> = {};
  result.error.issues.forEach(issue => {
    const path = issue.path.join('.');
    errors[path] = issue.message;
  });
  return { success: false, errors };
}
